import {localDate,money} from './utils.js';

export function queryKind(text){
  const t=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\d/.test(t))return '';
  if(/mi hoja|\/hoja|enlace.*hoja/.test(t))return 'sheet';
  if(/ayer|semana|mes pasado|ano|año/.test(t))return 'unsupported';
  if(/categorias|categoria.*mas|mas.*categoria/.test(t))return 'categories';
  if(/este mes|\/mes\b|cuanto.*gast|gastos.*mes/.test(t))return 'month';
  return '';
}

export function monthlySummary(rows,timezone,kind,now=new Date()){
  const month=localDate(timezone,0,now).slice(0,7);
  const groups=new Map();
  for(const row of rows){
    if(!row.date.startsWith(month)||!Number.isFinite(row.amount)||row.amount<=0)continue;
    if(!groups.has(row.currency))groups.set(row.currency,{total:0,categories:new Map()});
    const g=groups.get(row.currency);g.total+=row.amount;
    g.categories.set(row.category,(g.categories.get(row.category)||0)+row.amount);
  }
  if(!groups.size)return 'No hay gastos registrados este mes ('+month+').';
  const lines=['Gastos de '+month+':'];
  for(const [currency,g] of groups){
    lines.push('Total: '+money(g.total,currency));
    const categories=[...g.categories].sort((a,b)=>b[1]-a[1]);
    for(const [category,total] of (kind==='categories'?categories:categories.slice(0,1)))lines.push(category+': '+money(total,currency));
  }
  return lines.join('\n');
}
