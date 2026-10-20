# Pruebas de Mis gastos

## Automatizadas

Desde la raíz: `npm test` y `npm run check`.

- media-pipeline: contratos de texto/foto/audio y clasificación contextual.
- telegram-flow: vinculación, escritura, deshacer y actualización del historial.
- operational: comportamiento con servicios simulados, CORS, errores de OAuth, fechas de Sheets, MIME de descargas Telegram y normalización de audios .oga/.ogg.
- product: resúmenes con conteos, zona horaria, exclusiones y monedas; perfil país/moneda/ciudad; simplificación conservadora de pestañas; corrección de ID, filas vacías, escritura RAW y protección de cambios concurrentes.
- records: vista simplificada sin mover filas antiguas, corrección por texto/audio en la misma fila, lotes sin escritura previa, confirmar/cancelar, confirmación repetida y español/inglés.

Los servicios externos se simulan en estas pruebas. Pasarlas no demuestra que cada recibo o extracto real se haya interpretado correctamente.

## Pruebas manuales antes de ampliar usuarios

1. Conectar dos usuarios diferentes; cada uno debe ver exclusivamente su hoja.
2. Usar CAD sin escribir moneda y una moneda extranjera explícita; conservar montos originales y no inventar conversiones.
3. Probar hoy/ayer alrededor de medianoche de Montreal, incluidos cambios estacionales.
4. Registrar un gasto por texto, foto y audio, revisar el resumen contra el original y usar Deshacer.
5. Omitir monto: debe preguntar antes de escribir. Omitir fecha/moneda: usar hoy/moneda del perfil. Omitir pago, comercio o notas: guardar sin pedirlos.
6. Corregir un monto y una tarjeta por texto/audio, con botón y con frase directa; verificar que conserva ID y no aparece otra fila. En un lote elegir cuál; borrar una fila manualmente y comprobar que no se recrea al corregir.
7. Enviar una imagen con dos recibos o una tabla de compras: revisar vista previa, cantidad y totales, cancelar y comprobar que no se guardó nada.
8. Repetir y confirmar una vez; pulsar de nuevo y comprobar que no duplica el lote.
9. Enviar PDF de extracto con compras, transferencias, ingresos, pagos de tarjeta y saldos. Revisar exclusiones y verificar cada compra antes de confirmar.
10. Probar un documento con más de 25 gastos y un PDF ilegible/protegido. No debe guardar una lista parcial silenciosamente; debe pedir dividir o aclarar.
11. Cambiar idioma en Ajustes y probar bienvenida, menú, registro, preguntas, importación y consultas en español e inglés.

12. Configurar Canadá/Vancouver y Nicaragua/USD/Managua; verificar que moneda/fecha siguen el perfil y que /link no lo restablece. Probar otra ciudad y perfil vencido.
13. Consultar una hoja antigua: ocho columnas visibles, datos ocultos intactos. Las pestañas personalizadas deben conservarse. Las nuevas hojas solo contienen Movimientos.

## Límites de esta versión

Hasta 8 MB por imagen/PDF y 25 gastos por lote. Excel no se importa. Las categorías de la hoja son canónicas en español. Las consultas disponibles cubren el mes actual. Las correcciones aceptan texto y audio. Las importaciones requieren revisión humana, no son una conciliación bancaria automática.
