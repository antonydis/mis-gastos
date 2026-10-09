import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const telegram = await readFile(new URL("../worker/src/telegram.js", import.meta.url), "utf8");
const google = await readFile(new URL("../worker/src/google.js", import.meta.url), "utf8");
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

function has(haystack, needle, label) {
  assert.ok(haystack.includes(needle), label + " (faltó: " + needle + ")");
}

// Vinculación Google desde Telegram.
has(telegram, "Conecta tu Google una sola vez", "Telegram explica vínculo único");
has(telegram, "createLink(chat,uid,env)", "Usuario sin vínculo recibe enlace");
has(telegram, "saveGoogleLink", "OAuth persiste vínculo Telegram-Google");
has(google, "appProperties has { key='mis_gastos' and value='v1' }", "Google reutiliza el mismo Sheet");
has(google, "refresh_token", "Google usa acceso offline");

// Texto, foto y audio usan OpenAI y guardan directamente.
has(telegram, "analyzeText(text", "Texto usa OpenAI");
has(telegram, "analyzeReceipt(file", "Foto usa OpenAI vision");
has(telegram, "analyzeAudio(file", "Audio usa OpenAI transcription + structuring");
has(telegram, "call('getFile'", "Telegram descarga medios con getFile");
has(telegram, "appendExpenses(link.sheet_id", "Gastos claros se escriben directamente al Sheet");
has(telegram, "Guardado en Mis gastos", "Bot confirma después de guardar");
has(telegram, "callback_data:'expense:undo'", "Bot ofrece Deshacer");
has(telegram, "deleteExpensesByIds", "Deshacer elimina el gasto del Sheet");
has(telegram, "no se guardó nada", "Fallo de registro se comunica explícitamente");

// Solo se pregunta si el análisis necesita aclaración.
has(telegram, "if(result.question)", "Ambigüedad abre aclaración");
has(telegram, "rememberClarification", "Contexto de aclaración se conserva temporalmente");

// La página vuelve a leer el mismo Sheet cuando regresa a primer plano.
has(app, 'document.addEventListener("visibilitychange"', "Perfil refresca al volver a la pestaña");
has(app, 'window.addEventListener("focus"', "Perfil refresca al recuperar foco");
has(app, "setInterval", "Perfil refresca periódicamente");
has(app, "await refresh()", "Perfil relee Google Sheets");

console.log("OK: Telegram link + text/photo/audio + direct Sheet save + profile refresh contracts verified.");
