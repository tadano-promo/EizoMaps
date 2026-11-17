-- =====================================================================
--  064: 見積もりの話し合い中は「作業の一時停止」（2026-11-17 翠くん）
--  ・クリエイターが見積もりを出し直した時点で一時停止が始まる（金額が決まるまで、作業を止めてよい）
--  ・クライアントさんが確定する → 再開
--  ・見送られた → 止まったまま。とことん話し合う
--      → クリエイターが出し直す（止まったまま、確定で再開）
--      → クリエイターが「見積もりを取り下げて、いまの金額のまま再開」する（金額が上がらないので相手の確認はいらない）
--  ・止まっていた期間は project_pauses に残る。消せない
-- =====================================================================
create table if not exists public.project_pauses (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  end_reason  text check (end_reason is null or end_reason in ('accepted','withdrawn','closed'))
);
create unique index if not exists project_pauses_open_one on public.project_pauses(project_id) where ended_at is null;
alter table public.project_pauses enable row level security;
drop policy if exists project_pauses_select on public.project_pauses;
create policy project_pauses_select on public.project_pauses for select to authenticated
  using (public.is_project_party(project_id) or public.is_admin());
revoke all on public.project_pauses from anon, authenticated;
grant select on public.project_pauses to authenticated;

alter table public.project_quotes drop constraint if exists project_quotes_status_check;
alter table public.project_quotes add constraint project_quotes_status_check check (status in ('proposed','accepted','declined','replaced','withdrawn'));

-- 見積もりを出したら一時停止を始める（もう止まっていれば何もしない）
create or replace function public.quote_pause_on_propose() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.project_pauses (project_id) values (new.project_id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_quote_pause on public.project_quotes;
create trigger trg_quote_pause after insert on public.project_quotes for each row execute function public.quote_pause_on_propose();

-- 確定したら再開
create or replace function public.quote_resume_on_accept() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    update public.project_pauses set ended_at = now(), end_reason = 'accepted' where project_id = new.project_id and ended_at is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_quote_resume on public.project_quotes;
create trigger trg_quote_resume after update on public.project_quotes for each row execute function public.quote_resume_on_accept();

-- 案件が終わったら（納品・入金・完了・キャンセル）止まったままにしない
create or replace function public.pause_close_on_project_end() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.status in ('paid','closed','cancelled') and old.status is distinct from new.status then
    update public.project_pauses set ended_at = now(), end_reason = 'closed' where project_id = new.id and ended_at is null;
    update public.project_quotes set status = 'withdrawn', decided_at = now() where project_id = new.id and status = 'proposed';
  end if;
  return null;
end $$;
drop trigger if exists trg_projects_pause_close on public.projects;
create trigger trg_projects_pause_close after update on public.projects for each row execute function public.pause_close_on_project_end();

-- クリエイター：見積もりを取り下げて、いまの金額のまま再開する
create or replace function public.quote_withdraw_resume(p_project uuid, p_note text default null)
returns void language plpgsql security definer set search_path to '' as $$
declare p public.projects; cu uuid; now_amt integer; days integer;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'creator' then raise exception '取り下げて再開できるのは、クリエイターだけです'; end if;
  if not exists (select 1 from public.project_pauses where project_id = p_project and ended_at is null) then raise exception 'いまは一時停止していません'; end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  update public.project_quotes set status = 'withdrawn', decided_at = now() where project_id = p_project and status = 'proposed';
  select greatest(1, ceil(extract(epoch from now() - started_at) / 86400.0)::int) into days from public.project_pauses where project_id = p_project and ended_at is null;
  update public.project_pauses set ended_at = now(), end_reason = 'withdrawn' where project_id = p_project and ended_at is null;
  now_amt := coalesce(p.final_amount, p.terms_amount);
  insert into public.project_messages (project_id, sender_id, body) values (p_project, auth.uid(),
    '【作業を再開】見積もりの出し直しを取り下げて、いまの金額のまま作業を再開します。' || chr(10)
    || '金額：' || coalesce(to_char(now_amt, 'FM999,999,999,999') || '円（税込）', '未定') || '（変わりません）' || chr(10)
    || '止まっていた日数：' || days || '日' || coalesce(chr(10) || 'ひとこと：' || left(p_note, 500), ''));
  select user_id into cu from public.clients where id = p.client_id;
  perform public.notify_push(cu, 'project_resumed', '【Eizo Maps】作業が再開しました',
    public.notify_name_creator(p.creator_id) || ' さんが、案件「' || p.title || '」の見積もりの出し直しを取り下げて、いまの金額のまま作業を再開しました。' || chr(10)
      || '金額：' || coalesce(to_char(now_amt, 'FM999,999,999,999') || '円（税込）', '未定') || '（変わりません）', '/projects/?id=' || p.id);
end $$;
revoke all on function public.quote_withdraw_resume(uuid, text) from public, anon;
grant execute on function public.quote_withdraw_resume(uuid, text) to authenticated;

-- 見積もりのメッセージ・お知らせに「一時停止」のことを書く（063 の関数を作り直し）
-- クリエイターが見積もりを出し直す
create or replace function public.quote_propose(p_project uuid, p_amount integer, p_due date default null, p_note text default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare p public.projects; v integer; qid uuid; cu uuid; prev integer; cur_txt text;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'creator' then raise exception '見積もりを出し直せるのは、クリエイターだけです'; end if;
  if p.status not in ('in_progress','delivered') then raise exception '見積もりを出し直せるのは、進行中か納品済みのあいだだけです'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000000 then raise exception '金額を正しく入れてください'; end if;
  if p_due is not null and p_due < current_date then raise exception '納期が過ぎた日になっています'; end if;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_note is not null and char_length(p_note) > 1000 then raise exception '中身は1000文字までです'; end if;

  update public.project_quotes set status = 'replaced', decided_at = now() where project_id = p_project and status = 'proposed';
  select coalesce(max(version), 1) + 1 into v from public.project_quotes where project_id = p_project;
  insert into public.project_quotes (project_id, version, amount, due_on, note, created_by)
  values (p_project, v, p_amount, p_due, p_note, auth.uid()) returning id into qid;

  prev := coalesce(p.final_amount, p.terms_amount);
  cur_txt := case when prev is null then '' when prev = p_amount then '（いまの金額のまま）'
                  else '（いまの金額 ' || to_char(prev, 'FM999,999,999,999') || '円から' || case when p_amount > prev then '+' else '−' end
                       || to_char(abs(p_amount - prev), 'FM999,999,999,999') || '円）' end;
  insert into public.project_messages (project_id, sender_id, body) values (p_project, auth.uid(),
    '【見積もり（' || v || '回目）】' || chr(10)
    || '金額：' || to_char(p_amount, 'FM999,999,999,999') || '円（税込）' || cur_txt || chr(10)
    || '納期：' || coalesce(to_char(p_due, 'YYYY/MM/DD'), coalesce(to_char(coalesce(p.final_due_on, p.terms_due_on), 'YYYY/MM/DD') || '（いまのまま）', '相談'))
    || coalesce(chr(10) || '中身：' || p_note, '') || chr(10)
    || '→ 金額が決まるまで、作業はいったん止まります（一時停止）。クライアントさんが「この金額で確定する」を押すと、確定の金額になって作業を再開します。');

  select user_id into cu from public.clients where id = p.client_id;
  perform public.notify_push(cu, 'quote_proposed',
    '【Eizo Maps】' || public.notify_name_creator(p.creator_id) || ' さんから見積もり（' || v || '回目）が届きました',
    public.notify_name_creator(p.creator_id) || ' さんから、案件「' || p.title || '」の見積もり（' || v || '回目）が届きました。' || chr(10)
      || '金額：' || to_char(p_amount, 'FM999,999,999,999') || '円（税込）' || cur_txt || chr(10) || chr(10)
      || '金額が決まるまで、作業はいったん止まります。納得できるまで、メッセージで話し合ってください。' || chr(10)
      || 'よければ、案件のページで「この金額で確定する」を押してください。', '/projects/?id=' || p.id);
  return qid;
end $$;
revoke all on function public.quote_propose(uuid, integer, date, text) from public, anon;
grant execute on function public.quote_propose(uuid, integer, date, text) to authenticated;

-- クライアントさんが確定する／見送る
create or replace function public.quote_decide(p_quote uuid, p_action text, p_reason text default null)
returns text language plpgsql security definer set search_path to '' as $$
declare q public.project_quotes; p public.projects; ku uuid;
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
    update public.projects set final_amount = q.amount, final_due_on = coalesce(q.due_on, coalesce(p.final_due_on, p.terms_due_on)),
           final_at = now(), final_quote_id = q.id where id = q.project_id;
    insert into public.project_messages (project_id, sender_id, body) values (q.project_id, auth.uid(),
      '【見積もりを確定】' || q.version || '回目の見積もりで確定しました。' || chr(10)
      || '確定の金額：' || to_char(q.amount, 'FM999,999,999,999') || '円（税込）');
    perform public.notify_push(ku, 'quote_accepted', '【Eizo Maps】見積もり（' || q.version || '回目）が確定しました',
      public.notify_name_client(p.client_id) || ' さんが、案件「' || p.title || '」の見積もり（' || q.version || '回目）で確定しました。' || chr(10)
        || '確定の金額：' || to_char(q.amount, 'FM999,999,999,999') || '円（税込）', '/projects/?id=' || p.id);
  elsif p_action = 'decline' then
    update public.project_quotes set status = 'declined', decided_at = now(), decline_reason = left(p_reason, 500) where id = p_quote;
    insert into public.project_messages (project_id, sender_id, body) values (q.project_id, auth.uid(),
      '【見積もりを見送り】' || q.version || '回目の見積もりは見送りました。' || coalesce(chr(10) || '理由：' || p_reason, '') || chr(10)
      || '→ 金額が決まるまで、作業は一時停止のままです。話し合って決まったら、見積もりを出し直すか、取り下げて再開します。');
    perform public.notify_push(ku, 'quote_declined', '【Eizo Maps】見積もり（' || q.version || '回目）が見送られました',
      public.notify_name_client(p.client_id) || ' さんが、案件「' || p.title || '」の見積もり（' || q.version || '回目）を見送りました。'
        || coalesce(chr(10) || '理由：' || p_reason, '') || chr(10) || chr(10)
        || '金額が決まるまで、作業は止めたままで大丈夫です。メッセージでとことん話し合って、決まったら見積もりを出し直すか、「取り下げて、いまの金額のまま再開」を押してください。', '/projects/?id=' || p.id);
  else
    raise exception '使えない返事です';
  end if;
  return p_action;
end $$;
revoke all on function public.quote_decide(uuid, text, text) from public, anon;
grant execute on function public.quote_decide(uuid, text, text) to authenticated;
