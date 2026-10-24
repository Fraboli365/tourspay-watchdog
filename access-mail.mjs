import {createHash} from 'node:crypto';
const allowed=['failed','monitor','stuck','uncertain'];
const validCounts=c=>!!c&&Object.keys(c).length===3&&['stuck','failed','uncertain'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0&&c[k]<=1000000);
export async function probeAccessMail(url,expected,token,request=fetch,now=Date.now()){
 let u;try{u=new URL(url);}catch{throw Error('Access monitor target rejected');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/api/monitor/access-mail'||createHash('sha256').update(url).digest('hex')!==expected||!/^[a-f0-9]{64}$/.test(token||''))throw Error('Access monitor target rejected');
 try{const r=await request(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{accept:'application/json',authorization:'Bearer '+token}});if(!r.ok){await r.body?.cancel();return null;}const text=await r.text();if(text.length>8192)return null;const j=JSON.parse(text),age=now-Date.parse(j.checkedAt);if(j.version!==1||!['ok','attention'].includes(j.status)||!validCounts(j.counts)||j.thresholds?.stuckSeconds!==600||j.thresholds?.uncertainSeconds!==120||!Number.isFinite(age)||age< -60000||age>300000)return null;return {counts:{stuck:j.counts.stuck,failed:j.counts.failed,uncertain:j.counts.uncertain}};}catch{return null;}
}
export async function checkAccessMail(state,snapshot,{save,notify}){
 if(!state||state.version!==1||!Array.isArray(state.codes)||state.codes.some(c=>!allowed.includes(c))||!validCounts(state.counts))throw Error('Access monitor state rejected');
 if(snapshot&&!validCounts(snapshot.counts))throw Error('Access monitor snapshot rejected');
 const counts=snapshot?snapshot.counts:state.counts,codes=snapshot?Object.keys(counts).filter(k=>counts[k]>0).sort():[...new Set([...state.codes,'monitor'])].sort(),signature=codes.join('|');
 if(signature===state.codes.slice().sort().join('|')){if(JSON.stringify(counts)!==JSON.stringify(state.counts)){state={...state,counts};await save(state);}return {state,notified:false,duplicateSuppressed:true};}
 const next={...state,codes,counts,delivery:{signature,status:'uncertain'}};await save(next);await notify({codes,counts});next.delivery.status='confirmed';await save(next);return {state:next,notified:true,duplicateSuppressed:false};
}
export async function sendAccessMail(summary,drill,env,request=fetch){
 if(!validCounts(summary.counts)||!Array.isArray(summary.codes)||summary.codes.some(c=>!allowed.includes(c))||!/^\d+:[A-Za-z0-9_-]{25,}$/.test(env.TELEGRAM_BOT_TOKEN||'')||!/^\d+$/.test(env.TELEGRAM_CHAT_ID||''))throw Error('Access notification rejected');
 const text='ToursPay Preproducción · '+(drill?'PRUEBA SIMULADA · ':'')+'Cola de accesos\n'+(!summary.codes.length?'COLA RECUPERADA':summary.codes.includes('monitor')?'No se pudo consultar la cola; se conservan las incidencias previas.':'ENVÍOS QUE REQUIEREN REVISIÓN')+'\nAtascados: '+summary.counts.stuck+' · Fallidos: '+summary.counts.failed+' · Inciertos: '+summary.counts.uncertain+'\n'+(drill?'Correos simulados; sin envíos reales.':'Solo contadores; sin destinatarios ni enlaces.');
 try{const r=await request('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text,protect_content:true,link_preview_options:{is_disabled:true}})});if(!r.ok||(await r.json()).ok!==true)throw Error();}catch{throw Error('Telegram outcome uncertain; automatic retry blocked');}
}
export async function drillAccessMail(state,deps){
 if(state.drillCompleted)return {state,notifications:0,duplicateSuppressed:true};if(state.drillStarted)throw Error('Inspect incomplete access drill before retrying');
 state={...state,drillStarted:true};await deps.save(state);let notifications=0;for(const counts of [{stuck:1,failed:0,uncertain:0},{stuck:0,failed:1,uncertain:0},{stuck:0,failed:0,uncertain:1},{stuck:0,failed:0,uncertain:0}])for(let repeat=0;repeat<2;repeat++){const r=await checkAccessMail(state,{counts},deps);state=r.state;if(r.notified)notifications++;}state={...state,drillCompleted:true};await deps.save(state);return {state,notifications,duplicateSuppressed:false};
}
