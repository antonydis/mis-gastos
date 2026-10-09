import {decrypt,encrypt,money,randomCode} from './utils.js';
import {appendExpenses,deleteExpensesByIds,refreshAccess} from './google.js';
import {analyzeText,analyzeReceipt,analyzeAudio} from './openai.js';

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

export async function send(chatId,text,env,reply_markup){
  return call('sendMessage',{chat_id:chatId,text,...(reply_markup?{reply_markup}:{})},env);
}

export async function setupWebhook(env){
  return call('setWebhook',{
    url:env.PUBLIC_BASE_URL.replace(/\/$/,'')+'/telegram/webhook',
    secret_token:env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates:['message','callback_query'],
    drop_pending_updates:true
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
  const u=new URL(env.FRONTEND_URL);
  u.searchParams.set('link',code);
  return send(
    chatId,
    'Conecta tu Google una sola vez. Después solo envíame cada gasto por texto, foto o audio y lo guardaré en tu hoja Mis gastos.',
    env,
    {inline_keyboard:[[{text:'Conectar Google',url:u.toString()}]]}
  );
}

function profile(link,env){
  return {
    currency:link.currency||'NIO',
    timezone:link.timezone||env.DEFAULT_TIMEZONE||'America/Toronto'
  };
}

async function telegramFile(fileId,env,fallbackName){
  const info=await call('getFile',{file_id:fileId},env);
  if(!info?.file_path)throw new Error('Telegram no devolvió el archivo.');
  const response=await fetch('https://api.telegram.org/file/bot'+env.TELEGRAM_BOT_TOKEN+'/'+info.file_path);
  if(!response.ok)throw new Error('No pude descargar el archivo de Telegram.');
  const blob=await response.blob();
  const name=(info.file_path.split('/').pop()||fallbackName||'archivo').replace(/[^a-zA-Z0-9._-]/g,'_');
  return new File([blob],name,{type:blob.type||response.headers.get('content-type')||'application/octet-stream'});
}

function savedMessage(expenses){
  const lines=expenses.map(x=>{
    const merchant=x.merchant?' · '+x.merchant:'';
    return '✓ '+x.description+merchant+' · '+money(x.amount,x.currency)+' · '+x.category;
  });
  return 'Guardado en Mis gastos:\n'+lines.join('\n');
}

async function saveClearExpenses(uid,chat,link,result,env){
  if(!result.expenses?.length)throw new Error('No encontré un gasto claro.');
  const access=await refreshAccess(link.google_refresh_token,env);
  const ids=await appendExpenses(link.sheet_id,result.expenses,access);
  await env.DB.prepare(
    'INSERT INTO pending VALUES(?,?,?,?) ON CONFLICT(telegram_user_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at'
  ).bind(uid,'undo',JSON.stringify({ids}),Date.now()+10*60*1000).run();
  return send(chat,savedMessage(result.expenses),env,{inline_keyboard:[[{text:'Deshacer',callback_data:'expense:undo'}]]});
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
  await send(chat,'Analizando el recibo…',env);
  const file=await telegramFile(best.file_id,env,'recibo.jpg');
  const result=await analyzeReceipt(file,profile(link,env),env);
  if(result.question){
    await rememberClarification(uid,{source:'Foto',originalText:message.caption||'',partial:result.expenses||[],question:result.question},env);
    return send(chat,result.question,env);
  }
  return saveClearExpenses(uid,chat,link,result,env);
}

async function processAudio(uid,chat,message,link,env){
  const media=message.voice||message.audio;
  if(!media?.file_id)throw new Error('No encontré el audio.');
  await send(chat,'Entendiendo tu audio…',env);
  const file=await telegramFile(media.file_id,env,message.voice?'gasto.ogg':'gasto-audio');
  const result=await analyzeAudio(file,profile(link,env),env);
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
  if(cb.data!=='expense:undo')return;
  const uid=String(cb.from.id);
  const chat=String(cb.message?.chat?.id||cb.from.id);
  const link=await userLink(uid,env);
  if(!link)return send(chat,'Tu Google ya no está conectado. Usa /link para volver a conectarlo.',env);
  const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
  if(!pending||pending.kind!=='undo'||Number(pending.expires_at)<=Date.now()){
    return send(chat,'Ese gasto ya no se puede deshacer desde aquí.',env);
  }
  try{
    const payload=JSON.parse(pending.payload||'{}');
    const access=await refreshAccess(link.google_refresh_token,env);
    const removed=await deleteExpensesByIds(link.sheet_id,payload.ids||[],access);
    await env.DB.prepare('DELETE FROM pending WHERE telegram_user_id=?').bind(uid).run();
    return send(chat,removed?'Listo. Quité ese gasto de Mis gastos.':'No encontré ese gasto en la hoja. No hice cambios.',env);
  }catch(e){
    console.error('Telegram undo error',e);
    return send(chat,'No pude quitar ese gasto. No hice ningún cambio adicional.',env);
  }
}

export async function handleUpdate(update,env){
  if(update.callback_query)return handleCallback(update.callback_query,env);
  const m=update.message;
  if(!m||m.chat?.type!=='private')return;

  const uid=String(m.from.id);
  const chat=String(m.chat.id);
  const text=String(m.text||m.caption||'').trim();
  const link=await userLink(uid,env);

  if(/^\/(start|link)\b/i.test(text)){
    return link
      ? send(chat,'Tu Google ya está conectado. Envíame un gasto por texto, una foto del recibo o un audio y lo guardaré automáticamente.',env)
      : createLink(chat,uid,env);
  }

  if(!link)return createLink(chat,uid,env);

  const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
  if(pending&&pending.kind==='clarify'&&Number(pending.expires_at)>Date.now()&&text){
    return handleClarification(uid,chat,text,link,pending,env);
  }

  try{
    if(m.photo)return processPhoto(uid,chat,m,link,env);
    if(m.voice||m.audio)return processAudio(uid,chat,m,link,env);
    if(text)return processText(uid,chat,text,link,env);
    return send(chat,'Envíame un gasto por texto, una foto del recibo o un audio.',env);
  }catch(e){
    console.error('Telegram expense error',e);
    return send(chat,'No pude registrar ese gasto y no se guardó nada. Intenta nuevamente o escríbelo en texto.',env);
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
    'NIO',
    env.DEFAULT_TIMEZONE||'America/Toronto',
    Date.now()
  ).run();
  await send(link.chat_id,'Listo. Tu Google quedó conectado. Desde ahora solo envíame cada gasto por texto, foto o audio y se guardará automáticamente en Mis gastos.',env);
}
