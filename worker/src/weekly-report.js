import {localDate,money,norm,decrypt} from './utils.js';
import {refreshAccess,readExpenses} from './google.js';

const REPORT_SCHEMA=`CREATE TABLE IF NOT EXISTS weekly_report_settings (
 telegram_user_id TEXT PRIMARY KEY,
 enabled INTEGER NOT NULL DEFAULT 0,
 last_sent_week TEXT NOT NULL DEFAULT ''
)`;
export const ensureWeeklyReports=env=>env.DB.prepare(REPORT_SCHEMA).run();

export function expenseGroup(row){
 const category=norm(row.category), description=norm((row.description||'')+' '+(row.merchant||''));
 // Group only clearly identified car expenses; generic transport stays separate.
 if(/gasolina|combustible|fuel|essence|station service/.test(category+' '+description)||
   /\b(lease|leasing|arrendamiento|seguro auto|seguro carro|assurance auto|car insurance|estacionamiento|parking|parqueadero|peaje|toll|mantenimiento auto|reparacion auto|cambio de aceite|neumaticos|llantas)\b/.test(description)||
   /\b(auto|carro|vehiculo)\b/.test(category))return 'Carro';
 if(/restaurante|entretenimiento|diversion|ocio/.test(category)||
   /\b(cine|bar|concierto|salida|comida fuera|comida en la calle|cafe|cafeteria|boletos partido|entradas partido)\b/.test(description))return 'Diversión';
 if(/supermercado|mercado|groceries/.test(category))return 'Alimentación en casa';
 if(/casa|hogar|servicios|suscripciones/.test(category))return 'Hogar y servicios';
 if(/salud|cuidado personal/.test(category))return 'Salud y cuidado personal';
 if(/familia/.test(category))return 'Familia';
 if(/viajes/.test(category))return 'Viajes';
 if(/transporte/.test(category))return 'Transporte';
 if(/compras/.test(category))return 'Compras';
 if(/educacion/.test(category))return 'Educación';
 return 'Otros';
}

const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
export function groupedReport(rows,start,end,label){
 const byCurrency=new Map();let excluded=0;
 for(const row of rows){
  if(!validDate(row.date)||row.date<start||row.date>end)continue;
  if(!(Number.isFinite(row.amount)&&row.amount>0&&row.currency)){excluded++;continue;}
  let c=byCurrency.get(row.currency);
  if(!c){c={total:0,count:0,groups:new Map(),details:new Map()};byCurrency.set(row.currency,c);}
  const group=expenseGroup(row),category=row.category||'Otros';
  c.total+=row.amount;c.count++;
  c.groups.set(group,(c.groups.get(group)||0)+row.amount);
  if(!c.details.has(group))c.details.set(group,new Map());
  const d=c.details.get(group);d.set(category,(d.get(category)||0)+row.amount);
 }
 const out=[label+' ('+start+' al '+end+')'];
 if(!byCurrency.size)out.push('No hay gastos registrados en este período.');
 for(const [currency,c] of byCurrency){
  out.push('',money(c.total,currency)+' en '+c.count+' gastos.');
  for(const [group,amount] of [...c.groups].sort((a,b)=>b[1]-a[1])){
   const pct=(100*amount/c.total).toFixed(1).replace('.',',');
   out.push('• '+group+': '+money(amount,currency)+' ('+pct+'%)');
   if(['Carro','Diversión'].includes(group))
    for(const [category,value] of [...c.details.get(group)].sort((a,b)=>b[1]-a[1]))
     out.push('   – '+category+': '+money(value,currency));
  }
 }
 if(byCurrency.size>1)out.push('Las monedas se presentan por separado; no se suman sin una conversión confirmada.');
 if(excluded)out.push(excluded+' movimiento(s) con monto o moneda inválidos, excluidos.');
 out.push('Solo se cuentan gastos registrados en tu hoja.');
 return out.join('\n');
}
function localClock(tz,now){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return parts.hour+':'+parts.minute;
}
function lastWeek(tz,now){
 const today=localDate(tz,0,now);
 const day=new Date(today+'T12:00:00Z').getUTCDay();
 const mondayOffset=(day+6)%7;
 return {start:localDate(tz,-mondayOffset-7,now),end:localDate(tz,-mondayOffset-1,now)};
}
export async function reportForLink(link,env,period='week',now=new Date()){
 const tz=link.timezone||'America/Toronto',today=localDate(tz,0,now);
 let start,end,label;
 if(period==='month'){start=today.slice(0,7)+'-01';end=today;label='Resumen del mes';}
 else {({start,end}=lastWeek(tz,now));label='Tu resumen semanal';}
 const refresh=await decrypt(link.google_refresh_token,env.TOKEN_ENCRYPTION_KEY);
 const rows=await readExpenses(link.sheet_id,await refreshAccess(refresh,env));
 return groupedReport(rows,start,end,label);
}
export async function weeklyReportPreference(uid,enable,env){
 await ensureWeeklyReports(env);
 await env.DB.prepare('INSERT INTO weekly_report_settings(telegram_user_id,enabled) VALUES(?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET enabled=excluded.enabled').bind(uid,enable?1:0).run();
}
export async function runWeeklyReports(env,send,now=new Date()){
 await ensureWeeklyReports(env);
 const users=(await env.DB.prepare('SELECT s.*,u.chat_id,u.timezone,u.sheet_id,u.google_refresh_token FROM weekly_report_settings s JOIN user_links u ON u.telegram_user_id=s.telegram_user_id WHERE s.enabled=1').all()).results||[];
 for(const u of users){
  try{
   const today=localDate(u.timezone||'America/Toronto',0,now);
   if(new Date(today+'T12:00:00Z').getUTCDay()!==1||localClock(u.timezone||'America/Toronto',now)<'09:00'||localClock(u.timezone||'America/Toronto',now)>='10:00')continue;
   const {start}=lastWeek(u.timezone||'America/Toronto',now);
   const claim=await env.DB.prepare('UPDATE weekly_report_settings SET last_sent_week=? WHERE telegram_user_id=? AND enabled=1 AND last_sent_week<>?').bind(start,u.telegram_user_id,start).run();
   if(claim.meta?.changes!==1)continue;
   const message=await reportForLink(u,env,'week',now);
   await send(u.chat_id,message,env,null);
  }catch(error){console.error('Weekly report failed',u.telegram_user_id,error);}
 }
}
