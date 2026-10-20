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

1. Enviar `/start` y conectar Google. El acceso está limitado a archivos de la aplicación (`drive.file`).
2. Al conectar una cuenta nueva se ofrece país, ciudad y moneda habitual, con un atajo Montreal/CAD. El país propone la moneda; se puede cambiar. Se confirma el idioma. Es opcional: enviar un gasto directamente usa los valores iniciales.
3. Enviar texto, una foto o un audio, sin comandos. Solo se pregunta cuando falta monto, descripción o hay una ambigüedad esencial. Sin fecha se usa hoy en la zona del perfil; sin moneda se usa la del perfil.
4. La confirmación muestra monto, fecha, categoría y pago si se indicó. Ver detalles consulta los datos actuales de la hoja. Los datos complementarios no generan avisos de pendiente ni preguntas.
5. Corregir permite actualizar monto, moneda, fecha, descripción, comercio, categoría, pago o notas, en la misma fila. Se responde por texto o audio. Después de un gasto individual reciente también se reconoce «eran 15, no 50» o «fue con mi tarjeta RBC». En un lote o sin contexto reciente se elige el gasto. La corrección reciente tiene diez minutos de contexto; el botón del gasto y el menú funcionan después consultando el Sheet.
6. Las correcciones conservan el ID, origen y fecha de registro. Si cambia el monto o moneda de un gasto extranjero se descarta un equivalente CAD antiguo. Si falta el ID, está repetido o el registro cambió durante el análisis no se sobrescribe. Deshacer elimina el registro original, no restaura una versión anterior de una corrección; por eso la confirmación corregida no ofrece Deshacer.

Menú: Registrar gasto, Varios gastos, Este mes, Por categoría, Corregir gasto, Ver mi hoja y Ajustes. Perfil, moneda, idioma y ayuda están en Ajustes. `/perfil` configura la ubicación; `/corregir` permite elegir entre los últimos ocho gastos. Los botones viejos y `/pendientes` siguen funcionando como acceso a corrección. `/cancelar` abandona preguntas o cambios sin borrar gastos. `/link` vuelve a autorizar Google sin cambiar un perfil existente.

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

La vista cotidiana tiene ocho columnas: **Fecha, Descripción, Comercio, Categoría, Monto, Moneda, Pago y Notas**. Pago, comercio y notas son opcionales. Se fija el encabezado, se ajustan los anchos y se añade un filtro.

Para no desplazar ni perder datos anteriores, el formato físico A:Q se mantiene. ID, Fuente, Registrado, Monto CAD y las antiguas columnas de frecuencia, tipo, viaje, estado y pendientes quedan ocultos. La extracción nueva ya no solicita frecuencia ni fijo/variable; el viaje o proyecto mencionado va en Notas. Los valores históricos de columnas ocultas se conservan. No hay que borrar columnas manualmente.

Las hojas nuevas contienen solo Movimientos. Las existentes se simplifican al siguiente registro o consulta. Registro diario y Resúmenes eran plantillas sin contenido generado por el bot; se retiran únicamente si siguen vacías o con sus encabezados originales. Categorías y Configuración tampoco alimentaban el bot: se retiran solo si coinciden con las plantillas iniciales sin personalizar. Una pestaña modificada se conserva.

El método de pago conserva el banco y tipo de tarjeta indicados; nunca se necesita un número completo. Monto CAD queda vacío para otra moneda salvo que se proporcione un equivalente o tasa explícita. No se inventa una conversión.

## Consultas

Este mes y Por categoría leen el Sheet real y calculan sus resultados mediante código. Incluyen total, número de gastos y categoría principal por moneda. Las monedas se muestran separadas, sin sumarlas. Se avisa de conversiones ausentes, gastos en Otros incluidos, filas del mes con monto/moneda inválidos excluidas y filas sin fecha que no pueden asignarse a un mes. Otros periodos y consultas arbitrarias aún no están implementados. La interfaz y las confirmaciones del bot están en español e inglés; las categorías y encabezados de Sheets mantienen su estructura canónica en español.

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

D1 conserva el vínculo Telegram/Google/Sheet, el refresh token cifrado, preferencias y estados temporales de aclaración, corrección, configuración e importación. Las importaciones pendientes contienen temporalmente los datos estructurados para poder confirmarlas. Esos estados vencen en 30 minutos y una limpieza programada elimina los vencidos cada hora. Los archivos originales no se archivan en el servidor. Los movimientos definitivos viven en el Sheet del usuario.

`TOKEN_ENCRYPTION_KEY` debe decodificar a 32 bytes. Cambiar una clave en uso exige reconectar las cuentas. Los secrets se configuran en Cloudflare y nunca se guardan en GitHub.

## Validación

`npm test` cubre contratos, CORS, OAuth, formatos de medios de Telegram, fechas, zonas horarias, monedas, columnas, conservación de filas antiguas, corrección por texto/audio sin duplicar, configuración del perfil y simplificación de la vista sin mover datos, importación con confirmación/cancelación y español/inglés, con servicios simulados. Los permisos reales de Google y la extracción de archivos concretos requieren pruebas de extremo a extremo.

## Repositorio privado

El backend del bot no exige que el repositorio sea público. Cloudflare debe mantener acceso al repositorio para futuras publicaciones. GitHub Pages desde un repositorio privado depende del plan de GitHub; con GitHub Free personal se requiere un repositorio público para Pages. El código privado y el acceso público al sitio son decisiones diferentes. Cambiar la visibilidad no privatiza una copia ya publicada ni sustituye los permisos de Google.
