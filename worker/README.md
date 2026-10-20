# Backend de Mis gastos

Cloudflare Worker + D1. Configuración canónica: `../wrangler.jsonc`.

## Experiencia

- Telegram: texto, fotos, audio e imágenes/PDF adjuntos; CAD y Montreal por defecto.
- Español e inglés seleccionables en Ajustes.
- Cada usuario autoriza Google y utiliza su propio Sheet.
- Hoja con ocho columnas visibles; metadatos y columnas antiguas ocultos para conservar los datos. Nuevas hojas con Movimientos y Resumen.
- Las consultas calculan total, cantidad y categoría principal del mes desde Sheets; no se mezclan monedas y se indican datos que afecten el cálculo.
- Corregir por texto/audio actualiza la misma fila. Los datos opcionales no producen preguntas ni pendientes.
- Primera conexión: confirmar moneda y hora local; cambiar solo si hace falta. Sin país ni preguntas personales. Idioma desde Ajustes.
- Recordatorios opcionales, hora elegible, revisión del día sin gasto cero, posposición de una hora y pausa desde Ajustes.
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

Los comandos `/link`, `/cancelar`, `/corregir`, `/perfil`, `/idioma` y `/moneda` complementan el menú. `/pendientes` y botones antiguos de completar ahora abren la corrección del gasto. El perfil utiliza currency/timezone de user_links y language de user_preferences. reminder_settings se crea automáticamente al usar el servicio y figura en schema.sql; guarda preferencias de avisos y marcas de actividad, no registros de gastos. /recordatorios abre la configuración.

Ver [README principal](../README.md) y [puesta en marcha](../docs/operational-checklist.md).

Los mensajes de Telegram son breves en español e inglés. La confirmación resume el gasto y ofrece Ver hoja, Ver detalles, Corregir y Deshacer según corresponda. Ver detalles vuelve a leer el Sheet; no conserva una copia de los gastos. Los botones antiguos del menú siguen funcionando.

El cron corre cada cinco minutos para recordatorios y conserva la limpieza horaria de estados vencidos. Los envíos usan la zona horaria del usuario y una reserva SQL atómica, con un máximo diario salvo posposición explícita. Se omite el día si ya se guardó un gasto de hoy o se marcó revisado. Ante un resultado de red incierto no se reintenta el aviso ese día.

Resumen incluye tablas y gráficas nativas por semana (lunes a domingo) y mes, con moneda seleccionable en B3. Las fórmulas siguen las ediciones y eliminaciones de Movimientos. sheet-summary.js comparte la creación entre web y bot; usa metadatos para evitar duplicar o sobrescribir pestañas personales.
