import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function load(path){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(id)=>id==='../src/contestSchedule'?load('../src/contestSchedule.ts'):require(id),Request,Response,URL,Date,console,crypto});return exports;}
const worker=load('../worker/index.ts').default;
const db=new DatabaseSync(':memory:');
for(const name of ['0001_initial.sql','0002_price_imports.sql','0003_contest_stocks.sql','0004_contest_prizes.sql']) db.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
const env={DB:{prepare(sql){
  let values=[];
  return {
    bind(...args){values=args;return this},
    async first(){return db.prepare(sql).get(...values)??null},
    async all(){return {results:db.prepare(sql).all(...values)}}
  };
}}};
const get=async(path)=>{const response=await worker.fetch(new Request(`https://test.example${path}`),env);assert.equal(response.status,200);return response.json()};
for(const id of [1,2,3]) db.prepare("INSERT INTO contests(id,name,entry_start,entry_end,contest_start,contest_end,status) VALUES (?,?, '2020-01-01','2099-12-31','2026-01-01','2099-12-31',?)").run(id,`大会${id}`,id===3?'draft':'open');
for(let i=1;i<=6;i++) db.prepare("INSERT INTO stocks(code,company_name) VALUES (?,?)").run(`100${i}`,`銘柄${i}`);
db.exec("INSERT INTO contest_stocks(contest_id,stock_code,source_date) SELECT 1,code,'2026-01-01' FROM stocks WHERE code!='1006'; INSERT INTO contest_stocks(contest_id,stock_code,source_date) SELECT 2,code,'2026-01-01' FROM stocks WHERE code!='1001'");
for(const [id,contest,rate] of [[1,1,20],[2,2,10],[3,2,0]]){
  db.prepare("INSERT INTO entries(id,contest_id,entry_public_id,email,nickname,index_name) VALUES (?,?,?,'test@example.com',?,?)").run(id,contest,`ENTRY${id}`,`参加者${id}`,`指数${id}`);
  db.prepare('INSERT INTO entry_stocks(entry_id,stock_code,weight) SELECT ?,stock_code,20 FROM contest_stocks WHERE contest_id=?').run(id,contest);
  db.prepare("INSERT INTO index_daily_values(entry_id,date,index_value,return_rate,rank) VALUES (?,'2026-10-20',?,?,99)").run(id,100+rate,rate);
}
db.exec("INSERT INTO index_daily_values(entry_id,date,index_value,return_rate,rank) VALUES (1,'2026-10-21',125,25,1)");
db.exec(readFileSync(new URL('../migrations/0005_contest_rank_scope.sql',import.meta.url),'utf8'));
assert.equal((await get('/api/contest')).contest.id,2);
const stocks=await get('/api/stocks');assert.equal(stocks.items.length,5);assert.ok(stocks.items.every(s=>s.code!=='1001'));
const ranking=await get('/api/rankings');assert.equal(ranking.asOf,'2026-10-20');assert.deepEqual(ranking.items.map(x=>[x.entryPublicId,x.rank]),[['ENTRY2',1],['ENTRY3',2]]);assert.equal(ranking.totalPages,1);
assert.equal(db.prepare("SELECT rank FROM index_daily_values WHERE entry_id=1 AND date='2026-10-20'").get().rank,1);
const response=await worker.fetch(new Request('https://test.example/api/entries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contestId:1,email:'a@example.com',emailConfirm:'a@example.com',nickname:'テスト',indexName:'指数',stocks:['1002','1003','1004','1005','1006'].map(code=>({code,weight:20}))})}),env);
assert.equal(response.status,409);assert.match((await response.json()).error,/大会が切り替わりました/);
db.exec("UPDATE contests SET status='open' WHERE id=3");
assert.equal((await get('/api/contest')).contest.id,3);
assert.equal((await get('/api/stocks')).items.length,0);
const empty=await get('/api/rankings');assert.deepEqual(empty.items,[]);assert.equal(empty.asOf,null);
db.exec("UPDATE contests SET status='finished'");
assert.equal((await get('/api/contest')).contest,null);assert.equal((await get('/api/rankings')).items.length,0);
assert.equal(db.prepare('SELECT COUNT(*) n FROM entries').get().n,3);
db.close();console.log('大会切替：銘柄・最新日・順位・空大会・終了状態・旧大会への送信拒否・過去データ保持を確認しました。');
