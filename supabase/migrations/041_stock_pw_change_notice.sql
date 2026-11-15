-- =====================================================================
--  Eizo Maps / 041
--  鍵付きページのパスワードを変えたとき、渡した相手に知らせる
--  ---------------------------------------------------------------
--  2026-11-15 翠くん（管理画面の改善案「パスワード変更をフォロワーに知らせる」を「やると決めた」に）
--   ・知らせる相手：パスワードを渡したことがある人だけ（フォローしているだけの人には知らせない）
--   ・新しいパスワードも送るかどうかは、毎回クリエイターが選ぶ
--       「新しいパスワードも渡す」／「変えたことだけ知らせる」／「知らせない」
--     相手ごとにチェックを外せる（パスワードを変える目的が「この人にはもう見せない」のこともあるため）
--
--  ★ しくみ
--   ・知らせはメッセージ（033）で送る。メールの仕組みは増やさない
--   ・新しいパスワードを渡すときは、今までの受け渡し（give_stock）をそのまま通す
--     → パスワードは本文に入らず、受け取った人と本人だけが関数を通して見られる（037 と同じ）
--     → パスワードはデータベースの中で本人用の形から取り出す。画面から送らない
--   ・知らせられるのは、そのページを渡したことがある相手のやりとりだけ
--   ・作る・上書きするだけ（消す・外す命令は末尾の revoke だけ）
-- =====================================================================

-- 知らせる先の一覧（クリエイター本人だけ）。相手ごとに新しい1件
create or replace function public.stock_pw_notice_targets(p_page_id uuid)
returns table (thread_id uuid, recipient_name text, given_at timestamptz, still_valid boolean)
language sql stable security definer set search_path = '' as $$
  select x.thread_id,
         coalesce(
           (select c3.display_name from public.creators c3 where c3.user_id = x.recipient_id and c3.is_published limit 1),
           (select coalesce(nullif(btrim(cl.company), '') || '　' || cl.display_name, cl.display_name)
              from public.clients cl where cl.user_id = x.recipient_id limit 1),
           'Eizo Maps のユーザー'),
         x.given_at,
         sp.password_hash is not null
           and extensions.crypt(extensions.pgp_sym_decrypt(x.password_enc, public.stock_pw_key()), sp.password_hash) = sp.password_hash
    from (select distinct on (h.recipient_id) h.* from public.stock_handovers h
           where h.page_id = p_page_id order by h.recipient_id, h.given_at desc) x
    join public.stock_pages sp on sp.id = x.page_id
   where sp.creator_id = public.my_creator_id()
   order by x.given_at desc
   limit 50;
$$;

-- 知らせる（クリエイター本人だけ）
--   p_give = true  … 新しいパスワードも渡す（give_stock を通す）
--   p_give = false … 変えたことだけ知らせる
--   戻り値：知らせた相手の数
create or replace function public.notify_stock_pw_change(p_page_id uuid, p_thread_ids uuid[], p_give boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := public.my_creator_id();
  sp record;
  tid uuid;
  pw text;
  n integer := 0;
begin
  if cid is null then raise exception 'クリエイター登録が必要です'; end if;
  if p_thread_ids is null or cardinality(p_thread_ids) < 1 then raise exception '知らせる相手を選んでください'; end if;
  if cardinality(p_thread_ids) > 20 then raise exception '一度に知らせられるのは20人までです'; end if;

  select id, title, is_active, password_hash, password_enc into sp
    from public.stock_pages where id = p_page_id and creator_id = cid;
  if sp.id is null then raise exception 'ページが見つかりません'; end if;
  if sp.password_hash is null then raise exception 'パスワードがまだ設定されていません'; end if;

  -- 先に全部を確かめる（1つでも合わなければ、何も送らない）
  foreach tid in array p_thread_ids loop
    if not exists (select 1 from public.stock_handovers h
                    where h.page_id = sp.id and h.creator_id = cid and h.thread_id = tid) then
      raise exception 'このページを渡していない相手が含まれています';
    end if;
  end loop;

  if p_give then
    if not sp.is_active then raise exception '「%」はいま公開していません。公開してから渡してください', sp.title; end if;
    pw := extensions.pgp_sym_decrypt(sp.password_enc, public.stock_pw_key());
    if pw is null or extensions.crypt(pw, sp.password_hash) <> sp.password_hash then
      raise exception '新しいパスワードを取り出せませんでした。パスワードをもう一度保存してから送ってください';
    end if;
  end if;

  foreach tid in array (select array_agg(distinct t) from unnest(p_thread_ids) t) loop
    if p_give then
      perform public.give_stock(tid,
        jsonb_build_array(jsonb_build_object('page_id', sp.id, 'password', pw)),
        '「' || sp.title || '」のパスワードを変えました。新しいパスワードをお送りします。');
    else
      perform public.reply_dm(tid,
        '「' || sp.title || '」のパスワードを変えました。前のパスワードでは開けなくなっています。'
        || case when sp.is_active then 'もう一度ご覧になりたいときは、取り寄せてください。' else '' end);
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.stock_pw_notice_targets(uuid) from public, anon;
grant execute on function public.stock_pw_notice_targets(uuid) to authenticated;
revoke execute on function public.notify_stock_pw_change(uuid, uuid[], boolean) from public, anon;
grant execute on function public.notify_stock_pw_change(uuid, uuid[], boolean) to authenticated;
