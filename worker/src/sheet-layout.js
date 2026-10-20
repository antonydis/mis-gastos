import {CATEGORIES} from './utils.js';

// Preserve legacy data in place. Only eight everyday fields are visible.
export async function simplifySheet(sheetId,request){
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+sheetId;
  const info=await request(base+'?fields=sheets(properties)');
  const sheets=info.sheets||[],main=sheets.find(x=>x.properties.title==='Movimientos');
  if(!main)return;
  const id=main.properties.sheetId;
  const requests=[{updateSheetProperties:{properties:{sheetId:id,gridProperties:{frozenRowCount:1}},fields:'gridProperties.frozenRowCount'}}];
  for(const [start,end] of [[0,1],[8,12],[13,17]])requests.push({updateDimensionProperties:{range:{sheetId:id,dimension:'COLUMNS',startIndex:start,endIndex:end},properties:{hiddenByUser:true},fields:'hiddenByUser'}});
  for(const [start,end,width] of [[1,2,110],[2,4,220],[4,5,150],[5,7,100],[7,8,190],[12,13,280]])requests.push({updateDimensionProperties:{range:{sheetId:id,dimension:'COLUMNS',startIndex:start,endIndex:end},properties:{hiddenByUser:false,pixelSize:width},fields:'hiddenByUser,pixelSize'}});
  requests.push({setBasicFilter:{filter:{range:{sheetId:id,startRowIndex:0,startColumnIndex:0,endColumnIndex:17}}}});
  requests.push({repeatCell:{range:{sheetId:id,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:17},cell:{userEnteredFormat:{backgroundColor:{red:0.15,green:0.39,blue:0.33},textFormat:{bold:true,foregroundColor:{red:1,green:1,blue:1}},wrapStrategy:'WRAP'}},fields:'userEnteredFormat'}});
  for(const tab of sheets){
    const title=tab.properties.title;
    if(!['Registro diario','Resúmenes','Categorías','Configuración'].includes(title))continue;
    const data=await request(base+'/values/'+encodeURIComponent("'"+title+"'")+'?valueRenderOption=FORMULA');
    const rows=data.values||[];
    const headers=title==='Registro diario'?['Fecha','Estado','Registrado']:title==='Resúmenes'?['Periodo','Desde','Hasta','Total','Moneda','Mayor categoría','% mayor categoría','Variación %','Resumen','Generado']:null;
    if(headers&&(!rows.length||(rows.length===1&&JSON.stringify(rows[0])===JSON.stringify(headers))))requests.push({deleteSheet:{sheetId:tab.properties.sheetId}});
    else if(title==='Categorías'&&rows.length===CATEGORIES.length+1&&JSON.stringify(rows[0])===JSON.stringify(['Categoría','Activa','Palabras clave'])&&rows.slice(1).every((r,i)=>r[0]===CATEGORIES[i]&&r[1]===true&&r.slice(2).every(x=>x==='')))requests.push({deleteSheet:{sheetId:tab.properties.sheetId}});
    else if(title==='Configuración'&&rows.length===4&&rows.every(r=>r.length===2)&&JSON.stringify(rows[0])===JSON.stringify(['Ajuste','Valor'])&&JSON.stringify(rows[1])===JSON.stringify(['Moneda principal','CAD'])&&JSON.stringify(rows[2])===JSON.stringify(['Zona horaria','America/Toronto'])&&rows[3]?.[0]==='Versión'&&['1','telegram-v1'].includes(String(rows[3]?.[1])))requests.push({deleteSheet:{sheetId:tab.properties.sheetId}});
  }
  await request(base+':batchUpdate',{method:'POST',body:JSON.stringify({requests})});
}
