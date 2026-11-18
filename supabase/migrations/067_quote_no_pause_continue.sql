-- =====================================================================
--  067: 止めない選択肢と、納期の決め方（2026-11-18 翠くん「諸々含んで修正して」）
--  ・見積もりに「見送られても作業は止めない」を付けられる（クリエイターが自分の守りを手放すだけなので、悪用にならない）
--  ・止まったあとでも、クリエイターは「止めずに作業を続ける（納期はずらさない）」を選べる
--  ・止まっているあいだの見積もりは、納期を「止まった日数だけうしろへ」（空欄）か「この日にする」（日付）で出す
--    → メッセージにも、どちらなのかと、いま確定した場合の日付を書く
-- =====================================================================
alter table public.project_quotes add column if not exists no_pause boolean not null default false;
alter table public.project_pauses drop constraint if exists project_pauses_end_reason_check;
alter table public.project_pauses add constraint project_pauses_end_reason_check check (end_reason is null or end_reason in ('accepted','withdrawn','closed','continued'));

drop function if exists public.quote_propose(uuid, integer, date, text);
create or replace function public.quote_propose(p_project uuid, p_amount integer, p_due date default null, p_note text default null, p_no_pause boolean default false)
returns uuid language plpgsql security definer set search_path to '' as $$
declare p public.projects; v integer; qid uuid; cu uuid; prev integer; cur_txt text; z public.project_pauses; base date; due_txt text;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'creator' then raise exception '見積もりを出し直せるのは、クリエイターだけです'; end if;
  if p.status not in ('in_progress','delivered') then raise exception '見積もりを出し直せるのは、進行中か納品済みのあいだだけです'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000000 then raise exception '金額を正しく入れてください'; end if;
  if p_due is not null and p_due < current_date then raise exception '納期が過ぎた日になっています'; end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_note is not null and char_length(p_note) > 1000 then raise exception '中身は1000文字までです'; end if;
  select * into z from public.project_pauses where project_id = p_project and ended_at is null;
  base := coalesce(p.final_due_on, p.terms_due_on);

  update public.project_quotes set status = 'replaced', decided_at = now() where project_id = p_project and status = 'proposed';
  select coalesce(max(version), 1) + 1 into v from public.project_quotes where project_id = p_project;
  insert into public.project_quotes (project_id, version, amount, due_on, note, created_by, no_pause)
  values (p_project, v, p_amount, p_due, p_note, auth.uid(), coalesce(p_no_pause, false) and z.id is null) returning id into qid;

  prev := coalesce(p.final_amount, p.terms_amount);
  cur_txt := case when prev is null then '' when prev = p_amount then '（いまの金額のまま）'
                  else '（いまの金額 ' || to_char(prev, 'FM999,999,999,999') || '円から' || case when p_amount > prev then '+' else '−' end
                       || to_char(abs(p_amount - prev), 'FM999,999,999,999') || '円）' end;
  due_txt := case
    when p_due is not null then to_char(p_due, 'YYYY/MM/DD') || case when base is not null and p_due = base then '（いまの納期のまま）' when z.id is not null then '（この日にする）' else '' end
    when base is null then '相談'
    when z.id is not null and p.rules_agreed_at is not null then '止まった日数だけうしろへ（いま確定すると ' || to_char(base + public.pause_days(z.started_at, now()), 'YYYY/MM/DD') || '）'
    else to_char(base, 'YYYY/MM/DD') || '（いまのまま）' end;
  insert into public.project_messages (project_id, sender_id, body) values (p_project, auth.uid(),
    '【見積もり（' || v || '回目）】' || chr(10)
    || '金額：' || to_char(p_amount, 'FM999,999,999,999') || '円（税込）' || cur_txt || chr(10)
    || '納期：' || due_txt
    || coalesce(chr(10) || '中身：' || p_note, '')
    || case when coalesce(p_no_pause, false) and z.id is null then chr(10) || '※ 見送られても、作業は止めずに続けます（納期はずらしません）。' else '' end || chr(10)
    || '→ クライアントさんが「確定する」を押すと、この金額と納期になります。');

  select user_id into cu from public.clients where id = p.client_id;
  perform public.notify_push(cu, 'quote_proposed',
    '【Eizo Maps】' || public.notify_name_creator(p.creator_id) || ' さんから見積もり（' || v || '回目）が届きました',
    public.notify_name_creator(p.creator_id) || ' さんから、案件「' || p.title || '」の見積もり（' || v || '回目）が届きました。' || chr(10)
      || '金額：' || to_char(p_amount, 'FM999,999,999,999') || '円（税込）' || cur_txt || chr(10) || '納期：' || due_txt || chr(10) || chr(10)
      || 'よければ、案件のページで「確定する」を押してください。', '/projects/?id=' || p.id);
  return qid;
end $$;
revoke all on function public.quote_propose(uuid, integer, date, text, boolean) from public, anon;
grant execute on function public.quote_propose(uuid, integer, date, text, boolean) to authenticated;

-- 見送り：止めない見積もりなら止めない
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
    due_txt := public.pause_end(q.project_id, 'accepted', q.due_on);
    if due_txt is null then
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
    if not q.no_pause then
      insert into public.project_pauses (project_id) values (q.project_id) on conflict do nothing;
    end if;
    insert into public.project_messages (project_id, sender_id, body) values (q.project_id, auth.uid(),
      '【見積もりを見送り】' || q.version || '回目の見積もりは見送りました。' || coalesce(chr(10) || '理由：' || p_reason, '') || chr(10)
      || case when q.no_pause then '→ この見積もりは「見送られても止めない」で出されているので、作業はそのまま続きます。納期も変わりません。'
              else '→ 金額が決まるまで、作業は一時停止になります。' || case when p.rules_agreed_at is not null then '納期は、止まった日数だけ自動でうしろにずれます。' else '' end
                   || chr(10) || '→ 話し合って決まったら、見積もりを出し直すか、取り下げて再開します。' end);
    perform public.notify_push(ku, 'quote_declined', '【Eizo Maps】見積もり（' || q.version || '回目）が見送られました',
      public.notify_name_client(p.client_id) || ' さんが、案件「' || p.title || '」の見積もり（' || q.version || '回目）を見送りました。'
        || coalesce(chr(10) || '理由：' || p_reason, '') || chr(10) || chr(10)
        || case when q.no_pause then '「見送られても止めない」で出した見積もりなので、作業と納期はそのままです。メッセージで話し合って、必要なら出し直してください。'
                else '金額が決まるまで、作業は止めたままで大丈夫です。' || case when p.rules_agreed_at is not null then '納期は、止まった日数だけ自動でうしろにずれます。' else '' end || chr(10)
                     || 'メッセージでとことん話し合って、決まったら見積もりを出し直すか、「取り下げて、いまの金額のまま再開」を押してください。止めずに続けたいときは「止めずに作業を続ける」を押してください。' end,
      '/projects/?id=' || p.id);
  else
    raise exception '使えない返事です';
  end if;
  return p_action;
end $$;
revoke all on function public.quote_decide(uuid, text, text) from public, anon;
grant execute on function public.quote_decide(uuid, text, text) to authenticated;

-- 止まったあとで、クリエイターが「止めずに作業を続ける（納期はずらさない）」
create or replace function public.pause_continue(p_project uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare p public.projects; z public.project_pauses; base date; cu uuid;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'creator' then raise exception '止めずに続けるのを選べるのは、クリエイターだけです'; end if;
  select * into z from public.project_pauses where project_id = p_project and ended_at is null for update;
  if not found then raise exception 'いまは一時停止していません'; end if;
  base := coalesce(p.final_due_on, p.terms_due_on);
  update public.project_pauses set ended_at = now(), end_reason = 'continued', shifted_days = 0, due_before = base, due_after = base where id = z.id;
  insert into public.project_messages (project_id, sender_id, body) values (p_project, auth.uid(),
    '【作業を続けます】金額の話し合いのあいだも、止めずに作業を続けます。' || chr(10)
    || '納期：' || coalesce(to_char(base, 'YYYY/MM/DD') || '（変わりません）', '相談'));
  select user_id into cu from public.clients where id = p.client_id;
  perform public.notify_push(cu, 'project_continued', '【Eizo Maps】作業はそのまま続きます',
    public.notify_name_creator(p.creator_id) || ' さんが、案件「' || p.title || '」で、金額の話し合いのあいだも止めずに作業を続けることにしました。' || chr(10)
      || '納期：' || coalesce(to_char(base, 'YYYY/MM/DD') || '（変わりません）', '相談'), '/projects/?id=' || p.id);
end $$;
revoke all on function public.pause_continue(uuid) from public, anon;
grant execute on function public.pause_continue(uuid) to authenticated;
