-- =====================================================================
--  080: 進行中の案件の「途中キャンセル」（2026-11-25 翠くん）
--  ・始まった（進行中の）案件は、片方だけでは取り消せない。「途中キャンセルの申請」→ 相手が同意 で成立する
--  ・相手が3日たっても返事をしないときは、申請した側が「返事がないまま取り消す」ことができる
--      （連絡が取れない相手だと、永遠に取り消せなくなるため）
--  ・申請には理由を選ぶ。「相手の対応」を理由にした申請は、相手が「理由には同意しません」と付けて同意できる
--      → 同意しない印の付いたものは、公開の数には入らない（言いがかりで数が積み上がらないように）
--  ・数（開始した案件・途中キャンセル・相手の対応が理由の申請）は、クリエイター／依頼した会社のページに出す。個別の案件は出さない
--  ・始まる前（依頼中・返事待ち）の取り消しは、これまでどおり片方だけでできる（まだ仕事が始まっていないので）
-- =====================================================================
create table if not exists public.project_cancel_requests (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  requested_by   uuid not null references auth.users(id),
  requester_role text not null check (requester_role in ('client','creator')),
  reason_code    text not null check (reason_code in
                   ('no_contact','no_progress','late','quality','behavior','own_change','own_budget','own_other','mutual')),
  reason_note    text check (reason_note is null or char_length(reason_note) <= 500),
  status         text not null default 'open' check (status in ('open','agreed','declined','withdrawn','no_reply')),
  responded_by   uuid references auth.users(id),
  respond_note   text check (respond_note is null or char_length(respond_note) <= 500),
  reason_disputed boolean not null default false,
  created_at     timestamptz not null default now(),
  responded_at   timestamptz
);
create unique index if not exists project_cancel_open_one on public.project_cancel_requests(project_id) where status = 'open';
create index if not exists project_cancel_by_project on public.project_cancel_requests(project_id, created_at desc);
alter table public.project_cancel_requests enable row level security;
alter table public.project_cancel_requests force row level security;
drop policy if exists project_cancel_select on public.project_cancel_requests;
create policy project_cancel_select on public.project_cancel_requests for select to authenticated
  using (public.is_project_party(project_id) or public.is_admin());
revoke all on public.project_cancel_requests from anon, authenticated;
grant select on public.project_cancel_requests to authenticated;

-- 状態の変え方の決まり：進行中 → キャンセル は、下の関数（申請と同意）を通ったときだけ
create or replace function public.enforce_project_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  ok boolean := false;
begin
  if old.status <> 'draft' and (
       new.title is distinct from old.title or new.description is distinct from old.description
    or new.kind is distinct from old.kind or new.budget_amount is distinct from old.budget_amount
    or new.due_on is distinct from old.due_on or new.reference_url is distinct from old.reference_url) then
    raise exception '依頼を送ったあとは、依頼の中身は変えられません。変えたいことはメッセージで伝えてください';
  end if;
  if old.status in ('in_progress','delivered','paid','closed') and (
       new.terms_amount is distinct from old.terms_amount or new.terms_due_on is distinct from old.terms_due_on
    or new.terms_note is distinct from old.terms_note) then
    raise exception '始めたあとは、条件は変えられません';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  role_name := public.project_my_role(new.id);
  if role_name is null then
    raise exception 'この案件の状態を変える権限がありません';
  end if;

  if    old.status = 'draft'       and new.status = 'offered'     and role_name = 'client'  then ok := true;
  elsif old.status = 'offered'     and new.status = 'proposed'    and role_name = 'creator' then ok := true;
  elsif old.status in ('offered','proposed') and new.status = 'declined' and role_name = 'creator' then ok := true;
  elsif old.status = 'proposed'    and new.status = 'in_progress' and role_name = 'client'  then ok := true;
  elsif old.status = 'in_progress' and new.status = 'delivered'   and role_name = 'creator' then ok := true;
  elsif old.status = 'delivered'   and new.status = 'paid'        and role_name = 'client'  then ok := true;
  elsif old.status = 'paid'        and new.status = 'closed'                                then ok := true;
  elsif old.status in ('draft','offered','proposed') and new.status = 'cancelled' then ok := true;
  elsif old.status = 'in_progress' and new.status = 'cancelled' then
    if coalesce(current_setting('em.cancel_ok', true), '') = '1' then ok := true;
    else
      raise exception '進行中の案件は、片方だけでは取り消せません。「途中キャンセルを申請する」から、相手の同意を得てください';
    end if;
  end if;

  if not ok then
    raise exception '「%」から「%」への変更はできません（あなたの立場: %）', old.status, new.status, role_name;
  end if;
  return new;
end;
$$;

-- ---- 申請する ----
create or replace function public.project_cancel_request(p_project uuid, p_reason text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects; r text; rid uuid; other uuid; lbl text; me text;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  r := public.project_my_role(p_project);
  if r is null then raise exception 'この案件の当事者ではありません'; end if;
  if p.status <> 'in_progress' then
    raise exception '途中キャンセルを申請できるのは、進行中の案件だけです（いまの状態: %）', p.status;
  end if;
  if p_reason not in ('no_contact','no_progress','late','quality','behavior','own_change','own_budget','own_other','mutual') then
    raise exception '理由を選んでください';
  end if;
  if p_reason in ('behavior','own_other') and coalesce(btrim(p_note), '') = '' then
    raise exception 'この理由のときは、くわしい内容をひとこと書いてください';
  end if;
  if exists (select 1 from public.project_cancel_requests where project_id = p_project and status = 'open') then
    raise exception 'すでに申請中です。相手の返事を待つか、申請を取り下げてください';
  end if;
  insert into public.project_cancel_requests (project_id, requested_by, requester_role, reason_code, reason_note)
  values (p_project, auth.uid(), r, p_reason, nullif(btrim(p_note), '')) returning id into rid;

  lbl := public.cancel_reason_label(p_reason);
  insert into public.project_messages (project_id, sender_id, body)
  values (p_project, auth.uid(), '【途中キャンセルの申請】この案件を途中でやめたいです。' || chr(10) || '理由：' || lbl
    || coalesce(chr(10) || nullif(btrim(p_note), ''), '') || chr(10) || chr(10)
    || '相手の方は、案件のページから「同意する」か「同意しない」を選んでください。');
  if r = 'client' then select user_id into other from public.creators where id = p.creator_id;
  else select user_id into other from public.clients where id = p.client_id; end if;
  perform public.notify_push(other, 'project_cancel_request', '【Eizo Maps】途中キャンセルの申請が届きました',
    '案件「' || p.title || '」で、途中キャンセルの申請が届きました。' || chr(10) || '理由：' || lbl || chr(10) || chr(10)
    || '案件のページで、同意するかどうかを選んでください。', '/projects/?id=' || p.id);
  return rid;
end $$;

create or replace function public.cancel_reason_label(c text) returns text
language sql immutable set search_path = '' as $$
  select case c
    when 'no_contact'  then '連絡が返ってこない'
    when 'no_progress' then '進み具合が分からない'
    when 'late'        then '納期に間に合わない・守られない'
    when 'quality'     then '内容が、決めた水準に届かない'
    when 'behavior'    then '進め方・対応に問題がある'
    when 'own_change'  then '依頼の内容が変わった・仕事が無くなった（自分の都合）'
    when 'own_budget'  then '予算・スケジュールの事情（自分の都合）'
    when 'own_other'   then 'そのほかの自分の都合'
    when 'mutual'      then '話し合って、お互いの都合で'
    else c end;
$$;

-- ---- 相手が返事をする（同意する／同意しない）----
create or replace function public.project_cancel_respond(p_request uuid, p_action text, p_note text default null, p_dispute boolean default false)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  q public.project_cancel_requests; p public.projects; me text; note text;
begin
  select * into q from public.project_cancel_requests where id = p_request for update;
  if not found then raise exception 'この申請は見つかりません'; end if;
  select * into p from public.projects where id = q.project_id for update;
  me := public.project_my_role(q.project_id);
  if me is null or me = q.requester_role then raise exception '返事をするのは、申請を受けた相手の方だけです'; end if;
  if q.status <> 'open' then raise exception 'この申請は、もう終わっています'; end if;
  if p.status <> 'in_progress' then raise exception 'この案件は、もう進行中ではありません'; end if;
  note := nullif(btrim(p_note), '');
  if p_action = 'agree' then
    update public.project_cancel_requests
       set status = 'agreed', responded_by = auth.uid(), respond_note = note, responded_at = now(),
           reason_disputed = coalesce(p_dispute, false) and q.reason_code in ('no_contact','no_progress','late','quality','behavior')
     where id = q.id;
    perform set_config('em.cancel_ok', '1', true);
    update public.projects set status = 'cancelled' where id = q.project_id;
    insert into public.project_messages (project_id, sender_id, body)
    values (q.project_id, auth.uid(), '【途中キャンセル】同意しました。この案件はキャンセルになりました。'
      || case when coalesce(p_dispute, false) and q.reason_code in ('no_contact','no_progress','late','quality','behavior')
              then chr(10) || '※申請の理由には同意していません。' else '' end
      || coalesce(chr(10) || note, ''));
    return 'cancelled';
  elsif p_action = 'decline' then
    update public.project_cancel_requests
       set status = 'declined', responded_by = auth.uid(), respond_note = note, responded_at = now()
     where id = q.id;
    insert into public.project_messages (project_id, sender_id, body)
    values (q.project_id, auth.uid(), '【途中キャンセル】同意しません。案件は続きます。' || coalesce(chr(10) || note, '')
      || chr(10) || chr(10) || '話し合っても決まらないときは、「この案件で問題を報告」から運営に相談できます。');
    perform public.notify_push((select requested_by from public.project_cancel_requests where id = q.id),
      'project_cancel_declined', '【Eizo Maps】途中キャンセルの申請に、同意がありませんでした',
      '案件「' || p.title || '」の申請に、相手が同意しませんでした。案件は続きます。', '/projects/?id=' || p.id);
    return 'declined';
  end if;
  raise exception '「同意する」か「同意しない」を選んでください';
end $$;

-- ---- 申請を取り下げる ----
create or replace function public.project_cancel_withdraw(p_request uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare q public.project_cancel_requests;
begin
  select * into q from public.project_cancel_requests where id = p_request for update;
  if not found then raise exception 'この申請は見つかりません'; end if;
  if q.requested_by is distinct from auth.uid() then raise exception '取り下げられるのは、申請した本人だけです'; end if;
  if q.status <> 'open' then raise exception 'この申請は、もう終わっています'; end if;
  update public.project_cancel_requests set status = 'withdrawn', responded_at = now() where id = q.id;
  insert into public.project_messages (project_id, sender_id, body)
  values (q.project_id, auth.uid(), '【途中キャンセル】申請を取り下げました。案件は続きます。');
  return 'withdrawn';
end $$;

-- ---- 3日たっても返事がないとき、申請した側が取り消す ----
create or replace function public.project_cancel_force(p_request uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare q public.project_cancel_requests; p public.projects;
begin
  select * into q from public.project_cancel_requests where id = p_request for update;
  if not found then raise exception 'この申請は見つかりません'; end if;
  if q.requested_by is distinct from auth.uid() then raise exception '取り消せるのは、申請した本人だけです'; end if;
  if q.status <> 'open' then raise exception 'この申請は、もう終わっています'; end if;
  if q.created_at > now() - interval '3 days' then
    raise exception '申請から3日たつと、相手の返事がなくても取り消せます（あと%時間）', ceil(extract(epoch from (q.created_at + interval '3 days' - now())) / 3600)::int;
  end if;
  select * into p from public.projects where id = q.project_id for update;
  if p.status <> 'in_progress' then raise exception 'この案件は、もう進行中ではありません'; end if;
  update public.project_cancel_requests set status = 'no_reply', responded_at = now() where id = q.id;
  perform set_config('em.cancel_ok', '1', true);
  update public.projects set status = 'cancelled' where id = q.project_id;
  insert into public.project_messages (project_id, sender_id, body)
  values (q.project_id, auth.uid(), '【途中キャンセル】申請から3日たっても返事がなかったため、取り消しました。');
  return 'cancelled';
end $$;

-- ---- 公開する数（個別の案件は出さない）----
--  started   … 仕事が始まった案件の数
--  cancelled … そのうち、途中でキャンセルになった数
--  against   … 「相手の対応」を理由に、相手から申請されてキャンセルになった数（「理由には同意しません」が付いたものは入れない）
--  reasons   … その理由の内訳
create or replace function public.creator_cancel_stats(p_creator_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  with ps as (select id, status from public.projects where creator_id = p_creator_id and started_at is not null),
  c as (select r.* from public.project_cancel_requests r join ps on ps.id = r.project_id
         where r.status in ('agreed','no_reply') and r.requester_role = 'client'
           and r.reason_code in ('no_contact','no_progress','late','quality','behavior') and not r.reason_disputed)
  select json_build_object(
    'started',   (select count(*) from ps),
    'cancelled', (select count(*) from ps where status = 'cancelled'),
    'against',   (select count(*) from c),
    'reasons',   coalesce((select json_object_agg(reason_code, n) from (select reason_code, count(*) n from c group by 1) t), '{}'::json));
$$;
create or replace function public.client_cancel_stats(p_client_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  with ps as (select id, status from public.projects where client_id = p_client_id and started_at is not null),
  c as (select r.* from public.project_cancel_requests r join ps on ps.id = r.project_id
         where r.status in ('agreed','no_reply') and r.requester_role = 'creator'
           and r.reason_code in ('no_contact','no_progress','late','quality','behavior') and not r.reason_disputed)
  select json_build_object(
    'started',   (select count(*) from ps),
    'cancelled', (select count(*) from ps where status = 'cancelled'),
    'against',   (select count(*) from c),
    'reasons',   coalesce((select json_object_agg(reason_code, n) from (select reason_code, count(*) n from c group by 1) t), '{}'::json));
$$;
-- 一覧用：途中キャンセルのあるクリエイターだけ
create or replace function public.creator_cancel_counts()
returns table(creator_id uuid, cancelled integer, against integer)
language sql stable security definer set search_path = '' as $$
  select p.creator_id,
         count(*) filter (where p.status = 'cancelled')::int,
         (select count(*)::int from public.project_cancel_requests r join public.projects q on q.id = r.project_id
           where q.creator_id = p.creator_id and r.status in ('agreed','no_reply') and r.requester_role = 'client'
             and r.reason_code in ('no_contact','no_progress','late','quality','behavior') and not r.reason_disputed)
    from public.projects p where p.started_at is not null
   group by p.creator_id having count(*) filter (where p.status = 'cancelled') > 0;
$$;

grant execute on function public.project_cancel_request(uuid, text, text)           to authenticated;
grant execute on function public.project_cancel_respond(uuid, text, text, boolean)  to authenticated;
grant execute on function public.project_cancel_withdraw(uuid)                      to authenticated;
grant execute on function public.project_cancel_force(uuid)                         to authenticated;
grant execute on function public.creator_cancel_stats(uuid)                         to anon, authenticated;
grant execute on function public.client_cancel_stats(uuid)                          to anon, authenticated;
grant execute on function public.creator_cancel_counts()                            to anon, authenticated;
revoke all on function public.cancel_reason_label(text) from public, anon, authenticated;
