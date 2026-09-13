"""Public read-only operational evidence; no admin credentials or Docker access."""
import json
import os
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient
from pymongo.errors import PyMongoError


def mongo_client() -> MongoClient | None:
    password = os.getenv('MONGO_READER_PASSWORD')
    return MongoClient(os.getenv('MONGO_HOST', 'mongo'), username='dashboard', password=password,
                       authSource='quality', serverSelectionTimeoutMS=1500, connectTimeoutMS=1500,
                       socketTimeoutMS=2000, maxPoolSize=3) if password else None


def protocols(client: MongoClient | None, order_id: int | None, as_of: date) -> dict[str, Any]:
    if client is None:
        return {'status':'not_configured','rows':[]}
    try:
        query: dict[str, Any] = {'tested_at': {'$lte': datetime.combine(as_of, time.max, timezone.utc)}}
        if order_id is not None:
            query['order_id'] = order_id
        rows = list(client.quality.protocols.find(query).sort([('tested_at',-1),('_id',-1)]).limit(100))
        return {'status':'ok','rows':rows}
    except PyMongoError:
        return {'status':'unavailable','rows':[]}


def backup_status() -> dict[str, Any]:
    try:
        value = json.loads(Path(os.getenv('OPS_STATUS_FILE','/app/ops-status/status.json')).read_text())
        stamp = datetime.fromisoformat(value['checked_at'])
        value['stale'] = (datetime.now(timezone.utc)-stamp).total_seconds() > 900
        return value
    except (OSError, ValueError, KeyError, TypeError):
        return {'status':'not_configured','stale':True,'jobs':{},'external':'disabled'}


def audit_rows(pool: Any, order_id: int | None = None, entity: str | None = None) -> list[dict[str, Any]]:
    with pool.connection() as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        conn.execute("SET LOCAL statement_timeout = '2s'")
        return conn.execute('''SELECT event_id,changed_at,transaction_id,entity,order_id,action,
            before_data,after_data,actor,reason,approved_by,database_user FROM audit.events
            WHERE (%(order)s::int IS NULL OR order_id=%(order)s)
              AND (%(entity)s::text IS NULL OR entity=%(entity)s)
            ORDER BY event_id DESC LIMIT 100''',{'order':order_id,'entity':entity}).fetchall()
