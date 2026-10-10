-- =====================================================================
-- 008 ポートフォリオに TikTok を登録できるようにする（2026-10-10）
-- ---------------------------------------------------------------------
-- 画面（video.js）は TikTok の URL を受け付けるが、portfolios の制約が
-- youtube / vimeo だけだったため、保存時にエラーになっていた。
-- ストックページ（stock_items）はすでに tiktok を許可している。
-- 何度実行しても同じ結果になる。
-- =====================================================================
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.portfolios'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.portfolios drop constraint %I', c);
  end loop;
end $$;

alter table public.portfolios
  add constraint portfolios_provider_check
  check (provider in ('youtube', 'vimeo', 'tiktok'));
