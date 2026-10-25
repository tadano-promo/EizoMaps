-- 028 アフィリエイト（A8 さん）の広告コードを「そのまま」入れておく欄（2026-10-25）
--   A8 さんの決まり：広告コードを勝手に変えない・リンク部分だけを使わない（メディア会員利用規約 8.1.12）
--   表示するときは、コードの中の a / img だけを、属性もそのままに並べる（変えない）
alter table public.ads add column if not exists ad_code text check (ad_code is null or char_length(ad_code) <= 4000);
