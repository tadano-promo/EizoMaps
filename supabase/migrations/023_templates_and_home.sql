-- =====================================================================
-- 023 定型文のひな形・自分用トップの並び／やること（2026-10-20）
--
--   10/20 タキさん「全部やろう」（ENJOY VTUBER APP さんを見て出た5つの案）
--   ・定型文のひな形：集合案内・納品のご連絡などを、日時や場所だけ入れれば完成文にする
--   ・自分用トップ：部品の並び・出し入れ、天気の地域、簡単なやること
--
--   ★ 安全の考え方
--     ・どちらの表も、本人以外は1行も読めない・書けない
--     ・入れられる量に上限をつける（ひな形200件・1件4,000文字、やること200件）
--   ※ 「消す・外す」系の命令は使わない（確認画面で止まるため）
-- =====================================================================

-- ---------- 定型文のひな形 ----------
create table if not exists public.message_templates (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  category      text not null default 'その他',
  body          text not null default '',
  checks        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint message_templates_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint message_templates_category_len check (char_length(btrim(category)) between 1 and 20),
  constraint message_templates_body_len check (char_length(body) <= 4000),
  constraint message_templates_checks_len check (cardinality(checks) <= 12)
);
create index if not exists idx_message_templates_owner on public.message_templates (owner_user_id);

alter table public.message_templates enable row level security;
alter table public.message_templates force row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'message_templates' and policyname = 'message_templates_own') then
    create policy message_templates_own on public.message_templates
      for all to authenticated
      using (owner_user_id = auth.uid())
      with check (owner_user_id = auth.uid());
  end if;
end $$;

grant select, delete on public.message_templates to authenticated;
grant insert (name, category, body, checks) on public.message_templates to authenticated;
grant update (name, category, body, checks) on public.message_templates to authenticated;

create or replace trigger trg_message_templates_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

-- 1人200件まで／チェック項目は1つ30文字まで
create or replace function public.message_templates_guard()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare c text;
begin
  if tg_op = 'INSERT' and (select count(*) from public.message_templates where owner_user_id = new.owner_user_id) >= 200 then
    raise exception '作れるひな形は200件までです';
  end if;
  foreach c in array coalesce(new.checks, '{}'::text[]) loop
    if char_length(c) > 30 then
      raise exception '送る前のチェックは1つ30文字までです';
    end if;
  end loop;
  return new;
end;
$function$;

create or replace trigger trg_message_templates_guard
  before insert or update on public.message_templates
  for each row execute function public.message_templates_guard();

-- ---------- 自分用トップ（部品の並び・天気の地域・やること） ----------
create table if not exists public.user_home (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  widgets      jsonb not null default '[]'::jsonb,
  weather_pref text,
  todos        jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now(),
  constraint user_home_widgets_array check (jsonb_typeof(widgets) = 'array' and jsonb_array_length(widgets) <= 20),
  constraint user_home_todos_array check (jsonb_typeof(todos) = 'array' and jsonb_array_length(todos) <= 200),
  constraint user_home_size check (pg_column_size(todos) + pg_column_size(widgets) <= 65536),
  constraint user_home_pref_len check (weather_pref is null or char_length(weather_pref) <= 10)
);

alter table public.user_home enable row level security;
alter table public.user_home force row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'user_home' and policyname = 'user_home_own') then
    create policy user_home_own on public.user_home
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

grant select on public.user_home to authenticated;
grant insert (widgets, weather_pref, todos) on public.user_home to authenticated;
grant update (widgets, weather_pref, todos) on public.user_home to authenticated;

create or replace trigger trg_user_home_updated_at
  before update on public.user_home
  for each row execute function public.set_updated_at();
