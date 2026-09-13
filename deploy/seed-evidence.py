#!/usr/bin/env python3
"""Idempotent synthetic protocols + trigger-generated history. Run on demo VPS."""
from datetime import date, datetime, time, timezone, timedelta
import fcntl
import json
import os
from pathlib import Path
import random
import ops

# Parameter, unit, nominal, min, max. Methods match the order's first product.
SPECS = {
 'TC-100':('thermal',[('temperature','°C',23,18,25),('drift','°C',.2,0,.5)]),
 'TC-200':('thermal',[('temperature','°C',23,18,25),('drift','°C',.2,0,.5)]),
 'TC-300':('thermal',[('temperature','°C',23,18,25),('drift','°C',.2,0,.5)]),
 'TH-10':('thermal',[('temperature','°C',23,18,25),('drift','°C',.2,0,.5)]),
 'TH-20':('thermal',[('temperature','°C',23,18,25),('drift','°C',.2,0,.5)]),
 'CT-01':('power',[('voltage','V',5,4.75,5.25),('ripple','V',.02,0,.05)]),
 'PS-24':('power',[('voltage','V',24,23,25),('ripple','V',.1,0,.5)]),
 'SN-K':('sensor_calibration',[('offset','°C',.05,-.2,.2)]),
 'CL-10':('cooling',[('temperature','°C',20,18,25),('flow','L/min',2,1.5,2.5)]),
 'FX-01':('dimensional',[('clearance','mm',.15,.1,.2)]),
 'IF-02':('loopback',[('latency','ms',3,0,10)]),
 'ST-01':('kit_inspection',[('parts_count','pcs',12,12,12)])
}

def build_protocols(orders: list[dict]) -> list[dict]:
    rng=random.Random(20260913)
    result=[]
    for order in orders:
        oid=order['order_id'];sku=order['sku'];method,specs=SPECS[sku]
        start=date.fromisoformat(order['order_date'])
        end=min(date(2026,9,13),date.today(),date.fromisoformat(order['first_shipment'] or '2026-09-13'))
        if start>end:continue
        for attempt in (1,2):
            failed=attempt==1 and oid%3==0
            measures=[]
            for index,(name,unit,nominal,low,high) in enumerate(specs):
                value=round(nominal+rng.uniform(-1,1)*(high-low)*.08,3)
                if failed and index==0:value=round(high+max((high-low)*.2,1 if unit=='pcs' else .01),3)
                measures.append(dict(name=name,unit=unit,value=value,min=low,max=high))
            day=start if attempt==1 else end
            stamp=datetime.combine(day,time(8 if attempt==1 else 10,oid%45),timezone.utc)
            result.append(dict(_id=f'QA-{oid}-DEMO-{attempt}',order_id=oid,order_item_id=order['order_item_id'],
                product_sku=sku,serial=f'DEMO-{sku}-{oid}',tested_at=stamp.isoformat(),
                result='failed' if failed else 'passed',method=method,method_version='1.0',
                operator=['Maya (demo)','Daniel (demo)'][(oid+attempt)%2],configuration_version=str(attempt),
                measurements=measures,synthetic=True,seed_batch='09-evidence-examples',
                notes='Synthetic test protocol' if attempt==1 else 'Retest after replacement; demo protocol, not a shipping instruction'))
    for record in result:
        if record["_id"]=="QA-102-DEMO-2":
            record["attachments"]=[{"name":"QA-102-DEMO-2.pdf","url":"/protocols/QA-102-DEMO-2.pdf"}]
    return result

def main() -> None:
    if os.geteuid()!=0:raise SystemExit('Run as root on demo VPS')
    with (ops.OPS/'job.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        before=json.loads(ops.sql(ops.CONTROL))
        orders=json.loads(ops.sql("""SELECT json_agg(t ORDER BY order_id) FROM (
         SELECT o.order_id,o.order_date,i.order_item_id,p.sku,
           (SELECT min(shipped_at) FROM shipments WHERE order_item_id=i.order_item_id) AS first_shipment
         FROM orders o JOIN order_items i ON i.order_id=o.order_id AND i.line_no=1
         JOIN products p USING(product_id) WHERE o.order_id BETWEEN 101 AND 112) t;"""))
        docs=build_protocols(orders)
        # Mongo documents are additive. Repeated runs never overwrite prior protocols.
        js='''const admin=db.getSiblingDB("admin");admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME,process.env.MONGO_INITDB_ROOT_PASSWORD);
const q=db.getSiblingDB("quality");const docs=PAYLOAD;
const result=q.protocols.bulkWrite(docs.map(d=>{d.tested_at=new Date(d.tested_at);d.order_id=NumberInt(d.order_id);d.order_item_id=NumberInt(d.order_item_id);return {updateOne:{filter:{_id:d._id},update:{$setOnInsert:d},upsert:true}}}));
print(JSON.stringify({added:result.upsertedCount,total:q.protocols.countDocuments({})}));'''.replace('PAYLOAD',json.dumps(docs))
        mongo=ops.run('docker','exec','-i',ops.MONGO,'mongosh','--quiet','--file','/dev/stdin',input=js.encode()).decode().strip()
        ops.sql((ops.BASE/'db/migrations/09-evidence-examples.sql').read_text())
        after=json.loads(ops.sql(ops.CONTROL))
        for key in ['orders','items','shipments','payments']:
            if before[key]!=after[key]:raise RuntimeError('Source business data changed: '+key)
        print(mongo)
        print(json.dumps({'audit_events':after['audit_count'],'source_orders_unchanged':True}))

if __name__=='__main__':main()
