-- =====================================================================
--  054: 会社の評価ページ（/companies/…）を Google などの検索に出すかを、依頼する側も選べるようにする（2026-11-15 翠くん）
--  ・翠くん「クライアント側の方は、これも、出る設定で大丈夫だよ」
--    → 今いる人も、これから登録する人も「出す」から始まる。マイページ（クライアント）で「出さない」に変えられる
--  ・出さない会社のページは「検索に出さない」印を付け、サイトの地図にも載せない（Eizo Maps の中の会社一覧には出る）
-- =====================================================================
alter table public.clients add column if not exists search_visible boolean not null default true;
grant select (search_visible) on public.clients to authenticated;
grant insert (search_visible) on public.clients to authenticated;
grant update (search_visible) on public.clients to authenticated;

drop function if exists public.public_companies();
create function public.public_companies()
 returns table(id uuid, company text, area_pref text, rated_count integer, avg_score numeric, last_review_at timestamptz, search_visible boolean)
 language sql stable security definer set search_path to ''
as $function$
  select cl.id, btrim(cl.company), cl.area_pref,
         count(r.id)::int, round(avg(r.score)::numeric, 1), max(r.published_at), cl.search_visible
    from public.clients cl
    join public.reviews r on r.reviewee_id = cl.user_id and r.reviewer_role = 'creator' and r.status = 'published'
   where public.company_is_listed(cl.id)
   group by cl.id, cl.company, cl.area_pref, cl.search_visible
   order by max(r.published_at) desc
   limit 500;
$function$;
grant execute on function public.public_companies() to anon, authenticated;
