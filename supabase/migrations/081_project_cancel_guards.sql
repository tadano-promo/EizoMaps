-- 081: 途中キャンセルの歯止め（2026-11-25 翠くん「お互いが不用意にキャンセルできるとダメ」）
--  ・自分の都合でキャンセルした数（own）も数える → その人のページに出す
--  ・同意されなかったあと、次の申請まで24時間あける
--  ・「この案件の決まり」に途中キャンセルを足した版（2026-11-25）を受け付ける（切りかえのあいだは前の版も通す）
create or replace function public.cancel_stats_for(p_role text, p_id uuid)
returns json language sql stable security definer set search_path = '' as $$
  with ps as (select id, status from public.projects
               where started_at is not null and ((p_role = 'creator' and creator_id = p_id) or (p_role = 'client' and client_id = p_id))),
  done as (select r.* from public.project_cancel_requests r join ps on ps.id = r.project_id where r.status in ('agreed','no_reply')),
  c as (select * from done where requester_role <> p_role
          and reason_code in ('no_contact','no_progress','late','quality','behavior') and not reason_disputed)
  select json_build_object(
    'started',   (select count(*) from ps),
    'cancelled', (select count(*) from ps where status = 'cancelled'),
    'against',   (select count(*) from c),
    'own',       (select count(*) from done where requester_role = p_role and reason_code in ('own_change','own_budget','own_other')),
    'reasons',   coalesce((select json_object_agg(reason_code, n) from (select reason_code, count(*) n from c group by 1) t), '{}'::json));
$$;
revoke all on function public.cancel_stats_for(text, uuid) from public, anon, authenticated;
create or replace function public.creator_cancel_stats(p_creator_id uuid)
returns json language sql stable security definer set search_path = '' as $$ select public.cancel_stats_for('creator', p_creator_id); $$;
create or replace function public.client_cancel_stats(p_client_id uuid)
returns json language sql stable security definer set search_path = '' as $$ select public.cancel_stats_for('client', p_client_id); $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.project_cancel_request(uuid,text,text)'::regprocedure);
  d := replace(d, $a$  insert into public.project_cancel_requests (project_id, requested_by, requester_role, reason_code, reason_note)$a$,
    $b$  if exists (select 1 from public.project_cancel_requests where project_id = p_project and requested_by = auth.uid()
               and status = 'declined' and responded_at > now() - interval '24 hours') then
    raise exception '同意されなかった申請のあと、24時間は次の申請ができません。まずメッセージで話し合ってください';
  end if;
  insert into public.project_cancel_requests (project_id, requested_by, requester_role, reason_code, reason_note)$b$);
  execute d;
  d := pg_get_functiondef('public.project_start(uuid,text)'::regprocedure);
  d := replace(d, $a$if p_rules_version is distinct from '2026-11-18' then$a$, $b$if p_rules_version is null or p_rules_version not in ('2026-11-18','2026-11-25') then$b$);
  d := replace(d, $a$'■ この案件の決まり（2026-11-18版。お互いに同意して始めました）'$a$, $b$'■ この案件の決まり（' || p_rules_version || '版。お互いに同意して始めました）'$b$);
  execute d;
end $$;
