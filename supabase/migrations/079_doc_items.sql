-- 079: 書類に明細（内訳）を入れられるように（2026-11-22 翠くん「1から作っていきましょう」）
--   p_items：[{name, qty, unit, unit_price}, …]（20行まで・単価は税込）。合計が書類の金額とぴったり合わないと作れない
--   明細を入れないときは、今までどおり「案件名（種類） 1式」の1行
--   古い5つの引数の関数は消して、6つ目に p_items を足した関数に置きかえる（呼び方があいまいにならないように）
drop function if exists public.doc_issue(uuid, text, uuid, text, boolean);
create or replace function public.doc_issue(p_project uuid, p_type text, p_quote uuid default null, p_note text default null, p_include_payout boolean default true, p_items jsonb default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare p public.projects; role text; q public.project_quotes; me uuid := auth.uid();
        cl public.clients; cr public.creators; prof public.doc_profiles; other_prof public.doc_profiles;
        amt integer; due date; title text; sub text; tax integer; excl integer; wh integer := 0; rule public.tax_rules; today date;
        num text; seq integer; recipient jsonb; issuer jsonb; payout jsonb := null; pay public.project_payouts; did uuid; data jsonb; other_uid uuid;
        items jsonb; it jsonb; i_name text; i_unit text; i_qty numeric; i_price bigint; i_amt bigint; i_sum bigint := 0;
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

  -- 明細（内訳）：1行ずつ「内容・数量・単位・単価（税込）」。合計は書類の金額とぴったり合うこと（2026-11-22）
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    if jsonb_array_length(p_items) > 20 then raise exception '明細は20行までです'; end if;
    items := '[]'::jsonb;
    for it in select * from jsonb_array_elements(p_items) loop
      i_name := btrim(coalesce(it->>'name', ''));
      i_unit := nullif(btrim(coalesce(it->>'unit', '')), '');
      begin
        i_qty := (it->>'qty')::numeric; i_price := (it->>'unit_price')::bigint;
      exception when others then raise exception '明細の数量・単価は数字で入れてください'; end;
      if i_name = '' then raise exception '明細の内容が空の行があります'; end if;
      if char_length(i_name) > 60 then raise exception '明細の内容は1行60文字までです'; end if;
      if i_unit is not null and char_length(i_unit) > 6 then raise exception '単位は6文字までです（例：式・本・日・人）'; end if;
      if i_qty is null or i_qty <= 0 or i_qty > 9999 then raise exception '数量は0より大きく、9999までにしてください'; end if;
      if i_price is null or i_price < 0 or i_price > 999999999 then raise exception '単価は0円以上で入れてください'; end if;
      i_amt := round(i_qty * i_price);
      i_sum := i_sum + i_amt;
      items := items || jsonb_build_array(jsonb_build_object('name', i_name, 'qty', i_qty, 'unit', i_unit, 'unit_price', i_price, 'amount', i_amt));
    end loop;
    if i_sum <> amt then
      raise exception '明細の合計（%円）が、書類の金額（%円・税込）と合いません。あと %円 です', to_char(i_sum, 'FM999,999,999,999'), to_char(amt, 'FM999,999,999,999'), to_char(amt - i_sum, 'FM999,999,999,999');
    end if;
  else
    items := jsonb_build_array(jsonb_build_object('name', p.title || coalesce('（' || p.kind || '）', ''), 'qty', 1, 'unit', '式', 'unit_price', amt, 'amount', amt));
  end if;

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
    'items', items,
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
revoke all on function public.doc_issue(uuid, text, uuid, text, boolean, jsonb) from public, anon;
grant execute on function public.doc_issue(uuid, text, uuid, text, boolean, jsonb) to authenticated;
