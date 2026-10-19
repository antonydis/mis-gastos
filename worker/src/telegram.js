import {decrypt,encrypt,money,randomCode} from './utils.js';
import {appendExpenses,deleteExpensesByIds,refreshAccess,readExpenses} from './google.js';
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

const menu={keyboard:[[{text:'📊 Este mes'},{text:'🏷 Categorías'}],[{text:'📄 Mi hoja'},{text:'❓ Ayuda'}],[{text:'💱 Moneda'}]],resize_keyboard:true};
const help='Envíame un gasto por texto, una foto de un recibo, un PDF (máximo 8 MB) o un audio. Ejemplo: «Ayer gasté 25 CAD en supermercado». Guardo una fila por gasto y pregunto si falta algo esencial. También puedes consultar el mes, las categorías o abrir tu hoja. Usa /moneda CAD, USD, NIO o EUR para elegir tu moneda; /cancelar para cancelar una aclaración; /link para volver a autorizar Google.';
export async function send(chatId,text,env,reply_markup=menu){
  return call('sendMessage',{chat_id:chatId,text,...(reply_markup?{reply_markup}:{})},env);
}

export async function setupWebhook(env){
  await call('setMyCommands',{commands:[{command:'start',description:'Conectar Google y empezar'},{command:'mes',description:'Ver gastos de este mes'},{command:'categorias',description:'Ver gastos por categoría'},{command:'hoja',description:'Abrir mi Google Sheet'},{command:'link',description:'Volver a conectar Google'},{command:'cancelar',description:'Cancelar una aclaración'},{command:'ayuda',description:'Cómo usar Mis gastos'}]},env);
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
    '¡Bienvenido a Mis gastos! Conecta Google para crear tu hoja personal y guardar tus gastos allí. Después podrás enviar texto, fotos o audios y consultar tus totales. Solo accedemos a los archivos de esta aplicación. El enlace vence en 15 minutos; usa /link si necesitas otro.',
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
  return send(chat,savedMessage(result.expenses)+'\nhttps://docs.google.com/spreadsheets/d/'+link.sheet_id+'/edit',env,{inline_keyboard:[[{text:'Deshacer',callback_data:'expense:undo:'+ids[0]}]]});
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
  const file=await mediaStep('file-download',()=>telegramFile(best.file_id,env,'recibo.jpg','image/jpeg'));
  const result=await mediaStep('photo-analysis',()=>analyzeReceipt(file,profile(link,env),env));
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
  const file=await mediaStep('file-download',()=>telegramFile(media.file_id,env,message.voice?'gasto.ogg':media.file_name||'gasto-audio',media.mime_type||(message.voice?'audio/ogg':'')));
  const result=await mediaStep('audio-analysis',()=>analyzeAudio(file,profile(link,env),env));
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
  if(cb.data?.startsWith('currency:')){
    const currency=cb.data.slice(9);
    if(!['CAD','USD','NIO','EUR'].includes(currency))return;
    await env.DB.prepare('UPDATE user_links SET currency=? WHERE telegram_user_id=?').bind(currency,String(cb.from.id)).run();
    return send(String(cb.from.id),'Moneda principal: '+currency+'. Si mencionas otra moneda en un gasto, la respetaré.',env);
  }
  if(!cb.data?.startsWith('expense:undo:'))return;
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
    if(cb.data!=='expense:undo:'+payload.ids?.[0])return send(chat,'Ese botón corresponde a otro gasto. Usa el botón del último registro.',env);
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
  if(/^\/link\b/i.test(text))return createLink(chat,uid,env);
  let link;
  try{link=await userLink(uid,env);}catch(error){console.error('User link failed',error);return send(chat,'No pude abrir tu conexión con Google. Usa /link para volver a conectarte.',env);}
  if(/^\/start\b/i.test(text)){
    return link
      ? send(chat,'¡Bienvenido a Mis gastos! Tu Google está conectado. '+help,env)
      : createLink(chat,uid,env);
  }

  if(!link)return createLink(chat,uid,env);

  if (/^\/(help|ayuda)\b/i.test(text)||text==='❓ Ayuda')return send(chat,help,env);
  if (/^\/cancelar\b/i.test(text)){
    await env.DB.prepare('DELETE FROM pending WHERE telegram_user_id=? AND kind=?').bind(uid,'clarify').run();
    return send(chat,'Aclaración cancelada. Puedes enviar otro gasto.',env);
  }
  if(text==='💱 Moneda')return send(chat,'Moneda actual: '+link.currency+'. Elige la moneda que usaré cuando no menciones ninguna:',env,{inline_keyboard:[['CAD','USD','NIO','EUR'].map(currency=>({text:currency,callback_data:'currency:'+currency}))]});
  if (/^\/moneda\b/i.test(text)){
    const currency=text.split(/\s+/)[1]?.toUpperCase();
    if(!['CAD','USD','NIO','EUR'].includes(currency))return send(chat,'Usa /moneda CAD, USD, NIO o EUR.',env);
    await env.DB.prepare('UPDATE user_links SET currency=? WHERE telegram_user_id=?').bind(currency,uid).run();
    return send(chat,'Moneda principal: '+currency,env);
  }
  const kind=queryKind(text);
  if(kind){
    if(kind==='unsupported')return send(chat,'Por ahora puedo resumir este mes y sus categorías. Usa los botones Este mes o Categorías.',env);
    if(kind==='sheet')return send(chat,'Tu hoja: https://docs.google.com/spreadsheets/d/'+link.sheet_id+'/edit',env);
    try{
      const access=await refreshAccess(link.google_refresh_token,env);
      const rows=await readExpenses(link.sheet_id,access);
      return send(chat,monthlySummary(rows,profile(link,env).timezone,kind),env);
    }catch(error){console.error('Summary failed',error);return send(chat,'No pude consultar tu hoja. Intenta de nuevo o usa /link para reconectar Google.',env);}
  }
  if(text.startsWith('/'))return send(chat,help,env);

  const pending=await env.DB.prepare('SELECT * FROM pending WHERE telegram_user_id=?').bind(uid).first();
  if(pending&&pending.kind==='clarify'&&Number(pending.expires_at)>Date.now()&&m.text){
    try{return await handleClarification(uid,chat,text,link,pending,env);}catch(error){console.error('Clarification failed',error);return send(chat,'No pude completar el registro. Revisa tu hoja antes de reenviarlo o usa /link para reconectar Google.',env);}
  }

  try{
    if(m.document){
      const type=m.document.mime_type||'';
      if(type!=='application/pdf'&&!type.startsWith('image/'))return send(chat,'Envíame una foto o un PDF de hasta 8 MB. Los archivos Excel todavía no se importan.',env);
      if(m.document.file_size>8*1024*1024)return send(chat,'El archivo supera 8 MB. Divídelo en archivos más pequeños.',env);
      const raw=await mediaStep('file-download',()=>telegramFile(m.document.file_id,env,m.document.file_name||'gastos.pdf',type));
      const file=new File([raw],raw.name,{type});
      const result=await analyzeDocument(file,profile(link,env),env);
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
    if(['file-download','photo-analysis','audio-transcription','audio-analysis'].includes(e.mediaStage))return send(chat,'No pude procesar el archivo; no llegué a guardarlo. Código: '+e.mediaStage+'. Tu conexión con Google sigue configurada.',env);
    return send(chat,'No pude confirmar el registro. Revisa tu hoja antes de reenviarlo para evitar duplicados. Si el problema continúa, usa /link para reconectar Google.',env);
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
  await send(link.chat_id,'Listo. Tu Google quedó conectado. Desde ahora solo envíame cada gasto por texto, foto o audio y se guardará automáticamente en Mis gastos. Moneda inicial: NIO. Puedes cambiarla con el botón Moneda. '+help,env).catch(error=>console.error('Link notification failed',error));
}

