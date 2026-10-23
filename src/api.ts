import type { EntryDetail, EntryResult, RankingRow, StockOption, StockPick } from "./types";
async function request<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(path, init); const payload = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(payload.error || "処理に失敗しました。時間をおいて再度お試しください。"); return payload as T; }
export const api = {
  contest: () => request<{ serverNow: number; contest: { id: number; name: string; status: string; entryStart: string; entryEnd: string; contestStart: string; contestEnd: string; participantCount: number; prize1Name: string; prize1Amount: number; prize2Name: string; prize2Amount: number; prize3Name: string; prize3Amount: number } | null }>("/api/contest"),
  stocks: (query: string) => request<{ items: StockOption[] }>(`/api/stocks?q=${encodeURIComponent(query)}`),
  rankings: (page = 1, query = "", field = "all") => request<{ items: RankingRow[]; page: number; totalPages: number; asOf: string | null }>(`/api/rankings?${new URLSearchParams({page:String(page),q:query,field})}`),
  entry: (id: string) => request<EntryDetail>(`/api/entries/${encodeURIComponent(id)}`),
  createEntry: (body: { contestId: number; email: string; emailConfirm: string; nickname: string; indexName: string; stocks: StockPick[] }) => request<EntryResult>("/api/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  resend: (id: string) => request<{ sent: boolean }>(`/api/entries/${encodeURIComponent(id)}/resend`, { method: "POST" })
};
