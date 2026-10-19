import {encrypt} from './utils.js';

const errors = {
      "expired-link":"El enlace venció o ya se usó. Vuelve a Telegram y envía /link.",
      "expired-state":"La autorización venció. Vuelve a Telegram y envía /link.",
      "no-refresh-token":"Google no entregó el permiso necesario para guardar gastos cuando cierres esta página. Vuelve a Telegram y envía /link para autorizar de nuevo.",
      "missing-google-secret":"Falta configurar la conexión de Google en el servidor. No es un problema de tu correo.",
      "google-encryption":"La clave de protección del servidor falta o tiene un formato incorrecto. No es un problema de tu correo.",
      "oauth-client":"Google rechazó las credenciales de la aplicación. Hay que revisar la configuración del servidor.",
      "oauth-code":"Google rechazó una autorización vencida o ya utilizada. Vuelve a Telegram y envía /link.",
      "drive-api-disabled":"Google Drive API no está habilitada en el proyecto de la aplicación. Hay que activarla en Google Cloud.",
      "sheets-api-disabled":"Google Sheets API no está habilitada en el proyecto de la aplicación. Hay que activarla en Google Cloud.",
      "drive-permission":"Google no permitió buscar o preparar el archivo en Drive. Hay que revisar los permisos autorizados.",
      "sheets-permission":"Google no permitió crear o preparar la hoja. Hay que revisar los permisos autorizados.",
      "google-exchange":"No se pudo completar el intercambio de permisos con Google.",
      "google-sheet":"Google autorizó la conexión, pero no se pudo crear o preparar la hoja.",
      "google-save-link":"No se pudo guardar el vínculo entre Telegram y tu hoja. Hay que revisar el servidor."
    };

export async function connectionIssue(env){
  if(!env.GOOGLE_CLIENT_SECRET)return 'missing-google-secret';
  try{await encrypt('configuration-check',env.TOKEN_ENCRYPTION_KEY||'');}catch{return 'google-encryption';}
  return '';
}

export function connectionPage(url){
  const linked=url.searchParams.get('telegram')==='linked';
  const input=url.searchParams.get('reason');
  const reason=Object.hasOwn(errors,input)?input:'oauth';
  const message=linked?'Tu hoja quedó conectada. Vuelve a Telegram para registrar un gasto o consultar tus totales.':(errors[reason]||'No se pudo completar la conexión. Envía /link en Telegram para intentarlo de nuevo.');
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mis gastos · Google</title><style>body{margin:0;background:#faf7ef;color:#172530;font:20px system-ui;line-height:1.5}main{max-width:560px;margin:10vh auto;padding:28px}h1{font-size:32px}a{display:inline-block;background:#286856;color:white;padding:14px 22px;border-radius:8px;text-decoration:none}small{display:block;margin-top:24px}</style><main><p>MIS GASTOS</p><h1>${linked?'Google conectado':'No se pudo completar la conexión'}</h1><p>${message}</p>${linked?'':`<small>Código: <strong>${reason}</strong></small>`}<p><a href="https://t.me/missgastosya_bot">Volver a Telegram</a></p></main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
}
