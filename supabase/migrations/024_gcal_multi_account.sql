-- =====================================================================
-- 024 Google アカウントを複数つなげる（2026-10-25）
--   ・最初につないだアカウント（calendar_links）はそのまま「1つ目」
--   ・2つ目以降のアカウントは calendar_accounts に入れる（1人5つまで）
--   ・「埋まっている日」には、つないだ全部のアカウントのカレンダーを使える
--   ・Eizo Maps の予定を書き出す先は、どのアカウントのカレンダーでも1つ選べる
--     （calendar_links.push_account_id：null＝1つ目のアカウント）
--   ・予定ごとに「どのアカウントに書いたか」を覚える（schedule_events.google_account_id）
--
--   ★ セキュリティ：calendar_accounts もポリシーを1つも作らない。
--     触るのは Edge Function（service_role）だけ。トークンは暗号文だけ。
--   ※ 「消す・外す」系の命令は使わない
-- =====================================================================

create table if not exists public.calendar_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  google_email       text check (google_email is null or char_length(google_email) <= 200),
  google_sub         text not null check (char_length(google_sub) <= 100),
  scope              text check (scope is null or char_length(scope) <= 500),
  refresh_token_enc  text not null,
  busy_calendar_ids  text[] check (busy_calendar_ids is null or cardinality(busy_calendar_ids) <= 20),
  connected_at       timestamptz not null default now(),
  last_sync_error    text check (last_sync_error is null or char_length(last_sync_error) <= 500),
  updated_at         timestamptz not null default now(),
  constraint calendar_accounts_user_sub unique (user_id, google_sub)
);
alter table public.calendar_accounts enable row level security;
alter table public.calendar_accounts force row level security;
revoke all on public.calendar_accounts from anon, authenticated;
grant select, insert, update, delete on public.calendar_accounts to service_role;
create index if not exists idx_calendar_accounts_user on public.calendar_accounts (user_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_calendar_accounts_updated_at') then
    create trigger trg_calendar_accounts_updated_at before update on public.calendar_accounts
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- 書き出し先のアカウント（null＝1つ目のアカウント）
alter table public.calendar_links
  add column if not exists push_account_id uuid references public.calendar_accounts(id) on delete set null;

-- 予定ごとに、どのアカウントに書いたか（null＝1つ目のアカウント）
alter table public.schedule_events
  add column if not exists google_account_id uuid references public.calendar_accounts(id) on delete set null;

-- 消したときの控えにも、どのアカウントかを残す
alter table public.google_delete_queue
  add column if not exists account_id uuid references public.calendar_accounts(id) on delete cascade;

create or replace function public.queue_google_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.google_event_id is not null then
    insert into public.google_delete_queue (user_id, google_event_id, calendar_id, account_id)
    select old.owner_user_id, old.google_event_id,
           coalesce(old.google_calendar_id, l.calendar_id, 'primary'),
           old.google_account_id
      from public.calendar_links l
     where l.user_id = old.owner_user_id;
  end if;
  return old;
end;
$function$;

-- 書き出し先・予定ごとのアカウントの欄が変わっただけでは「未同期」に戻さない（今の決まりのまま）

-- 画面に返す情報に「2つ目以降のアカウント」と「書き出し先のアカウント」を足す（トークンは返さない）
create or replace function public.my_calendar_link()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  l record;
  pending int;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into l from public.calendar_links where user_id = auth.uid();
  if l.user_id is null then
    return jsonb_build_object('connected', false);
  end if;
  select count(*) into pending
    from public.schedule_events
   where owner_user_id = auth.uid()
     and google_synced_at is null
     and ends_on >= (now() at time zone 'Asia/Tokyo')::date - 1;
  return jsonb_build_object(
    'connected',         l.refresh_token_enc is not null,
    'google_email',      l.google_email,
    'calendar_id',       l.calendar_id,
    'busy_calendar_ids', to_jsonb(l.busy_calendar_ids),
    'push_account_id',   l.push_account_id,
    'sync_push',         l.sync_push,
    'sync_pull',         l.sync_pull,
    'connected_at',      l.connected_at,
    'last_sync_at',      l.last_sync_at,
    'last_sync_error',   l.last_sync_error,
    'pending',           pending,
    'google_busy_days',  (select count(*) from public.google_busy where user_id = auth.uid()),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'google_email', a.google_email,
               'busy_calendar_ids', to_jsonb(a.busy_calendar_ids),
               'connected_at', a.connected_at,
               'last_sync_error', a.last_sync_error
             ) order by a.connected_at)
        from public.calendar_accounts a
       where a.user_id = auth.uid()
    ), '[]'::jsonb)
  );
end;
$function$;
