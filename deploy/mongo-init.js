// Executed by the official Mongo image on first initialization only.
const reports = db.getSiblingDB('quality');
reports.createUser({user:'dashboard',pwd:process.env.MONGO_READER_PASSWORD,roles:[{role:'read',db:'quality'}]});
reports.createCollection('protocols', {validator: {$jsonSchema: {bsonType:'object',required:['_id','order_id','serial','tested_at','result','measurements'],properties:{order_id:{bsonType:'int'},serial:{bsonType:'string'},tested_at:{bsonType:'date'},result:{enum:['passed','failed']},measurements:{bsonType:'array'}}}}});
reports.protocols.createIndex({order_id:1, tested_at:-1});
reports.protocols.createIndex({serial:1, tested_at:-1});
const examples = [
 ['QA-101-1',101,'TC100-001','2026-09-03T08:00:00Z','passed','thermal',23.1,0.2],
 ['QA-102-1',102,'TC200-001','2026-09-05T09:00:00Z','passed','thermal',22.9,0.3],
 ['QA-102-2',102,'TC200-001','2026-09-09T10:00:00Z','failed','power',19.2,1.7],
 ['QA-102-3',102,'TC200-001','2026-09-11T10:00:00Z','passed','power',24.0,0.1],
 ['QA-104-1',104,'TH20-001','2026-09-07T11:00:00Z','failed','thermal',29.0,2.1],
 ['QA-108-1',108,'CL10-001','2026-09-10T10:00:00Z','passed','cooling',20.1,0.2],
 ['QA-111-1',111,'TC300-001','2026-09-11T08:00:00Z','passed','thermal',23.0,0.1]
];
reports.protocols.insertMany(examples.map(([id,order,serial,at,result,method,value,drift])=>({
 _id:id,order_id:NumberInt(order),serial,tested_at:new Date(at),result,method,method_version:'1.0',operator:'Demo QA',
 configuration_version:id==='QA-102-3'?'2':'1',
 measurements:method==='power'?[{name:'voltage',value,unit:'V',min:23,max:25},{name:'ripple',value:drift,unit:'V',max:0.5}]:[{name:'temperature',value,unit:'°C',min:18,max:25},{name:'drift',value:drift,unit:'°C',max:0.5}],
 notes:id==='QA-102-3'?'Retest after replacement; demo protocol, not a shipping instruction':'Synthetic test protocol'
})));
