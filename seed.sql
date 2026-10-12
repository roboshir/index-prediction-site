INSERT OR IGNORE INTO contests (id,name,entry_start,entry_end,contest_start,contest_end,status)
VALUES (1,'本番デモ 日本株インデックス杯','2026-09-01','2026-10-31','2026-09-17','2026-12-26','open');

INSERT OR IGNORE INTO stocks(code,company_name,market_code) VALUES
('7203','トヨタ自動車','TSE'),('9984','ソフトバンクグループ','TSE'),('6758','ソニーグループ','TSE'),
('8306','三菱UFJフィナンシャル・グループ','TSE'),('9432','日本電信電話','TSE'),('8058','三菱商事','TSE'),
('7974','任天堂','TSE'),('6861','キーエンス','TSE'),('6501','日立製作所','TSE'),('4502','武田薬品工業','TSE');
