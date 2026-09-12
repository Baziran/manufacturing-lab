"""Integration checks against the synthetic PostgreSQL database."""
import os
import unittest
from unittest.mock import patch

import psycopg
from fastapi.testclient import TestClient
from psycopg.pq import TransactionStatus
from psycopg_pool import PoolTimeout

import health
from server import app


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = patch.dict(os.environ, {'DB_POOL_MIN_SIZE': '1', 'DB_POOL_MAX_SIZE': '1'})
        cls.config.start()
        cls.client = TestClient(app)
        cls.client.__enter__()
        app.state.pool.wait(timeout=10)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        cls.config.stop()
        assert app.state.pool.closed

    def test_documents_and_static_routes(self) -> None:
        for path in ('/', '/app.js', '/docs', '/openapi.json'):
            self.assertEqual(self.client.get(path).status_code, 200, path)
        schema = self.client.get('/openapi.json').json()
        self.assertIn('/api/dashboard', schema['paths'])
        parameter = schema['paths']['/api/dashboard']['get']['parameters'][0]
        self.assertEqual(parameter['name'], 'date')
        self.assertEqual(parameter['schema']['format'], 'date')
        self.assertEqual(self.client.get('/api/unknown').status_code, 404)
        queries = self.client.get('/api/queries').json()
        self.assertEqual(len(queries), 9)

    def test_validation_and_serialization(self) -> None:
        for value in ('invalid', '', '2026-08-31', '2026-10-01', '2026-09-31'):
            response = self.client.get('/api/dashboard', params={'date': value})
            self.assertEqual(response.status_code, 400, value)
            self.assertIn('error', response.json())
        for day in (1, 12, 30):
            response = self.client.get('/api/dashboard', params={'date': f'2026-09-{day:02}'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            data = response.json()
            self.assertEqual(len(data['trend']), day)
            self.assertEqual(len(data['previous_trend']), day)
            self.assertTrue(all(isinstance(row['amount'], (int, float)) for row in data['orders']))
        data = self.client.get('/api/dashboard').json()
        self.assertEqual(data['as_of'], '2026-09-12')
        self.assertEqual(len(data['orders']), 12)
        self.assertEqual(sum(row['amount'] for row in data['shipments']), 161000)

    def test_claims_dates_links_and_totals(self) -> None:
        data = self.client.get('/api/dashboard').json()
        claims = data['claims']
        self.assertEqual(len(claims), 5)
        self.assertEqual(sum(c['goods_value'] for c in claims), 42000)
        self.assertEqual(sum(c['claim_status'] != 'closed' for c in claims), 3)
        self.assertEqual(sum(c['returned_at'] is not None for c in claims), 3)
        self.assertEqual(len({c['reason'] for c in claims}), 4)
        self.assertTrue(all(c['order_id'] in {o['order_id'] for o in data['orders']} for c in claims))
        self.assertEqual(self.client.get('/api/dashboard?date=2026-09-04').json()['claims'], [])
        earlier = self.client.get('/api/dashboard?date=2026-09-06').json()['claims']
        self.assertEqual(len(earlier), 2)
        self.assertTrue(all(c['returned_at'] is None and c['closed_at'] is None and c['resolution'] is None and c['claim_status'] == 'review' for c in earlier))
        with app.state.pool.connection() as conn:
            self.assertFalse(conn.execute("SELECT has_table_privilege(current_user, 'claims', 'UPDATE') AS allowed").fetchone()['allowed'])
            invalid = conn.execute("SELECT count(*) AS n FROM claims c JOIN order_items i USING (order_item_id) WHERE c.quantity > (SELECT COALESCE(sum(s.quantity),0) FROM shipments s WHERE s.order_item_id=i.order_item_id AND s.shipped_at<=c.opened_at)").fetchone()['n']
            self.assertEqual(invalid, 0)

    def test_returned_order_is_fully_shipped_on_time(self) -> None:
        for day in (6, 9, 12, 30):
            data = self.client.get('/api/dashboard', params={'date': f'2026-09-{day:02}'}).json()
            order = next(o for o in data['orders'] if o['order_id'] == 102)
            self.assertEqual(order['quantity'], 4)
            self.assertEqual(order['shipped_qty'], 4)
            self.assertEqual(order['remaining_qty'], 0)
            self.assertEqual(order['shipped_amount'], 66000)
            self.assertEqual(order['fulfillment_status'], 'shipped')
            self.assertEqual(order['days_overdue'], 0)
            self.assertEqual(order['last_shipped_at'], '2026-09-06')
            self.assertEqual(order['delay_reason'], '')
            self.assertTrue(all(i['shipped_qty'] == i['quantity'] for i in order['items']))
            self.assertEqual(sum(s['amount'] for s in data['shipments']), sum(t['shipped'] for t in data['trend']))
            claim = [c for c in data['claims'] if c['order_id'] == 102]
            if day >= 9:
                self.assertEqual(claim[0]['claim_status'], 'returned')
                self.assertEqual(claim[0]['quantity'], 1)
            else:
                self.assertEqual(claim, [])

    def test_pool_reuse_and_rollback(self) -> None:
        pool = app.state.pool
        with pool.connection() as conn:
            pid = conn.info.backend_pid
            self.assertEqual(conn.execute('SHOW transaction_read_only').fetchone()['transaction_read_only'], 'on')
            self.assertFalse(conn.execute("SELECT has_table_privilege(current_user, 'orders', 'UPDATE') AS allowed").fetchone()['allowed'])
        with self.assertRaises(psycopg.errors.DivisionByZero):
            with pool.connection() as conn:
                conn.execute('SELECT 1 / 0')
        with pool.connection() as conn:
            self.assertEqual(conn.info.backend_pid, pid)
            self.assertEqual(conn.info.transaction_status, TransactionStatus.IDLE)
            self.assertEqual(conn.execute('SELECT 42 AS answer').fetchone()['answer'], 42)
        self.assertEqual(pool.get_stats()['pool_size'], 1)

    def test_unavailable_database_and_recovery(self) -> None:
        health.CACHE = None
        with patch.object(app.state.pool, 'connection', side_effect=PoolTimeout('test')):
            response = self.client.get('/api/dashboard')
            self.assertEqual(response.status_code, 503)
            self.assertIn('error', response.json())
            response = self.client.get('/api/health')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['status'], 'degraded')
            self.assertIsNone(response.json()['database'])
        health.CACHE = None
        recovered = self.client.get('/api/health').json()
        self.assertEqual(recovered['status'], 'ok')
        self.assertEqual(len(recovered['tables']), 11)
        self.assertEqual(self.client.get('/api/dashboard').status_code, 200)


if __name__ == '__main__':
    unittest.main()
