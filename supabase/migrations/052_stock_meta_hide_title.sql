-- 052 鍵付きページ：パスワードを入れる前は、ページのタイトルを返さない（社名や案件名が漏れないように・2026-11-15 翠くん）
create or replace function public.get_stock_page_meta(p_slug text)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  sp record;
  c  record;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    return null;
  end if;
  select id, creator_id into sp
    from public.stock_pages
   where slug = p_slug and is_active and password_hash is not null;
  if sp.id is null then
    return null;
  end if;
  select display_name, avatar_url into c from public.creators where id = sp.creator_id;
  return jsonb_build_object('title', null, 'creator_name', c.display_name, 'avatar_url', c.avatar_url);
end;
$function$;
