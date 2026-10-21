import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// 実際のD1には接続せず、メモリ内で既存大会への移行を検証します。
const db=new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../migrations/0001_initial.sql",import.meta.url),"utf8"));
const insert=db.prepare("INSERT INTO contests (name,entry_start,entry_end,contest_start,contest_end,status) VALUES (?,'2026-10-26','2026-10-30','2026-11-02','2026-12-01','open')");
insert.run("既存大会");
db.exec(readFileSync(new URL("../migrations/0004_contest_prizes.sql",import.meta.url),"utf8"));
insert.run("次回大会");
for(const row of db.prepare("SELECT * FROM contests").all()){
  assert.equal(row.prize_1_name,"Amazonギフトカード");
  assert.equal(row.prize_1_amount,5000);
  assert.equal(row.prize_2_amount,3000);
  assert.equal(row.prize_3_amount,1000);
}
db.exec("UPDATE contests SET prize_1_name='図書カード',prize_1_amount=8000 WHERE id=2");
assert.equal(db.prepare("SELECT prize_1_amount FROM contests WHERE id=1").get().prize_1_amount,5000);
assert.equal(db.prepare("SELECT prize_1_name FROM contests WHERE id=2").get().prize_1_name,"図書カード");
for(const column of ["prize_1_amount","prize_2_amount","prize_3_amount"]){
  for(const value of [-1,1.5,"不正値",null]) assert.throws(()=>db.prepare(`UPDATE contests SET ${column}=? WHERE id=2`).run(value));
}
assert.throws(()=>db.exec("UPDATE contests SET prize_1_name='' WHERE id=2"));
db.close();
console.log("賞品マイグレーション：既存・新規大会の初期値、大会別変更、入力制約を確認しました。");
