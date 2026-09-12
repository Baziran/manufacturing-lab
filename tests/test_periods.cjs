const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const elements={'#report-month':{value:'2026-09'},'#date-from':{value:'2026-08-15'},'#date-to':{value:'2026-09-06'}};
const ctx=vm.createContext({console,Intl,Date,Set,Map,WeakMap,URLSearchParams,localStorage:{getItem:()=>null,setItem(){}},document:{documentElement:{dataset:{}},querySelector:s=>elements[s]||{addEventListener(){}}}});
for(const file of ['i18n.js','ux.js','app.js']){
 let source=fs.readFileSync(path.join(__dirname,'../dist',file),'utf8');
 if(file==='app.js')source=source.slice(0,source.indexOf("$('#refresh').addEventListener"));
 vm.runInContext(source,ctx);
}
const run=s=>vm.runInContext(s,ctx);
assert.equal(run('periodQuery()'),'month=2026-09');
run("listView='shipments'");
assert.equal(run('periodQuery()'),'date_from=2026-08-15&date_to=2026-09-06');
run("data={period_start:'2026-08-15',as_of:'2026-09-06',orders:[],related_orders:[{order_id:102,order_date:'2026-09-02'}]};selected=102;selectedKind='order'");
assert.equal(run('selectedRecord().order_id'),102);
assert(run("inPeriod('2026-08-15')&&inPeriod('2026-09-06')"));
assert(!run("inPeriod('2026-08-14')||inPeriod('2026-09-07')"));
ctx.rows=Array.from({length:30},(_,i)=>({day:`2026-09-${String(i+1).padStart(2,'0')}`,booked:1,shipped:2}));
ctx.previous=Array.from({length:31},(_,i)=>({day:`2026-08-${String(i+1).padStart(2,'0')}`,booked:3,shipped:4}));
run('data.previous_trend=previous;settings.ghostComparison=true');
let html=run('cumulativeChart(rows)');
assert.equal((html.match(/class="ghost-line"/g)||[]).length,2);
assert.equal((html.match(/<circle /g)||[]).length,122); // 30 actual + 31 previous days, two series each.
assert(!html.includes('undefined')&&!html.includes('NaN'));
run('settings.ghostComparison=false');
html=run('cumulativeChart(rows)');
assert.equal((html.match(/class="ghost-line"/g)||[]).length,0);
assert.equal((html.match(/<circle /g)||[]).length,60);
for(const lang of ['en','he']){
 run(`settings.language='${lang}'`);
 for(const label of ['Месяц отчёта','С даты','По дату включительно','Сравнить с предыдущим месяцем','Отбор по дате отгрузки','Состояние на конец периода'])assert(!/[А-Яа-яЁё]/.test(run(`tr(${JSON.stringify(label)})`)));
}
console.log('PASS: month/range requests, inclusive boundaries, older related orders, unequal month lengths, comparison toggle and translations');
