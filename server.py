"""Manufacturing analytics API with pooled, read-only PostgreSQL access."""
import logging
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
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
    for name in ('orders', 'trend', 'supply', 'shipments', 'payments', 'order_bom', 'claims', 'projects')
}
def business_today() -> date:
    return datetime.now(ZoneInfo('Asia/Jerusalem')).date()


INVALID_DATE = 'Проверьте период: начальная дата не позже конечной, не более 366 дней.'


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
def dashboard(request: Request,
              as_of: Annotated[date | None, Query(alias='date', description='Legacy inclusive snapshot date.')] = None,
              month: Annotated[str | None, Query(pattern=r'^20[0-9]{2}-(0[1-9]|1[0-2])$', description='Calendar month, YYYY-MM; actuals stop at today in Israel.')] = None,
              date_from: Annotated[date | None, Query(description='Journal start, inclusive.')] = None,
              date_to: Annotated[date | None, Query(description='Journal end, inclusive.')] = None) -> JSONResponse:
    """Calendar-month dashboard or inclusive journal range; no future actuals."""
    if ((date_from is None) != (date_to is None)
            or (month is not None and (as_of is not None or date_from is not None))
            or (as_of is not None and date_from is not None)):
        return json_response({'error': INVALID_DATE}, 400)
    if month:
        start = date.fromisoformat(month + '-01')
        as_of = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    elif date_from is not None:
        start, as_of = date_from, date_to
    else:
        as_of = as_of or date(2026, 9, 12)
        start = as_of.replace(day=1)
    if not (date(2000, 1, 1) <= start <= as_of <= date(2099, 12, 31)) or (as_of - start).days > 365:
        return json_response({'error': INVALID_DATE}, 400)
    requested_end = as_of
    today = business_today()
    as_of = min(as_of, today)
    previous_end = start.replace(day=1) - timedelta(days=1)
    if as_of < start:
        # A future reporting period has no actual or comparable elapsed days.
        previous_as_of = previous_end.replace(day=1) - timedelta(days=1)
    elif (month and as_of < requested_end) or (not month and not date_from):
        previous_as_of = previous_end.replace(day=min(as_of.day, previous_end.day))
    else:
        previous_as_of = previous_end
    params = {'period_start': start, 'as_of': as_of}
    try:
        with request.app.state.pool.connection() as conn:
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            conn.execute("SET LOCAL statement_timeout = '5s'")
            data: dict[str, Any] = {name: conn.execute(sql, params).fetchall()
                                    for name, sql in QUERIES.items()}
            data['previous_trend'] = conn.execute(QUERIES['trend'], {
                'period_start': previous_end.replace(day=1), 'as_of': previous_as_of}).fetchall()
            # Full historical series for the chart; matched-period series above is for KPI comparisons.
            previous_chart_end = min(previous_end, today)
            data['previous_full_trend'] = data['previous_trend'] if previous_chart_end == previous_as_of else conn.execute(
                QUERIES['trend'], {'period_start': previous_end.replace(day=1), 'as_of': previous_chart_end}).fetchall()
            # Journal documents may belong to an order created before the chosen range.
            related_ids = {r['order_id'] for name in ('shipments', 'payments', 'claims', 'projects') for r in data[name]}
            related_ids.update(o['order_id'] for c in data['supply'] for o in c['orders'])
            all_orders = conn.execute(QUERIES['orders'], {'period_start': date(2000, 1, 1), 'as_of': as_of}).fetchall()
            data['related_orders'] = [o for o in all_orders if o['order_id'] in related_ids]
            data['detail_claims'] = conn.execute(QUERIES['claims'], {'period_start': date(2000, 1, 1), 'as_of': as_of}).fetchall()
        data.update(as_of=as_of, period_start=start, period_end=requested_end, today=today, report_month=start.strftime('%Y-%m'), fetched_at=datetime.now(timezone.utc), monthly_plan=240000,
                    previous_as_of=previous_as_of, previous_month=previous_end.strftime('%Y-%m'), previous_monthly_plan=240000,
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
