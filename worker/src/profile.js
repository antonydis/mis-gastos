import {unfinishedExpense} from './preferences.js';
import {offerReminders} from './reminders.js';

const currencies=['CAD','USD','MXN','GTQ','NIO','EUR'];
const zones={'Montreal':'America/Toronto','Toronto':'America/Toronto','Vancouver':'America/Vancouver','Calgary':'America/Edmonton','Winnipeg':'America/Winnipeg','Halifax':'America/Halifax','New York':'America/New_York','Ciudad de México':'America/Mexico_City','Cancún':'America/Cancun','Guatemala':'America/Guatemala','Managua':'America/Managua'};
export const localTimeName=zone=>zone==='America/Toronto'?'Montreal / Toronto':zone.split('/').at(-1).replaceAll('_',' ');
const remember=(uid,step,env)=>env.DB.prepare('INSERT INTO pending VALUES(?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at').bind(uid,'profile',JSON.stringify({step}),Date.now()+30*60*1000).run();
export async function startProfile(chat,env,send){
 if(await unfinishedExpense(String(chat),env))return send(chat,'Primero termina el gasto pendiente o envía /cancelar. Después puedes cambiar los ajustes.',env);
 const link=await env.DB.prepare('SELECT currency,timezone FROM user_links WHERE telegram_user_id=?').bind(String(chat)).first();
 if(!link)return send(chat,'Conecta Google con /link para continuar.',env);
 return send(chat,'Moneda: '+link.currency+' · Hora local: '+localTimeName(link.timezone)+'.\n¿Lo dejamos así?',env,{inline_keyboard:[[{text:'Sí, continuar',callback_data:'profile:keep'}],[{text:'Cambiar moneda',callback_data:'profile:currency-menu'},{text:'Cambiar hora local',callback_data:'profile:other-city'}]]});
}
export async function handleProfileCallback(cb,env,send){
 const uid=String(cb.from.id),chat=String(cb.message.chat.id),parts=cb.data.split(':'),action=parts[1],value=parts.slice(2).join(':');
 if(await unfinishedExpense(uid,env))return send(chat,'Primero termina el gasto pendiente o envía /cancelar. Después puedes cambiar los ajustes.',env);
 const link=await env.DB.prepare('SELECT currency,timezone FROM user_links WHERE telegram_user_id=?').bind(uid).first();
 if(!link)return send(chat,'Conecta Google con /link para continuar.',env);
 if(action==='start'||action==='country')return startProfile(chat,env,send); // Old keyboards remain safe.
 if(action==='default')await env.DB.prepare('UPDATE user_links SET currency=?,timezone=? WHERE telegram_user_id=?').bind('CAD','America/Toronto',uid).run();
 if(action==='keep'||action==='default'){
  await env.DB.prepare("DELETE FROM pending WHERE telegram_user_id=? AND kind='profile'").bind(uid).run();
  return offerReminders(chat,env,send);
 }
 if(action==='currency-menu'){
  await remember(uid,'currency',env);
  return send(chat,'¿Qué moneda usas normalmente?',env,{inline_keyboard:[currencies.map(currency=>({text:currency,callback_data:'profile:currency:'+currency}))]});
 }
 const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
 if(action==='other-city'){
  await remember(uid,'city-text',env);
  return send(chat,'Escribe solo el nombre de tu ciudad. Por ejemplo: Montreal, Paris o Vancouver. Para salir, envía /cancelar.',env);
 }
 if(pending?.kind!=='profile'||Number(pending.expires_at)<=Date.now())return startProfile(chat,env,send);
 if(action==='currency'&&currencies.includes(value)){
  await env.DB.prepare('UPDATE user_links SET currency=? WHERE telegram_user_id=?').bind(value,uid).run();
  await env.DB.prepare("DELETE FROM pending WHERE telegram_user_id=? AND kind='profile'").bind(uid).run();
  return startProfile(chat,env,send);
 }
}
export async function handleProfileText(uid,chat,text,pending,env,send){
 const data=JSON.parse(pending.payload);
 if(data.step!=='city-text')return send(chat,'Elige una opción en la configuración anterior. Para salir, envía /cancelar.',env);
 const normalize=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
 const input=normalize(text);
 let zone=Object.entries(zones).find(([city])=>normalize(city)===input)?.[1];
 const available=Intl.supportedValuesOf?.('timeZone')||[];
 zone ||= available.find(value=>normalize(value.split('/').at(-1))===input);
 if(!zone)return send(chat,'No encontré esa ciudad. Prueba una ciudad grande cercana que tenga la misma hora, o envía /cancelar.',env);
 await env.DB.prepare('UPDATE user_links SET timezone=? WHERE telegram_user_id=?').bind(zone,uid).run();
 await env.DB.prepare("DELETE FROM pending WHERE telegram_user_id=? AND kind='profile'").bind(uid).run();
 return startProfile(chat,env,send);
}
