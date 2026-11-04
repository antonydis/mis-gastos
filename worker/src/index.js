import {runReminders} from './reminders.js';
import {runWeeklyReports} from './weekly-report.js';
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
    ...(allow?{'Access-Control-Allow-Origin':allow}:{}),
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Vary':'Origin'
  };
}
function json(data,status=200,env,request){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...(env&&request?corsHeaders(env,request):{})}})}
function front(env,params){const u=new URL('/connection/result',env.PUBLIC_BASE_URL);u.searchParams.set('lang',env.BOT_LANGUAGE||'es');for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);return redirect(u.toString())}

function redirect(location,cookie){
  const headers={Location:location,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
  if(cookie)headers['Set-Cookie']=cookie;
  return new Response(null,{status:302,headers});
}

async function boundedBody(request,maxBytes){
  if(Number(request.headers.get('Content-Length'))>maxBytes)return null;
  const reader=request.body?.getReader();
  const chunks=[];
  let size=0;
  if(reader){
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  return new Response(new Blob(chunks),{headers:{'Content-Type':request.headers.get('Content-Type')||''}});
}

async function publicBody(request,env,maxBytes){
  const key=request.headers.get('CF-Connecting-IP')||'unknown';
  if(!env.PUBLIC_RATE_LIMIT)return {error:json({ok:false,error:'Service unavailable'},503,env,request)};
  if(!(await env.PUBLIC_RATE_LIMIT.limit({key})).success){
    const response=json({ok:false,error:'Too many requests'},429,env,request);
    response.headers.set('Retry-After','60');
    return {error:response};
  }
  const body=await boundedBody(request,maxBytes);
  return body?{body}:{error:json({ok:false,error:'Request too large'},413,env,request)};
}

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
  return redirect(googleAuthUrl(env,state),'__Host-mg-oauth='+state+'; Path=/; Max-Age=900; Secure; HttpOnly; SameSite=Lax');
}

async function oauthCallback(url,env,request){
  const state=url.searchParams.get('state'),code=url.searchParams.get('code');
  if(!state||!code)return front(env,{telegram:'error',reason:'oauth'});
  const cookie=(request.headers.get('Cookie')||'').split(';').map(value=>value.trim());
  if(!cookie.includes('__Host-mg-oauth='+state))return front(env,{telegram:'error',reason:'expired-state'});
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
  const now=Date.now();
  const claim=await env.DB.prepare(`UPDATE link_codes SET used=1 WHERE code=? AND used=0 AND expires_at>?
    AND EXISTS (SELECT 1 FROM oauth_states WHERE state=? AND link_code=link_codes.code AND expires_at>?)`)
    .bind(link.code,now,state,now).run();
  if(!claim.meta.changes)return front(env,{telegram:'error',reason:'expired-link'});
  await env.DB.prepare('DELETE FROM oauth_states WHERE link_code=?').bind(link.code).run();
  stage='exchange';
  const token=await exchangeCode(code,env);
  if(!token.refresh_token)return front(env,{telegram:'error',reason:'no-refresh-token'});
  stage='sheet';
  const sheet=await ensureSheet(token.access_token,env);
  stage='save-link';
  if(!await saveGoogleLink(link,token.refresh_token,sheet.id,env))
    return front(env,{telegram:'error',reason:'sheet-already-linked'});
  return front(env,{telegram:'linked'});
  }catch(error){
    console.error('OAuth linking failed',stage);
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
  }catch(e){console.error('Pilot notification unavailable');return false;}
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
  }catch(e){console.error('Pilot confirmation unavailable');return false;}
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
  const input=await publicBody(request,env,4096);
  if(input.error)return input.error;
  const body=await input.body.json().catch(()=>null);
  if(!body||typeof body!=='object')return json({ok:false,error:'Invalid request'},400,env,request);
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
  const input=await publicBody(request,env,16*1024);
  if(input.error)return input.error;
  const body=await input.body.json().catch(()=>null);
  if(typeof body?.text!=='string'||!body.text.trim())return json({ok:false,error:'Invalid text'},400,env,request);
  const profile={
    currency:String(body.currency||'CAD').toUpperCase(),
    timezone:String(body.timezone||env.DEFAULT_TIMEZONE||'America/Toronto'),
    language:body.language==='en'?'en':'es'
  };
  const result=await analyzeText(body.text,profile,env,String(body.source||'Texto'));
  return json({ok:true,...result},200,env,request);
}

async function analyzeReceiptRequest(request,env){
  const input=await publicBody(request,env,8*1024*1024+64*1024);
  if(input.error)return input.error;
  const form=await input.body.formData().catch(()=>null);
  if(!(form?.get('file') instanceof File))return json({ok:false,error:'Invalid file'},400,env,request);
  const file=form.get('file');
  const result=await analyzeReceipt(file,mediaProfile(form,env),env);
  return json({ok:true,...result},200,env,request);
}

async function analyzeAudioRequest(request,env){
  const input=await publicBody(request,env,25*1024*1024+64*1024);
  if(input.error)return input.error;
  const form=await input.body.formData().catch(()=>null);
  if(!(form?.get('file') instanceof File))return json({ok:false,error:'Invalid file'},400,env,request);
  const file=form.get('file');
  const result=await analyzeAudio(file,mediaProfile(form,env),env);
  return json({ok:true,...result},200,env,request);
}

async function webhook(request,env){
  if(!env.TELEGRAM_WEBHOOK_SECRET)return new Response('Webhook not configured',{status:503});
  if(request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)return new Response('Forbidden',{status:403});
  const update=await request.json().catch(()=>null);
  if(!Number.isSafeInteger(update?.update_id))return json({ok:false,error:'Invalid update'},400);
  const claim=await env.DB.prepare('INSERT OR IGNORE INTO processed_updates(update_id,processed_at) VALUES(?,?)')
    .bind(String(update.update_id),Date.now()).run();
  if(!claim.meta.changes)return json({ok:true});
  try{
    await handleUpdate(update,env);
  }catch{
    // A write to Sheets might have succeeded before a downstream failure.
    // Replaying the entire handler could duplicate a financial movement.
    console.error('Telegram update outcome uncertain');
    const message=update.message||update.callback_query?.message;
    const sender=update.callback_query?.from||update.message?.from;
    if(message?.chat?.type==='private'&&message.chat.id===sender?.id){
      await send(String(sender.id),'No pude confirmar la operación. Revisa tu hoja antes de intentarlo otra vez. / Could not confirm. Check your sheet before retrying.',env)
        .catch(()=>console.error('Telegram failure notification unavailable'));
    }
  }
  return json({ok:true});
}

export default{
  async scheduled(event,env){
    const now=new Date(event.scheduledTime||Date.now());
    await runReminders(env,send,now);
    await runWeeklyReports(env,send,now);
    await notifyPendingPilots(env);
    await deliverPendingPilotConfirmations(env);
    if(now.getUTCMinutes()===0)await env.DB.batch([
      env.DB.prepare('DELETE FROM pending WHERE expires_at<?').bind(now.getTime()),
      env.DB.prepare('DELETE FROM link_codes WHERE expires_at<?').bind(now.getTime()),
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(now.getTime()),
      env.DB.prepare('DELETE FROM processed_updates WHERE processed_at<?').bind(now.getTime()-7*86400000)
    ]);
  },
  async fetch(request,env){
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
      if(url.pathname==='/oauth/callback'&&request.method==='GET'){try{return await oauthCallback(url,env,request);}catch(error){console.error('OAuth callback failed');return front(env,{telegram:'error',reason:'google-setup'});}}
      if(url.pathname==='/telegram/webhook'&&request.method==='POST')return await webhook(request,env);
      if(url.pathname==='/admin/setup-webhook'&&request.method==='POST'){
        if(!env.SETUP_SECRET||request.headers.get('X-Setup-Secret')!==env.SETUP_SECRET)return json({ok:false,error:'Forbidden'},403);
        const result=await setupWebhook(env);return json({ok:true,result});
      }
      return json({ok:false,error:'Not found'},404,env,request);
    }catch{console.error('Worker request failed');return json({ok:false,error:'Internal error'},500,env,request)}
  }
};

