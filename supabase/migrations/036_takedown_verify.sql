-- =====================================================================
-- 036 削除の申し立て：メールの確認・押した人の記録・いたずら対策（2026-10-31）
--   決めた人：タキさん（10/31）
--     ・「先に止める」はそのまま（外に出ている情報なので、止めるほうがリスクが低い）
--     ・ただし「メールの確認」を通した瞬間に止める（でたらめなメールでは止まらない）
--     ・押した人は裏側（運営）だけで分かるようにする。表側（作った本人）には出さない
--     ・判断はかならず人（運営）がする。理由を残す。いたずらは記録して、くり返す人は受付を止める
--   ※ 「消す」系の命令は使わない（作る・足す・上書きだけ）
--   ※ 末尾の revoke は、自動で止まる場合はタキさんに Supabase の画面で貼ってもらう
-- =====================================================================

alter table public.takedown_requests add column if not exists requester_user_id uuid;
alter table public.takedown_requests add column if not exists verified_at timestamptz;
alter table public.takedown_requests add column if not exists confirm_expires_at timestamptz;
alter table public.takedown_requests add column if not exists abusive boolean not null default false;
alter table public.takedown_requests add column if not exists decided_by uuid;
alter table public.takedown_requests add column if not exists user_agent text;

-- これまでの申し立て（この変更の前に届いた分）は、受付済みとして扱う
update public.takedown_requests set verified_at = created_at where verified_at is null and confirm_expires_at is null;

create index if not exists idx_takedown_requester_email on public.takedown_requests (lower(requester_email));
create index if not exists idx_takedown_requester_user on public.takedown_requests (requester_user_id);

-- ---------------------------------------------------------------------
-- 申し立ての受付を止めた人（いたずらをくり返した人）
--   メールアドレス・アカウントは元に戻せない形（指紋）で持つ。誰にも読ませない
-- ---------------------------------------------------------------------
create table if not exists public.takedown_requester_blocks (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('email','user')),
  fingerprint  text not null,
  request_id   uuid references public.takedown_requests(id) on delete set null,
  reason       text check (reason is null or char_length(reason) <= 1000),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  lifted_at    timestamptz,
  lifted_by    uuid
);
alter table public.takedown_requester_blocks enable row level security;
alter table public.takedown_requester_blocks force row level security;
grant select, insert, update on public.takedown_requester_blocks to service_role;
create index if not exists idx_takedown_blocks on public.takedown_requester_blocks (kind, fingerprint);

create or replace function public.takedown_requester_blocked(p_email text, p_user uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.takedown_requester_blocks b
    where b.lifted_at is null
      and ((b.kind = 'email' and p_email is not null and b.fingerprint = public.identity_fingerprint('email', p_email))
        or (b.kind = 'user'  and p_user  is not null and b.fingerprint = public.identity_fingerprint('user', p_user::text)))
  );
$$;

-- ---------------------------------------------------------------------
-- 申し立てを受け付ける
--   ・ログインしていて、そのアカウントのメールと同じなら → その場で確認済み・すぐ一時非公開
--   ・それ以外 → 「確認待ち」で預かるだけ（作品はまだ止めない）。24時間以内にメールの確認が必要
-- ---------------------------------------------------------------------
create or replace function public.submit_takedown(
  p_portfolio_id uuid, p_name text, p_org text, p_email text,
  p_relation text, p_reason text, p_detail text, p_agree boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  pf record;
  raw_ip text;
  iph text;
  ua text;
  n int;
  me uuid := auth.uid();
  my_email text := lower(coalesce(auth.email(), ''));
  verified boolean;
  rid uuid;
begin
  if not coalesce(p_agree, false) then
    raise exception '内容が事実であることへの同意が必要です';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'メールアドレスの形が正しくありません';
  end if;
  if public.takedown_requester_blocked(p_email, me) then
    raise exception 'このメールアドレスからの申し立ては、運営の判断で受付を止めています。info@eizo-maps.com へご連絡ください';
  end if;
  begin
    raw_ip := split_part(coalesce(
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip',
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
      'unknown'), ',', 1);
    ua := left((nullif(current_setting('request.headers', true), '')::jsonb) ->> 'user-agent', 300);
  exception when others then raw_ip := 'unknown'; ua := null;
  end;
  iph := encode(extensions.digest(coalesce(btrim(raw_ip), 'unknown'), 'sha256'), 'hex');
  select count(*) into n from public.takedown_requests where ip_hash = iph and created_at > now() - interval '1 day';
  if n >= 5 then
    raise exception '申し立ての回数が多いため、しばらく受け付けられません。お急ぎの場合は info@eizo-maps.com へご連絡ください';
  end if;
  select count(*) into n from public.takedown_requests where lower(requester_email) = lower(btrim(p_email)) and created_at > now() - interval '1 day';
  if n >= 10 then
    raise exception '申し立ての回数が多いため、しばらく受け付けられません。お急ぎの場合は info@eizo-maps.com へご連絡ください';
  end if;

  select p.id, p.creator_id, p.title into pf from public.portfolios p where p.id = p_portfolio_id;
  if pf.id is null then
    raise exception '作品が見つかりません';
  end if;

  verified := me is not null and my_email <> '' and my_email = lower(btrim(p_email));

  insert into public.takedown_requests
    (portfolio_id, creator_id, work_title, requester_name, requester_org, requester_email, relation, reason, detail,
     ip_hash, user_agent, requester_user_id, verified_at, confirm_expires_at)
  values
    (pf.id, pf.creator_id, pf.title, btrim(p_name), nullif(btrim(coalesce(p_org, '')), ''), btrim(p_email),
     p_relation, p_reason, btrim(p_detail), iph, ua, me,
     case when verified then now() end, case when verified then null else now() + interval '24 hours' end)
  returning id into rid;

  if verified then
    perform set_config('eizo.takedown', 'on', true);
    update public.portfolios set takedown_hold = true where id = pf.id;
  end if;
  return jsonb_build_object('ok', true, 'id', rid, 'verified', verified);
end;
$$;

-- ---------------------------------------------------------------------
-- メールの確認を通した（確認メールのリンクでログインした）→ ここで一時非公開にする
-- ---------------------------------------------------------------------
create or replace function public.confirm_takedown(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  t record;
  me uuid := auth.uid();
  my_email text := lower(coalesce(auth.email(), ''));
begin
  if me is null then raise exception 'メールの確認ができていません。届いたメールのリンクから開いてください'; end if;
  select * into t from public.takedown_requests where id = p_id for update;
  if t.id is null then raise exception 'この申し立ては見つかりません'; end if;
  if lower(t.requester_email) <> my_email then
    raise exception '申し立てに入力したメールアドレスと、確認したメールアドレスが違います';
  end if;
  if t.verified_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'work_title', t.work_title);
  end if;
  if t.confirm_expires_at is null or t.confirm_expires_at < now() then
    raise exception '確認の期限（24時間）が過ぎました。お手数ですが、もう一度申し立てを送ってください';
  end if;
  if public.takedown_requester_blocked(t.requester_email, me) then
    raise exception 'このメールアドレスからの申し立ては、運営の判断で受付を止めています。info@eizo-maps.com へご連絡ください';
  end if;
  update public.takedown_requests set verified_at = now(), requester_user_id = me, confirm_expires_at = null where id = t.id;
  if t.portfolio_id is not null then
    perform set_config('eizo.takedown', 'on', true);
    update public.portfolios set takedown_hold = true where id = t.portfolio_id;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'work_title', t.work_title);
end;
$$;

-- ---------------------------------------------------------------------
-- 作った本人が見る（確認済みの分だけ。申立人の名前・メール・押した人の記録は見せない）
--   due_on：運営が判断する目安の日（受け付けてから7日）
-- ---------------------------------------------------------------------
create or replace function public.my_takedown_requests()
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'portfolio_id', t.portfolio_id, 'work_title', t.work_title,
    'requester_org', t.requester_org, 'relation', t.relation, 'reason', t.reason, 'detail', t.detail,
    'status', t.status, 'creator_response', t.creator_response, 'responded_at', t.responded_at,
    'created_at', t.verified_at, 'due_on', ((t.verified_at + interval '7 days') at time zone 'Asia/Tokyo')::date,
    'decided_at', t.decided_at, 'decided_note', t.decided_note
  ) order by t.verified_at desc), '[]'::jsonb)
  from public.takedown_requests t
  where t.creator_id = public.my_creator_id() and t.verified_at is not null;
$$;

create or replace function public.respond_takedown(p_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_text is null or char_length(btrim(p_text)) < 5 or char_length(p_text) > 4000 then
    raise exception '5文字以上4000文字以内で書いてください';
  end if;
  update public.takedown_requests
     set creator_response = btrim(p_text), responded_at = now()
   where id = p_id and creator_id = public.my_creator_id() and status = 'open' and verified_at is not null;
  if not found then
    raise exception 'この申し立てには書き込めません';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 運営：申し立ての一覧（押した人の記録・その人のこれまでの申し立ても見える）
-- ---------------------------------------------------------------------
create or replace function public.admin_takedown_queue()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'portfolio_id', t.portfolio_id, 'work_title', t.work_title,
      'creator_name', c.display_name, 'video_url', p.video_url,
      'requester_name', t.requester_name, 'requester_org', t.requester_org, 'requester_email', t.requester_email,
      'requester_user_id', t.requester_user_id,
      'requester_account', case when t.requester_user_id is not null then
          (select concat_ws(' ', nullif(au.raw_user_meta_data ->> 'full_name', ''), '登録 ' || to_char(au.created_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD'))
             from auth.users au where au.id = t.requester_user_id) end,
      'ip_tag', left(t.ip_hash, 8), 'user_agent', t.user_agent,
      'relation', t.relation, 'reason', t.reason, 'detail', t.detail, 'status', t.status,
      'verified_at', t.verified_at, 'confirm_expires_at', t.confirm_expires_at,
      'due_on', ((t.verified_at + interval '7 days') at time zone 'Asia/Tokyo')::date,
      'creator_response', t.creator_response, 'responded_at', t.responded_at,
      'created_at', t.created_at, 'decided_at', t.decided_at, 'decided_note', t.decided_note, 'abusive', t.abusive,
      'history', (select jsonb_build_object(
          'total', count(*), 'rejected', count(*) filter (where h.status = 'rejected'),
          'abusive', count(*) filter (where h.abusive), 'unconfirmed', count(*) filter (where h.verified_at is null))
        from public.takedown_requests h
        where h.id <> t.id and (lower(h.requester_email) = lower(t.requester_email)
           or (t.requester_user_id is not null and h.requester_user_id = t.requester_user_id)
           or (t.ip_hash is not null and h.ip_hash = t.ip_hash))),
      'blocked', public.takedown_requester_blocked(t.requester_email, t.requester_user_id)
    ) order by (t.status = 'open' and t.verified_at is not null) desc, t.created_at desc), '[]'::jsonb)
    from public.takedown_requests t
    left join public.creators c on c.id = t.creator_id
    left join public.portfolios p on p.id = t.portfolio_id
    where t.created_at > now() - interval '1 year'
      and (t.verified_at is not null or t.created_at > now() - interval '3 days')
  );
end;
$$;

-- 運営：判断する（理由は必須。「いたずら」の印は認めなかったときだけ付けられる）
create or replace function public.admin_decide_takedown_v2(p_id uuid, p_uphold boolean, p_note text, p_abusive boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare t record;
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then
    raise exception '判断の理由を5文字以上で書いてください（申し立てた人と作品を載せた人の両方に伝えます）';
  end if;
  if coalesce(p_abusive, false) and p_uphold then
    raise exception '認めた申し立てに「いたずら」の印は付けられません';
  end if;
  select * into t from public.takedown_requests where id = p_id for update;
  if t.id is null then raise exception 'この申し立ては見つかりません'; end if;
  if t.verified_at is null then raise exception 'メールの確認が済んでいない申し立ては判断できません'; end if;
  if t.status <> 'open' then raise exception 'この申し立ては判断済みです'; end if;
  update public.takedown_requests
     set status = case when p_uphold then 'upheld' else 'rejected' end,
         decided_at = now(), decided_note = btrim(p_note), decided_by = auth.uid(),
         abusive = coalesce(p_abusive, false)
   where id = p_id;
  if not p_uphold and t.portfolio_id is not null and not exists (
       select 1 from public.takedown_requests
        where portfolio_id = t.portfolio_id and verified_at is not null and status in ('open','upheld')) then
    update public.portfolios set takedown_hold = false where id = t.portfolio_id;
  end if;
end;
$$;

-- 運営：この人からの申し立ての受付を止める／止めるのをやめる
create or replace function public.admin_block_takedown_requester(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare t record;
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  select * into t from public.takedown_requests where id = p_request_id;
  if t.id is null then raise exception 'この申し立ては見つかりません'; end if;
  if public.takedown_requester_blocked(t.requester_email, t.requester_user_id) then return; end if;
  insert into public.takedown_requester_blocks (kind, fingerprint, request_id, reason, created_by)
    values ('email', public.identity_fingerprint('email', t.requester_email), t.id, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
  if t.requester_user_id is not null then
    insert into public.takedown_requester_blocks (kind, fingerprint, request_id, reason, created_by)
      values ('user', public.identity_fingerprint('user', t.requester_user_id::text), t.id, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
  end if;
end;
$$;

create or replace function public.admin_unblock_takedown_requester(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare t record;
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  select * into t from public.takedown_requests where id = p_request_id;
  if t.id is null then raise exception 'この申し立ては見つかりません'; end if;
  update public.takedown_requester_blocks set lifted_at = now(), lifted_by = auth.uid()
   where lifted_at is null
     and ((kind = 'email' and fingerprint = public.identity_fingerprint('email', t.requester_email))
       or (kind = 'user' and t.requester_user_id is not null and fingerprint = public.identity_fingerprint('user', t.requester_user_id::text)));
end;
$$;

-- 呼べる人（submit / confirm はログインなしでも呼べる。中で確かめている）
grant execute on function public.submit_takedown(uuid, text, text, text, text, text, text, boolean) to anon, authenticated, service_role;
grant execute on function public.confirm_takedown(uuid) to anon, authenticated, service_role;
grant execute on function public.admin_decide_takedown_v2(uuid, boolean, text, boolean) to authenticated, service_role;
grant execute on function public.admin_block_takedown_requester(uuid, text) to authenticated, service_role;
grant execute on function public.admin_unblock_takedown_requester(uuid) to authenticated, service_role;

-- 片付け（自動で止まる場合はタキさんに貼ってもらう。貼らなくても、中で運営かどうかを確かめているので安全）
revoke execute on function public.takedown_requester_blocked(text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_decide_takedown_v2(uuid, boolean, text, boolean) from public, anon;
revoke execute on function public.admin_block_takedown_requester(uuid, text) from public, anon;
revoke execute on function public.admin_unblock_takedown_requester(uuid) from public, anon;
