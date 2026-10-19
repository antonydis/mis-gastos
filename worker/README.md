# Backend de Mis gastos

Cloudflare Worker + D1. Configuración canónica: `../wrangler.jsonc`.

## Experiencia

- Telegram: texto, fotos, audio e imágenes/PDF adjuntos; CAD y Montreal por defecto.
- Español e inglés seleccionables en Ajustes.
- Cada usuario autoriza Google y utiliza su propio Sheet.
- Los registros incluyen frecuencia, fijo/variable, notas, viaje/proyecto y equivalente CAD explícito.
- Las consultas calculan el mes actual desde Sheets; no se mezclan monedas.
- Los datos complementarios se pueden completar después en la misma fila.
- Imágenes con varios gastos y PDFs: vista previa, totales y confirmación antes de escribir.
- Hasta 25 gastos por importación y 8 MB por imagen/PDF. Las exclusiones de extractos deben revisarse; no hay conciliación bancaria garantizada.

## Configuración

Secrets requeridos: OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY y SETUP_SECRET.

La clave de cifrado debe representar 32 bytes en base64/base64url. Mantenerla estable. Redirect URI Google: `https://mis-gastos.adiazsal.workers.dev/oauth/callback`.

```bash
npm run db:init:remote
npm run deploy
```

Para instalar el webhook y el menú de comandos: POST `/admin/setup-webhook` con X-Setup-Secret desde un entorno privado. No se eliminan mensajes pendientes de Telegram durante esa operación.

`/connection/check` valida la presencia/formato de la configuración sin exponer sus valores. `/health` indica disponibilidad del servicio; no prueba OAuth ni escritura real en Google.

D1 almacena vínculos, preferencias y estados temporales. No almacena un historial permanente de movimientos. Los lotes pendientes vencen en 30 minutos; un cron horario elimina los estados vencidos. Los gastos confirmados viven en Sheets.

Los comandos `/link`, `/cancelar`, `/pendientes`, `/idioma` y `/moneda` complementan el menú. Para completar un gasto guardado, el usuario responde por texto después de elegirlo en Pendientes.

Ver [README principal](../README.md) y [puesta en marcha](../docs/operational-checklist.md).
