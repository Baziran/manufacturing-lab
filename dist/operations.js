'use strict';
let opsData=null,opsAudit=[],opsProtocols={status:'not_configured',rows:[]},opsError=false;
let auditOrder='',auditEntity='',auditDate='';
const opText=s=>esc(tr(s));
function opBadge(status){const labels={ok:'Успешно',running:'Выполняется',failed:'Ошибка',not_configured:'Не настроено',unavailable:'Недоступно'};return `<span class="badge ${status==='ok'?'paid':status==='failed'?'overdue':''}">${opText(labels[status]||'Нет запусков')}</span>`;}
function operationsView(){
 const s=opsData,j=s?.jobs||{}, names={backup:'Логическая копия · PostgreSQL + MongoDB',base:'Физическая копия PostgreSQL',restore:'Проверка восстановления двух БД',pitr:'Восстановление до изменения · PITR'};
 return `<section class="panel operations-panel"><div class="panel-head"><div><h2>${opText('Резервирование и восстановление')}</h2><p>${opText('Один сервер · внешняя копия отключена')}</p></div>${opBadge(opsError?'unavailable':s?.status==='ok'?'ok':s?.status==='warning'?'failed':'not_configured')}</div>
 ${s?.stale?`<p class="error">${opText('Сведения о заданиях устарели или недоступны')}</p>`:''}
 <div class="table-wrap"><table><thead><tr>${['Задание','Состояние','Последний успех','Длительность, с','Размер','Копия'].map(x=>`<th>${opText(x)}</th>`).join('')}</tr></thead><tbody>${Object.entries(names).map(([key,name])=>{const row=j[key]||{};return `<tr><td>${opText(name)}</td><td>${opBadge(row.status)}</td><td>${healthDate(row.last_success)}</td><td class="num">${row.duration_seconds??'—'}</td><td>${bytes(row.result?.bytes)}</td><td><bdi>${esc(row.result?.backup_id||'—')}</bdi></td></tr>`;}).join('')}</tbody></table></div>
 ${healthPairs([['WAL',`${esc(s?.wal?.mode||'—')} · ${bytes(s?.wal?.bytes)}`],['Последний архив WAL',healthDate(s?.wal?.last_archived_at)],['Неудачные попытки архивации',n(s?.wal?.failed_count)],['Последняя ошибка WAL',healthDate(s?.wal?.last_failed_at)],['Копий: логических / физических',`${s?.logical_count??'—'} / ${s?.physical_count??'—'}`],['Свободно на сервере',bytes(s?.free_bytes)]])}
 <p class="note">${opText('Cron · UTC: копия каждый час :05; физическая 01:20; проверка восстановления 02:35; PITR по воскресеньям 03:45; состояние каждые 5 минут.')}</p>
 <p class="note">${opText('Администрирование только через SSH. Копии на этом сервере не защищают от потери самого сервера.')}</p></section>
 <section class="panel operations-panel"><div class="panel-head"><div><h2>${opText('Журнал изменений')}</h2><p>${opText('Последние 100 событий · фактическое время записи · учебные исполнители')}</p></div></div>
 <div class="ops-filters"><label>${opText('Заказ')}<input id="audit-order" type="number" min="1" value="${esc(auditOrder)}" placeholder="108"></label><label>${opText('Объект')}<select id="audit-entity"><option value="">${opText('Все')}</option><option value="operations.demo_orders" ${auditEntity==='operations.demo_orders'?'selected':''}>${opText('Учебная копия')}</option><option value="public.orders" ${auditEntity==='public.orders'?'selected':''}>${opText('Исходные заказы')}</option></select></label><label>${opText('С даты')}<input type="date" id="audit-date" value="${esc(auditDate)}"></label></div>
 <div id="audit-table">${auditTable(opsAudit.filter(r=>(!auditOrder||r.order_id===Number(auditOrder))&&(!auditEntity||r.entity===auditEntity)&&(!auditDate||r.changed_at.slice(0,10)>=auditDate)))}</div>
 <p class="note">${opText('Изменения учебных копий не меняют суммы и сроки исходных заказов. Аудит атомарен с записью; администратор БД не ограничен этим журналом.')}</p></section>
 <section class="panel operations-panel"><div class="panel-head"><div><h2>${opText('Протоколы испытаний · MongoDB')}</h2><p>${opText('Синтетические измерения · отдельный документ на каждую попытку')}</p></div>${opBadge(opsProtocols.status)}</div>${protocolTable(opsProtocols.rows||[])}</section>`;
}
function auditTable(rows){
 if(!rows.length)return `<div class="empty">${opText('Событий по выбранному фильтру нет')}</div>`;
 return `<div class="table-wrap"><table><thead><tr>${['Время','Заказ','Объект','Изменения','Исполнитель','Причина','Согласовал'].map(x=>`<th>${opText(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>{const a=r.before_data||{},b=r.after_data||{},keys=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));return `<tr><td>${healthDate(r.changed_at)}</td><td><a class="order-link" href="#orders/order/${r.order_id}">№ ${r.order_id}</a></td><td>${opText(r.entity==='operations.demo_orders'?'Учебная копия':'Исходные заказы')}<small><bdi>${esc(r.action)} · tx ${r.transaction_id}</bdi></small></td><td>${keys.map(k=>`<div><bdi>${esc(k)}</bdi>: <bdi>${esc(a[k]??'—')}</bdi> → <bdi>${esc(b[k]??'—')}</bdi></div>`).join('')}</td><td>${esc(r.actor)}<small><bdi>${esc(r.database_user)}</bdi></small></td><td>${esc(r.reason)}</td><td>${esc(r.approved_by)||'—'}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function protocolTable(rows){
 if(!rows.length)return `<div class="empty">${opText('Протоколов на выбранную дату нет')}</div>`;
 return `<div class="table-wrap"><table><thead><tr>${['Протокол','Заказ','Серийный номер','Время','Результат','Метод / версия','Измерения'].map(x=>`<th>${opText(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td><bdi>${esc(r._id)}</bdi></td><td><a class="order-link" href="#orders/order/${r.order_id}">№ ${r.order_id}</a></td><td><bdi>${esc(r.serial)}</bdi><small>${opText('Версия конфигурации')}: ${esc(r.configuration_version)}</small></td><td>${healthDate(r.tested_at)}</td><td><span class="badge ${r.result==='passed'?'paid':'overdue'}">${opText(r.result==='passed'?'Тест пройден':'Тест не пройден')}</span></td><td>${esc(r.method)} / ${esc(r.method_version)}</td><td>${(r.measurements||[]).map(m=>`<div><bdi>${esc(m.name)}: ${esc(m.value)} ${esc(m.unit)} [${esc(m.min??'—')}…${esc(m.max??'—')}]</bdi></div>`).join('')}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindOperations(){
 for(const [id,set] of [['audit-order',v=>auditOrder=v],['audit-entity',v=>auditEntity=v],['audit-date',v=>auditDate=v]]){
  document.getElementById(id)?.addEventListener('change',e=>{set(e.target.value);render();});
 }
}
async function refreshOperations(){
 const results=await Promise.allSettled(['/api/operations','/api/audit','/api/protocols'].map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error();return r.json();}));
 opsError=results.some(r=>r.status==='rejected');
 opsData=results[0].status==='fulfilled'?results[0].value:null;
 opsAudit=results[1].status==='fulfilled'?results[1].value.rows:[];
 opsProtocols=results[2].status==='fulfilled'?results[2].value:{status:'unavailable',rows:[]};
}
async function loadOrderEvidence(){
 const holder=document.getElementById('order-evidence');if(!holder)return;
 const id=holder.dataset.order,date=data.as_of;
 const results=await Promise.allSettled([`/api/audit?order_id=${id}`,`/api/protocols?order_id=${id}&as_of=${date}`].map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error();return r.json();}));
 if(!holder.isConnected)return;
 holder.innerHTML=`<h2>${opText('История изменений · текущее состояние')}</h2><p class="note">${opText('Учебные копии показаны отдельно от исходных заказов')}</p>${results[0].status==='fulfilled'?auditTable(results[0].value.rows):opText('Недоступно')}<h2>${opText('Протоколы испытаний · MongoDB')}</h2>${results[1].status==='fulfilled'?protocolTable(results[1].value.rows):opText('Недоступно')}`;
 localize(holder);enhanceTables();
}
