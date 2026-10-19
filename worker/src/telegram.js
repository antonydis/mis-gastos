import {preferences,setLanguage} from './preferences.js';
import {translateMessage,translateMarkup,normalizeMenu} from './i18n.js';
import {missingDetails} from './records.js';
import {decrypt,encrypt,money,randomCode} from './utils.js';
import {appendExpenses,deleteExpensesByIds,refreshAccess,readExpenses,completeExpenses} from './google.js';
import {analyzeText,analyzeReceipt,analyzeAudio,analyzeDocument} from './openai.js';
import {queryKind,monthlySummary} from './summary.js';

const LINK_TTL=15*60*1000;
const PENDING_TTL=30*60*1000;

async function call(method,payload,env){
  const r=await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.ok===false)throw new Error(d.description||'Telegram failed');
  return d.result;
}

const menu={keyboard:[[{text:'🧾 Registrar gasto'},{text:'📥 Importar movimientos'}],[{text:'📊 Este mes'},{text:'🏷 Categorías'}],[{text:'📝 Pendientes'},{text:'📄 Mi hoja'}],[{text:'⚙️ Ajustes'}]],resize_keyboard:true};
const help='Envíame un gasto por texto, foto o audio.\nEjemplo: «Ayer pagué 25 en supermercado con mi tarjeta RBC».\nPara varios gastos, envía una imagen o PDF.\nLos botones te permiten ver tus totales, completar datos o abrir tu hoja.';
export async function send(chatId,text,env,reply_markup=menu){
  text=translateMessage(text,env.BOT_LANGUAGE);reply_markup=translateMarkup(reply_markup,env.BOT_LANGUAGE);
  while(text.length>3800){let at=text.lastIndexOf('\n',3800);if(at<1)at=3800;await call('sendMessage',{chat_id:chatId,text:text.slice(0,at)},env);text=text.slice(at).trimStart();}
  return call('sendMessage',{chat_id:chatId,text,...(reply_markup?{reply_markup}:{})},env);
}

export async function setupWebhook(env){
  await call('setMyCommands',{commands:[{command:'start',description:'Conectar Google y empezar'},{command:'mes',description:'Ver gastos de este mes'},{command:'categorias',description:'Ver gastos por categoría'},{command:'pendientes',description:'Completar datos guardados'},{command:'idioma',description:'Español / English'},{command:'hoja',description:'Abrir mi Google Sheet'},{command:'link',description:'Volver a conectar Google'},{command:'cancelar',description:'Cancelar una aclaración'},{command:'ayuda',description:'Cómo usar Mis gastos'}]},env);
  return call('setWebhook',{
    url:env.PUBLIC_BASE_URL.replace(/\/$/,'')+'/telegram/webhook',
    secret_token:env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates:['message','callback_query'],
    drop_pending_updates:false
  },env);
}

async function userLink(id,env){
  const r=await env.DB.prepare('SELECT * FROM user_links WHERE telegram_user_id=?').bind(id).first();
  if(!r)return null;
  r.google_refresh_token=await decrypt(r.google_refresh_token,env.TOKEN_ENCRYPTION_KEY);
  return r;
}

export async function createLink(chatId,userId,env){
  const code=randomCode();
  await env.DB.prepare('INSERT INTO link_codes(code,telegram_user_id,chat_id,expires_at,used) VALUES(?,?,?,?,0)')
    .bind(code,userId,chatId,Date.now()+LINK_TTL).run();
  const u=new URL('/oauth/start',env.PUBLIC_BASE_URL);
  u.searchParams.set('link',code);
  return send(
    chatId,
    '¡Hola! Aquí puedes anotar tus gastos por texto, foto o audio.\nConecta Google para guardarlos en tu hoja de gastos.',
    env,
    {inline_keyboard:[[{text:'Conectar Google',url:u.toString()}],[{text:'Español / English',callback_data:'menu:language'}]]}
  );
}

function profile(link,env){
  return {
    currency:link.currency||'CAD',
    timezone:link.timezone||env.DEFAULT_TIMEZONE||'America/Toronto',
    language:env.BOT_LANGUAGE||'es'
  };
}

export function normalizeTelegramFile(blob,path,fallbackName,originalType=''){
  let name=(path.split('/').pop()||fallbackName||'archivo').replace(/[^a-zA-Z0-9._-]/g,'_');
  name=name.replace(/\.oga$/i,'.ogg');
  const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',ogg:'audio/ogg',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',wav:'audio/wav',webm:'audio/webm',flac:'audio/flac',pdf:'application/pdf'};
  const extension=name.split('.').pop().toLowerCase();
  const generic=type=>!type||['application/octet-stream','binary/octet-stream','application/binary'].includes(type.split(';')[0]);
  const type=!generic(originalType)?originalType:types[extension]||(!generic(blob.type)?blob.type:types[(fallbackName||'').split('.').pop()]||'application/octet-stream');
  return new File([blob],name,{type});
}

async function mediaStep(stage,task){
  try{return await task();}catch(error){error.mediaStage ||= stage;throw error;}
}

async function telegramFile(fileId,env,fallbackName,originalType=''){
  const info=await call('getFile',{file_id:fileId},env);
  if(!info?.file_path)throw new Error('Telegram no devolvió el archivo.');
  const response=await fetch('https://api.telegram.org/file/bot'+env.TELEGRAM_BOT_TOKEN+'/'+info.file_path);
  if(!response.ok)throw new Error('No pude descargar el archivo de Telegram.');
  const blob=await response.blob();
  return normalizeTelegramFile(blob,info.file_path,fallbackName,originalType);
}

export function savedMessage(expenses){
  const lines=expenses.map(x=>[
    '✓ '+x.description+' · '+money(x.amount,x.currency),
    'Fecha: '+x.date+' · Categoría: '+x.category,
    'Comercio: '+(x.merchant||'Sin indicar'),
    'Pago: '+(x.paymentMethod||'Por completar'),
    'Frecuencia: '+(x.frequency||'Por completar')+' · Tipo: '+(x.expenseType||'Por completar'),
    ...(x.project?['Viaje/proyecto: '+x.project]:[]),
    ...(x.notes?['Notas: '+x.notes]:[]),
    ...(x.currency!=='CAD'?['Equivalente CAD: '+(x.amountCAD!=null?money(x.amountCAD,'CAD'):'Sin conversión; no se estimó una tasa')]:[]),
    ...(x.possibleDuplicate?['⚠ Posible repetido: hay un gasto con la misma fecha, moneda y monto. Revisa tu hoja antes de confirmar.']:[]),
    ...(missingDetails(x).length?['Pendiente: '+missingDetails(x).join(', ')]:[])
  ].join('\n'));
  return 'Guardado en Mis gastos:\n'+lines.join('\n\n');
}

export function shortReceipt(expenses){
  const lines=expenses.map(x=>[
    x.description+' · '+money(x.amount,x.currency),
    x.date+' · Categoría: '+x.category,
    ...(x.paymentMethod?['Pago: '+x.paymentMethod]:[]),
    ...(x.possibleDuplicate?['⚠ Posible repetido: hay un gasto con la misma fecha, moneda y monto. Revisa tu hoja antes de confirmar.']:[]),
  ].join('\n'));
  const missing=[...new Set(expenses.flatMap(missingDetails))];
  return '✓ Guardado\n'+lines.join('\n\n')+(missing.length?'\nFalta: '+missing.join(', '):'');
}

function recordButtons(ids,expenses,sheetId){
  const keyboard=[[{text:'Ver hoja',url:'https://docs.google.com/spreadsheets/d/'+sheetId+'/edit'},{text:'Ver detalles',callback_data:'expense:details:'+ids[0]}]];
  if(expenses.some(x=>missingDetails(x).length))keyboard.push([{text:'Completar datos',callback_data:'expense:complete:'+ids[0]},{text:'Más tarde',callback_data:'expense:later:'+ids[0]}]);
  keyboard.push([{text:'Deshacer',callback_data:'expense:undo:'+ids[0]}]);
  return {inline_keyboard:keyboard};
}

async function completionFromText(uid,chat,text,link,pending,env){
  const {ids}=JSON.parse(pending.payload);
  const access=await refreshAccess(link.google_refresh_token,env);
  const all=await readExpenses(link.sheet_id,access);
  const expenses=ids.map(id=>all.find(x=>x.id===id));
  if(expenses.some(x=>!x))return send(chat,'Ese gasto ya no está en tu hoja.',env);
  const result=await analyzeText('Completa solamente los datos complementarios de estos gastos, manteniendo el orden, montos, fechas y descripciones. Datos actuales: '+JSON.stringify(expenses)+'\nInformación adicional del usuario: '+text,profile(link,env),env,'Telegram');
  if(result.question)return send(chat,result.question,env);
  const updated=await completeExpenses(link.sheet_id,ids,result.expenses,access);
  await env.DB.prepare('DELETE FROM pending WHERE telegram_user_id=?').bind(uid).run();
  return send(chat,'Listo, actualicé los datos.\n'+shortReceipt(updated,env.BOT_LANGUAGE).replace('✓ Guardado\n',''),env,{inline_keyboard:[[{text:'Ver hoja',url:'https://docs.google.com/spreadsheets/d/'+link.sheet_id+'/edit'}]]});
}

async function saveClearExpenses(uid,chat,link,result,env,confirmed=false){
  if(!result.expenses?.length&&result.excludedCount)return send(chat,'No encontré gastos de consumo para importar. Transacciones excluidas: '+result.excludedCount+'. '+(result.reviewNotes||''),env);
  if(!confirmed&&result.expenses?.length&&(result.expenses.length>1||result.documentType==='statement'||result.expenses.some(x=>x.source==='Documento'))){
    const access=await refreshAccess(link.google_refresh_token,env);
    const existing=await readExpenses(link.sheet_id,access);
    result.expenses=result.expenses.map(x=>({...x,possibleDuplicate:existing.some(old=>old.date===x.date&&old.currency===x.currency&&old.amount===x.amount)}));
    const nonce=randomCode();
    await env.DB.prepare('INSERT INTO pending VALUES(?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at').bind(uid,'import',JSON.stringify({nonce,result}),Date.now()+PENDING_TTL).run();
    const preview=shortReceipt(result.expenses).replace('✓ Guardado','Revisa antes de guardar:');
    const totals=new Map();for(const x of result.expenses)totals.set(x.currency,(totals.get(x.currency)||0)+x.amount);
    return send(chat,result.expenses.length+' gastos detectados.\n'+preview+'\nTotal: '+[...totals].map(([currency,total])=>money(total,currency)).join(' + ')+'\n'+(result.excludedCount?'Omitidos: '+result.excludedCount+'. '+(result.reviewNotes||'')+'\n':'')+'Todavía no se guardó nada.',env,{inline_keyboard:[[{text:'Guardar gastos',callback_data:'import:save:'+nonce},{text:'Cancelar',callback_data:'import:cancel:'+nonce}]]});
  }
  if(!result.expenses?.length)return send(chat,'¿Qué compraste y cuánto pagaste? También puedes enviarme una foto del recibo.',env);
  const access=await refreshAccess(link.google_refresh_token,env);
  const ids=await appendExpenses(link.sheet_id,result.expenses,access);
  await env.DB.prepare(
    'INSERT INTO pending VALUES(?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at'
  ).bind(uid,'undo',JSON.stringify({ids}),Date.now()+10*60*1000).run();
  return send(chat,shortReceipt(result.expenses,env.BOT_LANGUAGE),env,recordButtons(ids,result.expenses,link.sheet_id));
}

async function rememberClarification(uid,context,env){
  await env.DB.prepare(
    'INSERT INTO pending VALUES(?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at'
  ).bind(uid,'clarify',JSON.stringify(context),Date.now()+PENDING_TTL).run();
}

async function handleClarification(uid,chat,text,link,pending,env){
  const context=JSON.parse(pending.payload);
  const combined=[
    context.originalText||'',
    context.transcript?('Transcripción original: '+context.transcript):'',
    context.partial?.length?('Datos detectados: '+JSON.stringify(context.partial)):'',
    'Pregunta previa: '+(context.question||''),
    'Respuesta del usuario: '+text
  ].filter(Boolean).join('\n');

  const result=await analyzeText(combined,profile(link,env),env,context.source||'Telegram');
  if(result.question){
    await rememberClarification(uid,{
      ...context,
      originalText:combined,
      partial:result.expenses||context.partial||[],
      question:result.question
    },env);
    return send(chat,result.question,env);
  }

  await env.DB.prepare('DELETE FROM pending WHERE telegram_user_id=?').bind(uid).run();
  return saveClearExpenses(uid,chat,link,result,env);
}

async function processText(uid,chat,text,link,env){
  const result=await analyzeText(text,profile(link,env),env,'Telegram');
  if(result.question){
    await rememberClarification(uid,{source:'Telegram',originalText:text,partial:result.expenses||[],question:result.question},env);
    return send(chat,result.question,env);
  }
  return saveClearExpenses(uid,chat,link,result,env);
}

async function processPhoto(uid,chat,message,link,env){
  const photos=message.photo||[];
  const best=photos[photos.length-1];
  if(!best?.file_id)throw new Error('No encontré la foto.');
  await send(chat,'Leyendo tu foto…',env);
  const file=await mediaStep('file-download',()=>telegramFile(best.file_id,env,'recibo.jpg','image/jpeg'));
  const result=await mediaStep('photo-analysis',()=>analyzeReceipt(file,profile(link,env),env,message.caption||''));
  if(result.question){
    await rememberClarification(uid,{source:'Foto',originalText:message.caption||'',partial:result.expenses||[],question:result.question},env);
    return send(chat,result.question,env);
  }
  return saveClearExpenses(uid,chat,link,result,env);
}

async function processAudio(uid,chat,message,link,env){
  const media=message.voice||message.audio;
  if(!media?.file_id)throw new Error('No encontré el audio.');
  await send(chat,'Escuchando tu audio…',env);
  const file=await mediaStep('file-download',()=>telegramFile(media.file_id,env,message.voice?'gasto.ogg':media.file_name||'gasto-audio',media.mime_type||(message.voice?'audio/ogg':'')));
  const result=await mediaStep('audio-analysis',()=>analyzeAudio(file,profile(link,env),env,message.caption||''));
  if(result.question){
    await rememberClarification(uid,{
      source:'Audio',
      originalText:message.caption||'',
      transcript:result.transcript||'',
      partial:result.expenses||[],
      question:result.question
    },env);
    return send(chat,result.question,env);
  }
  return saveClearExpenses(uid,chat,link,result,env);
}

async function handleCallback(cb,env){
  await call('answerCallbackQuery',{callback_query_id:cb.id},env).catch(()=>{});
  if(cb.data?.startsWith('expense:details:')){
    if(cb.message?.chat?.type&&cb.message.chat.type!=='private')return;
    const uid=String(cb.from.id),chat=String(cb.message?.chat?.id||cb.from.id);
    try{
      const link=await userLink(uid,env);if(!link)return send(chat,'Conecta Google con /link para continuar.',env);
      const id=cb.data.slice('expense:details:'.length);
      const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
      let ids=[id];
      if(pending?.kind==='undo'){const saved=JSON.parse(pending.payload);if(saved.ids?.[0]===id)ids=saved.ids;}
      const access=await refreshAccess(link.google_refresh_token,env);
      const selected=(await readExpenses(link.sheet_id,access)).filter(x=>ids.includes(x.id));
      if(!selected.length)return send(chat,'Ese gasto ya no está en tu hoja.',env);
      return send(chat,savedMessage(selected).replace('Guardado en Mis gastos:','Estos son los datos guardados:'),env,{inline_keyboard:[[{text:'Ver hoja',url:'https://docs.google.com/spreadsheets/d/'+link.sheet_id+'/edit'}]]});
    }catch(error){console.error('Expense details failed',error);return send(chat,'No pude abrir ese gasto. Inténtalo de nuevo; no cambié nada.',env);}
  }
  if(cb.data?.startsWith('import:')){
    const uid=String(cb.from.id),chat=String(cb.message?.chat?.id||cb.from.id);
    const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
    if(pending?.kind==='import-saving')return send(chat,'Estoy guardando tus gastos. Espera un momento.',env);
    if(!pending||pending.kind!=='import'||Number(pending.expires_at)<=Date.now())return send(chat,'Esta lista ya se guardó o venció. Revisa tu hoja antes de enviarla otra vez.',env);
    const payload=JSON.parse(pending.payload);
    const action=cb.data.split(':')[1],nonce=cb.data.split(':')[2];
    if(nonce!==payload.nonce)return send(chat,'Esta lista ya se guardó o venció. Revisa tu hoja antes de enviarla otra vez.',env);
    if(action==='cancel'){
      await env.DB.prepare("DELETE FROM pending WHERE telegram_user_id=? AND kind='import' AND payload=?").bind(uid,pending.payload).run();
      return send(chat,'Cancelado. No guardé esos gastos.',env);
    }
    if(action!=='save')return;
    const lock=await env.DB.prepare("UPDATE pending SET kind='import-saving' WHERE telegram_user_id=? AND kind='import' AND payload=?").bind(uid,pending.payload).run();
    if(lock.meta?.changes!==1)return send(chat,'Estoy guardando tus gastos. Espera un momento.',env);
    try{
      const link=await userLink(uid,env);if(!link)return send(chat,'Conecta Google con /link para continuar.',env);
      return await saveClearExpenses(uid,chat,link,payload.result,env,true);
    }catch(error){console.error('Import save uncertain',error);return send(chat,'No pude confirmar si se guardaron. Revisa tu hoja antes de volver a enviarlos.',env);}
  }
  if(cb.data?.startsWith('language:')){
    const language=cb.data.slice(9);
    if(!['es','en'].includes(language))return;
    await setLanguage(String(cb.from.id),language,env);
    return send(String(cb.from.id),language==='en'?'Idioma: English.':'Idioma: Español.',{...env,BOT_LANGUAGE:language});
  }
  if(cb.data?.startsWith('menu:')){
    const actions={currency:'💱 Moneda',language:'🌐 Idioma / Language',help:'❓ Ayuda'};
    if(!actions[cb.data.slice(5)])return;
    return handleUpdate({message:{from:cb.from,chat:cb.message.chat,text:actions[cb.data.slice(5)]}},env);
  }
  if(cb.data?.startsWith('currency:')){
    const currency=cb.data.slice(9);
    if(!['CAD','USD','NIO','EUR','GTQ','MXN'].includes(currency))return;
    await env.DB.prepare('UPDATE user_links SET currency=? WHERE telegram_user_id=?').bind(currency,String(cb.from.id)).run();
    return send(String(cb.from.id),'Moneda principal: '+currency+'. Si un gasto está en otra moneda, indícala al enviarlo.',env);
  }
  if(cb.data?.startsWith('expense:complete:')||cb.data?.startsWith('expense:later:')){
    const uid=String(cb.from.id),chat=String(cb.message?.chat?.id||cb.from.id);
    if(cb.message?.chat?.type&&cb.message.chat.type!=='private')return;
    if(cb.data.startsWith('expense:later:')){
      await env.DB.prepare("DELETE FROM pending WHERE telegram_user_id=? AND kind='complete'").bind(uid).run();
      return send(chat,'Listo, quedó guardado. Puedes retomarlo en Completar datos cuando quieras.',env);
    }
    try{
      const link=await userLink(uid,env);
      if(!link)return send(chat,'Conecta Google con /link para continuar.',env);
      const id=cb.data.slice('expense:complete:'.length);
      const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
      let ids=[id];
      if(pending?.kind==='undo'){const saved=JSON.parse(pending.payload);if(saved.ids?.[0]===id)ids=saved.ids;}
      const access=await refreshAccess(link.google_refresh_token,env);
      const all=await readExpenses(link.sheet_id,access);
      const selected=ids.map(id=>all.find(x=>x.id===id));
      if(selected.some(x=>!x))return send(chat,'Ese gasto ya no está en tu hoja.',env);
      await env.DB.prepare('INSERT INTO pending VALUES(?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at').bind(uid,'complete',JSON.stringify({ids}),Date.now()+PENDING_TTL).run();
      const missing=[...new Set(selected.flatMap(missingDetails))];
      return send(chat,'Falta: '+(missing.join(', ')||'puedes agregar notas o viaje/proyecto')+'.\nEscribe los datos. Ejemplo: «RBC crédito, único y variable».\nPara dejarlo para después, envía /cancelar.',env);
    }catch(error){console.error('Completion setup failed',error);return send(chat,'No pude abrir ese gasto. Inténtalo de nuevo; no cambié nada.',env);}
  }
  if(!cb.data?.startsWith('expense:undo:'))return;
  const uid=String(cb.from.id);
  const chat=String(cb.message?.chat?.id||cb.from.id);
  const link=await userLink(uid,env);
  if(!link)return send(chat,'Conecta Google otra vez con /link para continuar.',env);
  const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
  if(!pending||pending.kind!=='undo'||Number(pending.expires_at)<=Date.now()){
    return send(chat,'Ya no puedo deshacerlo desde aquí. Puedes borrarlo en tu hoja.',env);
  }
  try{
    const payload=JSON.parse(pending.payload||'{}');
    if(cb.data!=='expense:undo:'+payload.ids?.[0])return send(chat,'Usa Deshacer en el último gasto que guardaste.',env);
    const access=await refreshAccess(link.google_refresh_token,env);
    const removed=await deleteExpensesByIds(link.sheet_id,payload.ids||[],access);
    await env.DB.prepare('DELETE FROM pending WHERE telegram_user_id=?').bind(uid).run();
    return send(chat,removed?'Listo, borré ese gasto.':'Ese gasto ya no está en tu hoja. No cambié nada.',env);
  }catch(e){
    console.error('Telegram undo error',e);
    return send(chat,'No pude borrarlo. Revisa tu hoja antes de intentarlo otra vez.',env);
  }
}

export async function handleUpdate(update,env){
  const sender=update.callback_query?.from||update.message?.from;
  if(!sender)return;
  const pref=await preferences(String(sender.id),env);
  env={...env,BOT_LANGUAGE:pref.language};
  if(update.callback_query)return handleCallback(update.callback_query,env);
  const m=update.message;
  if(!m||m.chat?.type!=='private')return;

  const uid=String(m.from.id);
  const chat=String(m.chat.id);
  const text=normalizeMenu(String(m.text||m.caption||'').trim());
  if(text==='🌐 Idioma / Language'||/^\/(idioma|language)\b/i.test(text))return send(chat,'¿En qué idioma prefieres hablar? / Choose your language.',env,{inline_keyboard:[[{text:'Español',callback_data:'language:es'},{text:'English',callback_data:'language:en'}]]});
  if(/^\/link\b/i.test(text))return createLink(chat,uid,env);
  let link;
  try{link=await userLink(uid,env);}catch(error){console.error('User link failed',error);return send(chat,'Necesito que conectes Google otra vez. Envía /link para continuar.',env);}
  if(/^\/start\b/i.test(text)){
    return link
      ? send(chat,'¡Hola! Cuéntame qué gastaste o envíame una foto o un audio.',env)
      : createLink(chat,uid,env);
  }

  if(!link)return createLink(chat,uid,env);

  if (/^\/(help|ayuda)\b/i.test(text)||text==='❓ Ayuda')return send(chat,help,env);
  if (/^\/cancelar\b/i.test(text)){
    await env.DB.prepare('DELETE FROM pending WHERE telegram_user_id=? AND kind IN (?,?,?)').bind(uid,'clarify','complete','import').run();
    return send(chat,'Listo, cancelado. Tus gastos guardados siguen en la hoja.',env);
  }
  if(text==='🧾 Registrar gasto')return send(chat,'¿Qué gastaste?\nEjemplo: «Pagué 25 en supermercado con mi tarjeta RBC».\nTambién puedes enviar una foto o un audio.',env);
  if(text==='📥 Importar movimientos')return send(chat,'Envía una imagen o PDF con tus gastos. Te mostraré la lista antes de guardarla.\nHasta 25 gastos por envío.',env);
  if(text==='⚙️ Ajustes')return send(chat,'¿Qué quieres ajustar?',env,{inline_keyboard:[[{text:'💱 Moneda',callback_data:'menu:currency'},{text:'🌐 Idioma / Language',callback_data:'menu:language'}],[{text:'❓ Ayuda',callback_data:'menu:help'}]]});
  if(text==='💱 Moneda')return send(chat,'Moneda actual: '+link.currency+'. ¿Cuál prefieres usar?',env,{inline_keyboard:[['CAD','USD','NIO','EUR','GTQ','MXN'].map(currency=>({text:currency,callback_data:'currency:'+currency}))]});
  if (/^\/moneda\b/i.test(text)){
    const currency=text.split(/\s+/)[1]?.toUpperCase();
    if(!['CAD','USD','NIO','EUR','GTQ','MXN'].includes(currency))return send(chat,'Usa /moneda CAD, USD, NIO, EUR, GTQ o MXN.',env);
    await env.DB.prepare('UPDATE user_links SET currency=? WHERE telegram_user_id=?').bind(currency,uid).run();
    return send(chat,'Moneda principal: '+currency,env);
  }
  const isReply=m.text&&!text.startsWith('/')&&!['📊 Este mes','🏷 Categorías','📄 Mi hoja','📝 Pendientes'].includes(text);
  const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
  if(pending&&['undo','complete'].includes(pending.kind)&&/^(despues|completar despues|mas tarde|luego)$/i.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g,''))){
    await env.DB.prepare("DELETE FROM pending WHERE telegram_user_id=? AND kind='complete'").bind(uid).run();
    return send(chat,'Listo, quedó guardado. Puedes retomarlo en Completar datos cuando quieras.',env);
  }
  if(pending?.kind==='complete'&&Number(pending.expires_at)>Date.now()&&!m.text)return send(chat,'Escribe los datos que faltan. Para dejarlo y anotar otro gasto, envía /cancelar.',env);
  if(pending?.kind==='complete'&&Number(pending.expires_at)>Date.now()&&isReply){
    try{return await completionFromText(uid,chat,text,link,pending,env);}catch(error){console.error('Completion failed',error);return send(chat,'No pude confirmar el cambio. Revisa tu hoja antes de intentarlo otra vez.',env);}
  }
  if(pending?.kind==='import'&&!text.startsWith('/')&&!['📊 Este mes','🏷 Categorías','📄 Mi hoja','📝 Pendientes'].includes(text))return send(chat,'Primero elige Guardar gastos o Cancelar en la lista anterior.',env);
  if(pending&&pending.kind==='clarify'&&Number(pending.expires_at)>Date.now()&&isReply){
    try{return await handleClarification(uid,chat,text,link,pending,env);}catch(error){console.error('Clarification failed',error);return send(chat,'No pude terminar de guardarlo. Revisa tu hoja antes de enviarlo otra vez.',env);}
  }
  if(/^\/pendientes\b/i.test(text)||text==='📝 Pendientes'){
    try{
      const access=await refreshAccess(link.google_refresh_token,env);
      const rows=(await readExpenses(link.sheet_id,access)).filter(x=>missingDetails(x).length);
      if(!rows.length)return send(chat,'¡Todo al día! No hay datos por completar.',env);
      const selected=rows.slice(-8).reverse();
      return send(chat,'Hay '+rows.length+' gastos con datos por completar. ¿Cuál quieres completar?',env,{inline_keyboard:selected.map(x=>[{text:(x.date+' · '+x.description+' · '+money(x.amount,x.currency)).slice(0,60),callback_data:'expense:complete:'+x.id}])});
    }catch(error){console.error('Pending details failed',error);return send(chat,'No pude abrir la lista. Inténtalo de nuevo.',env);}
  }
  const kind=m.text?queryKind(text):'';
  if(kind){
    if(kind==='unsupported')return send(chat,'Por ahora puedo mostrarte este mes. Elige Este mes o Por categoría.',env);
    if(kind==='sheet')return send(chat,'Tu hoja: https://docs.google.com/spreadsheets/d/'+link.sheet_id+'/edit',env);
    try{
      const access=await refreshAccess(link.google_refresh_token,env);
      const rows=await readExpenses(link.sheet_id,access);
      return send(chat,monthlySummary(rows,profile(link,env).timezone,kind),env);
    }catch(error){console.error('Summary failed',error);return send(chat,'No pude abrir tu hoja. Inténtalo de nuevo en un momento.',env);}
  }
  if(text.startsWith('/'))return send(chat,help,env);



  try{
    if(m.document){
      const type=m.document.mime_type||'';
      if(type!=='application/pdf'&&!type.startsWith('image/'))return send(chat,'Por ahora puedo leer fotos y PDFs. Envíame uno de esos archivos.',env);
      if(m.document.file_size>8*1024*1024)return send(chat,'El archivo es muy grande. Envía una página o una foto de cada parte.',env);
      const raw=await mediaStep('file-download',()=>telegramFile(m.document.file_id,env,m.document.file_name||'gastos.pdf',type));
      const file=new File([raw],raw.name,{type});
      const result=await mediaStep('document-analysis',()=>analyzeDocument(file,profile(link,env),env,m.caption||''));
      if(result.question){
        await rememberClarification(uid,{source:'Documento',originalText:result.question,partial:result.expenses||[],question:result.question},env);
        return send(chat,result.question+' Si falta información visual, vuelve a enviar el documento con una aclaración en el pie de foto.',env);
      }
      return await saveClearExpenses(uid,chat,link,result,env);
    }
    if(m.photo)return await processPhoto(uid,chat,m,link,env);
    if(m.voice||m.audio)return await processAudio(uid,chat,m,link,env);
    if(text)return await processText(uid,chat,text,link,env);
    return send(chat,'Envíame un gasto por texto, una foto del recibo o un audio.',env);
  }catch(e){
    console.error('Telegram expense error',e);
    if(e.message?.includes('25 gastos'))return send(chat,'Hay demasiados gastos en este archivo. Envíalos en grupos de hasta 25.',env);
    const mediaMessages={'file-download':'No pude abrir el archivo. Vuelve a enviarlo.','photo-analysis':'No pude leer esa foto. Prueba otra o escribe el gasto.','audio-transcription':'No pude entender ese audio. Prueba con otro o escribe el gasto.','audio-analysis':'No pude identificar el gasto en ese audio. Dime qué compraste y cuánto pagaste.','document-analysis':'No pude leer ese PDF. Prueba con una página o con fotos.'};
    if(mediaMessages[e.mediaStage])return send(chat,mediaMessages[e.mediaStage],env);
    return send(chat,'No pude confirmar si se guardó. Revisa tu hoja antes de enviarlo otra vez.',env);
  }
}

export async function saveGoogleLink(link,refreshToken,sheetId,env){
  const enc=await encrypt(refreshToken,env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(
    'INSERT INTO user_links(telegram_user_id,chat_id,google_refresh_token,sheet_id,currency,timezone,linked_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET chat_id=excluded.chat_id,google_refresh_token=excluded.google_refresh_token,sheet_id=excluded.sheet_id,linked_at=excluded.linked_at'
  ).bind(
    link.telegram_user_id,
    link.chat_id,
    enc,
    sheetId,
    'CAD',
    env.DEFAULT_TIMEZONE||'America/Toronto',
    Date.now()
  ).run();
  await send(link.chat_id,'¡Ya estás conectado! Envíame tu primer gasto por texto, foto o audio.',env).catch(error=>console.error('Link notification failed',error));
}

