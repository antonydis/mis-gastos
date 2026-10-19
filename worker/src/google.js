import {EXPENSE_HEADERS,expenseToRow,rowToExpense} from './records.js';
import {CATEGORIES,uid} from './utils.js';

const SCOPE='https://www.googleapis.com/auth/drive.file';

export function googleAuthUrl(env,state){const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.searchParams.set('client_id',env.GOOGLE_CLIENT_ID);u.searchParams.set('redirect_uri',env.PUBLIC_BASE_URL.replace(/\/$/,'')+'/oauth/callback');u.searchParams.set('response_type','code');u.searchParams.set('scope',SCOPE);u.searchParams.set('access_type','offline');u.searchParams.set('prompt','consent');u.searchParams.set('include_granted_scopes','true');u.searchParams.set('state',state);return u.toString()}
export async function exchangeCode(code,env){return token({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:env.PUBLIC_BASE_URL.replace(/\/$/,'')+'/oauth/callback',grant_type:'authorization_code'})}
export async function refreshAccess(refresh,env){const x=await token({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'});return x.access_token}
async function token(values){const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});const d=await r.json();if(!r.ok){const error=new Error(d.error_description||'Google OAuth failed');error.oauthCode=d.error;throw error;}return d}
async function g(url,access,options={}){const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok){const error=new Error(d.error?.message||'Google API failed');error.googleService=new URL(url).hostname.includes('sheets')?'sheets':'drive';error.googleReason=d.error?.details?.find(x=>x.reason)?.reason||d.error?.errors?.[0]?.reason;error.httpStatus=r.status;throw error;}return d}
export async function ensureSheet(access,env){const q="appProperties has { key='mis_gastos' and value='v1' } and trashed=false";const f=await g('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(q)+'&spaces=drive&fields=files(id,name,webViewLink)&pageSize=10',access);if(f.files?.[0])return f.files[0];const tz=env.DEFAULT_TIMEZONE||'America/Toronto';const c=await g('https://sheets.googleapis.com/v4/spreadsheets',access,{method:'POST',body:JSON.stringify({properties:{title:'Mis gastos',locale:'es',timeZone:tz},sheets:[{properties:{title:'Movimientos'}},{properties:{title:'Registro diario'}},{properties:{title:'Categorías'}},{properties:{title:'Resúmenes'}},{properties:{title:'Configuración'}}]})});const id=c.spreadsheetId;await g('https://sheets.googleapis.com/v4/spreadsheets/'+id+'/values:batchUpdate',access,{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data:[{range:'Movimientos!A1:J1',values:[['ID','Fecha','Descripción','Comercio','Categoría','Monto','Moneda','Método','Fuente','Registrado']]},{range:"'Registro diario'!A1:C1",values:[['Fecha','Estado','Registrado']]},{range:"'Categorías'!A1:C"+(CATEGORIES.length+1),values:[['Categoría','Activa','Palabras clave'],...CATEGORIES.map(x=>[x,true,''])]},{range:"'Resúmenes'!A1:J1",values:[['Periodo','Desde','Hasta','Total','Moneda','Mayor categoría','% mayor categoría','Variación %','Resumen','Generado']]},{range:"'Configuración'!A1:B4",values:[['Ajuste','Valor'],['Moneda principal','CAD'],['Zona horaria',tz],['Versión','telegram-v1']]}]})});await g('https://www.googleapis.com/drive/v3/files/'+id+'?fields=id,name,webViewLink',access,{method:'PATCH',body:JSON.stringify({appProperties:{mis_gastos:'v1'}})});return{id,name:'Mis gastos',webViewLink:'https://docs.google.com/spreadsheets/d/'+id+'/edit'}}
export async function appendExpenses(sheetId,items,access){
  const ids=items.map(()=>uid());
  await ensureExpenseColumns(sheetId,access);
  const rows=items.map((x,i)=>expenseToRow({...x,id:ids[i]}));
  const range=encodeURIComponent('Movimientos!A:Q');
  await g('https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values/'+range+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',access,{method:'POST',body:JSON.stringify({values:rows})});
  return ids;
}

export async function deleteExpensesByIds(sheetId,ids,access){
  const wanted=new Set((ids||[]).map(String));
  if(!wanted.size)return 0;
  const data=await g('https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values/'+encodeURIComponent('Movimientos!A2:A'),access);
  const ranges=[];
  (data.values||[]).forEach((row,index)=>{
    if(wanted.has(String(row[0]||'')))ranges.push('Movimientos!A'+(index+2)+':Q'+(index+2));
  });
  if(!ranges.length)return 0;
  await g('https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values:batchClear',access,{method:'POST',body:JSON.stringify({ranges})});
  return ranges.length;
}


export async function ensureExpenseColumns(sheetId,access){
  const url='https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values/';
  const existing=await g(url+encodeURIComponent('Movimientos!A1:Q1'),access);
  const header=existing.values?.[0]||[];
  if(header.length===EXPENSE_HEADERS.length&&header.every((v,i)=>v===EXPENSE_HEADERS[i]))return;
  // First ten columns keep their positions. Never move existing financial data.
  if(header.slice(10).some((v,i)=>v&&v!==EXPENSE_HEADERS[i+10]))throw new Error('Las columnas adicionales no coinciden con Mis gastos. No se modificó la hoja.');
  await g(url+encodeURIComponent('Movimientos!A1:Q1')+'?valueInputOption=RAW',access,{method:'PUT',body:JSON.stringify({values:[EXPENSE_HEADERS]})});
}

export async function readExpenses(sheetId,access){
  await ensureExpenseColumns(sheetId,access);
  const data=await g('https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values/'+encodeURIComponent('Movimientos!A2:Q')+'?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER',access);
  return (data.values||[]).filter(r=>r[0]).map(rowToExpense);
}

export async function completeExpenses(sheetId,ids,details,access){
  const current=await readExpenses(sheetId,access);
  const selected=ids.map(id=>current.find(x=>x.id===id));
  if(selected.some(x=>!x)||details.length!==ids.length)throw new Error('No encontré los gastos que quieres completar.');
  const updated=selected.map((x,i)=>({...x,...Object.fromEntries(['paymentMethod','frequency','expenseType','notes','project','amountCAD'].map(key=>[key,details[i][key]||x[key]]))}));
  // Find physical row numbers; blank rows left by Deshacer must not shift IDs.
  const raw=await g('https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values/'+encodeURIComponent('Movimientos!A2:A'),access);
  const data=[];
  updated.forEach(x=>{
    const index=(raw.values||[]).findIndex(r=>String(r[0])===x.id);
    if(index<0)throw new Error('El gasto ya no existe.');
    const n=index+2,row=expenseToRow(x);
    data.push({range:'Movimientos!H'+n,values:[[row[7]]]},{range:'Movimientos!K'+n+':Q'+n,values:[row.slice(10)]});
  });
  await g('https://sheets.googleapis.com/v4/spreadsheets/'+sheetId+'/values:batchUpdate',access,{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data})});
  return updated;
}
