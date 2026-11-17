-- =====================================================================
--  063: 見積もりの出し直し（2026-11-17 翠くん）
--  ・始めたときの条件（terms_*）は変えない。1回目の見積もりとして記録に残る
--  ・クリエイターが「2回目の見積もり」「3回目…」を出せる（進行中・納品済みのあいだ）
--  ・クライアントさんが「この金額で確定する」を押すと、確定の金額（final_*）になる。「見送る」もできる
--  ・経緯は project_quotes とやり取り（【見積もり】のメッセージ）の両方に残る。消せない
-- =====================================================================
create table if not exists public.project_quotes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  version     integer not null check (version >= 2),
  amount      integer not null check (amount >= 0 and amount <= 1000000000),
  due_on      date,
  note        text check (note is null or char_length(note) <= 1000),
  status      text not null default 'proposed' check (status in ('proposed','accepted','declined','replaced')),
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 500),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  unique (project_id, version)
);
alter table public.project_quotes enable row level security;
drop policy if exists project_quotes_select on public.project_quotes;
create policy project_quotes_select on public.project_quotes for select to authenticated
  using (public.is_project_party(project_id) or public.is_admin());
revoke all on public.project_quotes from anon, authenticated;
grant select on public.project_quotes to authenticated;
create index if not exists project_quotes_project_idx on public.project_quotes(project_id, version);

alter table public.projects add column if not exists final_amount integer;
alter table public.projects add column if not exists final_due_on date;
alter table public.projects add column if not exists final_at timestamptz;
alter table public.projects add column if not exists final_quote_id uuid references public.project_quotes(id);

-- 画面から（本人の操作で）は確定の金額を書き換えさせない（stamp_project_ended に足す）
create or replace function public.stamp_project_ended() returns trigger
language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.ended_at := old.ended_at; new.files_notice_at := old.files_notice_at; new.files_deleted_at := old.files_deleted_at;
    new.final_amount := old.final_amount; new.final_due_on := old.final_due_on; new.final_at := old.final_at; new.final_quote_id := old.final_quote_id;
  end if;
  if new.status in ('closed','cancelled','declined') and old.status is distinct from new.status then new.ended_at := now();
  elsif new.status not in ('closed','cancelled','declined') then new.ended_at := null; end if;
  return new;
end $$;

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
    || '→ クライアントさんが「この金額で確定する」を押すと、確定の金額になります。');

  select user_id into cu from public.clients where id = p.client_id;
  perform public.notify_push(cu, 'quote_proposed',
    '【Eizo Maps】' || public.notify_name_creator(p.creator_id) || ' さんから見積もり（' || v || '回目）が届きました',
    public.notify_name_creator(p.creator_id) || ' さんから、案件「' || p.title || '」の見積もり（' || v || '回目）が届きました。' || chr(10)
      || '金額：' || to_char(p_amount, 'FM999,999,999,999') || '円（税込）' || cur_txt || chr(10) || chr(10)
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
      '【見積もりを見送り】' || q.version || '回目の見積もりは見送りました。' || coalesce(chr(10) || '理由：' || p_reason, ''));
    perform public.notify_push(ku, 'quote_declined', '【Eizo Maps】見積もり（' || q.version || '回目）が見送られました',
      public.notify_name_client(p.client_id) || ' さんが、案件「' || p.title || '」の見積もり（' || q.version || '回目）を見送りました。'
        || coalesce(chr(10) || '理由：' || p_reason, '') || chr(10) || chr(10) || 'メッセージで相談して、必要なら出し直してください。', '/projects/?id=' || p.id);
  else
    raise exception '使えない返事です';
  end if;
  return p_action;
end $$;
revoke all on function public.quote_decide(uuid, text, text) from public, anon;
grant execute on function public.quote_decide(uuid, text, text) to authenticated;
