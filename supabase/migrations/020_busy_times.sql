-- =====================================================================
-- 020 ほかの人には「予定あり」の時間だけを見せる（2026-10-17）
--   ・プロフィールの空き状況で、埋まっている日を押すと「何時から何時まで埋まっているか」が見える
--   ・見せるのは時間だけ。件名・場所・小枠・案件名は一切出さない
--   ・空き状況を公開している（share_availability）クリエイターだけ
--   ・Google カレンダーの予定も、時間の幅だけ保存して使う（中身は保存しない）
--   ※ 「消す・外す」系の命令は使わない（確認画面で止まるため）
-- =====================================================================

-- ---------- Google 側で埋まっている時間の幅（日付＋その日の0時から何分後か） ----------
create table if not exists public.google_busy_ranges (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  start_min  int  not null,
  end_min    int  not null,
  created_at timestamptz not null default now(),
  constraint google_busy_ranges_range check (start_min >= 0 and end_min > start_min and end_min <= 1440)
);
create index if not exists idx_google_busy_ranges_user_day on public.google_busy_ranges (user_id, day);

alter table public.google_busy_ranges enable row level security;
alter table public.google_busy_ranges force row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'google_busy_ranges' and policyname = 'google_busy_ranges_select_own') then
    create policy google_busy_ranges_select_own on public.google_busy_ranges
      for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

grant select on public.google_busy_ranges to authenticated;
grant select, insert, delete on public.google_busy_ranges to service_role;

-- ---------- 公開用：埋まっている時間だけを返す ----------
create or replace function public.creator_busy_times(p_creator_id uuid, p_from date, p_to date)
returns table (day date, start_min int, end_min int)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  uid uuid;
  e record;
  d date;
  s int;
  t int;
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

  -- Eizo Maps の予定（「埋まっている」にしてあるものだけ）
  for e in
    select starts_on, ends_on, start_time, end_time
      from public.schedule_events
     where owner_user_id = uid and busy
       and starts_on <= p_to and ends_on >= p_from
  loop
    d := greatest(e.starts_on, p_from);
    while d <= least(e.ends_on, p_to) loop
      if e.start_time is null then
        s := 0; t := 1440;                                   -- 時間なし＝終日
      else
        s := case when d = e.starts_on then extract(hour from e.start_time)::int * 60 + extract(minute from e.start_time)::int else 0 end;
        if d = e.ends_on and e.end_time is not null then
          t := extract(hour from e.end_time)::int * 60 + extract(minute from e.end_time)::int;
          if t <= s then t := 1440; end if;                 -- 夜をまたぐときは、その日は24時まで
        elsif d = e.ends_on and d = e.starts_on then
          t := least(s + 60, 1440);                         -- 終了時刻なしの単日予定は1時間とみなす
        else
          t := 1440;
        end if;
      end if;
      if t > s then
        day := d; start_min := s; end_min := t;
        return next;
      end if;
      d := d + 1;
    end loop;
  end loop;

  -- Google カレンダー側（時間の幅だけ）
  return query
    select g.day, g.start_min, g.end_min
      from public.google_busy_ranges g
      join public.calendar_links l on l.user_id = g.user_id and l.sync_pull
     where g.user_id = uid and g.day between p_from and p_to;
end;
$function$;

grant execute on function public.creator_busy_times(uuid, date, date) to anon, authenticated;
