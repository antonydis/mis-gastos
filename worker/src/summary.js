import {localDate,money} from './utils.js';

export function queryKind(text){
  const t=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\d/.test(t))return '';
  if(/mi hoja|my sheet|open my sheet|\/hoja|enlace.*hoja/.test(t))return 'sheet';
  if(/ayer|semana|mes pasado|ano|año|yesterday|last month|week|year/.test(t))return 'unsupported';
  if(/categorias|categories|category|categoria.*mas|mas.*categoria/.test(t))return 'categories';
  if(/este mes|this month|\/mes\b|how much.*spent|cuanto.*gast|gastos.*mes/.test(t))return 'month';
  return '';
}

export function monthlySummary(rows,timezone,kind,now=new Date()){
  const month=localDate(timezone,0,now).slice(0,7);
  const groups=new Map();let invalid=0,undated=0,uncategorized=0,unconverted=0;
  for(const row of rows){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date||'')||!Number.isFinite(Date.parse(row.date))||new Date(row.date).toISOString().slice(0,10)!==row.date){undated++;continue;}
    if(!row.date.startsWith(month))continue;
    if(!Number.isFinite(row.amount)||row.amount<=0||!['CAD','USD','NIO','EUR','GTQ','MXN'].includes(row.currency)){invalid++;continue;}
    if(!row.category||row.category==='Otros')uncategorized++;
    if(row.currency!=='CAD'&&!(Number.isFinite(row.amountCAD)&&row.amountCAD>0))unconverted++;
    if(!groups.has(row.currency))groups.set(row.currency,{total:0,count:0,categories:new Map()});
    const g=groups.get(row.currency);g.total+=row.amount;g.count++;
    const category=row.category||'Otros';g.categories.set(category,(g.categories.get(category)||0)+row.amount);
  }
  const lines=[groups.size?'Gastos de '+month+':':'No hay gastos registrados este mes ('+month+').'];
  for(const [currency,g] of groups){
    lines.push(money(g.total,currency)+' · '+g.count+(g.count===1?' gasto registrado.':' gastos registrados.'));
    const categories=[...g.categories].sort((a,b)=>b[1]-a[1]);
    for(const [category,total] of (kind==='categories'?categories:categories.slice(0,1)))lines.push((kind==='categories'?'':'Mayor categoría: ')+category+': '+money(total,currency));
  }
  if(groups.size>1)lines.push('Los totales están separados por moneda; no se sumaron entre sí.');
  if(unconverted)lines.push(unconverted+(unconverted===1?' gasto en otra moneda sin conversión a CAD.':' gastos en otra moneda sin conversión a CAD.'));
  if(uncategorized)lines.push(uncategorized+(uncategorized===1?' gasto en Otros: está incluido en el total.':' gastos en Otros: están incluidos en el total.'));
  if(invalid)lines.push(invalid+(invalid===1?' fila de este mes sin monto o moneda válidos: no está incluida.':' filas de este mes sin monto o moneda válidos: no están incluidas.'));
  if(undated)lines.push(undated+(undated===1?' fila sin fecha válida: no pude asignarla a un mes.':' filas sin fecha válida: no pude asignarlas a un mes.'));
  return lines.join('\n');
}
