export const EXPENSE_HEADERS=['ID','Fecha','Descripción','Comercio','Categoría','Monto original','Moneda','Método de pago','Fuente','Registrado','Frecuencia','Tipo','Notas','Viaje/proyecto','Monto CAD','Estado','Datos pendientes'];

export function missingDetails(x){
  return [['paymentMethod','método de pago'],['frequency','frecuencia'],['expenseType','fijo o variable']].filter(([key])=>!x[key]).map(([,label])=>label);
}

export function expenseToRow(x){
  const missing=missingDetails(x);
  return [x.id,x.date,x.description,x.merchant||'',x.category,x.amount,x.currency,x.paymentMethod||'',x.source||'Telegram',x.registeredAt||new Date().toISOString(),x.frequency||'',x.expenseType||'',x.notes||'',x.project||'',x.currency==='CAD'?x.amount:(x.amountCAD??''),missing.length?'Por completar':'Completo',missing.join(', ')];
}

export function rowToExpense(r){
  return {id:String(r[0]||''),date:typeof r[1]==='number'?new Date(Date.UTC(1899,11,30)+r[1]*86400000).toISOString().slice(0,10):String(r[1]||''),description:r[2]||'',merchant:r[3]||'',category:r[4]||'Otros',amount:Number(r[5]),currency:r[6]||'',paymentMethod:r[7]||'',source:r[8]||'',registeredAt:r[9]||'',frequency:r[10]||'',expenseType:r[11]||'',notes:r[12]||'',project:r[13]||'',amountCAD:r[14]===''||r[14]==null?null:Number(r[14]),status:r[15]||'',missing:r[16]||''};
}
