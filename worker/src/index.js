import {runReminders} from './reminders.js';
import {preferences} from './preferences.js';
import {connectionIssue,connectionPage} from './connection.js';
import {googleAuthUrl,exchangeCode,ensureSheet} from './google.js';
import {createLink,handleUpdate,saveGoogleLink,setupWebhook,send} from './telegram.js';
import {randomCode,encrypt} from './utils.js';
import {analyzeReceipt,analyzeAudio,analyzeText} from './openai.js';

function corsHeaders(env,request){
  const origin=request?.headers?.get?.('Origin')||'';
  const allowed=env.FRONTEND_URL ? new URL(env.FRONTEND_URL).origin : '';
  const legacy='https://antonydis.github.io';
  const approved=origin===allowed||origin===legacy;
  const allow=approved?origin:allowed;
  return {
    'Access-Control-Allow-Origin':allow||'*',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Vary':'Origin'
  };
}
function json(data,status=200,env,request){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...(env&&request?corsHeaders(env,request):{})}})}
function front(env,params){const u=new URL('/connection/result',env.PUBLIC_BASE_URL);u.searchParams.set('lang',env.BOT_LANGUAGE||'es');for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);return Response.redirect(u.toString(),302)}

async function oauthStart(url,env){
  const code=url.searchParams.get('link');
  if(!code)return front(env,{telegram:'error',reason:'missing-link'});
  const link=await env.DB.prepare('SELECT * FROM link_codes WHERE code=?').bind(code).first();
  if(!link||link.used||Number(link.expires_at)<=Date.now())return front(env,{telegram:'error',reason:'expired-link'});
  env={...env,BOT_LANGUAGE:(await preferences(link.telegram_user_id,env)).language};
  const issue=await connectionIssue(env);
  if(issue)return front(env,{telegram:'error',reason:issue});
  const state=randomCode();
  await env.DB.prepare('INSERT INTO oauth_states(state,link_code,expires_at) VALUES(?,?,?)').bind(state,code,Date.now()+15*60*1000).run();
  return Response.redirect(googleAuthUrl(env,state),302);
}

async function oauthCallback(url,env){
  const state=url.searchParams.get('state'),code=url.searchParams.get('code');
  if(!state||!code)return front(env,{telegram:'error',reason:'oauth'});
  const st=await env.DB.prepare('SELECT * FROM oauth_states WHERE state=?').bind(state).first();
  if(!st||Number(st.expires_at)<=Date.now())return front(env,{telegram:'error',reason:'expired-state'});
  const link=await env.DB.prepare('SELECT * FROM link_codes WHERE code=?').bind(st.link_code).first();
  if(!link||link.used||Number(link.expires_at)<=Date.now())return front(env,{telegram:'error',reason:'expired-link'});
  env={...env,BOT_LANGUAGE:(await preferences(link.telegram_user_id,env)).language};
  let stage='configuration';
  try{
  if(!env.GOOGLE_CLIENT_SECRET)return front(env,{telegram:'error',reason:'missing-google-secret'});
  stage='encryption';
  await encrypt('configuration-check',env.TOKEN_ENCRYPTION_KEY||'');
  stage='exchange';
  const token=await exchangeCode(code,env);
  if(!token.refresh_token)return front(env,{telegram:'error',reason:'no-refresh-token'});
  stage='sheet';
  const sheet=await ensureSheet(token.access_token,env);
  stage='save-link';
  await saveGoogleLink(link,token.refresh_token,sheet.id,env);
  await env.DB.batch([
    env.DB.prepare('UPDATE link_codes SET used=1 WHERE code=?').bind(link.code),
    env.DB.prepare('DELETE FROM oauth_states WHERE state=?').bind(state)
  ]);
  return front(env,{telegram:'linked'});
  }catch(error){
    console.error('OAuth linking failed',stage,error);
    let reason='google-'+stage;
    if(error.oauthCode==='invalid_client')reason='oauth-client';
    if(error.oauthCode==='invalid_grant')reason='oauth-code';
    if(['SERVICE_DISABLED','accessNotConfigured'].includes(error.googleReason))reason=error.googleService+'-api-disabled';
    else if(error.httpStatus===403)reason=error.googleService+'-permission';
    return front(env,{telegram:'error',reason});
  }
}


// Pilot registrations are stored separately from spending data. Configure
// RESEND_API_KEY, WAITLIST_FROM_EMAIL and WAITLIST_NOTIFY_EMAIL as Worker secrets.
async function sendPilotNotification(entry,env){
  if(!env.RESEND_API_KEY||!env.WAITLIST_FROM_EMAIL||!env.WAITLIST_NOTIFY_EMAIL){console.error('Pilot admin email skipped: missing mail configuration');return false;}
  try{
    const message=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:env.WAITLIST_FROM_EMAIL,to:[env.WAITLIST_NOTIFY_EMAIL],
        subject:'Mis Gastos · Nuevo interesado en el piloto',
        text:'Nueva solicitud para el piloto de Mis Gastos.\nNombre: '+entry.name+'\nCorreo: '+entry.email+'\nFecha (UTC): '+new Date(entry.created_at).toISOString()
      })
    });
    if(!message.ok){console.error('Pilot notification rejected',message.status);return false;}
    await env.DB.prepare('UPDATE pilot_waitlist SET notified_at=? WHERE email=? AND notified_at IS NULL')
      .bind(Date.now(),entry.email).run();
    return true;
  }catch(e){console.error('Pilot notification unavailable',e);return false;}
}
async function notifyPendingPilots(env){
  if(!env.RESEND_API_KEY||!env.WAITLIST_FROM_EMAIL||!env.WAITLIST_NOTIFY_EMAIL)return;
  const entries=await env.DB.prepare('SELECT name,email,created_at FROM pilot_waitlist WHERE notified_at IS NULL ORDER BY created_at ASC LIMIT 10').all();
  for(const entry of entries.results||[])await sendPilotNotification(entry,env);
}

function pilotEmailHtml(name){
  const safe=String(name).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  return '<!doctype html><html lang="es"><body style="margin:0;background:#f6f5ef;font-family:Arial,sans-serif;color:#20352b;padding:28px 12px"><div style="max-width:520px;margin:auto;background:white;border:1px solid #dce5dc;border-radius:14px;padding:32px"><p style="font-size:12px;letter-spacing:2px;font-weight:bold;color:#458361">MIS GASTOS</p><h1 style="font-size:25px;margin:25px 0 18px">Confirmación de inscripción</h1><p>Hola '+safe+',</p><p style="line-height:1.7">Gracias por tu interés en participar en el piloto de Mis Gastos. Hemos recibido correctamente tu inscripción.</p><p style="line-height:1.7">Durante la próxima semana me pondré en contacto contigo para informarte sobre los siguientes pasos.</p><p style="margin-top:26px;line-height:1.7">Saludos,<br><strong>Antony Díaz</strong><br>Mis Gastos</p><p style="border-top:1px solid #e7ece6;padding-top:16px;font-size:12px;color:#718176">Este mensaje confirma tu inscripción; el acceso al piloto se enviará posteriormente.</p></div></body></html>';
}
async function confirmPilotSignup(entry,env){
  if(!env.RESEND_API_KEY||!env.WAITLIST_FROM_EMAIL){console.error('Pilot confirmation skipped: missing mail configuration');return false;}
  try{
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:env.WAITLIST_FROM_EMAIL,
        to:[entry.email],
        subject:'Confirmación de inscripción | Mis Gastos',
        html:pilotEmailHtml(entry.name),
        text:'Hola '+entry.name+',\\n\\nGracias por tu interés en participar en el piloto de Mis Gastos. Hemos recibido correctamente tu inscripción.\\n\\nDurante la próxima semana me pondré en contacto contigo para informarte sobre los siguientes pasos.\\n\\nSaludos,\\nAntony Díaz\\nMis Gastos\\n\\nEste mensaje confirma tu inscripción; el acceso al piloto se enviará posteriormente.'
      })
    });
    if(!response.ok){console.error('Pilot signup confirmation failed',response.status);return false;}
    await env.DB.prepare('UPDATE pilot_confirmation_queue SET sent_at=? WHERE email=? AND sent_at IS NULL').bind(Date.now(),entry.email).run();
    return true;
  }catch(e){console.error('Pilot confirmation unavailable',e);return false;}
}
async function deliverPendingPilotConfirmations(env){
  if(!env.RESEND_API_KEY||!env.WAITLIST_FROM_EMAIL)return;
  const result=await env.DB.prepare('SELECT email,name FROM pilot_confirmation_queue WHERE sent_at IS NULL ORDER BY queued_at ASC LIMIT 10').all();
  for(const entry of result.results||[])await confirmPilotSignup(entry,env);
}
async function ensurePilotConfirmationsTable(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS pilot_confirmation_queue (email TEXT PRIMARY KEY, name TEXT NOT NULL, queued_at INTEGER NOT NULL, sent_at INTEGER)').run();
}

async function registerPilot(request,env){
  const size=Number(request.headers.get('content-length')||0);
  if(size>4096)return json({ok:false,error:'Request too large'},413,env,request);
  const body=await request.json();
  if(body.website){console.warn('Pilot signup blocked by honeypot');return json({ok:false,error:'Please retry the form'},400,env,request);}
  const name=String(body.name||'').trim(),email=String(body.email||'').trim().toLowerCase();
  if(!body.consent||name.length<2||name.length>100||email.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(email))
    return json({ok:false,error:'Invalid details or missing consent'},400,env,request);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS pilot_waitlist (email TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, notified_at INTEGER)').run();
  await env.DB.prepare('INSERT OR IGNORE INTO pilot_waitlist(email,name,created_at,notified_at) VALUES(?,?,?,NULL)')
    .bind(email,name,Date.now()).run();
  await ensurePilotConfirmationsTable(env);
  await env.DB.prepare('INSERT OR IGNORE INTO pilot_confirmation_queue(email,name,queued_at,sent_at) VALUES(?,?,?,NULL)').bind(email,name,Date.now()).run();
  const entry=await env.DB.prepare('SELECT name,email,created_at,notified_at FROM pilot_waitlist WHERE email=?').bind(email).first();
  console.info('Pilot signup persisted; admin notification pending:',!entry.notified_at);
  if(!entry.notified_at)await sendPilotNotification(entry,env);
  const confirmation=await env.DB.prepare('SELECT sent_at FROM pilot_confirmation_queue WHERE email=?').bind(email).first();
  console.info('Pilot confirmation pending:',Boolean(confirmation&&!confirmation.sent_at));
  if(confirmation&&!confirmation.sent_at)await confirmPilotSignup({name:entry.name,email},env);
  // Saving a request must not depend on the notification provider being configured.
  return json({ok:true},200,env,request);
}

function mediaProfile(form,env){
  return {
    currency:String(form.get('currency')||'CAD').toUpperCase(),
    timezone:String(form.get('timezone')||env.DEFAULT_TIMEZONE||'America/Toronto')
  };
}

async function analyzeTextRequest(request,env){
  const body=await request.json();
  const profile={
    currency:String(body.currency||'CAD').toUpperCase(),
    timezone:String(body.timezone||env.DEFAULT_TIMEZONE||'America/Toronto'),
    language:body.language==='en'?'en':'es'
  };
  const result=await analyzeText(body.text,profile,env,String(body.source||'Texto'));
  return json({ok:true,...result},200,env,request);
}

async function analyzeReceiptRequest(request,env){
  const form=await request.formData();
  const file=form.get('file');
  const result=await analyzeReceipt(file,mediaProfile(form,env),env);
  return json({ok:true,...result},200,env,request);
}

async function analyzeAudioRequest(request,env){
  const form=await request.formData();
  const file=form.get('file');
  const result=await analyzeAudio(file,mediaProfile(form,env),env);
  return json({ok:true,...result},200,env,request);
}

async function webhook(request,env,ctx){
  if(!env.TELEGRAM_WEBHOOK_SECRET)return new Response('Webhook not configured',{status:503});
  if(request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)return new Response('Forbidden',{status:403});
  const update=await request.json();
  const id=String(update.update_id??'');
  if(id){
    const seen=await env.DB.prepare('SELECT update_id FROM processed_updates WHERE update_id=?').bind(id).first();
    if(seen)return json({ok:true});
    await env.DB.prepare('INSERT INTO processed_updates(update_id,processed_at) VALUES(?,?)').bind(id,Date.now()).run();
  }
  const processing=handleUpdate(update,env).catch(error=>console.error('Telegram update failed',error));
  ctx.waitUntil(processing);
  await processing;
  return json({ok:true});
}

export default{
  async scheduled(event,env){
    const now=new Date(event.scheduledTime||Date.now());
    await runReminders(env,send,now);
    await notifyPendingPilots(env);
    await deliverPendingPilotConfirmations(env);
    if(now.getUTCMinutes()===0)await env.DB.batch([
      env.DB.prepare('DELETE FROM pending WHERE expires_at<?').bind(now.getTime()),
      env.DB.prepare('DELETE FROM link_codes WHERE expires_at<?').bind(now.getTime()),
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(now.getTime()),
      env.DB.prepare('DELETE FROM processed_updates WHERE processed_at<?').bind(now.getTime()-7*86400000)
    ]);
  },
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(env,request)});
      if(url.pathname==='/connection/result')return connectionPage(url);
      if(url.pathname==='/connection/check'){const reason=await connectionIssue(env);return json({ok:!reason,...(reason?{reason}:{})});}
      if(url.pathname==='/pilot/waitlist'&&request.method==='POST')return await registerPilot(request,env);
      if(url.pathname==='/health')return json({ok:true,service:'mis-gastos-api'},200,env,request);
      if(url.pathname==='/ai/text'&&request.method==='POST')return await analyzeTextRequest(request,env);
      if(url.pathname==='/ai/receipt'&&request.method==='POST')return await analyzeReceiptRequest(request,env);
      if(url.pathname==='/ai/audio'&&request.method==='POST')return await analyzeAudioRequest(request,env);
      if(url.pathname==='/oauth/start'&&request.method==='GET')return await oauthStart(url,env);
      if(url.pathname==='/oauth/callback'&&request.method==='GET'){try{return await oauthCallback(url,env);}catch(error){console.error('OAuth callback failed',error);return front(env,{telegram:'error',reason:'google-setup'});}}
      if(url.pathname==='/telegram/webhook'&&request.method==='POST')return await webhook(request,env,ctx);
      if(url.pathname==='/admin/setup-webhook'&&request.method==='POST'){
        if(!env.SETUP_SECRET||request.headers.get('X-Setup-Secret')!==env.SETUP_SECRET)return json({ok:false,error:'Forbidden'},403);
        const result=await setupWebhook(env);return json({ok:true,result});
      }
      return json({ok:false,error:'Not found'},404,env,request);
    }catch(e){console.error(e);return json({ok:false,error:e.message||'Internal error'},500,env,request)}
  }
};

