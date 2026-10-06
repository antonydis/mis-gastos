# Mis gastos

Un registro de gastos simple que guarda los datos en el Google Drive de cada persona.

## La idea

Registrar gastos no debería sentirse como llevar contabilidad. La persona escribe algo como:

> 850 en gasolina y 300 en café

La aplicación propone los movimientos, la persona confirma y listo.

## MVP

- Interfaz en español.
- Funciona primero en modo local para probar la experiencia.
- Con Google conectado, crea y usa un Google Sheet llamado **Mis gastos** en el Drive del usuario.
- No hay base de datos central de movimientos.
- Las frases sencillas se interpretan con reglas locales instantáneas.
- Si una frase necesita más interpretación, puede cargar un modelo abierto con WebLLM en el dispositivo.
- Sin API de IA y sin suscripción.

## Activar Google

La app está lista para recibir un OAuth Client ID.

1. Crea o selecciona un proyecto en Google Cloud.
2. Habilita **Google Sheets API** y **Google Drive API**.
3. Configura Google Auth Platform / OAuth.
4. Crea un cliente **Web application**.
5. Agrega como Authorized JavaScript origin:
   - `https://antonydis.github.io`
6. Mientras el proyecto esté en Testing, agrega las cuentas que harán la prueba.
7. Pega el Client ID en `config.js`.

No hace falta API key de Google ni una API key para un modelo.

La app solicita `https://www.googleapis.com/auth/drive.file`, que limita el acceso a archivos creados o usados por esta aplicación.

## Probar sin Google

Si `googleClientId` está vacío, la aplicación funciona en **modo de prueba local** y guarda los movimientos únicamente en el navegador de ese dispositivo.

Esto permite validar hoy:

- registro en lenguaje natural;
- confirmación antes de guardar;
- resumen del mes;
- categoría principal;
- últimos movimientos.

## Modelo local

El respaldo local usa WebLLM y se carga solamente cuando las reglas rápidas no pueden interpretar bien una frase.

Modelo inicial: `Qwen3-0.6B-q4f16_1-MLC`.

El primer uso del modelo puede requerir una descarga considerable. Por eso no se fuerza para frases simples.

## Próximas pruebas

1. Validar registro por texto con familia.
2. Agregar lectura local de facturas.
3. Agregar dictado/transcripción local.
4. Probar recordatorio diario.
5. Evaluar WhatsApp como canal adicional.

## Privacidad

- No existe una base de datos nuestra de gastos.
- En modo local, los datos viven en el navegador.
- Con Google, los movimientos viven en el Sheet del usuario.
- El modelo de respaldo corre en el dispositivo.
