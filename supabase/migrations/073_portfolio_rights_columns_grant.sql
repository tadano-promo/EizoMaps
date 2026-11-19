-- 073: 作品の「載せる許可の確認」「解禁日」を画面から入れられるように（列ごとの許可が抜けていた）
--   列ごとの許可に rights_confirmed_at・release_on が入っておらず、許可つきの登録・「載せる許可を確認する」・解禁日の変更が
--   「permission denied」で止まっていた（2026-11-19 確認）。日時はサーバーの時計で入る（026 の trg_portfolios_rights_guard）。
--   一時非公開（takedown_hold）は今までどおり画面からは変えられない。
grant insert (rights_confirmed_at, release_on) on public.portfolios to authenticated;
grant update (rights_confirmed_at, release_on) on public.portfolios to authenticated;
