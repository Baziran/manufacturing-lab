"""One bounded connection pool per application process."""
import logging
import os
from typing import Any

from psycopg import Connection
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def create_pool() -> ConnectionPool[Connection[dict[str, Any]]]:
    logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO').upper(),
                        format='%(asctime)s %(levelname)s %(name)s %(message)s')
    minimum = int(os.getenv('DB_POOL_MIN_SIZE', '1'))
    maximum = int(os.getenv('DB_POOL_MAX_SIZE', '5'))
    timeout = float(os.getenv('DB_POOL_TIMEOUT', '3'))
    if not 0 <= minimum <= maximum or maximum < 1 or timeout <= 0:
        raise ValueError('Invalid database pool limits')
    # Separate parameters also support passwords containing URI-reserved characters.
    conninfo = os.getenv('DATABASE_URL') or make_conninfo(
        host=os.getenv('DB_HOST', 'db'), port=os.getenv('DB_PORT', '5432'),
        dbname=os.getenv('DB_NAME', 'manufacturing_lab'),
        user=os.getenv('DB_USER', 'dashboard'), password=os.environ['DB_PASSWORD'])
    return ConnectionPool(conninfo, kwargs={'row_factory': dict_row, 'connect_timeout': 3,
                          'application_name': 'manufacturing-dashboard'},
                          min_size=minimum, max_size=maximum, timeout=timeout,
                          max_waiting=20, open=False, check=ConnectionPool.check_connection,
                          name='manufacturing-dashboard')
