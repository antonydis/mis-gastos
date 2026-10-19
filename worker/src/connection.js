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

const englishErrors={
  'expired-link':'The link expired or has already been used. Send /link in Telegram.',
  'expired-state':'Authorization expired. Send /link in Telegram.',
  'no-refresh-token':'Google did not provide background access. Send /link and authorize again.',
  'missing-google-secret':'The server is missing its Google credentials. Your email is not the problem.',
  'google-encryption':'The server encryption key is missing or invalid. Your email is not the problem.',
  'oauth-client':'Google rejected the app credentials. The server configuration needs to be checked.',
  'oauth-code':'This authorization expired or was already used. Send /link again.',
  'drive-api-disabled':'Google Drive API must be enabled in the app’s Google Cloud project.',
  'sheets-api-disabled':'Google Sheets API must be enabled in the app’s Google Cloud project.',
  'drive-permission':'Google did not allow access to the app’s file. Check the granted permissions.',
  'sheets-permission':'Google did not allow the spreadsheet to be prepared. Check the granted permissions.',
  'google-exchange':'The exchange of Google permissions could not be completed.',
  'google-sheet':'Google authorized the connection, but the spreadsheet could not be prepared.',
  'google-save-link':'The Telegram link could not be saved. The server needs to be checked.'
};

export function connectionPage(url){
  const en=url.searchParams.get('lang')==='en';
  const linked=url.searchParams.get('telegram')==='linked';
  const input=url.searchParams.get('reason');
  const reason=Object.hasOwn(errors,input)?input:'oauth';
  const message=linked?'Tu hoja quedó conectada. Vuelve a Telegram para registrar un gasto o consultar tus totales.':(errors[reason]||'No se pudo completar la conexión. Envía /link en Telegram para intentarlo de nuevo.');
  const displayMessage=en?(linked?'Your spreadsheet is connected. Return to Telegram to add an expense or check your totals.':englishErrors[reason]||'The connection could not be completed. Send /link in Telegram.'):message;
  return new Response(`<!doctype html><html lang="${en?'en':'es'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mis gastos · Google</title><style>body{margin:0;background:#faf7ef;color:#172530;font:20px system-ui;line-height:1.5}main{max-width:560px;margin:10vh auto;padding:28px}h1{font-size:32px}a{display:inline-block;background:#286856;color:white;padding:14px 22px;border-radius:8px;text-decoration:none}small{display:block;margin-top:24px}</style><main><p>MIS GASTOS</p><h1>${en?(linked?'Google connected':'Connection could not be completed'):(linked?'Google conectado':'No se pudo completar la conexión')}</h1><p>${displayMessage}</p>${linked?'':`<small>${en?'Code':'Código'}: <strong>${reason}</strong></small>`}<p><a href="https://t.me/missgastosya_bot">${en?'Back to Telegram':'Volver a Telegram'}</a></p></main></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
}
