import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { analyzeDocument, analyzeReceipt } from '../worker/src/openai.js';
import { handleUpdate, normalizeTelegramFile, duplicateImportFlags } from '../worker/src/telegram.js';
import { encrypt } from '../worker/src/utils.js';
import { EXPENSE_HEADERS } from '../worker/src/records.js';
if (!globalThis.crypto) globalThis.crypto=webcrypto;

const originalFetch=globalThis.fetch;
const profile={currency:'CAD',timezone:'America/Toronto',language:'es'};
const expense=(overrides={})=>({
  date:'2026-10-19',description:'Café',merchant:'Cafetería',category:'Restaurantes',
  amount:12.5,currency:'CAD',paymentMethod:'Visa ••3090',notes:'',amountCAD:12.5,...overrides
});
const extracted=(expenses=[expense()],overrides={})=>({
  expenses,changedFields:[],question:'',documentType:'statement',
  excludedCount:3,reviewNotes:'Transferencia, abono y saldo excluidos.',
  totalExpenseCount:expenses.length,...overrides
});
let next=extracted(),requests=[];
globalThis.fetch=async(url,options={})=>{
  if(!String(url).includes('api.openai.com'))throw new Error('Unexpected request '+url);
  requests.push(JSON.parse(options.body));
  return Response.json({output_text:JSON.stringify(next)});
};
try {
  // UC01: Real PDF route invokes input_file; no raw banking data is persisted by analyzer.
  const pdf=new File([new TextEncoder().encode('%PDF-1.4 synthetic fixture')],'statement.pdf',{type:'application/pdf'});
  let result=await analyzeDocument(pdf,profile,{OPENAI_API_KEY:'test'},'extracto bancario');
  assert.equal(result.expenses.length,1);
  assert.equal(result.excludedCount,3);
  assert.equal(result.documentType,'statement');
  const pdfInput=requests.at(-1).input[0].content.find(x=>x.type==='input_file');
  assert.ok(pdfInput.file_data.startsWith('data:application/pdf;base64,'));
  assert.match(requests.at(-1).input[0].content[0].text,/EXCLUYE ingresos, reembolsos/);
  // UC02: Image route uses image vision input.
  const png=new File([new Uint8Array([137,80,78,71])],'report.png',{type:'image/png'});
  await analyzeDocument(png,profile,{OPENAI_API_KEY:'test'});
  assert.ok(requests.at(-1).input[0].content.some(x=>x.type==='input_image'));
  // UC03: 25 is accepted; 26 is blocked even if the model returns only 25.
  next=extracted(Array.from({length:25},(_,i)=>expense({description:'Compra '+i,amount:i+1})));
  result=await analyzeDocument(pdf,profile,{OPENAI_API_KEY:'test'});
  assert.equal(result.expenses.length,25);
  next=extracted(Array.from({length:25},(_,i)=>expense({description:'Compra '+i})),{totalExpenseCount:26});
  result=await analyzeDocument(pdf,profile,{OPENAI_API_KEY:'test'});
  assert.equal(result.expenses.length,0);
  assert.match(result.question,/25 gastos/);
  // UC04: Partial reads are rejected instead of silently importing a subset.
  next=extracted([expense()],{totalExpenseCount:3});
  result=await analyzeDocument(pdf,profile,{OPENAI_API_KEY:'test'});
  assert.equal(result.expenses.length,0);
  assert.match(result.question,/No pude leer todos/);
  // UC05: Amount sanitization; zero, negative, invalid do not become expenses.
  next=extracted([expense({amount:-5}),expense({amount:0}),expense({amount:NaN}),expense({amount:5})],{totalExpenseCount:0});
  result=await analyzeDocument(pdf,profile,{OPENAI_API_KEY:'test'});
  assert.equal(result.expenses.length,1);
  assert.equal(result.expenses[0].amount,5);
  // UC06a: Unreadable bank-statement dates must not default to today.\n  next=extracted([expense({date:''})]);\n  result=await analyzeDocument(pdf,profile,{OPENAI_API_KEY:'test'});\n  assert.equal(result.expenses.length,0);\n  assert.match(result.question,/No pude leer todas las fechas/);\n  next=extracted([expense({date:'2026-02-30'})]);\n  result=await analyzeDocument(pdf,profile,{OPENAI_API_KEY:'test'});\n  assert.equal(result.expenses.length,0);\n  // UC06: Missing foreign-currency conversion is never invented.
  next=extracted([expense({amount:20,currency:'USD',amountCAD:null})]);
  result=await analyzeDocument(pdf,profile,{OPENAI_API_KEY:'test'});
  assert.equal(result.expenses[0].amountCAD,null);
  // UC07: Unsupported type / size reject before model call.
  const before=requests.length;
  await assert.rejects(()=>analyzeDocument(new File(['x'],'report.csv',{type:'text/csv'}),profile,{OPENAI_API_KEY:'test'}),/foto o un PDF/);
  await assert.rejects(()=>analyzeDocument(new File([new Uint8Array(8*1024*1024+1)],'large.pdf',{type:'application/pdf'}),profile,{OPENAI_API_KEY:'test'}),/8 MB/);
  assert.equal(requests.length,before);
  // UC08: Missing/generic Telegram MIME must resolve using file extension.
  assert.equal(normalizeTelegramFile(new Blob(['x']),'documents/report.pdf','report.pdf').type,'application/pdf');
  assert.equal(normalizeTelegramFile(new Blob(['x']),'documents/report.png','report.png','application/octet-stream').type,'image/png');
  // UC09: Existing and within-file duplicates are warnings, not silent discards.
  const flagged=duplicateImportFlags([
    expense({date:'2026-10-20',amount:10}),expense({date:'2026-10-20',amount:10}),
    expense({date:'2026-10-20',amount:10,currency:'USD'}),
    expense({date:'2026-10-21',amount:10})
  ],[expense({date:'2026-10-20',amount:10})]);
  assert.deepEqual(flagged.map(x=>x.possibleDuplicate),[true,true,false,false]);
  console.log('PASS: 9 extraction/validation/duplicate use cases');
} finally { globalThis.fetch=originalFetch; }

// UC10–UC15: Simulated Telegram -> OpenAI -> preview -> human confirmation -> Sheet.
// All network requests and D1 are mocked. No personal banking data or live writes.
const key=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const refresh=await encrypt('refresh',key);
const link={google_refresh_token:refresh,sheet_id:'fixture-sheet',currency:'CAD',timezone:'America/Toronto'};
const pending=new Map(),messages=[],appended=[];
let mode='statement',bankResponse=extracted();
const env={TOKEN_ENCRYPTION_KEY:key,OPENAI_API_KEY:'test',PUBLIC_BASE_URL:'https://test.invalid',DEFAULT_TIMEZONE:'America/Toronto'};
env.DB={
  prepare(sql){return {
    bind(...args){return {
      async first(){
        if(sql.includes('SELECT language FROM user_preferences'))return {language:'es'};
        if(sql.includes('SELECT * FROM user_links'))return {...link};
        if(sql.includes('SELECT * FROM pending'))return pending.get(String(args[0]))||null;
        return null;
      },
      async run(){
        if(sql.includes('INSERT INTO pending VALUES')){
          pending.set(String(args[0]),{telegram_user_id:String(args[0]),kind:args[1],payload:args[2],expires_at:args[3]});
          return {meta:{changes:1}};
        }
        if(sql.includes("UPDATE pending SET kind='import-saving'")){
          const row=pending.get(String(args[0]));
          if(!row||row.kind!=='import'||row.payload!==args[1]||row.expires_at<=Date.now())return {meta:{changes:0}};
          row.kind='import-saving';return {meta:{changes:1}};
        }
        if(sql.includes('DELETE FROM pending')){
          pending.delete(String(args[0]));return {meta:{changes:1}};
        }
        return {meta:{changes:1}};
      }
    }}
  }
};
globalThis.fetch=async(url,options={})=>{
  const u=String(url);
  if(u.includes('/getFile'))return Response.json({ok:true,result:{file_path:mode==='image'?'documents/report.png':'documents/statement.pdf'}});
  if(u.includes('api.telegram.org/file/'))return new Response(mode==='image'?'PNG fixture':'%PDF synthetic fixture');
  if(u.includes('api.telegram.org/bot')){messages.push(JSON.parse(options.body));return Response.json({ok:true,result:{}});}
  if(u.includes('api.openai.com/v1/responses'))return Response.json({output_text:JSON.stringify(bankResponse)});
  if(u.includes('oauth2.googleapis.com'))return Response.json({access_token:'token'});
  if(u.includes('sheets.googleapis.com')){
    if(u.includes(':append?')){appended.push(JSON.parse(options.body));return Response.json({});}
    if(u.includes('A1%3AQ1'))return Response.json({values:[EXPENSE_HEADERS]});
    if(u.includes('A2%3AQ'))return Response.json({values:[]});
    return Response.json({properties:{locale:'es'},sheets:[
      {properties:{title:'Movimientos',sheetId:1,gridProperties:{rowCount:1000}}},
      {properties:{title:'Resumen',sheetId:1800002026,gridProperties:{rowCount:1100}}}
    ],developerMetadata:[{metadataKey:'mis_gastos_summary',location:{sheetId:1800002026}}]});
  }
  throw new Error('Unexpected request '+u);
};
const documentMessage=()=>({message:{from:{id:1},chat:{id:1,type:'private'},document:{
  file_id:'document',file_name:mode==='image'?'report.png':'statement.pdf',
  mime_type:mode==='image'?'application/octet-stream':'application/pdf',file_size:1024
}}});
const callback=(data)=>({callback_query:{id:'callback',data,from:{id:1},message:{chat:{id:1,type:'private'}}}});
try {
  // UC10: Even one expense in a PDF has to be reviewed. No writing before confirmation.
  bankResponse=extracted([expense()],{documentType:'expense',excludedCount:0});
  await handleUpdate(documentMessage(),env);
  assert.equal(appended.length,0);
  assert.equal(pending.get('1')?.kind,'import');
  assert.match(messages.at(-1).text,/Revisa antes de guardar/);
  // UC11: Cancel, then trying to confirm old nonce must not write.
  const oldNonce=JSON.parse(pending.get('1').payload).nonce;
  await handleUpdate(callback('import:cancel:'+oldNonce),env);
  assert.equal(appended.length,0);
  await handleUpdate(callback('import:save:'+oldNonce),env);
  assert.equal(appended.length,0);
  // UC12: New PDF, save exactly once, replay confirm rejected.
  await handleUpdate(documentMessage(),env);
  const nonce=JSON.parse(pending.get('1').payload).nonce;
  await handleUpdate(callback('import:save:'+nonce),env);
  assert.equal(appended.length,1);
  await handleUpdate(callback('import:save:'+nonce),env);
  assert.equal(appended.length,1);
  // UC13: An image delivered as document with generic MIME is reviewed.
  mode='image';
  await handleUpdate(documentMessage(),env);
  assert.equal(pending.get('1')?.kind,'import');
  assert.equal(appended.length,1);
  // Clear the pending image review before checking independent invalid-document cases.
  const imageNonce=JSON.parse(pending.get('1').payload).nonce;
  await handleUpdate(callback('import:cancel:'+imageNonce),env);
  // UC14: Oversized document blocked before download/analyze/save.
  const huge=documentMessage();huge.message.document.file_size=8*1024*1024+1;
  const prior=messages.length;
  await handleUpdate(huge,env);
  assert.match(messages.at(-1).text,/muy grande/);
  assert.equal(appended.length,1);
  assert.ok(messages.length>prior);
  // UC15: Unsupported document rejected without sheet write.
  const unsupported=documentMessage();unsupported.message.document.mime_type='text/csv';unsupported.message.document.file_name='report.csv';
  await handleUpdate(unsupported,env);
  assert.match(messages.at(-1).text,/fotos y PDFs/);
  assert.equal(appended.length,1);
  console.log('PASS: 6 Telegram integration cases (mocked network and D1)');
} finally {globalThis.fetch=originalFetch;}
