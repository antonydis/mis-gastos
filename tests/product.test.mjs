import assert from 'node:assert/strict';
import {monthlySummary} from '../worker/src/summary.js';
import {simplifySheet} from '../worker/src/sheet-layout.js';
import {correctExpense} from '../worker/src/google.js';
import {translateMessage,normalizeMenu} from '../worker/src/i18n.js';
import {EXPENSE_HEADERS,expenseToRow} from '../worker/src/records.js';

const summary=monthlySummary([
 {date:'2026-10-19',amount:15,currency:'CAD',category:'Gasolina'},
 {date:'2026-10-20',amount:10,currency:'CAD',category:'Otros'},
 {date:'2026-10-19',amount:7,currency:'USD',category:'Restaurantes',amountCAD:null},
 {date:'2026-10-20',amount:NaN,currency:'CAD'},
 {date:'2026-09-30',amount:900,currency:'CAD',category:'Casa'},
 {date:'2026-10-99',amount:500,currency:'CAD'},
 {date:'',amount:300,currency:'CAD'}
],'America/Toronto','month',new Date('2026-11-01T02:00:00Z'));
assert.match(summary,/25,00\sCAD · 2 gastos registrados/);
assert.match(summary,/Mayor categoría: Gasolina/);
assert.match(summary,/separados por moneda/);
assert.match(summary,/1 gasto en otra moneda sin conversión/);
assert.match(summary,/1 fila de este mes sin monto/);
assert.match(summary,/2 filas sin fecha válida/);
assert.ok(!summary.includes('900')&&!summary.includes('500'));
const english=translateMessage(summary,'en');
assert.match(english,/recorded expenses/);assert.match(english,/Top category: Gas/);assert.match(english,/excluded from the totals/);
assert.equal(normalizeMenu('📝 Corregir gasto'),'📝 Pendientes');
assert.equal(normalizeMenu('📝 Correct an expense'),'📝 Pendientes');
assert.equal(normalizeMenu('📝 Add details'),'📝 Pendientes');

// Simplification never rewrites financial rows; only exact unused templates are retired.
const requests=[];
await simplifySheet('sheet',async(url,options)=>{
 if(options){requests.push(...JSON.parse(options.body).requests);return{};}
 if(url.includes('?fields='))return {sheets:[{properties:{title:'Movimientos',sheetId:0}},{properties:{title:'Registro diario',sheetId:1}},{properties:{title:'Resúmenes',sheetId:2}},{properties:{title:'Mi análisis',sheetId:3}},{properties:{title:'Configuración',sheetId:4}}]};
 if(decodeURIComponent(url).includes("'Registro diario'"))return {values:[['Fecha','Estado','Registrado']]};
 if(decodeURIComponent(url).includes("'Resúmenes'"))return {values:[['Periodo','Desde','Hasta','Total','Moneda','Mayor categoría','% mayor categoría','Variación %','Resumen','Generado'],['2026-10','Datos personales']]};
 return {values:[['Configuración personalizada']]};
});
assert.deepEqual(requests.filter(x=>x.deleteSheet).map(x=>x.deleteSheet.sheetId),[1]);
assert.equal(requests.filter(x=>x.updateDimensionProperties?.properties.hiddenByUser===true).length,3);
assert.ok(!requests.some(x=>x.updateCells||x.deleteDimension||x.clear));
assert.ok(requests.some(x=>x.setBasicFilter?.filter.range.endColumnIndex===17));

// Correction writes the same ID's physical row, preserves audit fields, clears stale FX and rejects races.
const originalFetch=globalThis.fetch;
const original={id:'owned',date:'2026-10-19',description:'Café',merchant:'Comercio',category:'Restaurantes',amount:50,currency:'USD',paymentMethod:'',notes:'Nota original',amountCAD:70,registeredAt:'old timestamp',source:'Foto'};
let current=expenseToRow(original),batch=[];
globalThis.fetch=async(url,options={})=>{
 if(options.method==='POST'){batch.push(JSON.parse(options.body));return Response.json({});}
 return Response.json({values:[[],current]}); // Row 2 is blank: the expense is on physical row 3.
};
try{
 const updated=await correctExpense('sheet','owned',{...original,amount:15},'access',original);
 assert.equal(updated.id,'owned');assert.equal(updated.registeredAt,'old timestamp');assert.equal(updated.source,'Foto');assert.equal(updated.amountCAD,null);
 assert.equal(batch.length,1);assert.equal(batch[0].valueInputOption,'RAW');
 assert.deepEqual(batch[0].data.map(x=>x.range),['Movimientos!B3:H3','Movimientos!M3','Movimientos!O3']);
 assert.equal(batch[0].data[0].values[0][4],15);
 await assert.rejects(()=>correctExpense('sheet','other-person-id',{...original,amount:15},'access'));
 await assert.rejects(()=>correctExpense('sheet','owned',{...original,amount:0},'access'));
 await assert.rejects(()=>correctExpense('sheet','owned',{...original,date:'2026-02-30'},'access'));
 current=expenseToRow({...original,amount:60});
 await assert.rejects(()=>correctExpense('sheet','owned',{...original,amount:15},'access',original));
 assert.equal(batch.length,1,'Invalid or concurrently changed records must not be written');
}finally{globalThis.fetch=originalFetch;}
assert.equal(EXPENSE_HEADERS.length,17,'Legacy positions remain stable so old Sheets keep their data');
console.log('OK: contextual summaries, conservative sheet simplification, safe ID-based corrections and stale-FX protection.');
