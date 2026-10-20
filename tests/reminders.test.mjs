import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ensureReminders,runReminders,handleReminderCallback,recordActivity,reminderTimeFromText} from '../worker/src/reminders.js';
import {startProfile,handleProfileCallback,handleProfileText} from '../worker/src/profile.js';
import {translateMessage} from '../worker/src/i18n.js';

// Exercise the actual SQLite statements, including atomic claims, without Telegram or Google calls.
const dir=mkdtempSync(join(tmpdir(),'mis-gastos-reminders-')),file=join(dir,'test.sqlite');
const python=`import sqlite3,json,sys
p=json.load(sys.stdin)
c=sqlite3.connect(p['file'])
c.row_factory=sqlite3.Row
if p['kind']=='script':
 c.executescript(p['sql']); result={}
else:
 q=c.execute(p['sql'],p['args'])
 if p['kind']=='all': result={'results':[dict(r) for r in q.fetchall()]}
 elif p['kind']=='first':
  r=q.fetchone(); result=dict(r) if r else None
 else: result={'meta':{'changes':max(0,q.rowcount)}}
c.commit()
print(json.dumps(result))`;
function query(sql,args=[],kind='run'){
 const r=spawnSync('python3',['-c',python],{input:JSON.stringify({file,sql,args,kind}),encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr+'\n'+sql);
 return JSON.parse(r.stdout);
}
const env={DB:{prepare(sql){return{bind(...args){return{run:async()=>query(sql,args),first:async()=>query(sql,args,'first'),all:async()=>query(sql,args,'all')};}};}}};
const get=()=>query('SELECT * FROM reminder_settings WHERE telegram_user_id=?',['1'],'first');
const messages=[],send=async(chat,text,env,markup)=>messages.push({chat,text,language:env.BOT_LANGUAGE,markup});
const cb=data=>({from:{id:1},message:{chat:{id:1,type:'private'}},data});
const at=value=>new Date(value);
try{
 query(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'),[],'script');
 query("INSERT INTO user_links VALUES('1','1','token','sheet','CAD','America/Toronto',?)",[at('2026-10-18T12:00:00Z').getTime()]);
 query("INSERT INTO user_preferences VALUES('1','en')");
 await ensureReminders(env);
 // Initial profile has one confirmation, no country collection or language questionnaire.
 await startProfile('1',env,send);assert.match(messages.at(-1).text,/Moneda: CAD/);assert.ok(!messages.at(-1).text.includes('país'));
 await handleProfileCallback(cb('profile:keep'),env,send);assert.match(messages.at(-1).text,/recordatorio diario/);
 await runReminders(env,send,at('2026-10-19T23:00:00Z'));assert.equal(messages.length,2,'No opt-in, no scheduled messages');
 await handleProfileCallback(cb('profile:currency-menu'),env,send);
 await handleProfileCallback(cb('profile:currency:USD'),env,send);
 assert.match(messages.at(-1).text,/Moneda: USD/);
 await handleProfileCallback(cb('profile:other-city'),env,send);
 let pending=query("SELECT * FROM pending WHERE telegram_user_id='1'",[],'first');
 await handleProfileText('1','1','Vancouver',pending,env,send);
 assert.equal(query("SELECT timezone FROM user_links WHERE telegram_user_id='1'",[],'first').timezone,'America/Vancouver');
 await handleProfileCallback(cb('profile:other-city'),env,send);
 pending=query("SELECT * FROM pending WHERE telegram_user_id='1'",[],'first');
 await handleProfileText('1','1','Montreal',pending,env,send);
 assert.equal(query("SELECT currency FROM user_links WHERE telegram_user_id='1'",[],'first').currency,'USD','Changing local time must preserve currency');
 // Configuration cannot overwrite an unfinished expense/import.
 query("INSERT INTO pending VALUES('1','import','{\"nonce\":\"keep\"}',?)",[Date.now()+60000]);
 await handleReminderCallback(cb('reminder:write-time'),env,send);
 assert.match(messages.at(-1).text,/gasto pendiente/);
 assert.equal(query("SELECT kind FROM pending WHERE telegram_user_id='1'",[],'first').kind,'import');
 query("DELETE FROM pending WHERE telegram_user_id='1'");
 // Invalid time cannot enable or write an expense.
 await handleReminderCallback(cb('reminder:time:25:70'),env,send,at('2026-10-19T12:00:00Z'));assert.equal(get().enabled,0);
 await handleReminderCallback(cb('reminder:time:20:30'),env,send,at('2026-10-19T12:00:00Z'));assert.equal(get().enabled,1);
 let count=messages.length;
 await runReminders(env,send,at('2026-10-20T00:25:00Z'));assert.equal(messages.length,count,'Before 20:30 Montreal');
 await Promise.all([runReminders(env,send,at('2026-10-20T00:30:00Z')),runReminders(env,send,at('2026-10-20T00:30:00Z'))]);
 assert.equal(messages.length,count+1,'Concurrent scheduler ticks must claim only one daily message');
 assert.equal(messages.at(-1).language,'en');assert.match(translateMessage(messages.at(-1).text,'en'),/yesterday/);
 assert.equal(messages.at(-1).markup.inline_keyboard.flat().length,3);
 await runReminders(env,send,at('2026-10-20T00:35:00Z'));assert.equal(messages.length,count+1);
 // A requested snooze is the only extra message allowed the same day.
 await handleReminderCallback(cb('reminder:snooze:2026-10-19'),env,send,at('2026-10-20T00:35:00Z'));
 const due=get().snooze_until;
 await handleReminderCallback(cb('reminder:snooze:2026-10-19'),env,send,at('2026-10-20T00:40:00Z'));assert.equal(get().snooze_until,due);
 count=messages.length;
 await runReminders(env,send,at('2026-10-20T01:30:00Z'));assert.equal(messages.length,count);
 await runReminders(env,send,at('2026-10-20T01:35:00Z'));assert.equal(messages.length,count+1);
 await runReminders(env,send,at('2026-10-20T01:40:00Z'));assert.equal(messages.length,count+1);
 await handleReminderCallback(cb('reminder:reviewed:2026-10-19'),env,send,at('2026-10-20T01:45:00Z'));
 assert.equal(get().reviewed_day,'2026-10-19');assert.equal(get().snooze_until,0);
 const reviewTime=get().last_activity_at;
 await handleReminderCallback(cb('reminder:reviewed:2026-10-19'),env,send,at('2026-10-21T00:40:00Z'));assert.equal(get().last_activity_at,reviewTime,'Old buttons must not review a new day');
 // Saving a real expense today suppresses that day's reminder; optional details are irrelevant.
 await recordActivity('1','America/Toronto',[{date:'2026-10-20'}],env,at('2026-10-20T16:00:00Z'));
 count=messages.length;
 await runReminders(env,send,at('2026-10-21T00:30:00Z'));assert.equal(messages.length,count);
 // Silence uses the next daily reminder, with no independent 24-hour notification.
 await runReminders(env,send,at('2026-10-22T00:30:00Z'));assert.equal(messages.length,count+1);assert.match(messages.at(-1).text,/ayer/);
 await handleReminderCallback(cb('reminder:snooze:2026-10-21'),env,send,at('2026-10-22T00:35:00Z'));
 await handleReminderCallback(cb('reminder:off'),env,send,at('2026-10-22T00:40:00Z'));
 assert.equal(get().enabled,0);assert.equal(get().snooze_until,0);
 count=messages.length;
 await runReminders(env,send,at('2026-10-23T00:30:00Z'));assert.equal(messages.length,count);
 // Re-enabling after the chosen time starts tomorrow, not immediately.
 await handleReminderCallback(cb('reminder:on'),env,send,at('2026-10-23T01:00:00Z'));
 count=messages.length;
 await runReminders(env,send,at('2026-10-23T01:05:00Z'));assert.equal(messages.length,count);
 await handleReminderCallback(cb('reminder:write-time'),env,send,at('2026-10-23T02:00:00Z'));
 const link={timezone:'America/Toronto'};
 await reminderTimeFromText('1','1','8 pm',link,env,send,at('2026-10-23T02:00:00Z'));assert.equal(get().local_time,'20:30');
 await reminderTimeFromText('1','1','9:15',link,env,send,at('2026-10-23T02:00:00Z'));assert.equal(get().local_time,'09:15');
 // DST fall-back: repeated 01:30 gets only one automatic message.
 query("UPDATE reminder_settings SET local_time='01:30',reviewed_day='',last_sent_day='',snooze_until=0 WHERE telegram_user_id='1'");
 count=messages.length;
 await runReminders(env,send,at('2026-11-01T05:30:00Z'));
 await runReminders(env,send,at('2026-11-01T06:30:00Z'));assert.equal(messages.length,count+1);
 // Spring-forward: a skipped local 02:30 is delivered on the first later tick.
 query("UPDATE reminder_settings SET local_time='02:30',reviewed_day='',last_sent_day='' WHERE telegram_user_id='1'");
 count=messages.length;
 await runReminders(env,send,at('2027-03-14T06:55:00Z'));assert.equal(messages.length,count);
 await runReminders(env,send,at('2027-03-14T07:00:00Z'));assert.equal(messages.length,count+1);
 // A network error after reserving is not retried that day (delivery may be uncertain).
 query("UPDATE reminder_settings SET local_time='20:30',reviewed_day='',last_sent_day='' WHERE telegram_user_id='1'");
 let attempts=0;const quiet=console.error;console.error=()=>{};
 try{
  await runReminders(env,async()=>{attempts++;throw Error('uncertain network result');},at('2026-10-24T00:30:00Z'));
  await runReminders(env,async()=>{attempts++;},at('2026-10-24T00:35:00Z'));
 }finally{console.error=quiet;}
 assert.equal(attempts,1);
 // Another timezone must not be treated as Montreal's clock.
 query("INSERT INTO user_links VALUES('2','2','token','sheet2','CAD','America/Vancouver',0)");
 query("INSERT INTO reminder_settings(telegram_user_id,enabled) VALUES('2',1)");
 await runReminders(env,send,at('2026-10-25T00:30:00Z'));
 assert.equal(messages.filter(x=>x.chat==='2').length,0);
 await runReminders(env,send,at('2026-10-25T03:30:00Z'));
 assert.equal(messages.filter(x=>x.chat==='2').length,1);
 // Subscriber pagination must not strand users beyond the first 50 settings.
 query("WITH RECURSIVE n(x) AS (SELECT 100 UNION ALL SELECT x+1 FROM n WHERE x<154) INSERT INTO user_links SELECT CAST(x AS TEXT),CAST(x AS TEXT),'token','sheet','CAD','America/Toronto',0 FROM n");
 query("INSERT INTO reminder_settings(telegram_user_id,enabled,reviewed_day) SELECT telegram_user_id,1,'2026-10-25' FROM user_links WHERE telegram_user_id>='100' AND length(telegram_user_id)=3");
 query("INSERT INTO user_links VALUES('999','999','token','sheet999','CAD','America/Toronto',0)");
 query("INSERT INTO reminder_settings(telegram_user_id,enabled) VALUES('999',1)");
 await runReminders(env,send,at('2026-10-26T00:30:00Z'));
 assert.equal(messages.filter(x=>x.chat==='999').length,1);
 assert.equal(query('SELECT COUNT(*) AS n FROM processed_updates',[],'first').n,0,'Reminder actions do not fabricate expense/update records');
 console.log('OK: real SQLite reminder opt-in, local time, atomic daily cap, snooze, inactivity, no-spend review, pause, DST, failure deduplication and minimal profile.');
}finally{rmSync(dir,{recursive:true,force:true});}
