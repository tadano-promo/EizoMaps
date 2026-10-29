-- 031: 会社（依頼する側）の評価ページ
--
-- 決まったこと（2026-10-29 翠くん）：会社名を入れた依頼者だけ公開する。個人の依頼者は出さない。
-- 公開するもの：会社名・都道府県・クリエイターから受けた評価とコメント（書いた人の名前は出さない）
-- 公開しないもの：依頼者のお名前（担当者名）・ログインのメールアドレスなど
-- 評価が1件もない会社はページを出さない（会社名だけ並べることはしない）。
-- 会社名は依頼者の自己申告なので、ページには「会社名は依頼者の申告」と書く。
-- アカウントが停止中の人は出さない。

create or replace function public.company_is_listed(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clients cl
     where cl.id = p_client_id
       and coalesce(btrim(cl.company), '') <> ''
       and not exists (select 1 from public.creators c where c.user_id = cl.user_id and c.suspended)
       and exists (
         select 1 from public.reviews r
          where r.reviewee_id = cl.user_id and r.reviewer_role = 'creator' and r.status = 'published'
       )
  );
$$;

-- 一覧（会社名・都道府県・評価の平均と件数）
create or replace function public.public_companies()
returns table (id uuid, company text, area_pref text, rated_count int, avg_score numeric, last_review_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select cl.id, btrim(cl.company), cl.area_pref,
         count(r.id)::int, round(avg(r.score)::numeric, 1), max(r.published_at)
    from public.clients cl
    join public.reviews r on r.reviewee_id = cl.user_id and r.reviewer_role = 'creator' and r.status = 'published'
   where public.company_is_listed(cl.id)
   group by cl.id, cl.company, cl.area_pref
   order by max(r.published_at) desc
   limit 500;
$$;

-- 1社分（評価とコメントつき）
create or replace function public.public_company(p_client_id uuid)
returns json
language sql stable security definer
set search_path = ''
as $$
  select case when not public.company_is_listed(p_client_id) then null else (
    select json_build_object(
      'id', cl.id,
      'company', btrim(cl.company),
      'area_pref', cl.area_pref,
      'reviews', coalesce((
        select json_agg(json_build_object(
                 'score', r.score, 'comment', r.comment, 'published_at', r.published_at, 'source', r.source,
                 'objected', exists (select 1 from public.review_objections o where o.review_id = r.id and o.status = 'open'),
                 'objection_kept', exists (select 1 from public.review_objections o where o.review_id = r.id and o.status = 'kept'))
               order by r.published_at desc)
          from public.reviews r
         where r.reviewee_id = cl.user_id and r.reviewer_role = 'creator' and r.status = 'published'
      ), '[]'::json)
    )
    from public.clients cl where cl.id = p_client_id
  ) end;
$$;

grant execute on function public.company_is_listed(uuid) to anon, authenticated;
grant execute on function public.public_companies() to anon, authenticated;
grant execute on function public.public_company(uuid) to anon, authenticated;
