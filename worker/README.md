# Telegram + Google Sheets

Backend de Cloudflare Worker para vincular un chat privado de Telegram con el Google Sheet `Mis gastos` del usuario.

## Flujo

1. El usuario envía `/start` al bot.
2. El bot entrega un botón **Conectar Google**.
3. La web abre el OAuth del Worker.
4. Google entrega acceso offline al Worker.
5. El Worker crea o reutiliza `Mis gastos` en el Drive del usuario.
6. El usuario envía un gasto por Telegram.
7. El bot propone la interpretación y pide **Guardar** o **Corregir**.
8. Al confirmar, la fila se escribe directamente en Google Sheets.

## Datos que sí guarda D1

Solo lo mínimo para enlazar los sistemas:

- Telegram user/chat id
- refresh token de Google cifrado
- spreadsheet id
- moneda y zona horaria
- estados temporales de vinculación/confirmación

Los movimientos no se guardan en D1.

## Configuración

Crea una base D1 llamada `mis-gastos`, aplica `schema.sql` y pega su `database_id` en `wrangler.toml`.

Secrets requeridos:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `GOOGLE_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `SETUP_SECRET`

`TOKEN_ENCRYPTION_KEY` debe ser una clave aleatoria de 32 bytes codificada en base64.

En Google Cloud agrega como redirect URI:

`<PUBLIC_BASE_URL>/oauth/callback`

Después de desplegar, configura Telegram llamando una vez:

`POST <PUBLIC_BASE_URL>/admin/setup-webhook`

con header:

`X-Setup-Secret: <SETUP_SECRET>`

## Primera versión

Telegram soporta texto + aclaración + confirmación + escritura en Sheets. Foto y audio siguen funcionando en la web y se conectarán al backend de Telegram en una siguiente iteración.
