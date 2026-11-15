-- =====================================================================
--  Eizo Maps / 042  退会のしくみ（30日の猶予つき）
--  ---------------------------------------------------------------
--  2026-11-15 翠くん決定：
--   ・入口はお問い合わせのページ。30日の猶予（戻せる）
--   ・その人が書いた評価は残す（名前はもともと出ない）
--   ・その人について書かれた評価：会社は表に出したまま／個人は隠してデータは残す
--     同じ人がまた登録したら、前の評価が自動でつながる
--  ★ 大事：今の作りは「アカウントを消すと評価も消える」（reviews が auth.users に cascade）
--    なので退会は「アカウントは消さずに、中身を消す」形にする
--  ★ このファイルは「作る・足すだけ」。既存の表・関数は消さない
-- =====================================================================

-- 合言葉（ハッシュ用・自動実行用）
insert into public.app_internal(key, value)
values ('withdraw_pepper', encode(extensions.gen_random_bytes(32), 'hex')),
       ('withdraw_cron',   encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- 退会の記録（運営とサーバーの処理だけが読む）
create table if not exists public.account_withdrawals (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null,
  requested_at            timestamptz not null default now(),
  purge_after             timestamptz not null default (now() + interval '30 days'),
  keep_received_reviews   boolean not null default false,  -- 本人が「評価だけは残す」を選んだ
  prev_is_published       boolean,                         -- 戻すときに元に戻す
  prev_display_name       text,                            -- 申請で再表示するときのため
  restored_at             timestamptz,
  purged_at               timestamptz,
  email_hash              text,                            -- 元に戻せない形。また登録したかの見分けだけ
  google_hash             text,
  relinked_to             uuid,
  relinked_at             timestamptz,
  show_received_reviews   boolean not null default false,  -- 申請を運営が認めたとき（次の段階で使う）
  note                    text
);
create unique index if not exists account_withdrawals_active
  on public.account_withdrawals(user_id) where restored_at is null and purged_at is null;
create index if not exists account_withdrawals_hash on public.account_withdrawals(email_hash);
alter table public.account_withdrawals enable row level security;
alter table public.account_withdrawals force row level security;
revoke all on public.account_withdrawals from public, anon, authenticated;

-- 評価をつなぎ直した記録
create table if not exists public.review_relinks (
  id           uuid primary key default gen_random_uuid(),
  old_user_id  uuid not null,
  new_user_id  uuid not null,
  moved        integer not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.review_relinks enable row level security;
alter table public.review_relinks force row level security;
revoke all on public.review_relinks from public, anon, authenticated;

-- ハッシュ（小文字にして合言葉をまぜる）
create or replace function public.withdraw_hash(p text)
returns text language sql stable security definer set search_path = '' as $$
  select case when p is null or p = '' then null else
    encode(extensions.digest(lower(trim(p)) || (select value from public.app_internal where key = 'withdraw_pepper'), 'sha256'), 'hex') end;
$$;
revoke execute on function public.withdraw_hash(text) from public, anon, authenticated;

-- 自分の退会の状態（なければ null）
create or replace function public.my_withdrawal()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('requested_at', w.requested_at, 'purge_after', w.purge_after,
                            'keep_received_reviews', w.keep_received_reviews)
    from public.account_withdrawals w
   where w.user_id = auth.uid() and w.restored_at is null and w.purged_at is null
   limit 1;
$$;
revoke execute on function public.my_withdrawal() from public, anon;
grant execute on function public.my_withdrawal() to authenticated;

-- 退会する（本人）
create or replace function public.request_withdrawal(p_confirm text, p_keep_reviews boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w   public.account_withdrawals;
begin
  if uid is null then raise exception 'ログインが必要です'; end if;
  if coalesce(p_confirm, '') <> '退会する' then raise exception '確認の欄に「退会する」と入れてください'; end if;
  if exists (select 1 from public.app_admins a where a.user_id = uid) then
    raise exception '運営のアカウントは、この画面からは退会できません';
  end if;
  if exists (select 1 from public.account_withdrawals x where x.user_id = uid and x.restored_at is null and x.purged_at is null) then
    raise exception 'すでに退会の手続き中です';
  end if;
  insert into public.account_withdrawals(user_id, keep_received_reviews, prev_is_published, prev_display_name)
  select uid, coalesce(p_keep_reviews, false),
         (select c.is_published from public.creators c where c.user_id = uid limit 1),
         coalesce((select c.display_name from public.creators c where c.user_id = uid limit 1),
                  (select cl.display_name from public.clients cl where cl.user_id = uid limit 1))
  returning * into w;
  -- 表から隠す（データはまだ消さない）
  update public.creators set is_published = false, updated_at = now() where user_id = uid;
  return jsonb_build_object('requested_at', w.requested_at, 'purge_after', w.purge_after);
end;
$$;
revoke execute on function public.request_withdrawal(text, boolean) from public, anon;
grant execute on function public.request_withdrawal(text, boolean) to authenticated;

-- 元に戻す（本人・30日以内）
create or replace function public.restore_withdrawal()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  w   public.account_withdrawals;
begin
  if uid is null then raise exception 'ログインが必要です'; end if;
  select * into w from public.account_withdrawals x
   where x.user_id = uid and x.restored_at is null and x.purged_at is null limit 1;
  if not found then return false; end if;
  if w.purge_after <= now() then raise exception '30日を過ぎたため、元に戻せません'; end if;
  update public.account_withdrawals set restored_at = now() where id = w.id;
  update public.creators set is_published = coalesce(w.prev_is_published, false), updated_at = now() where user_id = uid;
  return true;
end;
$$;
revoke execute on function public.restore_withdrawal() from public, anon;
grant execute on function public.restore_withdrawal() to authenticated;

-- また登録した人に、前の評価をつなぐ（ログインのたびに呼んでよい・何もなければ 0）
create or replace function public.relink_my_reviews()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  uid  uuid := auth.uid();
  eh   text;
  gh   text;
  w    record;
  n    integer := 0;
  m    integer;
begin
  if uid is null then return 0; end if;
  select public.withdraw_hash(u.email) into eh from auth.users u where u.id = uid;
  select public.withdraw_hash(i.provider_id) into gh from auth.identities i where i.user_id = uid and i.provider = 'google' limit 1;
  for w in
    select * from public.account_withdrawals x
     where x.purged_at is not null and x.relinked_to is null and x.user_id <> uid
       and ((eh is not null and x.email_hash = eh) or (gh is not null and x.google_hash = gh))
  loop
    update public.reviews set reviewee_id = uid where reviewee_id = w.user_id;
    get diagnostics m = row_count;
    update public.review_objections set reviewee_id = uid where reviewee_id = w.user_id;
    update public.account_withdrawals set relinked_to = uid, relinked_at = now() where id = w.id;
    insert into public.review_relinks(old_user_id, new_user_id, moved) values (w.user_id, uid, m);
    n := n + m;
  end loop;
  return n;
end;
$$;
revoke execute on function public.relink_my_reviews() from public, anon;
grant execute on function public.relink_my_reviews() to authenticated;

-- 30日たった人の中身を消す（サーバーの処理だけが呼ぶ）
--   消す：作品・鍵付きページ・共有リンク・スケジュール・ひな形・Google の情報・プロフィールの中身
--   残す：アカウントの番号・評価・案件の記録・申し立て・停止の記録
--   ログインのメールの書き換えと、画像ファイルの削除は、サーバーの処理（Edge Function）で行う
create or replace function public.withdraw_purge_user(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w    public.account_withdrawals;
  cids uuid[];
  eh   text;
  gh   text;
begin
  select * into w from public.account_withdrawals x
   where x.user_id = p_user and x.restored_at is null and x.purged_at is null limit 1;
  if not found then raise exception 'この人の退会の記録がありません'; end if;
  if w.purge_after > now() then raise exception 'まだ30日たっていません'; end if;

  select array_agg(c.id) into cids from public.creators c where c.user_id = p_user;
  select public.withdraw_hash(u.email) into eh from auth.users u where u.id = p_user;
  select public.withdraw_hash(i.provider_id) into gh from auth.identities i where i.user_id = p_user and i.provider = 'google' limit 1;

  if cids is not null then
    delete from public.portfolios       where creator_id = any(cids);
    delete from public.stock_pages      where creator_id = any(cids);
    delete from public.share_links      where creator_id = any(cids);
    delete from public.creator_links    where creator_id = any(cids);
    delete from public.creator_packages where creator_id = any(cids);
    delete from public.creator_genres   where creator_id = any(cids);
    delete from public.creator_follows  where creator_id = any(cids);
    delete from public.creator_follow_excludes where creator_id = any(cids);
    update public.creators
       set display_name = '退会したユーザー', headline = null, bio = null, avatar_url = null,
           website_url = null, handle = null, is_published = false, contact_dm_url = null,
           equipment = null, area_city = null, share_availability = false, updated_at = now()
     where id = any(cids);
  end if;
  delete from public.creator_follows         where follower_user_id = p_user;
  delete from public.creator_follow_excludes where follower_user_id = p_user;
  delete from public.schedule_events    where owner_user_id = p_user;
  delete from public.schedule_items     where owner_user_id = p_user;
  delete from public.schedule_shares    where owner_user_id = p_user;
  delete from public.schedule_projects  where owner_user_id = p_user;
  delete from public.message_templates  where owner_user_id = p_user;
  delete from public.user_home          where user_id = p_user;
  delete from public.calendar_accounts  where user_id = p_user;
  delete from public.calendar_links     where user_id = p_user;
  delete from public.google_busy        where user_id = p_user;
  delete from public.google_busy_ranges where user_id = p_user;
  delete from public.google_delete_queue where user_id = p_user;
  delete from public.stock_requests     where requester_id = p_user;
  delete from public.stock_handovers    where recipient_id = p_user;
  update public.dm_messages set body = '（退会したユーザーのメッセージ）', meta = null where sender_id = p_user;
  update public.clients set display_name = '退会したユーザー', area_pref = null, updated_at = now() where user_id = p_user;
  update public.users   set display_name = '退会したユーザー', updated_at = now() where id = p_user;
  -- Google のつながりを外す（同じ Google でまた登録できるように）
  delete from auth.identities where user_id = p_user and provider <> 'email';

  update public.account_withdrawals set purged_at = now(), email_hash = eh, google_hash = gh where id = w.id;
  return jsonb_build_object('user_id', p_user, 'creators', coalesce(array_length(cids, 1), 0));
end;
$$;
revoke execute on function public.withdraw_purge_user(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_purge_user(uuid) to service_role;

-- 30日たった人の一覧（サーバーの処理だけ）
create or replace function public.withdraw_due()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select w.user_id from public.account_withdrawals w
   where w.restored_at is null and w.purged_at is null and w.purge_after <= now()
   order by w.purge_after limit 50;
$$;
revoke execute on function public.withdraw_due() from public, anon, authenticated;
grant execute on function public.withdraw_due() to service_role;

-- 運営：退会の一覧
create or replace function public.admin_withdrawals()
returns table(id uuid, user_id uuid, name text, requested_at timestamptz, purge_after timestamptz,
              restored_at timestamptz, purged_at timestamptz, keep_received_reviews boolean,
              relinked_at timestamptz, show_received_reviews boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_admins a where a.user_id = auth.uid()) then
    raise exception '運営だけが見られます';
  end if;
  return query
    select w.id, w.user_id, w.prev_display_name, w.requested_at, w.purge_after, w.restored_at,
           w.purged_at, w.keep_received_reviews, w.relinked_at, w.show_received_reviews
      from public.account_withdrawals w order by w.requested_at desc limit 200;
end;
$$;
revoke execute on function public.admin_withdrawals() from public, anon;
grant execute on function public.admin_withdrawals() to authenticated;
