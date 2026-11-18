-- =====================================================================
--  066: 取引の決まりは「始めるとき」に同意してもらう（2026-11-18 翠くん「見送る直前に出されても知らんわってなる。取引開始時にちゃんと知らせる」）
--  ・クライアントさんは「この条件で始める」の前に、決まりを読んでチェックしないと始められない
--  ・同意した日時と決まりの版（2026-11-18）を案件に残す。開始のメッセージにも決まりを書いて残す
--  ・一時停止で納期を自動でずらすのは、決まりに同意して始めた案件だけ（前に始まった案件は、記録だけ残してずらさない）
-- =====================================================================
alter table public.projects add column if not exists rules_version text;
alter table public.projects add column if not exists rules_agreed_at timestamptz;

create or replace function public.stamp_project_ended() returns trigger
language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.ended_at := old.ended_at; new.files_notice_at := old.files_notice_at; new.files_deleted_at := old.files_deleted_at;
    new.final_amount := old.final_amount; new.final_due_on := old.final_due_on; new.final_at := old.final_at; new.final_quote_id := old.final_quote_id;
    new.rules_version := old.rules_version; new.rules_agreed_at := old.rules_agreed_at;
  end if;
  if new.status in ('closed','cancelled','declined') and old.status is distinct from new.status then new.ended_at := now();
  elsif new.status not in ('closed','cancelled','declined') then new.ended_at := null; end if;
  return new;
end $$;

drop function if exists public.project_start(uuid);
create or replace function public.project_start(p_project uuid, p_rules_version text default null)
returns text language plpgsql security definer set search_path to '' as $$
declare p public.projects;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'client' then raise exception '始めるのは、依頼したクライアントだけです'; end if;
  if p.status <> 'proposed' then raise exception 'クリエイターの返事が届いてから始められます（いまの状態: %）', p.status; end if;
  if p.terms_amount is null then
    raise exception '金額がまだ決まっていません。メッセージで相談して、クリエイターに金額を入れた条件を出し直してもらってください';
  end if;
  if p_rules_version is distinct from '2026-11-18' then
    raise exception '「この案件の決まり」を読んで、チェックを入れてから始めてください（ページを読み込み直すと出てきます）';
  end if;
  update public.projects set status = 'in_progress', rules_version = p_rules_version, rules_agreed_at = now() where id = p_project;
  insert into public.project_messages (project_id, sender_id, body)
  values (p_project, auth.uid(), '【開始】この条件で始めます。' || chr(10)
    || '金額：' || to_char(p.terms_amount, 'FM999,999,999,999') || '円（税込）' || chr(10)
    || '納期：' || coalesce(to_char(p.terms_due_on, 'YYYY/MM/DD'), '相談') || chr(10) || chr(10)
    || '■ この案件の決まり（2026-11-18版。お互いに同意して始めました）' || chr(10)
    || '・始めたときの金額と納期は記録に残り、あとから書き換えられません。' || chr(10)
    || '・途中で金額が変わるときは、クリエイターが見積もりを出し直し、クライアントが「確定」するまで金額は変わりません。' || chr(10)
    || '・クライアントが見積もりを「見送る」と、話がまとまるまで作業は一時停止になり、納期は止まった日数だけ自動でうしろにずれます。' || chr(10)
    || '・見積もり・返事・止まった日数は、すべて記録に残り、お互いに見られます。');
  return 'in_progress';
end $$;
revoke all on function public.project_start(uuid, text) from public, anon;
grant execute on function public.project_start(uuid, text) to authenticated;

-- 決まりに同意して始めた案件だけ、止まった日数ぶん納期をずらす
create or replace function public.pause_end(p_project uuid, p_reason text, p_new_due date default null)
returns text language plpgsql security definer set search_path to '' as $$
declare z public.project_pauses; p public.projects; d integer; base date; nd date; shift boolean;
begin
  select * into z from public.project_pauses where project_id = p_project and ended_at is null for update;
  if not found then return null; end if;
  select * into p from public.projects where id = p_project for update;
  d := public.pause_days(z.started_at, now());
  base := coalesce(p.final_due_on, p.terms_due_on);
  shift := p.rules_agreed_at is not null;
  nd := case when p_new_due is not null then p_new_due when base is null or not shift then base else base + d end;
  update public.project_pauses set ended_at = now(), end_reason = p_reason,
         shifted_days = case when p_new_due is not null or base is null or not shift then 0 else d end, due_before = base, due_after = nd
   where id = z.id;
  if nd is distinct from base then update public.projects set final_due_on = nd where id = p_project; end if;
  return case when base is null then '納期：相談（止まっていた日数：' || d || '日）'
              when p_new_due is not null then '納期：' || to_char(nd, 'YYYY/MM/DD') || '（見積もりで決めた納期。止まっていた日数：' || d || '日）'
              when not shift then '納期：' || to_char(base, 'YYYY/MM/DD') || '（決まりができる前に始まった案件なので、自動ではずらしません。止まっていた日数：' || d || '日）'
              when d = 0 then '納期：' || to_char(base, 'YYYY/MM/DD') || '（同じ日に再開したので、変わりません）'
              else '納期：' || to_char(base, 'YYYY/MM/DD') || ' → ' || to_char(nd, 'YYYY/MM/DD') || '（一時停止 ' || d || '日分うしろへ）' end;
end $$;
revoke all on function public.pause_end(uuid, text, date) from public, anon, authenticated;
