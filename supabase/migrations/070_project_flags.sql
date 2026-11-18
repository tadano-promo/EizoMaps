-- =====================================================================
--  070: 案件一覧の札（2026-11-18 翠くん「1から順にやっていこう」）
--  一覧・トップ・マイページで、開かなくても「どれに返事が要るか」が分かるように、案件ごとの状況をまとめて返す
--  ・見られるのは自分が当事者の案件だけ（project_my_role が null の案件は返さない）
--  ・振込先は「届いているか」だけ返す（中身は返さない）
-- =====================================================================
create or replace function public.my_project_flags(p_ids uuid[])
returns table (project_id uuid, my_role text, paused_since timestamptz, pending_version integer, payout_sent boolean, withholding text)
language sql stable security definer set search_path to '' as $$
  select p.id,
         public.project_my_role(p.id),
         (select z.started_at from public.project_pauses z where z.project_id = p.id and z.ended_at is null limit 1),
         (select q.version from public.project_quotes q where q.project_id = p.id and q.status = 'proposed' limit 1),
         exists (select 1 from public.project_payouts x where x.project_id = p.id and x.wiped_at is null),
         p.withholding
    from public.projects p
   where p.id = any(p_ids[1:200]) and public.project_my_role(p.id) is not null;
$$;
revoke all on function public.my_project_flags(uuid[]) from public, anon;
grant execute on function public.my_project_flags(uuid[]) to authenticated;
