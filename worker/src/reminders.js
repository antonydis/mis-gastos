import {unfinishedExpense} from './preferences.js';
import {localDate} from './utils.js';

export const REMINDER_SCHEMA=`CREATE TABLE IF NOT EXISTS reminder_settings (
 telegram_user_id TEXT PRIMARY KEY,
 enabled INTEGER NOT NULL DEFAULT 0,
 local_time TEXT NOT NULL DEFAULT '20:30',
 reviewed_day TEXT NOT NULL DEFAULT '',
 last_activity_at INTEGER NOT NULL DEFAULT 0,
 last_sent_day TEXT NOT NULL DEFAULT '',
 snooze_until INTEGER NOT NULL DEFAULT 0
)`;
export const ensureReminders=env=>env.DB.prepare(REMINDER_SCHEMA).bind().run();
const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function clock(timezone,now){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 return parts.hour+':'+parts.minute;
}
async function settings(uid,env){
 await ensureReminders(env);
 await env.DB.prepare('INSERT OR IGNORE INTO reminder_settings(telegram_user_id) VALUES(?)').bind(uid).run();
 return env.DB.prepare('SELECT * FROM reminder_settings WHERE telegram_user_id=?').bind(uid).first();
}
const clearTimeInput=(uid,env)=>env.DB.prepare("DELETE FROM pending WHERE telegram_user_id=? AND kind='reminder-time'").bind(uid).run();
export function offerReminders(chat,env,send){
 return send(chat,'¿Quieres un recordatorio diario para anotar tus gastos?',env,{inline_keyboard:[[{text:'Sí, a las 20:30',callback_data:'reminder:time:20:30'}],[{text:'Elegir otra hora',callback_data:'reminder:choose-time'},{text:'Ahora no',callback_data:'reminder:off'}]]});
}
export async function reminderSettings(uid,chat,env,send){
 const r=await settings(uid,env);
 return send(chat,r.enabled?'Recordatorio diario: '+r.local_time+' (tu hora local).':'Los recordatorios están desactivados.',env,{inline_keyboard:[[{text:r.enabled?'Pausar':'Activar',callback_data:r.enabled?'reminder:off':'reminder:on'},{text:'Cambiar hora',callback_data:'reminder:choose-time'}]]});
}
async function chooseTime(chat,env,send){
 return send(chat,'¿A qué hora te viene bien? Usaré tu hora local.',env,{inline_keyboard:[[{text:'19:00',callback_data:'reminder:time:19:00'},{text:'20:30',callback_data:'reminder:time:20:30'},{text:'21:30',callback_data:'reminder:time:21:30'}],[{text:'Escribir otra hora',callback_data:'reminder:write-time'}],[{text:'Ahora no',callback_data:'reminder:off'}]]});
}
async function enable(uid,chat,time,link,env,send,now){
 if(!validTime(time))return send(chat,'Escribe la hora en formato de 24 horas. Por ejemplo: 20:30.',env);
 const current=await settings(uid,env),day=localDate(link.timezone,0,now);
 // Do not send an immediate catch-up when enabling after the chosen time.
 const sentDay=clock(link.timezone,now)>=time?day:(current.last_sent_day||'');
 await env.DB.prepare('UPDATE reminder_settings SET enabled=1,local_time=?,last_sent_day=?,snooze_until=0 WHERE telegram_user_id=?').bind(time,sentDay,uid).run();
 await clearTimeInput(uid,env);
 return send(chat,'Listo. Te recordaré a las '+time+', en tu hora local. Si ya pasó esa hora, empezamos mañana. Puedes pausarlo en Ajustes.',env);
}
export async function handleReminderCallback(cb,env,send,now=new Date()){
 const uid=String(cb.from.id),chat=String(cb.message.chat.id),action=cb.data.split(':')[1],value=cb.data.split(':').slice(2).join(':');
 const link=await env.DB.prepare('SELECT currency,timezone FROM user_links WHERE telegram_user_id=?').bind(uid).first();
 if(!link)return send(chat,'Conecta Google con /link para continuar.',env);
 if(['choose-time','time','on','write-time'].includes(action)&&await unfinishedExpense(uid,env))return send(chat,'Primero termina el gasto pendiente o envía /cancelar. Después puedes cambiar los ajustes.',env);
 const r=await settings(uid,env);
 if(action==='settings')return reminderSettings(uid,chat,env,send);
 if(action==='choose-time')return chooseTime(chat,env,send);
 if(action==='time')return enable(uid,chat,value,link,env,send,now);
 if(action==='on')return enable(uid,chat,r.local_time||'20:30',link,env,send,now);
 if(action==='off'){
  await env.DB.prepare('UPDATE reminder_settings SET enabled=0,snooze_until=0 WHERE telegram_user_id=?').bind(uid).run();
  await clearTimeInput(uid,env);
  return send(chat,'Listo. No te enviaré recordatorios. Puedes activarlos en Ajustes.',env);
 }
 if(action==='write-time'){
  await env.DB.prepare('INSERT INTO pending VALUES(?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at').bind(uid,'reminder-time','{}',now.getTime()+30*60*1000).run();
  return send(chat,'Escribe la hora en formato de 24 horas. Por ejemplo: 20:30. Para salir, envía /cancelar.',env);
 }
 const day=localDate(link.timezone,0,now);
 if(!['reviewed','snooze'].includes(action))return;
 if(value!==day)return send(chat,'Ese recordatorio es de otro día. Puedes registrar un gasto o cambiar los avisos en Ajustes.',env);
 if(action==='reviewed'){
  await env.DB.prepare('UPDATE reminder_settings SET reviewed_day=?,last_activity_at=?,snooze_until=0 WHERE telegram_user_id=?').bind(day,now.getTime(),uid).run();
  return send(chat,'Listo. Hoy queda revisado. No te recordaré más por hoy.',env);
 }
 if(!r.enabled)return send(chat,'Los recordatorios están desactivados.',env);
 if(r.reviewed_day===day)return send(chat,'Hoy ya quedó revisado. No hay otro aviso pendiente.',env);
 if(r.snooze_until>now.getTime())return send(chat,'Ya tienes un aviso para dentro de un rato.',env);
 await env.DB.prepare('UPDATE reminder_settings SET snooze_until=? WHERE telegram_user_id=? AND enabled=1 AND reviewed_day<>? AND snooze_until=0').bind(now.getTime()+60*60*1000,uid,day).run();
 return send(chat,'Te recordaré dentro de una hora.',env);
}
export async function reminderTimeFromText(uid,chat,text,link,env,send,now=new Date()){
 const match=String(text).trim().match(/^(\d{1,2}):(\d{2})$/);
 if(!match)return send(chat,'Escribe la hora en formato de 24 horas. Por ejemplo: 20:30.',env);
 return enable(uid,chat,match[1].padStart(2,'0')+':'+match[2],link,env,send,now);
}
// Only successful saves count. These are activity timestamps, not a copy of the expenses.
export async function recordActivity(uid,timezone,expenses,env,now=new Date()){
 await settings(uid,env);
 const day=localDate(timezone,0,now),reviewed=expenses.some(x=>x.date===day);
 await env.DB.prepare('UPDATE reminder_settings SET last_activity_at=?,reviewed_day=CASE WHEN ?=1 THEN ? ELSE reviewed_day END,snooze_until=0 WHERE telegram_user_id=?').bind(now.getTime(),reviewed?1:0,day,uid).run();
}
export async function runReminders(env,send,now=new Date()){
 await ensureReminders(env);
 let cursor='';
 while(true){
  const page=await env.DB.prepare(`SELECT r.*,u.chat_id,u.timezone,u.linked_at,p.language FROM reminder_settings r JOIN user_links u ON u.telegram_user_id=r.telegram_user_id LEFT JOIN user_preferences p ON p.telegram_user_id=r.telegram_user_id WHERE r.enabled=1 AND r.telegram_user_id>? ORDER BY r.telegram_user_id LIMIT 50`).bind(cursor).all();
  const users=page.results||[];
  for(const r of users){
   cursor=r.telegram_user_id;
   try{
    const day=localDate(r.timezone,0,now),time=clock(r.timezone,now);
    const snoozed=Number(r.snooze_until)>0;
    if(r.reviewed_day===day||!validTime(r.local_time))continue;
    if(snoozed?r.snooze_until>now.getTime():(r.last_sent_day===day||time<r.local_time))continue;
    // Reserve before contacting Telegram. An uncertain network result is not retried,
    // so overlapping cron runs/restarts cannot send duplicate automatic reminders.
    const claim=snoozed
     ?await env.DB.prepare('UPDATE reminder_settings SET last_sent_day=?,snooze_until=0 WHERE telegram_user_id=? AND enabled=1 AND reviewed_day<>? AND snooze_until=?').bind(day,r.telegram_user_id,day,r.snooze_until).run()
     :await env.DB.prepare('UPDATE reminder_settings SET last_sent_day=? WHERE telegram_user_id=? AND enabled=1 AND reviewed_day<>? AND last_sent_day<>? AND snooze_until=0 AND local_time=?').bind(day,r.telegram_user_id,day,day,r.local_time).run();
    if(claim.meta?.changes!==1)continue;
    // Recheck pause/review after the claim to avoid racing a user's action.
    const latest=await env.DB.prepare('SELECT * FROM reminder_settings WHERE telegram_user_id=?').bind(r.telegram_user_id).first();
    if(!latest?.enabled||latest.reviewed_day===day)continue;
    const inactive=now.getTime()-Number(r.last_activity_at||r.linked_at||now.getTime())>=86400000;
    const message=!snoozed&&inactive?'¿Te quedó algún gasto de ayer? Todavía puedes anotarlo.':'¿Te quedó algún gasto por anotar hoy? Puedes escribirlo o enviar un audio o una foto.';
    await send(r.chat_id,message,{...env,BOT_LANGUAGE:r.language==='en'?'en':'es'},{inline_keyboard:[[{text:'Registrar gasto',callback_data:'reminder:add:'+day}],[{text:'Hoy no gasté',callback_data:'reminder:reviewed:'+day},{text:'Recordarme más tarde',callback_data:'reminder:snooze:'+day}]]});
   }catch(error){console.error('Reminder delivery failed',r.telegram_user_id,error);}
  }
  if(users.length<50)break;
 }
}
