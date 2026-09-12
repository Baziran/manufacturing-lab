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

run("data.report_month='2026-09';data.today='2026-09-12';data.as_of='2026-09-12';data.previous_trend=previous.slice(0,12);settings.ghostComparison=true");
html=run('cumulativeChart(rows.slice(0,12))');
assert(html.includes('class="today-marker"'));
assert(html.includes('stroke-dasharray="1 3"'));
assert.equal((html.match(/<circle /g)||[]).length,48);
const paths=[...html.matchAll(/class="(?:current|ghost)-line" d="([^"]+)"/g)].map(m=>m[1]);
assert(paths.every(p=>(p.match(/[ML]/g)||[]).length===12));
assert(html.includes('>30</text>')); // Calendar remains visible after the actuals stop.
run('settings.ghostComparison=false');
assert(run('cumulativeChart(rows.slice(0,12))').includes('class="today-marker"'));
run("data.report_month='2026-08'");
assert(!run('cumulativeChart(previous)').includes('class="today-marker"'));
console.log('PASS: today marker, actual series stop, full calendar axis and comparison cutoff');

run("data.report_month='2026-09';data.previous_full_trend=previous;settings.ghostComparison=true");
html=run('cumulativeChart(rows.slice(0,12))');
const lengths=cls=>[...html.matchAll(new RegExp('class="'+cls+'" d="([^"]+)"','g'))].map(m=>(m[1].match(/[ML]/g)||[]).length);
assert.deepEqual(lengths('current-line'),[12,12]);
assert.deepEqual(lengths('ghost-line'),[31,31]);
assert.equal((html.match(/<circle /g)||[]).length,86);
assert.equal(run('sum(data.previous_trend,"shipped")'),48); // KPI baseline still uses only 12 days.
assert(html.includes('class="today-marker"'));
console.log('PASS: full previous-month chart with current-day cutoff and unchanged matched-period KPI baseline');

run("data.previous_month='2026-08'");
ctx.tipPoint={day:'2026-09-12',previousDay:'2026-08-12',a:290500,b:161000,pa:129500,pb:117500};
for(const lang of ['ru','en','he']){
 run(`settings.language='${lang}'`);
 const tooltip=run('chartDayTooltip(tipPoint,11,30)');
 assert(tooltip.includes('290,500')||tooltip.includes('290 500'));
 assert.equal((tooltip.match(/chart-tip-section/g)||[]).length,2);
 if(lang!=='ru')assert(!/[А-Яа-яЁё]/.test(tooltip));
}
ctx.tipPoint={previousDay:'2026-08-20',a:null,b:null,pa:200000,pb:190000};
run("settings.language='en'");
html=run('chartDayTooltip(tipPoint,19,30)');
assert(html.includes('No actual data'));assert(html.includes('190,000'));
assert(!html.includes('null'));assert(!html.includes('>0 ₪'));
assert(run('chartDayTooltip(tipPoint,30,30)').includes('This month has no such day'));
run('settings.ghostComparison=false');
assert.equal((run('chartDayTooltip(tipPoint,19,30)').match(/chart-tip-section/g)||[]).length,1);
console.log('PASS: shared tooltip totals, month separation, translations, unavailable days and comparison toggle');
