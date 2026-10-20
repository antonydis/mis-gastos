# Puesta en marcha

## Experiencia

El bot ofrece bienvenida, conexión Google, menú Este mes/Categorías/Mi hoja/Ayuda/Moneda, registro por texto/foto/audio e imágenes o PDF adjuntos (máximo 8 MB). Excel todavía no se importa. Las consultas calculan el mes actual desde la hoja y separan monedas. Otros periodos no están implementados. La confirmación ofrece Ver hoja, Ver detalles y Corregir. Los resúmenes incluyen conteo y avisos de datos excluidos o monedas sin convertir. Deshacer está vinculado al último registro durante diez minutos.

## Configuración de producción

La configuración canónica es `wrangler.jsonc` en la raíz. Los scripts de `worker/package.json` apuntan explícitamente a ella. El antiguo `worker/wrangler.toml` no debe usarse.

1. Desde la raíz: `npm install`, `npm test`, `npm run deploy:worker`.
2. Inicializar D1: `npx wrangler d1 execute mis-gastos --remote --file=worker/schema.sql --config wrangler.jsonc`.
3. Verificar los secrets en Cloudflare: OPENAI_API_KEY, GOOGLE_CLIENT_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TOKEN_ENCRYPTION_KEY y SETUP_SECRET. Conservar la clave de cifrado existente para poder leer los vínculos guardados.
4. En el proyecto Google del Client ID: habilitar Drive API y Sheets API. Origen JavaScript: `https://antonydis.github.io`. Redirect URI: `https://mis-gastos.adiazsal.workers.dev/oauth/callback`. Si OAuth está en Testing, añadir usuarios de prueba y revisar la caducidad de tokens de ese modo.
5. Activar con POST `/admin/setup-webhook` y header X-Setup-Secret desde un entorno privado. Este paso también instala el menú de comandos. No publicar secrets.
6. Si Cloudflare usa Workers Builds: rama main, raíz del repositorio y deploy `npx wrangler deploy`. GitHub Pages no despliega el backend.

## Prueba real antes de invitar a la familia

- Abrir @missgastosya_bot y autorizar Google desde /start.
- Verificar la hoja, elegir moneda y registrar un gasto de prueba por texto, foto, audio y PDF. Comprobar filas y Deshacer.
- Comparar las consultas con las filas usando dos monedas.
- Conectar otra cuenta: su hoja y consultas deben quedar separadas.
- Probar /link, enlace vencido y /cancelar.

`npm test` incluye pruebas de comportamiento con servicios simulados: CORS, errores asíncronos, creación de Sheet, fechas, zona horaria, monedas, registro, consultas, menú y reconexión. La autorización real de Google y la entrega del webhook requieren la prueba anterior.

## Actualización de producto

CAD y America/Toronto son los valores iniciales; los perfiles anteriores se ajustan una sola vez, sin convertir sus gastos históricos. Idioma español/inglés en Ajustes. Las preferencias se crean automáticamente y su tabla figura en schema.sql.

Al próximo registro o consulta se simplifica Movimientos a ocho columnas visibles, preservando columnas históricas ocultas. Solo se retiran pestañas que coincidan con plantillas sin personalizar. Corregir modifica la misma fila, por texto o audio. /perfil cambia moneda y ciudad; se ofrece también al conectar una cuenta nueva. Los campos complementarios son opcionales y no generan pendientes. Imágenes con múltiples gastos y PDFs necesitan confirmación; límite 25 gastos/8 MB. Ver testing-media.md para las pruebas de extractos y exclusiones.

El cron de wrangler.jsonc corre cada cinco minutos para entregar avisos, y una vez por hora limpia estados temporales vencidos. Los estados de importación contienen datos financieros temporales hasta confirmación o limpieza; no son un historial permanente.

Los avisos requieren aceptación desde el onboarding o Ajustes → Recordatorios (/recordatorios). La tabla reminder_settings se crea automáticamente; no hay que ejecutar una migración manual para instalaciones existentes. Verificar en Cloudflare que el trigger */5 * * * * quedó activo después del despliegue. Probar con dos zonas horarias y con un aviso futuro; no se promete precisión menor de cinco minutos.

Al consultar o guardar se prepara Resumen con tablas/gráficas semanales y mensuales. El selector B3 mantiene las monedas separadas. La antigua plantilla Resúmenes no es la nueva pestaña funcional. No hace falta un secret ni una migración de D1 para esta función.
