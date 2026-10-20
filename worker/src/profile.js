
const countries={CA:{name:'Canadá',currency:'CAD',cities:['Montreal','Toronto','Vancouver','Calgary','Winnipeg','Halifax','St. John’s']},US:{name:'Estados Unidos',currency:'USD',cities:['New York','Chicago','Denver','Los Angeles','Anchorage','Honolulu']},MX:{name:'México',currency:'MXN',cities:['Ciudad de México','Cancún','Tijuana']},GT:{name:'Guatemala',currency:'GTQ',cities:['Guatemala']},NI:{name:'Nicaragua',currency:'NIO',cities:['Managua']},OTHER:{name:'Otro país',currency:null,cities:[]}};
const zones={'Montreal':'America/Toronto','Toronto':'America/Toronto','Vancouver':'America/Vancouver','Calgary':'America/Edmonton','Winnipeg':'America/Winnipeg','Halifax':'America/Halifax','St. John’s':'America/St_Johns','New York':'America/New_York','Chicago':'America/Chicago','Denver':'America/Denver','Los Angeles':'America/Los_Angeles','Anchorage':'America/Anchorage','Honolulu':'Pacific/Honolulu','Ciudad de México':'America/Mexico_City','Cancún':'America/Cancun','Tijuana':'America/Tijuana','Guatemala':'America/Guatemala','Managua':'America/Managua'};
const currencies=['CAD','USD','MXN','GTQ','NIO','EUR'];
const remember=(uid,data,env)=>env.DB.prepare('INSERT INTO pending VALUES(?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at').bind(uid,'profile',JSON.stringify(data),Date.now()+30*60*1000).run();
export function startProfile(chat,env,send){
  return send(chat,'¿En qué país usarás el bot? Así elegimos tu moneda y la hora local.',env,{inline_keyboard:[[{text:'Canadá',callback_data:'profile:country:CA'},{text:'Estados Unidos',callback_data:'profile:country:US'}],[{text:'México',callback_data:'profile:country:MX'},{text:'Guatemala',callback_data:'profile:country:GT'}],[{text:'Nicaragua',callback_data:'profile:country:NI'},{text:'Otro país',callback_data:'profile:country:OTHER'}],[{text:'Usar Montreal y CAD',callback_data:'profile:default'}]]});
}
async function chooseCity(uid,chat,data,env,send){
  await remember(uid,{...data,step:'city'},env);
  const cities=countries[data.country].cities;
  return send(chat,'Moneda: '+data.currency+'. ¿En qué ciudad estás? La usaré para las fechas de tus gastos.',env,{inline_keyboard:[...cities.map(city=>[{text:city,callback_data:'profile:city:'+city}]),[{text:'Otra ciudad: escribir',callback_data:'profile:other-city'}],[{text:'Cambiar moneda',callback_data:'profile:currency-menu'}]]});
}
async function finish(uid,chat,data,timezone,env,send){
  await env.DB.prepare('UPDATE user_links SET currency=?,timezone=? WHERE telegram_user_id=?').bind(data.currency,timezone,uid).run();
  await env.DB.prepare('DELETE FROM pending WHERE telegram_user_id=?').bind(uid).run();
  return send(chat,'Listo. Moneda: '+data.currency+' · Hora local: '+(timezone==='America/Toronto'?'Montreal / Toronto':timezone.split('/').at(-1).replaceAll('_',' '))+'.\nPuedes cambiarlo en Ajustes. ¿En qué idioma prefieres hablar?',env,{inline_keyboard:[[{text:'Español',callback_data:'language:es'},{text:'English',callback_data:'language:en'}]]});
}
export async function handleProfileCallback(cb,env,send){
  const uid=String(cb.from.id),chat=String(cb.message.chat.id),parts=cb.data.split(':'),action=parts[1],value=parts.slice(2).join(':');
  const link=await env.DB.prepare('SELECT currency,timezone FROM user_links WHERE telegram_user_id=?').bind(uid).first();
  if(!link)return send(chat,'Conecta Google con /link para continuar.',env);
  if(action==='start')return startProfile(chat,env,send);
  if(action==='default')return finish(uid,chat,{currency:'CAD'},'America/Toronto',env,send);
  if(action==='country'){
    if(!countries[value])return;
    const data={country:value,currency:countries[value].currency,step:'currency'};
    if(data.currency)return chooseCity(uid,chat,data,env,send);
    await remember(uid,data,env);
  }
  const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
  if(pending?.kind!=='profile'||Number(pending.expires_at)<=Date.now())return startProfile(chat,env,send);
  const data=JSON.parse(pending.payload);
  if(action==='currency-menu'||(action==='country'&&value==='OTHER')){
    await remember(uid,{...data,step:'currency'},env);
    return send(chat,'¿Qué moneda usas normalmente?',env,{inline_keyboard:[currencies.map(currency=>({text:currency,callback_data:'profile:currency:'+currency}))]});
  }
  if(action==='currency'&&currencies.includes(value))return chooseCity(uid,chat,{...data,currency:value},env,send);
  if(action==='city'&&data.step==='city'&&countries[data.country].cities.includes(value))return finish(uid,chat,data,zones[value],env,send);
  if(action==='other-city'){
    await remember(uid,{...data,step:'city-text'},env);
    return send(chat,'Escribe solo el nombre de tu ciudad. Por ejemplo: Montreal, Paris o Vancouver. Para salir, envía /cancelar.',env);
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
  return finish(uid,chat,data,zone,env,send);
}
