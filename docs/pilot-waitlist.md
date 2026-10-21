# Lista de espera del piloto

La página principal contiene un formulario con nombre, email y consentimiento explícito. Envía solicitudes mediante `POST /pilot/waitlist` al Cloudflare Worker.

## Antes de habilitar públicamente

1. Configurar los siguientes **Worker Secrets** en Cloudflare (nunca en GitHub):
   - `RESEND_API_KEY`: clave de API de Resend con permiso para enviar.
   - `WAITLIST_FROM_EMAIL`: remitente perteneciente a un dominio verificado en Resend, por ejemplo `piloto@<dominio-verificado>`.
   - `WAITLIST_NOTIFY_EMAIL`: destinatario del aviso de cada alta.
2. Desplegar Worker con `npx wrangler deploy` y verificar que GitHub Pages publique el cambio de `index.html`.
3. Enviar una inscripción real con dirección propia y revisar (a) confirmación en pantalla, (b) nuevo registro en D1 `pilot_waitlist`, (c) correo recibido.
4. Revisar consentimiento, política de retención y método de eliminación de interesados antes de compartir el enlace a gran escala.

**Importante:** mientras falte cualquiera de las tres variables secretas, la API responde 503 y el formulario muestra un mensaje de error. Un commit no garantiza funcionamiento hasta completar este paso.

## Diseño y restricciones
- No se solicita teléfono; solo nombre, email y aceptación voluntaria para recibir noticias del piloto.
- D1 mantiene `email` como clave única, `name`, fecha de registro y fecha de notificación.
- Duplicados ya notificados no generan otra alerta.
- Sin compartir ni mezclar registros de interesados con gastos financieros.
- Honeypot básico anti-bots; antes de una campaña grande añadir Turnstile y un límite de solicitudes por IP.
- La casilla de consentimiento no se preselecciona. Borrar manualmente el registro a petición del titular.

## Ejemplo de prueba
```bash
curl -i https://mis-gastos.adiazsal.workers.dev/pilot/waitlist \
  -H 'Content-Type: application/json' \
  --data '{"name":"Prueba Piloto","email":"prueba@example.com","website":"","consent":true}'
```

No ejecutar este ejemplo con datos falsos en producción si el email real de notificación ya está configurado.