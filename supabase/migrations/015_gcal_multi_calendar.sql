-- =====================================================================
-- 015 Google カレンダーを複数使い分けている人向け（2026-10-13）
--   ・書き込み先のカレンダーを選べる（calendar_links.calendar_id を使う）
--   ・空き判定に使うカレンダーを複数選べる（busy_calendar_ids）
--   ・予定ごとに「どのカレンダーに書いたか」を覚える（google_calendar_id）
--     → 書き込み先を途中で変えても、前に書いた予定を正しく直せる・消せる
-- =====================================================================

alter table public.calendar_links
  add column if not exists busy_calendar_ids text[];

alter table public.calendar_links drop constraint if exists calendar_links_busy_ids_check;
alter table public.calendar_links
  add constraint calendar_links_busy_ids_check
  check (busy_calendar_ids is null or cardinality(busy_calendar_ids) <= 20);

alter table public.schedule_events
  add column if not exists google_calendar_id text;

alter table public.schedule_events drop constraint if exists schedule_events_gcal_id_len;
alter table public.schedule_events
  add constraint schedule_events_gcal_id_len
  check (google_calendar_id is null or char_length(google_calendar_id) <= 300);

-- 既に Google に書いた予定は、今の書き込み先（ほぼ primary）に書いたものとして覚えておく
update public.schedule_events e
   set google_calendar_id = coalesce(l.calendar_id, 'primary')
  from public.calendar_links l
 where l.user_id = e.owner_user_id
   and e.google_event_id is not null
   and e.google_calendar_id is null;

-- 消したときの控え：予定ごとに覚えたカレンダーを優先する
create or replace function public.queue_google_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.google_event_id is not null then
    insert into public.google_delete_queue (user_id, google_event_id, calendar_id)
    select old.owner_user_id, old.google_event_id,
           coalesce(old.google_calendar_id, l.calendar_id, 'primary')
      from public.calendar_links l
     where l.user_id = old.owner_user_id;
  end if;
  return old;
end;
$function$;

-- 画面に返す情報に「空き判定に使うカレンダー」を足す
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
    'sync_push',         l.sync_push,
    'sync_pull',         l.sync_pull,
    'connected_at',      l.connected_at,
    'last_sync_at',      l.last_sync_at,
    'last_sync_error',   l.last_sync_error,
    'pending',           pending,
    'google_busy_days',  (select count(*) from public.google_busy where user_id = auth.uid())
  );
end;
$function$;
