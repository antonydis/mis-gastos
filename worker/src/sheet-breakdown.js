import {formulaForLocale} from './sheet-summary.js';
export const BREAKDOWN_KEY='mis_gastos_breakdown';
// The visible monthly tables expand independently; historical chart data uses hidden I:O.
export function breakdownRequests(id,title='Resumen',locale='es',rowCount=1000,columnCount=29){
 const range=(sr,er,sc,ec)=>({sheetId:id,startRowIndex:sr,endRowIndex:er,startColumnIndex:sc,endColumnIndex:ec});
 const cell=(row,col,value,formula=false)=>({updateCells:{start:{sheetId:id,rowIndex:row,columnIndex:col},rows:[{values:[{userEnteredValue:formula?{formulaValue:formulaForLocale(value,locale)}:{stringValue:value}}]}],fields:'userEnteredValue'}});
 const format=(r,value)=>({repeatCell:{range:r,cell:{userEnteredFormat:value},fields:'userEnteredFormat'}});
 const month='DATEVALUE($E$3&"-01")';
 const count=`COUNTIFS(Y2:Y,${month},AA2:AA,$B$3,Z2:Z,">0")`;
 const requests=[
  {updateSheetProperties:{properties:{sheetId:id,gridProperties:{columnCount:Math.max(29,columnCount)}},fields:'gridProperties.columnCount'}},
  cell(23,0,''),cell(23,4,''),
  ...[['X','Semana (lunes)',8],['Y','Mes',12]].map(([col,label,out])=>cell(23,out,`=IF(COUNTIFS(AA2:AA,$B$3,Z2:Z,">0",W2:W,">0")=0,VSTACK(HSTACK("${label}","Total","Gastos"),HSTACK("Sin gastos",0,0)),QUERY(W2:AA,"select ${col}, sum(Z), count(Z) where ${col} is not null and Z > 0 and AA = '"&$B$3&"' group by ${col} order by ${col} label ${col} '${label}', sum(Z) 'Total', count(Z) 'Gastos'",0))`,true)),
  ...[8,12].flatMap(col=>[format(range(24,rowCount,col,col+1),{numberFormat:{type:'DATE',pattern:col===8?'dd mmm yyyy':'mmm yyyy'}}),format(range(24,rowCount,col+1,col+2),{numberFormat:{type:'NUMBER',pattern:'#,##0.00'}})]),
  {unmergeCells:{range:range(2,3,3,7)}},
  cell(1,0,'Gráficas: historial por moneda. Tablas: mes y moneda elegidos.'),
  cell(2,3,'Mes'),cell(2,4,'=TEXT(TODAY(),"yyyy-mm")',true),
  cell(3,3,'Total'),cell(3,4,`=SUMIFS(Z2:Z,Y2:Y,${month},AA2:AA,$B$3,Z2:Z,">0")`,true),
  cell(4,0,'Gastos registrados, sin mezclar monedas. No es tu saldo disponible ni el saldo de tus tarjetas.'),
  cell(22,0,'Por categoría · mes'),cell(22,4,'Por medio de pago · mes'),
  ...[0,4].map(col=>({mergeCells:{range:range(22,23,col,col+3),mergeType:'MERGE_ALL'}})),
  cell(0,18,'Meses'),cell(1,18,'=SORT(UNIQUE(VSTACK(TEXT(TODAY(),"yyyy-mm"),IFERROR(FILTER(TEXT(Y2:Y,"yyyy-mm"),W2:W>0),TEXT(TODAY(),"yyyy-mm")))),1,FALSE)',true),
  cell(0,27,'Categoría'),cell(0,28,'Pago'),
  ...[['E',27],['H',28]].map(([source,out])=>cell(1,out,`=ARRAYFORMULA(IFERROR(IF(TRIM(FILTER(Movimientos!${source}2:${source},Movimientos!B2:B<>""))="","Sin especificar",UPPER(TRIM(FILTER(Movimientos!${source}2:${source},Movimientos!B2:B<>"")))),""))`,true)),
  {setDataValidation:{range:range(2,3,4,5),rule:{condition:{type:'ONE_OF_RANGE',values:[{userEnteredValue:`='${title.replaceAll("'","''")}'!$S$2:$S`}]},strict:false,showCustomUi:true,inputMessage:'Elige un mes o escribe año-mes, por ejemplo 2026-10.'}}},
  format(range(2,3,3,4),{textFormat:{fontFamily:'Arial',fontSize:11}}),
  format(range(2,3,4,5),{numberFormat:{type:'TEXT'},backgroundColor:{red:0.9,green:0.95,blue:0.92},textFormat:{bold:true},horizontalAlignment:'CENTER'}),
  format(range(3,4,4,5),{numberFormat:{type:'NUMBER',pattern:'#,##0.00'},textFormat:{bold:true}}),
  {updateDimensionProperties:{range:{sheetId:id,dimension:'COLUMNS',startIndex:8,endIndex:Math.max(29,columnCount)},properties:{hiddenByUser:true},fields:'hiddenByUser'}},
  {createDeveloperMetadata:{developerMetadata:{metadataKey:BREAKDOWN_KEY,metadataValue:'v1',visibility:'DOCUMENT',location:{sheetId:id}}}}
 ];
 for(const [helper,label,out] of [['AB','Categoría',0],['AC','Medio de pago',4]]){
  const query=`QUERY(HSTACK(${helper}2:${helper},Y2:Y,Z2:Z,AA2:AA),"select Col1, sum(Col3) where Col2 = "&DATEVALUE($E$3&"-01")&" and Col3 > 0 and Col4 = '"&$B$3&"' group by Col1 order by sum(Col3) desc label Col1 '', sum(Col3) ''",0)`;
  requests.push(cell(23,out,`=IF(${count}=0,VSTACK(HSTACK("${label}","Monto","% del mes"),HSTACK("Sin gastos",0,0)),LET(t,${query},VSTACK(HSTACK("${label}","Monto","% del mes"),HSTACK(CHOOSECOLS(t,1),CHOOSECOLS(t,2),ARRAYFORMULA(CHOOSECOLS(t,2)/SUM(CHOOSECOLS(t,2)))))))`,true),
   format(range(23,24,out,out+3),{backgroundColor:{red:0.94,green:0.94,blue:0.94},textFormat:{bold:true},wrapStrategy:'WRAP'}),
   format(range(24,rowCount,out,out+1),{numberFormat:{type:'TEXT'},wrapStrategy:'WRAP',textFormat:{fontFamily:'Arial',fontSize:11}}),
   format(range(24,rowCount,out+1,out+2),{numberFormat:{type:'NUMBER',pattern:'#,##0.00'}}),
   format(range(24,rowCount,out+2,out+3),{numberFormat:{type:'PERCENT',pattern:'0.0%'}}));
 }
 return requests;
}
