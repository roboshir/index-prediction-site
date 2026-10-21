-- 既存の成績を消さず、大会別・日付別に順位を修正します。
WITH ranked AS (
  SELECT d.id,
         RANK() OVER (PARTITION BY e.contest_id,d.date ORDER BY d.return_rate DESC) AS new_rank
  FROM index_daily_values d
  JOIN entries e ON e.id=d.entry_id
)
UPDATE index_daily_values
SET rank=(SELECT new_rank FROM ranked WHERE ranked.id=index_daily_values.id);
