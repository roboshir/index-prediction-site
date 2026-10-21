export type Schedule = { entryStart: string; entryEnd: string; status: string };
export function entryWindow(contest: Schedule | null, now: number) {
  if (!contest) return { open: false, label: "現在受付中の大会はありません", state: "none" };
  const start = Date.parse(`${contest.entryStart}T00:00:00+09:00`);
  const end = Date.parse(`${contest.entryEnd}T00:00:00+09:00`) + 86400000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return { open: false, label: "受付日程を確認中です", state: "none" };
  if (contest.status !== "open") return { open: false, label: "エントリー受付終了", state: "closed" };
  if (now < start) return { open: false, label: `${Number(contest.entryStart.slice(5,7))}月${Number(contest.entryStart.slice(8,10))}日 エントリー開始`, state: "upcoming" };
  if (now >= end) return { open: false, label: "エントリー受付終了", state: "closed" };
  return { open: true, label: "指数を作成して参加", state: "open" };
}
