import { CATEGORIES, localDate } from "./utils.js";

const RECEIPT_MODEL = "gpt-6-luna";
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

const expenseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    expenses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          date: { type: "string" },
          description: { type: "string" },
          merchant: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          amount: { type: "number" },
          currency: { type: "string", enum: ["NIO", "USD", "CAD", "EUR"] },
          paymentMethod: { type: "string" }
        },
        required: ["date","description","merchant","category","amount","currency","paymentMethod"]
      }
    },
    question: { type: "string" }
  },
  required: ["expenses","question"]
};

function authHeaders(env) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no está configurada.");
  return { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
}

function outputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

async function structuredExpenseFromContent(content, profile, env, source) {
  const today = localDate(profile.timezone);
  const yesterday = localDate(profile.timezone, -1);
  const prompt = [
    "Extrae gastos personales con precisión.",
    `Hoy es ${today}. Ayer fue ${yesterday}.`,
    `Moneda por defecto: ${profile.currency || "NIO"}.`,
    `Categorías permitidas: ${CATEGORIES.join(", ")}.`,
    "Usa el contexto, no palabras aisladas.",
    "No inventes montos, comercios, fechas ni métodos de pago.",
    "Comercio y método de pago pueden quedar vacíos.",
    "Si falta un monto o hay una ambigüedad que impediría guardar correctamente, devuelve una sola pregunta breve en question.",
    source === "Foto"
      ? "La imagen es un recibo. Identifica el TOTAL PAGADO, no subtotal, impuesto, propina sugerida, cambio, saldo previo ni números de autorización. Extrae el comercio y la fecha cuando sean visibles."
      : "La entrada viene de una transcripción de voz. Corrige errores obvios de transcripción solo cuando el contexto lo haga claro."
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      ...authHeaders(env),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_VISION_MODEL || RECEIPT_MODEL,
      reasoning: { effort: "none" },
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...content
        ]
      }],
      text: {
        format: {
          type: "json_schema",
          name: "expense_capture",
          strict: true,
          schema: expenseSchema
        }
      },
      max_output_tokens: 900
    })
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("OpenAI Responses error", data);
    throw new Error(data.error?.message || "No pude analizar el gasto.");
  }

  const raw = outputText(data);
  if (!raw) throw new Error("El modelo no devolvió una respuesta.");
  const parsed = JSON.parse(raw);

  parsed.expenses = (parsed.expenses || [])
    .map((x) => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? x.date : today,
      description: String(x.description || "Gasto").trim().slice(0,120),
      merchant: String(x.merchant || "").trim().slice(0,100),
      category: CATEGORIES.includes(x.category) ? x.category : "Otros",
      amount: Number(x.amount),
      currency: ["NIO","USD","CAD","EUR"].includes(x.currency) ? x.currency : (profile.currency || "NIO"),
      paymentMethod: String(x.paymentMethod || "").trim().slice(0,50),
      source
    }))
    .filter((x) => Number.isFinite(x.amount) && x.amount > 0);

  parsed.question = String(parsed.question || "").trim().slice(0,180);
  return parsed;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

export async function analyzeText(text, profile, env, source = "Texto") {
  const value=String(text||"").trim();
  if(!value) throw new Error("Texto vacío.");
  return structuredExpenseFromContent([
    { type: "input_text", text: value }
  ], profile, env, source);
}

export async function analyzeReceipt(file, profile, env) {
  if (!file || !file.type?.startsWith("image/")) throw new Error("Archivo de imagen inválido.");
  if (file.size > 8 * 1024 * 1024) throw new Error("La foto es demasiado grande. Máximo 8 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${bytesToBase64(bytes)}`;
  return structuredExpenseFromContent([
    { type: "input_image", image_url: dataUrl, detail: "high" }
  ], profile, env, "Foto");
}

export async function transcribeAudio(file, env) {
  if (!file) throw new Error("Audio inválido.");
  if (file.size > 25 * 1024 * 1024) throw new Error("El audio es demasiado grande. Máximo 25 MB.");

  const form = new FormData();
  form.append("file", file, file.name || "gasto.webm");
  form.append("model", env.OPENAI_TRANSCRIBE_MODEL || TRANSCRIBE_MODEL);
  form.append("language", "es");
  form.append("prompt", "Gastos personales en español. Pueden mencionarse córdobas, dólares, CAD, comercios, restaurantes, gasolina, supermercado y fechas como hoy o ayer.");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: authHeaders(env),
    body: form
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("OpenAI transcription error", data);
    throw new Error(data.error?.message || "No pude transcribir el audio.");
  }
  const text = String(data.text || "").trim();
  if (!text) throw new Error("No pude entender el audio.");
  return text;
}

export async function analyzeAudio(file, profile, env) {
  const transcript = await transcribeAudio(file, env);
  const result = await structuredExpenseFromContent([
    { type: "input_text", text: `Transcripción:\n${transcript}` }
  ], profile, env, "Audio");
  return { ...result, transcript };
}
