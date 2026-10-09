# Pruebas de foto, audio, Telegram y sesión Google

Fecha: 2026-10-09

## Estado actual

### Web: foto de recibo

**Estado: integración automatizada OK; prueba física en móvil pendiente.**

Verificado:

1. El navegador captura/selecciona una imagen.
2. La web envía la imagen a `POST /ai/receipt`.
3. El Worker envía la imagen directamente a OpenAI Vision.
4. La respuesta usa un JSON Schema estricto con fecha, descripción, comercio, categoría, monto, moneda y método.
5. La API key de OpenAI no está en el frontend.
6. El usuario revisa la propuesta antes de guardar desde la web.

Prueba manual pendiente:

- Samsung/Android Chrome con foto real;
- iPhone/Safari;
- recibos con subtotal, impuestos, propina y total;
- baja luz o recibo inclinado.

### Web: audio

**Estado: integración automatizada OK; prueba física en móvil pendiente.**

Verificado:

1. La web solicita micrófono y graba con `MediaRecorder`.
2. Envía el archivo a `POST /ai/audio`.
3. El Worker transcribe con `gpt-4o-mini-transcribe`.
4. La transcripción pasa al modelo estructurador.
5. El usuario revisa la propuesta antes de guardar desde la web.

### Telegram

**Estado: flujo funcional implementado y cubierto por pruebas de contrato; E2E real pendiente de webhook/OAuth.**

Objetivo probado por código:

1. `/start` entrega **Conectar Google** si el usuario no está vinculado.
2. OAuth guarda una asociación persistente entre Telegram y el `spreadsheet_id`.
3. Google reutiliza el Sheet marcado `mis_gastos=v1`.
4. Texto se analiza con OpenAI.
5. Foto se descarga con Telegram `getFile` y se analiza con visión.
6. Audio/voice se descarga con Telegram `getFile`, se transcribe y estructura.
7. Si el resultado es claro, se escribe directamente en Google Sheets.
8. Si falta algo esencial, se conserva contexto temporal y se hace una pregunta.
9. El bot confirma después de guardar.

No hay confirmación obligatoria para cada gasto.

### Página / perfil

La página y Telegram usan el mismo Sheet como fuente de verdad.

Cuando la web ya tiene Google conectado, vuelve a leer el Sheet:

- al recuperar foco;
- al volver a la pestaña;
- cada 60 segundos mientras está visible.

Esto permite que un gasto registrado por Telegram aparezca después en el dashboard web.

## Regresión de categorización

Caso automatizado:

`Ayer gasté 2300 en supermercado y almorcé en La Loma donde me gasté 450`

Resultado esperado:

- 2300 NIO → Supermercado
- 450 NIO → Almuerzo
- Comercio: La Loma
- Categoría: Restaurantes

## Pruebas automatizadas

```bash
node tests/media-pipeline.test.mjs
node tests/telegram-flow.test.mjs
```

GitHub Actions ejecuta ambos conjuntos antes del deploy de Pages.

## Prueba E2E pendiente

Una vez activado el webhook de producción, ejecutar en `@missgastosya_bot`:

1. `/start`
2. conectar Google;
3. enviar texto;
4. verificar fila en Google Sheet;
5. enviar foto real de recibo;
6. verificar fila;
7. enviar voice note;
8. verificar fila;
9. abrir/volver a la web y verificar que los tres movimientos aparezcan.

Hasta completar esos pasos no se debe marcar Telegram como E2E verificado.
