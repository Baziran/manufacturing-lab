"""Manufacturing analytics API with pooled, read-only PostgreSQL access."""
import logging
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, AsyncIterator

import psycopg
from fastapi import FastAPI, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg_pool import PoolTimeout, TooManyRequests
from starlette.concurrency import run_in_threadpool

from database import create_pool
from health import collect_health, HEALTH_QUERIES

ROOT = Path(__file__).parent
logger = logging.getLogger(__name__)
QUERIES: dict[str, str] = {
    name: (ROOT / 'queries' / f'{name}.sql').read_text()
    for name in ('orders', 'trend', 'supply', 'shipments', 'payments', 'order_bom')
}
INVALID_DATE = 'Выберите корректную дату: сентябрь 2026 года.'


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = create_pool()
    app.state.pool = pool
    # Background opening lets /api/health report a database outage.
    pool.open(wait=False)
    logger.info('Application started; database pool min=%s max=%s', pool.min_size, pool.max_size)
    try:
        yield
    finally:
        await run_in_threadpool(pool.close)
        logger.info('Database pool closed')


app = FastAPI(title='Manufacturing Lab API', version='1.0.0', lifespan=lifespan,
              description='Read-only production, sales and supply analytics over synthetic training data.')


def json_response(value: Any, status_code: int = 200) -> JSONResponse:
    # Preserve numeric money values from the original API, not decimal strings.
    return JSONResponse(jsonable_encoder(value, custom_encoder={Decimal: float}),
                        status_code=status_code, headers={'Cache-Control': 'no-store'})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    return json_response({'error': INVALID_DATE}, 400)


@app.get('/api/health', tags=['Infrastructure'])
def health(request: Request) -> JSONResponse:
    """Live process and PostgreSQL metrics; a DB outage is reported as degraded."""
    return json_response(collect_health(request.app.state.pool))


@app.get('/api/queries', tags=['Training'])
def queries() -> JSONResponse:
    """Fixed parameterized SQL used by this training application."""
    return json_response({**QUERIES, **HEALTH_QUERIES})


@app.get('/api/dashboard', tags=['Analytics'], responses={400: {'description': 'Invalid report date'},
                                                        503: {'description': 'Database unavailable'}})
def dashboard(request: Request, as_of: Annotated[date, Query(
        alias='date', ge=date(2026, 9, 1), le=date(2026, 9, 30),
        description='Report date, inclusive; the dataset covers September 2026.')]
        = date(2026, 9, 12)) -> JSONResponse:
    """Sales, orders and supply from one consistent snapshot, with August comparison."""
    try:
        with request.app.state.pool.connection() as conn:
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            conn.execute("SET LOCAL statement_timeout = '5s'")
            data: dict[str, Any] = {name: conn.execute(sql, {'as_of': as_of}).fetchall()
                                    for name, sql in QUERIES.items()}
            previous_end = as_of.replace(day=1) - timedelta(days=1)
            previous_as_of = previous_end.replace(day=min(as_of.day, previous_end.day))
            data['previous_trend'] = conn.execute(QUERIES['trend'], {'as_of': previous_as_of}).fetchall()
        data.update(as_of=as_of, fetched_at=datetime.now(timezone.utc), monthly_plan=240000,
                    previous_as_of=previous_as_of, previous_monthly_plan=240000,
                    source='PostgreSQL', inventory_snapshot='2026-09-12')
        return json_response(data)
    except (psycopg.Error, PoolTimeout, TooManyRequests) as exc:
        logger.warning('Dashboard database request failed: %s', type(exc).__name__)
        return json_response({'error': 'Не удалось прочитать PostgreSQL. Проверьте контейнер базы и повторите обновление.'}, 503)


@app.get('/api/{path:path}', include_in_schema=False)
def unknown_api(path: str) -> JSONResponse:
    return json_response({'error': 'Неизвестный запрос'}, 404)


# API and documentation routes precede the catch-all static mount.
app.mount('/', StaticFiles(directory=ROOT / 'dist', html=True), name='dashboard-ui')
