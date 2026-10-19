import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import worker from '../worker/src/index.js';
import {handleUpdate} from '../worker/src/telegram.js';
import {readExpenses,appendExpenses,ensureSheet} from '../worker/src/google.js';
import {encrypt} from '../worker/src/utils.js';
import {queryKind,monthlySummary} from '../worker/src/summary.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const originalFetch=globalThis.fetch;
const quiet=console.error;console.error=()=>{};
const key=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const env={FRONTEND_URL:'https://antonydis.github.io/mis-gastos/',DEFAULT_TIMEZONE:'America/Toronto',TOKEN_ENCRYPTION_KEY:key};
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
assert.equal(response.status,500);assert.match((await response.json()).error,/OPENAI_API_KEY/);
// Google serial dates remain usable for monthly calculations.
globalThis.fetch=async()=>Response.json({values:[['id',46314,'Café','','Restaurantes',5,'CAD']]});
const read=await readExpenses('sheet','access');assert.equal(read[0].date,'2026-10-19');
let written;
globalThis.fetch=async(url,options)=>{written={url,body:JSON.parse(options.body)};return Response.json({});};
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
const initialization=googleCalls.find(x=>x.url.endsWith('/values:batchUpdate'));
assert.ok(initialization.body.data.some(x=>x.range==="'Registro diario'!A1:C1"));
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
await handleUpdate(update('/start'),env);assert.ok(messages.at(-1).reply_markup.keyboard);assert.match(messages.at(-1).text,/moneda/);
await handleUpdate(update('📊 Este mes'),env);assert.match(messages.at(-1).text,/Gastos de/);
await handleUpdate(update('📄 Mi hoja'),env);assert.match(messages.at(-1).text,/my-sheet/);
await handleUpdate(update('/moneda USD'),env);assert.ok(writes.some(x=>x.sql.includes('UPDATE user_links')&&x.args[0]==='USD'));
await handleUpdate(update('Gasté 5 CAD en café'),{...env,OPENAI_API_KEY:'test'});assert.match(messages.at(-1).text,/Guardado/);assert.match(messages.at(-1).text,/my-sheet/);assert.ok(messages.at(-1).reply_markup.inline_keyboard[0][0].callback_data.startsWith('expense:undo:'));
await handleUpdate(update('/link'),env);assert.match(messages.at(-1).reply_markup.inline_keyboard[0][0].url,/link=/);
await handleUpdate({...update(''),message:{...update('').message,voice:{file_id:'audio'}}},env);
assert.match(messages.at(-1).text,/No pude confirmar/);
console.error=quiet;globalThis.fetch=originalFetch;
console.log('OK: CORS, async failures, timezone, currencies, Google dates, safe writes, Telegram menu/link/media failures.');
