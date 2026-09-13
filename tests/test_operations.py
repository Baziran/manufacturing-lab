"""Audit atomicity, access boundaries, and optional service degradation."""
import os
import unittest
from unittest.mock import patch
import psycopg
from fastapi.testclient import TestClient
from server import app
from operations import protocols


class OperationsTests(unittest.TestCase):
    def test_readonly_endpoints(self):
        with TestClient(app) as client:
            app.state.pool.wait(timeout=10)
            response=client.get('/api/audit?order_id=108&entity=operations.demo_orders')
            self.assertEqual(response.status_code,200)
            self.assertTrue(all(r['order_id']==108 for r in response.json()['rows']))
            self.assertEqual(client.get('/api/audit?entity=invalid').status_code,400)
            self.assertEqual(client.post('/api/operations').status_code,405)
            with patch('operations.Path.read_text',side_effect=OSError()):
                status=client.get('/api/operations').json()
                self.assertTrue(status['stale'])
                self.assertEqual(status['external'],'disabled')
            with app.state.pool.connection() as conn:
                for table in ['audit.events','operations.demo_orders']:
                    self.assertFalse(conn.execute('SELECT has_table_privilege(current_user,%s,\'UPDATE\') AS allowed',(table,)).fetchone()['allowed'])

    def test_audit_atomicity_and_required_context(self):
        with psycopg.connect(host=os.getenv('DB_HOST','db'),port=os.getenv('DB_PORT','5432'),dbname='manufacturing_lab',user='lab',password=os.environ['POSTGRES_PASSWORD']) as conn:
            count=conn.execute('SELECT count(*) FROM audit.events').fetchone()[0]
            with self.assertRaises(psycopg.Error):
                with conn.transaction():
                    conn.execute('UPDATE operations.demo_orders SET due_date=due_date+1 WHERE order_id=108')
            try:
                with conn.transaction():
                    conn.execute("SELECT set_config('app.actor','Test actor',true),set_config('app.reason','Atomicity test',true)")
                    conn.execute('UPDATE operations.demo_orders SET due_date=due_date+1 WHERE order_id=108')
                    self.assertEqual(conn.execute('SELECT count(*) FROM audit.events').fetchone()[0],count+1)
                    row=conn.execute('SELECT before_data,after_data FROM audit.events ORDER BY event_id DESC LIMIT 1').fetchone()
                    self.assertNotEqual(row[0]['due_date'],row[1]['due_date'])
                    raise ValueError('simulate failure')
            except ValueError:pass
            self.assertEqual(conn.execute('SELECT count(*) FROM audit.events').fetchone()[0],count)

    def test_mongo_not_configured(self):
        from datetime import date
        self.assertEqual(protocols(None,102,date(2026,9,12)),{'status':'not_configured','rows':[]})
