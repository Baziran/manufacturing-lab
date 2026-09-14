"""Integration checks against the synthetic PostgreSQL database."""
import os
from datetime import date
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
        cls.clock = patch('server.business_today', return_value=date(2026, 9, 30))
        cls.clock.start()
        cls.client = TestClient(app)
        cls.client.__enter__()
        app.state.pool.wait(timeout=10)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        cls.config.stop()
        cls.clock.stop()
        assert app.state.pool.closed

    def test_documents_and_static_routes(self) -> None:
        for path in ('/', '/app.js', '/docs', '/openapi.json'):
            self.assertEqual(self.client.get(path).status_code, 200, path)
        schema = self.client.get('/openapi.json').json()
        self.assertIn('/api/dashboard', schema['paths'])
        parameter = schema['paths']['/api/dashboard']['get']['parameters'][0]
        self.assertEqual(parameter['name'], 'date')
        self.assertEqual(parameter['schema']['anyOf'][0]['format'], 'date')
        self.assertEqual(self.client.get('/api/unknown').status_code, 404)
        queries = self.client.get('/api/queries').json()
        self.assertEqual(len(queries), 10)

    def test_validation_and_serialization(self) -> None:
        for value in ('invalid', '', '1999-12-31', '2100-01-01', '2026-09-31'):
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

    def test_months_ranges_and_related_orders(self) -> None:
        def report(**params):
            response = self.client.get('/api/dashboard', params=params)
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        september = report(month='2026-09')
        august = report(month='2026-08')
        self.assertEqual(september['period_start'], '2026-09-01')
        self.assertEqual(september['as_of'], '2026-09-30')
        self.assertEqual(len(september['trend']), 30)
        self.assertEqual(len(september['previous_trend']), 31)
        self.assertEqual(september['previous_trend'], august['trend'])
        for month, days, previous_end in [('2024-02', 29, '2024-01-31'), ('2026-01', 31, '2025-12-31'), ('2026-02', 28, '2026-01-31')]:
            empty = report(month=month)
            self.assertEqual(len(empty['trend']), days)
            self.assertEqual(empty['previous_as_of'], previous_end)
            self.assertEqual(empty['orders'], [])
            self.assertEqual(sum(r['booked'] for r in empty['trend']), 0)
        combined = report(date_from='2026-08-01', date_to='2026-09-30')
        for key, field in [('orders', 'order_date'), ('shipments', 'shipped_at'), ('payments', 'paid_at'), ('claims', 'opened_at')]:
            self.assertEqual(len(combined[key]), len(august[key]) + len(september[key]), key)
            self.assertTrue(all('2026-08-01' <= r[field] <= '2026-09-30' for r in combined[key]))
        day = report(date_from='2026-09-06', date_to='2026-09-06')
        self.assertTrue(all(r['shipped_at'] == '2026-09-06' for r in day['shipments']))
        self.assertTrue(all(r['order_date'] == '2026-09-06' for r in day['orders']))
        related = next(o for o in day['related_orders'] if o['order_id'] == 102)
        self.assertEqual(related['fulfillment_status'], 'shipped')
        self.assertTrue(any(r['order_id'] == 102 for r in day['order_bom']))
        self.assertEqual(sum(r['amount'] for r in day['shipments']), sum(r['shipped'] for r in day['trend']))
        claim_day = report(date_from='2026-09-07', date_to='2026-09-07')
        claim = next(c for c in claim_day['claims'] if c['order_id'] == 102)
        self.assertIsNone(claim['returned_at'])  # September 9 is not yet visible.
        for params in [dict(month='2026-13'), dict(month='2026-9'), dict(month=''),
                       dict(date_from='2026-09-12'), dict(date_to='2026-09-12'),
                       dict(date_from='2026-09-12', date_to='2026-09-01'),
                       dict(date_from='2025-01-01', date_to='2026-09-01'),
                       dict(month='2026-09', date='2026-09-12'),
                       dict(month='2026-09', date_from='2026-09-01', date_to='2026-09-02')]:
            self.assertEqual(self.client.get('/api/dashboard', params=params).status_code, 400, params)

    def test_actuals_stop_at_today(self) -> None:
        with patch('server.business_today', return_value=date(2026, 9, 12)):
            current = self.client.get('/api/dashboard?month=2026-09').json()
            self.assertEqual(current['today'], '2026-09-12')
            self.assertEqual(current['period_end'], '2026-09-30')
            self.assertEqual(current['as_of'], '2026-09-12')
            self.assertEqual(current['previous_as_of'], '2026-08-12')
            self.assertEqual(len(current['trend']), 12)
            self.assertEqual(len(current['previous_trend']), 12)
            self.assertEqual(len(current['previous_full_trend']), 31)
            self.assertEqual(current['previous_full_trend'][-1]['day'], '2026-08-31')
            self.assertEqual(sum(r['shipped'] for r in current['previous_full_trend']), 245000)
            self.assertEqual(sum(r['amount'] for r in current['shipments']), 161000)
            self.assertEqual(sum(r['amount'] for r in current['payments']), 182500)
            self.assertEqual(sum(r['shipped'] for r in current['previous_trend']), 117500)
            journal = self.client.get('/api/dashboard?date_from=2026-09-01&date_to=2026-09-30').json()
            self.assertEqual(journal['shipments'], current['shipments'])
            for key, field in [('orders', 'order_date'), ('shipments', 'shipped_at'), ('payments', 'paid_at'), ('claims', 'opened_at')]:
                self.assertTrue(all(r[field] <= '2026-09-12' for r in current[key]))
            future = self.client.get('/api/dashboard?month=2026-10').json()
            for key in ['trend', 'previous_trend', 'orders', 'shipments', 'payments', 'claims']:
                self.assertEqual(future[key], [], key)
            past = self.client.get('/api/dashboard?month=2026-08').json()
            self.assertEqual(len(past['trend']), 31)
            self.assertEqual(past['as_of'], '2026-08-31')
        with patch('server.business_today', return_value=date(2026, 9, 13)):
            next_day = self.client.get('/api/dashboard?month=2026-09').json()
            self.assertEqual(len(next_day['trend']), 13)
            self.assertEqual(next_day['previous_as_of'], '2026-08-13')

    def test_projects_progress_dependencies_and_history(self) -> None:
        report = self.client.get('/api/dashboard').json()
        projects = {p['project_id']: p for p in report['projects']}
        self.assertEqual(set(projects), {1, 2, 3})
        self.assertEqual([projects[i]['progress'] for i in (1, 2, 3)], [25, 10, 100])
        self.assertEqual([projects[i]['project_status'] for i in (1, 2, 3)], ['risk', 'active', 'done'])
        self.assertEqual(projects[1]['stages'][2]['stage_status'], 'blocked')
        self.assertEqual(projects[1]['stages'][3]['stage_status'], 'waiting')
        order_ids = {o['order_id'] for o in report['orders'] + report['related_orders']}
        for project in projects.values():
            self.assertIn(project['order_id'], order_ids)
            self.assertEqual(sum(s['weight'] for s in project['stages']), 100)
            self.assertEqual(len(project['stages']), 6)
            self.assertTrue(all(s['depends_on'] is None or s['depends_on'] < s['stage_no'] for s in project['stages']))
        earlier = self.client.get('/api/dashboard?date=2026-09-10').json()['projects']
        self.assertEqual(len(earlier), 2)
        first = next(p for p in earlier if p['project_id'] == 1)
        self.assertEqual(first['forecast_at'], first['deadline'])
        self.assertEqual(first['project_status'], 'active')
        self.assertEqual(first['stages'][2]['stage_status'], 'active')
        self.assertIsNone(first['stages'][2]['block_reason'])
        start = self.client.get('/api/dashboard?date=2026-09-01').json()['projects']
        self.assertEqual(len(start), 1)
        self.assertEqual(start[0]['progress'], 25)
        self.assertIsNone(start[0]['completed_at'])
        self.assertTrue(all(s['completed_at'] is None for s in start[0]['stages'][2:]))
        with patch('server.business_today', return_value=date(2026, 10, 1)):
            carried = self.client.get('/api/dashboard?month=2026-10').json()
            self.assertEqual({p['project_id'] for p in carried['projects']}, {1, 2})
            self.assertTrue(all(p['order_id'] in {o['order_id'] for o in carried['related_orders']} for p in carried['projects']))
        self.assertEqual(self.client.get('/api/dashboard?month=2026-07').json()['projects'], [])
        with app.state.pool.connection() as conn:
            for table in ('projects', 'project_stages'):
                self.assertFalse(conn.execute("SELECT has_table_privilege(current_user, %s, 'UPDATE') AS allowed", (table,)).fetchone()['allowed'])

    def test_september_14_activity_reconciles(self) -> None:
        with patch('server.business_today', return_value=date(2026, 9, 14)):
            daily = self.client.get('/api/dashboard?date_from=2026-09-14&date_to=2026-09-14').json()
            self.assertEqual({o['order_id'] for o in daily['orders']}, {113, 114, 115, 116})
            for collection, field, expected in [('orders', 'booked', 92000),
                                               ('shipments', 'shipped', 59500),
                                               ('payments', 'paid', 50000)]:
                self.assertEqual(sum(r['amount'] for r in daily[collection]), expected)
                self.assertEqual(daily['trend'][0][field], expected)
            report = self.client.get('/api/dashboard?month=2026-09').json()
            orders = {o['order_id']: o for o in report['orders']}
            self.assertEqual(len(orders), 16)
            self.assertEqual(report['trend'][-1]['day'], '2026-09-14')
            for order_id in (105, 106, 109, 110, 113):
                self.assertEqual(orders[order_id]['fulfillment_status'], 'shipped')
                self.assertEqual(orders[order_id]['remaining_qty'], 0)
            self.assertEqual(orders[114]['shipped_amount'], 12000)
            self.assertEqual(orders[114]['payment_status'], 'partial')
            self.assertEqual(orders[115]['shipped_amount'], 0)
            self.assertEqual(orders[116]['payment_status'], 'unpaid')
            self.assertEqual(orders[113]['first_order_date'], '2026-09-14')
            self.assertTrue(all(i['shipped_qty'] <= i['quantity'] for o in orders.values() for i in o['items']))
            for collection, field in [('shipments', 'shipped'), ('payments', 'paid')]:
                self.assertEqual(sum(r['amount'] for r in report[collection]),
                                 sum(r[field] for r in report['trend']))

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
        self.assertEqual(len(recovered['tables']), 13)
        self.assertEqual(self.client.get('/api/dashboard').status_code, 200)


if __name__ == '__main__':
    unittest.main()
