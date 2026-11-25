-- =====================================================================
--  082: 途中キャンセルの穴をふさぐ（2026-11-25 翠くん「本当にそれで大丈夫？」）
--  ① 「理由には同意しません」を付けても、数からは消えない。「うち○件は本人が同意していません」と並べて出す
--      （付ければ記録を避けられる、という抜け道をなくす。言い分は見える形で残す）
--  ② 3日返事がなくて取り消されたあとでも、14日以内なら「理由には同意しません」を付けられる
--  ③ 申請から2日たっても返事がないとき、相手に念押しのお知らせを送る
--  ④ 同意されなかった申請は、運営が中身を見て取り消せる（相手が「同意しない」を押し続けて終われない、をなくす）
--  ⑤ 申請のときに、ここまでの作業分のお金をどうしたいかを選ぶ（記録に残すだけ。決めるのは当事者）
-- =====================================================================
alter table public.project_cancel_requests
  add column if not exists settle      text check (settle is null or settle in ('pay_done','no_pay','talk')),
  add column if not exists reminded_at timestamptz,
  add column if not exists disputed_at timestamptz,
  add column if not exists admin_note  text check (admin_note is null or char_length(admin_note) <= 500);
alter table public.project_cancel_requests drop constraint if exists project_cancel_requests_status_check;
alter table public.project_cancel_requests add constraint project_cancel_requests_status_check
  check (status in ('open','agreed','declined','withdrawn','no_reply','admin'));

-- 運営が取り消すときは、当事者でなくても「進行中 → キャンセル」を通す（下の関数からだけ）
do $$
declare d text;
begin
  d := pg_get_functiondef('public.enforce_project_status_transition()'::regprocedure);
  d := replace(d, $a$  if role_name is null then$a$,
    $b$  if role_name is null and not (coalesce(current_setting('em.cancel_ok', true), '') = '1'
       and old.status = 'in_progress' and new.status = 'cancelled') then$b$);
  execute d;
end $$;

create or replace function public.cancel_settle_label(c text) returns text
language sql immutable set search_path = '' as $$
  select case c when 'pay_done' then 'ここまでの作業分は、支払う（受け取る）形にしたい'
                when 'no_pay'   then 'お金のやり取りは、なしにしたい'
                else '話し合って決めたい' end;
$$;
revoke all on function public.cancel_settle_label(text) from public, anon, authenticated;

-- ---- 申請する（お金の希望つき）----
drop function if exists public.project_cancel_request(uuid, text, text);
create or replace function public.project_cancel_request(p_project uuid, p_reason text, p_note text default null, p_settle text default 'talk')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p public.projects; r text; rid uuid; other uuid; lbl text;
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
  if p_settle is null or p_settle not in ('pay_done','no_pay','talk') then
    raise exception 'ここまでの作業分のお金をどうしたいかを選んでください';
  end if;
  if p_reason in ('behavior','own_other') and coalesce(btrim(p_note), '') = '' then
    raise exception 'この理由のときは、くわしい内容をひとこと書いてください';
  end if;
  if exists (select 1 from public.project_cancel_requests where project_id = p_project and status = 'open') then
    raise exception 'すでに申請中です。相手の返事を待つか、申請を取り下げてください';
  end if;
  if exists (select 1 from public.project_cancel_requests where project_id = p_project and requested_by = auth.uid()
               and status = 'declined' and responded_at > now() - interval '24 hours') then
    raise exception '同意されなかった申請のあと、24時間は次の申請ができません。まずメッセージで話し合ってください';
  end if;
  insert into public.project_cancel_requests (project_id, requested_by, requester_role, reason_code, reason_note, settle)
  values (p_project, auth.uid(), r, p_reason, nullif(btrim(p_note), ''), p_settle) returning id into rid;

  lbl := public.cancel_reason_label(p_reason);
  insert into public.project_messages (project_id, sender_id, body)
  values (p_project, auth.uid(), '【途中キャンセルの申請】この案件を途中でやめたいです。' || chr(10) || '理由：' || lbl
    || coalesce(chr(10) || nullif(btrim(p_note), ''), '') || chr(10)
    || 'ここまでの作業分のお金：' || public.cancel_settle_label(p_settle) || chr(10) || chr(10)
    || '相手の方は、案件のページから「同意する」か「同意しない」を選んでください。');
  if r = 'client' then select user_id into other from public.creators where id = p.creator_id;
  else select user_id into other from public.clients where id = p.client_id; end if;
  perform public.notify_push(other, 'project_cancel_request', '【Eizo Maps】途中キャンセルの申請が届きました',
    '案件「' || p.title || '」で、途中キャンセルの申請が届きました。' || chr(10) || '理由：' || lbl || chr(10) || chr(10)
    || '案件のページで、同意するかどうかを選んでください。3日たっても返事がないと、相手の方が取り消せるようになります。', '/projects/?id=' || p.id);
  return rid;
end $$;
grant execute on function public.project_cancel_request(uuid, text, text, text) to authenticated;

-- ---- ② 返事がなくて取り消されたあと、14日以内なら理由に同意しないと付けられる ----
create or replace function public.project_cancel_dispute(p_request uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare q public.project_cancel_requests; me text;
begin
  select * into q from public.project_cancel_requests where id = p_request for update;
  if not found then raise exception 'この申請は見つかりません'; end if;
  me := public.project_my_role(q.project_id);
  if me is null or me = q.requester_role then raise exception '付けられるのは、申請を受けた側の方だけです'; end if;
  if q.status <> 'no_reply' then raise exception 'これは、返事がないまま取り消された申請にだけ付けられます'; end if;
  if q.reason_code not in ('no_contact','no_progress','late','quality','behavior') then raise exception 'この申請は、あなたの対応を理由にしたものではありません'; end if;
  if q.reason_disputed then raise exception 'すでに付いています'; end if;
  if q.responded_at < now() - interval '14 days' then raise exception '取り消されてから14日をすぎたので、付けられません。「問題を報告」から運営に相談してください'; end if;
  update public.project_cancel_requests
     set reason_disputed = true, disputed_at = now(), respond_note = nullif(btrim(p_note), '') where id = q.id;
  insert into public.project_messages (project_id, sender_id, body)
  values (q.project_id, auth.uid(), '【途中キャンセル】申請の理由には同意していません。' || coalesce(chr(10) || nullif(btrim(p_note), ''), ''));
  return 'disputed';
end $$;
grant execute on function public.project_cancel_dispute(uuid, text) to authenticated;

-- ---- ① 数の出し方：同意していないものも数に入れ、その件数を並べて出す ----
create or replace function public.cancel_stats_for(p_role text, p_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  with ps as (select id, status from public.projects
               where started_at is not null and ((p_role = 'creator' and creator_id = p_id) or (p_role = 'client' and client_id = p_id))),
  done as (select r.* from public.project_cancel_requests r join ps on ps.id = r.project_id where r.status in ('agreed','no_reply','admin')),
  c as (select * from done where requester_role <> p_role and reason_code in ('no_contact','no_progress','late','quality','behavior'))
  select json_build_object(
    'started',   (select count(*) from ps),
    'cancelled', (select count(*) from ps where status = 'cancelled'),
    'against',   (select count(*) from c),
    'disputed',  (select count(*) from c where reason_disputed),
    'no_reply',  (select count(*) from c where status = 'no_reply'),
    'own',       (select count(*) from done where requester_role = p_role and reason_code in ('own_change','own_budget','own_other')),
    'reasons',   coalesce((select json_object_agg(reason_code, n) from (select reason_code, count(*) n from c group by 1) t), '{}'::json));
$$;
create or replace function public.creator_cancel_counts()
returns table(creator_id uuid, cancelled integer, against integer)
language sql stable security definer set search_path = '' as $$
  select p.creator_id,
         count(*) filter (where p.status = 'cancelled')::int,
         (select count(*)::int from public.project_cancel_requests r join public.projects q on q.id = r.project_id
           where q.creator_id = p.creator_id and r.status in ('agreed','no_reply','admin') and r.requester_role = 'client'
             and r.reason_code in ('no_contact','no_progress','late','quality','behavior'))
    from public.projects p where p.started_at is not null
   group by p.creator_id having count(*) filter (where p.status = 'cancelled') > 0;
$$;

-- ---- ③ 2日たっても返事がないとき、念押し（1時間ごとの予約実行）----
create or replace function public.project_cancel_remind()
returns integer language plpgsql security definer set search_path = '' as $$
declare q record; other uuid; n integer := 0;
begin
  for q in select r.id, r.requester_role, r.created_at, p.id pid, p.title, p.client_id, p.creator_id
             from public.project_cancel_requests r join public.projects p on p.id = r.project_id
            where r.status = 'open' and r.reminded_at is null and r.created_at < now() - interval '48 hours' and p.status = 'in_progress'
  loop
    if q.requester_role = 'client' then select user_id into other from public.creators where id = q.creator_id;
    else select user_id into other from public.clients where id = q.client_id; end if;
    perform public.notify_push(other, 'project_cancel_remind', '【Eizo Maps】途中キャンセルの申請に、まだ返事がありません',
      '案件「' || q.title || '」の途中キャンセルの申請に、まだ返事がありません。' || chr(10)
      || 'あと1日ほどで、相手の方が取り消せるようになります。案件のページで「同意する」か「同意しない」を選んでください。', '/projects/?id=' || q.pid);
    update public.project_cancel_requests set reminded_at = now() where id = q.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.project_cancel_remind() from public, anon, authenticated;
select cron.unschedule('project-cancel-remind') where exists (select 1 from cron.job where jobname = 'project-cancel-remind');
select cron.schedule('project-cancel-remind', '17 * * * *', $$select public.project_cancel_remind()$$);

-- ---- ④ 運営：申請の一覧と、運営による取り消し ----
create or replace function public.admin_cancel_requests()
returns table(id uuid, project_id uuid, title text, project_status text, client_name text, creator_name text,
              requester_role text, reason_code text, reason_note text, settle text, status text,
              respond_note text, reason_disputed boolean, admin_note text, created_at timestamptz, responded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '運営だけが見られます'; end if;
  return query
    select r.id, r.project_id, p.title, p.status, public.notify_name_client(p.client_id), public.notify_name_creator(p.creator_id),
           r.requester_role, r.reason_code, r.reason_note, r.settle, r.status, r.respond_note, r.reason_disputed, r.admin_note, r.created_at, r.responded_at
      from public.project_cancel_requests r join public.projects p on p.id = r.project_id
     order by r.created_at desc limit 200;
end $$;
revoke all on function public.admin_cancel_requests() from public, anon;
grant execute on function public.admin_cancel_requests() to authenticated;

-- p_fault = true … 申請の理由を認める（相手の記録に数える）／ false … 取り消すが、理由は認めない（「同意していません」と同じ扱い）
create or replace function public.admin_project_cancel(p_request uuid, p_fault boolean, p_note text)
returns text
language plpgsql security definer set search_path = '' as $$
declare q public.project_cancel_requests; p public.projects; cu uuid; ku uuid;
begin
  if not public.is_admin() then raise exception '運営だけができます'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception '判断の理由を書いてください（当事者の2人に届きます）'; end if;
  select * into q from public.project_cancel_requests where id = p_request for update;
  if not found then raise exception 'この申請は見つかりません'; end if;
  if q.status not in ('open','declined') then raise exception 'この申請は、もう終わっています'; end if;
  select * into p from public.projects where id = q.project_id for update;
  if p.status <> 'in_progress' then raise exception 'この案件は、もう進行中ではありません'; end if;
  -- ほかに開いている申請があれば閉じる
  update public.project_cancel_requests set status = 'withdrawn', responded_at = now()
   where project_id = q.project_id and status = 'open' and id <> q.id;
  update public.project_cancel_requests
     set status = 'admin', responded_by = auth.uid(), responded_at = now(), admin_note = btrim(p_note),
         reason_disputed = not coalesce(p_fault, false)
   where id = q.id;
  perform set_config('em.cancel_ok', '1', true);
  update public.projects set status = 'cancelled' where id = q.project_id;
  insert into public.project_messages (project_id, sender_id, body)
  values (q.project_id, auth.uid(), '【途中キャンセル】運営が中身を確かめて、この案件を取り消しました。' || chr(10) || '運営から：' || btrim(p_note));
  select user_id into cu from public.clients where id = p.client_id;
  select user_id into ku from public.creators where id = p.creator_id;
  perform public.notify_push(cu, 'project_cancel_admin', '【Eizo Maps】運営が案件を取り消しました',
    '案件「' || p.title || '」を、運営が取り消しました。' || chr(10) || '運営から：' || btrim(p_note), '/projects/?id=' || p.id);
  perform public.notify_push(ku, 'project_cancel_admin', '【Eizo Maps】運営が案件を取り消しました',
    '案件「' || p.title || '」を、運営が取り消しました。' || chr(10) || '運営から：' || btrim(p_note), '/projects/?id=' || p.id);
  return 'cancelled';
end $$;
revoke all on function public.admin_project_cancel(uuid, boolean, text) from public, anon;
grant execute on function public.admin_project_cancel(uuid, boolean, text) to authenticated;
