const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const root=path.join(__dirname,'..');
const ctx=vm.createContext({console,Intl,Date,Set,Map,WeakMap,localStorage:{getItem:()=>null,setItem(){}},document:{documentElement:{dataset:{}},querySelector:()=>({addEventListener(){}})}});
for(const file of ['i18n.js','ux.js','app.js']){
 let source=fs.readFileSync(path.join(root,'dist',file),'utf8');
 if(file==='app.js')source=source.slice(0,source.indexOf("$('#refresh').addEventListener"));
 vm.runInContext(source,ctx);
}
const run=s=>vm.runInContext(s,ctx);
run(`data={as_of:'2026-09-12',claims:[
 {claim_id:1,order_id:101,customer:'Customer',product:'Product',sku:'SKU',manager:'Анна',opened_at:'2026-09-05',reason:'transit_damage',quantity:1,goods_value:12000,claim_status:'closed',returned_at:'2026-09-07',closed_at:'2026-09-10',resolution:'replacement'},
 {claim_id:2,order_id:102,customer:'Customer',product:'Product',sku:'SKU',manager:'Анна',opened_at:'2026-09-07',reason:'power_on_failure',quantity:1,goods_value:18000,claim_status:'returned',returned_at:'2026-09-09',closed_at:null,resolution:null},
 {claim_id:3,order_id:101,customer:'Customer',product:'Product',sku:'SKU',manager:'Анна',opened_at:'2026-09-06',reason:'incomplete',quantity:1,goods_value:1500,claim_status:'closed',returned_at:null,closed_at:'2026-09-08',resolution:'missing_parts'},
 {claim_id:4,order_id:103,customer:'Customer',product:'Product',sku:'SKU',manager:'Анна',opened_at:'2026-09-11',reason:'spec_mismatch',quantity:1,goods_value:6000,claim_status:'returned',returned_at:'2026-09-12',closed_at:null,resolution:null},
 {claim_id:5,order_id:105,customer:'Customer',product:'Product',sku:'SKU',manager:'Анна',opened_at:'2026-09-12',reason:'transit_damage',quantity:1,goods_value:4500,claim_status:'review',returned_at:null,closed_at:null,resolution:null}
]};page='sales';`);
for(const [key,count] of Object.entries({claims:5,'claims-open':3,'claims-returned':3,'claims-closed':2,'claim-transit_damage':2,'claim-incomplete':1,'claim-power_on_failure':1,'claim-spec_mismatch':1})){
 assert(run(`isList('sales','${key}')`));assert.equal(run(`getList('${key}').rows.length`),count);
 const html=run(`renderList('${key}')`);assert.equal((html.match(/data-order=/g)||[]).length,count);
 assert(!html.includes('undefined'));
}
for(const lang of ['ru','en','he']){
 run(`settings.language='${lang}'`);
 const html=run('claimsPanel()+renderList("claims")');
 assert(html.includes('data-order="101"'));
 if(lang!=='ru'){
  const translated=html.replace(/>([^<>]+)</g,(_,txt)=>'>'+run(`tr(${JSON.stringify(txt.trim())})`)+'<');
  assert(!/[А-Яа-яЁё]/.test(translated),lang+' claims translation');
 }
}
run('data.claims=[]');assert(run('renderList("claims")').includes('empty-state'));
console.log('PASS: claim filters, order links, translations in three languages, and empty state');
