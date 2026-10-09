# Pruebas de foto, audio y sesión Google

Fecha: 2026-10-09

## Resultado actual

### Foto de recibo

**Estado: integración automatizada OK; prueba física en móvil pendiente.**

Verificado automáticamente:

1. El input acepta imágenes y solicita cámara trasera cuando el navegador lo permite.
2. La imagen pasa por Tesseract.js en el dispositivo.
3. El texto OCR se envía a `processNaturalInput(..., "Foto", true)`.
4. Foto utiliza la misma pantalla de aclaración y confirmación que el texto.
5. No existe una subida de la imagen a nuestra base de datos.

Qué falta validar en dispositivo real:

- Samsung/Android Chrome: abrir cámara, tomar foto real y confirmar que Tesseract descarga/carga correctamente.
- iPhone/Safari: selección/cámara y memoria disponible.
- recibos con total, subtotal, impuestos y cambio;
- baja luz, recibo inclinado y texto pequeño.

Criterio de aceptación manual:

> Foto de un recibo → comercio/total/fecha razonables → categoría propuesta → usuario puede corregir → Guardar → fila aparece en el mismo Google Sheet.

### Hablar

**Estado: integración automatizada OK; prueba física en móvil pendiente.**

Verificado automáticamente:

1. Se solicita micrófono con `getUserMedia`.
2. La grabación usa `MediaRecorder`.
3. El audio se decodifica y convierte a mono/16 kHz.
4. Transformers.js carga un pipeline de speech-to-text.
5. El modelo inicial es `onnx-community/whisper-tiny`.
6. La transcripción se envía a `processNaturalInput(..., "Audio", true)`.
7. Audio utiliza la misma pantalla de aclaración y confirmación que texto/foto.

Qué falta validar en dispositivo real:

- formato que produce MediaRecorder en Samsung Chrome;
- soporte de `decodeAudioData` para ese formato;
- permisos y formato en Safari/iPhone;
- primera descarga de Whisper y consumo de memoria;
- español con ruido ambiente y nombres de comercios locales.

Criterio de aceptación manual:

> Tocar Hablar → dictar uno o varios gastos → Terminar audio → transcripción razonable → gastos propuestos correctamente → Guardar → filas aparecen en el mismo Google Sheet.

## Regresión de categorización

Caso probado:

`Ayer gasté 2300 en supermercado y almorcé en La Loma donde me gasté 450`

Resultado esperado y automatizado:

- 2300 NIO → Supermercado
- 450 NIO → Descripción: Almuerzo
- Comercio: La Loma
- Categoría: Restaurantes

## Sesión Google / varios dispositivos

La fuente de verdad es el Google Sheet marcado internamente con `mis_gastos=v1`.

Al conectar la misma cuenta Google desde otro dispositivo:

1. la aplicación busca el Sheet ya marcado;
2. no crea otro mientras el original siga accesible;
3. lee `Movimientos` desde ese Sheet;
4. reconstruye dashboard y últimos movimientos;
5. web y Telegram pueden escribir en el mismo `spreadsheet_id`.

En un dispositivo previamente conectado, la web intenta reconexión silenciosa. Si Google exige interacción o el navegador bloquea esa solicitud, se muestra **Continuar con Google**. En un dispositivo nuevo siempre puede ser necesario seleccionar/autorizar la cuenta al menos una vez.

## Comando de prueba

```bash
node tests/media-pipeline.test.mjs
```

Estas pruebas no sustituyen cámara/micrófono reales. El estado no debe promoverse a “E2E móvil verificado” hasta completar los casos manuales anteriores.
