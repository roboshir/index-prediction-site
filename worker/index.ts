import { z } from "zod";
import { entryWindow, type Schedule } from "../src/contestSchedule";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  RESEND_API_KEY?: string;
  APP_ENV?: string;
  APP_URL?: string;
  EMAIL_FROM?: string;
}

const stockSchema = z.object({
  code: z.string().regex(/^[0-9A-Z]{4}$/),
  weight: z.number().int().min(5).max(50),
});

const entrySchema = z.object({
  contestId: z.number().int().positive(),
  email: z.string().email().max(254),
  emailConfirm: z.string().email(),
  nickname: z.string().trim().min(1).max(30),
  indexName: z.string().trim().min(1).max(40),
  stocks: z.array(stockSchema).length(5),
}).superRefine((value, context) => {
  if (value.email.toLowerCase() !== value.emailConfirm.toLowerCase()) {
    context.addIssue({ code: "custom", message: "メールアドレスが一致しません" });
  }
  if (new Set(value.stocks.map((stock) => stock.code)).size !== 5) {
    context.addIssue({ code: "custom", message: "銘柄が重複しています" });
  }
  if (value.stocks.reduce((total, stock) => total + stock.weight, 0) !== 100) {
    context.addIssue({ code: "custom", message: "ウェイト合計は100%にしてください" });
  }
});

const json = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: { "cache-control": "no-store" },
});

const publicId = () => `KBI_${crypto.randomUUID().replaceAll("-", "")}`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/contest" && request.method === "GET") return getContest(env);
      if (url.pathname === "/api/stocks" && request.method === "GET") return getStocks(url, env);
      if (url.pathname === "/api/entries" && request.method === "POST") return createEntry(request, env);
      if (url.pathname === "/api/rankings" && request.method === "GET") return getRankings(url, env);
      if (/^\/api\/entries\/[^/]+\/resend$/.test(url.pathname) && request.method === "POST") return resend(url, env);
      if (/^\/api\/entries\/[^/]+$/.test(url.pathname) && request.method === "GET") return getEntry(url, env);
      if (url.pathname.startsWith("/api/")) return json({ error: "APIが見つかりません" }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("request_failed", error instanceof Error ? error.name : "unknown");
      return json({ error: "サーバーで処理できませんでした" }, 500);
    }
  },
};

async function getStocks(url: URL, env: Env) {
  const contest = await currentContest(env);
  if (!contest) return json({ items: [] });
  const query = (url.searchParams.get("q") || "").trim().slice(0, 50);
  const escaped = query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const contains = `%${escaped}%`;
  const prefix = `${escaped}%`;
  const stocks = await env.DB.prepare(`
    SELECT s.code, s.company_name name, s.market_code market
    FROM stocks s
    JOIN contest_stocks cs ON cs.stock_code=s.code
    JOIN contests c ON c.id=cs.contest_id
    WHERE c.id=? AND c.status='open'
      AND (? = '' OR s.code LIKE ? ESCAPE '\\' OR s.company_name LIKE ? ESCAPE '\\')
    ORDER BY
      CASE WHEN s.code = ? THEN 0 WHEN s.code LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
      s.code
    LIMIT 30
  `).bind(contest.id, query, contains, contains, query.toUpperCase(), prefix.toUpperCase()).all();
  return json({ items: stocks.results });
}

async function currentContest(env: Env) {
  return env.DB.prepare(`
    SELECT c.id,c.name,c.status,c.entry_start entryStart,c.entry_end entryEnd,
           c.contest_start contestStart,c.contest_end contestEnd,
           c.prize_1_name prize1Name,c.prize_1_amount prize1Amount,
           c.prize_2_name prize2Name,c.prize_2_amount prize2Amount,
           c.prize_3_name prize3Name,c.prize_3_amount prize3Amount,
           COUNT(e.id) participantCount
    FROM contests c
    LEFT JOIN entries e ON e.contest_id=c.id
    WHERE c.status IN ('open','running')
    GROUP BY c.id
    ORDER BY c.id DESC
    LIMIT 1
  `).first<Schedule & { id: number }>();
}

async function getContest(env: Env) {
  const contest = await currentContest(env);
  return json({ contest: contest || null, serverNow: Date.now() });
}

async function createEntry(request: Request, env: Env) {
  const parsed = entrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "入力内容を確認してください" }, 400);

  const value = parsed.data;
  const contest = await currentContest(env);
  if (!contest || !entryWindow(contest, Date.now()).open) return json({ error: "現在エントリー受付中のコンテストはありません" }, 409);
  if (value.contestId !== contest.id) return json({ error: "大会が切り替わりました。ページを再読み込みして、銘柄を選び直してください" }, 409);

  const allowed = await env.DB.prepare(`
    SELECT s.code,s.company_name name
    FROM stocks s
    JOIN contest_stocks cs ON cs.stock_code=s.code
    WHERE cs.contest_id=? AND s.code IN (?,?,?,?,?)
  `).bind(contest.id, ...value.stocks.map((stock) => stock.code)).all<{ code: string; name: string }>();
  if (allowed.results.length !== 5) return json({ error: "登録されていない銘柄が含まれています" }, 400);

  const entryPublicId = publicId();
  const insert = await env.DB.prepare(`
    INSERT INTO entries(contest_id,entry_public_id,email,nickname,index_name)
    VALUES(?,?,?,?,?)
  `).bind(contest.id, entryPublicId, value.email.toLowerCase(), value.nickname, value.indexName).run();
  const entryId = insert.meta.last_row_id;
  await env.DB.batch(value.stocks.map((stock) => env.DB.prepare(`
    INSERT INTO entry_stocks(entry_id,stock_code,weight) VALUES(?,?,?)
  `).bind(entryId, stock.code, stock.weight)));

  try {
    await recalculateEntry(env, Number(entryId));
  } catch (error) {
    console.error("entry_recalculation_failed", error instanceof Error ? error.name : "unknown");
  }

  let emailSent = false;
  try {
    emailSent = await sendEntryEmail(env, { ...value, entryPublicId });
    await env.DB.prepare(`
      UPDATE entries SET email_delivery_status=?,last_email_sent_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(emailSent ? "sent" : "failed", entryId).run();
  } catch {
    await env.DB.prepare(`UPDATE entries SET email_delivery_status='failed' WHERE id=?`).bind(entryId).run();
  }

  const names = new Map(allowed.results.map((stock) => [stock.code, stock.name]));
  return json({ entryPublicId, nickname: value.nickname, indexName: value.indexName, stocks: value.stocks.map((stock) => ({ ...stock, name: names.get(stock.code) })), emailSent }, 201);
}

async function recalculateEntry(env: Env, entryId: number) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM index_daily_values WHERE entry_id=?`).bind(entryId),
    env.DB.prepare(`
      WITH calculated AS (
        SELECT
          e.id entry_id,
          trading_dates.date price_date,
          SUM((es.weight / 100.0) * ((current_price.close - base_price.close) / base_price.close)) weighted_return,
          COUNT(DISTINCT es.stock_code) priced_holdings
        FROM entries e
        JOIN contests c ON c.id=e.contest_id
        JOIN entry_stocks es ON es.entry_id=e.id
        JOIN (SELECT DISTINCT date FROM stock_prices) trading_dates
          ON trading_dates.date BETWEEN c.contest_start AND c.contest_end
        JOIN stock_prices base_price
          ON base_price.stock_code=es.stock_code
         AND base_price.date=(
           SELECT MIN(bp.date) FROM stock_prices bp
           WHERE bp.stock_code=es.stock_code AND bp.date>=c.contest_start AND bp.date<=c.contest_end
         )
        JOIN stock_prices current_price
          ON current_price.stock_code=es.stock_code
         AND current_price.date=(
           SELECT MAX(cp.date) FROM stock_prices cp
           WHERE cp.stock_code=es.stock_code AND cp.date>=c.contest_start AND cp.date<=trading_dates.date
         )
        WHERE e.id=?
        GROUP BY e.id,trading_dates.date
        HAVING priced_holdings=5
      )
      INSERT INTO index_daily_values(entry_id,date,index_value,return_rate,rank)
      SELECT entry_id,price_date,100.0*(1.0+weighted_return),weighted_return*100.0,NULL FROM calculated
    `).bind(entryId),
    env.DB.prepare(`
      WITH ranked AS (
        SELECT d.id,RANK() OVER (PARTITION BY e.contest_id,d.date ORDER BY d.return_rate DESC) new_rank
        FROM index_daily_values d JOIN entries e ON e.id=d.entry_id
      )
      UPDATE index_daily_values
      SET rank=(SELECT new_rank FROM ranked WHERE ranked.id=index_daily_values.id)
    `),
  ]);
}

async function sendEntryEmail(env: Env, data: {
  email: string;
  nickname: string;
  indexName: string;
  entryPublicId: string;
  stocks: { code: string; weight: number }[];
}) {
  if (env.APP_ENV !== "production" || !env.RESEND_API_KEY) {
    console.info("email_skipped_in_development", data.entryPublicId);
    return true;
  }
  const list = data.stocks.map((stock) => `${stock.code}: ${stock.weight}%`).join(" / ");
  const html = `<h1>エントリーが完了しました</h1><p>${escapeHtml(data.nickname)}さん</p><p>指数名：${escapeHtml(data.indexName)}</p><p><strong>Entry ID：${data.entryPublicId}</strong></p><p>${list}</p><p>成績確認時に必要です。大切に保管してください。</p><p><a href="${env.APP_URL}">${env.APP_URL}</a></p><small>このメールへの返信は不要です。</small>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [data.email],
      subject: "マイINDEX エントリー完了",
      html,
      text: `株価予想インデックス・コンテストへのエントリーが完了しました。\nニックネーム：${data.nickname}\n指数名：${data.indexName}\nEntry ID：${data.entryPublicId}\n${list}\nEntry IDは大切に保管してください。\nこのメールへの返信は不要です。`,
    }),
  });
  return response.ok;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]!));

async function getRankings(url: URL, env: Env) {
  const query=(url.searchParams.get("q")||"").trim().slice(0,100);
  const field=url.searchParams.get("field");
  const pattern=`%${query.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_")}%`;
  const searchSql=field==="nickname"?"e.nickname LIKE ? ESCAPE '\\'":field==="indexName"?"e.index_name LIKE ? ESCAPE '\\'":"(e.nickname LIKE ? ESCAPE '\\' OR e.index_name LIKE ? ESCAPE '\\')";
  const searchValues=field==="nickname"||field==="indexName"?[pattern]:[pattern,pattern];
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = 30;
  const offset = (page - 1) * limit;
  const contest = await currentContest(env);
  if (!contest) return json({ items: [], page, totalPages: 1, asOf: null });
  const latest = await env.DB.prepare(`SELECT MAX(d.date) date FROM index_daily_values d JOIN entries e ON e.id=d.entry_id WHERE e.contest_id=?`).bind(contest.id).first<{ date: string | null }>();
  if (!latest?.date) return json({ items: [], page, totalPages: 1, asOf: null });
  const count = await env.DB.prepare(`SELECT COUNT(*) total FROM index_daily_values d JOIN entries e ON e.id=d.entry_id WHERE d.date=? AND e.contest_id=? AND ${searchSql}`)
    .bind(latest.date, contest.id, ...searchValues).first<{ total: number }>();
  const rows = await env.DB.prepare(`
    SELECT d.rank,e.entry_public_id entryPublicId,e.nickname,e.index_name indexName,
           d.index_value indexValue,d.return_rate returnRate,
           json_group_array(json_object(
             'code',es.stock_code,
             'name',s.company_name,
             'weight',es.weight,
             'basePrice',(
               SELECT bp.close FROM stock_prices bp
               WHERE bp.stock_code=es.stock_code
                 AND bp.date BETWEEN c.contest_start AND c.contest_end
               ORDER BY bp.date LIMIT 1
             ),
             'baseDate',(
               SELECT bp.date FROM stock_prices bp
               WHERE bp.stock_code=es.stock_code
                 AND bp.date BETWEEN c.contest_start AND c.contest_end
               ORDER BY bp.date LIMIT 1
             )
           )) holdings,
           (
             SELECT json_group_array(json_object('date',history.date,'indexValue',history.index_value))
             FROM (
               SELECT date,index_value FROM index_daily_values
               WHERE entry_id=e.id ORDER BY date
             ) history
           ) history
    FROM index_daily_values d
    JOIN entries e ON e.id=d.entry_id
    JOIN contests c ON c.id=e.contest_id
    JOIN entry_stocks es ON es.entry_id=e.id
    JOIN stocks s ON s.code=es.stock_code
    WHERE d.date=? AND e.contest_id=? AND ${searchSql}
    GROUP BY d.id
    ORDER BY d.rank,e.id
    LIMIT ? OFFSET ?
  `).bind(latest.date, contest.id, ...searchValues, limit, offset).all<{ rank: number; entryPublicId: string; nickname: string; indexName: string; indexValue: number; returnRate: number; holdings: string; history: string }>();
  const items = rows.results.map(({ holdings, history, ...row }) => ({ ...row, stocks: JSON.parse(holdings), history: JSON.parse(history) }));
  return json({ items, page, totalPages: Math.max(1, Math.ceil((count?.total || 0) / limit)), asOf: latest.date });
}

async function getEntry(url: URL, env: Env) {
  const entryPublicId = decodeURIComponent(url.pathname.split("/").pop() || "");
  const entry = await env.DB.prepare(`
    SELECT e.id,e.entry_public_id entryPublicId,e.nickname,e.index_name indexName,
           e.email_delivery_status status,c.contest_start contestStart,c.contest_end contestEnd
    FROM entries e JOIN contests c ON c.id=e.contest_id
    WHERE e.entry_public_id=?
  `).bind(entryPublicId).first<{ id: number; entryPublicId: string; nickname: string; indexName: string; status: string; contestStart: string; contestEnd: string }>();
  if (!entry) return json({ error: "Entry IDが見つかりません" }, 404);

  const holdings = await env.DB.prepare(`SELECT es.stock_code code,s.company_name name,es.weight FROM entry_stocks es JOIN stocks s ON s.code=es.stock_code WHERE es.entry_id=? ORDER BY es.id`)
    .bind(entry.id).all<{ code: string; name: string; weight: number }>();
  const history = await env.DB.prepare(`
    SELECT date,index_value indexValue,return_rate returnRate,rank
    FROM index_daily_values WHERE entry_id=? ORDER BY date
  `).bind(entry.id).all<{ date: string; indexValue: number; returnRate: number; rank: number | null }>();
  const latest = history.results.at(-1);
  const returns = await Promise.all(holdings.results.map(async (holding) => {
    const prices = await env.DB.prepare(`
      SELECT date,close FROM stock_prices
      WHERE stock_code=? AND date BETWEEN ? AND ? ORDER BY date
    `).bind(holding.code, entry.contestStart, entry.contestEnd).all<{ date: string; close: number }>();
    const first = prices.results[0];
    const last = prices.results.at(-1);
    return {
      ...holding,
      baseDate: first?.date || null,
      basePrice: first?.close ?? null,
      returnRate: first?.close && last?.close ? ((last.close - first.close) / first.close) * 100 : null,
    };
  }));

  return json({
    entryPublicId: entry.entryPublicId,
    nickname: entry.nickname,
    indexName: entry.indexName,
    stocks: holdings.results,
    emailSent: entry.status === "sent",
    rank: latest?.rank || null,
    indexValue: latest?.indexValue || 100,
    returnRate: latest?.returnRate || 0,
    stockReturns: returns,
    history: history.results.map((value) => ({ date: value.date, indexValue: value.indexValue })),
  });
}

async function resend(url: URL, env: Env) {
  const entryPublicId = decodeURIComponent(url.pathname.split("/").at(-2) || "");
  const entry = await env.DB.prepare(`
    SELECT id,email,nickname,index_name indexName,entry_public_id entryPublicId,last_email_sent_at lastSent
    FROM entries WHERE entry_public_id=?
  `).bind(entryPublicId).first<{ id: number; email: string; nickname: string; indexName: string; entryPublicId: string; lastSent: string | null }>();
  if (!entry) return json({ error: "Entry IDが見つかりません" }, 404);
  if (entry.lastSent && Date.now() - Date.parse(`${entry.lastSent}Z`) < 10 * 60 * 1000) {
    return json({ error: "再送は10分以上あけてください" }, 429);
  }
  const stocks = await env.DB.prepare(`SELECT stock_code code,weight FROM entry_stocks WHERE entry_id=?`)
    .bind(entry.id).all<{ code: string; weight: number }>();
  const sent = await sendEntryEmail(env, { ...entry, stocks: stocks.results });
  await env.DB.prepare(`UPDATE entries SET email_delivery_status=?,last_email_sent_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(sent ? "sent" : "failed", entry.id).run();
  return json({ sent });
}
