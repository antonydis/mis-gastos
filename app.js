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
  Restaurantes:["restaurante","restaurant","restaurantes","comida","almuerzo","almorce","almorze","cena","cene","desayuno","desayune","comi","merienda","cafe","cafeteria","coffee","bar","delivery","ubereats","uber eats","rappi"],
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
  rows: [],
  clarificationOriginal: "",
  clarificationSource: "Texto",
  mediaRecorder: null,
  audioChunks: [],
  transcriber: null,
  transcriberLoading: null,
  ocrWorker: null,
  ocrWorkerLoading: null
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
    let description = cleanDescription(segment, matches[0]);
    let merchant = "";
    let category = categoryFor(description + " " + segment);

    const normalizedSegment = normalizeText(segment);
    const mealMap = [
      [/\balmorc|\balmuerz/, "Almuerzo"],
      [/\bdesayun/, "Desayuno"],
      [/\bcen(?:e|a|ar)|\bcena\b/, "Cena"],
      [/\bmeri(?:enda|ende)/, "Merienda"],
      [/\bcomi\b|\bcomida\b/, "Comida"]
    ];
    const meal = mealMap.find(([pattern]) => pattern.test(normalizedSegment));
    if (meal) {
      description = meal[1];
      category = "Restaurantes";
      const merchantMatch = segment.match(/\b(?:en|del|de la)\s+(.+?)(?=\s+(?:donde|por|que|me\s+gast[eé]|gast[eé]|pagu[eé])\b|$)/i);
      if (merchantMatch) merchant = merchantMatch[1].trim().replace(/[,.]+$/,"");
    }

    expenses.push({
      id: uid(),
      date,
      description,
      merchant,
      category,
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

function shouldUseLocalModel(text, quick) {
  if (quick.ambiguous || !quick.expenses.length) return true;
  if (quick.expenses.some((x) => x.category === "Otros")) return true;
  const normalized = normalizeText(text);
  if (quick.expenses.length > 1 && /\b(en|donde|almorc|desayun|cen|comi|comida|compre|pague)\b/.test(normalized)) return true;
  if (/\b(donde|restaurante|tienda|local|factura|recibo)\b/.test(normalized)) return true;
  return false;
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

function parseStructuredModelResult(text) {
  const cleaned = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const startObj = cleaned.indexOf("{");
  const endObj = cleaned.lastIndexOf("}");
  if (startObj >= 0 && endObj > startObj) return JSON.parse(cleaned.slice(startObj, endObj + 1));
  const expenses = extractJson(cleaned);
  return {expenses, question:""};
}

async function parseWithLocalModel(text, source = "Texto") {
  const engine = await loadLocalModel();
  const settings = getSettings();
  const today = localISO();
  const yesterday = localISO(addDays(new Date(), -1));
  const prompt = `Interpreta el mensaje como un registro de gastos personales.
Hoy es ${today}. Ayer fue ${yesterday}.
Moneda por defecto: ${settings.currency}.
Categorías permitidas: ${CATEGORIES.join(", ")}.

Devuelve SOLO JSON válido con esta forma:
{
  "expenses": [
    {
      "date": "YYYY-MM-DD",
      "description": "qué se compró o para qué fue, corto y natural",
      "merchant": "nombre del comercio si aparece, si no vacío",
      "category": "una categoría permitida",
      "amount": 0,
      "currency": "NIO|USD|CAD|EUR",
      "paymentMethod": ""
    }
  ],
  "question": ""
}

Reglas:
- Usa el contexto, no palabras aisladas.
- "almorcé en La Loma y gasté 450" significa description "Almuerzo", merchant "La Loma", category "Restaurantes", amount 450.
- "compré 2300 en supermercado" significa category "Supermercado".
- No inventes comercios, montos ni métodos de pago.
- La fecha puede inferirse de hoy/ayer y la moneda puede usar la moneda por defecto.
- Si falta un dato indispensable para registrar correctamente, no adivines: deja expenses con lo que sea seguro y escribe UNA pregunta corta en "question".
- Un monto es indispensable. Comercio y método de pago no lo son.
- Si hay varios gastos, devuelve un elemento por gasto.
${source === "Foto" ? "- La entrada viene de OCR de un recibo: identifica comercio, fecha y TOTAL FINAL. Ignora subtotales, impuestos, cambio y números que no sean el total pagado, salvo que el texto describa claramente varios gastos." : ""}
${source === "Audio" ? "- La entrada viene de una transcripción de voz: corrige errores obvios de transcripción usando el contexto del gasto, sin inventar datos." : ""}

Entrada (${source}): ${JSON.stringify(text)}`;

  const response = await engine.chat.completions.create({
    messages:[
      {role:"system",content:"Estructuras gastos con precisión y haces una sola pregunta cuando realmente falta un dato indispensable. Respondes solo JSON."},
      {role:"user",content:prompt}
    ],
    temperature:0,
    max_tokens:600,
    extra_body:{enable_thinking:false}
  });

  const raw = response.choices?.[0]?.message?.content || "";
  const result = parseStructuredModelResult(raw);
  const parsed = Array.isArray(result.expenses) ? result.expenses : [];
  const expenses = parsed.map((item) => ({
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
    currency:["NIO","USD","CAD","EUR"].includes(String(item.currency || "").toUpperCase()) ? String(item.currency).toUpperCase() : settings.currency,
    paymentMethod:String(item.paymentMethod || "").trim().slice(0,50),
    source,
    registeredAt:new Date().toISOString()
  })).filter((x) => Number.isFinite(x.amount) && x.amount > 0);

  return {expenses, question:String(result.question || "").trim().slice(0,180)};
}

function showClarification(question, originalText, source) {
  state.clarificationOriginal = originalText;
  state.clarificationSource = source || "Texto";
  el("clarificationQuestion").textContent = question || "¿Qué dato falta?";
  el("clarificationAnswer").value = "";
  el("clarification").hidden = false;
  el("proposal").hidden = true;
  el("clarification").scrollIntoView({behavior:"smooth", block:"nearest"});
  setTimeout(() => el("clarificationAnswer").focus(), 80);
}

async function answerClarification() {
  const answer = el("clarificationAnswer").value.trim();
  if (!answer) return;
  const combined = `${state.clarificationOriginal}\nAclaración del usuario: ${answer}`;
  el("clarificationButton").disabled = true;
  try {
    const result = await parseWithLocalModel(combined, state.clarificationSource);
    if (result.question) return showClarification(result.question, combined, state.clarificationSource);
    if (!result.expenses.length) throw new Error("Todavía no tengo suficiente información para registrar el gasto.");
    el("clarification").hidden = true;
    renderProposal(result.expenses);
  } catch (err) {
    const fallback = quickParse(combined);
    fallback.expenses.forEach((x) => { x.source = state.clarificationSource; });
    if (fallback.expenses.length) {
      el("clarification").hidden = true;
      renderProposal(fallback.expenses);
      setStatus("Lo completé con el modo local básico.");
    } else {
      setStatus(err.message || "No pude completar ese gasto.");
    }
  } finally {
    el("clarificationButton").disabled = false;
  }
}

async function processNaturalInput(text, source = "Texto", forceModel = false) {
  const quick = quickParse(text);
  quick.expenses.forEach((x) => { x.source = source; });
  let expenses = quick.expenses;

  if (forceModel || shouldUseLocalModel(text, quick)) {
    try {
      const result = await parseWithLocalModel(text, source);
      if (result.question) {
        showClarification(result.question, text, source);
        return;
      }
      if (result.expenses.length) expenses = result.expenses;
    } catch (modelError) {
      if (!expenses.length) {
        if (!navigator.onLine) {
          showClarification("Estoy sin conexión y este caso necesita más contexto. ¿Puedes indicar el monto y qué compraste?", text, source);
          return;
        }
        throw modelError;
      }
    }
  }

  if (!expenses.length) {
    showClarification("¿Cuánto gastaste y en qué fue?", text, source);
    return;
  }
  el("clarification").hidden = true;
  renderProposal(expenses);
}

function renderProposal(expenses) {
  state.proposal = expenses;
  const root = el("proposalRows");
  root.innerHTML = expenses.map((x, i) => `
    <div class="proposal-row">
      <div>
        <strong>${escapeHtml(x.description)}</strong>
        ${x.merchant ? `<small class="merchant">${escapeHtml(x.merchant)}</small>` : ""}
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
  setBusy(true, "Entendiendo…");

  try {
    await processNaturalInput(text, "Texto");
  } catch (err) {
    setStatus(err.message || "No pude entender ese gasto.");
  } finally {
    setBusy(false);
  }
}

async function getOcrWorker() {
  if (state.ocrWorker) return state.ocrWorker;
  if (state.ocrWorkerLoading) return state.ocrWorkerLoading;
  state.ocrWorkerLoading = (async () => {
    setStatus("Preparando lectura de recibos…");
    const {createWorker} = await import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js");
    state.ocrWorker = await createWorker("spa+eng");
    return state.ocrWorker;
  })();
  try { return await state.ocrWorkerLoading; }
  finally { state.ocrWorkerLoading = null; }
}

async function handlePhoto(file) {
  if (!file) return;
  el("photoButton").disabled = true;
  setStatus("Leyendo el recibo en este dispositivo…");
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(file);
    const text = String(result?.data?.text || "").trim();
    if (!text) throw new Error("No pude leer texto de esa foto. Prueba con más luz y el recibo completo.");
    await processNaturalInput(text, "Foto", true);
    setStatus("");
  } catch (err) {
    setStatus(err.message || "No pude leer esa foto.");
  } finally {
    el("photoButton").disabled = false;
    el("photoInput").value = "";
  }
}

function resampleTo16k(data, sourceRate) {
  if (sourceRate === 16000) return data;
  const ratio = sourceRate / 16000;
  const length = Math.max(1, Math.round(data.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, data.length - 1);
    const mix = pos - left;
    out[i] = data[left] * (1 - mix) + data[right] * mix;
  }
  return out;
}

async function decodeAudioTo16k(blob) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error("Este navegador no puede preparar el audio.");
  const ctx = new AudioCtx();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const values = buffer.getChannelData(channel);
      for (let i = 0; i < values.length; i++) mono[i] += values[i] / buffer.numberOfChannels;
    }
    return resampleTo16k(mono, buffer.sampleRate);
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function getTranscriber() {
  if (state.transcriber) return state.transcriber;
  if (state.transcriberLoading) return state.transcriberLoading;
  state.transcriberLoading = (async () => {
    setStatus("Preparando voz en este dispositivo…");
    const {pipeline} = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm");
    state.transcriber = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny");
    return state.transcriber;
  })();
  try { return await state.transcriberLoading; }
  finally { state.transcriberLoading = null; }
}

async function transcribeAndProcess(blob) {
  el("audioButton").disabled = true;
  setStatus("Transcribiendo en este dispositivo…");
  try {
    const transcriber = await getTranscriber();
    const audio = await decodeAudioTo16k(blob);
    const result = await transcriber(audio, {language:"spanish", task:"transcribe"});
    const text = String(result?.text || "").trim();
    if (!text) throw new Error("No pude entender el audio. Intenta hablar un poco más cerca del teléfono.");
    el("expenseText").value = text;
    setStatus("Entendí: “" + text.slice(0,120) + (text.length > 120 ? "…" : "") + "”");
    await processNaturalInput(text, "Audio", true);
  } catch (err) {
    setStatus(err.message || "No pude procesar el audio.");
  } finally {
    el("audioButton").disabled = false;
  }
}

async function toggleAudioRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    state.mediaRecorder.stop();
    el("audioButton").textContent = "Hablar";
    el("audioButton").classList.remove("recording");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus("Este navegador no permite grabar audio desde aquí.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);
    state.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) state.audioChunks.push(event.data);
    });
    state.mediaRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      const mimeType = state.mediaRecorder?.mimeType || "audio/webm";
      const blob = new Blob(state.audioChunks, {type:mimeType});
      state.audioChunks = [];
      await transcribeAndProcess(blob);
    }, {once:true});
    state.mediaRecorder.start();
    el("audioButton").textContent = "Terminar audio";
    el("audioButton").classList.add("recording");
    setStatus("Te escucho. Cuenta los gastos con naturalidad.");
  } catch (err) {
    setStatus("No pude acceder al micrófono. Revisa el permiso del navegador.");
  }
}

async function prepareLocalUnderstanding() {
  el("prepareModelButton").disabled = true;
  try {
    await loadLocalModel();
    setStatus("Comprensión local lista.");
  } catch (err) {
    setStatus(err.message || "No pude preparar el modelo local.");
  } finally {
    el("prepareModelButton").disabled = false;
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

async function syncLocalToGoogle() {
  const pending = localRows();
  if (!pending.length) return 0;
  const range = encodeURIComponent("Movimientos!A:J");
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${state.sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {method:"POST", body:JSON.stringify({values:pending.map(objectToSheetRow)})}
  );
  localStorage.removeItem(STORAGE_KEY);
  return pending.length;
}

async function ensureGoogleSheet() {
  let file = await findExpenseSheet();
  if (!file) file = await createExpenseSheet();
  state.sheetId = file.id;
  state.sheetUrl = file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
  state.backend = "google";
  el("sheetLink").href = state.sheetUrl;
  el("sheetLink").hidden = false;
  const synced = await syncLocalToGoogle();
  el("modeBanner").textContent = synced
    ? `Conectado. Sincronicé ${synced} gasto${synced === 1 ? "" : "s"} pendiente${synced === 1 ? "" : "s"} con tu Google Drive.`
    : "Conectado. Tus movimientos se guardan en tu Google Drive.";
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

function setupTelegramLinking() {
  const params = new URLSearchParams(window.location.search);
  const link = params.get("link");
  const telegram = params.get("telegram");
  const reason = params.get("reason");
  const panel = el("telegramLinkPanel");
  const title = el("telegramLinkTitle");
  const text = el("telegramLinkText");
  const button = el("telegramLinkButton");

  if (telegram === "linked") {
    panel.hidden = false;
    title.textContent = "Telegram conectado";
    text.textContent = "Listo. Ya puedes volver a Telegram y registrar gastos directamente en el mismo Google Sheet.";
    button.hidden = true;
    return;
  }

  if (telegram === "error") {
    panel.hidden = false;
    title.textContent = "No pude conectar Telegram";
    text.textContent = reason === "expired-link"
      ? "El enlace venció. Vuelve a Telegram y usa /link para generar uno nuevo."
      : "Vuelve a Telegram y usa /link para intentarlo otra vez.";
    button.hidden = true;
    return;
  }

  if (!link) return;
  panel.hidden = false;
  title.textContent = "Conecta Telegram con tu Google";
  text.textContent = "Después de esta autorización, los gastos que confirmes en Telegram se guardarán en tu hoja Mis gastos.";

  if (!CONFIG.apiBaseUrl) {
    button.disabled = true;
    button.textContent = "Backend de Telegram pendiente";
    return;
  }

  button.addEventListener("click", () => {
    const base = CONFIG.apiBaseUrl.replace(/\/$/, "");
    window.location.href = base + "/oauth/start?link=" + encodeURIComponent(link);
  });
}

async function init() {
  const settings = getSettings();
  el("currencySelect").value = settings.currency;
  setupGoogleButton();
  setupTelegramLinking();
  state.rows = localRows();
  renderDashboard();
  if (!navigator.onLine) {
    el("localModelStatus").textContent = "Sin conexión. Los casos simples funcionan; para preparar modelo, foto o voz por primera vez necesitas Internet.";
  }

  el("registerButton").addEventListener("click", proposeFromText);
  el("photoButton").addEventListener("click", () => el("photoInput").click());
  el("photoInput").addEventListener("change", () => handlePhoto(el("photoInput").files?.[0]));
  el("audioButton").addEventListener("click", toggleAudioRecording);
  el("clarificationButton").addEventListener("click", answerClarification);
  el("clarificationAnswer").addEventListener("keydown", (e) => {
    if (e.key === "Enter") answerClarification();
  });
  el("prepareModelButton").addEventListener("click", prepareLocalUnderstanding);
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
