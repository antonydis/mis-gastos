import assert from 'node:assert/strict';
import {duplicateImportFlags} from '../worker/src/telegram.js';

const existing=[{date:'2026-10-20',currency:'CAD',amount:18}];
const expenses=[
  {date:'2026-10-20',currency:'CAD',amount:18,description:'Existing transaction'},
  {date:'2026-10-21',currency:'CAD',amount:12,description:'First transaction'},
  {date:'2026-10-21',currency:'CAD',amount:12.00,description:'Another possible duplicate'},
  {date:'2026-10-21',currency:'USD',amount:12,description:'Different currency'},
  {date:'2026-10-22',currency:'CAD',amount:12,description:'Different date'}
];
const flagged=duplicateImportFlags(expenses,existing);
assert.deepEqual(flagged.map(x=>x.possibleDuplicate),[true,false,true,false,false]);
assert.equal(expenses[0].possibleDuplicate,undefined,'Do not modify extracted data');
assert.equal(flagged.length,expenses.length,'No rows silently dropped');
assert.deepEqual(duplicateImportFlags([{date:'2026-10-21',currency:'CAD',amount:12}],[]).map(x=>x.possibleDuplicate),[false]);

console.log('OK: statement imports flag existing and within-batch duplicates');
