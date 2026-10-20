const KEY='mis_gastos_summary';
const CURRENCIES=['CAD','USD','NIO','EUR','GTQ','MXN'];

// Sheets formula separators follow the spreadsheet locale. QUERY strings stay SQL.
export function formulaForLocale(formula,locale='en_US'){
 const decimalComma=/^(es(?!_(MX|US|GT|NI|SV|HN|PA|PR|DO))|fr|de|it|pt|nl|pl|ru|uk|da|sv|fi|nb|tr|el|cs|hu|ro|bg)/i.test(locale);
 if(!decimalComma)return formula;
 let quoted=false;
 return [...formula].map(c=>{if(c==='"')quoted=!quoted;return c===','&&!quoted?';':c;}).join('');
}
export function summaryRequests(metadata){
 const sheets=metadata.sheets||[],source=sheets.find(x=>x.properties.title==='Movimientos');
 if(!source)return [];
 const markers=[...(metadata.developerMetadata||[]),...sheets.flatMap(x=>x.developerMetadata||[])];
 const owned=markers.find(x=>x.metadataKey===KEY)?.location?.sheetId;
 const current=sheets.find(x=>x.properties.sheetId===owned);
 const rowCount=Math.max(1000,(source.properties.gridProperties?.rowCount||1000)+64);
 if(current){
  return (current.properties.gridProperties?.rowCount||0)<rowCount?[{updateSheetProperties:{properties:{sheetId:owned,gridProperties:{rowCount}},fields:'gridProperties.rowCount'}}]:[];
 }
 let id=1800002026;while(sheets.some(x=>x.properties.sheetId===id))id++;
 let title='Resumen',suffix=1;while(sheets.some(x=>x.properties.title===title)){title='Resumen de gastos'+(suffix===1?'':' '+suffix);suffix++;}
 const formula=x=>({userEnteredValue:{formulaValue:formulaForLocale(x,metadata.properties?.locale)}});
 const string=x=>({userEnteredValue:{stringValue:x}});
 const cell=(row,column,value)=>({updateCells:{start:{sheetId:id,rowIndex:row,columnIndex:column},rows:[{values:[value]}],fields:'userEnteredValue'}});
 const range=(sr,er,sc,ec)=>({sheetId:id,startRowIndex:sr,endRowIndex:er,startColumnIndex:sc,endColumnIndex:ec});
 const format=(r,value)=>({repeatCell:{range:r,cell:{userEnteredFormat:value},fields:'userEnteredFormat'}});
 // Compact source rows first, so empty rows and mixed ISO/serial dates align.
 const dates='FILTER(Movimientos!B2:B,Movimientos!B2:B<>"")';
 const amounts='FILTER(Movimientos!F2:F,Movimientos!B2:B<>"")';
 const currency='FILTER(Movimientos!G2:G,Movimientos!B2:B<>"")';
 const queries=[['X','Semana (lunes)',0],['Y','Mes',4]].map(([col,label,out])=>cell(23,out,formula(`=IF(COUNTIFS(AA2:AA,$B$3,Z2:Z,">0",W2:W,">0")=0,VSTACK(HSTACK("${label}","Total","Gastos"),HSTACK("Sin gastos",0,0)),QUERY(W2:AA,"select ${col}, sum(Z), count(Z) where ${col} is not null and Z > 0 and AA = '"&$B$3&"' group by ${col} order by ${col} label ${col} '${label}', sum(Z) 'Total', count(Z) 'Gastos'",0))`)));

 const requests=[
  {addSheet:{properties:{sheetId:id,title,gridProperties:{rowCount,columnCount:27,frozenRowCount:3,hideGridlines:true}}}},
  {createDeveloperMetadata:{developerMetadata:{metadataKey:KEY,metadataValue:'v1',visibility:'DOCUMENT',location:{sheetId:id}}}},
  cell(0,0,string('Resumen de gastos')),
  cell(1,0,string('Semanas de lunes a domingo. Elige la moneda para ver sus totales.')),
  cell(2,0,string('Moneda')),cell(2,1,string('CAD')),
  cell(2,3,string('Montos originales. No se suman monedas distintas.')),
  cell(3,0,formula('=IF(COUNTIFS(AA2:AA,B3,Z2:Z,">0",W2:W,">0")=0,"No hay gastos válidos en esta moneda.","")')),
  cell(22,0,string('Por semana')),cell(22,4,string('Por mes')),
  cell(0,22,string('Fecha')),cell(0,23,string('Semana')),cell(0,24,string('Mes')),cell(0,25,string('Monto')),cell(0,26,string('Moneda')),
  cell(1,22,formula(`=ARRAYFORMULA(IFERROR(IF(ISNUMBER(${dates}),INT(${dates}),DATEVALUE(${dates})),""))`)),
  cell(1,23,formula('=ARRAYFORMULA(IF(W2:W="","",W2:W-WEEKDAY(W2:W,2)+1))')),
  cell(1,24,formula('=ARRAYFORMULA(IF(W2:W="","",DATE(YEAR(W2:W),MONTH(W2:W),1)))')),
  cell(1,25,formula(`=ARRAYFORMULA(IFERROR(IF(ISNUMBER(${amounts})*(${amounts}>0),${amounts},0),0))`)),
  cell(1,26,formula(`=ARRAYFORMULA(IFERROR(UPPER(TRIM(${currency})),""))`)),
  ...queries,
  {setDataValidation:{range:range(2,3,1,2),rule:{condition:{type:'ONE_OF_LIST',values:CURRENCIES.map(userEnteredValue=>({userEnteredValue}))},strict:true,showCustomUi:true}}},
  {mergeCells:{range:range(0,1,0,7),mergeType:'MERGE_ALL'}},
  {mergeCells:{range:range(1,2,0,7),mergeType:'MERGE_ALL'}},
  {mergeCells:{range:range(2,3,3,7),mergeType:'MERGE_ALL'}},
  format(range(0,rowCount,0,8),{textFormat:{fontFamily:'Arial',fontSize:11},verticalAlignment:'MIDDLE'}),
  format(range(0,1,0,7),{textFormat:{fontFamily:'Arial',fontSize:20,bold:true}}),
  format(range(1,2,0,7),{textFormat:{fontFamily:'Arial',fontSize:11,foregroundColor:{red:0.35,green:0.35,blue:0.35}}}),
  format(range(2,3,1,2),{backgroundColor:{red:0.9,green:0.95,blue:0.92},textFormat:{bold:true},horizontalAlignment:'CENTER'}),
  format(range(2,3,3,7),{wrapStrategy:'WRAP',textFormat:{fontSize:10,foregroundColor:{red:0.35,green:0.35,blue:0.35}}}),
  ...[0,4].flatMap(col=>[
   format(range(22,23,col,col+3),{textFormat:{fontSize:13,bold:true}}),
   format(range(23,24,col,col+3),{backgroundColor:{red:0.94,green:0.94,blue:0.94},textFormat:{bold:true},wrapStrategy:'WRAP'}),
   format(range(24,rowCount,col,col+1),{numberFormat:{type:'DATE',pattern:col===0?'dd mmm yyyy':'mmm yyyy'}}),
   format(range(24,rowCount,col+1,col+2),{numberFormat:{type:'NUMBER',pattern:'#,##0.00'}}),
   format(range(24,rowCount,col+2,col+3),{numberFormat:{type:'NUMBER',pattern:'0'}})
  ]),
  ...[[0,3,160],[3,4,60],[4,7,160],[7,8,60]].map(([startIndex,endIndex,pixelSize])=>({updateDimensionProperties:{range:{sheetId:id,dimension:'COLUMNS',startIndex,endIndex},properties:{pixelSize},fields:'pixelSize'}})),
  {updateDimensionProperties:{range:{sheetId:id,dimension:'COLUMNS',startIndex:8,endIndex:27},properties:{hiddenByUser:true},fields:'hiddenByUser'}},
  {updateDimensionProperties:{range:{sheetId:id,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:38},fields:'pixelSize'}},
  {updateDimensionProperties:{range:{sheetId:id,dimension:'ROWS',startIndex:1,endIndex:4},properties:{pixelSize:28},fields:'pixelSize'}},
  {updateDimensionProperties:{range:{sheetId:id,dimension:'ROWS',startIndex:4,endIndex:23},properties:{pixelSize:22},fields:'pixelSize'}}
 ];
 return requests;
}
export function summaryChart(id,column){
 const title=column===0?'Gastos por semana':'Gastos por mes';
  const chartRange=offset=>({sheetId:id,startRowIndex:23,startColumnIndex:column+offset,endColumnIndex:column+offset+1});
  return {spec:{title,subtitle:'Moneda seleccionada en B3',fontName:'Arial',basicChart:{chartType:'COLUMN',legendPosition:'NO_LEGEND',headerCount:1,axis:[{position:'BOTTOM_AXIS',title:column===0?'Semana (lunes)':'Mes'},{position:'LEFT_AXIS',title:'Monto'}],domains:[{domain:{sourceRange:{sources:[chartRange(0)]}}}],series:[{series:{sourceRange:{sources:[chartRange(1)]}},targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:{red:0.17,green:0.43,blue:0.35}}}]}},position:{overlayPosition:{anchorCell:{sheetId:id,rowIndex:5,columnIndex:column},widthPixels:510,heightPixels:300}}};
}
function summaryTab(meta){
 const markers=[...(meta.developerMetadata||[]),...(meta.sheets||[]).flatMap(x=>x.developerMetadata||[])];
 const id=markers.find(x=>x.metadataKey===KEY)?.location?.sheetId;
 return (meta.sheets||[]).find(x=>x.properties.sheetId===id);
}
export async function ensureSummarySheet(sheetId,request){
 const base='https://sheets.googleapis.com/v4/spreadsheets/'+sheetId;
 const read=()=>request(base+'?fields=properties(locale),sheets(properties,developerMetadata,charts),developerMetadata');
 let meta=await read();
 const requests=summaryRequests(meta).filter(x=>!x.addChart);
 if(requests.length){
  try{await request(base+':batchUpdate',{method:'POST',body:JSON.stringify({requests})});}
  catch(error){
   // Another request can atomically create the same deterministic tab first.
   const fresh=await read();
   if(!requests.some(x=>x.addSheet)||!summaryTab(fresh))throw error;
  }
  meta=await read();
 }
 const tab=summaryTab(meta);
 if(!tab)return;
 const missing=[0,4].filter(column=>!tab.charts?.some(x=>x.spec?.title===summaryChart(tab.properties.sheetId,column).spec.title&&x.spec?.basicChart?.series?.length));
 if(!missing.length)return;
 // Wait for native formula output before adding a numeric series. Sheets may
 // discard series bound to an empty/not-yet-calculated table during creation.
 const values=(await request(base+'/values/'+encodeURIComponent("'"+tab.properties.title.replaceAll("'","''")+"'!A24:G26")+'?valueRenderOption=UNFORMATTED_VALUE')).values||[];
 const charts=[];
 const used=new Set((meta.sheets||[]).flatMap(s=>(s.charts||[]).map(c=>c.chartId)));
 let nextId=1800002031;
 for(const column of missing){
  if(!values.slice(1).some(row=>Number.isFinite(row[column+1])))continue;
  const chart=summaryChart(tab.properties.sheetId,column);
  const existing=tab.charts?.find(x=>x.spec?.title===chart.spec.title);
  if(existing)charts.push({updateChartSpec:{chartId:existing.chartId,spec:chart.spec}});
  else{
   while(used.has(nextId))nextId++;
   used.add(nextId);chart.chartId=nextId++;
   charts.push({addChart:{chart}});
  }
 }
 if(charts.length){
  try{await request(base+':batchUpdate',{method:'POST',body:JSON.stringify({requests:charts})});}
  catch(error){
   const fresh=summaryTab(await read());
   if(missing.some(column=>!fresh?.charts?.some(x=>x.spec?.title===summaryChart(tab.properties.sheetId,column).spec.title&&x.spec?.basicChart?.series?.length)))throw error;
  }
 }
}
