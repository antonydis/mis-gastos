const phrases={
 '🧾 Registrar gasto':'🧾 Add an expense','📥 Importar movimientos':'📥 Import transactions','📊 Este mes':'📊 This month','🏷 Categorías':'🏷 Categories','📝 Pendientes':'📝 Missing details','📄 Mi hoja':'📄 My sheet','⚙️ Ajustes':'⚙️ Settings','💱 Moneda':'💱 Currency','❓ Ayuda':'❓ Help',
 'Conectar Google':'Connect Google','Volver a Telegram':'Back to Telegram','Deshacer':'Undo','Completar ahora':'Add details now','Completar después':'Add details later','Cancelar':'Cancel','Confirmar importación':'Confirm import',
 'Después de guardar verás todos los datos capturados. Usa /pendientes para completar información más adelante. Envíame un gasto por texto, una foto de un recibo, un PDF (máximo 8 MB) o un audio. Ejemplo: «Ayer gasté 25 CAD en supermercado». Guardo una fila por gasto y pregunto si falta algo esencial. También puedes consultar el mes, las categorías o abrir tu hoja. Usa /moneda CAD, USD, NIO, EUR, GTQ o MXN para elegir tu moneda; /cancelar para cancelar una aclaración; /link para volver a autorizar Google.':'Send an expense as text, a receipt photo or a voice message. For example: “Yesterday I spent 25 CAD on groceries”. I use Canadian dollars and Montreal time unless you specify otherwise. You will see all captured details after saving. Use Missing details to complete records later. Images or PDFs with multiple transactions are reviewed before saving. Use /cancelar to cancel a follow-up and /link to reconnect Google.',
 '¡Bienvenido a Mis gastos! Tu Google está conectado. ':'Welcome to Mis gastos! Your Google account is connected. ',
 '¡Bienvenido a Mis gastos! Conecta Google para crear tu hoja personal y guardar tus gastos allí. Después podrás enviar texto, fotos o audios y consultar tus totales. Solo accedemos a los archivos de esta aplicación. El enlace vence en 15 minutos; usa /link si necesitas otro.':'Welcome to Mis gastos! Connect Google to create your own spreadsheet. Then send expenses by text, photo or voice and ask about your totals. Defaults: CAD and Montreal time. We only access this app’s files. This link expires in 15 minutes; use /link for a new one.',
 'Guardado en Mis gastos:':'Saved in Mis gastos:',
 'Actualicé los mismos registros; no agregué filas.':'Updated the existing records; no new rows were added.',
 'Analizando el recibo…':'Reading your receipt…','Entendiendo tu audio…':'Listening to your voice message…',
 'No pude abrir tu conexión con Google. Usa /link para volver a conectarte.':'I could not open your Google connection. Use /link to reconnect.',
 'No pude confirmar el registro. Revisa tu hoja antes de reenviarlo para evitar duplicados. Si el problema continúa, usa /link para reconectar Google.':'I could not confirm the save. Check your sheet before sending it again to avoid duplicates. If it keeps failing, use /link to reconnect Google.',
 'No pude procesar el archivo; no llegué a guardarlo. Código: ':'I could not process the file; it was not saved. Code: ',
 '. Tu conexión con Google sigue configurada.':'. Your Google connection is still configured.',
 '¿Quieres completar los datos pendientes ahora? También puedes dejarlos para después.':'Would you like to add the missing details now? You can also do it later.',
 'No tienes gastos con datos pendientes.':'You have no expenses with missing details.',
 'Quedó guardado con los datos disponibles. Cuando quieras, envía /pendientes o completa los campos en Mi hoja.':'Saved with the available details. Use Missing details whenever you are ready, or edit the fields in My sheet.',
 'Quedó guardado. Puedes retomarlo con /pendientes cuando quieras.':'It is saved. Use Missing details whenever you want to finish it.',
 'Por ahora puedo resumir este mes y sus categorías. Usa los botones Este mes o Categorías.':'I can currently summarize this month and its categories. Use This month or Categories.',
 'Tu hoja: ':'Your sheet: ',
 'No pude consultar tu hoja. Intenta de nuevo o usa /link para reconectar Google.':'I could not read your sheet. Try again or use /link to reconnect Google.',
 'No pude consultar los pendientes. Intenta otra vez.':'I could not read the missing details. Please try again.',
 'No pude abrir ese gasto para completarlo. No hice cambios.':'I could not open that expense. No changes were made.',
 'Ese gasto ya no está en tu hoja.':'That expense is no longer in your sheet.',
 'Conecta Google con /link.':'Connect Google with /link.',
 'Tu Google ya no está conectado. Usa /link para volver a conectarlo.':'Google is no longer connected. Use /link to reconnect.',
 'Ese gasto ya no se puede deshacer desde aquí.':'That expense can no longer be undone here.',
 'Ese botón corresponde a otro gasto. Usa el botón del último registro.':'That button belongs to a different expense. Use the button on the latest record.',
 'Listo. Quité ese gasto de Mis gastos.':'Done. I removed that expense from Mis gastos.',
 'No encontré ese gasto en la hoja. No hice cambios.':'I could not find that expense in your sheet. No changes were made.',
 'No pude quitar ese gasto. No hice ningún cambio adicional.':'I could not remove that expense. No further changes were made.',
 'Para completar ese registro, responde por texto. Usa /cancelar si quieres registrar otro gasto por foto o audio.':'Reply with text to complete this record. Use /cancelar before sending another expense by photo or voice.',
 'No pude confirmar la actualización. Revisa tu hoja; no reenvíes el gasto como nuevo.':'I could not confirm the update. Check your sheet; do not resend it as a new expense.',
 'No pude completar el registro. Revisa tu hoja antes de reenviarlo o usa /link para reconectar Google.':'I could not complete the record. Check your sheet before sending it again, or use /link to reconnect Google.',
 'Aclaración cancelada. Los gastos ya guardados se conservan; puedes enviar otro gasto.':'Follow-up cancelled. Saved expenses are kept; you can send another expense.',
 'Envíame un gasto por texto, una foto del recibo o un audio.':'Send an expense by text, receipt photo or voice message.',
 'Envíame una foto o un PDF de hasta 8 MB. Los archivos Excel todavía no se importan.':'Send a photo or PDF up to 8 MB. Excel imports are not supported yet.',
 'El archivo supera 8 MB. Divídelo en archivos más pequeños.':'The file is larger than 8 MB. Split it into smaller files.',
 'Sin indicar':'Not provided','Por completar':'Missing','Sin conversión; no se estimó una tasa':'Not converted; no exchange rate was guessed',
 'Fecha: ':'Date: ','Categoría: ':'Category: ','Comercio: ':'Merchant: ','Pago: ':'Payment: ','Frecuencia: ':'Frequency: ','Tipo: ':'Type: ','Notas: ':'Notes: ','Viaje/proyecto: ':'Trip/project: ','Equivalente CAD: ':'CAD equivalent: ','Pendiente: ':'Missing: ',
 'método de pago':'payment method','frecuencia':'frequency','fijo o variable':'fixed or variable',
 'Moneda principal: ':'Default currency: ','. Si mencionas otra moneda en un gasto, la respetaré.':'. An explicitly stated currency will always be respected.',
 'Moneda actual: ':'Current currency: ','. Elige la moneda que usaré cuando no menciones ninguna:':'. Choose the currency to use when none is mentioned:',
 'Usa /moneda CAD, USD, NIO, EUR, GTQ o MXN.':'Use /moneda CAD, USD, NIO, EUR, GTQ or MXN.',
 'Elige tu idioma. Choose your language.':'Choose your language. Elige tu idioma.',
 'Idioma: Español.':'Language: Spanish.','Idioma: English.':'Language: English.',
 'Envía el gasto por texto, foto o audio. Por ejemplo: «Ayer gasté 25 CAD en supermercado, con tarjeta RBC».':'Send an expense by text, photo or voice. For example: “Yesterday I spent 25 CAD on groceries with my RBC card”.',
 'Envía una imagen o PDF de hasta 8 MB, con un máximo de 25 gastos. Revisarás la lista antes de guardar. No se importan ingresos, pagos de tarjeta, transferencias ni saldos.':'Send an image or PDF up to 8 MB containing at most 25 expenses. Review the list before saving. Income, credit card payments, transfers and balances are not imported.',
 '¿Qué quieres ajustar?':'What would you like to change?',
 'Importación cancelada. No se guardó ningún gasto.':'Import cancelled. No expenses were saved.',
 'Esta importación venció o ya se confirmó. Envía el archivo otra vez si no lo guardaste.':'This import expired or was already confirmed. Send it again if it was not saved.',
 'No pude confirmar la importación. Revisa tu hoja antes de volver a enviarla.':'I could not confirm the import. Check your sheet before sending it again.',
 'Revisa antes de guardar:':'Review before saving:',
 ' gastos detectados.':' expenses found.',
 'Todavía no se guardó nada.':'Nothing has been saved yet.',
 'Omitidos: ':'Excluded: ',
 'La lista quedó pendiente de confirmar. Usa los botones Confirmar importación o Cancelar.':'This list is waiting for confirmation. Use Confirm import or Cancel.',
 'Importación en curso; no pulses Confirmar otra vez.':'Import in progress; do not press Confirm again.',
 'Transacciones excluidas: ':'Excluded transactions: ',
 'Gastos de ':'Expenses for ','No hay gastos registrados este mes (':'No expenses recorded this month (',
 'Hay ':'There are ',' gastos con datos por completar. Elige uno de los últimos ':' expenses with missing details. Choose one of the latest ',
 '¿Cómo quieres completar ':'What details would you like to add to ',
 '? Falta: ':'? Missing: ',
 '. Ejemplo: «RBC crédito, gasto único y variable». Puedes responder por texto o enviar /cancelar.':'. Example: “RBC credit card, one-time, variable expense”. Reply with text or send /cancelar.',
 'puedes agregar notas o viaje/proyecto':'you can add notes or a trip/project',
 'No encontré un gasto claro. Indica qué compraste y cuánto pagaste, o envía un recibo legible.':'I could not identify an expense. Tell me what you bought and how much you paid, or send a readable receipt.',
 ' gastos':' expenses',
 '⚠ Posible repetido: hay un gasto con la misma fecha, moneda y monto. Revisa tu hoja antes de confirmar.':'⚠ Possible duplicate: an expense with the same date, currency and amount exists. Check your sheet before confirming.',
 'La importación es demasiado larga. Divide el documento en secciones de hasta 25 gastos.':'This import is too long. Split the document into sections of up to 25 expenses.',
 'No encontré gastos de consumo para importar. Transacciones excluidas: ':'No purchases were found to import. Excluded transactions: ',
};
const ordered=Object.entries(phrases).sort((a,b)=>b[0].length-a[0].length);
export function translateMessage(text,language='es'){
 if(language!=='en')return text;
 let result=String(text);
 // Replace matched UI phrases once; never translate arbitrary stored descriptions or merchants.
 const keys=ordered.map(([key])=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 result=result.replace(new RegExp(keys.join('|'),'g'),match=>phrases[match]);
 const categories={Supermercado:'Groceries',Restaurantes:'Restaurants',Transporte:'Transport',Gasolina:'Gas',Casa:'Home',Salud:'Health',Servicios:'Utilities',Suscripciones:'Subscriptions',Compras:'Shopping','Cuidado personal':'Personal care',Entretenimiento:'Entertainment',Educación:'Education',Viajes:'Travel',Familia:'Family',Construcción:'Construction',Otros:'Other'};
 result=result.replace(/(Category: )([^\n]+)/g,(_,label,value)=>label+(categories[value]||value));
 result=result.replace(/Frequency: Único/g,'Frequency: One-time').replace(/Type: Fijo/g,'Type: Fixed').replace(/Type: Variable/g,'Type: Variable');
 return result;
}
export function translateMarkup(markup,language){
 if(!markup)return markup;
 return JSON.parse(JSON.stringify(markup),(key,value)=>key==='text'&&typeof value==='string'?translateMessage(value,language):value);
}
export function normalizeMenu(text){
 const reverse=Object.fromEntries(Object.entries(phrases).filter(([key])=>/^\p{Extended_Pictographic}/u.test(key)).map(([key,value])=>[value,key]));
 return reverse[text]||text;
}
