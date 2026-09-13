#!/usr/bin/env python3
"""Single-host backup/restore lab. Run as root via SSH or /etc/cron.d.

No web-triggered jobs, external destination, or writes to business orders.
Recovery containers have no network and are removed after verification.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess as sp
import tarfile
import time
import uuid

BASE = Path('/opt/manufacturing-demo')
OPS = BASE/'ops'
DB = 'manufacturing-demo-db-1'
MONGO = 'manufacturing-demo-mongo-1'
PG_IMAGE = 'postgres:17-alpine'
CONTROL = """SELECT json_build_object(
 'orders',(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY order_id)) FROM public.orders t),
 'items',(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY order_item_id)) FROM public.order_items t),
 'shipments',(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY shipment_id)) FROM public.shipments t),
 'payments',(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY payment_id)) FROM public.payments t),
 'audit_count',(SELECT count(*) FROM audit.events),
 'order_count',(SELECT count(*) FROM public.orders));"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(*args: str, input: bytes | None = None, timeout: int = 600) -> bytes:
    result = sp.run(args,input=input,stdout=sp.PIPE,stderr=sp.PIPE,timeout=timeout)
    if result.returncode:
        # No command/env/stderr in public receipts; detailed error only in root-owned cron log.
        raise RuntimeError(result.stderr.decode(errors='replace')[-2000:])
    return result.stdout


def sql(statement: str, container: str = DB) -> str:
    return run('docker','exec','-i',container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','lab','-d','manufacturing_lab',input=statement.encode()).decode().strip()


def save(path: Path, value: dict, mode: int = 0o600) -> None:
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value,indent=2))
    temporary.chmod(mode)
    temporary.replace(path)


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def digest(path: Path) -> str:
    with path.open('rb') as handle:
        return hashlib.file_digest(handle,'sha256').hexdigest()


def output(path: Path, *args: str) -> None:
    with path.open('wb') as handle:
        proc = sp.run(args,stdout=handle,stderr=sp.PIPE,timeout=600)
    if proc.returncode:
        raise RuntimeError(proc.stderr.decode(errors='replace')[-2000:])
    if path.stat().st_size == 0:
        raise RuntimeError('Empty backup')


def mongo_dump(path: Path) -> None:
    output(path,'docker','exec',MONGO,'sh','-c',
           'exec mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db quality --archive --gzip --quiet')


def backup() -> dict:
    name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = OPS/'logical'/name
    target.mkdir()
    # Keep a transaction open so the dump and control values share the SAME snapshot.
    command = ['docker','exec','-i',DB,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','lab','-d','manufacturing_lab']
    with (target/'snapshot.log').open('wb') as errors:
        session = sp.Popen(command,stdin=sp.PIPE,stdout=sp.PIPE,stderr=errors)
        try:
            session.stdin.write(b'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n')
            session.stdin.flush()
            snapshot = session.stdout.readline().decode().strip()
            if not re.fullmatch(r'[0-9A-F]+-[0-9A-F]+-[0-9]+',snapshot):
                raise RuntimeError('Could not export snapshot')
            session.stdin.write((CONTROL+'\n').encode()); session.stdin.flush()
            control = json.loads(session.stdout.readline())
            output(target/'database.dump','docker','exec',DB,'pg_dump','-U','lab','-d','manufacturing_lab','-Fc','--snapshot='+snapshot)
            session.stdin.write(b'COMMIT;\n');session.stdin.flush()
        finally:
            session.communicate(timeout=30)
            if session.returncode:
                raise RuntimeError('Snapshot session failed')
    output(target/'roles.sql','docker','exec',DB,'pg_dumpall','-U','lab','--globals-only')
    mongo_dump(target/'quality.archive.gz')
    # Current quality data is immutable after initialization. This is NOT a cross-DB transaction.
    mongo_control = run('docker','exec',MONGO,'mongosh','--quiet','--eval',
        'const a=db.getSiblingDB("admin");a.auth(process.env.MONGO_INITDB_ROOT_USERNAME,process.env.MONGO_INITDB_ROOT_PASSWORD);print(JSON.stringify(db.getSiblingDB("quality").protocols.find().sort({_id:1}).toArray()));').strip()
    control['mongo_hash'] = hashlib.sha256(mongo_control).hexdigest()
    with tarfile.open(target/'config.tar.gz','w:gz') as archive:
        for path in [BASE/'.env.demo',BASE/'compose.demo.yaml',BASE/'compose.https.yaml',BASE/'compose.release.json',BASE/'deploy',Path('/etc/cron.d/manufacturing-demo-ops'),Path('/etc/logrotate.d/manufacturing-demo-ops'),Path('/etc/letsencrypt')]:
            if path.exists():
                archive.add(path,arcname=str(path).lstrip('/'))
    files = {p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in target.iterdir() if p.is_file()}
    result = {'id':name,'created_at':now(),'control':control,'files':files}
    save(target/'manifest.json',result)
    prune_logical()
    return {'backup_id':name,'bytes':sum(f['bytes'] for f in files.values()),'verified_checksum':True,'external':'disabled'}


def complete(root: str) -> list[Path]:
    return sorted(p.parent for p in (OPS/root).glob('*/manifest.json'))


def prune_logical() -> None:
    items = complete('logical')
    # Keep newest 24 hourly snapshots, plus newest snapshot on each of 7 distinct days.
    daily = {p.name[:8]:p for p in items}
    keep = set(items[-24:]) | set(list(daily.values())[-7:])
    for path in items:
        if path not in keep:
            shutil.rmtree(path)


def base_backup() -> dict:
    name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = OPS/'physical'/name
    target.mkdir()
    temp = '/tmp/ops-base-'+uuid.uuid4().hex
    try:
        run('docker','exec','-u','postgres',DB,'pg_basebackup','-U','lab','-D',temp,'-Ft','-z','-X','stream','-c','fast',timeout=600)
        run('docker','cp',DB+':'+temp+'/.',str(target))
    finally:
        run('docker','exec',DB,'rm','-rf',temp)
    with tarfile.open(target/'base.tar.gz') as archive:
        label = archive.extractfile('backup_label').read().decode()
    first_wal = re.search(r'file ([0-9A-F]{24})',label).group(1)
    files = {p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in target.iterdir() if p.is_file()}
    save(target/'manifest.json',{'created_at':now(),'first_wal':first_wal,'files':files})
    # Retain three physical bases and all WAL needed since the oldest retained base.
    items = complete('physical')
    for path in items[:-3]:
        shutil.rmtree(path)
    oldest = load(complete('physical')[0]/'manifest.json')['first_wal']
    for path in (OPS/'wal').iterdir():
        if re.fullmatch(r'[0-9A-F]{24}\.gz',path.name) and path.name[:8]==oldest[:8] and path.name[:24]<oldest:
            path.unlink()
    return {'backup_id':name,'bytes':sum(f['bytes'] for f in files.values()),'first_wal':first_wal}


def checked_backup(kind: str) -> Path:
    items = complete(kind)
    if not items:
        raise RuntimeError('No completed '+kind+' backup')
    path = items[-1]
    for name,meta in load(path/'manifest.json')['files'].items():
        if digest(path/name)!=meta['sha256']:
            raise RuntimeError('Backup checksum mismatch')
    return path


@contextmanager
def recovery_container(image: str, name: str, args: list[str]):
    # Scope is only random, disposable ops-check containers and their anonymous volumes.
    if not name.startswith('ops-check-'):
        raise ValueError('Invalid recovery container')
    try:
        run('docker','run','-d','--name',name,'--network','none','--memory','512m',*args,image)
        yield name
    finally:
        run('docker','rm','-fv',name)


def wait_pg(name: str) -> None:
    deadline = time.monotonic()+90
    while time.monotonic()<deadline:
        try:
            if sql('SELECT 1;',name)=='1':return
        except RuntimeError:
            pass
        time.sleep(1)
    raise RuntimeError('Recovery PostgreSQL did not start')


def restore_check() -> dict:
    source = checked_backup('logical')
    expected = load(source/'manifest.json')['control']
    name = 'ops-check-logical-'+uuid.uuid4().hex[:10]
    with recovery_container(PG_IMAGE,name,['-e','POSTGRES_USER=lab','-e','POSTGRES_DB=manufacturing_lab','-e','POSTGRES_HOST_AUTH_METHOD=trust','-v',str(source)+':/backup:ro']):
        wait_pg(name)
        sql('CREATE ROLE dashboard;',name)
        run('docker','exec',name,'pg_restore','-U','lab','-d','manufacturing_lab','--no-owner','--exit-on-error','/backup/database.dump')
        actual = json.loads(sql(CONTROL,name))
        if actual!={k:v for k,v in expected.items() if k!='mongo_hash'}:
            raise RuntimeError('Restored PostgreSQL controls differ')
    name = 'ops-check-mongo-'+uuid.uuid4().hex[:10]
    with recovery_container('mongo:7.0',name,['-v',str(source)+':/backup:ro']):
        deadline = time.monotonic()+90
        while True:
            try:
                run('docker','exec',name,'mongosh','--quiet','--eval','db.adminCommand({ping:1})');break
            except RuntimeError:
                if time.monotonic()>deadline:raise
                time.sleep(1)
        run('docker','exec',name,'mongorestore','--archive=/backup/quality.archive.gz','--gzip','--stopOnError','--quiet')
        raw = run('docker','exec',name,'mongosh','--quiet','--eval','print(JSON.stringify(db.getSiblingDB("quality").protocols.find().sort({_id:1}).toArray()));').strip()
        if hashlib.sha256(raw).hexdigest()!=expected['mongo_hash']:
            raise RuntimeError('Restored MongoDB documents differ')
    return {'backup_id':source.name,'postgres':'verified','mongo':'verified','order_count':actual['order_count']}


def pitr_check() -> dict:
    source = checked_backup('physical')
    marker = 'demo_'+uuid.uuid4().hex
    point = 'restore_'+uuid.uuid4().hex
    # Only a dedicated probe is modified; financial/business rows remain untouched.
    sql("INSERT INTO operations.restore_probe VALUES(1,'"+marker+"') ON CONFLICT(id) DO UPDATE SET value=excluded.value;")
    expected = json.loads(sql(CONTROL))
    sql("SELECT pg_create_restore_point('"+point+"');")
    sql("UPDATE operations.restore_probe SET value='after_"+marker+"' WHERE id=1;")
    last_wal = sql('SELECT pg_walfile_name(pg_current_wal_lsn());')
    sql('SELECT pg_switch_wal();')
    deadline = time.monotonic()+90
    while not (OPS/'wal'/(last_wal+'.gz')).is_file():
        if time.monotonic()>deadline:raise RuntimeError('WAL archiving timed out')
        time.sleep(1)
    name = 'ops-check-pitr-'+uuid.uuid4().hex[:10]
    # Prepare only a new disposable volume, never the primary data directory.
    volume = name+'-data'
    run('docker','volume','create',volume)
    try:
        run('docker','run','--rm','--network','none','--entrypoint','sh','-v',volume+':/restore','-v',str(source)+':/backup:ro',PG_IMAGE,'-c',
            'tar -xzf /backup/base.tar.gz -C /restore && tar -xzf /backup/pg_wal.tar.gz -C /restore/pg_wal && chown -R postgres:postgres /restore && chmod 700 /restore')
        config = "\nrestore_command = 'gzip -dc /wal/%f.gz > %p'\nrecovery_target_name = '"+point+"'\nrecovery_target_action = 'promote'\narchive_mode = 'off'\n"
        run('docker','run','--rm','-i','--network','none','--entrypoint','sh','-v',volume+':/restore',PG_IMAGE,'-c','cat >> /restore/postgresql.auto.conf; touch /restore/recovery.signal; chown postgres:postgres /restore/recovery.signal',input=config.encode())
        with recovery_container(PG_IMAGE,name,['-v',volume+':/var/lib/postgresql/data','-v',str(OPS/'wal')+':/wal:ro']):
            wait_pg(name)
            # May accept read-only queries before target: wait for promotion explicitly.
            deadline = time.monotonic()+90
            while sql('SELECT pg_is_in_recovery();',name)!='f':
                if time.monotonic()>deadline:raise RuntimeError('PITR target not reached')
                time.sleep(1)
            if sql('SELECT value FROM operations.restore_probe WHERE id=1;',name)!=marker:
                raise RuntimeError('PITR did not stop before the subsequent change')
            if json.loads(sql(CONTROL,name))!=expected:
                raise RuntimeError('PITR business controls differ')
            if sql('SELECT value FROM operations.restore_probe WHERE id=1;')!='after_'+marker:
                raise RuntimeError('Primary probe unexpectedly changed')
    finally:
        run('docker','volume','rm',volume)
    return {'backup_id':source.name,'target':point,'before_change_restored':True,'primary_unchanged':True}


def demo_audit() -> dict:
    result = sql("""BEGIN;
      SELECT set_config('app.actor','Demo operator',true),set_config('app.reason','Supplier delay / demonstration',true),set_config('app.approved_by','Demo director',true);
      UPDATE operations.demo_orders SET due_date=due_date+1 WHERE order_id=108;
      COMMIT;
      SELECT max(event_id) FROM audit.events;""")
    return {'order_id':108,'event_id':int(result.splitlines()[-1]),'scope':'operations.demo_orders'}


def publish(jobs: dict) -> None:
    disk = shutil.disk_usage(OPS)
    try:
        wal = json.loads(sql("SELECT json_build_object('mode',current_setting('archive_mode'),'archived_count',archived_count,'failed_count',failed_count,'last_archived_at',last_archived_time,'last_failed_at',last_failed_time) FROM pg_stat_archiver;"))
    except RuntimeError:
        wal = {'mode':'unavailable'}
    wal['bytes'] = sum(p.stat().st_size for p in (OPS/'wal').iterdir() if p.is_file())
    alert = disk.free<2*1024**3 or wal['bytes']>4*1024**3 or any(j.get('status')=='failed' for j in jobs.values())
    archived=wal.get('last_archived_at');failed=wal.get('last_failed_at')
    alert = alert or wal.get('mode')!='on' or bool(failed and (not archived or failed>archived))
    backup_at=jobs.get('backup',{}).get('last_success')
    alert = alert or not backup_at or (datetime.now(timezone.utc)-datetime.fromisoformat(backup_at)).total_seconds()>7200
    save(OPS/'public/status.json',{'status':'warning' if alert else 'ok','checked_at':now(),'jobs':jobs,'wal':wal,
         'external':'disabled','storage_scope':'single_server','free_bytes':disk.free,
         'logical_count':len(complete('logical')),'physical_count':len(complete('physical')),
         'schedule_timezone':'UTC'},0o644)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job',choices=['backup','base','restore','pitr','audit-demo','status'])
    args = parser.parse_args()
    if os.geteuid()!=0:raise SystemExit('Run as root on the demo server')
    os.umask(0o077)
    for name in ['logical','physical','public']:(OPS/name).mkdir(parents=True,exist_ok=True)
    (OPS/'public').chmod(0o755)
    with (OPS/'job.lock').open('w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(now(),'Another maintenance job is active; skipped.',flush=True);return
        path = OPS/'jobs.json'
        jobs = load(path) if path.exists() else {}
        if args.job=='status':publish(jobs);return
        started = time.monotonic()
        receipt = jobs.setdefault(args.job,{})
        receipt.update(last_attempt=now(),status='running')
        save(path,jobs);publish(jobs)
        try:
            if shutil.disk_usage(OPS).free<2*1024**3:raise RuntimeError('Less than 2 GiB free; maintenance deferred')
            result = {'backup':backup,'base':base_backup,'restore':restore_check,'pitr':pitr_check,'audit-demo':demo_audit}[args.job]()
            receipt.update(status='ok',last_success=now(),result=result)
        except Exception:
            receipt['status']='failed'
            raise
        finally:
            receipt['duration_seconds']=round(time.monotonic()-started,2)
            save(path,jobs);publish(jobs)
            print(now(),args.job,receipt['status'],flush=True)


if __name__=='__main__':
    main()
