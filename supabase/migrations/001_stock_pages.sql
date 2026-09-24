-- =====================================================================
--  Eizo Maps / 追加マイグレーション 001
--  ポートフォリオ・ストックページ（パスワード保護）
--  ---------------------------------------------------------------
--  実行方法: Supabase ダッシュボード > SQL Editor に貼り付けて実行
--  何度実行しても同じ結果になります。
--
--  ★ このファイルのセキュリティ方針
--    1. ストックページの中身は anon にも authenticated にも
--       テーブルとして一切読ませない。閲覧は RPC 1本のみ。
--    2. パスワードは bcrypt でハッシュ化して保存する。
--       password_hash 列は誰にも SELECT 権限を与えない。
--    3. 総当たり攻撃対策として、IP ハッシュ単位・ページ単位で
--       15分あたりの失敗回数を数え、超えたら弾く。
--    4. パスワードは列として書かせない。専用 RPC 経由のみ。
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 21-A. creators への追加列（依頼の受け取り方）
--   form = Eizo Maps の依頼フォーム / dm = SNS の DM / both = 両方
-- ---------------------------------------------------------------------
alter table public.creators
  add column if not exists contact_pref text not null default 'form';

alter table public.creators
  add column if not exists contact_dm_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'creators_contact_pref_check') then
    alter table public.creators
      add constraint creators_contact_pref_check
      check (contact_pref in ('form', 'dm', 'both'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'creators_contact_dm_url_check') then
    alter table public.creators
      add constraint creators_contact_dm_url_check
      check (contact_dm_url is null or (contact_dm_url ~ '^https://' and char_length(contact_dm_url) <= 500));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 21-B. creator_links : SNS などの外部リンク（プロフィールにも出す）
-- ---------------------------------------------------------------------
create table if not exists public.creator_links (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  platform   text not null check (platform in
               ('x','instagram','tiktok','youtube','facebook','note','threads','website','other')),
  url        text not null check (url ~ '^https://' and char_length(url) <= 500),
  label      text check (label is null or char_length(label) <= 40),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.creator_links enable row level security;
alter table public.creator_links force row level security;
create index if not exists idx_creator_links_creator
  on public.creator_links (creator_id, sort_order, created_at);

-- 1クリエイターあたり最大12件
create or replace function public.check_creator_link_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.creator_links where creator_id = new.creator_id) >= 12 then
    raise exception 'リンクは12件までです';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_creator_link_limit on public.creator_links;
create trigger trg_creator_link_limit before insert on public.creator_links
  for each row execute function public.check_creator_link_limit();

-- ---------------------------------------------------------------------
-- 21-C. stock_pages : クリエイター1人につき1ページ
--   password_hash は bcrypt。誰にも SELECT 権限を与えない。
--   パスワードが設定済みかどうかは password_updated_at の有無で判断できる。
-- ---------------------------------------------------------------------
create table if not exists public.stock_pages (
  id                  uuid primary key default gen_random_uuid(),
  creator_id          uuid not null unique references public.creators(id) on delete cascade,
  slug                text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  title               text not null check (char_length(title) between 1 and 60),
  intro               text check (intro is null or char_length(intro) <= 2000),
  password_hash       text,
  password_updated_at timestamptz,
  is_active           boolean not null default false,
  view_count          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.stock_pages enable row level security;
alter table public.stock_pages force row level security;

drop trigger if exists trg_stock_pages_updated_at on public.stock_pages;
create trigger trg_stock_pages_updated_at before update on public.stock_pages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 21-D. stock_items : ページに並べるブロック
--   video   … YouTube / Vimeo / TikTok の埋め込み
--   doc     … 資料の外部リンク（Google Drive / Dropbox など）
--   link    … 任意のリンク
--   note    … 説明文だけのブロック
--   heading … 見出し
--   width   … full（1列）/ half（2列並び）
-- ---------------------------------------------------------------------
create table if not exists public.stock_items (
  id            uuid primary key default gen_random_uuid(),
  page_id       uuid not null references public.stock_pages(id) on delete cascade,
  kind          text not null check (kind in ('video','doc','link','note','heading')),
  title         text check (title is null or char_length(title) <= 120),
  description   text check (description is null or char_length(description) <= 2000),
  provider      text check (provider is null or provider in ('youtube','vimeo','tiktok')),
  video_id      text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{1,32}$'),
  url           text check (url is null or (url ~ '^https://' and char_length(url) <= 1000)),
  thumbnail_url text check (thumbnail_url is null or (thumbnail_url ~ '^https://' and char_length(thumbnail_url) <= 500)),
  width         text not null default 'full' check (width in ('full','half')),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint stock_items_shape check (
    case kind
      when 'video'   then provider is not null and video_id is not null and url is not null
      when 'doc'     then url is not null
      when 'link'    then url is not null
      when 'note'    then description is not null
      when 'heading' then title is not null
      else false
    end
  )
);
alter table public.stock_items enable row level security;
alter table public.stock_items force row level security;
create index if not exists idx_stock_items_page
  on public.stock_items (page_id, sort_order, created_at);

drop trigger if exists trg_stock_items_updated_at on public.stock_items;
create trigger trg_stock_items_updated_at before update on public.stock_items
  for each row execute function public.set_updated_at();

-- 1ページあたり最大120ブロック
create or replace function public.check_stock_item_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(*) from public.stock_items where page_id = new.page_id) >= 120 then
    raise exception 'ブロックは120件までです';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stock_item_limit on public.stock_items;
create trigger trg_stock_item_limit before insert on public.stock_items
  for each row execute function public.check_stock_item_limit();

-- ---------------------------------------------------------------------
-- 21-E. creator_follows : クライアントがクリエイターをフォローする
--   （パスワード変更通知の宛先。通知の送信自体は次フェーズ）
-- ---------------------------------------------------------------------
create table if not exists public.creator_follows (
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  creator_id       uuid not null references public.creators(id) on delete cascade,
  notify           boolean not null default true,
  created_at       timestamptz not null default now(),
  primary key (follower_user_id, creator_id)
);
alter table public.creator_follows enable row level security;
alter table public.creator_follows force row level security;
create index if not exists idx_creator_follows_creator on public.creator_follows (creator_id);

-- クリエイター側が「この人には送らない」と外した相手
create table if not exists public.creator_follow_excludes (
  creator_id       uuid not null references public.creators(id) on delete cascade,
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (creator_id, follower_user_id)
);
alter table public.creator_follow_excludes enable row level security;
alter table public.creator_follow_excludes force row level security;

-- ---------------------------------------------------------------------
-- 21-F. stock_access_log : パスワード試行の記録（総当たり対策）
--   IP は生で持たず SHA-256 ハッシュで保存する。
--   anon / authenticated には権限を一切与えない。
--   触るのは SECURITY DEFINER 関数だけ。
-- ---------------------------------------------------------------------
create table if not exists public.stock_access_log (
  id           bigserial primary key,
  page_id      uuid references public.stock_pages(id) on delete cascade,
  ip_hash      text not null,
  ok           boolean not null,
  attempted_at timestamptz not null default now()
);
alter table public.stock_access_log enable row level security;
alter table public.stock_access_log force row level security;
create index if not exists idx_stock_access_log_ip
  on public.stock_access_log (ip_hash, attempted_at desc);
create index if not exists idx_stock_access_log_page
  on public.stock_access_log (page_id, attempted_at desc);

-- ---------------------------------------------------------------------
-- 21-G. 補助関数
-- ---------------------------------------------------------------------
create or replace function public.owns_stock_page(p_page_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.stock_pages sp
      join public.creators c on c.id = sp.creator_id
     where sp.id = p_page_id and c.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- 21-H. RLS ポリシー
-- ---------------------------------------------------------------------

-- creator_links : 公開クリエイターのものは誰でも読める。書き込みは本人だけ。
drop policy if exists creator_links_read on public.creator_links;
create policy creator_links_read on public.creator_links
  for select to anon, authenticated
  using (public.creator_is_published(creator_id) or public.owns_creator(creator_id));

drop policy if exists creator_links_insert_own on public.creator_links;
create policy creator_links_insert_own on public.creator_links
  for insert to authenticated with check (public.owns_creator(creator_id));

drop policy if exists creator_links_update_own on public.creator_links;
create policy creator_links_update_own on public.creator_links
  for update to authenticated
  using (public.owns_creator(creator_id)) with check (public.owns_creator(creator_id));

drop policy if exists creator_links_delete_own on public.creator_links;
create policy creator_links_delete_own on public.creator_links
  for delete to authenticated using (public.owns_creator(creator_id));

-- stock_pages : 本人以外は 1 行も読めない（閲覧者は RPC 経由のみ）
drop policy if exists stock_pages_own on public.stock_pages;
create policy stock_pages_own on public.stock_pages
  for select to authenticated using (public.owns_creator(creator_id));

drop policy if exists stock_pages_insert_own on public.stock_pages;
create policy stock_pages_insert_own on public.stock_pages
  for insert to authenticated with check (public.owns_creator(creator_id));

drop policy if exists stock_pages_update_own on public.stock_pages;
create policy stock_pages_update_own on public.stock_pages
  for update to authenticated
  using (public.owns_creator(creator_id)) with check (public.owns_creator(creator_id));

drop policy if exists stock_pages_delete_own on public.stock_pages;
create policy stock_pages_delete_own on public.stock_pages
  for delete to authenticated using (public.owns_creator(creator_id));

-- stock_items : 本人以外は 1 行も読めない
drop policy if exists stock_items_own on public.stock_items;
create policy stock_items_own on public.stock_items
  for select to authenticated using (public.owns_stock_page(page_id));

drop policy if exists stock_items_insert_own on public.stock_items;
create policy stock_items_insert_own on public.stock_items
  for insert to authenticated with check (public.owns_stock_page(page_id));

drop policy if exists stock_items_update_own on public.stock_items;
create policy stock_items_update_own on public.stock_items
  for update to authenticated
  using (public.owns_stock_page(page_id)) with check (public.owns_stock_page(page_id));

drop policy if exists stock_items_delete_own on public.stock_items;
create policy stock_items_delete_own on public.stock_items
  for delete to authenticated using (public.owns_stock_page(page_id));

-- creator_follows : 自分のフォロー行 + 自分がフォローされている行が見える
drop policy if exists creator_follows_read on public.creator_follows;
create policy creator_follows_read on public.creator_follows
  for select to authenticated
  using (follower_user_id = auth.uid() or public.owns_creator(creator_id));

drop policy if exists creator_follows_insert_self on public.creator_follows;
create policy creator_follows_insert_self on public.creator_follows
  for insert to authenticated with check (follower_user_id = auth.uid());

drop policy if exists creator_follows_update_self on public.creator_follows;
create policy creator_follows_update_self on public.creator_follows
  for update to authenticated
  using (follower_user_id = auth.uid()) with check (follower_user_id = auth.uid());

drop policy if exists creator_follows_delete_self on public.creator_follows;
create policy creator_follows_delete_self on public.creator_follows
  for delete to authenticated using (follower_user_id = auth.uid());

-- creator_follow_excludes : クリエイター本人のみ
drop policy if exists creator_follow_excludes_own on public.creator_follow_excludes;
create policy creator_follow_excludes_own on public.creator_follow_excludes
  for select to authenticated using (public.owns_creator(creator_id));

drop policy if exists creator_follow_excludes_insert_own on public.creator_follow_excludes;
create policy creator_follow_excludes_insert_own on public.creator_follow_excludes
  for insert to authenticated with check (public.owns_creator(creator_id));

drop policy if exists creator_follow_excludes_delete_own on public.creator_follow_excludes;
create policy creator_follow_excludes_delete_own on public.creator_follow_excludes
  for delete to authenticated using (public.owns_creator(creator_id));

-- stock_access_log : ポリシーを1つも作らない = 誰も読めない・書けない
--   （SECURITY DEFINER 関数の所有者だけが触れる）

-- ---------------------------------------------------------------------
-- 21-I. パスワード設定 RPC
--   password_hash は列として書かせない。必ずこの関数を通す。
-- ---------------------------------------------------------------------
create or replace function public.set_stock_password(p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cid uuid;
begin
  cid := public.my_creator_id();
  if cid is null then
    raise exception 'クリエイター登録が必要です';
  end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'パスワードは6文字以上72文字以下で設定してください';
  end if;

  update public.stock_pages
     set password_hash       = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_updated_at = now()
   where creator_id = cid;

  if not found then
    raise exception 'ストックページがまだ作成されていません';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 21-J. 閲覧前に出す最小限の情報（誰のページか・タイトルだけ）
--   本文・リンク・資料は一切含めない。
-- ---------------------------------------------------------------------
create or replace function public.get_stock_page_meta(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  sp record;
  c  record;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    return null;
  end if;

  select id, creator_id, title into sp
    from public.stock_pages
   where slug = p_slug and is_active and password_hash is not null;
  if sp.id is null then
    return null;
  end if;

  select display_name, avatar_url into c
    from public.creators where id = sp.creator_id;

  return jsonb_build_object(
    'title', sp.title,
    'creator_name', c.display_name,
    'avatar_url', c.avatar_url
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 21-K. 本体の閲覧 RPC
--   スラッグとパスワードが両方合ったときだけ中身を返す。
--   失敗時は「スラッグが無い」も「パスワードが違う」も同じ null を返し、
--   ページの存在を推測させない。
-- ---------------------------------------------------------------------
create or replace function public.open_stock_page(p_slug text, p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  sp       record;
  c        record;
  raw_ip   text;
  iph      text;
  fails_ip int;
  fails_pg int;
  matched  boolean := false;
  items    jsonb;
  links    jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    return null;
  end if;

  -- 接続元の識別子（PostgREST 経由でのみ取れる。取れない場合は unknown）
  begin
    raw_ip := split_part(
      coalesce(
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip',
        'unknown'),
      ',', 1);
  exception when others then
    raw_ip := 'unknown';
  end;
  iph := encode(extensions.digest(coalesce(btrim(raw_ip), 'unknown'), 'sha256'), 'hex');

  -- 総当たり対策: 同じ接続元は15分で10回まで。
  -- 接続元が取れない環境（unknown）では全員が同じ値になり巻き添えロックが
  -- 起きるため、その場合はこの判定を行わない。
  if raw_ip is not null and btrim(raw_ip) <> '' and btrim(raw_ip) <> 'unknown' then
    select count(*) into fails_ip
      from public.stock_access_log
     where ip_hash = iph and not ok and attempted_at > now() - interval '15 minutes';
    if fails_ip >= 10 then
      raise exception '認証の失敗が続いたため、しばらく開けません。15分ほど時間をおいてからお試しください。';
    end if;
  end if;

  select * into sp
    from public.stock_pages
   where slug = p_slug and is_active and password_hash is not null;

  -- 同じページに対する総当たりも止める: 15分で200回まで
  -- （bcrypt の計算コストと合わせ、分散攻撃でも現実的な速度にならない）
  if sp.id is not null then
    select count(*) into fails_pg
      from public.stock_access_log
     where page_id = sp.id and not ok and attempted_at > now() - interval '15 minutes';
    if fails_pg >= 200 then
      raise exception '認証の失敗が続いたため、しばらく開けません。15分ほど時間をおいてからお試しください。';
    end if;
  end if;

  if sp.id is not null and p_password is not null
     and extensions.crypt(p_password, sp.password_hash) = sp.password_hash then
    matched := true;
  end if;

  insert into public.stock_access_log (page_id, ip_hash, ok)
  values (sp.id, iph, matched);

  -- 古い記録はたまに掃除する
  if random() < 0.02 then
    delete from public.stock_access_log where attempted_at < now() - interval '2 days';
  end if;

  if not matched then
    return null;
  end if;

  update public.stock_pages set view_count = view_count + 1 where id = sp.id;

  select display_name, headline, area_pref, avatar_url, contact_pref, contact_dm_url, is_published
    into c from public.creators where id = sp.creator_id;

  select coalesce(jsonb_agg(x order by x.sort_order, x.created_at), '[]'::jsonb) into items
  from (
    select id, kind, title, description, provider, video_id, url,
           thumbnail_url, width, sort_order, created_at
      from public.stock_items where page_id = sp.id
  ) x;

  select coalesce(jsonb_agg(y order by y.sort_order, y.created_at), '[]'::jsonb) into links
  from (
    select platform, url, label, sort_order, created_at
      from public.creator_links where creator_id = sp.creator_id
  ) y;

  return jsonb_build_object(
    'page', jsonb_build_object(
      'title', sp.title,
      'intro', sp.intro,
      'updated_at', sp.updated_at
    ),
    'creator', jsonb_build_object(
      'id', case when c.is_published then sp.creator_id::text else null end,
      'display_name', c.display_name,
      'headline', c.headline,
      'area_pref', c.area_pref,
      'avatar_url', c.avatar_url,
      'contact_pref', c.contact_pref,
      'contact_dm_url', c.contact_dm_url
    ),
    'links', links,
    'items', items
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 21-L. 権限（列を明示。ここに無い列はユーザーからは書けない）
-- ---------------------------------------------------------------------

-- creators に増えた列
grant insert (contact_pref, contact_dm_url) on public.creators to authenticated;
grant update (contact_pref, contact_dm_url) on public.creators to authenticated;

grant select on public.creator_links to anon, authenticated;
grant insert (creator_id, platform, url, label, sort_order) on public.creator_links to authenticated;
grant update (platform, url, label, sort_order)             on public.creator_links to authenticated;
grant delete on public.creator_links to authenticated;

-- password_hash は SELECT も UPDATE も渡さない。
-- view_count / password_updated_at もユーザーには書かせない。
grant select (id, creator_id, slug, title, intro, password_updated_at,
              is_active, view_count, created_at, updated_at)
  on public.stock_pages to authenticated;
grant insert (creator_id, slug, title, intro, is_active) on public.stock_pages to authenticated;
grant update (slug, title, intro, is_active)             on public.stock_pages to authenticated;
grant delete on public.stock_pages to authenticated;

grant select on public.stock_items to authenticated;
grant insert (page_id, kind, title, description, provider, video_id, url,
              thumbnail_url, width, sort_order) on public.stock_items to authenticated;
grant update (kind, title, description, provider, video_id, url,
              thumbnail_url, width, sort_order) on public.stock_items to authenticated;
grant delete on public.stock_items to authenticated;

grant select on public.creator_follows to authenticated;
grant insert (follower_user_id, creator_id, notify) on public.creator_follows to authenticated;
grant update (notify) on public.creator_follows to authenticated;
grant delete on public.creator_follows to authenticated;

grant select on public.creator_follow_excludes to authenticated;
grant insert (creator_id, follower_user_id) on public.creator_follow_excludes to authenticated;
grant delete on public.creator_follow_excludes to authenticated;

-- stock_access_log には一切権限を与えない（意図的に GRANT を書かない）

grant execute on function public.owns_stock_page(uuid)              to authenticated;
grant execute on function public.set_stock_password(text)           to authenticated;
grant execute on function public.get_stock_page_meta(text)          to anon, authenticated;
grant execute on function public.open_stock_page(text, text)        to anon, authenticated;
