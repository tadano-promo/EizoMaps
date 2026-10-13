-- =====================================================================
-- 017 登録数の表示と、キリのいい数字を達成したときの自動お知らせ（2026-10-14）
--   ・管理画面の概況に「総登録数／クリエイター／一般ユーザー」を足す
--   ・登録クリエイターが 100 / 1,000 / 10,000 / 100,000 名を超えたら、
--     トップのお知らせに自動で載せる（同じ数字では二度出さない）
-- =====================================================================

-- ---------- 達成済みの節目の記録（二重に出さないため） ----------
create table if not exists public.milestones_hit (
  kind       text not null,
  value      int  not null,
  hit_at     timestamptz not null default now(),
  primary key (kind, value)
);
alter table public.milestones_hit enable row level security;
alter table public.milestones_hit force row level security;
revoke all on public.milestones_hit from anon, authenticated;

-- ---------- 登録クリエイター数の節目 ----------
create or replace function public.creator_milestone_news()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  n int;
  m int;
begin
  select count(*) into n from public.creators;
  foreach m in array array[100, 1000, 10000, 100000] loop
    if n >= m then
      insert into public.milestones_hit (kind, value) values ('creators', m)
      on conflict do nothing;
      if found then
        insert into public.announcements (kind, title, body, visibility, is_published, published_at, created_by)
        values (
          'notice',
          '登録クリエイターが ' || to_char(m, 'FM999,999') || ' 名を超えました',
          'Eizo Maps に登録しているクリエイターが ' || to_char(m, 'FM999,999') || ' 名を超えました。' || chr(10) ||
          'ご利用いただいている皆さま、ありがとうございます。これからも使いやすくなるよう更新を続けていきます。',
          'public', true, now(), null
        );
      end if;
    end if;
  end loop;
  return null;
end;
$function$;

drop trigger if exists trg_creator_milestone_news on public.creators;
create trigger trg_creator_milestone_news
  after insert on public.creators
  for each statement execute function public.creator_milestone_news();

-- ---------- 管理画面の概況に登録数を足す ----------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  total int;
  cre   int;
begin
  if not public.is_admin() then
    raise exception '権限がありません';
  end if;
  select count(*) into total from auth.users;
  select count(distinct user_id) into cre from public.creators;
  return jsonb_build_object(
    'accounts_total',     total,
    'general_users',      greatest(total - cre, 0),
    'creators',           (select count(*) from public.creators),
    'creators_published', (select count(*) from public.creators where is_published),
    'clients',            (select count(*) from public.clients),
    'projects',           (select count(*) from public.projects),
    'reviews_published',  (select count(*) from public.reviews where status = 'published'),
    'stock_pages',        (select count(*) from public.stock_pages),
    'announcements_live', (select count(*) from public.announcements where is_published),
    'ads_live',           (select count(*) from public.ads where is_active),
    'articles_draft',     (select count(*) from public.articles where status <> 'published'),
    'reports_open',       (select count(*) from public.reports where status = 'open')
  );
end;
$function$;
