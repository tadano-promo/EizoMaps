-- =====================================================================
--  Eizo Maps / 038
--  鍵付きページのパスワードは、クリエイター本人が変えない限り変わらない
--  ---------------------------------------------------------------
--  2026-10-31 翠くん：
--   「今後同じことがあった場合を想定すると毎回パスワードが変わり過ぎるのもなので
--     …そんな作業があってもクリエイターが任意で変えない限りは変わらない仕組みにしておく」
--
--  ★ しくみ
--   ・password_hash（開けるかどうかを決める方）は、本人の関数 set_stock_page_password を通したときだけ書き換えられる。
--     それ以外（運営の作業・今後のアップデートの SQL）で書き換えようとすると、データベースが止める
--   ・password_enc（本人に見せる方）は、鍵の入れ替えなどで中身の形が変わってもよい。
--     ただし今後の作業では、必ず「今のパスワードを戻して → 新しい形で入れ直す」をすること（パスワード自体は変えない）
--   ・037 のときのように本人に設定し直してもらう作業は、これからは行わない（docs/RULES_PASSWORDS.md）
-- =====================================================================

create or replace function public.guard_stock_password_hash()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.password_hash is distinct from old.password_hash
     and coalesce(current_setting('em.stock_pw_by_owner', true), '') <> 'on' then
    raise exception 'パスワードは本人しか変えられません（set_stock_page_password を通してください）';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_stock_password_hash() from public, anon, authenticated;

create trigger trg_guard_stock_password_hash before update on public.stock_pages
  for each row execute function public.guard_stock_password_hash();

-- 本人の関数だけが、その場かぎりの印を立てて書き換える
create or replace function public.set_stock_page_password(p_page_id uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := public.my_creator_id();
begin
  if cid is null then raise exception 'クリエイター登録が必要です'; end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'パスワードは6文字以上72文字以下で設定してください';
  end if;
  perform set_config('em.stock_pw_by_owner', 'on', true);
  update public.stock_pages
     set password_hash       = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_enc        = extensions.pgp_sym_encrypt(p_password, public.stock_pw_key()),
         password_updated_at = now()
   where id = p_page_id and creator_id = cid;
  if not found then
    perform set_config('em.stock_pw_by_owner', '', true);
    raise exception 'ページが見つかりません';
  end if;
  perform set_config('em.stock_pw_by_owner', '', true);
end;
$$;
