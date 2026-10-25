-- =====================================================================
-- 026 作品の「載せる許可の確認」「解禁日」「削除の申し立て」（2026-10-25）
--   ・作品を載せるとき、載せる許可を確認したことと、その日時を残す（rights_confirmed_at）
--   ・解禁日（release_on）までは、本人と運営以外のどこにも出さない
--       プロフィール・検索・限定リンク・パスワード付きのストックページ、すべて
--   ・権利者などから削除の申し立てが来たら、すぐ一時非公開（takedown_hold）にする
--       一時非公開を解けるのは運営だけ。作った本人は言い分を書ける
--   決めた人：タキさん（10/25「すぐ一時非公開にする」「どこにも出さない」）
--   ※ 「消す」系の命令は使わない
-- =====================================================================

alter table public.portfolios add column if not exists rights_confirmed_at timestamptz;
alter table public.portfolios add column if not exists release_on date;
alter table public.portfolios add column if not exists takedown_hold boolean not null default false;

-- 今、本人以外に見せてよい状態か（解禁日を過ぎていて、申し立てで止まっていない）
create or replace function public.portfolio_released(p_release_on date, p_hold boolean)
returns boolean
language sql
stable
set search_path to ''
as $$
  select (p_release_on is null or p_release_on <= (now() at time zone 'Asia/Tokyo')::date) and not coalesce(p_hold, false);
$$;
grant execute on function public.portfolio_released(date, boolean) to anon, authenticated, service_role;

-- 許可の確認の日時は、サーバーの時計で入れる（あとから書き換えられないように）
-- 一時非公開（takedown_hold）は、運営か申し立ての仕組みしか変えられない
create or replace function public.portfolios_rights_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.rights_confirmed_at is not null then new.rights_confirmed_at := now(); end if;
    if not public.is_admin() then new.takedown_hold := false; end if;
  else
    if new.rights_confirmed_at is distinct from old.rights_confirmed_at then
      new.rights_confirmed_at := case when new.rights_confirmed_at is null then old.rights_confirmed_at else now() end;
    end if;
    if new.takedown_hold is distinct from old.takedown_hold
       and not public.is_admin()
       and coalesce(current_setting('eizo.takedown', true), '') <> 'on' then
      raise exception 'この作品は申し立てにより一時非公開です。解除は運営の確認後になります';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.portfolios_rights_guard() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_portfolios_rights_guard') then
    create trigger trg_portfolios_rights_guard before insert or update on public.portfolios
      for each row execute function public.portfolios_rights_guard();
  end if;
end $$;

-- 見せてよいかの決まりに、解禁日と一時非公開を足す
alter policy portfolios_select on public.portfolios
  using (((visibility = 'public') and public.creator_is_published(creator_id) and public.portfolio_released(release_on, takedown_hold))
         or public.owns_creator(creator_id) or public.is_admin());

create or replace function public.portfolio_is_public(p_portfolio_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.portfolios p
    join public.creators c on c.id = p.creator_id
    where p.id = p_portfolio_id and p.visibility = 'public' and c.is_published
      and public.portfolio_released(p.release_on, p.takedown_hold)
  );
$$;

-- 限定リンク・ストックページにも同じ決まりを入れる
do $$
declare d text;
begin
  d := pg_get_functiondef('public.get_share_link(text)'::regprocedure);
  if position('portfolio_released' in d) = 0 then
    d := replace(d, $q$and p.visibility in ('public', 'link_only')$q$,
                    $q$and p.visibility in ('public', 'link_only') and public.portfolio_released(p.release_on, p.takedown_hold)$q$);
    execute d;
  end if;
  d := pg_get_functiondef('public.open_stock_page(text,text)'::regprocedure);
  if position('portfolio_released' in d) = 0 then
    d := replace(d, $q$and (i.portfolio_id is null or p.id is not null)$q$,
                    $q$and (i.portfolio_id is null or (p.id is not null and public.portfolio_released(p.release_on, p.takedown_hold)))$q$);
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 削除の申し立て
-- ---------------------------------------------------------------------
create table if not exists public.takedown_requests (
  id               uuid primary key default gen_random_uuid(),
  portfolio_id     uuid references public.portfolios(id) on delete set null,
  creator_id       uuid references public.creators(id) on delete set null,
  work_title       text check (work_title is null or char_length(work_title) <= 200),
  requester_name   text not null check (char_length(requester_name) between 1 and 100),
  requester_org    text check (requester_org is null or char_length(requester_org) <= 100),
  requester_email  text not null check (char_length(requester_email) between 3 and 200),
  relation         text not null check (relation in ('client','agency','production','performer','creator','other')),
  reason           text not null check (reason in ('confidential','copyright','portrait','impersonation','other')),
  detail           text not null check (char_length(detail) between 10 and 4000),
  status           text not null default 'open' check (status in ('open','upheld','rejected')),
  creator_response text check (creator_response is null or char_length(creator_response) <= 4000),
  responded_at     timestamptz,
  decided_at       timestamptz,
  decided_note     text check (decided_note is null or char_length(decided_note) <= 2000),
  ip_hash          text,
  created_at       timestamptz not null default now()
);
alter table public.takedown_requests enable row level security;
alter table public.takedown_requests force row level security;
revoke all on public.takedown_requests from anon, authenticated;
grant select, insert, update on public.takedown_requests to service_role;
create index if not exists idx_takedown_portfolio on public.takedown_requests (portfolio_id);
create index if not exists idx_takedown_ip on public.takedown_requests (ip_hash, created_at);

-- 申し立てを受け付ける（ログインなしでも使える。1つの場所から1日5件まで）
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
  n int;
begin
  if not coalesce(p_agree, false) then
    raise exception '内容が事実であることへの同意が必要です';
  end if;
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'メールアドレスの形が正しくありません';
  end if;
  begin
    raw_ip := split_part(coalesce(
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip',
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
      'unknown'), ',', 1);
  exception when others then raw_ip := 'unknown';
  end;
  iph := encode(extensions.digest(coalesce(btrim(raw_ip), 'unknown'), 'sha256'), 'hex');
  select count(*) into n from public.takedown_requests where ip_hash = iph and created_at > now() - interval '1 day';
  if n >= 5 then
    raise exception '申し立ての回数が多いため、しばらく受け付けられません。お急ぎの場合は info@eizo-maps.com へご連絡ください';
  end if;

  select p.id, p.creator_id, p.title into pf from public.portfolios p where p.id = p_portfolio_id;
  if pf.id is null then
    raise exception '作品が見つかりません';
  end if;

  insert into public.takedown_requests
    (portfolio_id, creator_id, work_title, requester_name, requester_org, requester_email, relation, reason, detail, ip_hash)
  values
    (pf.id, pf.creator_id, pf.title, btrim(p_name), nullif(btrim(coalesce(p_org, '')), ''), btrim(p_email),
     p_relation, p_reason, btrim(p_detail), iph);

  perform set_config('eizo.takedown', 'on', true);
  update public.portfolios set takedown_hold = true where id = pf.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.submit_takedown(uuid, text, text, text, text, text, text, boolean) from public;
grant execute on function public.submit_takedown(uuid, text, text, text, text, text, text, boolean) to anon, authenticated, service_role;

-- 作った本人が、自分の作品への申し立てを見る（申立人のメールアドレスは見せない）
create or replace function public.my_takedown_requests()
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'portfolio_id', t.portfolio_id, 'work_title', t.work_title,
    'requester_org', t.requester_org, 'relation', t.relation, 'reason', t.reason, 'detail', t.detail,
    'status', t.status, 'creator_response', t.creator_response, 'created_at', t.created_at, 'decided_note', t.decided_note
  ) order by t.created_at desc), '[]'::jsonb)
  from public.takedown_requests t
  where t.creator_id = public.my_creator_id();
$$;
revoke execute on function public.my_takedown_requests() from public, anon;
grant execute on function public.my_takedown_requests() to authenticated, service_role;

-- 作った本人が言い分を書く
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
   where id = p_id and creator_id = public.my_creator_id() and status = 'open';
  if not found then
    raise exception 'この申し立てには書き込めません';
  end if;
end;
$$;
revoke execute on function public.respond_takedown(uuid, text) from public, anon;
grant execute on function public.respond_takedown(uuid, text) to authenticated, service_role;

-- 運営：申し立ての一覧
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
      'relation', t.relation, 'reason', t.reason, 'detail', t.detail, 'status', t.status,
      'creator_response', t.creator_response, 'responded_at', t.responded_at,
      'created_at', t.created_at, 'decided_at', t.decided_at, 'decided_note', t.decided_note
    ) order by (t.status = 'open') desc, t.created_at desc), '[]'::jsonb)
    from public.takedown_requests t
    left join public.creators c on c.id = t.creator_id
    left join public.portfolios p on p.id = t.portfolio_id
    where t.created_at > now() - interval '1 year'
  );
end;
$$;
revoke execute on function public.admin_takedown_queue() from public, anon;
grant execute on function public.admin_takedown_queue() to authenticated, service_role;

-- 運営：判断する（認める＝非公開のまま／認めない＝公開に戻す）
create or replace function public.admin_decide_takedown(p_id uuid, p_uphold boolean, p_note text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare pid uuid;
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  update public.takedown_requests
     set status = case when p_uphold then 'upheld' else 'rejected' end,
         decided_at = now(), decided_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id
   returning portfolio_id into pid;
  if pid is null then return; end if;
  -- 認めなかったときは、ほかに未判断の申し立てがなければ公開に戻す
  if not p_uphold and not exists (
       select 1 from public.takedown_requests where portfolio_id = pid and status in ('open','upheld')) then
    update public.portfolios set takedown_hold = false where id = pid;
  end if;
end;
$$;
revoke execute on function public.admin_decide_takedown(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_takedown(uuid, boolean, text) to authenticated, service_role;
