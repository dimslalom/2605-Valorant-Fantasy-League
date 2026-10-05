import test from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './helpers/d1Shim.js';
import { handleAccounts } from '../apps/call/worker/accounts.js';
import { slateDay } from '../apps/call/src/lib/bingoSlate.js';

const call=(env,method,path,body,cookie)=>{
  const url=new URL(`https://x.test${path}`);
  return handleAccounts(new Request(url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined}),env,url);
};
test('historical daily bingo remains readable but cannot be edited',async()=>{
  const env={DB:d1()},day=slateDay(Math.floor(Date.now()/1000));
  const signup=await call(env,'POST','/api/auth/signup',{username:'daily_reader',password:'correct horse'});
  const cookie=signup.headers.get('Set-Cookie').split(';')[0];
  const userId=env.DB.sqlite.prepare("SELECT id FROM users WHERE username='daily_reader'").get().id;
  const cells=[{square:'ace',matchId:1},{square:'ot',matchId:1},{square:'k30',matchId:2},{square:'c3',matchId:2}];
  env.DB.sqlite.prepare('INSERT INTO bingo_cards(user_id,day,slot,cells,version,updated_at) VALUES(?,?,1,?,1,0)').run(userId,day,JSON.stringify(cells));
  const read=await call(env,'GET',`/api/bingo?day=${day}`,null,cookie);
  assert.equal(read.status,200);
  assert.deepEqual((await read.json()).cards[0].cells,cells);
  assert.equal(await call(env,'PUT','/api/bingo',{day,slot:1,cells,version:1},cookie),null);
  assert.equal((await call(env,'GET',`/api/bingo?day=${day}`)).status,401);
});
