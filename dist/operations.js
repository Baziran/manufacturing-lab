'use strict';
let opsData=null,opsAudit=[],opsProtocols={status:'not_configured',rows:[]},opsError=false;
let auditOrder='',auditEntity='',auditDate='',healthAuditExpanded=false;
const protocolRecords=new Map();
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
 <section class="panel operations-panel"><div class="panel-head"><div><h2>${opText('Протоколы испытаний · MongoDB')}</h2><p>${opText('Синтетические измерения · отдельный документ на каждую попытку')}</p></div>${opBadge(opsProtocols.status)}</div>${protocolTable(opsProtocols.rows||[])}</section>
 <details id="health-audit" class="panel operations-panel audit-history" ${healthAuditExpanded?'open':''}><summary><h2>${opText('Журнал изменений')}</h2></summary><div class="audit-body"><p>${opText('Последние 100 событий · фактическое время записи · учебные исполнители')}</p>
 <div class="ops-filters"><label>${opText('Заказ')}<input id="audit-order" type="number" min="1" value="${esc(auditOrder)}" placeholder="108"></label><label>${opText('Объект')}<select id="audit-entity"><option value="">${opText('Все')}</option><option value="operations.demo_orders" ${auditEntity==='operations.demo_orders'?'selected':''}>${opText('Учебная копия')}</option><option value="public.orders" ${auditEntity==='public.orders'?'selected':''}>${opText('Исходные заказы')}</option></select></label><label>${opText('С даты')}<input type="date" id="audit-date" value="${esc(auditDate)}"></label></div>
 <div id="audit-table">${auditTable(opsAudit.filter(r=>(!auditOrder||r.order_id===Number(auditOrder))&&(!auditEntity||r.entity===auditEntity)&&(!auditDate||r.changed_at.slice(0,10)>=auditDate)))}</div>
 <p class="note">${opText('Изменения учебных копий не меняют суммы и сроки исходных заказов. Аудит атомарен с записью; администратор БД не ограничен этим журналом.')}</p></div></details>
`;
}
function evidenceOrderLink(id){
 return selectedKind==='order'&&selected===id?`<bdi>№ ${id}</bdi>`:`<a class="order-link" href="#orders/order/${id}">№ ${id}</a>`;
}
function auditTable(rows){
 if(!rows.length)return `<div class="empty">${opText('Событий по выбранному фильтру нет')}</div>`;
 return `<div class="table-wrap"><table><thead><tr>${['Время','Заказ','Объект','Изменения','Исполнитель','Причина','Согласовал'].map(x=>`<th>${opText(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>{const a=r.before_data||{},b=r.after_data||{},keys=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));return `<tr><td>${healthDate(r.changed_at)}</td><td>${evidenceOrderLink(r.order_id)}</td><td>${opText(r.entity==='operations.demo_orders'?'Учебная копия':'Исходные заказы')}<small><bdi>${opText(({INSERT:"Создано",UPDATE:"Изменено",DELETE:"Удалено"})[r.action]||r.action)} · tx ${r.transaction_id}</bdi></small></td><td>${keys.map(k=>`<div><bdi>${esc(k)}</bdi>: <bdi>${esc(a[k]??'—')}</bdi> → <bdi>${esc(b[k]??'—')}</bdi></div>`).join('')}</td><td>${esc(r.actor)}<small><bdi>${esc(r.database_user)}</bdi></small></td><td>${opText(({"Demo: created order copy":"Создана учебная копия заказа","Demo: shipment deadline moved for additional testing":"Срок отгрузки перенесён для дополнительных испытаний","Demo: copy status changed after planning review":"Статус учебной копии изменён после проверки плана"})[r.reason]||r.reason)}</td><td>${esc(r.approved_by)||'—'}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function protocolAttachments(r){
 return (r.attachments||[]).filter(a=>/^\/protocols\/[A-Za-z0-9_-]+\.pdf$/.test(a.url)).map(a=>`<a class="protocol-pdf" href="${esc(a.url)}" target="_blank" rel="noopener" aria-label="${opText('Открыть PDF протокола')} · ${esc(r._id)}">PDF ↗</a>`).join(' ');
}
function protocolTable(rows){
 for(const row of rows)protocolRecords.set(row._id,row);
 if(!rows.length)return `<div class="empty">${opText('Протоколов на выбранную дату нет')}</div>`;
 return `<div class="table-wrap"><table><thead><tr>${['Протокол','Заказ','Серийный номер','Время','Результат','Метод / версия','Измерения'].map(x=>`<th>${opText(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td><button type="button" class="order-link protocol-link" data-protocol="${esc(r._id)}" aria-haspopup="dialog"><bdi>${esc(r._id)}</bdi></button> ${protocolAttachments(r)}</td><td>${evidenceOrderLink(r.order_id)}</td><td><bdi>${esc(r.serial)}</bdi><small>${opText('Версия конфигурации')}: ${esc(r.configuration_version)}</small></td><td>${healthDate(r.tested_at)}</td><td><span class="badge ${r.result==='passed'?'paid':'overdue'}">${opText(r.result==='passed'?'Тест пройден':'Тест не пройден')}</span></td><td>${esc(r.method)} / ${esc(r.method_version)}</td><td>${(r.measurements||[]).map(m=>`<div><bdi>${esc(m.name)}: ${esc(m.value)} ${esc(m.unit)} [${esc(m.min??'—')}…${esc(m.max??'—')}]</bdi></div>`).join('')}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindOperations(){
 document.getElementById('health-audit')?.addEventListener('toggle',e=>{healthAuditExpanded=e.target.open;});
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
 const id=holder.dataset.evidenceOrder,date=data.as_of;
 const results=await Promise.allSettled([`/api/audit?order_id=${id}`,`/api/protocols?order_id=${id}&as_of=${date}`].map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error();return r.json();}));
 if(!holder.isConnected)return;
 holder.innerHTML=`<section class="panel operations-panel"><h2>${opText('Протоколы испытаний · MongoDB')}</h2>${results[1].status==='fulfilled'?protocolTable(results[1].value.rows):opText('Недоступно')}</section><details class="panel operations-panel audit-history"><summary><h2>${opText('История изменений · текущее состояние')}</h2></summary><div class="audit-body"><p class="note">${opText('Учебные копии показаны отдельно от исходных заказов')}</p>${results[0].status==='fulfilled'?auditTable(results[0].value.rows):opText('Недоступно')}</div></details>`;
 localize(holder);enhanceTables(holder);bindProtocolLinks(holder);
}

function measurementOutcome(m){
 if(typeof m.value!=='number'||(m.min==null&&m.max==null))return 'Без оценки';
 return (m.min!=null&&m.value<m.min)||(m.max!=null&&m.value>m.max)?'Вне допуска':'В допуске';
}
function protocolDetailMarkup(r){
 const fields=[['Заказ',r.order_id],['Серийный номер',r.serial],['Время',healthDate(r.tested_at)],['Версия конфигурации',r.configuration_version],['Метод / версия',`${r.method} / ${r.method_version}`],['Оператор испытания',r.operator]];
 return `<div class="dialog-heading"><h2 id="protocol-title">${opText('Протокол')} <bdi>${esc(r._id)}</bdi></h2><button type="button" class="icon-button" data-protocol-close aria-label="${opText('Закрыть протокол')}" autofocus>×</button></div>
 <p>${protocolAttachments(r)} <span class="badge ${r.result==='passed'?'paid':'overdue'}">${opText(r.result==='passed'?'Тест пройден':'Тест не пройден')}</span></p>
 <dl class="protocol-fields">${fields.map(([key,value])=>`<div><dt>${opText(key)}</dt><dd><bdi>${esc(value??'—')}</bdi></dd></div>`).join('')}</dl>
 <h3>${opText('Измерения')}</h3><div class="table-wrap"><table><thead><tr>${['Параметр','Значение','Единица','Минимум','Максимум','Оценка'].map(s=>`<th>${opText(s)}</th>`).join('')}</tr></thead><tbody>${(r.measurements||[]).map(m=>`<tr><td>${opText(m.name)}</td><td class="num">${esc(m.value)}</td><td><bdi>${esc(m.unit)}</bdi></td><td class="num">${esc(m.min??'—')}</td><td class="num">${esc(m.max??'—')}</td><td><span class="badge ${measurementOutcome(m)==='Вне допуска'?'overdue':measurementOutcome(m)==='В допуске'?'paid':''}">${opText(measurementOutcome(m))}</span></td></tr>`).join('')}</tbody></table></div>
 <h3>${opText('Примечание к испытанию')}</h3><p class="protocol-notes">${opText(({'Synthetic test protocol':'Учебный протокол испытания','Retest after replacement; demo protocol, not a shipping instruction':'Повторное испытание после замены. Учебный протокол, не разрешение на отгрузку.'})[r.notes]||r.notes||'—')}</p>`;
}
function bindProtocolLinks(root=document){
 root.querySelectorAll('button[data-protocol]').forEach(button=>button.addEventListener('click',event=>{
  event.stopPropagation();
  const record=protocolRecords.get(button.dataset.protocol);if(!record)return;
  const dialog=document.createElement('dialog');dialog.className='protocol-dialog';dialog.setAttribute('aria-labelledby','protocol-title');
  dialog.innerHTML=protocolDetailMarkup(record);document.body.append(dialog);
  dialog.querySelector('[data-protocol-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{dialog.remove();if(button.isConnected)button.focus({preventScroll:true});},{once:true});
  dialog.showModal();
 }));
}
