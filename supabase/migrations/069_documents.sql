-- =====================================================================
--  069: 書類（見積書・発注書・納品書・請求書）（2026-11-18 翠くん）
--  ・税の決まり（源泉徴収の率・境目・欄の名前）は tax_rules に「いつから使うか」付きで持つ。画面やプログラムに直接書かない
--      2027-01-01 から防衛特別所得税が加わる（合計の率 10.21%・20.42% は同じ、欄の名前が変わる）を先に入れておく
--      出典：国税庁「源泉徴収のあらまし 令和8年版」第5、タックスアンサー No.2795
--  ・源泉徴収するかは、支払う側のクライアントが選ぶ（する／しない／分からない）
--  ・書類は出した時点の中身で固定（data）して記録。2人とも見られる。金額はデータベースの記録から作る（画面から金額は受け取らない）
--  ・請求書に書いた振込先は、入金済み・完了・キャンセルで消す（振込先の決まりと同じ）
-- =====================================================================
create table if not exists public.tax_rules (
  id             bigserial primary key,
  kind           text not null check (kind in ('withholding')),
  effective_from date not null,
  rate_low       numeric(6,3) not null,     -- 境目まで（%）
  rate_high      numeric(6,3) not null,     -- 境目を超えた部分（%）
  threshold      integer not null,          -- 境目（円）
  label          text not null,             -- 書類に出す欄の名前
  source         text not null,
  checked_at     date not null default current_date,
  unique (kind, effective_from)
);
alter table public.tax_rules enable row level security;
drop policy if exists tax_rules_read on public.tax_rules;
create policy tax_rules_read on public.tax_rules for select to anon, authenticated using (true);
revoke all on public.tax_rules from anon, authenticated;
grant select on public.tax_rules to anon, authenticated;
insert into public.tax_rules (kind, effective_from, rate_low, rate_high, threshold, label, source) values
 ('withholding', '2013-01-01', 10.21, 20.42, 1000000, '源泉徴収税額（所得税及び復興特別所得税）', '国税庁 源泉徴収のあらまし 令和8年版 第5／タックスアンサー No.2795'),
 ('withholding', '2027-01-01', 10.21, 20.42, 1000000, '源泉徴収税額（所得税、復興特別所得税及び防衛特別所得税）', '国税庁 タックスアンサー No.2795（令和9年分以後は防衛特別所得税も源泉徴収）')
on conflict (kind, effective_from) do nothing;

-- 書類に載せる自分の情報（本人だけが見られる。書類を出すときに、その時点の中身を書類に写す）
create table if not exists public.doc_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  address     text check (address is null or char_length(address) <= 200),
  invoice_no  text check (invoice_no is null or invoice_no ~ '^T[0-9]{13}$'),
  phone       text check (phone is null or char_length(phone) <= 30),
  email       text check (email is null or char_length(email) <= 100),
  stamp_data  text check (stamp_data is null or (stamp_data like 'data:image/png;base64,%' and char_length(stamp_data) <= 400000)),
  updated_at  timestamptz not null default now()
);
alter table public.doc_profiles enable row level security;
drop policy if exists doc_profiles_own on public.doc_profiles;
create policy doc_profiles_own on public.doc_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.doc_profiles from anon, authenticated;
grant select, insert, update, delete on public.doc_profiles to authenticated;

-- 源泉徴収するか（クライアントが選ぶ）
alter table public.projects add column if not exists withholding text not null default 'unknown';
alter table public.projects drop constraint if exists projects_withholding_check;
alter table public.projects add constraint projects_withholding_check check (withholding in ('yes','no','unknown'));

create or replace function public.stamp_project_ended() returns trigger
language plpgsql set search_path to '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.ended_at := old.ended_at; new.files_notice_at := old.files_notice_at; new.files_deleted_at := old.files_deleted_at;
    new.final_amount := old.final_amount; new.final_due_on := old.final_due_on; new.final_at := old.final_at; new.final_quote_id := old.final_quote_id;
    new.rules_version := old.rules_version; new.rules_agreed_at := old.rules_agreed_at; new.withholding := old.withholding;
  end if;
  if new.status in ('closed','cancelled','declined') and old.status is distinct from new.status then new.ended_at := now();
  elsif new.status not in ('closed','cancelled','declined') then new.ended_at := null; end if;
  return new;
end $$;

create or replace function public.withholding_set(p_project uuid, p_value text)
returns void language plpgsql security definer set search_path to '' as $$
declare p public.projects; ku uuid;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'client' then raise exception '源泉徴収するかを選べるのは、支払うクライアントさんだけです'; end if;
  if p_value not in ('yes','no','unknown') then raise exception '選び方が正しくありません'; end if;
  if p.withholding = p_value then return; end if;
  if exists (select 1 from public.project_documents d where d.project_id = p_project and d.doc_type = 'invoice' and d.voided_at is null) then
    raise exception 'もう請求書が出ています。変えるときは、クリエイターさんにメッセージで伝えて、請求書を出し直してもらってください';
  end if;
  update public.projects set withholding = p_value where id = p_project;
  insert into public.project_messages (project_id, sender_id, body) values (p_project, auth.uid(),
    '【源泉徴収】' || case p_value when 'yes' then 'この案件のお支払いでは、源泉徴収をします。請求書に源泉徴収の額を入れてください。'
                               when 'no' then 'この案件のお支払いでは、源泉徴収をしません。'
                               else '源泉徴収をするか、いま確かめています。' end);
  select user_id into ku from public.creators where id = p.creator_id;
  perform public.notify_push(ku, 'withholding_set', '【Eizo Maps】源泉徴収について返事がありました',
    public.notify_name_client(p.client_id) || ' さんが、案件「' || p.title || '」の源泉徴収を「' || case p_value when 'yes' then 'する' when 'no' then 'しない' else '確認中' end || '」にしました。', '/projects/?id=' || p.id);
end $$;
revoke all on function public.withholding_set(uuid, text) from public, anon;
grant execute on function public.withholding_set(uuid, text) to authenticated;

-- 出した書類（その時点の中身で固定）
create table if not exists public.project_documents (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  doc_type    text not null check (doc_type in ('quote','order','delivery','invoice')),
  number      text not null unique,
  issued_by   uuid not null references auth.users(id),
  issued_at   timestamptz not null default now(),
  quote_id    uuid references public.project_quotes(id),
  data        jsonb not null,
  voided_at   timestamptz
);
create index if not exists project_documents_project_idx on public.project_documents(project_id, issued_at);
alter table public.project_documents enable row level security;
drop policy if exists project_documents_select on public.project_documents;
create policy project_documents_select on public.project_documents for select to authenticated using (public.is_project_party(project_id));
revoke all on public.project_documents from anon, authenticated;
grant select on public.project_documents to authenticated;

-- 書類を出す
create or replace function public.doc_issue(p_project uuid, p_type text, p_quote uuid default null, p_note text default null, p_include_payout boolean default true)
returns uuid language plpgsql security definer set search_path to '' as $$
declare p public.projects; role text; q public.project_quotes; me uuid := auth.uid();
        cl public.clients; cr public.creators; prof public.doc_profiles; other_prof public.doc_profiles;
        amt integer; due date; title text; sub text; tax integer; excl integer; wh integer := 0; rule public.tax_rules; today date;
        num text; seq integer; recipient jsonb; issuer jsonb; payout jsonb := null; pay public.project_payouts; did uuid; data jsonb; other_uid uuid;
begin
  select * into p from public.projects where id = p_project;
  if not found then raise exception 'この案件は見つかりません'; end if;
  role := public.project_my_role(p_project);
  if role is null then raise exception 'この案件の書類は出せません'; end if;
  if p_type in ('quote','delivery','invoice') and role <> 'creator' then raise exception 'この書類を出せるのは、クリエイターだけです'; end if;
  if p_type = 'order' and role <> 'client' then raise exception '発注書を出せるのは、クライアントさんだけです'; end if;
  if p_type not in ('quote','order','delivery','invoice') then raise exception '書類の種類が正しくありません'; end if;
  select * into cl from public.clients where id = p.client_id;
  select * into cr from public.creators where id = p.creator_id;
  today := (now() at time zone 'Asia/Tokyo')::date;
  p_note := nullif(btrim(coalesce(p_note,'')), '');
  if p_note is not null and char_length(p_note) > 500 then raise exception '備考は500文字までです'; end if;

  if p_type = 'quote' then
    if p.status not in ('proposed','in_progress','delivered','paid','closed') then raise exception '条件を出したあとに作れます'; end if;
    if p_quote is not null then
      select * into q from public.project_quotes where id = p_quote and project_id = p_project;
      if not found then raise exception 'この見積もりは見つかりません'; end if;
      amt := q.amount; due := coalesce(q.due_on, coalesce(p.final_due_on, p.terms_due_on));
      title := '御見積書'; sub := q.version || '回目の見積もり' || case q.status when 'accepted' then '（確定）' when 'proposed' then '（確定待ち）' when 'declined' then '（見送り）' else '（取り下げ）' end;
    else
      amt := p.terms_amount; due := p.terms_due_on; title := '御見積書'; sub := '1回目の見積もり（始めたときの条件）';
    end if;
  else
    if p.status not in ('in_progress','delivered','paid','closed') then raise exception '仕事が始まってから作れます'; end if;
    if exists (select 1 from public.project_quotes where project_id = p_project and status = 'proposed') then raise exception '確定待ちの見積もりがあります。金額が確定してから作ってください'; end if;
    if exists (select 1 from public.project_pauses where project_id = p_project and ended_at is null) then raise exception '一時停止中です。金額が決まってから作ってください'; end if;
    amt := coalesce(p.final_amount, p.terms_amount); due := coalesce(p.final_due_on, p.terms_due_on);
    if p_type = 'order' then title := '発注書'; sub := case when p.final_at is not null then '確定した見積もりにもとづく発注' else '始めたときの条件にもとづく発注' end;
    elsif p_type = 'delivery' then
      if p.status not in ('delivered','paid','closed') then raise exception '「納品済み」にしてから作れます'; end if;
      title := '納品書'; sub := null;
    else
      title := '請求書'; sub := null;
      if p.withholding = 'unknown' then raise exception 'クライアントさんが「源泉徴収をするか」をまだ選んでいません。選んでもらってから作ってください'; end if;
    end if;
  end if;
  if amt is null then raise exception '金額が決まっていないので、書類を作れません'; end if;

  -- 消費税（10%・税込の金額から、1枚につき1回だけ計算・1円未満切り捨て）
  tax := floor(amt * 10 / 110.0)::int; excl := amt - tax;
  -- 源泉徴収（請求書でクライアントが「する」を選んだとき。税抜の金額にかける）
  if p_type = 'invoice' and p.withholding = 'yes' then
    select * into rule from public.tax_rules where kind = 'withholding' and effective_from <= today order by effective_from desc limit 1;
    if excl <= rule.threshold then wh := floor(excl * rule.rate_low / 100)::int;
    else wh := floor((excl - rule.threshold) * rule.rate_high / 100 + rule.threshold * rule.rate_low / 100)::int; end if;
  end if;

  -- 出す人と、受け取る人
  select * into prof from public.doc_profiles where user_id = me;
  other_uid := case when role = 'creator' then cl.user_id else cr.user_id end;
  select * into other_prof from public.doc_profiles where user_id = other_uid;
  issuer := jsonb_build_object(
    'name', coalesce(prof.name, case when role = 'creator' then cr.display_name else coalesce(nullif(cl.company,''), cl.display_name) end),
    'address', prof.address, 'invoice_no', prof.invoice_no, 'phone', prof.phone, 'email', prof.email, 'stamp', prof.stamp_data);
  if role = 'creator' then
    recipient := case when nullif(cl.company,'') is not null then jsonb_build_object('name', coalesce(other_prof.name, cl.company), 'honorific', '御中')
                      else jsonb_build_object('name', coalesce(other_prof.name, cl.display_name), 'honorific', '様') end;
  else
    recipient := jsonb_build_object('name', coalesce(other_prof.name, cr.display_name), 'honorific', '様');
  end if;

  if p_type = 'invoice' and p_include_payout then
    select * into pay from public.project_payouts where project_id = p_project and wiped_at is null;
    if found then payout := jsonb_build_object('bank', pay.bank_name, 'branch', pay.branch_name, 'type', pay.account_type, 'number', pay.account_number, 'holder', pay.holder_kana); end if;
  end if;

  select count(*) + 1 into seq from public.project_documents where project_id = p_project and doc_type = p_type;
  num := case p_type when 'quote' then 'Q' when 'order' then 'PO' when 'delivery' then 'D' else 'INV' end
         || '-' || to_char(today, 'YYYYMMDD') || '-' || upper(left(replace(p_project::text, '-', ''), 6)) || '-' || lpad(seq::text, 2, '0');

  data := jsonb_build_object(
    'type', p_type, 'title', title, 'subtitle', sub, 'number', num, 'issued_on', today,
    'project_title', p.title, 'kind', p.kind,
    'issuer', issuer, 'recipient', recipient,
    'items', jsonb_build_array(jsonb_build_object('name', p.title || coalesce('（' || p.kind || '）', ''), 'qty', 1, 'amount', amt)),
    'total_incl', amt, 'tax_rate', 10, 'tax', tax, 'total_excl', excl,
    'withholding', case when p_type = 'invoice' then jsonb_build_object('choice', p.withholding, 'amount', wh, 'label', rule.label, 'rate_low', rule.rate_low, 'rate_high', rule.rate_high, 'threshold', rule.threshold) else null end,
    'payable', case when p_type = 'invoice' then amt - wh else null end,
    'due_on', due, 'delivered_on', case when p_type = 'delivery' then (p.delivered_at at time zone 'Asia/Tokyo')::date else null end,
    'note', p_note, 'payout', payout,
    'rules_version', p.rules_version
  );
  insert into public.project_documents (project_id, doc_type, number, issued_by, quote_id, data) values (p_project, p_type, num, me, p_quote, data) returning id into did;
  insert into public.project_messages (project_id, sender_id, body) values (p_project, me,
    '【' || title || 'を作りました】' || coalesce(sub || '・', '') || '番号 ' || num || chr(10)
    || '金額：' || to_char(amt, 'FM999,999,999,999') || '円（税込）'
    || case when p_type = 'invoice' and wh > 0 then chr(10) || '源泉徴収：' || to_char(wh, 'FM999,999,999') || '円 ／ お振込み額：' || to_char(amt - wh, 'FM999,999,999,999') || '円' else '' end || chr(10)
    || '案件のページの「書類」から、PDFでダウンロードできます。');
  perform public.notify_push(other_uid, 'doc_issued', '【Eizo Maps】' || title || 'が届きました',
    '案件「' || p.title || '」の' || title || '（番号 ' || num || '）が届きました。' || chr(10) || '案件のページの「書類」から、PDFでダウンロードできます。', '/projects/?id=' || p.id);
  return did;
end $$;
revoke all on function public.doc_issue(uuid, text, uuid, text, boolean) from public, anon;
grant execute on function public.doc_issue(uuid, text, uuid, text, boolean) to authenticated;

-- 入金済み・完了・キャンセルで、振込先（請求書に写したものも）を消す
create or replace function public.payout_wipe_on_end() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.status in ('paid','closed','cancelled') and old.status is distinct from new.status then
    update public.project_payouts set bank_name = null, branch_name = null, account_type = null, account_number = null, holder_kana = null, note = null, wiped_at = now()
     where project_id = new.id and wiped_at is null;
    update public.project_documents set data = (data - 'payout') || jsonb_build_object('payout_wiped', true)
     where project_id = new.id and data ? 'payout' and data->'payout' <> 'null'::jsonb;
  end if;
  return null;
end $$;
