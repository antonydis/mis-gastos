# Pruebas de Mis gastos

## Automatizadas

Desde la raíz: `npm test` y `npm run check`.

- media-pipeline: contratos de texto/foto/audio y clasificación contextual.
- telegram-flow: vinculación, escritura, deshacer y actualización del historial.
- operational: comportamiento con servicios simulados, CORS, errores de OAuth, fechas de Sheets, MIME de descargas Telegram y normalización de audios .oga/.ogg.
- records: ampliación de columnas sin mover filas antiguas, detalles pendientes, completar la misma fila, lotes sin escritura previa, confirmar/cancelar, confirmación repetida y español/inglés.

Los servicios externos se simulan en estas pruebas. Pasarlas no demuestra que cada recibo o extracto real se haya interpretado correctamente.

## Pruebas manuales antes de ampliar usuarios

1. Conectar dos usuarios diferentes; cada uno debe ver exclusivamente su hoja.
2. Usar CAD sin escribir moneda y una moneda extranjera explícita; conservar montos originales y no inventar conversiones.
3. Probar hoy/ayer alrededor de medianoche de Montreal, incluidos cambios estacionales.
4. Registrar un gasto por texto, foto y audio, revisar el resumen contra el original y usar Deshacer.
5. Omitir monto: debe preguntar antes de escribir. Omitir método de pago: puede guardar con datos pendientes, completables después.
6. Completar un registro y verificar que no apareció otra fila.
7. Enviar una imagen con dos recibos o una tabla de compras: revisar vista previa, cantidad y totales, cancelar y comprobar que no se guardó nada.
8. Repetir y confirmar una vez; pulsar de nuevo y comprobar que no duplica el lote.
9. Enviar PDF de extracto con compras, transferencias, ingresos, pagos de tarjeta y saldos. Revisar exclusiones y verificar cada compra antes de confirmar.
10. Probar un documento con más de 25 gastos y un PDF ilegible/protegido. No debe guardar una lista parcial silenciosamente; debe pedir dividir o aclarar.
11. Cambiar idioma en Ajustes y probar bienvenida, menú, registro, preguntas, importación y consultas en español e inglés.

## Límites de esta versión

Hasta 8 MB por imagen/PDF y 25 gastos por lote. Excel no se importa. Las categorías de la hoja son canónicas en español. Las consultas disponibles cubren el mes actual. Completar detalles existentes se hace por texto. Las importaciones requieren revisión humana, no son una conciliación bancaria automática.
