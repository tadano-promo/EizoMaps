-- =====================================================================
--  Eizo Maps / 追加マイグレーション 002
--  公式のお知らせ・広告枠・管理者・記事の土台
--  ---------------------------------------------------------------
--  実行方法: Supabase ダッシュボード > SQL Editor に貼り付けて実行
--  何度実行しても同じ結果になります。
--
--  ★ このファイルのセキュリティ方針
--    1. 「管理者かどうか」はサーバー側（app_admins + RLS）だけで判定する。
--       画面側のフラグやパスワードで守らない。ブラウザの中は書き換えられる。
--    2. 公開・非公開を決める列（is_published / status / published_at）は
--       一般ユーザーに GRANT しない。公開操作は管理者専用の RPC を通す。
--    3. 下書きは本人と管理者以外、1行も読めない。
--    4. 将来の自動下書き（Claude の定期タスク等）は source='auto' として
--       service_role で投入する想定。status は必ず draft から始まる。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 22-A. 補助関数
-- ---------------------------------------------------------------------

-- 執筆を許可されたクリエイター（管理者が個別に付与する）
create table if not exists public.article_writers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text check (note is null or char_length(note) <= 200),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.article_writers enable row level security;
alter table public.article_writers force row level security;

create or replace function public.is_article_writer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.article_writers w where w.user_id = auth.uid());
$$;

-- 管理者か執筆者か（画面の出し分け用。判定そのものはサーバー側で行う）
create or replace function public.my_roles()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'admin',  public.is_admin(),
    'writer', public.is_article_writer()
  );
$$;

-- ---------------------------------------------------------------------
-- 22-B. announcements : 公式のお知らせ・アップデート情報
--   visibility = public  … 誰でも見える
--              = members … ログインしている人だけ
-- ---------------------------------------------------------------------
create table if not exists public.announcements (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'update'
                 check (kind in ('update','notice','maintenance','event')),
  title        text not null check (char_length(title) between 1 and 100),
  body         text check (body is null or char_length(body) <= 4000),
  link_url     text check (link_url is null or (link_url ~ '^https://' and char_length(link_url) <= 500)),
  link_label   text check (link_label is null or char_length(link_label) <= 40),
  visibility   text not null default 'public' check (visibility in ('public','members')),
  is_published boolean not null default false,
  pinned       boolean not null default false,
  published_at timestamptz,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.announcements enable row level security;
alter table public.announcements force row level security;
create index if not exists idx_announcements_live
  on public.announcements (is_published, pinned desc, published_at desc);

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at before update on public.announcements
  for each row execute function public.set_updated_at();

-- 公開日時を入れ忘れても、公開にした瞬間に日時が入るようにする
create or replace function public.stamp_announcement_published()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.is_published and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_announcement_publish on public.announcements;
create trigger trg_announcement_publish before insert or update on public.announcements
  for each row execute function public.stamp_announcement_published();

-- ---------------------------------------------------------------------
-- 22-C. ads : 広告枠（自分で登録するバナー）
--   外部の広告スクリプトは読み込まない。画像とリンクだけを持つ。
-- ---------------------------------------------------------------------
create table if not exists public.ads (
  id         uuid primary key default gen_random_uuid(),
  slot       text not null default 'home_top' check (slot in ('home_top','home_side')),
  title      text not null check (char_length(title) between 1 and 80),
  body       text check (body is null or char_length(body) <= 200),
  sponsor    text check (sponsor is null or char_length(sponsor) <= 60),
  image_url  text check (image_url is null or (image_url ~ '^https://' and char_length(image_url) <= 500)),
  link_url   text not null check (link_url ~ '^https://' and char_length(link_url) <= 500),
  starts_at  timestamptz,
  ends_at    timestamptz,
  is_active  boolean not null default false,
  sort_order smallint not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ads_period check (starts_at is null or ends_at is null or ends_at > starts_at)
);
alter table public.ads enable row level security;
alter table public.ads force row level security;
create index if not exists idx_ads_live on public.ads (slot, is_active, sort_order);

drop trigger if exists trg_ads_updated_at on public.ads;
create trigger trg_ads_updated_at before update on public.ads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 22-D. articles : ノウハウ記事（今回は土台のみ。画面は次フェーズ）
--   status  … draft（下書き）→ review（確認待ち）→ published（公開）
--   source  … human（人が書いた）/ auto（自動生成の下書き）
--   status / published_at / source / author_user_id は GRANT しない。
--   = 執筆者は自分で公開できない。公開は管理者の RPC のみ。
-- ---------------------------------------------------------------------
create table if not exists public.articles (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  title          text not null check (char_length(title) between 1 and 120),
  excerpt        text check (excerpt is null or char_length(excerpt) <= 300),
  body_md        text check (body_md is null or char_length(body_md) <= 60000),
  cover_url      text check (cover_url is null or (cover_url ~ '^https://' and char_length(cover_url) <= 500)),
  category       text not null default 'knowhow'
                   check (category in ('knowhow','news','interview','report')),
  visibility     text not null default 'public' check (visibility in ('public','members')),
  status         text not null default 'draft' check (status in ('draft','review','published')),
  source         text not null default 'human' check (source in ('human','auto')),
  author_user_id uuid default auth.uid() references auth.users(id) on delete set null,
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.articles enable row level security;
alter table public.articles force row level security;
create index if not exists idx_articles_live
  on public.articles (status, published_at desc);
create index if not exists idx_articles_author
  on public.articles (author_user_id, updated_at desc);

drop trigger if exists trg_articles_updated_at on public.articles;
create trigger trg_articles_updated_at before update on public.articles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 22-E. RLS ポリシー
-- ---------------------------------------------------------------------

-- announcements ------------------------------------------------------
-- 匿名: 公開済み かつ visibility=public のものだけ
drop policy if exists announcements_read_anon on public.announcements;
create policy announcements_read_anon on public.announcements
  for select to anon
  using (is_published and visibility = 'public'
         and (published_at is null or published_at <= now()));

-- ログイン中: 公開済みは visibility を問わず読める。管理者は全部読める。
drop policy if exists announcements_read_auth on public.announcements;
create policy announcements_read_auth on public.announcements
  for select to authenticated
  using ((is_published and (published_at is null or published_at <= now()))
         or public.is_admin());

drop policy if exists announcements_write_admin on public.announcements;
create policy announcements_write_admin on public.announcements
  for insert to authenticated with check (public.is_admin());

drop policy if exists announcements_update_admin on public.announcements;
create policy announcements_update_admin on public.announcements
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists announcements_delete_admin on public.announcements;
create policy announcements_delete_admin on public.announcements
  for delete to authenticated using (public.is_admin());

-- ads ----------------------------------------------------------------
drop policy if exists ads_read_live on public.ads;
create policy ads_read_live on public.ads
  for select to anon, authenticated
  using (is_active
         and (starts_at is null or starts_at <= now())
         and (ends_at   is null or ends_at   >  now()));

drop policy if exists ads_read_admin on public.ads;
create policy ads_read_admin on public.ads
  for select to authenticated using (public.is_admin());

drop policy if exists ads_insert_admin on public.ads;
create policy ads_insert_admin on public.ads
  for insert to authenticated with check (public.is_admin());

drop policy if exists ads_update_admin on public.ads;
create policy ads_update_admin on public.ads
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ads_delete_admin on public.ads;
create policy ads_delete_admin on public.ads
  for delete to authenticated using (public.is_admin());

-- article_writers ----------------------------------------------------
-- 自分が執筆者かどうかは自分で確認できる。一覧は管理者だけ。
drop policy if exists article_writers_read on public.article_writers;
create policy article_writers_read on public.article_writers
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 付与・解除は RPC 経由のみにするため、INSERT/DELETE のポリシーは作らない。

-- articles -----------------------------------------------------------
drop policy if exists articles_read_anon on public.articles;
create policy articles_read_anon on public.articles
  for select to anon
  using (status = 'published' and visibility = 'public'
         and (published_at is null or published_at <= now()));

-- ログイン中: 公開記事 + 自分が書いた下書き + 管理者は全部
drop policy if exists articles_read_auth on public.articles;
create policy articles_read_auth on public.articles
  for select to authenticated
  using ((status = 'published' and (published_at is null or published_at <= now()))
         or author_user_id = auth.uid()
         or public.is_admin());

-- 書けるのは管理者と執筆許可を受けた人。著者は自分に固定される（列は GRANT しない）。
drop policy if exists articles_insert_writer on public.articles;
create policy articles_insert_writer on public.articles
  for insert to authenticated
  with check ((public.is_admin() or public.is_article_writer())
              and author_user_id = auth.uid());

-- 自分の記事は公開前だけ直せる。公開済みを直せるのは管理者だけ。
drop policy if exists articles_update_own on public.articles;
create policy articles_update_own on public.articles
  for update to authenticated
  using ((author_user_id = auth.uid() and status <> 'published') or public.is_admin())
  with check ((author_user_id = auth.uid() and status <> 'published') or public.is_admin());

drop policy if exists articles_delete_own on public.articles;
create policy articles_delete_own on public.articles
  for delete to authenticated
  using ((author_user_id = auth.uid() and status = 'draft') or public.is_admin());

-- ---------------------------------------------------------------------
-- 22-F. 管理者専用の RPC
--   画面側のボタンを隠すだけでは守りにならないので、
--   実際の権限判定はすべてここ（サーバー側）で行う。
-- ---------------------------------------------------------------------

-- 記事の状態を変える。公開できるのは管理者だけ。
-- 執筆者は「下書き → 確認待ち」までしか動かせない。
create or replace function public.set_article_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a record;
begin
  if p_status not in ('draft','review','published') then
    raise exception '不正な状態です';
  end if;

  select * into a from public.articles where id = p_id;
  if a.id is null then
    raise exception '記事が見つかりません';
  end if;

  if public.is_admin() then
    update public.articles
       set status = p_status,
           published_at = case when p_status = 'published'
                               then coalesce(published_at, now()) else published_at end
     where id = p_id;
    return;
  end if;

  if a.author_user_id <> auth.uid() then
    raise exception 'この記事を操作する権限がありません';
  end if;
  if a.status = 'published' then
    raise exception '公開済みの記事は運営しか変更できません';
  end if;
  if p_status = 'published' then
    raise exception '公開は運営が行います。「確認待ち」にして連絡してください';
  end if;

  update public.articles set status = p_status where id = p_id;
end;
$$;

-- 執筆許可をメールアドレスで付与する（管理者のみ）
create or replace function public.admin_add_writer(p_email text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not public.is_admin() then
    raise exception '権限がありません';
  end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    raise exception 'そのメールアドレスの登録が見つかりません';
  end if;
  insert into public.article_writers (user_id, note, granted_by)
  values (uid, p_note, auth.uid())
  on conflict (user_id) do update set note = excluded.note;
  return uid;
end;
$$;

create or replace function public.admin_remove_writer(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception '権限がありません';
  end if;
  delete from public.article_writers where user_id = p_user_id;
end;
$$;

-- 執筆者の一覧（管理者のみ）。メールアドレスを含むため RPC でしか返さない。
create or replace function public.admin_list_writers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  rows jsonb;
begin
  if not public.is_admin() then
    raise exception '権限がありません';
  end if;
  select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) into rows
  from (
    select w.user_id, u.email, w.note, w.created_at,
           (select display_name from public.creators c where c.user_id = w.user_id) as display_name
      from public.article_writers w
      join auth.users u on u.id = w.user_id
  ) x;
  return rows;
end;
$$;

-- 管理画面トップの概況（管理者のみ）
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception '権限がありません';
  end if;
  return jsonb_build_object(
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
$$;

-- ---------------------------------------------------------------------
-- 22-G. 権限（列を明示）
-- ---------------------------------------------------------------------

-- created_by は既定値（auth.uid()）で入る。名乗りを偽装させないため GRANT しない。
grant select on public.announcements to anon, authenticated;
grant insert (kind, title, body, link_url, link_label, visibility, is_published, pinned, published_at)
  on public.announcements to authenticated;
grant update (kind, title, body, link_url, link_label, visibility, is_published, pinned, published_at)
  on public.announcements to authenticated;
grant delete on public.announcements to authenticated;

grant select on public.ads to anon, authenticated;
grant insert (slot, title, body, sponsor, image_url, link_url, starts_at, ends_at, is_active, sort_order)
  on public.ads to authenticated;
grant update (slot, title, body, sponsor, image_url, link_url, starts_at, ends_at, is_active, sort_order)
  on public.ads to authenticated;
grant delete on public.ads to authenticated;

grant select on public.article_writers to authenticated;
-- INSERT / DELETE は渡さない（RPC 経由のみ）

-- status / published_at / source / author_user_id は渡さない
-- = 執筆者は自分で公開できないし、他人名義の記事も作れない
grant select on public.articles to anon, authenticated;
grant insert (slug, title, excerpt, body_md, cover_url, category, visibility)
  on public.articles to authenticated;
grant update (slug, title, excerpt, body_md, cover_url, category, visibility)
  on public.articles to authenticated;
grant delete on public.articles to authenticated;

grant execute on function public.is_article_writer()                 to anon, authenticated;
grant execute on function public.my_roles()                          to anon, authenticated;
grant execute on function public.set_article_status(uuid, text)      to authenticated;
grant execute on function public.admin_add_writer(text, text)        to authenticated;
grant execute on function public.admin_remove_writer(uuid)           to authenticated;
grant execute on function public.admin_list_writers()                to authenticated;
grant execute on function public.admin_overview()                    to authenticated;

-- ---------------------------------------------------------------------
-- 22-H. ストレージ（広告バナー・記事のカバー画像）
--   置けるのは管理者と執筆許可を受けた人だけ。読み取りは公開。
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 3145728,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'media');

drop policy if exists media_insert_staff on storage.objects;
create policy media_insert_staff on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media'
              and (storage.foldername(name))[1] = auth.uid()::text
              and (public.is_admin() or public.is_article_writer()));

drop policy if exists media_update_staff on storage.objects;
create policy media_update_staff on storage.objects
  for update to authenticated
  using (bucket_id = 'media'
         and (storage.foldername(name))[1] = auth.uid()::text
         and (public.is_admin() or public.is_article_writer()));

drop policy if exists media_delete_staff on storage.objects;
create policy media_delete_staff on storage.objects
  for delete to authenticated
  using (bucket_id = 'media'
         and (storage.foldername(name))[1] = auth.uid()::text
         and (public.is_admin() or public.is_article_writer()));

-- =====================================================================
--  管理者アカウントの登録について
--  ---------------------------------------------------------------
--  app_admins には誰にも GRANT していないため、画面からは登録できません。
--  管理者を増やすときは、この SQL Editor で次を実行してください。
--
--    insert into public.app_admins (user_id, note)
--    select id, '運営' from auth.users where email = 'admin@eizo-maps.com'
--    on conflict (user_id) do nothing;
--
--  外す場合:
--    delete from public.app_admins
--     where user_id = (select id from auth.users where email = 'admin@eizo-maps.com');
-- =====================================================================
