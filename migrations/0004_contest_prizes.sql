-- 既存大会と新規大会に現在の賞品設定を引き継ぎます。
ALTER TABLE contests ADD COLUMN prize_1_name TEXT NOT NULL DEFAULT 'Amazonギフトカード' CHECK (length(trim(prize_1_name)) > 0);
ALTER TABLE contests ADD COLUMN prize_1_amount INTEGER NOT NULL DEFAULT 5000 CHECK (typeof(prize_1_amount) = 'integer' AND prize_1_amount >= 0);
ALTER TABLE contests ADD COLUMN prize_2_name TEXT NOT NULL DEFAULT 'Amazonギフトカード' CHECK (length(trim(prize_2_name)) > 0);
ALTER TABLE contests ADD COLUMN prize_2_amount INTEGER NOT NULL DEFAULT 3000 CHECK (typeof(prize_2_amount) = 'integer' AND prize_2_amount >= 0);
ALTER TABLE contests ADD COLUMN prize_3_name TEXT NOT NULL DEFAULT 'Amazonギフトカード' CHECK (length(trim(prize_3_name)) > 0);
ALTER TABLE contests ADD COLUMN prize_3_amount INTEGER NOT NULL DEFAULT 1000 CHECK (typeof(prize_3_amount) = 'integer' AND prize_3_amount >= 0);
