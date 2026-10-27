import assert from 'node:assert/strict';
import {expenseGroup,groupedReport} from '../worker/src/weekly-report.js';

const row=(date,category,amount,description='',currency='CAD')=>({date,category,amount,description,currency});
assert.equal(expenseGroup(row('2026-10-20','Gasolina',40,'Petro Canada')),'Carro');
assert.equal(expenseGroup(row('2026-10-20','Servicios',200,'Seguro auto')),'Carro');
assert.equal(expenseGroup(row('2026-10-20','Servicios',300,'Leasing carro')),'Carro');
assert.equal(expenseGroup(row('2026-10-20','Restaurantes',25,'Almuerzo')),'Diversión');
assert.equal(expenseGroup(row('2026-10-20','Transporte',10,'Metro')),'Transporte');
const rows=[row('2026-10-20','Gasolina',40,'Gasolina'),row('2026-10-21','Servicios',160,'Seguro auto'),row('2026-10-22','Restaurantes',50,'Restaurante'),row('2026-10-23','Supermercado',50,'Mercado'),row('2026-10-24','Gasolina',10,'Gasolina','USD'),row('2026-10-12','Gasolina',999,'Antiguo')];
const output=groupedReport(rows,'2026-10-20','2026-10-26','Semana');
assert.match(output,/200,00.*80,0%/);
assert.match(output,/50,00.*20,0%/);
assert.match(output,/Las monedas se presentan por separado/);
assert.doesNotMatch(output,/999/);
assert.match(output,/Carro/);
assert.match(output,/Diversión/);
console.log('Weekly and grouped report tests passed');
