-- =====================================================================
-- 009 作品棚（ポートフォリオとストックページの作品を共通にする）2026-10-12
-- ---------------------------------------------------------------------
-- ・portfolios を「作品棚」として使う。作品は1回登録すれば、
--   プロフィール／限定共有リンク／ストックページのどれでも使える。
-- ・見せ方（visibility）に 'stock_only'（パスワードページだけ）を追加。
--   守秘義務のある作品は、プロフィールにも限定共有リンクにも出さない。
-- ・stock_items は作品棚の作品を portfolio_id で参照できる。
--   ストックページから「外す」＝ stock_items の行を消すだけ（作品は残る）。
--   作品棚から作品を消すと、ストックページ・共有リンクからも消える。
-- ・あわせて、008 で直し漏れていた TikTok の URL 制限を直す。
-- ・作品の上限を 30 → 120 件にする（ストックページのブロック上限と揃える）。
-- 何度実行しても同じ結果になる。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. portfolios：見せ方に「パスワードページだけ」を追加
-- ---------------------------------------------------------------------
alter table public.portfolios drop constraint if exists portfolios_visibility_check;
alter table public.portfolios
  add constraint portfolios_visibility_check
  check (visibility in ('public', 'link_only', 'stock_only'));

-- TikTok の URL を受け付ける（008 で provider だけ直していた）
alter table public.portfolios drop constraint if exists portfolios_video_url_check;
alter table public.portfolios
  add constraint portfolios_video_url_check
  check (
    video_url ~ '^https://(www\.|m\.)?(youtube\.com/|youtu\.be/|vimeo\.com/|player\.vimeo\.com/|tiktok\.com/)'
    and char_length(video_url) <= 500
  );

-- 作品の上限 30 → 120
create or replace function public.check_portfolio_limit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.portfolios where creator_id = new.creator_id) >= 120 then
    raise exception '登録できる作品数の上限（120件）に達しています';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. stock_items：作品棚の作品を参照できるようにする
-- ---------------------------------------------------------------------
alter table public.stock_items
  add column if not exists portfolio_id uuid references public.portfolios(id) on delete cascade;
create index if not exists idx_stock_items_portfolio on public.stock_items (portfolio_id);

-- 同じページに同じ作品を2回並べない
create unique index if not exists uq_stock_items_page_portfolio
  on public.stock_items (page_id, portfolio_id) where portfolio_id is not null;

-- 形のルール：動画は「作品棚の作品」か「動画情報を直接持つ」のどちらか
alter table public.stock_items drop constraint if exists stock_items_shape;
alter table public.stock_items
  add constraint stock_items_shape check (
    case kind
      when 'video'   then portfolio_id is not null
                          or (provider is not null and video_id is not null and url is not null)
      when 'doc'     then portfolio_id is null and url is not null
      when 'link'    then portfolio_id is null and url is not null
      when 'note'    then portfolio_id is null and description is not null
      when 'heading' then portfolio_id is null and title is not null
      else false
    end
  );

-- portfolio_id は「追加するとき」だけ書ける（あとから別の作品に付け替えさせない）
grant insert (portfolio_id) on public.stock_items to authenticated;

-- 自分のページに、自分の作品だけを並べられる
drop policy if exists stock_items_insert_own on public.stock_items;
create policy stock_items_insert_own on public.stock_items
  for insert to authenticated
  with check (
    public.owns_stock_page(page_id)
    and (portfolio_id is null or public.owns_portfolio(portfolio_id))
  );

-- ---------------------------------------------------------------------
-- 3. 限定共有リンクに「パスワードページだけ」の作品を入れさせない
-- ---------------------------------------------------------------------
create or replace function public.portfolio_shareable(p_portfolio_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.portfolios p
     where p.id = p_portfolio_id and p.visibility in ('public', 'link_only')
  );
$$;
revoke execute on function public.portfolio_shareable(uuid) from public, anon, authenticated;
grant execute on function public.portfolio_shareable(uuid) to authenticated;

drop policy if exists share_link_items_insert_own on public.share_link_items;
create policy share_link_items_insert_own on public.share_link_items
  for insert to authenticated
  with check (
    public.owns_share_link(share_link_id)
    and public.owns_portfolio(portfolio_id)
    and public.portfolio_shareable(portfolio_id)
  );

-- あとから「パスワードページだけ」に変えた作品も、共有リンクには出さない
create or replace function public.get_share_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
      and p.visibility in ('public', 'link_only')
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
revoke execute on function public.get_share_link(text) from public;
grant execute on function public.get_share_link(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. ストックページを開いたとき、作品棚の作品の中身を返す
--    （作品の見せ方が何であっても、パスワードを通った人には見せる）
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

  -- 総当たり対策: 同じ接続元は15分で10回まで
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
    select i.id, i.kind,
           case when p.id is not null then p.title         else i.title         end as title,
           case when p.id is not null then p.description   else i.description   end as description,
           case when p.id is not null then p.provider      else i.provider      end as provider,
           case when p.id is not null then p.video_id      else i.video_id      end as video_id,
           case when p.id is not null then p.video_url     else i.url           end as url,
           case when p.id is not null then p.thumbnail_url else i.thumbnail_url end as thumbnail_url,
           i.width, i.sort_order, i.created_at
      from public.stock_items i
      left join public.portfolios p
        on p.id = i.portfolio_id and p.creator_id = sp.creator_id
     where i.page_id = sp.id
       and (i.portfolio_id is null or p.id is not null)
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
revoke execute on function public.open_stock_page(text, text) from public;
grant execute on function public.open_stock_page(text, text) to anon, authenticated;
