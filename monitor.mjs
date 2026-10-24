import {probeAccessMail,checkAccessMail,sendAccessMail,drillAccessMail} from './access-mail.mjs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function transition(state,healthy){
 if(!state||state.version!==1||!['up','down'].includes(state.status)||!Number.isInteger(state.failures)||state.failures<0||state.failures>2)throw Error('State rejected');
 const next={...state,failures:healthy?0:Math.min(2,state.failures+1)};const status=healthy?'up':next.failures>=2?'down':state.status;
 const event=status!==state.status?status:null;next.status=status;return {next,event};
}
export async function probe(url,expected,request=fetch){
 let u;try{u=new URL(url);}catch{throw Error('Target configuration rejected');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/api/ready'||createHash('sha256').update(url).digest('hex')!==expected)throw Error('Target configuration rejected');
 try{const r=await request(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});if(!r.ok){await r.body?.cancel();return false;}if(Number(r.headers.get('content-length'))>8192)return false;const text=await r.text();if(text.length>8192)return false;const j=JSON.parse(text);return j.environment==='staging'&&j.financialReadOnly===true;}catch{return false;}
}
export async function probeBackup(url,expected,token,request=fetch,now=Date.now()){
 let u;try{u=new URL(url);}catch{throw Error('Backup target rejected');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/api/monitor/backup'||createHash('sha256').update(url).digest('hex')!==expected||!/^[a-f0-9]{64}$/.test(token||''))throw Error('Backup target rejected');
 try{const r=await request(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{accept:'application/json',authorization:'Bearer '+token}});if(!r.ok){await r.body?.cancel();return false;}const text=await r.text();if(text.length>8192)return false;const j=JSON.parse(text),age=now-Date.parse(j.checkedAt);return j.version===1&&j.status==='fresh'&&j.maxAgeSeconds===5400&&Number.isFinite(age)&&age>=-60000&&age<=5400000;}catch{return false;}
}
export async function send(event,drill,env,request=fetch,subject='availability'){
 if(!['availability','backup'].includes(subject)||!['up','down'].includes(event)||!/^\d+:[A-Za-z0-9_-]{25,}$/.test(env.TELEGRAM_BOT_TOKEN||'')||!/^\d+$/.test(env.TELEGRAM_CHAT_ID||''))throw Error('Notification configuration rejected');
 const text='ToursPay Preproducción · '+(drill?'PRUEBA SIMULADA · ':'')+(subject==='backup'?(event==='down'?'PROCESO DE COPIAS SIN LATIDO':'LATIDO DE COPIAS RECUPERADO'):(event==='down'?'CAÍDA detectada':'RECUPERACIÓN detectada'))+'\n'+(drill?'Simulación del vigilante externo; no se han detenido la web ni las copias.':subject==='backup'?'Falta o recuperación del control horario de copias; umbral 90 minutos.':'Comprobación externa de disponibilidad.')+'\nSin operaciones financieras ni correos.';
 try{const r=await request('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text,protect_content:true,link_preview_options:{is_disabled:true}})});if(!r.ok||(await r.json()).ok!==true)throw Error();}catch{throw Error('Notification outcome uncertain; automatic retry blocked');}
}
export async function check(state,healthy,{save,notify,now=()=>new Date().toISOString()}){
 const {next,event}=transition(state,healthy);
 if(!event){if(next.failures!==state.failures)await save(next);return {state:next,notified:false,duplicateSuppressed:!!state.delivery};}
 next.delivery={event,status:'uncertain',attemptedAt:now()};await save(next); // persist BEFORE external side effect
 await notify(event);next.delivery.status='confirmed';await save(next);return {state:next,notified:true};
}
export async function drillCycle(state,deps){
 if(state.drillCompleted)return {state,duplicateSuppressed:true,notifications:0};
 if(state.drillStarted||state.status!=='up')throw Error('Inspect incomplete drill before retrying');
 state={...state,drillStarted:true};await deps.save(state);let notifications=0;
 for(const healthy of [false,false,false,true,true]){const r=await check(state,healthy,deps);state=r.state;if(r.notified)notifications++;}
 state={...state,drillCompleted:true};await deps.save(state);return {state,duplicateSuppressed:false,notifications};
}
async function run(env=process.env){
 const repository=env.GITHUB_REPOSITORY;if(!repository||repository!==env.MONITOR_REPOSITORY||!/^[-\w]+\/[-\w]+$/.test(repository)||!env.GITHUB_TOKEN)throw Error('Repository scope rejected');
 const mode=env.MONITOR_MODE||'check',drill=mode!=='check';if(!['check','drill-down','drill-up','drill-cycle','backup-drill-cycle','access-mail-drill-cycle'].includes(mode)||(drill&&env.GITHUB_EVENT_NAME!=='workflow_dispatch'))throw Error('Mode rejected');
 const base='https://api.github.com/repos/'+repository;
 async function github(method,suffix,body){try{const r=await fetch(base+suffix,{method,redirect:'error',signal:AbortSignal.timeout(12000),headers:{authorization:'Bearer '+env.GITHUB_TOKEN,accept:'application/vnd.github+json','content-type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error();return await r.json();}catch{throw Error('Scoped state operation failed; no alert attempted or retried');}}
 async function channel(path,subject){let file=await github('GET','/contents/'+path+'?ref=monitor-state');const state=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));const save=async value=>{file=(await github('PUT','/contents/'+path,{message:'Monitor state transition',branch:'monitor-state',sha:file.sha,content:Buffer.from(JSON.stringify(value)).toString('base64')})).content;};return {state,save,notify:event=>send(event,drill,env,fetch,subject)};}
 async function observe(c,healthy,label){let state=c.state;if(!healthy&&state.status==='up'&&state.failures===0)state=(await check(state,false,c)).state;const result=await check(state,healthy,c);const now=new Date().toISOString();if(result.state.lastCheckedAt?.slice(0,10)!==now.slice(0,10))await c.save({...result.state,lastCheckedAt:now});console.log(JSON.stringify({mode:label,status:result.state.status,notified:result.notified,duplicateSuppressed:result.duplicateSuppressed||false,financialOperations:0,emailsSent:0}));}
 if(mode==='access-mail-drill-cycle'){const a=await channel('access-mail-drill.json','availability');a.notify=summary=>sendAccessMail(summary,true,env);const r=await drillAccessMail(a.state,a);console.log(JSON.stringify({mode,notifications:r.notifications,duplicateSuppressed:r.duplicateSuppressed,financialOperations:0,emailsSent:0}));return;}
 const backupDrill=mode==='backup-drill-cycle',c=await channel(backupDrill?'backup-drill.json':drill?'drill.json':'live.json',backupDrill?'backup':'availability');
 if(mode==='drill-cycle'||backupDrill){const r=await drillCycle(c.state,c);console.log(JSON.stringify({mode,status:r.state.status,notifications:r.notifications,duplicateSuppressed:r.duplicateSuppressed,financialOperations:0,emailsSent:0}));return;}
 let healthy;if(drill)healthy=mode==='drill-up';else{healthy=await probe(env.MONITOR_URL,env.MONITOR_URL_SHA256);if(!healthy){await new Promise(r=>setTimeout(r,5000));healthy=await probe(env.MONITOR_URL,env.MONITOR_URL_SHA256);}}
 await observe(c,healthy,mode);
 if(!drill&&healthy){const b=await channel('backup.json','backup');let fresh=await probeBackup(env.BACKUP_MONITOR_URL,env.BACKUP_MONITOR_URL_SHA256,env.BACKUP_MONITOR_TOKEN);if(!fresh){await new Promise(r=>setTimeout(r,5000));fresh=await probeBackup(env.BACKUP_MONITOR_URL,env.BACKUP_MONITOR_URL_SHA256,env.BACKUP_MONITOR_TOKEN);}await observe(b,fresh,'backup-check');const a=await channel('access-mail.json','availability');a.notify=summary=>sendAccessMail(summary,false,env);let snapshot=await probeAccessMail(env.ACCESS_MAIL_MONITOR_URL,env.ACCESS_MAIL_MONITOR_URL_SHA256,env.ACCESS_MAIL_MONITOR_TOKEN);if(!snapshot){await new Promise(r=>setTimeout(r,5000));snapshot=await probeAccessMail(env.ACCESS_MAIL_MONITOR_URL,env.ACCESS_MAIL_MONITOR_URL_SHA256,env.ACCESS_MAIL_MONITOR_TOKEN);}const r=await checkAccessMail(a.state,snapshot,a);console.log(JSON.stringify({mode:'access-mail-check',codes:r.state.codes,notified:r.notified,duplicateSuppressed:r.duplicateSuppressed,financialOperations:0,emailsSent:0}));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(()=>{console.error('External monitor failed; inspect its state before retrying. No secrets logged.');process.exitCode=1;});
