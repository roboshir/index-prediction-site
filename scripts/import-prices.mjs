import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const csvArgument = process.argv[3];

if (!['check', 'local', 'remote'].includes(mode) || !csvArgument) {
  console.error('使い方: node scripts/import-prices.mjs <check|local|remote> <CSVファイル>');
  process.exit(1);
}

const csvPath = resolve(process.cwd(), csvArgument);
const fileName = basename(csvPath);
const dateMatch = fileName.match(/(20\d{2})(\d{2})(\d{2})/);
if (!dateMatch) {
  console.error('ファイル名から日付を判定できません。例: stq_20260915.csv');
  process.exit(1);
}
const priceDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
if (Number.isNaN(Date.parse(`${priceDate}T00:00:00Z`))) {
  console.error(`ファイル名の日付が不正です: ${priceDate}`);
  process.exit(1);
}

const source = readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const records = parseCsv(source);
if (records.length < 2) {
  console.error('CSVにデータ行がありません。');
  process.exit(1);
}

const headers = records[0];
const marketColumn = headers.includes('市場区分') ? '市場区分' : headers.includes('市場') ? '市場' : null;
const required = ['コード', '銘柄名', '終値(円)'];
for (const column of required) {
  if (!headers.includes(column)) {
    console.error(`必須列がありません: ${column}`);
    process.exit(1);
  }
}
if (!marketColumn) {
  console.error('必須列がありません: 市場 または 市場区分');
  process.exit(1);
}

const index = Object.fromEntries(headers.map((header, position) => [header, position]));
const stocks = [];
const prices = [];
const errors = [];
let skipped = 0;
const seen = new Set();

for (let rowIndex = 1; rowIndex < records.length; rowIndex++) {
  const row = records[rowIndex];
  if (row.every((value) => value.trim() === '')) continue;
  const code = (row[index['コード']] ?? '').trim().toUpperCase();
  const name = (row[index['銘柄名']] ?? '').trim();
  const market = (row[index[marketColumn]] ?? '').trim();
  const closeText = (row[index['終値(円)']] ?? '').trim();

  if (!/^[0-9A-Z]{4}$/.test(code)) {
    errors.push(`${rowIndex + 1}行目: 証券コードが不正です (${code || '空欄'})`);
    continue;
  }
  if (!name || !market) {
    errors.push(`${rowIndex + 1}行目: 銘柄名または市場区分が空です (${code})`);
    continue;
  }
  if (seen.has(code)) {
    errors.push(`${rowIndex + 1}行目: 証券コードが重複しています (${code})`);
    continue;
  }
  seen.add(code);
  stocks.push({ code, name, market });

  if (!closeText || closeText === '-') {
    skipped++;
    continue;
  }
  const close = Number(closeText.replaceAll(',', ''));
  if (!Number.isFinite(close) || close <= 0) {
    errors.push(`${rowIndex + 1}行目: 終値が不正です (${code}: ${closeText})`);
    continue;
  }
  prices.push({ code, close });
}

console.log(`ファイル: ${fileName}`);
console.log(`取引日: ${priceDate}`);
console.log(`銘柄情報: ${stocks.length}件`);
console.log(`終値あり: ${prices.length}件`);
console.log(`終値なし: ${skipped}件（株価登録をスキップ）`);
console.log(`不正行: ${errors.length}件`);
if (errors.length) {
  for (const message of errors.slice(0, 20)) console.error(`- ${message}`);
  if (errors.length > 20) console.error(`ほか${errors.length - 20}件`);
  process.exit(1);
}
if (mode === 'check') {
  console.log('検証のみ完了しました。D1は変更していません。');
  process.exit(0);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'kabuka-prices-'));
try {
  const statements = [
    ...stocks.map((stock) => `INSERT INTO stocks(code,company_name,market_code) VALUES(${sql(stock.code)},${sql(stock.name)},${sql(stock.market)}) ON CONFLICT(code) DO UPDATE SET company_name=excluded.company_name,market_code=excluded.market_code;`),
    ...prices.map((price) => `INSERT INTO stock_prices(date,stock_code,close) VALUES(${sql(priceDate)},${sql(price.code)},${price.close}) ON CONFLICT(date,stock_code) DO UPDATE SET close=excluded.close;`),
  ];

  const chunks = chunk(statements, 400);
  chunks.forEach((chunkStatements, chunkIndex) => {
    const sqlPath = join(temporaryDirectory, `prices-${String(chunkIndex + 1).padStart(3, '0')}.sql`);
    writeFileSync(sqlPath, `${chunkStatements.join('\n')}\n`, 'utf8');
    runWrangler(mode, ['d1', 'execute', 'kabuka-competition-db', flag(mode), `--file=${sqlPath}`]);
    console.log(`D1登録: ${chunkIndex + 1}/${chunks.length}`);
  });

  const recalculationPath = join(temporaryDirectory, 'recalculate.sql');
  writeFileSync(recalculationPath, recalculationSql(priceDate, fileName, prices.length, skipped), 'utf8');
  runWrangler(mode, ['d1', 'execute', 'kabuka-competition-db', flag(mode), `--file=${recalculationPath}`]);
  console.log('指数とランキングを再計算しました。');
  console.log(`${mode === 'local' ? 'ローカル' : '本番'}D1への取込が完了しました。`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function flag(targetMode) {
  return targetMode === 'local' ? '--local' : '--remote';
}

function runWrangler(targetMode, arguments_) {
  const wranglerPath = join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const result = spawnSync(process.execPath, [wranglerPath, ...arguments_], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG_PATH: join(projectRoot, '.wrangler', 'logs'),
    },
  });
  if (result.status !== 0) {
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    console.error(`${targetMode === 'local' ? 'ローカル' : '本番'}D1への処理に失敗しました。`);
    process.exit(result.status ?? 1);
  }
}

function recalculationSql(date, sourceFile, importedRows, skippedRows) {
  return `
DELETE FROM index_daily_values;

WITH calculated AS (
  SELECT
    e.id AS entry_id,
    trading_dates.date AS price_date,
    SUM(
      (es.weight / 100.0) *
      ((current_price.close - base_price.close) / base_price.close)
    ) AS weighted_return,
    COUNT(DISTINCT es.stock_code) AS priced_holdings
  FROM entries e
  JOIN contests c ON c.id = e.contest_id
  JOIN entry_stocks es ON es.entry_id = e.id
  JOIN (
    SELECT DISTINCT date
    FROM stock_prices
  ) trading_dates
    ON trading_dates.date BETWEEN c.contest_start AND c.contest_end
  JOIN stock_prices base_price
    ON base_price.stock_code = es.stock_code
   AND base_price.date = (
     SELECT MIN(bp.date)
     FROM stock_prices bp
     WHERE bp.stock_code = es.stock_code
       AND bp.date >= c.contest_start
       AND bp.date <= c.contest_end
   )
  JOIN stock_prices current_price
    ON current_price.stock_code = es.stock_code
   AND current_price.date = (
     SELECT MAX(cp.date)
     FROM stock_prices cp
     WHERE cp.stock_code = es.stock_code
       AND cp.date >= c.contest_start
       AND cp.date <= trading_dates.date
   )
  GROUP BY e.id, trading_dates.date
  HAVING priced_holdings = 5
)
INSERT INTO index_daily_values(entry_id,date,index_value,return_rate,rank)
SELECT entry_id,price_date,100.0 * (1.0 + weighted_return),weighted_return * 100.0,NULL
FROM calculated;

WITH ranked AS (
  SELECT
    d.id,
    RANK() OVER (PARTITION BY e.contest_id,d.date ORDER BY d.return_rate DESC) AS new_rank
  FROM index_daily_values d JOIN entries e ON e.id=d.entry_id
)
UPDATE index_daily_values
SET rank = (SELECT new_rank FROM ranked WHERE ranked.id = index_daily_values.id);

INSERT INTO price_imports(price_date,source_filename,imported_rows,skipped_rows)
VALUES(${sql(date)},${sql(sourceFile)},${importedRows},${skippedRows});

PRAGMA optimize;
`;
}
