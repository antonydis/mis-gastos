# Cloudflare deployment

## Production Worker

Worker URL:

`https://mis-gastos.adiazsal.workers.dev`

The Worker entry point is:

`worker/src/index.js`

The root `wrangler.jsonc` is the canonical production configuration.

## Important

This repository contains both:

- the GitHub Pages frontend; and
- the Cloudflare Worker backend.

Cloudflare must deploy the Worker with:

```bash
npm install
npx wrangler deploy
```

It must **not** be configured as a static asset upload project. If the Cloudflare dashboard shows:

- Framework: Static
- Output Directory: .
- Upload static files

then that Cloudflare project was created with the wrong deployment mode.

## Correct Cloudflare setup

Create/connect a Workers project from the GitHub repository `antonydis/mis-gastos`.

Build configuration:

- Branch: `main`
- Root directory: repository root
- Build command: none required
- Deploy command: `npx wrangler deploy`

Wrangler reads the root `wrangler.jsonc` and deploys `worker/src/index.js`.

## D1

Binding:

- Variable: `DB`
- Database: `mis-gastos`
- Database ID: `dec384c0-85c5-4e78-a81b-4c51a244070d`

Initialize the database with `worker/schema.sql`.

## Required secrets

Configure these as Cloudflare Worker Secrets, never as plain repository variables:

- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `SETUP_SECRET`

## Health check

After a correct deployment:

`https://mis-gastos.adiazsal.workers.dev/health`

must return:

```json
{"ok":true,"service":"mis-gastos-api"}
```

## Telegram

Bot username:

`@missgastosya_bot`

Once the secrets and Google OAuth redirect URI are configured, initialize the webhook with:

`POST /admin/setup-webhook`

using the `X-Setup-Secret` header.
