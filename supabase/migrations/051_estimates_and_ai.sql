-- 051 実行表（見積もり・実行予算）と、AI で読み取るときの使用量の上限（2026-11-15 翠くん）
--   ・estimates：本人だけが見られる・書ける。中身（行・前提条件）は data にまとめて入れる
--   ・AI の使用量は月ごとに円で数える。月 3,000円（app_internal 'ai_month_cap_yen'）を超えたら止める
--     1人1日 30回まで。料金は多めに見積もった単価で数える（実際の請求が上限を超えないように）
create table if not exists public.estimates (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null default '無題の実行表' check (char_length(title) between 1 and 100),
  data          jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 200000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.estimates enable row level security;
alter table public.estimates force row level security;
create index if not exists idx_estimates_owner on public.estimates (owner_user_id, updated_at desc);
drop trigger if exists trg_estimates_updated_at on public.estimates;
create trigger trg_estimates_updated_at before update on public.estimates
  for each row execute function public.set_updated_at();

drop policy if exists estimates_own on public.estimates;
create policy estimates_own on public.estimates for all to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
revoke all on public.estimates from anon, authenticated;
grant select, delete on public.estimates to authenticated;
grant insert (title, data) on public.estimates to authenticated;
grant update (title, data) on public.estimates to authenticated;

-- 1人あたりの数の上限（たくさん作られすぎないように）
create or replace function public.check_estimate_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.estimates where owner_user_id = new.owner_user_id) >= 300 then
    raise exception '実行表は300件までです。使わないものを消してから作ってください';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_estimates_limit on public.estimates;
create trigger trg_estimates_limit before insert on public.estimates
  for each row execute function public.check_estimate_limit();

-- AI の使用量
create table if not exists public.ai_usage (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  feature    text not null,
  tokens_in  integer not null default 0,
  tokens_out integer not null default 0,
  yen        numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
revoke all on public.ai_usage from anon, authenticated;
create index if not exists idx_ai_usage_month on public.ai_usage (created_at);

insert into public.app_internal (key, value) values
  ('ai_month_cap_yen', '3000'),
  ('ai_user_daily_limit', '30'),
  -- 100万トークンあたりの円（多めに見積もった値。実際より高く数えて、上限を超えないようにする）
  ('ai_yen_per_mtok_in', '600'),
  ('ai_yen_per_mtok_out', '3000')
on conflict (key) do nothing;

-- いま AI を使ってよいか（関数 estimate-ai から呼ぶ）
create or replace function public.ai_can_use(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'month_yen', coalesce((select sum(yen) from public.ai_usage where created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'), 0),
    'cap_yen', (select value::numeric from public.app_internal where key = 'ai_month_cap_yen'),
    'user_today', (select count(*) from public.ai_usage where user_id = p_user and created_at >= date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'),
    'user_limit', (select value::int from public.app_internal where key = 'ai_user_daily_limit'),
    'in_rate', (select value::numeric from public.app_internal where key = 'ai_yen_per_mtok_in'),
    'out_rate', (select value::numeric from public.app_internal where key = 'ai_yen_per_mtok_out'));
$$;
revoke all on function public.ai_can_use(uuid) from public, anon, authenticated;
grant execute on function public.ai_can_use(uuid) to service_role;

-- 運営画面で今月の使用量を見る
create or replace function public.admin_ai_usage()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_admins a where a.user_id = auth.uid()) then raise exception '運営だけが見られます'; end if;
  return public.ai_can_use(null) || jsonb_build_object('month_count',
    (select count(*) from public.ai_usage where created_at >= date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo'));
end;
$$;
revoke all on function public.admin_ai_usage() from public, anon;
grant execute on function public.admin_ai_usage() to authenticated;
