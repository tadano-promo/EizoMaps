-- =====================================================================
--  Eizo Maps / Supabase スキーマ定義
--  ---------------------------------------------------------------
--  実行方法: Supabase ダッシュボード > SQL Editor に貼り付けて実行
--  このファイルは何度実行しても同じ結果になるよう書いてあります
--  （drop → create ではなく if not exists / or replace を使用）
--
--  ★ 設計方針（セキュリティ最優先）
--    1. 全テーブルで RLS を有効化する。例外なし。
--    2. anon / authenticated からいったん全権限を剥奪し、
--       必要な操作・必要な「列」だけを明示的に付与し直す。
--       → RLS は「行」しか守れないため、status や is_admin のような
--          ユーザーに触らせたくない列は GRANT（列単位権限）で守る。
--    3. 限定公開ポートフォリオはテーブルを直接読ませず、
--       SECURITY DEFINER 関数（RPC）経由でのみ取得させる。
--    4. 文字数・形式の CHECK 制約を全テキスト列に付け、
--       巨大データ投入や不正 URL 埋め込みを DB 層で弾く。
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 0. 共通ユーティリティ
-- ---------------------------------------------------------------------

-- updated_at 自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 管理者テーブル（運営のみ）
-- RLS を有効にしたうえでポリシーを1つも作らない = 誰も読めない/書けない。
-- service_role（サーバー側の鍵）だけが RLS を迂回して操作できる。
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
alter table public.app_admins force row level security;

-- 管理者判定。app_admins を直接読ませないため SECURITY DEFINER。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;

-- 生存確認用（GitHub Actions の keepalive から呼ぶ）
create or replace function public.ping()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'ok'::text;
$$;

-- ---------------------------------------------------------------------
-- 1. users : ログインアカウントに紐づく最小限の情報
--    メールアドレスは auth.users にのみ保持し、public 側には複製しない
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  account_type text not null default 'creator'
               check (account_type in ('creator','client','both')),
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  onboarded    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.users enable row level security;
alter table public.users force row level security;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- サインアップ時に public.users の行を自動生成する
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. genres : 職種マスタ（読み取り専用。追加は運営が service_role で行う）
-- ---------------------------------------------------------------------
create table if not exists public.genres (
  id         smallint primary key,
  slug       text not null unique check (slug ~ '^[a-z0-9_-]{2,32}$'),
  name_ja    text not null check (char_length(name_ja) between 1 and 30),
  sort_order smallint not null default 0
);
alter table public.genres enable row level security;
alter table public.genres force row level security;

-- ---------------------------------------------------------------------
-- 3. creators : クリエイタープロフィール
-- ---------------------------------------------------------------------
create table if not exists public.creators (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references auth.users(id) on delete cascade,
  display_name        text not null check (char_length(display_name) between 1 and 40),
  headline            text check (headline is null or char_length(headline) <= 80),
  bio                 text check (bio is null or char_length(bio) <= 2000),
  area_pref           text check (area_pref is null or char_length(area_pref) <= 20),
  area_city           text check (area_city is null or char_length(area_city) <= 40),
  years_of_experience smallint check (years_of_experience between 0 and 70),
  response_time_hours smallint check (response_time_hours between 0 and 720),
  avatar_url          text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500)),
  website_url         text check (website_url is null or (website_url ~ '^https://' and char_length(website_url) <= 500)),
  is_published        boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.creators enable row level security;
alter table public.creators force row level security;

create index if not exists idx_creators_published on public.creators (is_published, updated_at desc);
create index if not exists idx_creators_area on public.creators (area_pref) where is_published;

drop trigger if exists trg_creators_updated_at on public.creators;
create trigger trg_creators_updated_at before update on public.creators
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. creator_genres : クリエイター × 職種（複数可・最大6件）
-- ---------------------------------------------------------------------
create table if not exists public.creator_genres (
  creator_id uuid not null references public.creators(id) on delete cascade,
  genre_id   smallint not null references public.genres(id) on delete cascade,
  primary key (creator_id, genre_id)
);
alter table public.creator_genres enable row level security;
alter table public.creator_genres force row level security;
create index if not exists idx_creator_genres_genre on public.creator_genres (genre_id);

create or replace function public.check_creator_genre_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.creator_genres where creator_id = new.creator_id) >= 6 then
    raise exception '職種は最大6件までです';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_creator_genre_limit on public.creator_genres;
create trigger trg_creator_genre_limit before insert on public.creator_genres
  for each row execute function public.check_creator_genre_limit();

-- ---------------------------------------------------------------------
-- 5. clients : クライアントプロフィール（公開しない）
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  company      text check (company is null or char_length(company) <= 80),
  area_pref    text check (area_pref is null or char_length(area_pref) <= 20),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.clients enable row level security;
alter table public.clients force row level security;

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6. portfolios : ポートフォリオ作品（動画ファイルは持たず URL 参照のみ）
-- ---------------------------------------------------------------------
create table if not exists public.portfolios (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.creators(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 80),
  description   text check (description is null or char_length(description) <= 1000),
  provider      text not null check (provider in ('youtube','vimeo')),
  video_id      text not null check (video_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  video_url     text not null check (
                  video_url ~ '^https://(www\.)?(youtube\.com/|youtu\.be/|vimeo\.com/|player\.vimeo\.com/)'
                  and char_length(video_url) <= 500),
  thumbnail_url text check (thumbnail_url is null or (thumbnail_url ~ '^https://' and char_length(thumbnail_url) <= 500)),
  visibility    text not null default 'public' check (visibility in ('public','link_only')),
  sort_order    smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.portfolios enable row level security;
alter table public.portfolios force row level security;
create index if not exists idx_portfolios_creator on public.portfolios (creator_id, sort_order, created_at desc);

drop trigger if exists trg_portfolios_updated_at on public.portfolios;
create trigger trg_portfolios_updated_at before update on public.portfolios
  for each row execute function public.set_updated_at();

-- 無料枠での濫用防止: 1クリエイターあたり最大30作品
create or replace function public.check_portfolio_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.portfolios where creator_id = new.creator_id) >= 30 then
    raise exception '登録できる作品数の上限（30件）に達しています';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_portfolio_limit on public.portfolios;
create trigger trg_portfolio_limit before insert on public.portfolios
  for each row execute function public.check_portfolio_limit();

-- ---------------------------------------------------------------------
-- 7. portfolio_tags : 作品タグ（最大8件）
-- ---------------------------------------------------------------------
create table if not exists public.portfolio_tags (
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  tag          text not null check (char_length(tag) between 1 and 20),
  primary key (portfolio_id, tag)
);
alter table public.portfolio_tags enable row level security;
alter table public.portfolio_tags force row level security;
create index if not exists idx_portfolio_tags_tag on public.portfolio_tags (tag);

create or replace function public.check_portfolio_tag_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.portfolio_tags where portfolio_id = new.portfolio_id) >= 8 then
    raise exception 'タグは最大8件までです';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_portfolio_tag_limit on public.portfolio_tags;
create trigger trg_portfolio_tag_limit before insert on public.portfolio_tags
  for each row execute function public.check_portfolio_tag_limit();

-- ---------------------------------------------------------------------
-- 8. share_links : 営業用の限定共有リンク
--    token は DB 側で生成する（ユーザーに列権限を与えない = 偽造不可）
-- ---------------------------------------------------------------------
create table if not exists public.share_links (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  token      text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  title      text check (title is null or char_length(title) <= 80),
  note       text check (note is null or char_length(note) <= 500),
  is_active  boolean not null default true,
  expires_at timestamptz,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.share_links enable row level security;
alter table public.share_links force row level security;
create index if not exists idx_share_links_creator on public.share_links (creator_id, created_at desc);

create table if not exists public.share_link_items (
  share_link_id uuid not null references public.share_links(id) on delete cascade,
  portfolio_id  uuid not null references public.portfolios(id) on delete cascade,
  sort_order    smallint not null default 0,
  primary key (share_link_id, portfolio_id)
);
alter table public.share_link_items enable row level security;
alter table public.share_link_items force row level security;

-- 1クリエイターあたりのリンク数上限
create or replace function public.check_share_link_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.share_links where creator_id = new.creator_id) >= 50 then
    raise exception '共有リンクの上限（50件）に達しています。不要なリンクを削除してください';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_share_link_limit on public.share_links;
create trigger trg_share_link_limit before insert on public.share_links
  for each row execute function public.check_share_link_limit();

-- ---------------------------------------------------------------------
-- 9. projects : 案件
-- ---------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  creator_id    uuid not null references public.creators(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 100),
  description   text check (description is null or char_length(description) <= 4000),
  kind          text check (kind is null or char_length(kind) <= 30),
  status        text not null default 'draft'
                check (status in ('draft','offered','in_progress','delivered','paid','closed','cancelled')),
  budget_amount integer check (budget_amount is null or (budget_amount >= 0 and budget_amount <= 1000000000)),
  due_on        date,
  reference_url text check (reference_url is null or (reference_url ~ '^https://' and char_length(reference_url) <= 500)),
  started_at    timestamptz,
  delivered_at  timestamptz,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.projects enable row level security;
alter table public.projects force row level security;
create index if not exists idx_projects_client on public.projects (client_id, updated_at desc);
create index if not exists idx_projects_creator on public.projects (creator_id, updated_at desc);

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ステータス遷移時に日時を自動で刻む（証跡）
create or replace function public.stamp_project_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is null then
      new.started_at := now();
    elsif new.status = 'delivered' and new.delivered_at is null then
      new.delivered_at := now();
    elsif new.status = 'paid' and new.paid_at is null then
      new.paid_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_projects_stamp on public.projects;
create trigger trg_projects_stamp before update on public.projects
  for each row execute function public.stamp_project_status();

-- ---------------------------------------------------------------------
-- 10. project_messages : 案件内のやり取り
-- ---------------------------------------------------------------------
create table if not exists public.project_messages (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table public.project_messages enable row level security;
alter table public.project_messages force row level security;
create index if not exists idx_project_messages_project on public.project_messages (project_id, created_at);

-- ---------------------------------------------------------------------
-- 11. reviews : 評価（双方向・案件1件につき1回・納品以降のみ）
-- ---------------------------------------------------------------------
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  reviewer_id   uuid not null references auth.users(id) on delete cascade,
  reviewee_id   uuid not null references auth.users(id) on delete cascade,
  reviewer_role text not null check (reviewer_role in ('creator','client')),
  score         numeric(2,1) not null check (score >= 0.0 and score <= 5.0),
  comment       text not null check (char_length(comment) between 20 and 2000),
  status        text not null default 'pending' check (status in ('pending','published','rejected')),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (project_id, reviewer_id)
);
alter table public.reviews enable row level security;
alter table public.reviews force row level security;
create index if not exists idx_reviews_reviewee on public.reviews (reviewee_id, published_at desc) where status = 'published';

-- score は 0.1 刻みのみ許可
alter table public.reviews drop constraint if exists reviews_score_step;
alter table public.reviews add constraint reviews_score_step
  check ((score * 10) = floor(score * 10));

-- 投稿資格をトリガでも二重チェック（RLS が万一緩んでも通さない）
create or replace function public.check_review_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_creator_user uuid;
  v_client_user  uuid;
begin
  select * into p from public.projects where id = new.project_id;
  if p is null then
    raise exception '案件が見つかりません';
  end if;
  if p.status not in ('delivered','paid','closed') then
    raise exception '納品済み以降の案件のみ評価できます';
  end if;

  select user_id into v_creator_user from public.creators where id = p.creator_id;
  select user_id into v_client_user  from public.clients  where id = p.client_id;

  if new.reviewer_role = 'client' then
    if new.reviewer_id <> v_client_user or new.reviewee_id <> v_creator_user then
      raise exception '評価の当事者が案件と一致しません';
    end if;
  else
    if new.reviewer_id <> v_creator_user or new.reviewee_id <> v_client_user then
      raise exception '評価の当事者が案件と一致しません';
    end if;
  end if;

  new.status := 'pending';
  new.published_at := null;
  return new;
end;
$$;
drop trigger if exists trg_review_eligibility on public.reviews;
create trigger trg_review_eligibility before insert on public.reviews
  for each row execute function public.check_review_eligibility();

-- ---------------------------------------------------------------------
-- 12. reports : 問題報告（非公開。本人と運営のみ）
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete set null,
  project_id     uuid references public.projects(id) on delete set null,
  category       text not null check (category in ('unpaid','harassment','false_review','other')),
  detail         text not null check (char_length(detail) between 20 and 4000),
  evidence_url   text check (evidence_url is null or (evidence_url ~ '^https://' and char_length(evidence_url) <= 500)),
  status         text not null default 'received' check (status in ('received','investigating','resolved','dismissed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.reports enable row level security;
alter table public.reports force row level security;
create index if not exists idx_reports_reporter on public.reports (reporter_id, created_at desc);

drop trigger if exists trg_reports_updated_at on public.reports;
create trigger trg_reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

-- =====================================================================
--  13. RLS 判定用ヘルパー関数
--  ポリシー式の中で他テーブルを直接参照すると RLS が入れ子になり
--  意図しない挙動や再帰を招くため、SECURITY DEFINER 関数に閉じ込める。
-- =====================================================================

create or replace function public.my_creator_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.creators where user_id = auth.uid();
$$;

create or replace function public.my_client_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.clients where user_id = auth.uid();
$$;

create or replace function public.owns_creator(p_creator_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.creators c
    where c.id = p_creator_id and c.user_id = auth.uid()
  );
$$;

create or replace function public.creator_is_published(p_creator_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_published from public.creators where id = p_creator_id), false);
$$;

create or replace function public.owns_portfolio(p_portfolio_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.portfolios p
    join public.creators c on c.id = p.creator_id
    where p.id = p_portfolio_id and c.user_id = auth.uid()
  );
$$;

create or replace function public.portfolio_is_public(p_portfolio_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.portfolios p
    join public.creators c on c.id = p.creator_id
    where p.id = p_portfolio_id and p.visibility = 'public' and c.is_published
  );
$$;

create or replace function public.owns_share_link(p_share_link_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.share_links s
    join public.creators c on c.id = s.creator_id
    where s.id = p_share_link_id and c.user_id = auth.uid()
  );
$$;

create or replace function public.is_project_party(p_project_id uuid)
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

-- =====================================================================
--  14. RLS ポリシー
-- =====================================================================

-- ---- users -----------------------------------------------------------
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- insert / delete ポリシーは作らない（行の生成はトリガのみ、削除は auth 側の連鎖削除のみ）

-- ---- genres ----------------------------------------------------------
drop policy if exists genres_select_all on public.genres;
create policy genres_select_all on public.genres
  for select to anon, authenticated using (true);

-- ---- creators --------------------------------------------------------
drop policy if exists creators_select on public.creators;
create policy creators_select on public.creators
  for select to anon, authenticated
  using (is_published or user_id = auth.uid() or public.is_admin());

drop policy if exists creators_insert_own on public.creators;
create policy creators_insert_own on public.creators
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists creators_update_own on public.creators;
create policy creators_update_own on public.creators
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists creators_delete_own on public.creators;
create policy creators_delete_own on public.creators
  for delete to authenticated using (user_id = auth.uid());

-- ---- creator_genres --------------------------------------------------
drop policy if exists creator_genres_select on public.creator_genres;
create policy creator_genres_select on public.creator_genres
  for select to anon, authenticated
  using (public.creator_is_published(creator_id) or public.owns_creator(creator_id));

drop policy if exists creator_genres_write on public.creator_genres;
create policy creator_genres_write on public.creator_genres
  for insert to authenticated with check (public.owns_creator(creator_id));

drop policy if exists creator_genres_delete on public.creator_genres;
create policy creator_genres_delete on public.creator_genres
  for delete to authenticated using (public.owns_creator(creator_id));

-- ---- clients ---------------------------------------------------------
drop policy if exists clients_select_own on public.clients;
create policy clients_select_own on public.clients
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists clients_insert_own on public.clients;
create policy clients_insert_own on public.clients
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists clients_update_own on public.clients;
create policy clients_update_own on public.clients
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- portfolios ------------------------------------------------------
-- link_only の作品はこのポリシーでは決して読めない。
-- 共有リンク経由の閲覧は public.get_share_link() のみが担当する。
drop policy if exists portfolios_select on public.portfolios;
create policy portfolios_select on public.portfolios
  for select to anon, authenticated
  using (
    (visibility = 'public' and public.creator_is_published(creator_id))
    or public.owns_creator(creator_id)
    or public.is_admin()
  );

drop policy if exists portfolios_insert_own on public.portfolios;
create policy portfolios_insert_own on public.portfolios
  for insert to authenticated with check (public.owns_creator(creator_id));

drop policy if exists portfolios_update_own on public.portfolios;
create policy portfolios_update_own on public.portfolios
  for update to authenticated
  using (public.owns_creator(creator_id)) with check (public.owns_creator(creator_id));

drop policy if exists portfolios_delete_own on public.portfolios;
create policy portfolios_delete_own on public.portfolios
  for delete to authenticated using (public.owns_creator(creator_id));

-- ---- portfolio_tags --------------------------------------------------
drop policy if exists portfolio_tags_select on public.portfolio_tags;
create policy portfolio_tags_select on public.portfolio_tags
  for select to anon, authenticated
  using (public.portfolio_is_public(portfolio_id) or public.owns_portfolio(portfolio_id));

drop policy if exists portfolio_tags_insert on public.portfolio_tags;
create policy portfolio_tags_insert on public.portfolio_tags
  for insert to authenticated with check (public.owns_portfolio(portfolio_id));

drop policy if exists portfolio_tags_delete on public.portfolio_tags;
create policy portfolio_tags_delete on public.portfolio_tags
  for delete to authenticated using (public.owns_portfolio(portfolio_id));

-- ---- share_links -----------------------------------------------------
-- token を第三者に列挙させないため、SELECT は所有者のみ。
drop policy if exists share_links_select_own on public.share_links;
create policy share_links_select_own on public.share_links
  for select to authenticated using (public.owns_creator(creator_id));

drop policy if exists share_links_insert_own on public.share_links;
create policy share_links_insert_own on public.share_links
  for insert to authenticated with check (public.owns_creator(creator_id));

drop policy if exists share_links_update_own on public.share_links;
create policy share_links_update_own on public.share_links
  for update to authenticated
  using (public.owns_creator(creator_id)) with check (public.owns_creator(creator_id));

drop policy if exists share_links_delete_own on public.share_links;
create policy share_links_delete_own on public.share_links
  for delete to authenticated using (public.owns_creator(creator_id));

drop policy if exists share_link_items_select_own on public.share_link_items;
create policy share_link_items_select_own on public.share_link_items
  for select to authenticated using (public.owns_share_link(share_link_id));

drop policy if exists share_link_items_insert_own on public.share_link_items;
create policy share_link_items_insert_own on public.share_link_items
  for insert to authenticated
  with check (public.owns_share_link(share_link_id) and public.owns_portfolio(portfolio_id));

drop policy if exists share_link_items_delete_own on public.share_link_items;
create policy share_link_items_delete_own on public.share_link_items
  for delete to authenticated using (public.owns_share_link(share_link_id));

-- ---- projects --------------------------------------------------------
drop policy if exists projects_select_party on public.projects;
create policy projects_select_party on public.projects
  for select to authenticated
  using (
    creator_id = public.my_creator_id()
    or client_id = public.my_client_id()
    or public.is_admin()
  );

drop policy if exists projects_insert_client on public.projects;
create policy projects_insert_client on public.projects
  for insert to authenticated
  with check (client_id = public.my_client_id() and public.creator_is_published(creator_id));

drop policy if exists projects_update_party on public.projects;
create policy projects_update_party on public.projects
  for update to authenticated
  using (creator_id = public.my_creator_id() or client_id = public.my_client_id())
  with check (creator_id = public.my_creator_id() or client_id = public.my_client_id());

-- ---- project_messages ------------------------------------------------
drop policy if exists project_messages_select on public.project_messages;
create policy project_messages_select on public.project_messages
  for select to authenticated
  using (public.is_project_party(project_id) or public.is_admin());

drop policy if exists project_messages_insert on public.project_messages;
create policy project_messages_insert on public.project_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_project_party(project_id));

-- ---- reviews ---------------------------------------------------------
-- 公開レビューは「検証済み匿名」。投稿者が特定できないよう、
-- 一般公開は public.public_reviews ビュー経由に限定し、
-- 生テーブルは当事者と運営しか読めない。
drop policy if exists reviews_select_party on public.reviews;
create policy reviews_select_party on public.reviews
  for select to authenticated
  using (reviewer_id = auth.uid() or reviewee_id = auth.uid() or public.is_admin());

drop policy if exists reviews_insert_party on public.reviews;
create policy reviews_insert_party on public.reviews
  for insert to authenticated
  with check (reviewer_id = auth.uid() and public.is_project_party(project_id));

-- 公開前（pending）の自分の投稿だけ修正できる
drop policy if exists reviews_update_own_pending on public.reviews;
create policy reviews_update_own_pending on public.reviews
  for update to authenticated
  using (reviewer_id = auth.uid() and status = 'pending')
  with check (reviewer_id = auth.uid() and status = 'pending');
-- delete ポリシーは作らない（公開済み評価の消去による評価操作を防ぐ）

-- ---- reports ---------------------------------------------------------
-- 他人の報告は一切読めない。
drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());
-- update / delete ポリシーは作らない（証跡の改ざん防止。処理は運営が service_role で行う）

-- =====================================================================
--  15. 公開ビュー
--  RLS を通さず「公開してよい列・行だけ」を切り出した窓口。
--  security_invoker = off（既定）＝ 所有者権限で動くため、
--  ビュー定義の WHERE 句自体が公開範囲の定義になる。
-- =====================================================================

drop view if exists public.public_reviews;
create view public.public_reviews
with (security_barrier = true) as
select
  r.id,
  r.reviewee_id,
  r.reviewer_role,
  r.score,
  r.comment,
  r.published_at
from public.reviews r
where r.status = 'published';

-- 平均スコアは直近50件で算出（制作本数の差を吸収するため。将来ジャンル別に調整）
drop view if exists public.creator_rating_stats;
create view public.creator_rating_stats
with (security_barrier = true) as
select
  t.reviewee_id                      as user_id,
  round(avg(t.score)::numeric, 1)    as avg_score,
  count(*)::integer                  as rated_count
from (
  select
    r.reviewee_id,
    r.score,
    row_number() over (partition by r.reviewee_id order by r.published_at desc nulls last) as rn
  from public.reviews r
  where r.status = 'published'
) t
where t.rn <= 50
group by t.reviewee_id;

-- 完了案件数（公開してよい集計値のみ）
drop view if exists public.creator_project_stats;
create view public.creator_project_stats
with (security_barrier = true) as
select
  p.creator_id,
  count(*) filter (where p.status in ('delivered','paid','closed'))::integer as completed_count
from public.projects p
group by p.creator_id;

-- =====================================================================
--  16. 共有リンク閲覧 RPC
--  limited 公開の作品はテーブルを直接読ませない。
--  トークンを知っている人だけがこの関数経由で取得できる。
-- =====================================================================
create or replace function public.get_share_link(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s record;
  c record;
  items jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;

  select * into s from public.share_links
   where token = p_token and is_active
     and (expires_at is null or expires_at > now());
  if s is null then
    return null;
  end if;

  select display_name, headline, area_pref, avatar_url
    into c from public.creators where id = s.creator_id;

  select coalesce(jsonb_agg(x order by x.sort_order, x.created_at), '[]'::jsonb)
    into items
  from (
    select p.id, p.title, p.description, p.provider, p.video_id,
           p.video_url, p.thumbnail_url, p.created_at, i.sort_order
    from public.share_link_items i
    join public.portfolios p on p.id = i.portfolio_id
    where i.share_link_id = s.id
  ) x;

  return jsonb_build_object(
    'title', s.title,
    'note', s.note,
    'creator', jsonb_build_object(
      'display_name', c.display_name,
      'headline', c.headline,
      'area_pref', c.area_pref,
      'avatar_url', c.avatar_url
    ),
    'items', items
  );
end;
$$;

-- 閲覧数のカウントだけ別関数に分離（読み取り関数を副作用なしに保つ）
create or replace function public.touch_share_link(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return;
  end if;
  update public.share_links
     set view_count = view_count + 1
   where token = p_token and is_active;
end;
$$;

-- =====================================================================
--  17. 権限（GRANT）
--  RLS は「行」しか守らない。status や is_admin のように
--  ユーザーに書き換えさせたくない「列」は、ここで権限を渡さないことで守る。
-- =====================================================================

-- いったん全部剥がす
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 今後このロールで作られるオブジェクトも自動で権限が付かないようにする
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

-- 読み取り
grant select on public.genres                to anon, authenticated;
grant select on public.creators              to anon, authenticated;
grant select on public.creator_genres        to anon, authenticated;
grant select on public.portfolios            to anon, authenticated;
grant select on public.portfolio_tags        to anon, authenticated;
grant select on public.public_reviews        to anon, authenticated;
grant select on public.creator_rating_stats  to anon, authenticated;
grant select on public.creator_project_stats to anon, authenticated;

grant select on public.users            to authenticated;
grant select on public.clients          to authenticated;
grant select on public.share_links      to authenticated;
grant select on public.share_link_items to authenticated;
grant select on public.projects         to authenticated;
grant select on public.project_messages to authenticated;
grant select on public.reviews          to authenticated;
grant select on public.reports          to authenticated;

-- 書き込み（列を明示。ここに無い列はユーザーからは絶対に書けない）
grant update (account_type, display_name, onboarded) on public.users to authenticated;

grant insert (user_id, display_name, headline, bio, area_pref, area_city,
              years_of_experience, response_time_hours, avatar_url, website_url, is_published)
  on public.creators to authenticated;
grant update (display_name, headline, bio, area_pref, area_city,
              years_of_experience, response_time_hours, avatar_url, website_url, is_published)
  on public.creators to authenticated;
grant delete on public.creators to authenticated;

grant insert (creator_id, genre_id) on public.creator_genres to authenticated;
grant delete on public.creator_genres to authenticated;

grant insert (user_id, display_name, company, area_pref) on public.clients to authenticated;
grant update (display_name, company, area_pref) on public.clients to authenticated;

grant insert (creator_id, title, description, provider, video_id, video_url,
              thumbnail_url, visibility, sort_order) on public.portfolios to authenticated;
grant update (title, description, provider, video_id, video_url,
              thumbnail_url, visibility, sort_order) on public.portfolios to authenticated;
grant delete on public.portfolios to authenticated;

grant insert (portfolio_id, tag) on public.portfolio_tags to authenticated;
grant delete on public.portfolio_tags to authenticated;

-- token 列は付与しない = クライアントからトークンを指定して作れない
grant insert (creator_id, title, note, expires_at) on public.share_links to authenticated;
grant update (title, note, is_active, expires_at)  on public.share_links to authenticated;
grant delete on public.share_links to authenticated;

grant insert (share_link_id, portfolio_id, sort_order) on public.share_link_items to authenticated;
grant delete on public.share_link_items to authenticated;

-- started_at / delivered_at / paid_at はトリガが刻む。手で書かせない
grant insert (client_id, creator_id, title, description, kind, status,
              budget_amount, due_on, reference_url) on public.projects to authenticated;
grant update (title, description, kind, status, budget_amount, due_on, reference_url)
  on public.projects to authenticated;

grant insert (project_id, sender_id, body) on public.project_messages to authenticated;

-- status / published_at は付与しない = 自分で「公開済み」にできない
grant insert (project_id, reviewer_id, reviewee_id, reviewer_role, score, comment)
  on public.reviews to authenticated;
grant update (score, comment) on public.reviews to authenticated;

-- status は付与しない = 自分で「解決済み」にできない
grant insert (reporter_id, target_user_id, project_id, category, detail, evidence_url)
  on public.reports to authenticated;

-- 関数
grant execute on function public.ping()                   to anon, authenticated;
grant execute on function public.get_share_link(text)     to anon, authenticated;
grant execute on function public.touch_share_link(text)   to anon, authenticated;
grant execute on function public.is_admin()               to anon, authenticated;
grant execute on function public.my_creator_id()          to authenticated;
grant execute on function public.my_client_id()           to authenticated;
grant execute on function public.owns_creator(uuid)       to anon, authenticated;
grant execute on function public.creator_is_published(uuid) to anon, authenticated;
grant execute on function public.owns_portfolio(uuid)     to anon, authenticated;
grant execute on function public.portfolio_is_public(uuid) to anon, authenticated;
grant execute on function public.owns_share_link(uuid)    to authenticated;
grant execute on function public.is_project_party(uuid)   to authenticated;

-- =====================================================================
--  18. ストレージ（アバター画像）
--  自分のフォルダ（<uid>/...）にしか置けないようにする
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
--  19. 職種マスタ初期値
-- =====================================================================
insert into public.genres (id, slug, name_ja, sort_order) values
  ( 1, 'camera',      'カメラマン',       10),
  ( 2, 'editor',      'エディター',       20),
  ( 3, 'director',    'ディレクター',     30),
  ( 4, 'producer',    'プロデューサー',   40),
  ( 5, 'lighting',    '照明',             50),
  ( 6, 'sound',       '音声',             60),
  ( 7, 'music-ma',    '音楽・MA',         70),
  ( 8, 'art',         '美術',             80),
  ( 9, 'stylist',     'スタイリスト',     90),
  (10, 'hairmake',    'ヘアメイク',      100),
  (11, 'cast',        'モデル・キャスト',110),
  (12, 'animator',    'アニメーター',    120),
  (13, 'cg-vfx',      'CG・VFX',         130),
  (14, 'drone',       'ドローン',        140),
  (15, 'production',  '制作進行',        150)
on conflict (id) do update
  set slug = excluded.slug, name_ja = excluded.name_ja, sort_order = excluded.sort_order;

-- =====================================================================
--  完了
-- =====================================================================

-- =====================================================================
--  20. フェーズ3（取引機能）で追加する分
--  ---------------------------------------------------------------
--  フェーズ2の時点では、案件の相手方のプロフィールを読む手段が
--  ありませんでした（clients は本人しか読めない設定のため）。
--  ここで「同じ案件の当事者どうしは、相手の表示名を読める」
--  というポリシーを足します。評価の投稿先を特定するためにも必要です。
-- =====================================================================

-- 自分が関わっている案件の相手方かどうか
create or replace function public.is_my_project_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.projects p
    join public.creators c on c.id = p.creator_id
    where p.client_id = p_client_id and c.user_id = auth.uid()
  );
$$;

create or replace function public.is_my_project_creator(p_creator_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.projects p
    join public.clients cl on cl.id = p.client_id
    where p.creator_id = p_creator_id and cl.user_id = auth.uid()
  );
$$;

-- 案件の相手方の user_id を返す（評価の投稿先の特定に使う）
create or replace function public.project_counterparty(p_project_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p record; v_creator_user uuid; v_client_user uuid;
begin
  select * into p from public.projects where id = p_project_id;
  if p is null then return null; end if;

  select user_id into v_creator_user from public.creators where id = p.creator_id;
  select user_id into v_client_user  from public.clients  where id = p.client_id;

  if auth.uid() = v_creator_user then
    return jsonb_build_object('my_role','creator','reviewee_id', v_client_user);
  elsif auth.uid() = v_client_user then
    return jsonb_build_object('my_role','client','reviewee_id', v_creator_user);
  end if;
  return null;  -- 当事者でなければ何も返さない
end;
$$;

-- clients / creators の読み取りポリシーを、案件の相手方まで広げる
drop policy if exists clients_select_own on public.clients;
create policy clients_select_own on public.clients
  for select to authenticated
  using (user_id = auth.uid() or public.is_my_project_client(id) or public.is_admin());

drop policy if exists creators_select on public.creators;
create policy creators_select on public.creators
  for select to anon, authenticated
  using (
    is_published
    or user_id = auth.uid()
    or public.is_my_project_creator(id)
    or public.is_admin()
  );

-- ステータス遷移を役割ごとに制限する（証跡の信頼性を守るため）
--   draft      → offered                  クライアント
--   offered    → in_progress              どちらでも
--   in_progress→ delivered                クリエイター
--   delivered  → paid                     クライアント
--   paid       → closed                   どちらでも
--   offered / in_progress → cancelled     どちらでも
-- paid 以降は巻き戻せません。
create or replace function public.project_my_role(p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.projects p join public.creators c on c.id = p.creator_id
                  where p.id = p_project_id and c.user_id = auth.uid()) then 'creator'
    when exists (select 1 from public.projects p join public.clients cl on cl.id = p.client_id
                  where p.id = p_project_id and cl.user_id = auth.uid()) then 'client'
    else null end;
$$;

create or replace function public.enforce_project_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  ok boolean := false;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  role_name := public.project_my_role(new.id);
  if role_name is null then
    raise exception 'この案件のステータスを変更する権限がありません';
  end if;

  if old.status = 'draft'       and new.status = 'offered'     and role_name = 'client'  then ok := true;
  elsif old.status = 'offered'  and new.status = 'in_progress'                           then ok := true;
  elsif old.status = 'in_progress' and new.status = 'delivered' and role_name = 'creator' then ok := true;
  elsif old.status = 'delivered' and new.status = 'paid'        and role_name = 'client'  then ok := true;
  elsif old.status = 'paid'     and new.status = 'closed'                                 then ok := true;
  elsif old.status in ('draft','offered','in_progress') and new.status = 'cancelled'      then ok := true;
  end if;

  if not ok then
    raise exception '「%」から「%」への変更はできません（あなたの立場: %）', old.status, new.status, role_name;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_status_transition on public.projects;
create trigger trg_projects_status_transition before update on public.projects
  for each row execute function public.enforce_project_status_transition();

grant execute on function public.is_my_project_client(uuid)   to authenticated;
grant execute on function public.is_my_project_creator(uuid)  to anon, authenticated;
grant execute on function public.project_counterparty(uuid)   to authenticated;
grant execute on function public.project_my_role(uuid)        to authenticated;

-- =====================================================================
--  ここから先の追加・変更は supabase/migrations/ に分けて置いています。
--  新しく環境を作るときは、このファイルを実行したあと
--  migrations/ の中を番号順にすべて実行してください。
--    001_stock_pages.sql            … ストックページ（パスワード保護）
--    002_announcements_ads_admin.sql … お知らせ・広告枠・管理者・記事の土台
--    003_schedule.sql                … スケジュール（縦型カレンダー）と空き状況
--    004_improvement_proposals.sql   … 改善提案のストック
--    005_google_calendar.sql         … Google カレンダー連携（任意）
--
--  Edge Function（supabase/functions/）も別途デプロイが必要です。
--    google-calendar … Google カレンダーとのやり取り
--    設定手順は docs/GOOGLE_CALENDAR.md を参照してください。
-- =====================================================================
