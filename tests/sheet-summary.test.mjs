import assert from 'node:assert/strict';
import {breakdownRequests,BREAKDOWN_KEY} from '../worker/src/sheet-breakdown.js';
import {summaryRequests,summaryChart,formulaForLocale,ensureSummarySheet} from '../worker/src/sheet-summary.js';
const source={properties:{sheetId:10,title:'Movimientos',gridProperties:{rowCount:1004,columnCount:26}}};
const meta={properties:{locale:'es'},sheets:[source]};
const plan=summaryRequests(meta);
const tab=plan.find(x=>x.addSheet).addSheet.properties;
assert.equal(tab.title,'Resumen');assert.ok(tab.gridProperties.rowCount>=1068);
assert.equal(plan.filter(x=>x.addChart).length,0,'Create charts only after formula output is available');
assert.ok(!plan.some(x=>x.deleteSheet||x.deleteDimension));
assert.ok(plan.filter(x=>x.updateCells).every(x=>x.updateCells.start.sheetId===tab.sheetId),'Never rewrite source transactions');
const formulas=plan.filter(x=>x.updateCells?.rows[0].values[0].userEnteredValue.formulaValue).map(x=>x.updateCells.rows[0].values[0].userEnteredValue.formulaValue);
assert.ok(formulas.some(x=>x.includes('DATEVALUE')&&x.includes('ISNUMBER')),'Both ISO text and numeric dates');
assert.ok(formulas.some(x=>x.includes('WEEKDAY(W2:W;2)+1')),'Weeks start on Monday, including year boundaries');
assert.ok(formulas.some(x=>x.includes('DATE(YEAR(W2:W);MONTH(W2:W);1)')),'Months include the year');
const history=formulas.filter(x=>x.includes('QUERY(W2:AA'));
assert.equal(history.length,4);
assert.equal(formulas.filter(x=>x.includes('QUERY(HSTACK(')).length,2);
assert.ok(history.every(x=>x.includes('AA = ')&&x.includes('$B$3')&&x.includes('sum(Z), count(Z)')));
assert.ok(history.every(x=>x.includes('HSTACK("Sin gastos";0;0)')),'Empty summaries must have honest zero-total/zero-count placeholders');
assert.equal(formulaForLocale('=IF(A1="a,b",1,2)','es'),'=IF(A1="a,b";1;2)');
assert.equal(formulaForLocale('=IF(A1="a,b",1,2)','en_US'),'=IF(A1="a,b",1,2)');
const marker={metadataKey:'mis_gastos_summary',metadataValue:'v1',location:{sheetId:tab.sheetId}};
const owned={properties:tab,developerMetadata:[marker],charts:[]};
assert.deepEqual(summaryRequests({...meta,sheets:[source,owned]}),[],'Keep existing formulas, selector and customizations');
const resized=summaryRequests({...meta,sheets:[{properties:{...source.properties,gridProperties:{rowCount:2000}}},owned]});
assert.equal(resized.length,1);assert.equal(resized[0].updateSheetProperties.properties.gridProperties.rowCount,2064);
assert.notEqual(summaryRequests({...meta,sheets:[source,{properties:{sheetId:2,title:'Resumen'}}]}).find(x=>x.addSheet).addSheet.properties.title,'Resumen','Preserve user-created tabs');
assert.notEqual(summaryRequests({...meta,sheets:[source,{properties:{sheetId:1800002026,title:'Otra hoja'}}]}).find(x=>x.addSheet).addSheet.properties.sheetId,1800002026);
for(const col of [0,4]){
 const chart=summaryChart(tab.sheetId,col);
 assert.equal(chart.spec.basicChart.series[0].series.sourceRange.sources[0].startColumnIndex,col+9);
 assert.equal(chart.spec.basicChart.headerCount,1);assert.equal(chart.spec.basicChart.chartType,'COLUMN');
 assert.ok(chart.position.overlayPosition.anchorCell.rowIndex<23,'Charts stay above expanding tables');
 assert.equal(chart.position.overlayPosition.widthPixels,510);
}
// Native initialization is phased: formulas -> read their numeric output -> charts.
let state=structuredClone(meta),writes=[],sourceRows=[['Semana','Total','Gastos','','Mes','Total','Gastos'],['Sin gastos',0,0,'','Sin gastos',0,0]];
const request=async(url,options)=>{
 if(!options){
  if(url.includes('valueRenderOption=FORMULA'))return {values:[]};
  if(url.includes('/values/'))return {values:sourceRows};
  return structuredClone(state);
 }
 const requests=JSON.parse(options.body).requests;writes.push(requests);
 for(const r of requests){
  if(r.addSheet)state.sheets.push({properties:r.addSheet.properties,developerMetadata:[marker,...requests.filter(x=>x.createDeveloperMetadata).map(x=>x.createDeveloperMetadata.developerMetadata)],charts:[]});
  if(r.addChart)state.sheets.at(-1).charts.push(r.addChart.chart);
  if(r.updateChartSpec){const chart=state.sheets.at(-1).charts.find(x=>x.chartId===r.updateChartSpec.chartId);chart.spec=r.updateChartSpec.spec;}
 }
 return {};
};
await ensureSummarySheet('sheet',request);
assert.equal(writes.length,2);assert.ok(writes[0].some(x=>x.addSheet));assert.equal(writes[1].filter(x=>x.addChart).length,2);
await ensureSummarySheet('sheet',request);assert.equal(writes.length,2,'No duplicate tabs or charts on repeated reads');
state.sheets.at(-1).charts[0].spec.basicChart.series=[];
await ensureSummarySheet('sheet',request);assert.equal(writes.at(-1)[0].updateChartSpec.chartId,1800002031,'Repair a missing numeric series without duplicating its chart');
// Concurrent tab creation uses a deterministic ID and a metadata recheck.
state=structuredClone(meta);writes=[];
const race=async(url,options)=>{
 if(options&&JSON.parse(options.body).requests.some(x=>x.addSheet)){
  state.sheets.push(structuredClone(owned));throw Error('Already created');
 }
 return request(url,options);
};
await ensureSummarySheet('sheet',race);assert.equal(state.sheets.filter(x=>x.properties.title==='Resumen').length,1);
// Genuine initialization errors remain visible to the caller (finance callers handle them separately).
await assert.rejects(()=>ensureSummarySheet('sheet',async(url,options)=>{if(options)throw Error('Permission denied');return structuredClone(meta);}));
const detail=breakdownRequests(42,'My summary','en_US',1200,32);
assert.ok(detail.every(x=>!x.updateCells||x.updateCells.start.sheetId===42));
assert.equal(detail.find(x=>x.updateSheetProperties).updateSheetProperties.properties.gridProperties.columnCount,32,'Preserve extra columns');
assert.ok(detail.some(x=>x.setDataValidation?.rule.condition.values[0].userEnteredValue.includes("'My summary'")));
assert.ok(detail.some(x=>x.createDeveloperMetadata?.developerMetadata.metadataKey===BREAKDOWN_KEY));
const detailFormulas=detail.filter(x=>x.updateCells).map(x=>x.updateCells.rows[0].values[0].userEnteredValue.formulaValue).filter(Boolean);
assert.equal(detailFormulas.filter(x=>x.includes('QUERY(HSTACK')).length,2);
assert.ok(detailFormulas.filter(x=>x.includes('QUERY(HSTACK')).every(x=>x.includes('DATEVALUE($E$3')&&x.includes('$B$3')&&x.includes('CHOOSECOLS(t,2)/SUM')),'Month, currency and share must use the same records');
assert.ok(detailFormulas.some(x=>x.includes('Sin especificar')));
// Check balanced formula brackets outside strings, including the nested normalization helpers.
for(const f of detailFormulas){let depth=0,quoted=false;for(const c of f){if(c==='"')quoted=!quoted;if(!quoted){if(c==='(')depth++;if(c===')')depth--;assert.ok(depth>=0,f);}}assert.equal(depth,0,f);}
console.log('OK: native summary requests, locale-safe formulas, source preservation, Monday weeks, monthly totals, separate currencies, empty data, chart initialization and idempotency.');
