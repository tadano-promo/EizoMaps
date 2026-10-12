-- =====================================================================
-- 011 管理画面のクリエイター一覧（2026-10-12）
-- 運営だけが呼べる。クリエイターごとの基本情報と、作品・ストックページ・
-- 評価の数をまとめて返す。メールアドレスは運営の連絡用に含める（運営以外には出ない）。
-- =====================================================================
create or replace function public.admin_list_creators()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception '運営のみ利用できます'; end if;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into res from (
    select
      c.id, c.user_id, c.display_name, c.headline, c.area_pref, c.area_city,
      c.years_of_experience, c.is_published, c.contact_pref, c.created_at, c.updated_at,
      u.email,
      u.last_sign_in_at,
      (select coalesce(jsonb_agg(g.name_ja order by g.sort_order), '[]'::jsonb)
         from public.creator_genres cg join public.genres g on g.id = cg.genre_id
        where cg.creator_id = c.id) as genres,
      (select count(*) from public.portfolios p where p.creator_id = c.id) as works,
      (select count(*) from public.portfolios p where p.creator_id = c.id and p.visibility = 'public') as works_public,
      (select count(*) from public.portfolios p where p.creator_id = c.id and p.visibility = 'stock_only') as works_stock_only,
      (select sp.slug from public.stock_pages sp where sp.creator_id = c.id) as stock_slug,
      (select sp.is_active from public.stock_pages sp where sp.creator_id = c.id) as stock_active,
      (select count(*) from public.share_links s where s.creator_id = c.id) as share_links,
      (select count(*) from public.reviews r where r.reviewee_id = c.user_id and r.status = 'published') as reviews_public,
      (select round(avg(r.score)::numeric, 1) from public.reviews r where r.reviewee_id = c.user_id and r.status = 'published') as review_avg,
      (select count(*) from public.reviews r where r.reviewee_id = c.user_id and r.status = 'pending') as reviews_waiting
    from public.creators c
    left join auth.users u on u.id = c.user_id
  ) x;

  return res;
end;
$$;

revoke execute on function public.admin_list_creators() from public, anon;
grant execute on function public.admin_list_creators() to authenticated;
