import {CATEGORIES,categoryFor,localDate,parseExpense} from './utils.js';

export async function interpretExpense(text,profile,env){
  const fallback=parseExpense(text,profile);
  if(!env.MODEL_BASE_URL)return fallback;
  try{
    const prompt=`Convierte este mensaje en gastos estructurados. Hoy: ${localDate(profile.timezone)}. Ayer: ${localDate(profile.timezone,-1)}. Moneda por defecto: ${profile.currency}. Categorías: ${CATEGORIES.join(', ')}. Devuelve SOLO JSON: {"expenses":[{"date":"YYYY-MM-DD","description":"","merchant":"","category":"","amount":0,"currency":"NIO","paymentMethod":""}],"question":""}. Usa contexto. Ejemplo: "almorcé en La Loma y gasté 450" => description Almuerzo, merchant La Loma, category Restaurantes. Si falta el monto, pregunta. Mensaje: ${JSON.stringify(text)}`;
    const r=await fetch(env.MODEL_BASE_URL.replace(/\/$/,'')+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...(env.MODEL_API_KEY?{Authorization:'Bearer '+env.MODEL_API_KEY}:{})},body:JSON.stringify({model:env.MODEL_NAME||'local-model',messages:[{role:'system',content:'Estructuras gastos personales con precisión. Responde solo JSON válido.'},{role:'user',content:prompt}],temperature:0,max_tokens:500})});
    if(!r.ok)return fallback;
    const d=await r.json(),raw=String(d.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/gi,'');
    const a=raw.indexOf('{'),b=raw.lastIndexOf('}');if(a<0||b<=a)return fallback;
    const x=JSON.parse(raw.slice(a,b+1));
    const expenses=(Array.isArray(x.expenses)?x.expenses:[]).map(i=>({date:/^\d{4}-\d{2}-\d{2}$/.test(i.date||'')?i.date:localDate(profile.timezone),description:String(i.description||'Gasto').slice(0,120),merchant:String(i.merchant||'').slice(0,100),category:CATEGORIES.includes(i.category)?i.category:categoryFor((i.description||'')+' '+(i.merchant||'')),amount:Number(i.amount),currency:['NIO','USD','CAD','EUR'].includes(String(i.currency).toUpperCase())?String(i.currency).toUpperCase():profile.currency,paymentMethod:String(i.paymentMethod||'').slice(0,50),source:'Telegram'})).filter(i=>Number.isFinite(i.amount)&&i.amount>0);
    return{expenses,question:String(x.question||'').slice(0,180)};
  }catch{return fallback}
}
