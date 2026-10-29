-- 030: 外から読める評価を「表に出ているクリエイター」と「クライアントへの評価」にしぼる
--
-- これまで public_reviews は、公開済みの評価ならだれのものでも読めた。
-- 承認前・停止中・非公開のクリエイターは中身を出さない決まり（029）なので、評価も合わせて出さない。
--   ・クライアントがクリエイターに書いた評価 → 書かれたクリエイターが「公開・承認済み・停止していない」ときだけ
--   ・クリエイターがクライアントに書いた評価 → これまでどおり読める
-- 列は変えない（今の画面・検索エンジン向けのページはそのまま動く）。

create or replace view public.public_reviews
with (security_barrier = true) as
select r.id,
       r.reviewee_id,
       r.reviewer_role,
       r.score,
       r.comment,
       r.published_at,
       r.source,
       exists (select 1 from public.review_objections o where o.review_id = r.id and o.status = 'open') as objected,
       exists (select 1 from public.review_objections o where o.review_id = r.id and o.status = 'kept') as objection_kept
  from public.reviews r
 where r.status = 'published'
   and (
     r.reviewer_role = 'creator'
     or exists (
       select 1 from public.creators c
        where c.user_id = r.reviewee_id
          and c.is_published and c.approved and not c.suspended
     )
   );

grant select on public.public_reviews to anon, authenticated;
