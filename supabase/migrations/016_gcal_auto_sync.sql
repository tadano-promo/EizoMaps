-- =====================================================================
-- 016 Google カレンダーの自動同期（2026-10-14）
--   15分ごとに、連携している全員の同期をデータベースが自動で頼む。
--   「今すぐ同期する」を押し忘れても、ずれたままにならないようにする。
--
--   合言葉（gcal_cron）はデータベースの中で作り、外には出さない。
--   Edge Function は同じ表を読んで照らし合わせる。
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 運営用の内部の値。画面からは読めない（ポリシーを作らない＋権限を外す）
create table if not exists public.app_internal (
  key        text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);
alter table public.app_internal enable row level security;
alter table public.app_internal force row level security;
revoke all on public.app_internal from anon, authenticated;
grant select on public.app_internal to service_role;

insert into public.app_internal (key, value)
values ('gcal_cron', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- 同じ名前の予約があれば作り直す
do $$
begin
  perform cron.unschedule('gcal-auto-sync');
exception when others then null;
end $$;

-- Authorization の鍵は「公開してよい鍵（anon）」。本当の照合は x-cron-key で行う。
select cron.schedule(
  'gcal-auto-sync',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://buquisjkkwvekoyuuxjx.supabase.co/functions/v1/google-calendar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1cXVpc2pra3d2ZWtveXV1eGp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTU2NjQsImV4cCI6MjEwNDc5MTY2NH0.jPkr8vQycg3ICajTPVcY8ltfb8evK26fYHvfb-FrU3c',
      'x-cron-key',    (select value from public.app_internal where key = 'gcal_cron')
    ),
    body    := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $cron$
);
