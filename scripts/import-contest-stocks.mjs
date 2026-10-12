import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const csvArgument = process.argv[3];

if (!["check", "local", "remote"].includes(mode) || !csvArgument) {
  console.error("使い方: node scripts/import-contest-stocks.mjs <check|local|remote> <CSVファイル>");
  process.exit(1);
}

const csvPath = resolve(process.cwd(), csvArgument);
const fileName = basename(csvPath);
const dateMatch = fileName.match(/(20\d{2})(\d{2})(\d{2})/);
if (!dateMatch) {
  console.error("ファイル名から基準日を判定できません。例: stq_20260923.csv");
  process.exit(1);
}
const sourceDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
const records = parseCsv(readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""));
if (records.length < 2) {
  console.error("CSVにデータ行がありません。");
  process.exit(1);
}

const headers = records[0];
const required = ["コード", "銘柄名", "市場"];
for (const column of required) {
  if (!headers.includes(column)) {
    console.error(`必須列がありません: ${column}`);
    process.exit(1);
  }
}
const index = Object.fromEntries(headers.map((header, position) => [header, position]));
const stocks = [];
const errors = [];
const seen = new Set();
for (let rowIndex = 1; rowIndex < records.length; rowIndex++) {
  const row = records[rowIndex];
  if (row.every((value) => value.trim() === "")) continue;
  const code = (row[index["コード"]] || "").trim().toUpperCase();
  const name = (row[index["銘柄名"]] || "").trim();
  const market = (row[index["市場"]] || "").trim();
  if (!/^[0-9A-Z]{4}$/.test(code) || !name || !["P", "S", "G"].includes(market)) {
    errors.push(`${rowIndex + 1}行目: コード・銘柄名・市場を確認してください`);
    continue;
  }
  if (seen.has(code)) {
    errors.push(`${rowIndex + 1}行目: 証券コードが重複しています (${code})`);
    continue;
  }
  seen.add(code);
  stocks.push({ code, name, market });
}

console.log(`ファイル: ${fileName}`);
console.log(`対象銘柄基準日: ${sourceDate}`);
console.log(`選択可能銘柄: ${stocks.length}件`);
console.log(`不正行: ${errors.length}件`);
if (errors.length) {
  errors.slice(0, 20).forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}
if (mode === "check") {
  console.log("検証のみ完了しました。D1は変更していません。");
  process.exit(0);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "kabuka-universe-"));
try {
  const sqlPath = join(temporaryDirectory, "contest-stocks.sql");
  const stockStatements = stocks.map((stock) => `
INSERT INTO stocks(code,company_name,market_code)
VALUES(${sql(stock.code)},${sql(stock.name)},${sql(stock.market)})
ON CONFLICT(code) DO UPDATE SET company_name=excluded.company_name,market_code=excluded.market_code;
  `.trim());
  const eligibilityStatements = stocks.map((stock) => `
INSERT INTO contest_stocks(contest_id,stock_code,source_date)
SELECT id,${sql(stock.code)},${sql(sourceDate)} FROM contests
WHERE status IN ('open','running') ORDER BY id DESC LIMIT 1;
  `.trim());
  writeFileSync(sqlPath, `
${stockStatements.join("\n")}
DELETE FROM contest_stocks
WHERE contest_id=(SELECT id FROM contests WHERE status IN ('open','running') ORDER BY id DESC LIMIT 1);
${eligibilityStatements.join("\n")}
`, "utf8");
  runWrangler(mode, ["d1", "execute", "kabuka-competition-db", mode === "local" ? "--local" : "--remote", `--file=${sqlPath}`]);
  console.log(`${mode === "local" ? "ローカル" : "本番"}D1の選択可能銘柄を${stocks.length}件に固定しました。`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function parseCsv(text) {
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function runWrangler(targetMode, arguments_) {
  const wranglerPath = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wranglerPath, ...arguments_], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(projectRoot, ".wrangler", "logs") },
  });
  if (result.status !== 0) {
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    console.error(`${targetMode === "local" ? "ローカル" : "本番"}D1への処理に失敗しました。`);
    process.exit(result.status ?? 1);
  }
}
