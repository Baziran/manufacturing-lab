"""Read-only local telemetry; no Docker socket or host filesystem access."""
import logging
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
import psycopg
from typing import Any
from psycopg_pool import ConnectionPool, PoolTimeout, TooManyRequests

ROOT = Path(__file__).parent
HEALTH_QUERIES = {name: (ROOT/'queries'/f'{name}.sql').read_text() for name in ('health_database','health_tables')}
STARTED = time.monotonic()
LOCK = threading.Lock()
logger = logging.getLogger(__name__)
CACHE: dict[str, Any] | None = None
CACHE_AT = 0
PREVIOUS_CPU: tuple[float, float] | None = None


def read_number(path: str) -> int | None:
    try:
        value = Path(path).read_text().strip()
        return int(value) if value != 'max' else None
    except (OSError, ValueError):
        return None


def app_stats() -> dict[str, int | float | None]:
    global PREVIOUS_CPU
    now = time.monotonic()
    cpu = time.process_time()
    cpu_pct = None
    if PREVIOUS_CPU:
        elapsed = now-PREVIOUS_CPU[0]
        if elapsed > 0:
            cpu_pct = round(100*(cpu-PREVIOUS_CPU[1])/elapsed, 2)
    PREVIOUS_CPU = (now,cpu)
    rss = None
    try:
        for line in Path('/proc/self/status').read_text().splitlines():
            if line.startswith('VmRSS:'):
                rss = int(line.split()[1])*1024
    except (OSError,ValueError):
        pass
    memory = read_number('/sys/fs/cgroup/memory.current')
    limit = read_number('/sys/fs/cgroup/memory.max')
    disk = shutil.disk_usage(ROOT)
    return dict(uptime_seconds=round(now-STARTED),cpu_pct=cpu_pct,rss_bytes=rss,
                container_memory_bytes=memory,container_limit_bytes=limit,
                disk_total_bytes=disk.total,disk_used_bytes=disk.used,disk_free_bytes=disk.free,
                threads=threading.active_count())


def collect_health(pool: ConnectionPool[psycopg.Connection[dict[str, Any]]]) -> dict[str, Any]:
    global CACHE,CACHE_AT
    with LOCK:
        if CACHE is not None and time.monotonic()-CACHE_AT < 5:
            return CACHE
        result: dict[str, Any] = dict(checked_at=datetime.now(timezone.utc),app=app_stats(),database=None,tables=[],database_error=None)
        probe = time.monotonic()
        try:
            with pool.connection() as conn:
                conn.execute('SET TRANSACTION READ ONLY')
                conn.execute("SET LOCAL statement_timeout = '2000ms'")
                conn.execute('SELECT 1').fetchone()
                result['probe_ms'] = round((time.monotonic()-probe)*1000,1)
                result['database'] = conn.execute(HEALTH_QUERIES['health_database']).fetchone()
                result['tables'] = conn.execute(HEALTH_QUERIES['health_tables']).fetchall()
        except (psycopg.Error, PoolTimeout, TooManyRequests) as exc:
            logger.warning('Health database request failed: %s', type(exc).__name__)
            result['probe_ms'] = None
            result['database'] = None
            result['tables'] = []
            result['database_error'] = 'database_unavailable'
        result['status'] = 'ok' if result['database'] else 'degraded'
        CACHE = result
        CACHE_AT = time.monotonic()
        return result
