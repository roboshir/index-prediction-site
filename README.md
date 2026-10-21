# マイINDEX

日本株5銘柄と構成比率からオリジナル指数を作り、上昇率を競う無料シミュレーションサービスのMVPです。実際の売買、投資助言、決済、賞品処理は行いません。

## 技術構成

- React 19 / TypeScript / Vite
- Cloudflare Workers Vite Plugin
- Cloudflare Workers（API・メール送信）
- Cloudflare D1（SQLite）
- Resend（本番の登録完了メール）
- Recharts（日次指数チャート）

フロントエンドとWorker APIを1つのリポジトリで管理します。Next.jsとSupabaseは使用していません。

## 実装済み

- 開催中コンテスト表示
- 5銘柄・各5〜50%・合計100%のエントリー
- クライアント・Worker双方での入力検証
- 暗号学的に推測困難なEntry ID
- D1保存後の登録完了メール送信
- メール失敗時も登録を維持しEntry IDを返却
- 10分間隔制限付きメール再送API
- 30件単位のランキング
- Entry IDによる成績・構成銘柄・チャート表示
- JPX株価CSVのローカルコマンド取込、upsert、指数と順位の事前計算
- コンテストごとの選択可能銘柄固定（エントリー開始日の前営業日CSV）
- 株価取込履歴の保存
- Prepared Statement、UNIQUE制約、FOREIGN KEY、検索用INDEX
- ローカルメール安全モード

## 初回セットアップ

前提：Node.js 22以上、npm、Cloudflareアカウント。

```bash
npm install
npx wrangler d1 create kabuka-competition-db
```

D1作成時に表示される `database_id` を `wrangler.jsonc` の仮ID `00000000-0000-0000-0000-000000000000` と置き換えます。ローカル確認だけなら仮IDのままで構いません。

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

表示されたローカルURLをブラウザで開いてください。ローカルでは `APP_ENV=development` のため、実在ユーザーへのメール送信を行わず成功扱いにします。

## 動作確認の流れ

1. トップから無料エントリーを開く
2. メール、ニックネーム、指数名、5銘柄を入力する
3. Entry IDを保存する
4. ローカルコマンドでJPX株価CSVを取り込む
5. ランキングとEntry ID検索を確認する

CSVはファイル名に取引日を含むJPX形式に対応しています。

```csv
コード,銘柄名,市場,終値(円)
7203,トヨタ自動車,P,"3,012.50"
```

エントリー受付を始める前に、前営業日のCSVでその大会の選択可能銘柄を固定します。

```bash
npm run universe:check -- "C:\path\to\stq_20260917.csv"
npm run universe:import:local -- "C:\path\to\stq_20260917.csv"
```

この操作は受付開始前に一度だけ行います。以降の日次CSVは選択可能銘柄を変更しません。

最初に内容だけ検証します。この処理ではD1を変更しません。

```bash
npm run prices:check -- "C:\path\to\stq_20260917.csv"
```

ローカルD1へ取り込む場合：

```bash
npm run prices:import:local -- "C:\path\to\stq_20260917.csv"
```

本番D1へ取り込む場合：

```bash
npm run prices:import:remote -- "C:\path\to\stq_20260917.csv"
```

取込処理はファイル名から日付を読み取り、銘柄情報と終値をupsertした後、コンテスト開始日を基準として日次指数と順位を再計算します。終値が空欄の銘柄は銘柄マスタだけ登録し、その日の株価登録をスキップします。

## 本番メール

Resendで送信元ドメインを認証後、次を設定します。

```bash
npx wrangler secret put RESEND_API_KEY
```

`wrangler.jsonc` の `APP_ENV` を `production`、`APP_URL` を本番URL、`EMAIL_FROM` を認証済み送信元に変更してください。APIキーは `.env` やソースコードへ書かず、必ずWorker Secretに保存します。

## 本番デプロイ

```bash
npm run db:migrate:remote
npm run build
npm run deploy
```

株価更新用のWeb管理画面と管理APIはありません。本番株価はCloudflareへログイン済みの運営者がローカルコマンドからD1へ登録します。

## DB構成

### 大会の切り替え

この変更の初回公開は `npm run db:migrate:remote` → `npm run deploy` の順で行います。ローカルは `npm run db:migrate:local` を先に実行します。`0005_contest_rank_scope.sql` は既存成績を保持し、大会・日付ごとに順位を付け直します。

1. D1の `contests` に次回大会を新しい行で追加します。準備中は `status=draft` にします。
2. 公開対象を切り替える時に旧大会を `finished`、新大会を `open` にします。
3. 選択可能銘柄CSVを新大会へ取り込み、公開サイトの大会名・銘柄検索を確認します。銘柄登録前に参加募集を告知しないでください。

公開大会・参加登録・銘柄検索・ランキングは、`open` または `running` のうち最大IDの大会を対象にします。切り替えは日付による自動処理ではありません。受付開始・終了だけは日本時間の日程から自動判定します。`running` は表示を続けつつ受付を停止、`finished` は表示対象から除外します。複数の大会を同時募集する仕様ではありません。

新大会に成績がなければランキングは空になり、過去大会の成績は混在しません。過去大会のデータや個別指数URLは残ります（過去大会の一覧画面は未実装）。切替時に開いていた旧大会の登録は拒否し、新大会の入力画面へ切り替えます。
検証：`node scripts/test-contest-switching.mjs`（メモリ内SQLiteで実行。本番DBは変更しません）。

### 大会ごとの賞品設定

この変更を初めて公開する前に、以下の順で実行してください（既存データは削除しません）。

```powershell
npm run db:migrate:remote
npm run deploy
```

ローカル確認の前にも `npm run db:migrate:local` を実行します。
`0004_contest_prizes.sql` が各大会に賞品列を追加します。既存・新規大会の初期値はAmazonギフトカードの1位5,000円、2位3,000円、3位1,000円です。

CloudflareのD1 → Explore Data → `contests` から、対象大会の以下の列を編集・保存します。

| 列 | 内容 | 入力例 |
|---|---|---|
| `prize_1_name` | 1位の賞品名 | Amazonギフトカード |
| `prize_1_amount` | 1位の金額（円） | 5000 |
| `prize_2_name` | 2位の賞品名 | Amazonギフトカード |
| `prize_2_amount` | 2位の金額（円） | 3000 |
| `prize_3_name` | 3位の賞品名 | Amazonギフトカード |
| `prize_3_amount` | 3位の金額（円） | 1000 |

金額はカンマ・「円」を付けず、0以上の整数で入力します。以降の賞品変更には再デプロイは不要です。サイトの再読み込み、または最大約30秒後の自動再取得で反映します。過去大会を残すには、その行を編集せず新しい大会を追加してください。
賞品のメール送付を自動化する機能ではなく、サイトの表示設定です。

移行の検証は `node scripts/test-contest-prizes.mjs`（Node.jsの `node:sqlite` が必要）で実行できます。

- `contests`: コンテスト期間と状態
- `stocks`: 銘柄コード・表示名の共通マスター
- `contest_stocks`: コンテストごとに固定した選択可能銘柄
- `entries`: 参加者、Entry ID、メール送信状態
- `entry_stocks`: 5銘柄とウェイト
- `stock_prices`: 日付・銘柄ごとの終値
- `index_daily_values`: 事前計算済み指数、騰落率、順位
- `price_imports`: CSV取込履歴

指数は `100 × (1 + Σ((現在株価 - 基準株価) / 基準株価 × ウェイト))` で計算します。ランキング表示時には再計算せず、保存済みの日次値を読みます。

## 注意事項

- デモの基準日は2026年9月17日です。本番コンテストでは期間を変更してください。
- 無料参加MVPです。決済や賞品処理は未実装です。
- 法律・税務・個人情報保護については、公開前に専門家へ確認してください。
