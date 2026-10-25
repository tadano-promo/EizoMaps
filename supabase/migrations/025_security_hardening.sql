-- =====================================================================
-- 025 セキュリティの総点検で見つかったところを固める（2026-10-25）
--   1. ログインしていない人（anon）から、ログイン前提の命令を呼べないようにする
--      （中でも本人確認をしているので今も悪用はできないが、入口そのものを閉じる）
--   2. 「自動で動く仕掛け」（トリガー用の関数）を、外から直接呼べないようにする
--      （トリガーとして動くときは権限を確かめないので、動きは変わらない）
--   3. パスワード付きページの「失敗が続いたら止める」仕組みで、
--      相手の場所（IP）を、なりすましにくい cf-connecting-ip から先に読む
--   4. 画像の置き場所（avatars / media）を、一覧として丸ごと見られないようにする
--      （画像そのものは、今までどおり公開のURLで誰でも見られる）
--   ※ 「消す」系の命令は使わない
-- =====================================================================

-- 1. ログイン前提の命令
revoke execute on function public.create_schedule_share(uuid, text, text, boolean, text[], boolean, date) from public, anon;
revoke execute on function public.update_schedule_share(uuid, text, text, boolean, text[], boolean, date) from public, anon;
revoke execute on function public.set_schedule_share_stopped(uuid, boolean) from public, anon;
revoke execute on function public.my_schedule_shares(uuid) from public, anon;
revoke execute on function public.set_my_handle(text) from public, anon;
grant execute on function public.create_schedule_share(uuid, text, text, boolean, text[], boolean, date) to authenticated, service_role;
grant execute on function public.update_schedule_share(uuid, text, text, boolean, text[], boolean, date) to authenticated, service_role;
grant execute on function public.set_schedule_share_stopped(uuid, boolean) to authenticated, service_role;
grant execute on function public.my_schedule_shares(uuid) to authenticated, service_role;
grant execute on function public.set_my_handle(text) to authenticated, service_role;

-- 2. トリガー用の関数
revoke execute on function public.message_templates_guard() from public, anon, authenticated;
revoke execute on function public.schedule_events_check_sched_project() from public, anon, authenticated;
revoke execute on function public.schedule_items_limit() from public, anon, authenticated;
revoke execute on function public.schedule_projects_limit() from public, anon, authenticated;
revoke execute on function public.creator_milestone_news() from public, anon, authenticated;

-- 3. 相手の場所（IP）の読み方：cf-connecting-ip を先に
do $$
declare
  f text;
  d text;
  old_part text := $q$->> 'x-forwarded-for',
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip',$q$;
  new_part text := $q$->> 'cf-connecting-ip',
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',$q$;
begin
  foreach f in array array['public.open_schedule_share(text,text)', 'public.open_stock_page(text,text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(old_part in d) > 0 then
      execute replace(d, old_part, new_part);
    end if;
  end loop;
end $$;

-- 4. 画像の置き場所：一覧で見られるのは自分のフォルダだけ（上書き保存に必要）
alter policy avatars_public_read on storage.objects
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);
alter policy media_public_read on storage.objects
  to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (auth.uid())::text and (public.is_admin() or public.is_article_writer()));
-- （本番には 025_security_hardening と 025b_storage_list_own_only の2回に分けて適用済み）
