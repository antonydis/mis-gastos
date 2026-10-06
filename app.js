const CONFIG = window.MIS_GASTOS_CONFIG || {};
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const STORAGE_KEY = "mis-gastos-local-v1";
const SETTINGS_KEY = "mis-gastos-settings-v1";
const CATEGORY_MEMORY_KEY = "mis-gastos-category-memory-v1";
const MODEL_VERSION = "0.2.82";

const CATEGORIES = [
  "Supermercado","Restaurantes","Transporte","Gasolina","Casa","Salud",
  "Servicios","Suscripciones","Compras","Cuidado personal","Entretenimiento","Educación",
  "Viajes","Familia","Construcción","Otros"
];

const CATEGORY_KEYWORDS = {
  Supermercado:["supermercado","super","mercado","pricesmart","price smart","walmart","despensa","comestibles","abarrotes","pulperia","pulpería"],
  Restaurantes:["restaurante","restaurant","restaurantes","comida","almuerzo","cena","desayuno","cafe","cafeteria","coffee","bar","delivery","ubereats","uber eats","rappi"],
  Transporte:["taxi","uber","indriver","bus","autobus","transporte","parqueo","parking","peaje","metro"],
  Gasolina:["gasolina","combustible","gasolinera","diesel","puma","shell","esso"],
  Casa:["casa","hogar","mueble","limpieza","reparacion","alquiler","arriendo","renta"],
  Salud:["salud","medicina","farmacia","doctor","medico","dentista","clinica","hospital"],
  Servicios:["luz","agua","internet","telefono","electricidad","servicio","seguro"],
  Suscripciones:["netflix","spotify","youtube","suscripcion","icloud","google one"],
  Compras:["ropa","zapatos","compra","tienda","amazon","regalo"],
  "Cuidado personal":["manicure","pedicure","salon","salon de belleza","barberia","peluqueria","spa","estetica"],
  Entretenimiento:["cine","pelicula","concierto","juego","entretenimiento","museo"],
  Educación:["curso","libro","escuela","universidad","educacion","colegio"],
  Viajes:["hotel","vuelo","avion","viaje","airbnb","hostal"],
  Familia:["familia","papa","mama","hijo","hija"],
  Construcción:["ferreteria","construccion","material","sinsa"]
};

const el = (id) => document.getElementById(id);
const state = {
  proposal: [],
  accessToken: "",
  tokenClient: null,
  sheetId: "",
  sheetUrl: "",
  backend: "local",
  model: null,
  modelLoading: null,
  rows: []
};

function localISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function parseISODate(value) {
  const [y,m,d] = String(value || "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function getSettings() {
  try {
    return {...{currency:CONFIG.defaultCurrency || "NIO"}, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")};
  } catch {
    return {currency:CONFIG.defaultCurrency || "NIO"};
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function money(amount, currency) {
  const locale = navigator.language || "es";
  try {
    return new Intl.NumberFormat(locale, {style:"currency", currency, maximumFractionDigits:2}).format(Number(amount) || 0);
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}

function setStatus(message) {
  el("status").textContent = message || "";
}

function setBusy(busy, message) {
  el("registerButton").disabled = busy;
  el("registerButton").textContent = busy ? (message || "Revisando…") : "Registrar";
}

function localRows() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveLocalRows(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryMemory() {
  try { return JSON.parse(localStorage.getItem(CATEGORY_MEMORY_KEY) || "{}"); }
  catch { return {}; }
}

function rememberCategory(text, category) {
  const key = normalizeText(text);
  if (!key || key === "gasto" || !CATEGORIES.includes(category)) return;
  const memory = categoryMemory();
  memory[key] = category;
  const entries = Object.entries(memory).slice(-150);
  localStorage.setItem(CATEGORY_MEMORY_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function categoryFor(text) {
  const normalized = normalizeText(text);
  const memory = categoryMemory();

  if (memory[normalized]) return memory[normalized];

  const learned = Object.entries(memory)
    .sort((a,b) => b[0].length - a[0].length)
    .find(([key]) => key.length >= 4 && normalized.includes(key));
  if (learned) return learned[1];

  let bestCategory = "Otros";
  let bestScore = 0;
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const word of words) {
      const needle = normalizeText(word);
      if (!needle) continue;
      if (normalized === needle) score += 5;
      else if (normalized.includes(needle)) score += Math.max(1, needle.split(" ").length + 1);
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  return bestCategory;
}

function paymentFor(text) {
  const lower = text.toLowerCase();
  if (/tarjeta|crédito|credito|débito|debito/.test(lower)) return "Tarjeta";
  if (/efectivo|cash/.test(lower)) return "Efectivo";
  if (/transferencia|transferí|transferi/.test(lower)) return "Transferencia";
  return "";
}

function currencyFor(text, fallback) {
  const lower = text.toLowerCase();
  if (/\bcad\b|dólar(?:es)? canadiense|dolar(?:es)? canadiense/.test(lower)) return "CAD";
  if (/\beur\b|€|euros?/.test(lower)) return "EUR";
  if (/\busd\b|us\$|dólares?|dolares?/.test(lower)) return "USD";
  if (/\bnio\b|c\$|córdobas?|cordobas?/.test(lower)) return "NIO";
  return fallback;
}

function parseNumberToken(token) {
  let s = String(token).replace(/[^0-9.,]/g, "");
  if (!s) return NaN;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (comma >= 0) {
    const decimals = s.length - comma - 1;
    s = decimals === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (dot >= 0) {
    const decimals = s.length - dot - 1;
    if (decimals === 3 && s.length > 4) s = s.replace(/\./g, "");
  }
  return Number(s);
}

function dateFromText(text) {
  const lower = text.toLowerCase();
  if (/anteayer|antier/.test(lower)) return localISO(addDays(new Date(), -2));
  if (/ayer/.test(lower)) return localISO(addDays(new Date(), -1));
  return localISO(new Date());
}

function cleanDescription(segment, amountToken) {
  return segment
    .replace(amountToken, " ")
    .replace(/\b(gast[eé]|pagu[eé]|compr[eé]|fueron|fue|en|de|por|unos?|unas?|aprox(?:imadamente)?|como)\b/gi, " ")
    .replace(/\b(nio|usd|cad|eur|córdobas?|cordobas?|dólares?|dolares?|euros?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.:;-]+|[,.:;-]+$/g, "")
    || "Gasto";
}

function quickParse(text) {
  const settings = getSettings();
  const normalized = text.replace(/\s+/g, " ").trim();
  const date = dateFromText(normalized);
  const segments = normalized
    .split(/\s+(?:y|además|ademas|luego|después|despues)\s+|[;\n]+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const expenses = [];
  let ambiguous = false;

  for (const segment of segments) {
    const matches = [...segment.matchAll(/(?:US\$|C\$|\$|€)?\s*\d[\d.,]*/g)].map((m) => m[0].trim()).filter(Boolean);
    if (matches.length !== 1) {
      ambiguous = true;
      continue;
    }
    const amount = parseNumberToken(matches[0]);
    if (!Number.isFinite(amount) || amount <= 0) {
      ambiguous = true;
      continue;
    }
    const description = cleanDescription(segment, matches[0]);
    expenses.push({
      id: uid(),
      date,
      description,
      merchant:"",
      category:categoryFor(description + " " + segment),
      amount,
      currency:currencyFor(segment, settings.currency),
      paymentMethod:paymentFor(segment),
      source:"Texto",
      registeredAt:new Date().toISOString()
    });
  }

  const totalNumbers = [...normalized.matchAll(/(?:US\$|C\$|\$|€)?\s*\d[\d.,]*/g)].length;
  if (!expenses.length || totalNumbers !== expenses.length) ambiguous = true;
  return {expenses, ambiguous};
}

function extractJson(text) {
  const cleaned = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const startArray = cleaned.indexOf("[");
  const endArray = cleaned.lastIndexOf("]");
  if (startArray >= 0 && endArray > startArray) return JSON.parse(cleaned.slice(startArray, endArray + 1));
  const startObj = cleaned.indexOf("{");
  const endObj = cleaned.lastIndexOf("}");
  if (startObj >= 0 && endObj > startObj) {
    const obj = JSON.parse(cleaned.slice(startObj, endObj + 1));
    return Array.isArray(obj.expenses) ? obj.expenses : [obj];
  }
  throw new Error("No pude estructurar la respuesta local.");
}

async function loadLocalModel() {
  if (state.model) return state.model;
  if (state.modelLoading) return state.modelLoading;
  if (!("gpu" in navigator)) throw new Error("Este dispositivo no tiene WebGPU disponible.");

  state.modelLoading = (async () => {
    el("localModelStatus").textContent = "Preparando comprensión local…";
    const webllm = await import(`https://esm.run/@mlc-ai/web-llm@${MODEL_VERSION}`);
    const modelId = CONFIG.modelId || "Qwen3-0.6B-q4f16_1-MLC";
    state.model = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (p) => {
        const pct = Number.isFinite(p.progress) ? Math.round(p.progress * 100) : null;
        el("localModelStatus").textContent = pct == null
          ? "Preparando comprensión local…"
          : `Preparando en este dispositivo… ${pct}%`;
      }
    });
    el("localModelStatus").textContent = "Comprensión local lista en este dispositivo.";
    return state.model;
  })();

  try { return await state.modelLoading; }
  finally { state.modelLoading = null; }
}

async function parseWithLocalModel(text) {
  const engine = await loadLocalModel();
  const settings = getSettings();
  const today = localISO();
  const yesterday = localISO(addDays(new Date(), -1));
  const prompt = `Convierte el mensaje del usuario en gastos estructurados.
Hoy es ${today}. Ayer fue ${yesterday}.
Moneda por defecto: ${settings.currency}.
Categorías permitidas: ${CATEGORIES.join(", ")}.
Devuelve SOLO un arreglo JSON. Cada elemento debe tener:
date (YYYY-MM-DD), description, merchant, category, amount (número), currency (NIO/USD/CAD/EUR), paymentMethod.
No inventes montos. Si no puedes identificar un monto, devuelve [].

Mensaje: ${JSON.stringify(text)}`;

  const response = await engine.chat.completions.create({
    messages:[
      {role:"system",content:"Extraes gastos personales con precisión. Responde solamente JSON válido, sin explicación."},
      {role:"user",content:prompt}
    ],
    temperature:0,
    max_tokens:450,
    extra_body:{enable_thinking:false}
  });

  const raw = response.choices?.[0]?.message?.content || "";
  const parsed = extractJson(raw);
  return parsed.map((item) => ({
    id:uid(),
    date:/^\d{4}-\d{2}-\d{2}$/.test(item.date || "") ? item.date : dateFromText(text),
    description:String(item.description || "Gasto").trim().slice(0,120),
    merchant:String(item.merchant || "").trim().slice(0,100),
    category:(() => {
      const learned = categoryFor(String(item.merchant || "") + " " + String(item.description || ""));
      if (learned !== "Otros") return learned;
      return CATEGORIES.includes(item.category) ? item.category : "Otros";
    })(),
    amount:Number(item.amount),
    currency:["NIO","USD","CAD","EUR"].includes(String(item.currency).toUpperCase()) ? String(item.currency).toUpperCase() : settings.currency,
    paymentMethod:String(item.paymentMethod || "").trim().slice(0,50),
    source:"Texto",
    registeredAt:new Date().toISOString()
  })).filter((x) => Number.isFinite(x.amount) && x.amount > 0);
}

function renderProposal(expenses) {
  state.proposal = expenses;
  const root = el("proposalRows");
  root.innerHTML = expenses.map((x, i) => `
    <div class="proposal-row">
      <div>
        <strong>${escapeHtml(x.description)}</strong>
        <small>${escapeHtml(x.date)}${x.paymentMethod ? " · " + escapeHtml(x.paymentMethod) : ""}</small>
      </div>
      <strong>${escapeHtml(money(x.amount, x.currency))}</strong>
      <select data-category-index="${i}" aria-label="Categoría para ${escapeHtml(x.description)}">
        ${CATEGORIES.map((c) => `<option value="${escapeHtml(c)}" ${c === x.category ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
    </div>`).join("");

  root.querySelectorAll("[data-category-index]").forEach((select) => {
    select.addEventListener("change", () => {
      const item = state.proposal[Number(select.dataset.categoryIndex)];
      item.category = select.value;
      rememberCategory(item.merchant || item.description, select.value);
    });
  });
  el("proposal").hidden = false;
  el("proposal").scrollIntoView({behavior:"smooth", block:"nearest"});
}

async function proposeFromText() {
  const text = el("expenseText").value.trim();
  if (!text) return setStatus("Escribe qué gastaste.");
  setStatus("");
  setBusy(true, "Revisando…");

  try {
    const quick = quickParse(text);
    let expenses = quick.expenses;
    if (quick.ambiguous) {
      try {
        const local = await parseWithLocalModel(text);
        if (local.length) expenses = local;
      } catch (modelError) {
        if (!expenses.length) throw modelError;
      }
    }
    if (!expenses.length) throw new Error('No encontré un monto. Prueba algo como “850 en gasolina”.');
    renderProposal(expenses);
  } catch (err) {
    setStatus(err.message || "No pude entender ese gasto.");
  } finally {
    setBusy(false);
  }
}

function objectToSheetRow(x) {
  return [x.id,x.date,x.description,x.merchant,x.category,x.amount,x.currency,x.paymentMethod,x.source,x.registeredAt];
}

function sheetRowToObject(row) {
  return {
    id:row[0] || "", date:row[1] || "", description:row[2] || "", merchant:row[3] || "",
    category:row[4] || "Otros", amount:Number(row[5] || 0), currency:row[6] || getSettings().currency,
    paymentMethod:row[7] || "", source:row[8] || "", registeredAt:row[9] || ""
  };
}

async function googleFetch(url, options = {}) {
  if (!state.accessToken) throw new Error("Conecta Google para continuar.");
  const response = await fetch(url, {
    ...options,
    headers:{
      "Authorization":`Bearer ${state.accessToken}`,
      "Content-Type":"application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) state.accessToken = "";
    throw new Error(data.error?.message || "Google no pudo completar la solicitud.");
  }
  return data;
}

async function findExpenseSheet() {
  const q = "appProperties has { key='mis_gastos' and value='v1' } and trashed=false";
  const url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) +
    "&spaces=drive&fields=files(id,name,webViewLink)&pageSize=10";
  const data = await googleFetch(url);
  return data.files?.[0] || null;
}

async function createExpenseSheet() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Managua";
  const created = await googleFetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method:"POST",
    body:JSON.stringify({
      properties:{title:"Mis gastos", locale:"es", timeZone:tz},
      sheets:[
        {properties:{title:"Movimientos"}},
        {properties:{title:"Registro diario"}},
        {properties:{title:"Categorías"}},
        {properties:{title:"Resúmenes"}},
        {properties:{title:"Configuración"}}
      ]
    })
  });

  const id = created.spreadsheetId;
  const settings = getSettings();
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method:"POST",
    body:JSON.stringify({
      valueInputOption:"RAW",
      data:[
        {range:"Movimientos!A1:J1",values:[["ID","Fecha","Descripción","Comercio","Categoría","Monto","Moneda","Método","Fuente","Registrado"]]},
        {range:"Registro diario!A1:C1",values:[["Fecha","Estado","Registrado"]]},
        {range:"Categorías!A1:C" + (CATEGORIES.length + 1),values:[["Categoría","Activa","Palabras clave"],...CATEGORIES.map((c) => [c,true,""])]},
        {range:"Resúmenes!A1:J1",values:[["Periodo","Desde","Hasta","Total","Moneda","Mayor categoría","% mayor categoría","Variación %","Resumen","Generado"]]},
        {range:"Configuración!A1:B4",values:[["Ajuste","Valor"],["Moneda principal",settings.currency],["Zona horaria",tz],["Versión","1"]]}
      ]
    })
  });

  await googleFetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,webViewLink`, {
    method:"PATCH",
    body:JSON.stringify({appProperties:{mis_gastos:"v1"}})
  });
  return {id, name:"Mis gastos", webViewLink:`https://docs.google.com/spreadsheets/d/${id}/edit`};
}

async function ensureGoogleSheet() {
  let file = await findExpenseSheet();
  if (!file) file = await createExpenseSheet();
  state.sheetId = file.id;
  state.sheetUrl = file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
  state.backend = "google";
  el("sheetLink").href = state.sheetUrl;
  el("sheetLink").hidden = false;
  el("modeBanner").textContent = "Conectado. Tus movimientos se guardan en tu Google Drive.";
}

async function readRows() {
  if (state.backend === "local") return localRows();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${state.sheetId}/values/${encodeURIComponent("Movimientos!A2:J")}`;
  const data = await googleFetch(url);
  return (data.values || []).map(sheetRowToObject);
}

async function appendRows(rows) {
  if (state.backend === "local") {
    const all = [...localRows(), ...rows];
    saveLocalRows(all);
    return;
  }
  const range = encodeURIComponent("Movimientos!A:J");
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${state.sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {method:"POST", body:JSON.stringify({values:rows.map(objectToSheetRow)})}
  );
}

function monthKey(date = new Date()) {
  return localISO(new Date(date.getFullYear(), date.getMonth(), 1)).slice(0,7);
}

function totalsByCurrency(rows) {
  const out = {};
  for (const r of rows) out[r.currency] = (out[r.currency] || 0) + Number(r.amount || 0);
  return out;
}

function formatTotals(totals) {
  const entries = Object.entries(totals);
  if (!entries.length) return money(0, getSettings().currency);
  return entries.map(([currency,total]) => money(total,currency)).join(" + ");
}

function currentMonthRows(rows = state.rows) {
  const key = monthKey();
  return rows.filter((r) => String(r.date).startsWith(key));
}

function categoryTotals(rows, currency) {
  const totals = {};
  rows.filter((r) => r.currency === currency).forEach((r) => {
    totals[r.category] = (totals[r.category] || 0) + Number(r.amount || 0);
  });
  return totals;
}

function renderDashboard() {
  const settings = getSettings();
  const rows = currentMonthRows();
  const totals = totalsByCurrency(rows);
  el("monthTotal").textContent = formatTotals(totals);

  const cats = categoryTotals(rows, settings.currency);
  const ordered = Object.entries(cats).sort((a,b) => b[1]-a[1]);
  el("topCategory").textContent = ordered[0]?.[0] || "—";
  const max = ordered[0]?.[1] || 1;
  el("categoryList").innerHTML = ordered.slice(0,5).map(([name,total]) => `
    <div class="category-row">
      <span>${escapeHtml(name)}</span>
      <div class="bar"><span style="width:${Math.max(4,Math.round(total/max*100))}%"></span></div>
      <strong>${escapeHtml(money(total,settings.currency))}</strong>
    </div>`).join("");

  const recent = [...state.rows].sort((a,b) => {
    const d = String(b.date).localeCompare(String(a.date));
    return d || String(b.registeredAt).localeCompare(String(a.registeredAt));
  }).slice(0,6);

  el("recentList").innerHTML = recent.length ? recent.map((r) => `
    <div class="recent-item">
      <div>
        <strong>${escapeHtml(r.description)}</strong>
        <span>${escapeHtml(r.date)} · ${escapeHtml(r.category)}</span>
      </div>
      <strong>${escapeHtml(money(r.amount,r.currency))}</strong>
    </div>`).join("") : '<p class="empty">Todavía no hay movimientos.</p>';
}

async function refresh() {
  state.rows = await readRows();
  renderDashboard();
}

async function saveProposal() {
  if (!state.proposal.length) return;
  el("confirmProposal").disabled = true;
  try {
    await appendRows(state.proposal);
    el("proposal").hidden = true;
    el("expenseText").value = "";
    state.proposal = [];
    await refresh();
    setStatus("Guardado.");
  } catch (err) {
    setStatus(err.message || "No pude guardar el gasto.");
  } finally {
    el("confirmProposal").disabled = false;
  }
}

function previousMonthComparableRows() {
  const now = new Date();
  const prevStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const prevEndDay = Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate());
  const prevEnd = new Date(prevStart.getFullYear(), prevStart.getMonth(), prevEndDay);
  return state.rows.filter((r) => {
    const d = parseISODate(r.date);
    return d >= prevStart && d <= prevEnd;
  });
}

function answerQuestion(type) {
  const settings = getSettings();
  const rows = currentMonthRows();
  const current = rows.filter((r) => r.currency === settings.currency);
  const total = current.reduce((s,r) => s + Number(r.amount || 0), 0);
  const cats = Object.entries(categoryTotals(rows, settings.currency)).sort((a,b) => b[1]-a[1]);
  let answer = "";

  if (type === "month") {
    answer = `Este mes llevas ${formatTotals(totalsByCurrency(rows))}.`;
  } else if (type === "top") {
    answer = cats.length
      ? `Tu categoría más alta es ${cats[0][0]}: ${money(cats[0][1],settings.currency)}.`
      : "Todavía no hay suficientes gastos este mes.";
  } else if (type === "compare") {
    const prev = previousMonthComparableRows().filter((r) => r.currency === settings.currency);
    const prevTotal = prev.reduce((s,r) => s + Number(r.amount || 0), 0);
    if (!prevTotal) answer = "Todavía no hay suficiente historial para comparar.";
    else {
      const pct = ((total - prevTotal) / prevTotal) * 100;
      answer = pct >= 0
        ? `Vas ${Math.abs(pct).toFixed(0)}% por encima del mismo punto del mes pasado.`
        : `Vas ${Math.abs(pct).toFixed(0)}% por debajo del mismo punto del mes pasado.`;
    }
  } else if (type === "largest") {
    const largest = [...current].sort((a,b) => b.amount-a.amount).slice(0,3);
    answer = largest.length
      ? "Tus mayores gastos: " + largest.map((r) => `${r.description} (${money(r.amount,r.currency)})`).join(", ") + "."
      : "Todavía no hay gastos para revisar.";
  } else if (type === "review") {
    if (!current.length) answer = "Registra algunos gastos y aquí te señalaré lo que valga la pena mirar.";
    else if (cats[0] && total && cats[0][1] / total >= .4) {
      answer = `${cats[0][0]} concentra ${Math.round(cats[0][1]/total*100)}% de tus gastos en ${settings.currency}. Es el primer lugar que miraría.`;
    } else {
      const largest = [...current].sort((a,b) => b.amount-a.amount)[0];
      answer = largest && total && largest.amount/total >= .25
        ? `Tu gasto de ${money(largest.amount,largest.currency)} en ${largest.description} representa una parte importante del mes.`
        : "Por ahora tus gastos están bastante repartidos. No hay una concentración clara que destaque.";
    }
  }

  el("answer").textContent = answer;
  el("answer").hidden = false;
}

async function connectGoogle() {
  if (!CONFIG.googleClientId) return;
  if (!window.google?.accounts?.oauth2) {
    setStatus("Google todavía está cargando. Intenta de nuevo.");
    return;
  }
  if (!state.tokenClient) {
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id:CONFIG.googleClientId,
      scope:GOOGLE_SCOPE,
      callback:async (response) => {
        if (response.error) return setStatus("No se pudo conectar Google.");
        state.accessToken = response.access_token;
        try {
          setStatus("Preparando tu hoja…");
          await ensureGoogleSheet();
          await refresh();
          el("googleButton").textContent = "Google conectado";
          setStatus("");
        } catch (err) {
          state.backend = "local";
          setStatus(err.message || "No pude preparar tu hoja.");
        }
      }
    });
  }
  state.tokenClient.requestAccessToken({prompt:state.accessToken ? "" : "consent"});
}

function setupGoogleButton() {
  if (!CONFIG.googleClientId) {
    el("modeBanner").textContent = "Prueba local: tus gastos se guardan solo en este dispositivo.";
    el("googleButton").hidden = true;
    return;
  }
  el("modeBanner").textContent = "Puedes probar aquí o conectar tu Google Drive.";
  el("googleButton").hidden = false;
}

async function init() {
  const settings = getSettings();
  el("currencySelect").value = settings.currency;
  setupGoogleButton();
  state.rows = localRows();
  renderDashboard();

  el("registerButton").addEventListener("click", proposeFromText);
  el("expenseText").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") proposeFromText();
  });
  document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => {
    el("expenseText").value = b.dataset.example;
    el("expenseText").focus();
  }));
  el("cancelProposal").addEventListener("click", () => {
    el("proposal").hidden = true;
    el("expenseText").focus();
  });
  el("confirmProposal").addEventListener("click", saveProposal);
  document.querySelectorAll("[data-question]").forEach((b) => b.addEventListener("click", () => answerQuestion(b.dataset.question)));
  el("googleButton").addEventListener("click", connectGoogle);
  el("currencySelect").addEventListener("change", () => {
    saveSettings({currency:el("currencySelect").value});
    renderDashboard();
  });
  el("clearLocalButton").addEventListener("click", () => {
    if (state.backend !== "local") {
      setStatus("Esta opción solo borra la prueba guardada en este dispositivo.");
      return;
    }
    if (confirm("¿Borrar todos los movimientos de prueba de este dispositivo?")) {
      localStorage.removeItem(STORAGE_KEY);
      state.rows = [];
      renderDashboard();
      setStatus("Prueba local borrada.");
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
