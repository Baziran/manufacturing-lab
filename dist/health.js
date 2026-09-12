'use strict';
let healthData=null,healthBusy=false,healthError=false,healthTimer=null,healthAuto=true,healthHistory=[];
const bytes=v=>v===null||v===undefined?'—':new Intl.NumberFormat(locales[settings.language],{maximumFractionDigits:1}).format(v/(v>=1073741824?1073741824:v>=1048576?1048576:1024))+' '+(v>=1073741824?'GiB':v>=1048576?'MiB':'KiB');
const decimal=v=>v===null||v===undefined?'—':new Intl.NumberFormat(locales[settings.language],{maximumFractionDigits:1}).format(v);
const healthTime=v=>v?new Date(v).toLocaleTimeString(locales[settings.language],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const healthDate=v=>v?new Date(v).toLocaleString(locales[settings.language]):'—';
function elapsed(v){if(v==null)return '—';const sec=Math.floor(v);return `${Math.floor(sec/3600)}:${String(Math.floor(sec%3600/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function healthMetric(label,value,note,klass=''){return `<article class="metric ${klass}"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`;}
function healthPairs(rows){return `<dl class="health-pairs">${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;}
function healthSpark(key,title,unit){
 const points=healthHistory.filter(r=>r[key]!=null);
 if(points.length<2)return `<div class="health-chart-empty">Нужно минимум два замера.</div>`;
 const w=480,h=100,pad=18,max=Math.max(1,...points.map(p=>p[key]))*1.15,start=points[0].at,end=points[points.length-1].at;
 const x=p=>pad+(p.at-start)/Math.max(1,end-start)*(w-pad*2),y=p=>h-pad-p[key]/max*(h-pad*2);
 return `<svg class="health-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><path d="${points.map((p,i)=>`${i?'L':'M'}${x(p)},${y(p)}`).join(' ')}" fill="none" stroke="var(--blue)" stroke-width="2"/>${points.map(p=>`<circle cx="${x(p)}" cy="${y(p)}" r="3" fill="var(--blue)"><title>${healthTime(p.at)} · ${decimal(p[key])} ${unit}</title></circle>`).join('')}<text x="${pad}" y="${h-1}">${healthTime(start)}</text><text x="${w-pad}" y="${h-1}" text-anchor="end">${healthTime(end)}</text></svg>`;
}
function healthView(){
 if(!healthData)return healthError?'<div class="error">Нет связи с приложением. Повторите обновление.</div>':loadingSkeleton();
 const a=healthData.app,b=healthData.database,diskPct=a.disk_used_bytes/a.disk_total_bytes*100;
 const connectionPct=b?b.server_connections/b.max_connections*100:0;
 const warning=healthError?'<div class="error">Обновление не выполнено. Показаны предыдущие замеры.</div>':!b?'<div class="error">Приложение доступно, но состояние PostgreSQL прочитать не удалось.</div>':'';
 return `${warning}<div class="health-controls"><span class="badge ${healthError||!b?'overdue':'paid'}">${healthError?'Данные устарели':b?'Сервисы доступны':'Проблема с БД'}</span><label class="checkbox-label"><input type="checkbox" id="health-auto" ${healthAuto?'checked':''}>Обновлять каждые 15 секунд</label></div><div class="metrics">${healthMetric('Проверка PostgreSQL',b?decimal(healthData.probe_ms)+' ms':'—','Получение соединения и SELECT 1',b?'emphasis':'warn')}${healthMetric('Размер БД',b?bytes(b.size_bytes):'—','Таблицы, индексы и служебные данные')}${healthMetric('Соединения этой БД',b?n(b.connections):'—',b?`${tr('Все БД / лимит сервера')}: ${n(b.server_connections)} / ${n(b.max_connections)}`:'—',connectionPct>=80?'warn':'')}${healthMetric('Память приложения',bytes(a.rss_bytes),'RSS процесса Python')}</div>
 <div class="health-grid"><section class="panel"><div class="panel-head"><h2>Контейнер приложения</h2><span class="badge">Python</span></div>${healthPairs([['Время работы · ч:м:с',elapsed(a.uptime_seconds)],['CPU · % одного ядра',decimal(a.cpu_pct)],['Память контейнера',bytes(a.container_memory_bytes)],['Лимит памяти',a.container_limit_bytes?bytes(a.container_limit_bytes):'Не задан'],['Потоки приложения',n(a.threads)],['Свободно на файловой системе',bytes(a.disk_free_bytes)]])}<div class="health-disk"><div><span>Занято на файловой системе</span><strong class="${diskPct>=90?'shortage':''}">${decimal(diskPct)}%</strong></div><div class="progress"><div style="width:${Math.min(diskPct,100)}%"></div></div></div><p class="note">Показатели контейнера приложения в Docker. Это не память Mac и не свободное место тома PostgreSQL.</p></section>
 <section class="panel"><div class="panel-head"><h2>PostgreSQL</h2><span class="badge">${b?esc(b.version):'—'}</span></div>${b?healthPairs([['База данных',esc(b.name)],['Время работы · ч:м:с',elapsed(b.uptime_seconds)],['Попадания в буферный кеш',b.cache_hit_pct==null?'—':decimal(b.cache_hit_pct)+'%'],['Зафиксированные транзакции',n(b.commits)],['Откаты транзакций',n(b.rollbacks)],['Ожидающие блокировки',n(b.waiting_locks)],['Взаимоблокировки',n(b.deadlocks)],['Временные файлы',`${n(b.temp_files)} · ${bytes(b.temp_bytes)}`],['Сброс статистики',healthDate(b.stats_reset)]]):'<div class="empty">Показатели БД недоступны.</div>'}<p class="note">Счётчики накопительные с последнего сброса. Откат транзакции не обязательно означает ошибку.</p></section></div>
 <section class="panel health-history"><div class="panel-head"><div><h2>Последние замеры</h2><p>История накапливается, пока открыт раздел; последние 40 замеров.</p></div><span class="badge">${healthHistory.length}</span></div><div class="health-grid"><div><h3>Время проверки БД, ms</h3>${healthSpark('probe_ms','Время проверки БД, ms','ms')}</div><div><h3>CPU приложения, % одного ядра</h3>${healthSpark('cpu_pct','CPU приложения, % одного ядра','%')}</div></div></section>
 <section class="panel no-pad health-tables"><div class="panel-head"><div><h2>Таблицы и обслуживание</h2><p>Количество строк — оценка PostgreSQL, а не точный пересчёт.</p></div></div><div class="table-wrap"><table><thead><tr><th>Таблица</th><th class="num">Размер</th><th class="num">Индексы</th><th class="num">Живые строки ≈</th><th class="num">Мёртвые строки ≈</th><th class="num">Последовательные сканирования</th><th class="num">Индексные сканирования</th><th>Последний VACUUM</th><th>Последний ANALYZE</th></tr></thead><tbody>${healthData.tables.map(t=>{const latest=(x,y)=>x&&y?(x>y?x:y):x||y;return `<tr><td>${esc(t.name)}</td><td class="num">${bytes(t.total_bytes)}</td><td class="num">${bytes(t.index_bytes)}</td><td class="num">${n(t.estimated_rows)}</td><td class="num">${n(t.dead_rows)}</td><td class="num">${n(t.seq_scan)}</td><td class="num">${n(t.index_scan)}</td><td>${healthDate(latest(t.last_vacuum,t.last_autovacuum))}</td><td>${healthDate(latest(t.last_analyze,t.last_autoanalyze))}</td></tr>`;}).join('')}</tbody></table>${b?'':'<div class="empty">Показатели БД недоступны.</div>'}</div></section>`;
}
function scheduleHealth(){
 clearTimeout(healthTimer);healthTimer=null;
 if(page==='health'&&healthAuto&&!document.hidden&&!healthBusy)healthTimer=setTimeout(refreshHealth,15000);
}
async function refreshHealth(){
 if(healthBusy)return;healthBusy=true;$('#content').setAttribute('aria-busy','true');clearTimeout(healthTimer);$('#refresh').disabled=true;
 try{
  const response=await fetch('/api/health',{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error();
  healthData=await response.json();healthError=false;
  const at=new Date(healthData.checked_at).getTime();
  if(healthHistory.at(-1)?.at!==at){healthHistory.push({at,probe_ms:healthData.probe_ms,cpu_pct:healthData.app.cpu_pct});healthHistory=healthHistory.slice(-40);}
 }catch{healthError=true;}
 finally{healthBusy=false;if(page==='health'){$('#content').setAttribute('aria-busy','false');$('#refresh').disabled=false;render();}scheduleHealth();}
}
