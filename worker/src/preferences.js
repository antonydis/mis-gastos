export async function preferences(userId,env){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS user_preferences (telegram_user_id TEXT PRIMARY KEY, language TEXT NOT NULL DEFAULT 'es')").bind().run();
  const current=await env.DB.prepare('SELECT language FROM user_preferences WHERE telegram_user_id=?').bind(userId).first();
  if(current?.language)return {language:current.language==='en'?'en':'es'};
  await env.DB.prepare('INSERT OR IGNORE INTO user_preferences(telegram_user_id,language) VALUES(?,?)').bind(userId,'es').run();
  // One-time migration of legacy Nicaragua defaults. Explicit later choices are preserved.
  await env.DB.prepare('UPDATE user_links SET currency=?,timezone=? WHERE telegram_user_id=?').bind('CAD','America/Toronto',userId).run();
  return {language:'es'};
}

export async function setLanguage(userId,language,env){
  if(!['es','en'].includes(language))throw new Error('Unsupported language');
  await env.DB.prepare('UPDATE user_preferences SET language=? WHERE telegram_user_id=?').bind(language,userId).run();
}
