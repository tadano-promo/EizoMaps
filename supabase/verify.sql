-- =====================================================================
--  Eizo Maps / セキュリティ確認クエリ（読み取りのみ・何も変更しません）
--  Supabase ダッシュボード > SQL Editor に貼って実行してください。
--  デプロイ前と、スキーマを変更したあとに毎回実行することを推奨します。
-- =====================================================================

-- 【1】全テーブルで RLS が有効か
--     ng_rls が1行でも出たら、そのテーブルは誰でも読み書きできる状態です。
select c.relname as table_name,
       c.relrowsecurity      as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       case when c.relrowsecurity and c.relforcerowsecurity then 'OK' else 'NG' end as result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by result desc, 1;

-- 【2】RLS は有効だがポリシーが1つも無いテーブル
--     （app_admins は「誰も触れない」ことが正しいので、ここに出るのが正常です）
select c.relname as table_without_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by 1;

-- 【3】ポリシー一覧
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- 【4】anon（未ログイン）が触れるテーブル・ビューと、その権限
--     INSERT / UPDATE / DELETE がここに出たら設計ミスです。
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by 1, 2;

-- 【5】ユーザーに書き換えられては困る列に、権限が渡っていないかの確認
--     ここに1行でも出たら NG です。
select table_name, column_name, privilege_type, grantee
from information_schema.column_privileges
where table_schema = 'public'
  and grantee in ('anon','authenticated')
  and privilege_type in ('INSERT','UPDATE')
  and (
       (table_name = 'reviews'     and column_name in ('status','published_at'))
    or (table_name = 'reports'     and column_name in ('status'))
    or (table_name = 'share_links' and column_name in ('token','view_count'))
    or (table_name = 'projects'    and column_name in ('started_at','delivered_at','paid_at'))
    or (table_name = 'app_admins')
  )
order by 1, 2;

-- 【6】authenticated に渡している列単位の書き込み権限の一覧（目視確認用）
select table_name,
       privilege_type,
       string_agg(column_name, ', ' order by column_name) as columns
from information_schema.column_privileges
where table_schema = 'public' and grantee = 'authenticated'
  and privilege_type in ('INSERT','UPDATE')
group by 1, 2
order by 1, 2;

-- 【7】SECURITY DEFINER 関数の一覧（意図したものだけか確認）
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), '(search_path 未設定！)') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by 1;

-- 【8】ストレージのポリシー
select policyname, cmd, roles::text
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
