-- 074: ストックページ・限定共有リンクにも、作品棚の「クライアントに見せる情報」（年・媒体・目的・業種・尺・取引先・担当・クレジット）とタグを出す
--   2026-11-20 翠くん「このページの中身に書いてあること、ポートフォリオ管理の情報となんで同期してないの？してないとダメじゃない？」
--   これまで：タイトル・説明・表紙だけが作品棚とつながっていて、詳しい情報はプロフィールにしか出ていなかった
--   取引先の社名は「社名を出す」にした作品だけ入っている（032 の決まり）。作品棚にない、ページだけのブロックは今までどおり

create or replace function public.open_stock_page(p_slug text, p_password text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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

  begin
    raw_ip := split_part(
      coalesce(
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip',
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
        'unknown'),
      ',', 1);
  exception when others then
    raw_ip := 'unknown';
  end;
  iph := encode(extensions.digest(coalesce(btrim(raw_ip), 'unknown'), 'sha256'), 'hex');

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
           p.work_year, p.media, p.purpose, p.industry, p.length_label, p.client_display,
           case when p.client_display = 'named' then p.client_name end as client_name,
           p.role, p.credits,
           (select coalesce(jsonb_agg(t.tag order by t.tag), '[]'::jsonb) from public.portfolio_tags t where t.portfolio_id = p.id) as tags,
           i.width, i.sort_order, i.created_at
      from public.stock_items i
      left join public.portfolios p
        on p.id = i.portfolio_id and p.creator_id = sp.creator_id
     where i.page_id = sp.id
       and (i.portfolio_id is null or (p.id is not null and public.portfolio_released(p.release_on, p.takedown_hold)))
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
$function$;

create or replace function public.get_share_link(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
           p.video_url, p.thumbnail_url, p.created_at, i.sort_order,
           p.work_year, p.media, p.purpose, p.industry, p.length_label, p.client_display,
           case when p.client_display = 'named' then p.client_name end as client_name,
           p.role, p.credits,
           (select coalesce(jsonb_agg(t.tag order by t.tag), '[]'::jsonb) from public.portfolio_tags t where t.portfolio_id = p.id) as tags
    from public.share_link_items i
    join public.portfolios p on p.id = i.portfolio_id
    where i.share_link_id = s.id
      and p.visibility in ('public', 'link_only') and public.portfolio_released(p.release_on, p.takedown_hold)
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
$function$;
