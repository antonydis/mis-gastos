import {googleAuthUrl,exchangeCode,ensureSheet} from './google.js';
import {createLink,handleUpdate,saveGoogleLink,setupWebhook} from './telegram.js';
import {randomCode} from './utils.js';
import {analyzeReceipt,analyzeAudio} from './openai.js';

function corsHeaders(env,request){
  const origin=request?.headers?.get?.('Origin')||'';
  const allowed=(env.FRONTEND_URL||'').replace(/\/$/,'');
  const allow=origin&&allowed&&origin===allowed?origin:allowed;
  return {
    'Access-Control-Allow-Origin':allow||'*',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Vary':'Origin'
  };
}
function json(data,status=200,env,request){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...(env&&request?corsHeaders(env,request):{})}})}
function front(env,params){const u=new URL(env.FRONTEND_URL);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);return Response.redirect(u.toString(),302)}

async function oauthStart(url,env){
  const code=url.searchParams.get('link');
  if(!code)return front(env,{telegram:'error',reason:'missing-link'});
  const link=await env.DB.prepare('SELECT * FROM link_codes WHERE code=?').bind(code).first();
  if(!link||link.used||Number(link.expires_at)<=Date.now())return front(env,{telegram:'error',reason:'expired-link'});
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
  const token=await exchangeCode(code,env);
  if(!token.refresh_token)return front(env,{telegram:'error',reason:'no-refresh-token'});
  const sheet=await ensureSheet(token.access_token,env);
  await saveGoogleLink(link,token.refresh_token,sheet.id,env);
  await env.DB.batch([
    env.DB.prepare('UPDATE link_codes SET used=1 WHERE code=?').bind(link.code),
    env.DB.prepare('DELETE FROM oauth_states WHERE state=?').bind(state)
  ]);
  return front(env,{telegram:'linked'});
}

function mediaProfile(form,env){
  return {
    currency:String(form.get('currency')||'NIO').toUpperCase(),
    timezone:String(form.get('timezone')||env.DEFAULT_TIMEZONE||'America/Managua')
  };
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
  if(env.TELEGRAM_WEBHOOK_SECRET&&request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)return new Response('Forbidden',{status:403});
  const update=await request.json();
  const id=String(update.update_id??'');
  if(id){
    const seen=await env.DB.prepare('SELECT update_id FROM processed_updates WHERE update_id=?').bind(id).first();
    if(seen)return json({ok:true});
    await env.DB.prepare('INSERT INTO processed_updates(update_id,processed_at) VALUES(?,?)').bind(id,Date.now()).run();
  }
  ctx.waitUntil(handleUpdate(update,env));
  return json({ok:true});
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(env,request)});
      if(url.pathname==='/health')return json({ok:true,service:'mis-gastos-api'},200,env,request);
      if(url.pathname==='/ai/receipt'&&request.method==='POST')return analyzeReceiptRequest(request,env);
      if(url.pathname==='/ai/audio'&&request.method==='POST')return analyzeAudioRequest(request,env);
      if(url.pathname==='/oauth/start'&&request.method==='GET')return oauthStart(url,env);
      if(url.pathname==='/oauth/callback'&&request.method==='GET')return oauthCallback(url,env);
      if(url.pathname==='/telegram/webhook'&&request.method==='POST')return webhook(request,env,ctx);
      if(url.pathname==='/admin/setup-webhook'&&request.method==='POST'){
        if(!env.SETUP_SECRET||request.headers.get('X-Setup-Secret')!==env.SETUP_SECRET)return json({ok:false,error:'Forbidden'},403);
        const result=await setupWebhook(env);return json({ok:true,result});
      }
      return json({ok:false,error:'Not found'},404,env,request);
    }catch(e){console.error(e);return json({ok:false,error:e.message||'Internal error'},500,env,request)}
  }
};
