const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const root=path.join(__dirname,'..');
const ctx=vm.createContext({console,Intl,Date,Set,Map,WeakMap,localStorage:{getItem:()=>null,setItem(){}},document:{documentElement:{dataset:{}},querySelector:()=>({addEventListener(){}})}});
for(const file of ['i18n.js','ux.js','operations.js','health.js','app.js']){
 let source=fs.readFileSync(path.join(root,'dist',file),'utf8');
 if(file==='app.js')source=source.slice(0,source.indexOf("$('#refresh').addEventListener"));
 vm.runInContext(source,ctx);
}
const run=s=>vm.runInContext(s,ctx);
run(`opsData={status:'ok',jobs:{backup:{status:'failed',last_success:'2026-09-13T06:00:00Z',duration_seconds:2}},wal:{mode:'on'},stale:false};
opsAudit=[{event_id:1,order_id:108,changed_at:'2026-09-13T06:00:00Z',entity:'operations.demo_orders',action:'UPDATE',transaction_id:42,before_data:{due_date:'2026-09-16'},after_data:{due_date:'2026-09-17'},actor:'<script>evil</script>',reason:'Demo',approved_by:'Demo'}];`);
for(const lang of ['ru','en','he']){
 run(`settings.language='${lang}'`);
 const html=run('operationsView()');
 assert(html.includes('2026-09-16')&&html.includes('2026-09-17'));
 assert(html.includes('&lt;script&gt;evil&lt;/script&gt;'));
 assert(!html.includes('<script>evil'));
 assert(!html.includes('undefined'));
 if(lang!=='ru'){
  const translated=html.replace(/>([^<>]+)</g,(_,txt)=>'>'+run(`tr(${JSON.stringify(txt.trim())})`)+'<');
  assert(!/[А-Яа-яЁё]/.test(translated),lang+' operations translation');
 }
}
run(`auditOrder='104'`);assert(!run('operationsView()').includes('2026-09-16'));
run(`opsError=true;opsData=null;opsAudit=[]`);assert(run('operationsView()').includes('operations-panel'));
assert(fs.readFileSync(path.join(root,'dist/index.html'),'utf8').includes('/operations.js'));
console.log('PASS: operations translations, failed/empty status, audit filters, before/after values and HTML escaping');
const sample={_id:'QA-102-2',order_id:102,serial:'TC200-001',tested_at:'2026-09-09T10:00:00Z',result:'failed',method:'power',method_version:'1.0',configuration_version:'1',operator:'Demo QA',notes:'<img src=x onerror=alert(1)>',measurements:[{name:'voltage',value:19.2,unit:'V',min:23,max:25},{name:'ripple',value:1.7,unit:'V',max:.5}]};
ctx.sample=sample;
for(const lang of ['ru','en','he']){
 run(`settings.language='${lang}'`);
 const detail=run('protocolDetailMarkup(sample)');
 assert(detail.includes('19.2')&&detail.includes('Demo QA')&&detail.includes('TC200-001'));
 assert(!detail.includes('<img'));assert(detail.includes('&lt;img'));
 assert(!detail.includes('undefined'));
 if(lang!=='ru')assert(!/[А-Яа-яЁё]/.test(detail));
}
assert.equal(run('measurementOutcome({value:23,min:23,max:25})'),'В допуске');
assert.equal(run('measurementOutcome({value:26,min:23,max:25})'),'Вне допуска');
assert.equal(run('measurementOutcome({value:0,max:0})'),'В допуске');
assert.equal(run('measurementOutcome({value:1})'),'Без оценки');
run("selectedKind='order';selected=102");assert(!run('evidenceOrderLink(102)').includes('href'));
assert(run('evidenceOrderLink(108)').includes('#orders/order/108'));
console.log('PASS: protocol measurements, localization, escaping and no self-navigation');
ctx.sample.attachments=[{name:'safe.pdf',url:'/protocols/QA-102-DEMO-2.pdf'},{name:'bad',url:'javascript:alert(1)'},{name:'outside',url:'https://example.com/test.pdf'}];
assert(run('protocolAttachments(sample)').includes('/protocols/QA-102-DEMO-2.pdf'));
assert(!run('protocolAttachments(sample)').includes('javascript:'));
assert(!run('protocolAttachments(sample)').includes('example.com'));
