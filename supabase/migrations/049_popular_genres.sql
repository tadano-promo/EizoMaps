-- 049 よく選ばれている職種（上位3つ）。職種の選び方を短くするため（2026-11-15 翠くん）
--   公開しているクリエイターが選んだ数の多い順。数が少ないうち（3人未満）は、
--   撮影技師（カメラマン）・監督・ディレクター・エディター（オフライン編集）で足りない分を埋める
create or replace function public.popular_genres(p_limit integer default 3)
returns table (genre_id smallint)
language sql stable security definer set search_path = '' as $$
  with counted as (
    select cg.genre_id, count(*) as n
      from public.creator_genres cg join public.creators c on c.id = cg.creator_id
     where c.is_published and not coalesce(c.suspended, false)
     group by cg.genre_id having count(*) >= 3
  ), base as (
    select genre_id, n, 0 as pri from counted
    union all
    select x.id::smallint, 0, x.ord from (values (1, 1), (3, 2), (2, 3)) as x(id, ord)
  )
  select genre_id from (
    select genre_id, max(n) as n, min(case when pri = 0 then 0 else pri end) as pri from base group by genre_id
  ) t
  order by n desc, pri
  limit greatest(1, least(p_limit, 10));
$$;
grant execute on function public.popular_genres(integer) to anon, authenticated;
