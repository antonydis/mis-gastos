import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseExpense } from "../worker/src/utils.js";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const api = await readFile(new URL("../worker/src/openai.js", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");

function has(haystack, needle, label) {
  assert.ok(haystack.includes(needle), label + " (faltó: " + needle + ")");
}

// Foto -> Worker -> OpenAI vision -> structured expenses.
assert.match(html, /id="photoInput"[^>]+accept="image\/\*"[^>]+capture="environment"/);
has(app, 'apiMedia("/ai/receipt", file)', "Foto usa backend");
has(worker, "url.pathname==='/ai/receipt'", "Worker expone receipt endpoint");
has(api, 'type: "input_image"', "Recibo se manda como imagen al modelo");
has(api, 'gpt-5.6-luna', "Modelo visual barato configurado");
has(api, 'type: "json_schema"', "Salida estructurada por schema");

// Audio -> Worker -> OpenAI transcription -> structured expenses.
has(app, 'apiMedia("/ai/audio", file)', "Audio usa backend");
has(app, "new MediaRecorder(stream)", "Audio captura micrófono");
has(worker, "url.pathname==='/ai/audio'", "Worker expone audio endpoint");
has(api, 'gpt-4o-mini-transcribe', "Modelo de transcripción configurado");
has(api, 'https://api.openai.com/v1/audio/transcriptions', "Audio usa transcription API");
has(api, "structuredExpenseFromContent", "Transcripción pasa por modelo estructurador");

// No API key in frontend.
assert.ok(!app.includes("OPENAI_API_KEY"), "La API key no debe aparecer en app.js");

// Regresión del contexto.
const parsed = parseExpense(
  "Ayer gasté 2300 en supermercado y almorcé en La Loma donde me gasté 450",
  { currency: "NIO", timezone: "America/Managua" }
);
assert.equal(parsed.expenses.length, 2);
assert.equal(parsed.expenses[0].category, "Supermercado");
assert.equal(parsed.expenses[0].amount, 2300);
assert.equal(parsed.expenses[1].description, "Almuerzo");
assert.equal(parsed.expenses[1].merchant, "La Loma");
assert.equal(parsed.expenses[1].category, "Restaurantes");
assert.equal(parsed.expenses[1].amount, 450);

// Google same-sheet identity.
has(app, 'el("headerSheetLink").href = state.sheetUrl', "Header enlaza Sheet");
has(app, "await refresh()", "Conexión relee historial");
has(app, "appProperties has { key='mis_gastos' and value='v1' }", "Busca mismo Sheet marcado");

console.log("OK: OpenAI media pipeline, contextual parser and Google Sheet contracts verified.");
