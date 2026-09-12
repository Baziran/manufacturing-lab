'use strict';
function loadingSkeleton(){
 return `<div class="skeleton-screen" role="status" aria-label="${tr('Загружаем данные…')}"><span class="sr-only">${tr('Загружаем данные…')}</span><div aria-hidden="true"><div class="metrics">${Array.from({length:4},()=>'<div class="metric skeleton-card"><i class="skeleton-line short"></i><i class="skeleton-line value"></i><i class="skeleton-line"></i></div>').join('')}</div><div class="panel skeleton-chart"></div><div class="panel skeleton-table">${Array.from({length:5},()=>'<i class="skeleton-line"></i>').join('')}</div></div></div>`;
}
function emptyState(message='Нет данных на выбранную дату.',hint='Попробуйте изменить дату или фильтр.'){
 return `<div class="empty empty-state" role="status"><span class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 7l9-4 9 4v10l-9 4-9-4Z M3 7l9 4 9-4 M12 11v10 M7 5l9 4"/></svg></span><strong>${esc(tr(message))}</strong><span>${esc(tr(hint))}</span></div>`;
}
function trendIndicator(current,previous,goodDirection='up'){
 if(previous===0&&current!==0)return `<span class="trend-change neutral">${tr('Нет базы для сравнения')}</span>`;
 const delta=previous===0?0:(current-previous)/Math.abs(previous)*100;
 const direction=delta>0?'up':delta<0?'down':'flat';
 const good=goodDirection==='neutral'||direction==='flat'?'neutral':direction===goodDirection?'ahead':'behind';
 const value=new Intl.NumberFormat(locales[settings.language],{maximumFractionDigits:1}).format(Math.abs(delta));
 return `<span class="trend-change ${good}"><span aria-hidden="true">${delta>0?'▲':delta<0?'▼':'＝'}</span> <span>${value}%</span><span class="sr-only"> · ${tr(delta>0?'Рост':delta<0?'Снижение':'Без изменений')}</span><span class="trend-context"> ${tr('к августу')}</span></span>`;
}
function csvCell(value){
 let text=String(value??'');
 if(/^\s*[=+@-]/.test(text)&&!/^\s*-?\d+(?:[.,]\d+)?\s*$/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
function makeCSV(rows){return '\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n';}
function exportNumber(text,language){
 const normalized=text.replace(/[\s\u00a0\u202f]/g,'');
 const value=language==='ru'?normalized.replace(',','.'):normalized.replace(/,/g,'');
 return /^-?\d+(?:\.\d+)?$/.test(value)?(language==='ru'?value.replace('.',','):value):text;
}
function downloadTable(table,title){
 const rows=[...table.rows].filter(row=>!row.hidden).map(row=>[...row.cells].map(cell=>{
  const text=cell.innerText.trim().replace(/\n+/g,' · ');
  return cell.tagName==='TD'&&cell.classList.contains('num')?exportNumber(text,settings.language):text;
 }));
 const url=URL.createObjectURL(new Blob([makeCSV(rows)],{type:'text/csv;charset=utf-8;'}));
 const link=document.createElement('a');link.href=url;
 link.download=`${title.replace(/[^\p{L}\p{N}_-]+/gu,'-')}-${page==='health'?'live':data?.as_of||'data'}.csv`;
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function enhanceTables(){
 document.querySelectorAll('#content table').forEach(table=>{
  const section=table.closest('.panel,.order-components,.full-detail')||table.parentElement;
  const title=section.querySelector('h2,h3')?.textContent?.trim()||tr('Таблица');
  const header=section.querySelector('.panel-head');
  const button=document.createElement('button');button.type='button';button.className='export-button';
  button.title=tr('Скачать CSV для Excel');button.setAttribute('aria-label',tr('Скачать CSV для Excel')+' · '+title);
  button.innerHTML='<span aria-hidden="true">↓</span> CSV';
  button.disabled=!table.tBodies[0]?.rows.length;
  button.addEventListener('click',()=>downloadTable(table,title));
  if(header)header.append(button);else table.parentElement.before(button);
  if(!table.tBodies[0]?.rows.length&&!table.parentElement.querySelector('.empty')){
   const shipping=listView==='shipments',payments=listView==='payments';
   table.insertAdjacentHTML('afterend',emptyState(shipping?'Нет отгрузок за выбранный период.':payments?'Нет оплат за выбранный период.':'Нет данных на выбранную дату.'));
  }
 });
 document.querySelectorAll('#content .empty:not(.empty-state)').forEach(node=>{node.innerHTML=`<span class="empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 7l9-4 9 4v10l-9 4-9-4Z M3 7l9 4 9-4 M12 11v10 M7 5l9 4"/></svg></span><strong>${esc(node.textContent)}</strong><span>${esc(tr(page==='health'?'Повторите обновление после восстановления связи.':'Попробуйте изменить дату или фильтр.'))}</span>`;node.classList.add('empty-state');node.setAttribute('role','status');});
}
