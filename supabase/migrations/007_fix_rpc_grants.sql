-- =====================================================================
-- 007 関数の実行権限を「必要な人だけ」に揃え直す（2026-10-10）
-- ---------------------------------------------------------------------
-- 背景
--   006 で anon（ログインしていない人）から一部の関数を外したが、
--   Postgres の初期設定で「全員（PUBLIC）」に実行権限が付いたままの関数が
--   多く残っていた。また、ログインしていない人の閲覧ルール（RLS）が
--   内部で使う関数（is_admin / owns_creator など）まで外れたため、
--   ログアウト状態でクリエイター一覧などを読むと
--   「permission denied for function is_admin」で失敗していた。
--
-- 方針
--   1. public スキーマの関数は、まず全員（PUBLIC / anon / authenticated）から外す
--   2. 画面から呼ぶもの・閲覧ルールが使うものだけを付け直す
--   3. トリガー用の関数は誰にも付けない（トリガーの実行に権限は不要）
--
-- 閲覧ルールの補助関数（is_admin / owns_creator など）を anon に付けても、
-- ログインしていなければ auth.uid() が空なので必ず false になる。
-- 何かが見えるようになることはない。
--
-- 何度実行しても同じ結果になる。
-- =====================================================================

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- これから作る関数にも、全員への実行権限を自動で付けない
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------
-- A. ログインしていない人も呼べる（公開ページの入口）
-- ---------------------------------------------------------------------
grant execute on function public.ping()                                  to anon, authenticated;
grant execute on function public.open_stock_page(text, text)             to anon, authenticated;
grant execute on function public.get_stock_page_meta(text)               to anon, authenticated;
grant execute on function public.get_share_link(text)                    to anon, authenticated;
grant execute on function public.touch_share_link(text)                  to anon, authenticated;
grant execute on function public.creator_busy_days(uuid, date, date)     to anon, authenticated;
grant execute on function public.creators_busy_between(date, date)       to anon, authenticated;

-- 閲覧ルール（RLS）が anon の読み取りで使う補助関数
grant execute on function public.creator_is_published(uuid)              to anon, authenticated;
grant execute on function public.portfolio_is_public(uuid)               to anon, authenticated;
grant execute on function public.is_admin()                              to anon, authenticated;
grant execute on function public.owns_creator(uuid)                      to anon, authenticated;
grant execute on function public.owns_portfolio(uuid)                    to anon, authenticated;
grant execute on function public.is_my_project_creator(uuid)             to anon, authenticated;

-- ---------------------------------------------------------------------
-- B. ログインしている人だけ（自分向けの操作・自分の判定）
--    運営用（admin_* / set_article_status）は関数の中で is_admin() を確認している
-- ---------------------------------------------------------------------
grant execute on function public.my_creator_id()                         to authenticated;
grant execute on function public.my_client_id()                          to authenticated;
grant execute on function public.my_roles()                              to authenticated;
grant execute on function public.is_article_writer()                     to authenticated;
grant execute on function public.is_my_project_client(uuid)              to authenticated;
grant execute on function public.is_project_party(uuid)                  to authenticated;
grant execute on function public.owns_share_link(uuid)                   to authenticated;
grant execute on function public.owns_stock_page(uuid)                   to authenticated;
grant execute on function public.can_see_project_schedule(uuid)          to authenticated;
grant execute on function public.project_counterparty(uuid)              to authenticated;
grant execute on function public.project_my_role(uuid)                   to authenticated;
grant execute on function public.set_stock_password(text)                to authenticated;
grant execute on function public.my_calendar_link()                      to authenticated;
grant execute on function public.set_calendar_sync(boolean, boolean)     to authenticated;
grant execute on function public.set_article_status(uuid, text)          to authenticated;
grant execute on function public.admin_overview()                        to authenticated;
grant execute on function public.admin_list_writers()                    to authenticated;
grant execute on function public.admin_add_writer(text, text)            to authenticated;
grant execute on function public.admin_remove_writer(uuid)               to authenticated;

-- C. トリガー用（check_*_limit / enforce_* / stamp_* / set_updated_at /
--    mark_schedule_unsynced / queue_google_delete / handle_new_user）は付けない
