import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {handleUpdate,savedMessage} from '../worker/src/telegram.js';
import {EXPENSE_HEADERS,expenseToRow,missingDetails} from '../worker/src/records.js';
import {encrypt} from '../worker/src/utils.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const originalFetch=globalThis.fetch;
const key=btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const link={sheet_id:'sheet',google_refresh_token:await encrypt('refresh',key),currency:'CAD',timezone:'America/Toronto'};
const rows=[['old-id','2026-10-01','Anterior','','Casa',20,'CAD','','Texto','timestamp']];
const originalRow=[...rows[0]];
let headers=['ID','Fecha','Descripción','Comercio','Categoría','Monto original','Moneda','Método de pago','Fuente','Registrado'],pending=null,appends=0,language=null;
const messages=[];
const env={OPENAI_API_KEY:'test',TOKEN_ENCRYPTION_KEY:key,DB:{prepare(sql){return{bind(...args){return{
 first:async()=>sql.includes('user_preferences')?(language?{language}:null):sql.includes('user_links')?{...link}:pending?{...pending}:null,
 run:async()=>{
  if(sql.startsWith('INSERT OR IGNORE INTO user_preferences'))language ||= args[1];
  if(sql.startsWith('UPDATE user_preferences'))language=args[0];
  if(sql.startsWith('UPDATE user_links SET currency=?,timezone=?')){link.currency=args[0];link.timezone=args[1];}
  if(sql.startsWith("UPDATE pending SET kind='edit-saving'")){if(pending?.kind!=='edit'||pending.payload!==args[1]||pending.expires_at<=args[2])return{meta:{changes:0}};pending.kind='edit-saving';return{meta:{changes:1}};}
  if(sql.startsWith("UPDATE pending SET kind='import-saving'")){if(pending?.kind!=='import'||pending.payload!==args[1])return{meta:{changes:0}};pending.kind='import-saving';return{meta:{changes:1}};}
  if(sql.startsWith('INSERT INTO pending'))pending={kind:args[1],payload:args[2],expires_at:args[3]};
  if(sql.startsWith('DELETE FROM pending')){
   if(!sql.includes("kind='complete'")||pending?.kind==='complete')pending=null;
  }
  return{};
 }
};}};}}};
const analyzed={date:'2026-10-19',description:'Gasolina',merchant:'Shell',category:'Gasolina',amount:33,currency:'CAD',paymentMethod:'',frequency:'Único',expenseType:'Variable',notes:'Vehículo familiar',project:'',amountCAD:33};
globalThis.fetch=async(url,options={})=>{
 const body=typeof options.body==='string'?JSON.parse(options.body):null;
 if(url.endsWith('/audio/transcriptions'))return Response.json({text:'eran 17, no 15'});
 if(url.endsWith('/getFile'))return Response.json({ok:true,result:{file_path:'documents/statement.pdf'}});
 if(url.includes('/file/bot'))return new Response('fixture pdf bytes',{headers:{'Content-Type':'application/octet-stream'}});
 if(url.includes('api.telegram.org')){if(url.endsWith('/sendMessage'))messages.push(body);return Response.json({ok:true,result:{}});}
 if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'access'});
 if(url.includes('api.openai.com')){
  const input=body.input[0].content.map(x=>x.text||'').join(' ');
  if(input.includes('Gasto actual: ')){
   const original=JSON.parse(input.match(/Gasto actual: (.*)\nCambio solicitado:/)[1]);
   const request=input.split('Cambio solicitado:')[1];
   const corrected={...original,...(/eran (\d+)/.test(request)?{amount:Number(request.match(/eran (\d+)/)[1])}:{}),...(/tarjeta RBC/.test(request)?{paymentMethod:'RBC crédito'}:{})};
   return Response.json({output_text:JSON.stringify({expenses:[{...corrected,category:'Otros'}],changedFields:[...(/eran (\d+)/.test(request)?['amount']:[]),...(/tarjeta RBC/.test(request)?['paymentMethod']:[])],question:''})});
  }
  if(input.includes('sin monto'))return Response.json({output_text:JSON.stringify({expenses:[],question:'¿Cuánto gastaste?',documentType:'expense',totalExpenseCount:1,excludedCount:0,reviewNotes:''})});
  if(input.includes('dos gastos')||body.input[0].content.some(x=>x.type==='input_file'))return Response.json({output_text:JSON.stringify({expenses:[{...analyzed,amount:12,description:'Café'},{...analyzed,amount:18,description:'Comida'}],question:'',documentType:'statement',excludedCount:2,reviewNotes:'Transferencias y pagos de tarjeta',totalExpenseCount:2})});
  const result={...analyzed,paymentMethod:input.includes('Información adicional del usuario')?'Banco Ejemplo Mastercard débito':''};
  return Response.json({output_text:JSON.stringify({expenses:[result],question:''})});
 }
 if(url.includes('sheets.googleapis.com')){
  const decoded=decodeURIComponent(url);
  if(decoded.includes('?fields='))return Response.json({sheets:[]});
  if(decoded.includes('Movimientos!A1:Q1')){
   if(options.method==='PUT')headers=body.values[0];
   return Response.json({values:[headers]});
  }
  if(decoded.includes('Movimientos!A:Q:append')){rows.push(...body.values);appends++;return Response.json({});}
  if(decoded.includes('Movimientos!A2:Q'))return Response.json({values:rows});
  if(decoded.includes('Movimientos!A2:A'))return Response.json({values:rows.map(r=>[r[0]])});
  if(decoded.endsWith('/values:batchUpdate')){
   for(const entry of body.data){
    const match=entry.range.match(/!([BHKMO])(\d+)/);assert.ok(match);
    const row=rows[Number(match[2])-2],start={B:1,H:7,K:10,M:12,O:14}[match[1]];
    entry.values[0].forEach((v,i)=>row[start+i]=v);
   }
   return Response.json({});
  }
 }
 throw Error('Unexpected request '+url);
};
const text=value=>({message:{from:{id:1},chat:{id:1,type:'private'},text:value}});
const callback=data=>({callback_query:{id:'cb',from:{id:1},message:{chat:{id:1,type:'private'}},data}});
try{
 await handleUpdate(text('Gasté 33 CAD en gasolina'),env);
 assert.equal(appends,1);assert.equal(headers.length,17);assert.deepEqual(rows[0],originalRow);
 assert.equal(rows[1][15],'Completo');assert.equal(rows[1][16],'');assert.equal(rows[1][14],33);
 assert.match(messages.at(-1).text,/2026-10-19/);assert.equal(rows[1][12],'Vehículo familiar');
 assert.ok(messages.at(-1).reply_markup.inline_keyboard[1].some(x=>x.text==='Corregir'));assert.ok(!messages.at(-1).text.includes('Falta:'));
 await handleUpdate(text('📥 Varios gastos'),env);assert.match(messages.at(-1).text,/Hasta 25 gastos/);
 const id=rows[1][0];
 await handleUpdate(callback('expense:details:'+id),env);assert.match(messages.at(-1).text,/Vehículo familiar/);assert.equal(appends,1,'Reading details must not append rows');
 await handleUpdate(text('eran 15, no 33'),env);
 assert.equal(appends,1,'A natural correction must not append rows');assert.equal(rows[1][5],15);assert.equal(rows[1][0],id);assert.equal(rows[1][14],15);assert.match(messages.at(-1).text,/Corregido/);assert.equal(rows[1][4],'Gasolina','Untargeted fields must be preserved even if the model changes them');
 await handleUpdate(text('fue con mi tarjeta RBC'),env);
 assert.equal(appends,1);assert.equal(rows[1][7],'RBC crédito');assert.equal(rows[1][5],15);assert.deepEqual(rows[0],originalRow);
 await handleUpdate(callback('expense:edit:'+id),env);assert.equal(pending.kind,'edit');
 await handleUpdate(text('/cancelar'),env);assert.equal(rows[1][5],15);
 await handleUpdate(callback('expense:edit:'+id),env);
 await handleUpdate({message:{from:{id:1},chat:{id:1,type:'private'},voice:{file_id:'voice',mime_type:'audio/ogg'}}},env);
 assert.equal(rows[1][5],17);assert.equal(appends,1,'Voice correction must not append a new expense');
 await handleUpdate(text('Compré café sin monto'),env);assert.equal(appends,1);assert.match(messages.at(-1).text,/Cuánto/);
 const foreign=expenseToRow({...analyzed,currency:'GTQ',amount:100,amountCAD:null});assert.equal(foreign[14],'');
 assert.equal(missingDetails(analyzed).length,0);
 assert.match(savedMessage([{...analyzed,currency:'GTQ',amountCAD:null}]),/no se estimó una tasa/);
 await handleUpdate(text('/cancelar'),env);
 const beforeImport=appends;
 await handleUpdate(text('dos gastos'),env);
 assert.equal(appends,beforeImport,'No writes before batch confirmation');
 assert.equal(pending.kind,'import');assert.match(messages.at(-1).text,/2 gastos detectados/);assert.match(messages.at(-1).text,/Omitidos: 2/);
 const saveAction=messages.at(-1).reply_markup.inline_keyboard[0][0].callback_data;
 await handleUpdate(callback(saveAction),env);assert.equal(appends,beforeImport+1);assert.equal(rows.length,4);
 await handleUpdate(callback(saveAction),env);assert.equal(appends,beforeImport+1,'Repeated confirmation cannot append again');
 await handleUpdate(text('eran 15, no 12'),env);assert.equal(pending.kind,'edit-select');assert.equal(appends,beforeImport+1);
 await handleUpdate(callback('expense:edit:'+rows[2][0]),env);assert.equal(rows[2][5],15);assert.equal(rows[3][5],18);assert.equal(appends,beforeImport+1);
 await handleUpdate({message:{from:{id:1},chat:{id:1,type:'private'},document:{file_id:'pdf',mime_type:'application/pdf',file_name:'statement.pdf',file_size:4000}}},env);
 assert.equal(pending.kind,'import');assert.equal(appends,beforeImport+1);
 const cancelAction=messages.at(-1).reply_markup.inline_keyboard[0][1].callback_data;
 await handleUpdate(callback(cancelAction),env);assert.equal(appends,beforeImport+1);assert.match(messages.at(-1).text,/Cancelado/);
 await handleUpdate(callback('language:en'),env);assert.equal(language,'en');assert.match(messages.at(-1).text,/English it is/);
 await handleUpdate(text('🧾 Add an expense'),env);assert.match(messages.at(-1).text,/Send an expense/);assert.ok(messages.at(-1).reply_markup.keyboard[0].some(x=>x.text==='🧾 Add an expense'));
 await handleUpdate(text('How much have I spent this month?'),env);assert.match(messages.at(-1).text,/Expenses for/);
 await handleUpdate(text('📥 Multiple expenses'),env);assert.match(messages.at(-1).text,/Up to 25 expenses/);
 await handleUpdate(text('📝 Add details'),env);assert.match(messages.at(-1).text,/Which expense would you like to correct/);
 const removedId=rows[1][0];rows.splice(1,1);
 await handleUpdate(callback('expense:details:'+removedId),env);assert.match(messages.at(-1).text,/no longer in your sheet/);
 assert.equal(link.currency,'CAD');assert.equal(link.timezone,'America/Toronto');
 console.log('OK: minimal capture, correction without duplicate rows, original rows preserved, batch review, language and current Sheet details.');
}finally{globalThis.fetch=originalFetch;}
