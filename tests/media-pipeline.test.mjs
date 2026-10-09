import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseExpense } from "../worker/src/utils.js";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

function contains(label, text) {
  assert.ok(app.includes(text), label + " (faltó: " + text + ")");
}

// Foto: selección/cámara -> OCR local -> texto -> mismo pipeline natural.
assert.match(html, /id="photoInput"[^>]+accept="image\/\*"[^>]+capture="environment"/);
contains("Foto carga Tesseract local", 'tesseract.js@5');
contains("Foto pasa el OCR por el mismo pipeline", 'processNaturalInput(text, "Foto", true)');

// Audio: micrófono -> MediaRecorder -> decode/resample -> Whisper -> mismo pipeline natural.
contains("Audio pide micrófono", "navigator.mediaDevices.getUserMedia({audio:true})");
contains("Audio usa MediaRecorder", "new MediaRecorder(stream)");
contains("Audio carga Transformers.js", "@huggingface/transformers@3.7.2");
contains("Audio usa ASR", 'pipeline("automatic-speech-recognition"');
contains("Audio usa Whisper", '"onnx-community/whisper-tiny"');
contains("Audio pasa transcripción por el mismo pipeline", 'processNaturalInput(text, "Audio", true)');

// Regresión del caso real de contexto visto en móvil.
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

// Asegura que Google conectado expone el mismo Sheet y que el historial se recarga desde Sheets.
contains("Header recibe enlace al Sheet", 'el("headerSheetLink").href = state.sheetUrl');
contains("Conexión Google relee historial", "await refresh()");
contains("Mismo Sheet se localiza por appProperties", "appProperties has { key='mis_gastos' and value='v1' }");

console.log("OK: contratos de foto, audio, contexto y Google Sheet verificados.");
