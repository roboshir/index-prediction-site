export type StockPick = { code: string; weight: number; name?: string; basePrice?: number | null; baseDate?: string | null };
export type StockOption = { code: string; name: string; market: string };
export type RankingRow = { entryPublicId: string; rank: number; nickname: string; indexName: string; indexValue: number; returnRate: number; stocks: StockPick[]; history: Array<{ date: string; indexValue: number }> };
export type EntryResult = { entryPublicId: string; nickname: string; indexName: string; stocks: StockPick[]; emailSent: boolean };
export type EntryDetail = EntryResult & { rank: number | null; indexValue: number; returnRate: number; stockReturns: Array<StockPick & { returnRate: number | null }>; history: Array<{ date: string; indexValue: number }> };
