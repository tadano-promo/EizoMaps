-- =====================================================================
-- 019 日ごとの表示：大枠の中の「小枠」（2026-10-15）
--   大枠 = 今までの予定（schedule_events）。例：[撮影] ◯◯CM 6:00〜22:00
--   小枠 = 大枠の中の細かい動き。班（列）の名前は自由入力。
--          例：車両部「弁当ピックアップ」10:30〜11:30／別班「キャスト迎え」7:00〜8:00
--   小枠は「どの日の分か（day）」と「その日の0時から何分後か」で持つ。
--   2880分（48時間）まで入るので、夜通しの撮影で翌朝まで続いても 25:00 のように表せる
--   今回は本人だけが見られる。共有は次の段階で足す。
--   ※ 「消す・外す」系の命令は使わない（確認画面で止まるため）
-- =====================================================================

create table if not exists public.schedule_items (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.schedule_events(id) on delete cascade,
  day           date not null,
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lane          text not null,
  title         text not null,
  start_min     int  not null,
  end_min       int  not null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint schedule_items_lane_len  check (char_length(lane)  between 1 and 40),
  constraint schedule_items_title_len check (char_length(title) between 1 and 100),
  constraint schedule_items_note_len  check (note is null or char_length(note) <= 500),
  constraint schedule_items_range     check (start_min >= 0 and end_min > start_min and end_min <= 2880)
);

create index if not exists idx_schedule_items_event on public.schedule_items (event_id);
create index if not exists idx_schedule_items_owner on public.schedule_items (owner_user_id);
create index if not exists idx_schedule_items_owner_day on public.schedule_items (owner_user_id, day);

alter table public.schedule_items enable row level security;
alter table public.schedule_items force row level security;

-- 小枠は、大枠の持ち主だけが見る・作る・直す・消す
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'schedule_items' and policyname = 'schedule_items_own') then
    create policy schedule_items_own on public.schedule_items
      for all to authenticated
      using (owner_user_id = auth.uid())
      with check (
        owner_user_id = auth.uid()
        and exists (select 1 from public.schedule_events e
                     where e.id = event_id and e.owner_user_id = auth.uid())
      );
  end if;
end $$;

grant select, insert, update, delete on public.schedule_items to authenticated;
grant select, insert, update, delete on public.schedule_items to service_role;

-- 1つの大枠に入れられる小枠は200まで
create or replace function public.schedule_items_limit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if (select count(*) from public.schedule_items where event_id = new.event_id) >= 200 then
    raise exception '1つの予定に入れられる小枠は200までです';
  end if;
  return new;
end;
$function$;

create or replace trigger trg_schedule_items_limit
  before insert on public.schedule_items
  for each row execute function public.schedule_items_limit();

create or replace trigger trg_schedule_items_updated_at
  before update on public.schedule_items
  for each row execute function public.set_updated_at();
