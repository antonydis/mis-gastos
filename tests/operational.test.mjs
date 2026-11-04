import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker from '../worker/src/index.js';
import {handleUpdate,normalizeTelegramFile} from '../worker/src/telegram.js';
import {readExpenses,appendExpenses,ensureSheet} from '../worker/src/google.js';
import {encrypt} from '../worker/src/utils.js';
import {queryKind,monthlySummary} from '../worker/src/summary.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const originalFetch=globalThis.fetch;
const quiet=console.error;console.error=()=>{};
const key=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const env={PUBLIC_BASE_URL:'https://api.test',FRONTEND_URL:'https://antonydis.github.io/mis-gastos/',DEFAULT_TIMEZONE:'America/Toronto',TOKEN_ENCRYPTION_KEY:key,PUBLIC_RATE_LIMIT:{limit:async()=>({success:true})}};
const date=new Date('2026-11-01T02:00:00Z'); // still October in Toronto
const rows=[{date:'2026-10-12',amount:10,currency:'CAD',category:'Casa'},{date:'2026-10-13',amount:20,currency:'CAD',category:'Comida'},{date:'2026-10-14',amount:7,currency:'USD',category:'Viajes'},{date:'2026-09-01',amount:999,currency:'CAD',category:'Casa'}];
const summary=monthlySummary(rows,'America/Toronto','categories',date);
assert.match(summary,/2026-10/);assert.ok(!summary.includes('999'));assert.match(summary,/30/);assert.match(summary,/USD|US\$/);assert.match(summary,/Comida/);
assert.equal(queryKind('¿Cuánto he gastado este mes?'),'month');
assert.equal(queryKind('¿En qué categoría gasté más?'),'categories');
assert.equal(queryKind('Gasté 20 en la categoría casa'),'');
const preflight=await worker.fetch(new Request('https://api.test/ai/text',{method:'OPTIONS',headers:{Origin:'https://antonydis.github.io'}}),env,{});
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://antonydis.github.io');
// Asynchronous errors must be converted to an HTTP response.
const response=await worker.fetch(new Request('https://api.test/ai/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'café 5'})}),env,{});
assert.equal(response.status,500);assert.equal((await response.json()).error,'Internal error');
const textRequest=body=>new Request('https://api.test/ai/text',{method:'POST',body});
const limited=await worker.fetch(textRequest('{}'),{...env,PUBLIC_RATE_LIMIT:{limit:async()=>({success:false})}});
assert.equal(limited.status,429);
assert.equal((await worker.fetch(textRequest('x'.repeat(16385)),env)).status,413);
assert.equal((await worker.fetch(textRequest('{"text":123}'),env)).status,400);
// Google serial dates remain usable for monthly calculations.
globalThis.fetch=async()=>Response.json({values:[['id',46314,'Café','','Restaurantes',5,'CAD']]});
const read=await readExpenses('sheet','access');assert.equal(read[0].date,'2026-10-19');
let written;
globalThis.fetch=async(url,options={})=>{if(url.includes(':append?'))written={url,body:options.body?JSON.parse(options.body):null};return Response.json({});};
await appendExpenses('sheet',[{date:'2026-10-19',description:'=IMPORTXML("x")',amount:5,currency:'CAD'}],'access');
assert.match(written.url,/valueInputOption=RAW/);assert.equal(written.body.values[0][2],'=IMPORTXML("x")');
// Sheet creation sends valid quoted A1 ranges before marking the file.
const googleCalls=[];
globalThis.fetch=async(url,options={})=>{
 googleCalls.push({url,body:options.body?JSON.parse(options.body):null});
 if(url.includes('/drive/v3/files?'))return Response.json({files:[]});
 if(url==='https://sheets.googleapis.com/v4/spreadsheets')return Response.json({spreadsheetId:'new-sheet'});
 return Response.json({});
};
assert.equal((await ensureSheet('token',env)).id,'new-sheet');
const creation=googleCalls.find(x=>x.url==='https://sheets.googleapis.com/v4/spreadsheets');
assert.deepEqual(creation.body.sheets.map(x=>x.properties.title),['Movimientos']);
assert.ok(googleCalls.some(x=>x.url.includes('A1%3AQ1')&&x.body.values[0][5]==='Monto'));
// Linked user: menu, real-sheet queries, reconnect, and async media errors.
const link={google_refresh_token:await encrypt('refresh',key),sheet_id:'my-sheet',currency:'CAD',timezone:'America/Toronto'};
const messages=[];const writes=[];
env.DB={prepare(sql){return{bind(...args){return{first:async()=>sql.includes('user_links')?{...link}:null,run:async()=>{writes.push({sql,args});return{};}};}};}};
globalThis.fetch=async(url,options)=>{
 if(url.includes('api.telegram.org')){const body=JSON.parse(options.body);messages.push(body);return Response.json({ok:true,result:{}});}
 if(url.includes('api.openai.com'))return Response.json({output_text:JSON.stringify({expenses:[{date:'2026-10-19',description:'Café',category:'Restaurantes',amount:5,currency:'CAD',paymentMethod:''}],question:''})});
 if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
 if(url.includes('sheets.googleapis.com'))return Response.json({values:[['x',new Date().toISOString().slice(0,10),'Café','','Restaurantes',5,'CAD']]});
 throw Error('Unexpected request '+url);
};
const update=text=>({message:{from:{id:1},chat:{id:1,type:'private'},text}});
await handleUpdate(update('/start'),env);assert.ok(messages.at(-1).reply_markup.keyboard);assert.match(messages.at(-1).text,/gastaste/);
await handleUpdate(update('📊 Este mes'),env);assert.match(messages.at(-1).text,/Gastos de/);
await handleUpdate(update('📄 Mi hoja'),env);assert.match(messages.at(-1).text,/my-sheet/);
await handleUpdate(update('/moneda USD'),env);assert.ok(writes.some(x=>x.sql.includes('UPDATE user_links')&&x.args[0]==='USD'));
await handleUpdate(update('Gasté 5 CAD en café'),{...env,OPENAI_API_KEY:'test'});assert.match(messages.at(-1).text,/Guardado/);assert.match(messages.at(-1).reply_markup.inline_keyboard[0][0].url,/my-sheet/);assert.ok(messages.at(-1).reply_markup.inline_keyboard.flat().some(x=>x.callback_data?.startsWith('expense:undo:')));
await handleUpdate(update('/link'),env);assert.match(messages.at(-1).reply_markup.inline_keyboard[0][0].url,/link=/);
await handleUpdate({...update(''),message:{...update('').message,voice:{file_id:'audio'}}},env);
assert.match(messages.at(-1).text,/No pude abrir el archivo/);
const directPage=await worker.fetch(new Request('https://api.test/connection/result?telegram=error&reason=google-encryption'),env,{});
assert.equal(directPage.headers.get('Cache-Control'),'no-store');
assert.match(await directPage.text(),/Código: <strong>google-encryption/);
const configCheck=await worker.fetch(new Request('https://api.test/connection/check'),env,{});
assert.equal((await configCheck.json()).reason,'missing-google-secret');
// Telegram downloads can lose MIME types and use .oga for Ogg voice notes.
const normalizedPhoto=normalizeTelegramFile(new Blob(['photo'],{type:'application/octet-stream'}),'photos/file.jpg','recibo.jpg');
assert.equal(normalizedPhoto.type,'image/jpeg');
const normalizedVoice=normalizeTelegramFile(new Blob(['OggS'],{type:'application/octet-stream'}),'voice/file.oga','gasto.ogg','audio/ogg');
assert.equal(normalizedVoice.type,'audio/ogg');assert.equal(normalizedVoice.name,'file.ogg');
let imageSeen=false,audioSeen=false;
globalThis.fetch=async(url,options={})=>{
 if(url.includes('/getFile')){const body=JSON.parse(options.body);return Response.json({ok:true,result:{file_path:body.file_id==='photo'?'photos/file.jpg':'voice/file.oga'}});}
 if(url.includes('/file/bot'))return new Response('test media bytes',{headers:{'Content-Type':'application/octet-stream'}});
 if(url.includes('api.telegram.org')){messages.push(JSON.parse(options.body));return Response.json({ok:true,result:{}});}
 if(url.includes('/audio/transcriptions')){
  const file=options.body.get('file');assert.equal(file.name,'file.ogg');assert.equal(file.type,'audio/ogg');audioSeen=true;
  return Response.json({text:'Gasté 5 CAD en café'});
 }
 if(url.includes('/responses')){
  const body=JSON.parse(options.body);const image=body.input[0].content.find(x=>x.type==='input_image');
  if(image){assert.ok(image.image_url.startsWith('data:image/jpeg;base64,'));imageSeen=true;}
  return Response.json({output_text:JSON.stringify({expenses:[{date:'2026-10-19',description:'Café',amount:5,currency:'CAD',category:'Restaurantes'}],question:''})});
 }
 if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
 if(url.includes('sheets.googleapis.com'))return Response.json({});
 throw Error('Unexpected request');
};
await handleUpdate({message:{from:{id:1},chat:{id:1,type:'private'},photo:[{file_id:'photo'}]}},{...env,OPENAI_API_KEY:'test'});
assert.ok(imageSeen);assert.match(messages.at(-1).text,/Guardado/);
await handleUpdate({message:{from:{id:1},chat:{id:1,type:'private'},voice:{file_id:'voice',mime_type:'audio/ogg'}}},{...env,OPENAI_API_KEY:'test'});
assert.ok(audioSeen);assert.match(messages.at(-1).text,/Guardado/);
// OAuth failures produce specific, safe diagnostics instead of one generic screen.
const oauthEnv={...env,GOOGLE_CLIENT_SECRET:'test-secret',PUBLIC_BASE_URL:'https://api.test',DB:{
  prepare(sql){return{bind(){return{first:async()=>sql.includes('oauth_states')?{link_code:'test-link',expires_at:Date.now()+60000}:{code:'test-link',expires_at:Date.now()+60000,used:0},run:async()=>({meta:{changes:1}})};}};},
  batch:async()=>[]
}};
const callback=()=>new Request('https://api.test/oauth/callback?state=test-state&code=test-code',{headers:{Cookie:'__Host-mg-oauth=test-state'}});
let result=await worker.fetch(callback(),{...oauthEnv,GOOGLE_CLIENT_SECRET:''},{});
assert.equal(new URL(result.headers.get('Location')).searchParams.get('reason'),'missing-google-secret');
result=await worker.fetch(callback(),{...oauthEnv,TOKEN_ENCRYPTION_KEY:'invalid'},{});
assert.equal(new URL(result.headers.get('Location')).searchParams.get('reason'),'google-encryption');
globalThis.fetch=async()=>Response.json({error:'invalid_client',error_description:'private details'},{status:401});
result=await worker.fetch(callback(),oauthEnv,{});
assert.equal(new URL(result.headers.get('Location')).searchParams.get('reason'),'oauth-client');
assert.ok(!result.headers.get('Location').includes('private details'));
for(const service of ['drive','sheets']){
 globalThis.fetch=async url=>{
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-access',refresh_token:'test-refresh'});
  if(service==='sheets'&&url.includes('drive'))return Response.json({files:[]});
  return Response.json({error:{message:'private Google error',details:[{reason:'SERVICE_DISABLED'}]}},{status:403});
 };
 result=await worker.fetch(callback(),oauthEnv,{});
 assert.equal(new URL(result.headers.get('Location')).searchParams.get('reason'),service+'-api-disabled');
}
const noCookie=await worker.fetch(new Request('https://api.test/oauth/callback?state=test-state&code=test-code'),oauthEnv);
assert.equal(new URL(noCookie.headers.get('Location')).searchParams.get('reason'),'expired-state');
let claims=0;
let webhookDeliveries=0;
const webhookEnv={...env,TELEGRAM_WEBHOOK_SECRET:'test',DB:{prepare(sql){
 return {bind(){return {
  run:async()=>{assert.match(sql,/INSERT OR IGNORE INTO processed_updates/);return {meta:{changes:claims++===0?1:0}};},
  first:async()=>null
 };}};
}}};
globalThis.fetch=async url=>{
 assert.match(url,/api.telegram.org/);
 webhookDeliveries++;
 return Response.json({ok:true,result:{}});
};
const webhookRequest=()=>new Request('https://api.test/telegram/webhook',{
 method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test'},
 body:JSON.stringify({update_id:42,...update('/idioma')})
});
const deliveries=await Promise.all([worker.fetch(webhookRequest(),webhookEnv),worker.fetch(webhookRequest(),webhookEnv)]);
assert.ok(deliveries.every(response=>response.ok));
assert.equal(webhookDeliveries,1);
await handleUpdate({callback_query:{from:{id:1},message:{chat:{id:2,type:'private'}},data:'language:es'}},webhookEnv);
assert.equal(webhookDeliveries,1,'A callback from a different private chat is ignored');
console.error=quiet;globalThis.fetch=originalFetch;
console.log('OK: CORS, async failures, timezone, currencies, Google dates, safe writes, Telegram menu/link/media failures.');
