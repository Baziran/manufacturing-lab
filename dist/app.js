'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n = v => new Intl.NumberFormat(locales[settings.language],{maximumFractionDigits:0}).format(v||0);
const money = v => `${n(v)} <span aria-label="шекелей">₪</span>`;
const short = v => n(v/1000)+(settings.language==='ru'?' тыс.':settings.language==='he'?' אלף':'k');
const d = v => v ? new Date(v+'T12:00:00').toLocaleDateString(locales[settings.language],{day:'2-digit',month:'short'}) : '—';
const sum = (rows,key) => rows.reduce((a,r)=>a+Number(r[key]||0),0);
const labels = {projects:['Проекты','Проекты и сложные заказы','04 / ПРОЕКТНОЕ ИСПОЛНЕНИЕ','Этапы, зависимости и сроки — в контексте заказов и производства.'],health:['Сервер и БД','Здоровье сервера и базы данных','05 / ИНФРАСТРУКТУРА','Текущие показатели приложения и PostgreSQL.'],sales:['Продажи','Продажи и денежный поток','01 / КОММЕРЧЕСКИЙ ОБЗОР','От заказа до отгрузки и оплаты — без смешения показателей.'],orders:['Исполнение заказов','Каждый заказ под контролем','02 / ПРОИЗВОДСТВО И ОТГРУЗКИ','Сроки, частичные отгрузки и заказы, которым нужно внимание.'],supply:['Комплектующие','Материалы для ближайших заказов','03 / СНАБЖЕНИЕ И КОМПЛЕКТАЦИЯ','Потребность по BOM, доступный запас и ожидаемые поставки.']};
let data=null, page='sales', selected=null, statusFilter='all', shortageOnly=true, requestId=0, loadedPeriod='', pendingPeriod='', queries=null, listView=null, selectedKind=null;
const statuses={overdue:'Просрочен',shipped:'Отгружен',in_progress:'В работе',cancelled:'Отменён',unpaid:'Не оплачен',partial:'Частично',paid:'Оплачен',overpaid:'Переплата'};
function badge(status){return `<span class="badge ${esc(status)}">${esc(statuses[status]||status)}</span>`;}
const cardLists={projects:[],health:[],sales:['claims','claims-open','claims-open-received','claims-open-unreceived','claims-returned','claims-closed','claim-transit_damage','claim-power_on_failure','claim-incomplete','claim-spec_mismatch','booked','shipments','payments','receivable','channel-direct','channel-partners','channel-web','new-customers','new-channel-direct','new-channel-partners','new-channel-web','payment-full','payment-partial','payment-none'],orders:['open','late','done','ontime'],supply:['shortages','affected','excess','purchases']};
const cardLabels={claims:'Рекламации и возвраты','claims-open':'Открытые рекламации','claims-open-received':'Открытые · товар получен','claims-open-unreceived':'Открытые · товар не получен','claims-returned':'Товар возвращён','claims-closed':'Закрытые рекламации','claim-transit_damage':'Повреждение при перевозке','claim-power_on_failure':'Брак при включении','claim-incomplete':'Некомплект','claim-spec_mismatch':'Характеристики не соответствуют заявленным','channel-direct':'Прямые продажи','channel-partners':'Партнёры','channel-web':'Сайт','new-customers':'Новые клиенты','new-channel-direct':'Новые клиенты · Прямые продажи','new-channel-partners':'Новые клиенты · Партнёры','new-channel-web':'Новые клиенты · Сайт','payment-full':'Оплачены полностью','payment-partial':'Частично оплачены','payment-none':'Без оплаты',booked:'Принято заказов',shipments:'Отгружено',payments:'Получено оплат',receivable:'Осталось оплатить',open:'В работе',late:'Просрочены',done:'Полностью отгружены',ontime:'Исполнено в срок',shortages:'Дефицитные позиции',affected:'Затронутые заказы',excess:'Есть свободный избыток',purchases:'Ожидаемые поставки'};
function metric(label,value,note,klass='',symbol=''){
 const key=cardLists[page].find(k=>cardLabels[k]===label);
 return `<a href="#${page}/list/${key}" class="metric metric-link ${klass}" data-list="${key}"><div class="metric-label">${label}${symbol?`<span class="metric-symbol" aria-hidden="true">${symbol}</span>`:''}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></a>`;
}
function active(){return data.orders.filter(o=>o.status==='active');}
function monthRows(){return active();}
function inPeriod(value){return value>=(data.period_start||data.as_of.slice(0,7)+'-01')&&value<=data.as_of;}
function monthName(value){return new Date(value+'T12:00:00').toLocaleDateString(locales[settings.language],{month:'long',year:'numeric'});}
function periodQuery(){return listView?new URLSearchParams({date_from:$('#date-from').value,date_to:$('#date-to').value}).toString():new URLSearchParams({month:$('#report-month').value}).toString();}
function freshnessText(){return `PostgreSQL · ${d(data.period_start||data.as_of.slice(0,7)+'-01')} — ${d(data.as_of)} · ${tr('Состояние на конец периода')} · ${new Date(data.fetched_at).toLocaleTimeString(locales[settings.language],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;}

const channelKeys={'channel-direct':'Прямые продажи','channel-partners':'Партнёры','channel-web':'Сайт'};
function newCustomers(channel=null){
 const groups=new Map();
 for(const o of monthRows().filter(o=>inPeriod(o.first_order_date)).sort((a,b)=>a.order_date.localeCompare(b.order_date)||a.order_id-b.order_id)){
  if(!groups.has(o.customer_id))groups.set(o.customer_id,{customer_id:o.customer_id,customer:o.customer,manager:o.manager,first_order_date:o.first_order_date,channel:o.channel,orders:[],amount:0});
  const c=groups.get(o.customer_id);c.orders.push(o);c.amount+=Number(o.amount);
 }
 return [...groups.values()].filter(c=>!channel||c.channel===channel);
}
function cumulativeChart(rows,w=900,h=120){
 const p={l:55,r:18,t:20,b:32};let a=0,b=0,pa=0,pb=0;
 const previous=settings.ghostComparison?(data.previous_full_trend||data.previous_trend):[];
 const reportMonth=data.report_month||data.period_start?.slice(0,7)||data.as_of.slice(0,7);
 const [year,month]=reportMonth.split('-').map(Number);
 const calendarDays=new Date(Date.UTC(year,month,0)).getUTCDate();
 const todayIndex=data.today?.startsWith(reportMonth)?Number(data.today.slice(-2))-1:null;
 const points=Array.from({length:Math.max(calendarDays,rows.length,previous.length)},(_,i)=>({
  day:rows[i]?.day,previousDay:previous[i]?.day,
  da:rows[i]?Number(rows[i].booked):null,db:rows[i]?Number(rows[i].shipped):null,
  dpa:previous[i]?Number(previous[i].booked):null,dpb:previous[i]?Number(previous[i].shipped):null,
  a:rows[i]?(a+=Number(rows[i].booked)):null,b:rows[i]?(b+=Number(rows[i].shipped)):null,
  pa:previous[i]?(pa+=Number(previous[i].booked)):null,pb:previous[i]?(pb+=Number(previous[i].shipped)):null
 }));
 const max=Math.max(10000,...points.flatMap(v=>[v.a,v.b,v.pa,v.pb].filter(x=>x!==null)))*1.08;
 const x=i=>p.l+i*(w-p.l-p.r)/Math.max(points.length-1,1),y=v=>h-p.b-v/max*(h-p.t-p.b);
 const path=key=>points.map((v,i)=>v[key]===null?'':`${i&&points[i-1][key]!==null?'L':'M'}${x(i).toFixed(1)},${y(v[key]).toFixed(1)}`).join(' ');
 const grid=[0,.25,.5,.75,1].map(f=>`<line class="gridline" x1="${p.l}" x2="${w-p.r}" y1="${y(max*f)}" y2="${y(max*f)}"/><text x="${p.l-9}" y="${y(max*f)+4}" text-anchor="end">${Math.round(max*f/1000)}k</text>`).join('');
 const ticks=points.map((v,i)=>i%Math.max(1,Math.ceil(points.length/6))===0||i===points.length-1?`<text x="${x(i)}" y="${h-8}" text-anchor="middle">${i+1}</text>`:'').join('');
 const line=(key,color,ghost=false)=>`<path class="${ghost?'ghost-line':'current-line'}" d="${path(key)}" fill="none" stroke="${color}" stroke-width="${ghost?2:3}" ${ghost?'stroke-dasharray="7 6" opacity=".5"':''} stroke-linejoin="round"/>`;
 const dots=points.map((v,i)=>[['a','Заказы','var(--blue)',false],['b','Отгрузки','var(--orange)',false],['pa','Заказы','var(--blue)',true],['pb','Отгрузки','var(--orange)',true]].map(([key,label,color,ghost])=>v[key]===null?'':`<circle cx="${x(i)}" cy="${y(v[key])}" r="3" fill="${color}" opacity="${ghost ? 0.5 : 1}"><title>${d(ghost?v.previousDay:v.day)} · ${tr(label)}: ${n(v[key])} ₪</title></circle>`).join('')).join('');
 const todayMarker=todayIndex===null?'':`<g class="today-marker"><line x1="${x(todayIndex)}" x2="${x(todayIndex)}" y1="${p.t}" y2="${h-p.b}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="1 3" stroke-linecap="round"/><text x="${x(todayIndex)}" y="${p.t-7}" text-anchor="middle">${esc(tr('Сегодня'))} · ${Number(data.today.slice(-2))}</text><title>${esc(tr('Сегодня'))}: ${d(data.today)}</title></g>`;
 return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="group" tabindex="0" aria-label="Заказы и отгрузки по дням месяца" aria-describedby="chart-hover-tooltip" data-points="${esc(JSON.stringify(points))}" data-max="${max}" data-calendar-days="${calendarDays}">${grid}${settings.ghostComparison?line('pa','var(--blue)',true)+line('pb','var(--orange)',true):''}${line('a','var(--blue)')}${line('b','var(--orange)')}${dots}${ticks}${todayMarker}<g class="chart-hover-layer" aria-hidden="true"></g><rect class="chart-hit-area" x="${p.l}" y="${p.t}" width="${w-p.l-p.r}" height="${h-p.t-p.b}" fill="transparent"/></svg>`;
}
function sales(){
 const rows=monthRows(),booked=sum(rows,'amount'),shipped=sum(data.shipments,'amount'),paid=sum(data.payments,'amount');
 const receivable=rows.reduce((a,o)=>a+Math.max(o.remaining_to_pay,0),0),overpaid=rows.reduce((a,o)=>a+Math.max(-o.remaining_to_pay,0),0);
 const paidCount=rows.filter(o=>['paid','overpaid'].includes(o.payment_status)).length,partial=rows.filter(o=>o.payment_status==='partial').length,unpaid=rows.length-paidCount-partial;
 const pct=shipped/data.monthly_plan*100,previousShipped=sum(data.previous_trend,'shipped'),previousPct=previousShipped/data.previous_monthly_plan*100,delta=pct-previousPct;
 const pctText=v=>new Intl.NumberFormat(locales[settings.language],{maximumFractionDigits:1}).format(v);
 const values=[paidCount,partial,unpaid],colors=['#278675','#e8a058','#9aaabb'],paymentKeys=['payment-full','payment-partial','payment-none'];let offset=0;
 const ring=values.map((v,i)=>{const len=rows.length?v/rows.length*276.46:0;const html=`<a href="#sales/list/${paymentKeys[i]}" data-list="${paymentKeys[i]}" aria-label="${['Оплачены полностью','Частично оплачены','Без оплаты'][i]}"><circle cx="60" cy="60" r="44" fill="none" stroke="${colors[i]}" stroke-width="11" stroke-dasharray="${len} ${276.46-len}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/></a>`;offset+=len;return html;}).join('');

 const metrics=`<div class="metrics">${metric('Принято заказов',money(booked),`Активных заказов за период: ${rows.length}`,'emphasis','')}${metric('Отгружено',money(shipped),'По фактическим отгрузкам','','')}${metric('Получено оплат',money(paid),'Поступления за вычетом возвратов','','')}${metric('Осталось оплатить',money(receivable),`Переплаты отдельно: ${n(overpaid)} ₪`,'','◷')}</div>`;
 const plan=`<section class="panel sales-plan"><div class="plan-heading"><h2>План отгрузок</h2><strong>${pctText(pct)}%</strong><span>${n(shipped)} / ${n(data.monthly_plan)} ₪</span>${settings.ghostComparison?`<span class="race-score ${delta>=0?'ahead':'behind'}"><span aria-hidden="true">${delta>0?'▲':delta<0?'▼':'＝'}</span> <span>${delta>0?'Впереди на':delta<0?'Отстаём на':'На уровне прошлого месяца'}</span>${delta?` ${pctText(Math.abs(delta))} <span>п. п.</span>`:''}</span>`:''}</div><div class="race-track"><div class="progress" role="progressbar" aria-label="Выполнение плана отгрузок" aria-orientation="${settings.salesLayout==='classic'?'vertical':'horizontal'}" aria-valuenow="${Math.min(pct,100)}" aria-valuemin="0" aria-valuemax="100"><div class="plan-fill" style="--plan-value:${Math.min(pct,100)}%"></div></div>${settings.ghostComparison?`<span class="ghost-marker" style="--ghost-position:${Math.min(previousPct,100)}%" title="${esc(monthName(data.previous_month?data.previous_month+'-01':data.previous_as_of))}: ${pctText(previousPct)}%"></span>`:''}</div><div class="plan-foot"><span>${esc(monthName((data.report_month||data.as_of.slice(0,7))+'-01'))}</span>${settings.ghostComparison?`<span class="ghost-caption"><span class="ghost-label">${esc(monthName(data.previous_month?data.previous_month+'-01':data.previous_as_of))}${data.previous_trend.length?' · '+d(data.previous_as_of):''}</span><span class="ghost-percent">${pctText(previousPct)}%</span><span class="ghost-amount">${n(previousShipped)} / ${n(data.previous_monthly_plan)} ₪</span></span>`:''}</div></section>`;
 const chart=`<section class="panel sales-chart"><div class="panel-head chart-heading"><div class="chart-heading-copy"><h2>Заказы и отгрузки</h2><p>Накопленным итогом с начала месяца</p><div class="legend"><span><i></i>Заказы</span><span><i class="orange"></i>Отгрузки</span>${settings.ghostComparison?`<span class="ghost-legend">┄ ${esc(monthName(data.previous_month?data.previous_month+'-01':data.previous_as_of))}</span>`:''}</div></div><div class="chart-summary"><div><strong>${short(booked)} ₪</strong><small>сформировано заказов</small>${settings.ghostComparison?trendIndicator(booked,sum(data.previous_trend,'booked')):''}</div><div><strong>${short(shipped)} ₪</strong><small>отгружено клиентам</small>${settings.ghostComparison?trendIndicator(shipped,previousShipped):''}</div></div></div>${cumulativeChart(data.trend)}<p class="note">${settings.ghostComparison?'Прошлый месяц показан целиком. Проценты сравнения — за одинаковый прошедший период.':'Ось X — день месяца.'}</p></section>`;
 const bottom=`<div class="grid-bottom"><section class="panel"><div class="panel-head"><div><h2>Каналы продаж</h2><p>По сумме активных заказов</p></div><a class="new-clients" href="#sales/list/new-customers" data-list="new-customers"><span>Новые клиенты</span><strong>${newCustomers().length}</strong></a></div>${Object.entries(channelKeys).map(([key,name])=>{const c=rows.filter(o=>o.channel===name),total=sum(c,'amount');return `<div class="channel"><a class="channel-link" href="#sales/list/${key}" data-list="${key}"><div class="channel-top"><span>${name}</span><strong>${n(total)} ₪</strong></div><div class="progress"><div style="width:${booked?total/booked*100:0}%"></div></div><div class="channel-meta">Заказов: ${c.length} · доля ${booked?Math.round(total/booked*100):0}%</div></a><a class="new-customer-link" href="#sales/list/new-${key}" data-list="new-${key}"><span>Новые клиенты</span>: ${newCustomers(name).length}</a></div>`;}).join('')}<p class="note">Новый клиент — первый неотменённый заказ в выбранном периоде. Канал — по первому заказу.</p></section><section class="panel"><div class="panel-head"><div><h2>Статусы оплаты</h2><p>Количество заказов, а не платежей</p></div></div><div class="ring-wrap"><svg class="ring" viewBox="0 0 120 120" role="img" aria-label="Статусы оплаты заказов"><circle cx="60" cy="60" r="44" fill="none" stroke="#edf1f5" stroke-width="11"/>${ring}<text x="60" y="58" text-anchor="middle" fill="#172a3b" font-size="25" font-weight="700">${rows.length}</text><text x="60" y="75" text-anchor="middle" fill="#7b8c9a" font-size="10">ЗАКАЗОВ</text></svg><div class="ring-labels">${['Оплачены полностью','Частично оплачены','Без оплаты'].map((l,i)=>`<a class="ring-row" href="#sales/list/${paymentKeys[i]}" data-list="${paymentKeys[i]}"><span><i style="background:${colors[i]}"></i>${l}</span><strong>${values[i]}</strong></a>`).join('')}</div></div><p class="note">Переплаченные заказы включены в полностью оплаченные. Отменённые исключены.</p></section>${managersPanel()}</div>`;
 return `<div class="sales-layout ${settings.salesLayout==='race'?'sales-race':'sales-classic'}">${settings.salesLayout==='race'?plan+chart+metrics:metrics+'<div class="grid-main">'+chart+plan+'</div>'}${bottom}${claimsPanel()}</div>`;
}
const claimReasons={transit_damage:'Повреждение при перевозке',power_on_failure:'Брак при включении',incomplete:'Некомплект',spec_mismatch:'Характеристики не соответствуют заявленным'};
const claimStates={review:'На рассмотрении',returned:'Возврат принят',closed:'Закрыта'};
const claimResolutions={replacement:'Замена отправлена',missing_parts:'Комплект дослан'};
function claimsPanel(){
 const rows=data.claims||[],open=rows.filter(c=>c.claim_status!=='closed');
 const stat=(key,label,value,cls='')=>`<a class="claim-stat ${cls}" href="#sales/list/${key}" data-list="${key}"><span>${label}</span><strong>${n(value)}</strong></a>`;
 const colors=['#527ac4','#d49a50','#46968c','#9b80ba'];
 let offset=0;
 const reasons=Object.entries(claimReasons).map(([key,label],i)=>{
  const count=rows.filter(c=>c.reason===key).length,pct=rows.length?count/rows.length*100:0;
  const segment=count?`<a href="#sales/list/claim-${key}" data-list="claim-${key}" aria-label="${esc(tr(label))}: ${n(count)} · ${n(pct)}%"><circle cx="70" cy="70" r="52" fill="none" stroke="${colors[i]}" stroke-width="17" pathLength="100" stroke-dasharray="${pct} ${100-pct}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${esc(tr(label))}: ${n(count)} · ${n(pct)}%</title></circle></a>`:'';
  offset+=pct;return {key,label,count,pct,color:colors[i],segment};
 });
 return `<section class="panel claims-panel"><div class="panel-head"><div><h2>Рекламации и возвраты</h2><p>Обращения, открытые в месяце отчёта</p></div></div><div class="claims-overview"><div class="claim-status-list">${stat('claims','Всего обращений',rows.length,'claim-total')}${stat('claims-open','Открытые',open.length)}<div class="claim-open-children" role="group" aria-label="${esc(tr('Открытые рекламации'))}">${stat('claims-open-received','Товар получен',open.filter(c=>c.returned_at).length)}${stat('claims-open-unreceived','Товар не получен',open.filter(c=>!c.returned_at).length)}</div>${stat('claims-closed','Закрытые',rows.length-open.length,'claim-closed')}</div><div class="claim-cause-panel"><h3>Заявленные причины брака</h3><div class="claim-cause-chart"><svg class="claim-donut" viewBox="0 0 140 140" role="img" aria-label="${esc(tr('Заявленные причины брака'))}"><circle cx="70" cy="70" r="52" fill="none" stroke="var(--line)" stroke-width="17"/>${reasons.map(r=>r.segment).join('')}<text x="70" y="69" text-anchor="middle" class="claim-donut-total">${n(rows.length)}</text><text x="70" y="86" text-anchor="middle" class="claim-donut-label">обращений</text></svg><div class="claim-cause-legend">${reasons.map(r=>`<a href="#sales/list/claim-${r.key}" data-list="claim-${r.key}"><i aria-hidden="true" style="background:${r.color}"></i><span>${r.label}</span><strong>${n(r.count)}</strong><small>${n(r.pct)}%</small></a>`).join('')}</div></div><p class="note">По всем обращениям, включая закрытые</p></div></div></section>`;
}
function orderTiming(o,asOf=data.as_of){
 const day=v=>Date.parse(v+'T00:00:00Z')/86400000;
 const complete=o.status!=='cancelled'&&Number(o.remaining_qty)===0&&!!o.last_shipped_at;
 const end=complete?o.last_shipped_at:asOf;
 const planned=Math.max(0,day(o.due_date)-day(o.order_date));
 const elapsed=Math.max(0,day(end)-day(o.order_date));
 return {complete,end,planned,elapsed,late:Math.max(0,day(end)-day(o.due_date)),percent:planned?Math.min(100,elapsed/planned*100):day(end)>=day(o.due_date)?100:0};
}
function orderTimebar(o){
 if(o.status==='cancelled')return `<div class="order-time cancelled"><span>Заказ отменён — отсчёт остановлен</span></div>`;
 const t=orderTiming(o),state=t.late?'late':t.complete?'complete':'running';
 const caption=`${tr(t.complete?'Отгружен полностью':'На дату отчёта')}: ${d(t.end)} · ${tr('Прошло {0} из {1} дн.').replace('{0}',n(t.elapsed)).replace('{1}',n(t.planned))}`;
 const status=t.late?tr('Просрочка: {0} дн.').replace('{0}',n(t.late)):t.complete?tr('Отгружен в срок'):tr('До срока: {0} дн.').replace('{0}',n(t.planned-t.elapsed));
 return `<div class="order-time ${state}"><div class="order-time-labels"><span><span>Получен</span> · ${d(o.order_date)}</span><span><span>Срок</span> · ${d(o.due_date)}</span></div><div class="order-time-track" role="progressbar" aria-label="Время исполнения заказа" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(t.percent)}" aria-valuetext="${esc(caption+' · '+status)}"><span class="order-time-fill" style="width:${t.percent}%"></span></div><div class="order-time-caption"><span>${esc(caption)}</span><strong>${esc(status)}</strong></div></div>`;
}
function orderDetail(o){return `<aside class="detail"><div class="detail-title"><p class="eyebrow">КАРТОЧКА ЗАКАЗА</p><button class="detail-close" data-close aria-label="Закрыть карточку">×</button></div><div><h3>№ ${o.order_id} · ${esc(o.customer)}</h3><p class="muted">${o.item_count>1?`<span>Позиций в заказе</span>: ${n(o.item_count)}`:esc(o.product)}</p><div class="fulfillment-label">Исполнение исходного заказа</div>${badge(o.fulfillment_status)}${orderTimebar(o)}</div><div class="detail-pairs"><div><span>Менеджер</span><strong>${esc(o.manager)}</strong></div><div><span>Исходный срок</span><strong>${d(o.original_due_date)}</strong></div><div><span>Текущий срок</span><strong>${d(o.due_date)}</strong></div><div><span>Сумма заказа</span><strong>${n(o.amount)} ₪</strong></div><div><span>Количество</span><strong>${o.quantity} шт.</strong></div><div><span>Осталось отгрузить</span><strong>${o.remaining_qty} шт.</strong></div><div><span>Оплачено</span><strong>${n(o.paid_amount)} ₪</strong></div><div><span>Остаток оплаты</span><strong>${n(o.remaining_to_pay)} ₪</strong></div></div><div>${o.status==='active'&&Number(o.remaining_qty)>0&&o.delay_reason?`<div class="detail-reason"><strong>Причина задержки оставшейся отгрузки</strong><span>${esc(o.delay_reason)}</span></div>`:''}<p class="detail-note"><span>${o.last_shipped_at?'Последняя отгрузка: '+d(o.last_shipped_at)+'.':'Отгрузок на выбранную дату нет.'}</span> <span>${o.original_due_date!==o.due_date?'Срок был перенесён: первоначальная дата сохранена.':''}</span></p></div></aside>`;}
function orders(){
 const rows=active(),late=rows.filter(o=>o.fulfillment_status==='overdue'),open=rows.filter(o=>o.remaining_qty>0),done=rows.filter(o=>o.fulfillment_status==='shipped');
 const due=rows.filter(o=>o.due_date<data.as_of),ontime=due.filter(o=>o.remaining_qty===0&&o.last_shipped_at<=o.due_date);
 const shown=data.orders.filter(o=>statusFilter==='all'||o.fulfillment_status===statusFilter),chosen=[...data.orders,...(data.related_orders||[])].find(o=>o.order_id===selected);
 return `<div class="metrics">${metric('В работе',open.length,`${n(sum(open,'amount')-sum(open,'shipped_amount'))} ₪ осталось отгрузить`,'emphasis','◷')}${metric('Просрочены',late.length,`${late.length?'Максимум '+Math.max(...late.map(o=>o.days_overdue))+' дн. задержки':'Открытых просрочек нет'}`,'warn','!')}${metric('Полностью отгружены',done.length,'На выбранную дату','','✓')}${metric('Исполнено в срок',due.length?Math.round(ontime.length/due.length*100)+'%':'—',`${ontime.length} из ${due.length} заказов со сроком до даты отчёта`)}</div>
 <div class="${chosen?'split-view':''}"><section class="panel no-pad"><div class="panel-head"><div><h2>Портфель заказов</h2><p>Выберите заказ для деталей · сортировка по сроку</p></div><div class="table-tools"><select id="status-filter" aria-label="Статус заказа">${[['all','Все статусы'],['overdue','Просроченные'],['in_progress','В работе'],['shipped','Отгруженные'],['cancelled','Отменённые']].map(([v,l])=>`<option value="${v}" ${statusFilter===v?'selected':''}>${l}</option>`).join('')}</select><span class="badge">Заказов: ${shown.length}</span></div></div><div class="table-wrap"><table><thead><tr><th>Заказ / клиент</th><th>Срок</th><th class="num">Сумма, ₪</th><th>Отгрузка</th><th>Оплата</th><th>Статус</th></tr></thead><tbody>${shown.map(o=>`<tr class="${selected===o.order_id?'selected-row':''}"><td><button class="order-link" data-order="${o.order_id}">№ ${o.order_id} · ${esc(o.customer)}</button><small>${d(o.order_date)} · ${esc(o.sku)} · ${esc(o.manager)}</small></td><td>${d(o.due_date)}${o.original_due_date!==o.due_date?'<small>Срок перенесён</small>':''}${o.days_overdue?`<small class="shortage">+${o.days_overdue} дн.</small>`:''}</td><td class="num">${n(o.amount)}</td><td>${n(o.shipped_qty)} / ${n(o.quantity)} шт.<div class="mini-progress"><div style="width:${Math.min(100,o.shipped_qty/o.quantity*100)}%"></div></div></td><td>${badge(o.payment_status)}</td><td>${badge(o.fulfillment_status)}</td></tr>`).join('')}</tbody></table>${shown.length?'':'<div class="empty">Заказов с таким статусом нет.</div>'}</div></section>${chosen?orderDossier(chosen):''}</div><p class="note">Срок оценивается относительно текущей согласованной даты. Отменённые заказы не входят в показатели. В выборке есть частичные отгрузки, перенос срока и возврат оплаты.</p>`;
}
function componentDetail(c){return `<aside class="detail"><div class="detail-title"><p class="eyebrow">ДЕТАЛИ ДЕФИЦИТА</p><button class="detail-close" data-close aria-label="Закрыть карточку">×</button></div><div><h3>${esc(c.name)}</h3><p class="muted">${esc(c.sku)} · ${esc(c.supplier)}</p><div class="detail-reason">${c.shortage?`Не хватает ${c.shortage} ${esc(c.unit)} по текущему остатку.`:'Текущий остаток покрывает потребность.'}</div></div><div><h3 style="margin-top:20px">Затронутые заказы</h3>${c.orders.length?c.orders.map(o=>`<div class="detail-item"><button class="order-link" data-order="${o.order_id}">Заказ № ${o.order_id}</button> · ${o.quantity} шт.<small>Нужно к ${d(o.needed_by)}</small></div>`).join(''):'<p class="detail-note">Открытой потребности нет.</p>'}</div><div><h3 style="margin-top:20px">Ожидаемые поставки</h3>${c.purchases.length?c.purchases.map(p=>`<div class="detail-item"><strong>№ P-${p.purchase_id}</strong> · ${p.quantity} шт.<small>${d(p.expected_at)} · ${p.status==='confirmed'?'подтверждена':'не подтверждена'}${p.expected_at<data.as_of?' · дата прошла':''}</small></div>`).join(''):'<p class="detail-note">Поставок нет.</p>'}<p class="detail-note">Ожидаемые поступления не добавляются к доступному остатку до фактической приёмки.</p></div></aside>`;}
function supply(){
 const scarce=data.supply.filter(c=>c.shortage>0),affected=new Set(scarce.flatMap(c=>c.orders.map(o=>o.order_id))),shown=shortageOnly?scarce:data.supply,chosen=data.supply.find(c=>c.component_id===selected);
 return `<div class="metrics">${metric('Дефицитные позиции',scarce.length,`Из ${data.supply.length} компонентов в справочнике`,'emphasis','◇')}${metric('Затронутые заказы',affected.size,'Один заказ может зависеть от нескольких позиций','warn','!')}${metric('Есть свободный избыток',data.supply.filter(c=>c.excess>0).length,'Позиции сверх текущей потребности','','')}${metric('Ожидаемые поставки',data.supply.reduce((a,c)=>a+c.purchases.length,0),'Открытые заказы поставщикам','','')}</div><div class="supply-banner"><span aria-hidden="true">ⓘ</span><div><b>Учебный расчёт потребности.</b> BOM рассчитан на неотгруженное количество; незавершённое производство не моделируется. Остатки — фиксированный снимок на 12 сентября. Дата отчёта меняет потребность, но не пересчитывает складскую историю.</div></div>
 <div class="${chosen?'split-view':''}"><section class="panel no-pad"><div class="panel-head"><div><h2>Потребность и доступный запас</h2><p>Доступно = на складе − резерв под внешние заказы</p></div><label class="checkbox-label"><input type="checkbox" id="shortage-only" ${shortageOnly?'checked':''}>Только дефицит</label></div><div class="table-wrap"><table><thead><tr><th>Компонент / поставщик</th><th class="num">Нужно</th><th class="num">Доступно</th><th class="num">Дефицит</th><th>Нужно к</th><th>Поставка</th></tr></thead><tbody>${shown.map(c=>`<tr class="${selected===c.component_id?'selected-row':''}"><td><button class="order-link" data-component="${c.component_id}">${esc(c.name)}</button><small>${esc(c.sku)} · ${esc(c.supplier)}</small></td><td class="num">${n(c.needed)}</td><td class="num">${n(c.available)}<small>из ${n(c.on_hand)} на складе</small></td><td class="num status-cell ${c.shortage?'shortage':'available'}">${c.shortage?'−'+n(c.shortage):'—'}</td><td>${d(c.needed_by)}</td><td>${d(c.expected_at)}<small>${n(c.incoming_qty)} шт. ожидается</small></td></tr>`).join('')}</tbody></table>${shown.length?'':'<div class="empty">Дефицитных позиций на выбранную дату нет.</div>'}</div></section>${chosen?componentDetail(chosen):''}</div>`;
}
let itemFilter='all',itemFilterOrder=null;
function ensureItemFilter(o){
 if(itemFilterOrder!==o.order_id||!o.items.some(i=>String(i.order_item_id)===itemFilter)){itemFilter='all';itemFilterOrder=o.order_id;}
}
function orderItems(o){
 ensureItemFilter(o);
 return `<section class="panel no-pad order-items-panel"><div class="panel-head"><h2>Содержимое заказа</h2><span class="badge"><span>Позиций</span>: ${o.items.length}</span></div><div class="table-wrap"><table><thead><tr><th>Позиция</th><th>Изделие</th><th class="num">Заказано</th><th class="num">Цена, ₪</th><th class="num">Сумма, ₪</th><th class="num">Отгружено</th><th class="num">Осталось отгрузить</th></tr></thead><tbody>${o.items.map(i=>`<tr class="${itemFilter===String(i.order_item_id)?'selected-row':''}"><td>${i.line_no}</td><td><button class="order-link" data-order-item="${i.order_item_id}">${esc(i.product)}</button><small>${esc(i.sku)}</small></td><td class="num">${n(i.quantity)}</td><td class="num">${n(i.unit_price)}</td><td class="num">${n(i.amount)}</td><td class="num">${n(i.shipped_qty)}</td><td class="num">${n(i.remaining_qty)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="4" scope="row">Итого по заказу</th><td class="num">${n(o.amount)} ₪</td><td colspan="2"></td></tr></tfoot></table></div></section>`;
}
function componentsForOrder(o,filter=itemFilter){
 const totals=new Map();
 for(const row of data.order_bom.filter(r=>r.order_id===o.order_id&&(filter==='all'||String(r.order_item_id)===filter))){
  if(!totals.has(row.component_id)){const c=data.supply.find(c=>c.component_id===row.component_id);if(!c)continue;totals.set(row.component_id,{...c,ordered_needed:0,open_needed:0});}
  const total=totals.get(row.component_id);total.ordered_needed+=Number(row.ordered_needed);total.open_needed+=Number(row.open_needed);
 }
 return [...totals.values()].sort((a,b)=>a.sku.localeCompare(b.sku));
}
function orderComponents(o){
 ensureItemFilter(o);const related=componentsForOrder(o);
 return `<section class="panel no-pad related-panel"><div class="panel-head"><div><h2>Комплектующие заказа</h2><p>Общие компоненты позиций суммируются в одну строку.</p></div><label class="item-filter"><span>Позиция заказа</span><select id="order-item-filter"><option value="all" ${itemFilter==='all'?'selected':''}>Все позиции — суммарно</option>${o.items.map(i=>`<option value="${i.order_item_id}" ${itemFilter===String(i.order_item_id)?'selected':''}>${i.line_no} · ${esc(i.sku)} · ${esc(tr(i.product))} (${n(i.quantity)})</option>`).join('')}</select></label></div>${related.length?`<div class="table-wrap"><table><thead><tr><th>Компонент / поставщик</th><th class="num">По составу заказа</th><th class="num">Открытая потребность</th><th class="num">Доступно на складе</th><th class="num">Общий дефицит</th></tr></thead><tbody>${related.map(c=>`<tr><td><button class="order-link" data-component="${c.component_id}">${esc(c.name)}</button><small>${esc(c.sku)} · ${esc(c.supplier)}</small></td><td class="num">${n(c.ordered_needed)}</td><td class="num">${n(c.open_needed)}</td><td class="num">${n(c.available)}</td><td class="num ${c.shortage?'shortage':''}">${n(c.shortage)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Для выбранной позиции состав компонентов не задан.</div>'}<p class="note bom-note">Открытая потребность — для неотгруженного количества. Доступно и общий дефицит — по всей фабрике, без распределения между заказами.</p></section>`;
}
function orderClaimsPanel(o){
 const rows=(data.detail_claims||data.claims||[]).filter(c=>c.order_id===o.order_id);
 if(!rows.length)return '';
 return `<section class="panel order-claims-panel"><div class="panel-head"><div><h2><span>Рекламации по заказу</span> № ${o.order_id}</h2><p>Статус обращения относится к указанному изделию, а не ко всему заказу.</p></div></div><div class="table-wrap"><table><thead><tr><th>Обращение</th><th>Изделие</th><th>Причина</th><th class="num">Количество</th><th>Статус рекламации</th><th>Возврат товара</th><th>Решение</th></tr></thead><tbody>${rows.map(c=>`<tr><td>RMA-${c.claim_id}<small>${d(c.opened_at)}</small></td><td><span>${esc(c.product)}</span><small>${esc(c.sku)}</small></td><td>${esc(claimReasons[c.reason])}</td><td class="num">${n(c.quantity)}</td><td><span class="badge ${c.claim_status==='closed'?'paid':'partial'}">${claimStates[c.claim_status]}</span></td><td>${c.returned_at?`<span>Возврат принят</span><small>${d(c.returned_at)}</small>`:'<span>Возврат не зарегистрирован</span>'}</td><td>${c.resolution?`<span>${claimResolutions[c.resolution]}</span><small>${d(c.closed_at)}</small>`:'<span>Решение не зарегистрировано</span>'}</td></tr>`).join('')}</tbody></table></div><p class="note">Ниже — исполнение исходного заказа. Возврат изделия не отменяет неотгруженные позиции.</p></section>`;
}
function orderDossier(o){return `<div class="order-dossier">${orderClaimsPanel(o)}${orderDetail(o)}${orderItems(o)}${orderComponents(o)}</div>`;}
function managerName(key){if(!key?.startsWith('manager-'))return null;try{const name=decodeURIComponent(key.slice(8));return name.trim()&&name.length<=100?name:null;}catch{return null;}}
function listTitle(key){const manager=managerName(key);return manager?'Менеджер · '+manager:cardLabels[key];}
function isList(section,key){return cardLists[section].includes(key)||(section==='sales'&&managerName(key)!==null);}
function managers(){
 const grouped=new Map();
 for(const o of monthRows()){if(!grouped.has(o.manager))grouped.set(o.manager,{name:o.manager,ids:new Set(),amount:0});const m=grouped.get(o.manager);if(!m.ids.has(o.order_id)){m.ids.add(o.order_id);m.amount+=Number(o.amount);}}
 return [...grouped.values()].map(m=>({name:m.name,count:m.ids.size,amount:m.amount,key:'manager-'+encodeURIComponent(m.name)})).sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name));
}
function managersPanel(){
 const rows=managers();
 return `<section class="panel managers-panel"><div class="panel-head"><div><h2>Менеджеры по продажам</h2><p>Активные заказы за месяц</p></div></div><div class="table-wrap"><table><thead><tr><th>Менеджер</th><th class="num">Заказы</th><th class="num">Сумма, ₪</th></tr></thead><tbody>${rows.map(m=>`<tr><td><a class="order-link" href="#sales/list/${m.key}" data-list="${m.key}">${esc(m.name)}</a></td><td class="num">${n(m.count)}</td><td class="num">${n(m.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">Итого</th><td class="num">${n(sum(rows,'count'))}</td><td class="num">${n(sum(rows,'amount'))}</td></tr></tfoot></table></div></section>`;
}
function getList(key){
 if(key==='claims'||key.startsWith('claims-')||key.startsWith('claim-'))return {kind:'claims',rows:(data.claims||[]).filter(c=>key==='claims'||key==='claims-open'&&c.claim_status!=='closed'||key==='claims-open-received'&&c.claim_status!=='closed'&&!!c.returned_at||key==='claims-open-unreceived'&&c.claim_status!=='closed'&&!c.returned_at||key==='claims-returned'&&c.returned_at||key==='claims-closed'&&c.claim_status==='closed'||key==='claim-'+c.reason)};
 const rows=active(),scarce=data.supply.filter(c=>c.shortage>0);
 if(key in channelKeys)return {kind:'orders',rows:monthRows().filter(o=>o.channel===channelKeys[key])};
 if(managerName(key)!==null)return {kind:'orders',rows:monthRows().filter(o=>o.manager===managerName(key))};
 if(key==='new-customers'||key.startsWith('new-channel-'))return {kind:'customers',rows:newCustomers(key==='new-customers'?null:channelKeys[key.slice(4)])};
 const paymentFilters={'payment-full':['paid','overpaid'],'payment-partial':['partial'],'payment-none':['unpaid']};
 if(key in paymentFilters)return {kind:'orders',rows:monthRows().filter(o=>paymentFilters[key].includes(o.payment_status))};
 const affected=new Set(scarce.flatMap(c=>c.orders.map(o=>o.order_id)));
 const orderRows={booked:rows,receivable:rows.filter(o=>o.remaining_to_pay>0),open:rows.filter(o=>o.remaining_qty>0),late:rows.filter(o=>o.fulfillment_status==='overdue'),done:rows.filter(o=>o.fulfillment_status==='shipped'),ontime:rows.filter(o=>o.due_date<data.as_of),affected:rows.filter(o=>affected.has(o.order_id))};
 if(key in orderRows)return {kind:'orders',rows:orderRows[key].slice().sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.order_id-b.order_id)};
 if(key==='shortages')return {kind:'components',rows:scarce};
 if(key==='excess')return {kind:'components',rows:data.supply.filter(c=>c.excess>0)};
 if(key==='purchases')return {kind:'purchases',rows:data.supply.flatMap(c=>c.purchases.map(p=>({...p,component_id:c.component_id,name:c.name,sku:c.sku,supplier:c.supplier}))).sort((a,b)=>a.expected_at.localeCompare(b.expected_at)||a.purchase_id-b.purchase_id)};
 return {kind:key,rows:data[key]||[]};
}
function renderList(key){
 const listing=getList(key),kind=listing.kind;
 const rows=kind==='purchases'?listing.rows.filter(r=>inPeriod(r.expected_at)):listing.rows;
 const orderCell=o=>`<button class="order-link" data-order="${o.order_id}">№ ${o.order_id} · ${esc(o.customer)}</button>`;
 const componentCell=c=>`<button class="order-link" data-component="${c.component_id}">${esc(c.name)}</button><small>${esc(c.sku)}</small>`;
 const numeric=(title,field)=>({title,cls:'num',cell:r=>n(r[field])});
 let columns=[],note='',total='';
 if(kind==='orders'){
  columns=[{title:'Заказ / клиент',cell:o=>orderCell(o)+`<small>${d(o.order_date)} · ${esc(o.sku)} · ${esc(o.manager)}</small>`},{title:'Срок',cell:o=>d(o.due_date)},numeric('Сумма, ₪','amount'),numeric('Отгружено, ₪','shipped_amount'),numeric('Оплачено, ₪','paid_amount'),{title:'Статус',cell:o=>badge(o.fulfillment_status)}];
  if(key==='receivable'){columns.splice(5,0,numeric('Осталось оплатить, ₪','remaining_to_pay'));total=`${n(sum(rows,'remaining_to_pay'))} ₪`;}
  if(key.startsWith('payment-'))columns.push({title:'Оплата',cell:o=>badge(o.payment_status)});
  if(key==='booked'||key in channelKeys||managerName(key)!==null)total=`${n(sum(rows,'amount'))} ₪`;
  if(key==='open'){columns.splice(5,0,{title:'Осталось отгрузить, ₪',cls:'num',cell:o=>n(o.amount-o.shipped_amount)});total=`${n(sum(rows,'amount')-sum(rows,'shipped_amount'))} ₪`;}
  if(key==='affected'){
   note='Каждый заказ показан один раз. В списке — компоненты с общим дефицитом.';
   columns.push({title:'Дефицитные компоненты',cell:o=>data.supply.filter(c=>c.shortage>0&&c.orders.some(r=>r.order_id===o.order_id)).map(c=>`<div><button class="order-link" data-component="${c.component_id}">${esc(c.name)}</button></div>`).join('')});
  }
  if(key==='ontime'){
   const ontime=o=>o.remaining_qty===0&&o.last_shipped_at<=o.due_date;
   note='Все заказы со сроком до даты отчёта; рядом — результат проверки срока.';
   columns.push({title:'Исполнено в срок',cell:o=>`<span class="badge ${ontime(o)?'paid':'overdue'}">${ontime(o)?'Да':'Нет'}</span>`});
   total=rows.length?`${Math.round(rows.filter(ontime).length/rows.length*100)}%`:'—';
  }
 }else if(kind==='claims'){
  columns=[{title:'Обращение',cell:c=>`RMA-${c.claim_id}<small>${d(c.opened_at)}</small>`},{title:'Заказ / клиент',cell:orderCell},{title:'Изделие',cell:c=>`<span>${esc(c.product)}</span><small>${esc(c.sku)}</small>`},{title:'Причина',cell:c=>esc(claimReasons[c.reason])},numeric('Количество','quantity'),numeric('Стоимость изделий, ₪','goods_value'),{title:'Статус',cell:c=>`<span class="badge ${c.claim_status==='closed'?'paid':'partial'}">${claimStates[c.claim_status]}</span>`},{title:'Возврат товара',cell:c=>d(c.returned_at)},{title:'Решение',cell:c=>c.resolution?`<span>${claimResolutions[c.resolution]}</span><small>${d(c.closed_at)}</small>`:'—'},{title:'Ответственный',cell:c=>esc(c.manager)}];
  note='Стоимость изделий по цене заказа, не сумма возмещения. Финансовые и складские документы учитываются отдельно.';
 }else if(kind==='customers'){
  columns=[{title:'Клиент',cell:c=>esc(c.customer)},{title:'Первый заказ',cell:c=>d(c.first_order_date)},{title:'Канал',cell:c=>esc(c.channel)},{title:'Менеджер',cell:c=>esc(c.manager)},numeric('Сумма, ₪','amount'),{title:'Заказы',cell:c=>c.orders.map(o=>`<div>${orderCell(o)}</div>`).join('')}];
  note='Новый клиент — первый неотменённый заказ в выбранном периоде. Канал — по первому заказу.';
 }else if(kind==='components'){
  columns=[{title:'Компонент / поставщик',cell:c=>componentCell(c)+`<small>${esc(c.supplier)}</small>`},numeric('На складе','on_hand'),numeric('Внешний резерв','reserved_external'),numeric('Доступно','available'),numeric('Нужно','needed'),numeric(key==='excess'?'Свободный избыток':'Дефицит',key==='excess'?'excess':'shortage')];
  note=key==='excess'?'Избыток = доступно − текущая потребность. Показаны только положительные остатки.':'Показаны только компоненты с дефицитом по текущему расчёту.';
 }else if(kind==='purchases'){
  columns=[{title:'Поставка',cell:p=>`P-${p.purchase_id}`},{title:'Компонент',cell:componentCell},{title:'Поставщик',cell:p=>esc(p.supplier)},numeric('Количество','quantity'),{title:'Ожидаемая дата',cell:p=>d(p.expected_at)+(p.expected_at<data.as_of?'<small class="shortage">дата прошла</small>':'')},{title:'Статус',cell:p=>`<span class="badge ${p.status==='confirmed'?'paid':'partial'}">${p.status==='confirmed'?'подтверждена':'не подтверждена'}</span>`}];
  note='Ожидаемые поступления не добавляются к доступному остатку до фактической приёмки.';
 }else{
  const shipping=kind==='shipments';
  columns=[{title:'Документ',cell:r=>`${shipping?'S':'PAY'}-${r[shipping?'shipment_id':'payment_id']}`},{title:'Дата',cell:r=>d(r[shipping?'shipped_at':'paid_at'])},{title:'Заказ / клиент',cell:orderCell},...(shipping?[{title:'Изделие',cell:r=>`<span>${esc(r.product)}</span><small>${esc(r.sku)}</small>`},numeric('Количество','quantity')]:[]),numeric('Сумма, ₪','amount')];
  total=`${n(sum(rows,'amount'))} ₪`;
  note=shipping?'По фактическим отгрузкам':'Поступления за вычетом возвратов';
 }
 const record=selected!==null?selectedRecord():null;
 return `<div class="drill-view"><button class="back-button" data-dashboard><span class="back-arrow" aria-hidden="true">←</span><span>К дашборду</span></button><div class="${record?'split-view':''}"><section class="panel no-pad"><div class="panel-head"><div><h2>${esc(listTitle(key))}</h2>${note?`<p>${note}</p>`:''}<p class="journal-date-note"><span>${({orders:'Отбор по дате создания заказа',shipments:'Отбор по дате отгрузки',payments:'Отбор по дате оплаты',claims:'Отбор по дате обращения',customers:'Отбор по дате первого заказа',purchases:'Отбор по ожидаемой дате поставки',components:'Остатки и потребность на конец периода'})[kind]}</span> · <span>Состояние на конец периода</span></p></div><div class="list-totals"><span class="badge">Строк: ${rows.length}</span>${total?`<strong>${total}</strong>`:''}</div></div><div class="table-wrap"><table><thead><tr>${columns.map(c=>`<th class="${c.cls||''}" scope="col">${c.title}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td class="${c.cls||''}">${c.cell(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>${rows.length?'':emptyState(kind==='shipments'?'Нет отгрузок за выбранный период.':kind==='payments'?'Нет оплат за выбранный период.':'Нет данных за выбранный период.')}</div></section>${record?recordMarkup(record):''}</div></div>`;
}
function openList(key){
 history.pushState({parent:location.hash},'',`#${page}/list/${key}`);navigate();window.scrollTo({top:0,behavior:'instant'});
}
function openRecord(kind,id){
 const base=listView?`#${page}/list/${listView}`:`#${kind==='order'?'orders':kind==='project'?'projects':'supply'}`;
 history.pushState({parent:location.hash},'',`${base}/${kind}/${id}`);
 navigate();if(settings.detailMode==='drill')window.scrollTo({top:0,behavior:'instant'});
}
function closeRecord(){
 if(history.state?.parent){history.back();}
 else{location.hash=selected!==null&&listView?`#${page}/list/${listView}`:'#'+page;}
}
function selectedRecord(){return selectedKind==='project'?(data.projects||[]).find(p=>p.project_id===selected):selectedKind==='order'?[...data.orders,...(data.related_orders||[])].find(o=>o.order_id===selected):data.supply.find(c=>c.component_id===selected);}
function recordMarkup(record){return selectedKind==='project'?projectDetail(record):selectedKind==='order'?orderDossier(record):componentDetail(record);}

function renderBreadcrumb(){
 const links=[{label:'Аналитика производства',href:'#sales'},{label:labels[page][0],href:'#'+page}];
 if(listView)links.push({label:listTitle(listView),href:`#${page}/list/${listView}`});
 if(selected!==null){const record=data?selectedRecord():null;links.push({label:record?(selectedKind==='order'?'№ '+record.order_id:selectedKind==='project'?'PR-'+record.project_id:record.sku):String(selected),href:location.hash});}
 $('#crumb').innerHTML=links.map((link,i)=>`${i?'<span class="crumb-separator" aria-hidden="true">/</span>':''}<a href="${esc(link.href)}" ${i===links.length-1?'aria-current="page"':''}>${esc(link.label)}</a>`).join('');
}
function chartDayTooltip(point,index,calendarDays){
 const row=(label,value,daily,klass)=>`<div class="chart-tip-row"><span><i class="${klass}"></i>${esc(tr(label))}</span><span class="chart-tip-number"><bdi>${n(daily)} ₪</bdi></span><strong class="chart-tip-number"><bdi>${n(value)} ₪</bdi></strong></div>`;
 const section=(historical)=>{
  const date=historical?point.previousDay:point.day;
  const month=historical?(data.previous_month||data.previous_as_of.slice(0,7)):(data.report_month||data.as_of.slice(0,7));
  const a=historical?point.pa:point.a,b=historical?point.pb:point.b;
  const dailyA=historical?point.dpa:point.da,dailyB=historical?point.dpb:point.db;
  const unavailable=!historical&&index>=calendarDays?'В этом месяце нет такого дня':'Нет фактических данных';
  return `<section class="chart-tip-section ${historical?'historical':'actual'}"><h4><span class="series-sample"></span>${esc(tr(historical?'Прошлый месяц':'Выбранный месяц'))} · ${esc(monthName(month+'-01'))}</h4>${date?`<small>${d(date)}</small><div class="chart-tip-columns"><span></span><span>${esc(tr('За день'))}</span><span>${esc(tr('С начала месяца'))}</span></div>${row('Заказано',a,dailyA,'booked')}${row('Отгружено',b,dailyB,'shipped')}`:`<p>${esc(tr(unavailable))}</p>`}</section>`;
 };
 return `<strong class="chart-tip-title">${esc(tr('День'))} ${index+1}</strong>${section(false)}${settings.ghostComparison?section(true):''}`;
}
let chartHoverController=null;
function bindChartHover(panel){
 chartHoverController?.abort();chartHoverController=new AbortController();
 const svg=panel.querySelector('.chart');if(!svg)return;
 let tooltip=panel.querySelector('.chart-tooltip');
 if(!tooltip){tooltip=document.createElement('div');tooltip.className='chart-tooltip';tooltip.id='chart-hover-tooltip';tooltip.setAttribute('role','tooltip');panel.appendChild(tooltip);}
 tooltip.hidden=true;
 const points=JSON.parse(svg.dataset.points),max=Number(svg.dataset.max),calendarDays=Number(svg.dataset.calendarDays);
 const {width:w,height:h}=svg.viewBox.baseVal,p={l:55,r:18,t:20,b:32};
 let activeIndex=-1;
 const x=i=>p.l+i*(w-p.l-p.r)/Math.max(points.length-1,1),y=v=>h-p.b-v/max*(h-p.t-p.b);
 const hide=()=>{tooltip.hidden=true;svg.querySelector('.chart-hover-layer').innerHTML='';activeIndex=-1;};
 const show=(index,clientX,clientY)=>{
  const v=points[index];if(!v)return;
  activeIndex=index;const cx=x(index),step=(w-p.l-p.r)/Math.max(points.length-1,1);
  const left=Math.max(p.l,cx-step/2),right=Math.min(w-p.r,cx+step/2);
  const markers=[['a','var(--blue)',false],['b','var(--orange)',false],['pa','var(--blue)',true],['pb','var(--orange)',true]].map(([key,color,historical])=>v[key]===null||historical&&!settings.ghostComparison?'':historical?`<rect x="${cx-5}" y="${y(v[key])-5}" width="10" height="10" fill="var(--chart-panel,#fff)" stroke="${color}" stroke-width="2" stroke-dasharray="2 2"/>`:`<circle cx="${cx}" cy="${y(v[key])}" r="4" fill="${color}" stroke="var(--chart-panel,#fff)" stroke-width="2"/>`).join('');
  svg.querySelector('.chart-hover-layer').innerHTML=`<rect x="${left}" y="${p.t}" width="${right-left}" height="${h-p.t-p.b}" fill="var(--blue)" opacity=".07"/><line x1="${cx}" x2="${cx}" y1="${p.t}" y2="${h-p.b}" stroke="var(--muted)" stroke-width="1"/>${markers}`;
  tooltip.innerHTML=chartDayTooltip(v,index,calendarDays);tooltip.hidden=false;
  const bounds=tooltip.getBoundingClientRect(),margin=8;
  const tx=clientX+bounds.width+16<window.innerWidth?clientX+16:clientX-bounds.width-16;
  const ty=clientY+bounds.height+16<window.innerHeight?clientY+16:clientY-bounds.height-16;
  tooltip.style.left=Math.max(margin,Math.min(tx,window.innerWidth-bounds.width-margin))+'px';
  tooltip.style.top=Math.max(margin,Math.min(ty,window.innerHeight-bounds.height-margin))+'px';
 };
 const pointer=e=>{
  const rect=svg.getBoundingClientRect(),px=(e.clientX-rect.left)*w/rect.width,py=(e.clientY-rect.top)*h/rect.height;
  if(px<p.l||px>w-p.r||py<p.t||py>h-p.b){hide();return;}
  show(Math.max(0,Math.min(points.length-1,Math.round((px-p.l)/(w-p.l-p.r)*(points.length-1)))),e.clientX,e.clientY);
 };
 svg.addEventListener('pointermove',pointer);svg.addEventListener('pointerdown',pointer);
 svg.addEventListener('pointerleave',hide);svg.addEventListener('blur',hide);
 const keyboardShow=index=>{const rect=svg.getBoundingClientRect();show(index,rect.left+x(index)*rect.width/w,rect.top+p.t*rect.height/h);};
 svg.addEventListener('focus',()=>{if(activeIndex<0)keyboardShow(Math.max(0,Math.min(points.length-1,Number(data.as_of.slice(-2))-1)));});
 window.addEventListener('scroll',hide,{capture:true,passive:true,signal:chartHoverController.signal});
 svg.addEventListener('keydown',e=>{
  if(e.key==='Escape'){hide();return;}
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  e.preventDefault();keyboardShow(e.key==='Home'?0:e.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,(activeIndex<0?0:activeIndex)+(e.key==='ArrowRight'?1:-1))));
 });
}
let chartObserver=null;
function fitChart(){
 chartObserver?.disconnect();chartObserver=null;chartHoverController?.abort();
 const panel=$('.sales-chart');
 if(!panel)return;
 bindChartHover(panel);
 if(typeof ResizeObserver==='undefined')return;
 let previousSize='';
 chartObserver=new ResizeObserver(()=>{
  const chart=panel.querySelector('.chart');if(!chart)return;
  const w=Math.round(chart.getBoundingClientRect().width),h=Math.round(chart.getBoundingClientRect().height);
  if(w<100||h<60||previousSize===`${w}/${h}`)return;
  previousSize=`${w}/${h}`;chart.outerHTML=cumulativeChart(data.trend,w,h);bindChartHover(panel);localize(panel);
 });
 chartObserver.observe(panel);
}

function syncSidebar(){
 const button=$('#sidebar-toggle'),label=settings.sidebarCollapsed?'Развернуть меню':'Свернуть меню';
 button.setAttribute('aria-expanded',String(!settings.sidebarCollapsed));
 button.setAttribute('aria-label',label);button.setAttribute('title',label);
 button.querySelector('span').textContent=settings.sidebarCollapsed?(settings.language==='he'?'‹':'›'):(settings.language==='he'?'›':'‹');
}
function toggleSidebar(){settings.sidebarCollapsed=!settings.sidebarCollapsed;applyPreferences();render();}

function render(){
 const text=labels[page];$('#title').textContent=text[1];$('#eyebrow').textContent=text[2];$('#subtitle').textContent=text[3];
 document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 if(page==='health'){
  $('#content').innerHTML=healthView();
  $('#freshness').textContent=healthData?'Последний замер: '+healthTime(healthData.checked_at):'Ожидание показателей…';
  $('#health-auto')?.addEventListener('change',e=>{healthAuto=e.target.checked;scheduleHealth();});
 }else if(data){
  const detail=(settings.detailMode==='drill'||selectedKind==='project')&&selected!==null;
  if(detail){
   const record=selectedRecord();
   const backLabel=history.state?.parent?.includes('/')?'Назад':'Назад к списку';
   $('#content').innerHTML=`<div class="drill-view"><button class="back-button" data-close><span aria-hidden="true" class="back-arrow">←</span><span>${backLabel}</span></button>${record?`<div class="full-detail">${recordMarkup(record)}</div>`:'<div class="empty">Запись недоступна на выбранную дату.</div>'}</div>`;

  }else if(listView){$('#content').innerHTML=renderList(listView);}else{$('#content').innerHTML=({sales,orders,supply,projects}[page])();}
  $('#order-item-filter')?.addEventListener('change',e=>{itemFilter=e.target.value;render();});
  document.querySelectorAll('[data-order-item]').forEach(b=>b.addEventListener('click',()=>{itemFilter=b.dataset.orderItem;render();}));
  $('#status-filter')?.addEventListener('change',e=>{statusFilter=e.target.value;selected=null;render();});
  $('#shortage-only')?.addEventListener('change',e=>{shortageOnly=e.target.checked;selected=null;render();});
  document.querySelectorAll('[data-list]').forEach(a=>a.addEventListener('click',e=>{if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();openList(a.dataset.list);}));
  document.querySelectorAll('[data-dashboard]').forEach(b=>b.addEventListener('click',()=>{location.hash='#'+page;}));
  document.querySelectorAll('[data-order]').forEach(b=>b.addEventListener('click',()=>openRecord('order',Number(b.dataset.order))));
  document.querySelectorAll('[data-component]').forEach(b=>b.addEventListener('click',()=>openRecord('component',Number(b.dataset.component))));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeRecord));
  if(page==='projects')bindProjects();
 }
 if(!data&&page!=='health')$('#content').innerHTML=loadingSkeleton();
 if(page!=='health'&&data&&$('#error').hidden)$('#freshness').textContent=freshnessText();
 $('#report-date').hidden=page==='health'||!!listView;
 $('#journal-period').hidden=page==='health'||!listView;
 document.querySelector('[data-page=projects]').hidden=!settings.projectsEnabled;
 renderBreadcrumb();
 syncSidebar();
 $('#comparison-control').hidden=page!=='sales'||!!listView||selected!==null;
 $('#ghost-comparison').checked=settings.ghostComparison;
 fitChart();localize();enhanceTables();
}
async function refresh(){if(page==='health')return refreshHealth();const requestedPeriod=periodQuery();pendingPeriod=requestedPeriod;const id=++requestId;$('#content').setAttribute('aria-busy','true');if(!data)$('#content').innerHTML=loadingSkeleton();$('#refresh').disabled=true;$('#error').hidden=true;try{const response=await fetch('/api/dashboard?'+requestedPeriod);const result=await response.json();if(id!==requestId)return;if(!response.ok)throw new Error(result.error||'Не удалось загрузить данные.');data=result;loadedPeriod=requestedPeriod;render();$('#freshness').textContent=freshnessText();}catch(e){if(id!==requestId)return;$('#error').textContent=e.message;$('#error').hidden=false;$('#freshness').textContent='Обновление не выполнено. Показанные данные могут быть неактуальны.';if(!data)$('#content').innerHTML='<div class="empty">Данные недоступны. После восстановления подключения нажмите обновление.</div>';}finally{if(id===requestId){pendingPeriod='';$('#content').setAttribute('aria-busy','false');$('#refresh').disabled=false;localize();}}}
function navigate(){
 const parts=location.hash.slice(1).split('/');page=labels[parts[0]]?parts[0]:'sales';
 if(page==='projects'&&!settings.projectsEnabled){history.replaceState(null,'','#sales');return navigate();}
 listView=parts[1]==='list'&&isList(page,parts[2])?parts[2]:null;
 const offset=listView?3:1;
 selectedKind=['order','component','project'].includes(parts[offset])?parts[offset]:null;
 selected=selectedKind&&parts.length===offset+2&&/^\d+$/.test(parts[offset+1])?Number(parts[offset+1]):null;
 if(page==='health'){selected=null;listView=null;}
 if(selected===null)selectedKind=null;
 if(page==='health'){$('#error').hidden=true;requestId++;pendingPeriod='';}
 if(page!=='health'&&(!data||loadedPeriod!==periodQuery()||pendingPeriod&&pendingPeriod!==periodQuery())){data=null;refresh();}
 $('#content').setAttribute('aria-busy',pendingPeriod?'true':'false');render();scheduleHealth();
 if(page==='health')refreshHealth();
}
$('#sidebar-toggle').addEventListener('click',toggleSidebar);
$('#ghost-comparison').addEventListener('change',e=>{settings.ghostComparison=e.target.checked;applyPreferences();render();});
$('#refresh').addEventListener('click',refresh);$('#report-month').addEventListener('change',()=>{
 const month=$('#report-month').value;if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return;
 $('#date-from').value=month+'-01';
 const [year,m]=month.split('-').map(Number);$('#date-to').value=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
 refresh();
});
for(const id of ['date-from','date-to'])$('#'+id).addEventListener('change',refresh);window.addEventListener('hashchange',navigate);window.addEventListener('popstate',navigate);
$('#sql-button').addEventListener('click',async()=>{const dialog=$('#sql-dialog');$('#sql-content').textContent='Загрузка запросов…';localize();dialog.showModal();try{if(!queries){const r=await fetch('/api/queries');if(!r.ok)throw new Error();queries=await r.json();}const names=page==='projects'?['projects']:page==='health'?['health_database','health_tables']:selectedKind==='order'?['orders','order_bom']:(listView==='claims'||listView?.startsWith('claims-')||listView?.startsWith('claim-'))?['claims']:listView==='shipments'?['shipments']:listView==='payments'?['payments']:page==='sales'?['orders','trend']:page==='orders'?['orders']:['supply'];$('#sql-content').innerHTML=names.map(name=>`<details open><summary>${({projects:'Проекты и этапы',claims:'Рекламации и возвраты',orders:'Заказы, отгрузки и оплаты',trend:'Динамика по дням',supply:'Потребность в комплектующих',shipments:'Отгрузки',payments:'Платежи',order_bom:'Комплектующие заказа',health_database:'Статистика PostgreSQL',health_tables:'Таблицы и обслуживание'})[name]}</summary><pre><code>${esc(queries[name])}</code></pre></details>`).join('');}catch{$('#sql-content').textContent='Не удалось получить запросы. Попробуйте ещё раз.'}finally{localize();}});
$('#close-sql').addEventListener('click',()=>$('#sql-dialog').close());$('#sql-dialog').addEventListener('click',e=>{if(e.target===$('#sql-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
function updateSettings(){
 settings.projectsEnabled=$('#projects-setting').checked;
 if(!settings.projectsEnabled&&page==='projects'){history.replaceState(null,'','#sales');page='sales';selected=null;selectedKind=null;listView=null;}
 settings.language=$('#language-setting').value;
 settings.theme=$('#theme-setting').value;
 settings.detailMode=$('#detail-setting').value;settings.density=$('#density-setting').value;settings.salesLayout=$('#layout-setting').value;
 applyPreferences();render();
 if(page!=='health'&&data&&$('#error').hidden)$('#freshness').textContent=freshnessText();
 localize();
}
$('#settings-button').addEventListener('click',()=>{
 $('#projects-setting').checked=settings.projectsEnabled;
 $('#language-setting').value=settings.language;$('#theme-setting').value=settings.theme;$('#detail-setting').value=settings.detailMode;$('#density-setting').value=settings.density;$('#layout-setting').value=settings.salesLayout;
 localize();$('#settings-dialog').showModal();
});
for(const id of ['projects-setting','language-setting','theme-setting','detail-setting','density-setting','layout-setting'])$('#'+id).addEventListener('change',updateSettings);
for(const id of ['close-settings','done-settings'])$('#'+id).addEventListener('click',()=>$('#settings-dialog').close());
$('#settings-dialog').addEventListener('click',e=>{if(e.target===e.currentTarget){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
document.addEventListener('visibilitychange',()=>{if(page==='health'&&!document.hidden)refreshHealth();else scheduleHealth();});
navigate();

// Optional browser tooling: expose only the same read-only results visible in the UI.
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();
 try{Promise.resolve(document.modelContext.registerTool({
  name:'read_training_dashboard', title:'Прочитать учебный дашборд',
  description:'Read the currently loaded dashboard data and filters. Does not change data or navigate.',
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  annotations:{readOnlyHint:true,untrustedContentHint:true},
  execute(input){
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('Expected an empty object.');
   if(page==='health'){if(!healthData)throw new Error('Health data is not loaded.');return {page,preferences:{...settings},load_error:healthError,health:healthData};}
   if(!data)throw new Error('Dashboard data is not loaded.');
   return {page,preferences:{...settings},as_of:data.as_of,requested_period:periodQuery(),load_error:$('#error').hidden?null:$('#error').textContent,
    status_filter:statusFilter,shortage_only:shortageOnly,selected_id:selected,list_view:listView,order_item_filter:itemFilter,
    rows:page==='projects'?(data.projects||[]):listView?getList(listView).rows:page==='supply'?data.supply.filter(c=>!shortageOnly||c.shortage>0):page==='orders'?data.orders.filter(o=>statusFilter==='all'||o.fulfillment_status===statusFilter):active()};
  }
 },{signal:lifecycle.signal})).catch(()=>{});}catch{}
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
