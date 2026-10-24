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
export async function send(event,drill,env,request=fetch){
 if(!['up','down'].includes(event)||!/^\d+:[A-Za-z0-9_-]{25,}$/.test(env.TELEGRAM_BOT_TOKEN||'')||!/^\d+$/.test(env.TELEGRAM_CHAT_ID||''))throw Error('Notification configuration rejected');
 const text='ToursPay Preproducción · '+(drill?'PRUEBA SIMULADA · ':'')+(event==='down'?'CAÍDA detectada':'RECUPERACIÓN detectada')+'\n'+(drill?'Simulación del vigilante externo; ToursPay no se ha detenido.':'Comprobación externa de disponibilidad.')+'\nSin operaciones financieras ni correos.';
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
 const mode=env.MONITOR_MODE||'check',drill=mode!=='check';if(!['check','drill-down','drill-up','drill-cycle'].includes(mode)||(drill&&env.GITHUB_EVENT_NAME!=='workflow_dispatch'))throw Error('Mode rejected');
 const path=drill?'drill.json':'live.json',base='https://api.github.com/repos/'+repository;
 async function github(method,suffix,body){try{const r=await fetch(base+suffix,{method,redirect:'error',signal:AbortSignal.timeout(12000),headers:{authorization:'Bearer '+env.GITHUB_TOKEN,accept:'application/vnd.github+json','content-type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error();return await r.json();}catch{throw Error('Scoped state operation failed; no alert attempted or retried');}}
 let file=await github('GET','/contents/'+path+'?ref=monitor-state');let state=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
 async function save(value){file=await github('PUT','/contents/'+path,{message:'Monitor state transition',branch:'monitor-state',sha:file.sha,content:Buffer.from(JSON.stringify(value)).toString('base64')}).then(j=>j.content);}
 const notify=event=>send(event,drill,env);
 if(mode==='drill-cycle'){const r=await drillCycle(state,{save,notify});console.log(JSON.stringify({mode,status:r.state.status,notifications:r.notifications,duplicateSuppressed:r.duplicateSuppressed,financialOperations:0,emailsSent:0}));return;}
 let healthy;if(drill)healthy=mode==='drill-up';else{healthy=await probe(env.MONITOR_URL,env.MONITOR_URL_SHA256);if(!healthy){await new Promise(r=>setTimeout(r,5000));healthy=await probe(env.MONITOR_URL,env.MONITOR_URL_SHA256);}}
 // Two observations are required; drill-down exercises the same persisted transition path.
 if(!healthy&&state.status==='up'&&state.failures===0){const first=await check(state,false,{save,notify});state=first.state;}
 const result=await check(state,healthy,{save,notify});const now=new Date().toISOString();if(result.state.lastCheckedAt?.slice(0,10)!==now.slice(0,10)){await save({...result.state,lastCheckedAt:now});}console.log(JSON.stringify({mode,status:result.state.status,notified:result.notified,duplicateSuppressed:result.duplicateSuppressed||false,financialOperations:0,emailsSent:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(()=>{console.error('External monitor failed; inspect its state before retrying. No secrets logged.');process.exitCode=1;});
