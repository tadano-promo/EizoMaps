-- =====================================================================
-- 010b 評価の仕組み v2 の権限（2026-10-12）
-- 010_reviews_v2.sql のあとに実行する。何度実行しても同じ結果になる。
-- =====================================================================

-- 外の取引の評価を書くための列（status / published_at は渡さない＝自分で公開できない）
grant insert (source, external_note) on public.reviews to authenticated;
grant update (external_note) on public.reviews to authenticated;

-- 書けるのは自分の名前でだけ。Eizo Maps の取引は当事者だけ、外の取引は案件なしで
drop policy if exists reviews_insert_party on public.reviews;
create policy reviews_insert_party on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and (
      (source = 'platform' and public.is_project_party(project_id))
      or (source = 'external' and project_id is null)
    )
  );

-- 異議申し立ては、書かれた本人・書いた本人・運営だけが見られる
grant select on public.review_objections to authenticated;
drop policy if exists review_objections_select on public.review_objections;
create policy review_objections_select on public.review_objections
  for select to authenticated
  using (
    reviewee_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.reviews r
                where r.id = review_id and r.reviewer_id = auth.uid())
  );
-- insert / update / delete は関数経由だけ（直接は書かせない）

-- 新しい関数は、初期状態だと誰でも呼べてしまうので、いったん外してから付け直す
revoke execute on function public.object_to_review(uuid, text)                 from public, anon;
revoke execute on function public.withdraw_review(uuid)                        from public, anon;
revoke execute on function public.admin_review_queue()                         from public, anon;
revoke execute on function public.admin_decide_review(uuid, boolean)           from public, anon;
revoke execute on function public.admin_resolve_objection(uuid, boolean, text) from public, anon;

grant execute on function public.object_to_review(uuid, text)               to authenticated;
grant execute on function public.withdraw_review(uuid)                      to authenticated;
grant execute on function public.admin_review_queue()                       to authenticated;
grant execute on function public.admin_decide_review(uuid, boolean)         to authenticated;
grant execute on function public.admin_resolve_objection(uuid, boolean, text) to authenticated;

-- 公開ビューは今までどおり誰でも読める
grant select on public.public_reviews to anon, authenticated;
