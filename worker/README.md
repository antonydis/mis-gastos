# Telegram + Google Sheets

Backend de Cloudflare Worker para vincular una cuenta de Telegram con el Google Sheet `Mis gastos` del usuario.

## Objetivo del MVP

La primera vez:

1. El usuario abre `@missgastosya_bot`.
2. Envía `/start`.
3. Toca **Conectar Google**.
4. Autoriza Google una sola vez.
5. El Worker crea o reutiliza el único Sheet `Mis gastos` marcado con `mis_gastos=v1`.
6. Se guarda el vínculo `telegram_user_id → spreadsheet_id` junto con el refresh token de Google cifrado.

A partir de ahí no hay login repetido para registrar gastos.

## Registro diario desde Telegram

El usuario simplemente envía uno de estos tres formatos:

- texto: `450 en almuerzo en La Loma`;
- foto de un recibo;
- audio explicando uno o varios gastos.

Flujo:

`Telegram → Worker → OpenAI → Google Sheets`

- Texto usa OpenAI para estructurar el gasto.
- Foto usa visión para leer directamente el recibo.
- Audio usa `gpt-4o-mini-transcribe` y luego el modelo estructurador.
- Si el resultado es claro, el gasto se guarda automáticamente en el Sheet.
- Si falta un dato esencial o existe una ambigüedad real, el bot hace una sola pregunta antes de guardar.
- El bot confirma después de escribir en Google Sheets.

No hay botón obligatorio **Guardar** en el flujo normal.

## Web / perfil

La web y Telegram comparten el mismo Google Sheet.

Cuando la web está abierta con Google conectado:

- relee el Sheet al recuperar foco;
- relee al volver a la pestaña;
- refresca cada 60 segundos mientras está visible.

Por eso un gasto enviado desde Telegram aparece también en la página del usuario sin crear una segunda base de datos.

## Datos guardados en D1

D1 no almacena movimientos financieros.

Solo conserva:

- Telegram user/chat id;
- refresh token de Google cifrado;
- spreadsheet id;
- moneda y zona horaria;
- estados temporales de OAuth y aclaraciones.

Los gastos viven en Google Sheets.

## Secrets requeridos

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GOOGLE_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `SETUP_SECRET`

## OAuth Google

Redirect URI de producción:

`https://mis-gastos.adiazsal.workers.dev/oauth/callback`

## Activar webhook

Una vez configurados los secrets:

`POST https://mis-gastos.adiazsal.workers.dev/admin/setup-webhook`

Header:

`X-Setup-Secret: <SETUP_SECRET>`

## Pruebas

- `tests/media-pipeline.test.mjs`
- `tests/telegram-flow.test.mjs`
- `docs/testing-media.md`

Las pruebas de GitHub Actions verifican la arquitectura y regresiones antes de publicar. La cámara, el micrófono y el OAuth reales requieren además una prueba manual en dispositivo.
