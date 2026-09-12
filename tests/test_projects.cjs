const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const ctx=vm.createContext({console,Intl,Date,Set,Map,WeakMap,URLSearchParams,localStorage:{getItem:()=>null,setItem(){}},document:{documentElement:{dataset:{}},querySelector:()=>({addEventListener(){}})}});
for(const file of ['i18n.js','ux.js','projects.js','app.js']){
 let source=fs.readFileSync(path.join(__dirname,'../dist',file),'utf8');
 if(file==='app.js')source=source.slice(0,source.indexOf("$('#refresh').addEventListener"));
 vm.runInContext(source,ctx);
}
const run=s=>vm.runInContext(s,ctx);
assert.equal(run('settings.projectsEnabled'),true);
ctx.fixture={project_id:1,order_id:108,title:'Система охлаждения и сервисные комплекты',owner:'Михаил',customer:'Test company',started_at:'2026-09-08',deadline:'2026-09-16',forecast_at:'2026-09-18',completed_at:null,progress:25,done_count:2,stage_count:6,order_amount:5000,project_status:'risk',stages:Array.from({length:6},(_,i)=>({stage_no:i+1,title:'Технические требования',owner:'Анна',planned_start:'2026-09-08',planned_end:'2026-09-16',weight:10,depends_on:i||null,acceptance:'Требования согласованы с заказчиком',stage_status:i<2?'done':i===2?'blocked':'waiting',block_reason:i===2?'Не подтверждён срок поставки радиаторов':null}))};
run('data={projects:[fixture],orders:[],related_orders:[],order_bom:[],supply:[]};selectedKind="project";selected=1');
assert.equal(run('selectedRecord().project_id'),1);
for(const language of ['ru','en','he']){
 run(`settings.language='${language}'`);
 const html=run('projects()+projectDetail(fixture)');
 assert(!html.includes('undefined')&&!html.includes('NaN'));
 assert(html.includes('data-order="108"'));
 assert(html.includes('aria-valuenow="25"'));
 if(language!=='ru'){
   const untranslated=run('translationRows.filter(r=>/Проект|проект|этап|Этап/.test(r[0])).filter(r=>/[А-Яа-яЁё]/.test(tr(r[0])))');
   assert.equal(untranslated.length,0,JSON.stringify(untranslated));
 }
}
run('projectFilter="done"');assert(!run('projects()').includes('class="panel project-card"'));
run('projectFilter="risk"');assert(run('projects()').includes('class="panel project-card"'));
run('projectView="board"');assert.equal((run('projectDetail(fixture)').match(/class="project-task"/g)||[]).length,6);
const saved=vm.createContext({localStorage:{getItem:()=>'{"projectsEnabled":false}',setItem(){}},document:{documentElement:{dataset:{}}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/i18n.js'),'utf8'),saved);
assert.equal(vm.runInContext('settings.projectsEnabled',saved),false);
console.log('PASS: project drill-down, filters, timeline/board, translations and persisted visibility');
