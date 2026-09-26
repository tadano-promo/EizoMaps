-- =====================================================================
--  Eizo Maps / 追加マイグレーション 005
--  Google カレンダー連携（任意の上乗せ）
--  ---------------------------------------------------------------
--  実行方法: Supabase ダッシュボード > SQL Editor に貼り付けて実行
--  何度実行しても同じ結果になります。
--
--  ★ 方針
--    連携は必須ではない。連携しなくても Eizo Maps だけで完結する。
--    連携した人だけ、予定が Google カレンダーに入り、
--    Google 側の予定も「埋まっている日」に含められる。
--
--  ★ セキュリティ方針
--    1. Google のリフレッシュトークンは、この DB には平文で置かない。
--       Edge Function が AES-GCM で暗号化したものだけを保存する。
--       復号の鍵は Edge Function の環境変数にしか無いので、
--       仮に DB を丸ごと抜かれてもトークンは使えない。
--    2. calendar_links にはポリシーを1つも作らない。
--       = anon も authenticated も1行も読めない。触るのは Edge Function だけ。
--    3. 本人が自分の連携状態を知るための入口は RPC 1本だけで、
--       そこでもトークンは絶対に返さない。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 25-A. calendar_links : 外部カレンダーとの連携
-- ---------------------------------------------------------------------
create table if not exists public.calendar_links (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  provider           text not null default 'google' check (provider in ('google')),
  google_email       text check (google_email is null or char_length(google_email) <= 200),
  google_sub         text check (google_sub is null or char_length(google_sub) <= 100),
  calendar_id        text not null default 'primary' check (char_length(calendar_id) <= 200),
  scope              text check (scope is null or char_length(scope) <= 500),
  -- 暗号文のみ。平文は決して入れない。
  refresh_token_enc  text,
  sync_push          boolean not null default true,   -- Eizo Maps → Google
  sync_pull          boolean not null default true,   -- Google → 空き判定
  connected_at       timestamptz not null default now(),
  last_sync_at       timestamptz,
  last_sync_error    text check (last_sync_error is null or char_length(last_sync_error) <= 500),
  updated_at         timestamptz not null default now()
);
alter table public.calendar_links enable row level security;
alter table public.calendar_links force row level security;
-- ポリシーは意図的に1つも作らない（Edge Function だけが触る）

drop trigger if exists trg_calendar_links_updated_at on public.calendar_links;
create trigger trg_calendar_links_updated_at before update on public.calendar_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 25-B. google_busy : Google カレンダー側で埋まっている日
--   予定の中身は取り込まない。日付だけ。
-- ---------------------------------------------------------------------
create table if not exists public.google_busy (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.google_busy enable row level security;
alter table public.google_busy force row level security;
create index if not exists idx_google_busy_day on public.google_busy (day);

-- 本人だけ、自分の分を読める（画面に出すため）
drop policy if exists google_busy_select_own on public.google_busy;
create policy google_busy_select_own on public.google_busy
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 25-C. schedule_events に同期の記録を足す
-- ---------------------------------------------------------------------
alter table public.schedule_events
  add column if not exists google_synced_at timestamptz;

-- 中身が変わったら「未同期」に戻す。
-- google_event_id は消さない（Google 側の同じ予定を更新するため）。
create or replace function public.mark_schedule_unsynced()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.title, new.note, new.location, new.starts_on, new.ends_on,
      new.start_time, new.end_time, new.kind)
     is distinct from
     (old.title, old.note, old.location, old.starts_on, old.ends_on,
      old.start_time, old.end_time, old.kind) then
    new.google_synced_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_schedule_unsynced on public.schedule_events;
create trigger trg_schedule_unsynced before update on public.schedule_events
  for each row execute function public.mark_schedule_unsynced();

-- ---------------------------------------------------------------------
-- 25-C2. google_delete_queue : Eizo Maps で消した予定を Google 側でも消す
--   予定を削除すると行が消えてしまい、Google 側に幽霊の予定が残るため、
--   削除の瞬間に「Google のどの予定を消すか」だけを控えておく。
--   ここにも権限は与えない（Edge Function だけが読んで消す）。
-- ---------------------------------------------------------------------
create table if not exists public.google_delete_queue (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  google_event_id text not null check (char_length(google_event_id) <= 200),
  calendar_id     text not null default 'primary',
  created_at      timestamptz not null default now()
);
alter table public.google_delete_queue enable row level security;
alter table public.google_delete_queue force row level security;
create index if not exists idx_gdq_user on public.google_delete_queue (user_id, created_at);

-- ユーザーにはこのテーブルの権限が無いので、定義者権限で書き込む
create or replace function public.queue_google_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.google_event_id is not null then
    insert into public.google_delete_queue (user_id, google_event_id, calendar_id)
    select old.owner_user_id, old.google_event_id, coalesce(l.calendar_id, 'primary')
      from public.calendar_links l
     where l.user_id = old.owner_user_id;
  end if;
  return old;
end;
$$;
drop trigger if exists trg_queue_google_delete on public.schedule_events;
create trigger trg_queue_google_delete after delete on public.schedule_events
  for each row execute function public.queue_google_delete();

-- ---------------------------------------------------------------------
-- 25-D. 本人向けの RPC（トークンは絶対に返さない）
-- ---------------------------------------------------------------------
create or replace function public.my_calendar_link()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    'connected',       l.refresh_token_enc is not null,
    'google_email',    l.google_email,
    'calendar_id',     l.calendar_id,
    'sync_push',       l.sync_push,
    'sync_pull',       l.sync_pull,
    'connected_at',    l.connected_at,
    'last_sync_at',    l.last_sync_at,
    'last_sync_error', l.last_sync_error,
    'pending',         pending,
    'google_busy_days',(select count(*) from public.google_busy where user_id = auth.uid())
  );
end;
$$;

create or replace function public.set_calendar_sync(p_push boolean, p_pull boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  update public.calendar_links
     set sync_push = coalesce(p_push, sync_push),
         sync_pull = coalesce(p_pull, sync_pull)
   where user_id = auth.uid();
  if not found then
    raise exception 'Google カレンダーと連携していません';
  end if;
  -- 取り込みを止めたら、取り込み済みの日付も消す
  if p_pull is false then
    delete from public.google_busy where user_id = auth.uid();
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 25-E. 空き判定に Google 側の予定も含める
--   連携していて、かつ取り込みを有効にしている人だけが対象。
--   返すのは今までどおり ID と日付だけ。
-- ---------------------------------------------------------------------
create or replace function public.creators_busy_between(p_from date, p_to date)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    return;
  end if;
  if p_to - p_from > 186 then
    raise exception '期間が長すぎます（半年以内で指定してください）';
  end if;

  return query
    select distinct c.id
      from public.creators c
      join public.schedule_events e on e.owner_user_id = c.user_id
     where c.is_published
       and c.share_availability
       and e.busy
       and e.starts_on <= p_to
       and e.ends_on   >= p_from
    union
    select distinct c.id
      from public.creators c
      join public.calendar_links l on l.user_id = c.user_id and l.sync_pull
      join public.google_busy g    on g.user_id = c.user_id
     where c.is_published
       and c.share_availability
       and g.day between p_from and p_to;
end;
$$;

create or replace function public.creator_busy_days(p_creator_id uuid, p_from date, p_to date)
returns setof date language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if p_from is null or p_to is null or p_to < p_from then
    return;
  end if;
  if p_to - p_from > 186 then
    raise exception '期間が長すぎます（半年以内で指定してください）';
  end if;

  select c.user_id into uid
    from public.creators c
   where c.id = p_creator_id and c.is_published and c.share_availability;
  if uid is null then
    return;
  end if;

  return query
    select distinct d::date
      from public.schedule_events e
      cross join lateral generate_series(
        greatest(e.starts_on, p_from),
        least(e.ends_on, p_to),
        interval '1 day') as d
     where e.owner_user_id = uid and e.busy
    union
    select g.day
      from public.google_busy g
      join public.calendar_links l on l.user_id = g.user_id and l.sync_pull
     where g.user_id = uid and g.day between p_from and p_to;
end;
$$;

-- ---------------------------------------------------------------------
-- 25-F. 権限
--   calendar_links には一切 GRANT しない（意図的）。
-- ---------------------------------------------------------------------
grant select on public.google_busy to authenticated;

grant execute on function public.my_calendar_link()                  to authenticated;
grant execute on function public.set_calendar_sync(boolean, boolean) to authenticated;
