export const CATEGORIES = ['Supermercado','Restaurantes','Transporte','Gasolina','Casa','Salud','Servicios','Suscripciones','Compras','Cuidado personal','Entretenimiento','Educación','Viajes','Familia','Construcción','Otros'];

const words = {
  Supermercado:['supermercado','mercado','pricesmart','walmart','despensa','abarrotes'],
  Restaurantes:['restaurante','almuerzo','almorce','desayuno','desayune','cena','cene','comida','cafe','cafeteria','bar'],
  Transporte:['taxi','uber','indriver','bus','autobus','parqueo','peaje'],
  Gasolina:['gasolina','combustible','gasolinera','diesel','puma','shell'],
  Casa:['casa','hogar','mueble','limpieza','alquiler','renta'],
  Salud:['medicina','farmacia','doctor','medico','dentista','clinica','hospital'],
  Servicios:['luz','agua','internet','telefono','electricidad','seguro'],
  Suscripciones:['netflix','spotify','youtube','suscripcion','icloud'],
  Compras:['ropa','zapatos','tienda','amazon','regalo'],
  'Cuidado personal':['manicure','pedicure','salon','barberia','peluqueria','spa'],
  Entretenimiento:['cine','pelicula','concierto','juego','museo'],
  Educación:['curso','libro','escuela','universidad','colegio'],
  Viajes:['hotel','vuelo','avion','viaje','airbnb','hostal'],
  Familia:['familia','papa','mama','hijo','hija'],
  Construcción:['ferreteria','construccion','material','sinsa']
};

export function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s$€.,]/g,' ').replace(/\s+/g,' ').trim();}
export function categoryFor(text){const n=norm(text);for(const [c,ws] of Object.entries(words)) if(ws.some(w=>n.includes(norm(w)))) return c;return 'Otros';}
export function money(n,c){try{return new Intl.NumberFormat('es',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(n)||0)}catch{return c+' '+Number(n||0).toFixed(2)}}
export function uid(){return crypto.randomUUID();}
export function randomCode(){const a=crypto.getRandomValues(new Uint8Array(18));return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function localDate(tz,days=0){const d=new Date(Date.now()+days*86400000);const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz||'America/Managua',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`;}
function amount(v){let s=String(v).replace(/[^0-9.,]/g,'');const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>=0&&d>=0)s=c>d?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(c>=0)s=s.length-c-1===2?s.replace(',','.'):s.replace(/,/g,'');else if(d>=0&&s.length-d-1===3&&s.length>4)s=s.replace(/\./g,'');return Number(s)}
function currency(t,f='NIO'){const n=String(t).toLowerCase();if(/\bcad\b|canadiense/.test(n))return'CAD';if(/\beur\b|€|euros?/.test(n))return'EUR';if(/\busd\b|us\$|d[oó]lares?/.test(n))return'USD';if(/\bnio\b|c\$|c[oó]rdobas?/.test(n))return'NIO';return f}
export function parseExpense(text,profile={}){const date=/\b(anteayer|antier)\b/.test(norm(text))?localDate(profile.timezone,-2):/\bayer\b/.test(norm(text))?localDate(profile.timezone,-1):localDate(profile.timezone);const segs=String(text).replace(/\s+/g,' ').split(/\s+(?:y|adem[aá]s|luego|despu[eé]s)\s+|[;\n]+/i).map(x=>x.trim()).filter(Boolean);const out=[];for(const s of segs){const ms=[...s.matchAll(/(?:US\$|C\$|\$|€)?\s*\d[\d.,]*/g)].map(x=>x[0].trim());if(ms.length!==1)continue;const a=amount(ms[0]);if(!Number.isFinite(a)||a<=0)continue;const n=norm(s);let description=s.replace(ms[0],' ').replace(/\b(gaste|gasté|pague|pagué|compre|compré|fue|fueron|en|de|por)\b/gi,' ').replace(/\s+/g,' ').trim()||'Gasto';let merchant='',category=categoryFor(s);const meal=/\balmorc|\balmuerz/.test(n)?'Almuerzo':/\bdesayun/.test(n)?'Desayuno':/\bcen(?:e|a|ar)|\bcena\b/.test(n)?'Cena':/\bcomi\b|\bcomida\b/.test(n)?'Comida':'';if(meal){description=meal;category='Restaurantes';const m=s.match(/\b(?:en|del|de la)\s+(.+?)(?=\s+(?:donde|por|que|me\s+gast[eé]|gast[eé]|pagu[eé])\b|$)/i);if(m)merchant=m[1].trim().replace(/[,.]+$/,'')}out.push({date,description,merchant,category,amount:a,currency:currency(s,profile.currency||'NIO'),paymentMethod:'',source:'Telegram'})}if(!out.length)return{expenses:[],question:'¿Cuánto gastaste y en qué fue?'};if(out.length===1&&out[0].category==='Otros'&&out[0].description.length<5)return{expenses:out,question:`¿En qué fueron esos ${money(out[0].amount,out[0].currency)}?`};return{expenses:out,question:''}}
function b64u(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unb64u(v){const s=v.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function key(secret){const raw=unb64u(secret);if(raw.byteLength!==32)throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function encrypt(value,secret){const k=await key(secret),iv=crypto.getRandomValues(new Uint8Array(12)),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(value))),all=new Uint8Array(iv.length+ct.length);all.set(iv);all.set(ct,iv.length);return b64u(all)}
export async function decrypt(value,secret){const all=unb64u(value),iv=all.slice(0,12),ct=all.slice(12),k=await key(secret);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},k,ct))}
