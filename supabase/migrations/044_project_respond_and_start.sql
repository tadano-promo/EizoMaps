-- =====================================================================
--  044 依頼の流れを「返事待ち → 条件の返事 → クライアントが始める」に（2026-11-15 翠くん）
--   ① クライアントが依頼を送る ………………… offered（返事待ち）
--   ② クリエイターが返事をする
--        ・この内容で受ける／条件を提案する …… proposed（条件の返事あり）
--        ・お断りする …………………………………… declined（お断り）
--   ③ クライアントが「この条件で始める」 ……… in_progress（進行中）
--   始めたときの条件（terms_*）はあとから書き換えられない
--   これまでの「offered → in_progress をどちらでも」は廃止
-- =====================================================================

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('draft','offered','proposed','declined','in_progress','delivered','paid','closed','cancelled'));

alter table public.projects
  add column if not exists terms_amount  integer check (terms_amount is null or (terms_amount >= 0 and terms_amount <= 1000000000)),
  add column if not exists terms_due_on  date,
  add column if not exists terms_note    text check (terms_note is null or char_length(terms_note) <= 1000),
  add column if not exists terms_at      timestamptz,
  add column if not exists declined_reason text check (declined_reason is null or char_length(declined_reason) <= 500),
  add column if not exists declined_at   timestamptz,
  add column if not exists origin        text not null default 'direct' check (origin in ('direct','board'));
-- terms_* / declined_* / origin は画面から直接は書けない（下の関数だけが書く）

-- 状態の変え方の決まり（だれが・どこからどこへ）
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
  -- 依頼を送ったあとは、依頼の中身（題名・内容・予算・希望納期）を書き換えられない
  if old.status <> 'draft' and (
       new.title is distinct from old.title or new.description is distinct from old.description
    or new.kind is distinct from old.kind or new.budget_amount is distinct from old.budget_amount
    or new.due_on is distinct from old.due_on or new.reference_url is distinct from old.reference_url) then
    raise exception '依頼を送ったあとは、依頼の中身は変えられません。変えたいことはメッセージで伝えてください';
  end if;
  -- 始めたあとは、条件を書き換えられない
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
  elsif old.status in ('draft','offered','proposed','in_progress') and new.status = 'cancelled' then ok := true;
  end if;

  if not ok then
    raise exception '「%」から「%」への変更はできません（あなたの立場: %）', old.status, new.status, role_name;
  end if;
  return new;
end;
$$;

-- ② クリエイターの返事
--   p_action = 'accept'  … この内容で受ける（条件は依頼の予算・希望納期のまま。ひとことは任意）
--              'propose' … 条件を提案する（金額・納期・中身）。返事のあとでも出し直せる（始まるまで）
--              'decline' … お断りする（理由は任意）
create or replace function public.project_respond(
  p_project uuid, p_action text,
  p_amount integer default null, p_due date default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.projects;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'creator' then
    raise exception '返事ができるのは、依頼を受けたクリエイターだけです';
  end if;
  if p.status not in ('offered','proposed') then
    raise exception 'この案件には、もう返事ができません（いまの状態: %）', p.status;
  end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');

  if p_action = 'accept' then
    update public.projects
       set status = 'proposed', terms_amount = p.budget_amount, terms_due_on = p.due_on,
           terms_note = p_note, terms_at = now()
     where id = p_project;
  elsif p_action = 'propose' then
    if p_amount is null and p_due is null and p_note is null then
      raise exception '金額・納期・中身のどれかを入れてください';
    end if;
    if p_amount is not null and (p_amount < 0 or p_amount > 1000000000) then raise exception '金額が正しくありません'; end if;
    if p_due is not null and p_due < current_date then raise exception '納期が過ぎた日になっています'; end if;
    update public.projects
       set status = 'proposed', terms_amount = p_amount, terms_due_on = p_due,
           terms_note = p_note, terms_at = now()
     where id = p_project;
  elsif p_action = 'decline' then
    update public.projects
       set status = 'declined', declined_reason = left(p_note, 500), declined_at = now()
     where id = p_project;
  else
    raise exception '使えない返事です';
  end if;

  -- やり取りの欄にも残す（あとから見返せるように）
  insert into public.project_messages (project_id, sender_id, body)
  values (p_project, auth.uid(),
    case p_action
      when 'accept'  then '【返事】この内容で受けます。' || coalesce(chr(10) || p_note, '')
      when 'propose' then '【条件の提案】' || chr(10)
                          || '金額：' || coalesce(to_char(p_amount, 'FM999,999,999,999') || '円（税込）', '相談') || chr(10)
                          || '納期：' || coalesce(to_char(p_due, 'YYYY/MM/DD'), '相談') || coalesce(chr(10) || '中身：' || p_note, '')
      else '【返事】今回はお断りします。' || coalesce(chr(10) || p_note, '')
    end);
  return (select status from public.projects where id = p_project);
end;
$$;

-- ③ クライアントが「この条件で始める」
create or replace function public.project_start(p_project uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.projects;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'client' then
    raise exception '始めるのは、依頼したクライアントだけです';
  end if;
  if p.status <> 'proposed' then
    raise exception 'クリエイターの返事が届いてから始められます（いまの状態: %）', p.status;
  end if;
  update public.projects set status = 'in_progress' where id = p_project;
  insert into public.project_messages (project_id, sender_id, body)
  values (p_project, auth.uid(), '【開始】この条件で始めます。');
  return 'in_progress';
end;
$$;

revoke all on function public.project_respond(uuid, text, integer, date, text) from public, anon;
revoke all on function public.project_start(uuid) from public, anon;
grant execute on function public.project_respond(uuid, text, integer, date, text) to authenticated;
grant execute on function public.project_start(uuid) to authenticated;
