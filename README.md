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
2. Al conectar una cuenta nueva basta confirmar moneda y hora local (CAD/Montreal por defecto). Solo se pide otra moneda o una ciudad si se quiere cambiar algo. No se pregunta país, nombre ni otros datos de perfil. El idioma se cambia en Ajustes. A continuación se ofrecen recordatorios opcionales; se puede saltar toda la configuración enviando un gasto.
3. Enviar texto, una foto o un audio, sin comandos. Solo se pregunta cuando falta monto, descripción o hay una ambigüedad esencial. Sin fecha se usa hoy en la zona del perfil; sin moneda se usa la del perfil.
4. La confirmación muestra monto, fecha, categoría y pago si se indicó. Ver detalles consulta los datos actuales de la hoja. Los datos complementarios no generan avisos de pendiente ni preguntas.
5. Corregir permite actualizar monto, moneda, fecha, descripción, comercio, categoría, pago o notas, en la misma fila. Se responde por texto o audio. Después de un gasto individual reciente también se reconoce «eran 15, no 50» o «fue con mi tarjeta RBC». En un lote o sin contexto reciente se elige el gasto. La corrección reciente tiene diez minutos de contexto; el botón del gasto y el menú funcionan después consultando el Sheet.
6. Las correcciones conservan el ID, origen y fecha de registro. Si cambia el monto o moneda de un gasto extranjero se descarta un equivalente CAD antiguo. Si falta el ID, está repetido o el registro cambió durante el análisis no se sobrescribe. Deshacer elimina el registro original, no restaura una versión anterior de una corrección; por eso la confirmación corregida no ofrece Deshacer.

Menú: Registrar gasto, Varios gastos, Este mes, Por categoría, Corregir gasto, Ver mi hoja y Ajustes. Perfil, Recordatorios, moneda, idioma y ayuda están en Ajustes. `/perfil` configura moneda y hora local; `/recordatorios` cambia los avisos; `/corregir` permite elegir entre los últimos ocho gastos. Los botones viejos y `/pendientes` siguen funcionando como acceso a corrección. `/cancelar` abandona preguntas o cambios sin borrar gastos. `/link` vuelve a autorizar Google sin cambiar un perfil existente.

## Recordatorios opcionales

- Desactivados hasta que la persona acepte. Se ofrece 20:30, horarios rápidos y cualquier hora HH:MM en formato de 24 horas.
- El aviso utiliza la zona horaria guardada; se puede cambiar desde Perfil. El Worker revisa cada cinco minutos, por lo que la entrega normal puede demorarse hasta cinco minutos respecto de la hora elegida.
- Un gasto guardado con fecha de hoy o «Hoy no gasté» marca el día como revisado y evita más avisos ese día. Esta última opción no escribe filas ni gastos de cero en Sheets.
- Si pasan 24 horas sin registrar/revisar, el siguiente aviso diario invita a completar gastos de ayer. No se añade otra notificación independiente.
- Máximo un aviso automático por día local. «Recordarme más tarde» permite otro dentro de una hora, por petición explícita; solo hay una posposición pendiente. Registrar un gasto o marcar el día revisado la cancela.
- Ajustes → Recordatorios permite cambiar hora, pausar o reactivar. Si la hora ya pasó al activar/cambiar, se empieza al día siguiente. Los botones de revisión/posposición de días anteriores no modifican el día actual.
- Se reserva el envío con una actualización atómica antes de llamar a Telegram. Ante una respuesta de red incierta no se reintenta ese día para evitar duplicados; los avisos son de mejor esfuerzo, no una alarma garantizada.

Las preferencias mínimas necesarias sí se conservan: moneda, zona horaria, idioma, activación/hora del aviso, última actividad, día revisado y control de envíos/posposición. No se guarda país ni un perfil personal adicional; los gastos definitivos permanecen en Google Sheets. La tabla reminder_settings se crea automáticamente en instalaciones existentes y también está en worker/schema.sql.

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

Los montos se muestran con dos decimales. Categoría y moneda ofrecen opciones; los montos no positivos y las opciones diferentes generan una advertencia sin bloquear datos históricos. Una fila representa un gasto, no una transferencia entre cuentas ni el pago de una tarjeta que repita compras ya registradas. El resumen muestra únicamente gastos registrados: no calcula saldo disponible, ingresos, ahorro ni patrimonio. Para cerrar un mes, revisar los movimientos contra los recibos y extractos, las fechas, monedas y posibles duplicados. Un comercio o pago sin indicar no invalida un gasto.

Para no desplazar ni perder datos anteriores, el formato físico A:Q se mantiene. ID, Fuente, Registrado, Monto CAD y las antiguas columnas de frecuencia, tipo, viaje, estado y pendientes quedan ocultos. La extracción nueva ya no solicita frecuencia ni fijo/variable; el viaje o proyecto mencionado va en Notas. Los valores históricos de columnas ocultas se conservan. No hay que borrar columnas manualmente.

Las hojas nuevas contienen Movimientos y Resumen. Las existentes se simplifican al siguiente registro o consulta. Registro diario y la antigua Resúmenes (plural) eran plantillas sin contenido generado por el bot; se retiran únicamente si siguen vacías o con sus encabezados originales. Categorías y Configuración tampoco alimentaban el bot: se retiran solo si coinciden con las plantillas iniciales sin personalizar. Una pestaña modificada se conserva.

El método de pago conserva el banco y tipo de tarjeta indicados; nunca se necesita un número completo. Monto CAD queda vacío para otra moneda salvo que se proporcione un equivalente o tasa explícita. No se inventa una conversión.

## Tablas y gráficas en Google Sheets

La pestaña **Resumen** (singular) combina dos gráficas de evolución semanal/mensual con dos tablas del mes elegido: categoría y medio de pago, ordenadas por monto, con porcentaje del total. B3 selecciona moneda; E3 selecciona mes (año-mes), con mes actual inicial y opciones automáticas desde las fechas registradas. El total mensual está en E4. Las gráficas muestran el historial de la moneda elegida; no se limitan al mes del selector. Los cálculos históricos de las gráficas se conservan en columnas ocultas I:O. Un pago o categoría sin indicar se agrupa en «Sin especificar». Solo se normalizan espacios y mayúsculas para agrupar: no se deduce que «Visa» y una tarjeta identificada sean la misma ni se modifican registros originales. La semana empieza el lunes; los meses conservan el año. El selector B3 elige moneda, con CAD inicial. Los montos originales se mantienen separados; no se utiliza una conversión supuesta.

Las fórmulas nativas leen Movimientos con rangos abiertos: al registrar, corregir o borrar gastos se recalculan las tablas y gráficas sin pedir un informe al bot. Se normalizan fechas ISO en texto y fechas numéricas de Sheets. Se excluyen fechas vacías/ilegibles y montos no numéricos o no positivos. Si no hay gastos válidos para la moneda elegida, se indica Sin gastos con total y cantidad cero solo en el resumen; no se crean movimientos.

El bot prepara esta pestaña en hojas existentes al consultar o guardar; la web comparte el mismo código. Su creación es idempotente, se amplía el espacio de cálculo cuando crece la hoja, y no se sobrescriben pestañas personales con el mismo nombre. Solo se añaden las gráficas tras leer la salida numérica de las fórmulas, porque Sheets puede descartar una serie aún vacía durante la creación. Si preparar el resumen falla, el registro del gasto puede seguir funcionando.

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

`npm test` requiere Node y Python 3 (solo para pruebas SQLite, sin dependencias adicionales). Cubre recordatorios con SQL real, concurrencia, posposición, pausas, cambios estacionales y perfil mínimo, además de contratos, CORS, OAuth, formatos de medios de Telegram, fechas, zonas horarias, monedas, columnas, conservación de filas antiguas, corrección por texto/audio sin duplicar, configuración del perfil y simplificación de la vista sin mover datos, importación con confirmación/cancelación y español/inglés, con servicios simulados. Los permisos reales de Google y la extracción de archivos concretos requieren pruebas de extremo a extremo.

## Repositorio privado

El backend del bot no exige que el repositorio sea público. Cloudflare debe mantener acceso al repositorio para futuras publicaciones. GitHub Pages desde un repositorio privado depende del plan de GitHub; con GitHub Free personal se requiere un repositorio público para Pages. El código privado y el acceso público al sitio son decisiones diferentes. Cambiar la visibilidad no privatiza una copia ya publicada ni sustituye los permisos de Google.
