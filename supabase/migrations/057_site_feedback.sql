-- =====================================================================
--  057: 「Eizo Maps への意見」を、相手への評価とは別に送れるようにする（2026-11-17 翠くん）
--  翠くん「Eizo Maps の使いにくさによって星が下がっちゃうみたいなことが…絶対にそれはないようにしたくて、
--        クリエイターの正当な評価をもらえるような感じの流れで進行していけないと意味ない」
--  ・評価を書く画面で、サイトの使いにくさはこちらへ書いてもらう（運営だけが読む・評価には入らない）
-- =====================================================================
create table if not exists public.site_feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  page        text check (page is null or char_length(page) <= 100),
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
alter table public.site_feedback enable row level security;
alter table public.site_feedback force row level security;
revoke all on public.site_feedback from anon, authenticated;
grant insert (project_id, page, body) on public.site_feedback to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='site_feedback' and policyname='site_feedback_insert_own') then
    create policy site_feedback_insert_own on public.site_feedback for insert to authenticated with check (user_id = auth.uid());
  end if;
end $$;
-- 1人1日20件まで
create or replace function public.site_feedback_limit() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if (select count(*) from public.site_feedback where user_id = new.user_id and created_at > now() - interval '1 day') >= 20 then
    raise exception '今日はこれ以上送れません。明日またお願いします';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_feedback_limit on public.site_feedback;
create trigger trg_site_feedback_limit before insert on public.site_feedback for each row execute function public.site_feedback_limit();
