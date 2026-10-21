import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source=readFileSync(new URL("../src/contestSchedule.ts",import.meta.url),"utf8");
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const context={exports:{}};
runInNewContext(output,context);
const {entryWindow}=context.exports;
const contest={entryStart:"2026-10-26",entryEnd:"2026-10-30",status:"open"};
for(const [instant,expected] of [
  ["2026-10-25T14:59:59.999Z","upcoming"],
  ["2026-10-25T15:00:00.000Z","open"],
  ["2026-10-30T14:59:59.999Z","open"],
  ["2026-10-30T15:00:00.000Z","closed"],
]) assert.equal(entryWindow(contest,Date.parse(instant)).state,expected,instant);
assert.equal(entryWindow({...contest,status:"running"},Date.parse("2026-10-27T00:00:00Z")).open,false);
assert.equal(entryWindow(null,Date.now()).open,false);
assert.equal(entryWindow({...contest,entryStart:"invalid"},Date.now()).open,false);
assert.equal(entryWindow({...contest,entryStart:"2026-11-01"},Date.now()).open,false);
assert.equal(entryWindow({entryStart:"2026-10-30",entryEnd:"2026-10-30",status:"open"},Date.parse("2026-10-30T14:59:59Z")).open,true);
console.log("日本時間の開始・締切境界、受付停止、大会なし、不正日程：9ケース成功");
