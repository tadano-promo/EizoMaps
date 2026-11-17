-- =====================================================================
--  056: 依頼の流れを分かりやすく（2026-11-17 翠くん。実際に hirotokyo さんとやり取りして分かったこと）
--  翠くん「クリエイター側から金額の指定をしてもらえるもんだと思ってたけど、相談っていう風に来てたり」
--        「こちらから希望を出したものがそのまま返ってきただけなのか、向こうがその条件でそのまま返しただけなのか分かりづらい」
--  ・予算が「未定」の依頼には「この内容で受ける」ができない → クリエイターは金額を入れて「条件を提案する」で返す
--  ・金額が決まっていない（相談）ままでは「この条件で始める」ができない
--  ・やり取りに残る返事の文に、金額と納期を必ず書く（「希望のまま」か「変更あり」かも）
-- =====================================================================
create or replace function public.project_respond(
  p_project uuid, p_action text,
  p_amount integer default null, p_due date default null, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  p public.projects;
  amt_txt text; due_txt text;
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
    if p.budget_amount is null then
      raise exception '予算が「未定」の依頼なので、金額を入れて「条件を提案する」から返事をしてください';
    end if;
    update public.projects
       set status = 'proposed', terms_amount = p.budget_amount, terms_due_on = p.due_on,
           terms_note = p_note, terms_at = now()
     where id = p_project;
    p_amount := p.budget_amount; p_due := p.due_on;
  elsif p_action = 'propose' then
    if p_amount is null then
      raise exception '金額を入れてください（決めにくいときは、だいたいの金額と、中身の欄に「〇〇なら△△円」のように書いてください）';
    end if;
    if p_amount < 0 or p_amount > 1000000000 then raise exception '金額が正しくありません'; end if;
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

  amt_txt := coalesce(to_char(p_amount, 'FM999,999,999,999') || '円（税込）', '相談');
  due_txt := coalesce(to_char(p_due, 'YYYY/MM/DD'), '相談');
  insert into public.project_messages (project_id, sender_id, body)
  values (p_project, auth.uid(),
    case p_action
      when 'accept'  then '【返事】ご希望の条件のまま受けます。' || chr(10)
                          || '金額：' || amt_txt || chr(10) || '納期：' || due_txt
                          || coalesce(chr(10) || 'ひとこと：' || p_note, '') || chr(10)
                          || '→ クライアントさんが「この条件で始める」を押すと、仕事が始まります。'
      when 'propose' then '【条件の提案】' || chr(10)
                          || '金額：' || amt_txt
                          || case when p.budget_amount is null then '（ご予算：未定）'
                                  when p.budget_amount = p_amount then '（ご予算のまま）'
                                  else '（ご予算 ' || to_char(p.budget_amount, 'FM999,999,999,999') || '円から変更）' end || chr(10)
                          || '納期：' || due_txt
                          || case when p.due_on is null or p_due is null then ''
                                  when p.due_on = p_due then '（ご希望のまま）'
                                  else '（ご希望 ' || to_char(p.due_on, 'YYYY/MM/DD') || ' から変更）' end
                          || coalesce(chr(10) || '中身：' || p_note, '') || chr(10)
                          || '→ クライアントさんが「この条件で始める」を押すと、仕事が始まります。'
      else '【返事】今回はお断りします。' || coalesce(chr(10) || p_note, '')
    end);
  return (select status from public.projects where id = p_project);
end;
$$;

create or replace function public.project_start(p_project uuid)
returns text language plpgsql security definer set search_path = '' as $$
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
  if p.terms_amount is null then
    raise exception '金額がまだ決まっていません。メッセージで相談して、クリエイターに金額を入れた条件を出し直してもらってください';
  end if;
  update public.projects set status = 'in_progress' where id = p_project;
  insert into public.project_messages (project_id, sender_id, body)
  values (p_project, auth.uid(), '【開始】この条件で始めます。' || chr(10)
    || '金額：' || to_char(p.terms_amount, 'FM999,999,999,999') || '円（税込）' || chr(10)
    || '納期：' || coalesce(to_char(p.terms_due_on, 'YYYY/MM/DD'), '相談'));
  return 'in_progress';
end;
$$;

revoke all on function public.project_respond(uuid, text, integer, date, text) from public, anon;
revoke all on function public.project_start(uuid) from public, anon;
grant execute on function public.project_respond(uuid, text, integer, date, text) to authenticated;
grant execute on function public.project_start(uuid) to authenticated;
