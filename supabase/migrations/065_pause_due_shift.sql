-- =====================================================================
--  065: 一時停止した日数だけ、納期を自動でうしろにずらす（2026-11-18 翠くん）
--  「クライアントは自分の見込みの甘さが原因なのに、納期は伸ばせないと言いがち。クリエイターが損しないように」
--  ・止まるのはクライアントさんが「見送る」を押したときだけなので、クリエイターが一人で納期を伸ばすことはできない
--  ・日数は日本時間の日付で数える（11/21 に止まって 11/23 に再開 → 2日）。同じ日に再開なら 0日
--  ・確定した見積もりに新しい納期が入っていれば、その納期を使う（話し合いで決めた日なので、足さない）
--  ・クライアントさんには「見送る」の前に、納期がずれることを必ず見せる（画面側）
-- =====================================================================
alter table public.project_pauses add column if not exists shifted_days integer;
alter table public.project_pauses add column if not exists due_before date;
alter table public.project_pauses add column if not exists due_after date;

create or replace function public.pause_days(p_started timestamptz, p_ended timestamptz default null) returns integer
language sql stable set search_path to '' as $$
  select greatest(0, ((coalesce(p_ended, now()) at time zone 'Asia/Tokyo')::date - (p_started at time zone 'Asia/Tokyo')::date));
$$;

-- 一時停止を終えて、納期をずらす。p_new_due があればそれを使う（ずらさない）
create or replace function public.pause_end(p_project uuid, p_reason text, p_new_due date default null)
returns text language plpgsql security definer set search_path to '' as $$
declare z public.project_pauses; p public.projects; d integer; base date; nd date;
begin
  select * into z from public.project_pauses where project_id = p_project and ended_at is null for update;
  if not found then return null; end if;
  select * into p from public.projects where id = p_project for update;
  d := public.pause_days(z.started_at, now());
  base := coalesce(p.final_due_on, p.terms_due_on);
  nd := case when p_new_due is not null then p_new_due when base is null then null else base + d end;
  update public.project_pauses set ended_at = now(), end_reason = p_reason,
         shifted_days = case when p_new_due is not null or base is null then 0 else d end, due_before = base, due_after = nd
   where id = z.id;
  if nd is distinct from base then update public.projects set final_due_on = nd where id = p_project; end if;
  return case when base is null then '納期：相談（止まっていた日数：' || d || '日）'
              when p_new_due is not null then '納期：' || to_char(nd, 'YYYY/MM/DD') || '（見積もりで決めた納期。止まっていた日数：' || d || '日）'
              when d = 0 then '納期：' || to_char(base, 'YYYY/MM/DD') || '（同じ日に再開したので、変わりません）'
              else '納期：' || to_char(base, 'YYYY/MM/DD') || ' → ' || to_char(nd, 'YYYY/MM/DD') || '（一時停止 ' || d || '日分うしろへ）' end;
end $$;
revoke all on function public.pause_end(uuid, text, date) from public, anon, authenticated;

-- 確定したら：止まっていれば納期をずらして再開（トリガーではなく quote_decide の中でやる）
drop trigger if exists trg_quote_resume on public.project_quotes;
drop function if exists public.quote_resume_on_accept();

-- 案件が終わったら、ずらさずに解除
create or replace function public.pause_close_on_project_end() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.status in ('paid','closed','cancelled') and old.status is distinct from new.status then
    update public.project_pauses set ended_at = now(), end_reason = 'closed', shifted_days = 0 where project_id = new.id and ended_at is null;
    update public.project_quotes set status = 'withdrawn', decided_at = now() where project_id = new.id and status = 'proposed';
  end if;
  return null;
end $$;

create or replace function public.quote_decide(p_quote uuid, p_action text, p_reason text default null)
returns text language plpgsql security definer set search_path to '' as $$
declare q public.project_quotes; p public.projects; ku uuid; due_txt text; base date;
begin
  select * into q from public.project_quotes where id = p_quote for update;
  if not found then raise exception 'この見積もりは見つかりません'; end if;
  select * into p from public.projects where id = q.project_id for update;
  if public.project_my_role(q.project_id) is distinct from 'client' then raise exception '確定できるのは、依頼したクライアントさんだけです'; end if;
  if q.status <> 'proposed' then raise exception 'この見積もりは、もう返事が済んでいるか、新しい見積もりに出し直されています'; end if;
  if p.status not in ('in_progress','delivered') then raise exception 'この案件では、もう見積もりを確定できません'; end if;
  p_reason := nullif(btrim(coalesce(p_reason, '')), '');
  select user_id into ku from public.creators where id = p.creator_id;

  if p_action = 'accept' then
    update public.project_quotes set status = 'accepted', decided_at = now() where id = p_quote;
    due_txt := public.pause_end(q.project_id, 'accepted', q.due_on);          -- 止まっていれば、ここで納期をずらして再開
    if due_txt is null then                                                    -- 止まっていなかった
      base := coalesce(p.final_due_on, p.terms_due_on);
      if q.due_on is not null then update public.projects set final_due_on = q.due_on where id = q.project_id; end if;
      due_txt := '納期：' || coalesce(to_char(coalesce(q.due_on, base), 'YYYY/MM/DD'), '相談');
    end if;
    update public.projects set final_amount = q.amount, final_at = now(), final_quote_id = q.id where id = q.project_id;
    insert into public.project_messages (project_id, sender_id, body) values (q.project_id, auth.uid(),
      '【見積もりを確定】' || q.version || '回目の見積もりで確定しました。' || chr(10)
      || '確定の金額：' || to_char(q.amount, 'FM999,999,999,999') || '円（税込）' || chr(10) || due_txt);
    perform public.notify_push(ku, 'quote_accepted', '【Eizo Maps】見積もり（' || q.version || '回目）が確定しました',
      public.notify_name_client(p.client_id) || ' さんが、案件「' || p.title || '」の見積もり（' || q.version || '回目）で確定しました。' || chr(10)
        || '確定の金額：' || to_char(q.amount, 'FM999,999,999,999') || '円（税込）' || chr(10) || due_txt, '/projects/?id=' || p.id);
  elsif p_action = 'decline' then
    update public.project_quotes set status = 'declined', decided_at = now(), decline_reason = left(p_reason, 500) where id = p_quote;
    insert into public.project_pauses (project_id) values (q.project_id) on conflict do nothing;
    insert into public.project_messages (project_id, sender_id, body) values (q.project_id, auth.uid(),
      '【見積もりを見送り】' || q.version || '回目の見積もりは見送りました。' || coalesce(chr(10) || '理由：' || p_reason, '') || chr(10)
      || '→ 金額が決まるまで、作業は一時停止になります。納期は、止まった日数だけ自動でうしろにずれます。' || chr(10)
      || '→ 話し合って決まったら、見積もりを出し直すか、取り下げて再開します。');
    perform public.notify_push(ku, 'quote_declined', '【Eizo Maps】見積もり（' || q.version || '回目）が見送られました',
      public.notify_name_client(p.client_id) || ' さんが、案件「' || p.title || '」の見積もり（' || q.version || '回目）を見送りました。'
        || coalesce(chr(10) || '理由：' || p_reason, '') || chr(10) || chr(10)
        || '金額が決まるまで、作業は止めたままで大丈夫です。納期は、止まった日数だけ自動でうしろにずれます。' || chr(10)
        || 'メッセージでとことん話し合って、決まったら見積もりを出し直すか、「取り下げて、いまの金額のまま再開」を押してください。', '/projects/?id=' || p.id);
  else
    raise exception '使えない返事です';
  end if;
  return p_action;
end $$;
revoke all on function public.quote_decide(uuid, text, text) from public, anon;
grant execute on function public.quote_decide(uuid, text, text) to authenticated;

create or replace function public.quote_withdraw_resume(p_project uuid, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare p public.projects; cu uuid; now_amt integer; paused boolean; due_txt text;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'creator' then raise exception '取り下げて再開できるのは、クリエイターだけです'; end if;
  paused := exists (select 1 from public.project_pauses where project_id = p_project and ended_at is null);
  if not paused and not exists (select 1 from public.project_quotes where project_id = p_project and status = 'proposed') then
    raise exception '取り下げる見積もりがありません';
  end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  update public.project_quotes set status = 'withdrawn', decided_at = now() where project_id = p_project and status = 'proposed';
  due_txt := public.pause_end(p_project, 'withdrawn', null);
  now_amt := coalesce(p.final_amount, p.terms_amount);
  insert into public.project_messages (project_id, sender_id, body) values (p_project, auth.uid(),
    case when paused then '【作業を再開】見積もりの出し直しを取り下げて、いまの金額のまま作業を再開します。'
         else '【見積もりを取り下げ】出し直した見積もりを取り下げます。いまの金額のまま進めます。' end || chr(10)
    || '金額：' || coalesce(to_char(now_amt, 'FM999,999,999,999') || '円（税込）', '未定') || '（変わりません）'
    || coalesce(chr(10) || due_txt, '')
    || coalesce(chr(10) || 'ひとこと：' || left(p_note, 500), ''));
  select user_id into cu from public.clients where id = p.client_id;
  perform public.notify_push(cu, 'project_resumed', case when paused then '【Eizo Maps】作業が再開しました' else '【Eizo Maps】見積もりが取り下げられました' end,
    public.notify_name_creator(p.creator_id) || ' さんが、案件「' || p.title || '」の見積もりの出し直しを取り下げ' || case when paused then 'て、いまの金額のまま作業を再開しました。' else 'ました。いまの金額のまま進めます。' end || chr(10)
      || '金額：' || coalesce(to_char(now_amt, 'FM999,999,999,999') || '円（税込）', '未定') || '（変わりません）' || coalesce(chr(10) || due_txt, ''), '/projects/?id=' || p.id);
end $$;
revoke all on function public.quote_withdraw_resume(uuid, text) from public, anon;
grant execute on function public.quote_withdraw_resume(uuid, text) to authenticated;
