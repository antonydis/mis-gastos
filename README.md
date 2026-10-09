# Mis gastos

Un registro de gastos simple que guarda los movimientos en el Google Drive de cada persona.

## Experiencia

La persona puede registrar:

- texto: `850 en gasolina y 300 en café`;
- foto de un recibo;
- audio contando lo que gastó;
- Telegram, después de vincular Google una sola vez.

La aplicación propone la interpretación antes de guardar.

## Web

La web corre en GitHub Pages.

- Los gastos simples se interpretan inmediatamente.
- WebLLM queda como respaldo local para frases con más contexto.
- Foto usa OCR en el dispositivo.
- Audio usa transcripción local.
- Sin conexión, los movimientos quedan pendientes en el dispositivo.
- Al reconectar Google, los gastos locales pendientes se sincronizan automáticamente con el Sheet.

Google usa el scope `drive.file`, limitado a los archivos que esta aplicación crea o usa.

## Telegram

El backend está en `worker/` y está preparado para Cloudflare Workers + D1.

Flujo:

1. Usuario escribe `/start` al bot.
2. Telegram entrega **Conectar Google**.
3. La web abre el OAuth de servidor.
4. Se crea o reutiliza `Mis gastos` en el Drive de esa persona.
5. Telegram queda asociado a ese Sheet.
6. El usuario manda un gasto.
7. El bot propone la interpretación.
8. **Guardar** escribe directamente la fila en Google Sheets.

D1 no almacena movimientos. Guarda únicamente el vínculo Telegram/Google/Sheet, el refresh token cifrado y estados temporales de confirmación.

La primera versión de Telegram procesa texto. El adaptador `worker/src/model.js` permite usar después un modelo open source servido por Ollama o llama.cpp mediante una API OpenAI-compatible, sin cambiar el bot.

## Estructura

- `index.html`, `app.js`, `styles.css`: web/PWA.
- `config.js`: configuración pública del frontend.
- `worker/`: backend Telegram + OAuth offline + Google Sheets.
- `worker/schema.sql`: tablas D1.
- `worker/wrangler.toml`: configuración Cloudflare.

## Privacidad

- No hay una base central de movimientos.
- Los gastos viven en el Google Sheet del usuario.
- Los gastos offline de la web viven temporalmente en el dispositivo hasta sincronizarse.
- El backend de Telegram necesita conservar un refresh token cifrado para poder escribir en el Sheet cuando la web está cerrada.
- Foto y audio de la web se procesan localmente.


## Testing

Las pruebas automatizadas de foto, audio, categorización contextual y sesión Google están en:

- `tests/media-pipeline.test.mjs`
- `docs/testing-media.md`

El workflow de GitHub Pages ejecuta estas pruebas antes de publicar.
