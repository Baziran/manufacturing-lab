const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const root=path.join(__dirname,'..');
const ctx=vm.createContext({console,Intl,Date,Set,Map,WeakMap,localStorage:{getItem:()=>null,setItem(){}},document:{documentElement:{dataset:{}},querySelector:()=>({addEventListener(){}})}});
for(const file of ['i18n.js','ux.js','app.js']){
 let source=fs.readFileSync(path.join(root,'dist',file),'utf8');
 if(file==='app.js')source=source.slice(0,source.indexOf("$('#refresh').addEventListener"));
 vm.runInContext(source,ctx);
}
const run=s=>vm.runInContext(s,ctx);
const order={order_date:'2026-09-02',due_date:'2026-09-07',status:'active',remaining_qty:2,last_shipped_at:'2026-09-06'};
ctx.order=order;
assert.equal(run("orderTiming(order,'2026-09-04').percent"),40);
assert.equal(run("orderTiming(order,'2026-09-12').late"),5);
assert.equal(run("orderTiming(order,'2026-09-12').elapsed"),10);
assert.equal(run("orderTiming(order,'2026-09-12').complete"),false);
order.remaining_qty=0;
assert.equal(run("orderTiming(order,'2026-09-12').percent"),80);
assert.equal(run("orderTiming(order,'2026-09-12').end"),'2026-09-06');
order.last_shipped_at='2026-09-09';
assert.equal(run("orderTiming(order,'2026-09-12').late"),2);
assert.equal(run("orderTiming(order,'2026-09-12').percent"),100);
order.order_date=order.due_date;order.remaining_qty=1;
assert.equal(run("orderTiming(order,'2026-09-07').percent"),100);
assert.equal(run("orderTiming(order,'2026-09-07').late"),0);
run("data={as_of:'2026-09-12'}");
for(const lang of ['ru','en','he']){
 run(`settings.language='${lang}'`);
 const html=run('orderTimebar(order)');
 assert(html.includes('role="progressbar"'));assert(!html.includes('NaN'));assert(!html.includes('Infinity'));
 assert(!html.includes('{0}'));assert(!html.includes('{1}'));
 if(lang!=='ru')assert(!/[А-Яа-яЁё]/.test(html.match(/aria-valuetext="([^"]+)"/)[1]));
}
order.status='cancelled';assert(!run('orderTimebar(order)').includes('role="progressbar"'));
run("page='sales'");assert(!run("metric('Отгружено','100','Test')").includes('↗'));
assert(run('trendIndicator(110,100)').includes('▲'));
console.log('PASS: elapsed time, partial and full shipments, late and same-day orders, cancelled orders, translations and genuine trend arrows');
