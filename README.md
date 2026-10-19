# Mis gastos

Un bot para registrar y consultar gastos desde Telegram. Cada persona conecta su propia cuenta de Google; los movimientos se guardan en su Google Sheet, no en una base central de gastos.

## Valores por defecto

- Moneda: CAD (dólar canadiense).
- Zona horaria: America/Toronto, con la misma hora y cambios estacionales que Montréal.
- Idioma: español; inglés disponible desde Ajustes → Idioma.
- Los gastos explícitamente expresados en otra moneda conservan esa moneda. No se inventan tipos de cambio.

La primera interacción con esta versión migra los antiguos valores de perfil de Nicaragua a CAD/Montreal. Los movimientos históricos conservan sus monedas y montos. Una elección posterior de moneda desde Ajustes se respeta.

## Telegram

Bot: https://t.me/missgastosya_bot

1. Enviar `/start` y conectar Google una vez. El acceso está limitado a archivos de la aplicación (`drive.file`).
2. Enviar texto, una foto de un recibo o un audio, sin comandos especiales.
3. El bot pregunta si falta un monto o una descripción que permita identificar el gasto.
4. Un gasto individual claro se guarda y se confirma con todos los campos capturados y un enlace a la hoja.
5. Los datos complementarios pueden quedar pendientes: Completar ahora / Completar después.
6. Pendientes permite retomar un registro; completar modifica la misma fila sin duplicarla. La respuesta para completar datos es por texto.

Menú principal: Registrar gasto, Importar movimientos, Este mes, Categorías, Pendientes, Mi hoja y Ajustes. Moneda, idioma y ayuda están en Ajustes. También funcionan `/pendientes`, `/idioma`, `/moneda`, `/cancelar` y `/link`.

## Importar varios movimientos

Se admiten imágenes y PDFs de hasta 8 MB, con hasta 25 gastos por lote. Un recibo comercial se registra por su total, sin volver a contar cada producto. Una tabla de compras o varios recibos independientes genera una fila por gasto.

Los lotes de más de un gasto, los extractos identificados y todos los PDFs se muestran antes de guardar, con:

- detalle y número de gastos;
- totales separados por moneda;
- posibles repetidos por coincidencia de fecha, moneda y monto;
- cantidad y clases de movimientos excluidos.

Se necesita confirmar o cancelar. Una confirmación repetida del mismo lote no debe duplicar sus filas.

La extracción de extractos está configurada para omitir ingresos, reembolsos, transferencias entre cuentas, retiros de efectivo, pagos/abonos de tarjetas, saldos y totales. La interpretación puede equivocarse: la vista previa es necesaria y no garantiza una conciliación bancaria automática. Si hay más de 25 gastos, una respuesta incompleta o un archivo ilegible, se pide dividir o aclarar antes de guardar. Los archivos Excel todavía no se importan.

## Columnas de Movimientos

Las primeras diez columnas mantienen sus posiciones para conservar la compatibilidad con registros existentes. Se añaden columnas al siguiente registro o consulta, sin mover los datos anteriores:

ID, Fecha, Descripción, Comercio, Categoría, Monto original, Moneda, Método de pago, Fuente, Registrado, Frecuencia, Tipo (Fijo/Variable), Notas, Viaje/proyecto, Monto CAD, Estado y Datos pendientes.

El método de pago conserva el banco y tipo de tarjeta indicados; nunca se necesita un número completo de tarjeta. Monto CAD es igual al monto original para CAD. Para otras monedas queda vacío salvo que la persona proporcione un equivalente o una tasa explícita. No se asignan detalles ausentes a los registros antiguos.

## Consultas

Este mes y Categorías leen el Sheet real y calculan sus resultados mediante código. Las monedas se muestran separadas. Otros periodos y consultas arbitrarias aún no están implementados. La interfaz y las confirmaciones del bot están en español e inglés; las categorías y encabezados de Sheets mantienen su estructura canónica en español.

## Web

La web existente sigue en GitHub Pages. Conserva el registro de texto con reglas/modelo local y el servicio conectado para foto/audio. Telegram conecta directamente con el Worker para que una versión antigua de la web no bloquee OAuth. El motor local completo para Telegram y WhatsApp siguen siendo etapas futuras.

## Desarrollo y publicación

Configuración de producción: `wrangler.jsonc` en la raíz. `worker/wrangler.toml` es legado; los scripts de `worker/package.json` apuntan explícitamente al archivo de la raíz.

```bash
npm install
npm test
npm run deploy:worker
```

Cloudflare Workers Builds despliega desde main. GitHub Actions ejecuta pruebas y publica la web de Pages. Son dos publicaciones distintas.

Ver [puesta en marcha](docs/operational-checklist.md) y [despliegue](docs/cloudflare-deploy.md). Las preferencias de idioma se crean automáticamente; `worker/schema.sql` también contiene la tabla para instalaciones nuevas.

## Datos y límites

D1 conserva el vínculo Telegram/Google/Sheet, el refresh token cifrado, preferencias y estados temporales de aclaración/importación. Las importaciones pendientes contienen temporalmente los datos estructurados para poder confirmarlas. Esos estados vencen en 30 minutos y una limpieza programada elimina los vencidos cada hora. Los archivos originales no se archivan en el servidor. Los movimientos definitivos viven en el Sheet del usuario.

`TOKEN_ENCRYPTION_KEY` debe decodificar a 32 bytes. Cambiar una clave en uso exige reconectar las cuentas. Los secrets se configuran en Cloudflare y nunca se guardan en GitHub.

## Validación

`npm test` cubre contratos, CORS, OAuth, formatos de medios de Telegram, fechas, zonas horarias, monedas, columnas, conservación de filas antiguas, completar sin duplicar, importación con confirmación/cancelación y español/inglés, con servicios simulados. Los permisos reales de Google y la extracción de archivos concretos requieren pruebas de extremo a extremo.

## Repositorio privado

El backend del bot no exige que el repositorio sea público. Cloudflare debe mantener acceso al repositorio para futuras publicaciones. GitHub Pages desde un repositorio privado depende del plan de GitHub; con GitHub Free personal se requiere un repositorio público para Pages. El código privado y el acceso público al sitio son decisiones diferentes. Cambiar la visibilidad no privatiza una copia ya publicada ni sustituye los permisos de Google.
