-- 046 募集の一覧を、ログインしていない人も見られるようにする（045 の見え方の決まりを分けた）
--   anon は my_client_id() などを使えないため、ログインしていない人用の決まりを別にする
drop policy if exists job_posts_select on public.job_posts;
create policy job_posts_select_public on public.job_posts for select to anon
  using (status = 'open' and closes_on >= current_date);
create policy job_posts_select on public.job_posts for select to authenticated
  using ((status = 'open' and closes_on >= current_date)
         or client_id = public.my_client_id()
         or public.proposed_to_job_post(id)
         or public.is_admin());
