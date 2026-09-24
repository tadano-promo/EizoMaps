-- =====================================================================
--  Eizo Maps / 追加マイグレーション 003
--  スケジュール（縦型カレンダー）と空き状況
--  ---------------------------------------------------------------
--  実行方法: Supabase ダッシュボード > SQL Editor に貼り付けて実行
--  何度実行しても同じ結果になります。
--
--  ★ このファイルのセキュリティ方針
--    1. 予定の中身は、本人と「その案件の当事者」以外には1行も見せない。
--    2. 空き状況は、本人が公開を選んだときだけ、
--       「日付が埋まっているか」だけを返す。件名も場所も返さない。
--    3. 期間指定は関数側で上限を設け、重い全件走査をさせない。
--    4. Google カレンダー連携は後から足せるよう、
--       外部カレンダー側の ID を置く列だけ先に用意しておく。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 23-A. creators への追加列（空き状況を公開するか）
-- ---------------------------------------------------------------------
alter table public.creators
  add column if not exists share_availability boolean not null default false;

-- ---------------------------------------------------------------------
-- 23-B. schedule_events : 予定
--   kind    … shoot 撮影 / edit 編集 / meeting 打合せ / delivery 納品
--             hold 仮押さえ / other その他 / private 非公開の私用
--   busy    … 空き状況の判定に含めるか（下見や仮押さえを外せるように）
--   visibility
--           … project : その案件の当事者（クリエイターとクライアント）に見える
--             private : 本人だけ。他人には「埋まっている」ことしか伝わらない
-- ---------------------------------------------------------------------
create table if not exists public.schedule_events (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  kind            text not null default 'other'
                    check (kind in ('shoot','edit','meeting','delivery','hold','other','private')),
  title           text not null check (char_length(title) between 1 and 100),
  note            text check (note is null or char_length(note) <= 1000),
  location        text check (location is null or char_length(location) <= 120),
  starts_on       date not null,
  ends_on         date not null,
  start_time      time,
  end_time        time,
  busy            boolean not null default true,
  visibility      text not null default 'private' check (visibility in ('project','private')),
  color           text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  -- 将来の外部カレンダー連携用（今は使わない。連携時にここへ相手側の ID を入れる）
  google_event_id text check (google_event_id is null or char_length(google_event_id) <= 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint schedule_events_range check (ends_on >= starts_on),
  constraint schedule_events_span  check (ends_on - starts_on <= 366),
  constraint schedule_events_time  check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is null)
    or (start_time is not null and end_time is not null)
  ),
  -- 案件に紐づいていない予定を「案件の当事者に公開」にはできない
  constraint schedule_events_visibility check (visibility = 'private' or project_id is not null)
);
alter table public.schedule_events enable row level security;
alter table public.schedule_events force row level security;

create index if not exists idx_schedule_owner
  on public.schedule_events (owner_user_id, starts_on, ends_on);
create index if not exists idx_schedule_project
  on public.schedule_events (project_id, starts_on);
create index if not exists idx_schedule_busy
  on public.schedule_events (owner_user_id, starts_on, ends_on) where busy;

drop trigger if exists trg_schedule_events_updated_at on public.schedule_events;
create trigger trg_schedule_events_updated_at before update on public.schedule_events
  for each row execute function public.set_updated_at();

-- 無料枠での濫用防止: 1人あたり最大2000件
create or replace function public.check_schedule_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.schedule_events where owner_user_id = new.owner_user_id) >= 2000 then
    raise exception '登録できる予定の上限（2000件）に達しています';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_schedule_limit on public.schedule_events;
create trigger trg_schedule_limit before insert on public.schedule_events
  for each row execute function public.check_schedule_limit();

-- ---------------------------------------------------------------------
-- 23-C. 補助関数
-- ---------------------------------------------------------------------

-- 自分がその案件の当事者か（クリエイター側でもクライアント側でも可）
create or replace function public.can_see_project_schedule(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.projects p
      left join public.creators c on c.id = p.creator_id
      left join public.clients  cl on cl.id = p.client_id
     where p.id = p_project_id
       and (c.user_id = auth.uid() or cl.user_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------
-- 23-D. RLS ポリシー
-- ---------------------------------------------------------------------

-- 本人はすべて
drop policy if exists schedule_select_own on public.schedule_events;
create policy schedule_select_own on public.schedule_events
  for select to authenticated using (owner_user_id = auth.uid());

-- 案件の当事者は、その案件に紐づく「案件公開」の予定だけ
drop policy if exists schedule_select_party on public.schedule_events;
create policy schedule_select_party on public.schedule_events
  for select to authenticated
  using (visibility = 'project'
         and project_id is not null
         and public.can_see_project_schedule(project_id));

drop policy if exists schedule_insert_own on public.schedule_events;
create policy schedule_insert_own on public.schedule_events
  for insert to authenticated with check (owner_user_id = auth.uid());

drop policy if exists schedule_update_own on public.schedule_events;
create policy schedule_update_own on public.schedule_events
  for update to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists schedule_delete_own on public.schedule_events;
create policy schedule_delete_own on public.schedule_events
  for delete to authenticated using (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 23-E. 空き状況の RPC
--   返すのは「クリエイターID」か「日付」だけ。
--   件名・場所・メモは絶対に返さない。
--   公開を選んでいないクリエイターは、そもそも対象に入らない。
-- ---------------------------------------------------------------------

-- 指定期間に1日でも埋まっている公開クリエイターの ID を返す。
-- 検索画面はこの結果を除外して「空いている人」を出す。
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
       and e.ends_on   >= p_from;
end;
$$;

-- 1人のクリエイターについて、埋まっている日だけを返す。
-- 公開を選んでいない場合は1行も返さない。
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
     where e.owner_user_id = uid and e.busy;
end;
$$;

-- ---------------------------------------------------------------------
-- 23-F. 権限（列を明示）
--   owner_user_id は既定値（auth.uid()）で入る。名乗りを偽装させないため渡さない。
--   google_event_id は連携の仕組みが入るまで渡さない。
-- ---------------------------------------------------------------------
grant update (share_availability) on public.creators to authenticated;
grant insert (share_availability) on public.creators to authenticated;

grant select on public.schedule_events to authenticated;
grant insert (project_id, kind, title, note, location, starts_on, ends_on,
              start_time, end_time, busy, visibility, color)
  on public.schedule_events to authenticated;
grant update (project_id, kind, title, note, location, starts_on, ends_on,
              start_time, end_time, busy, visibility, color)
  on public.schedule_events to authenticated;
grant delete on public.schedule_events to authenticated;

grant execute on function public.can_see_project_schedule(uuid)              to authenticated;
grant execute on function public.creators_busy_between(date, date)           to anon, authenticated;
grant execute on function public.creator_busy_days(uuid, date, date)         to anon, authenticated;
