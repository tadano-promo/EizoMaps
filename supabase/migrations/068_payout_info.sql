-- =====================================================================
--  068: 振込先（2026-11-18 翠くん「入金済みで隠す」）
--  ・金額が決まったあと（進行中・納品済みで、確定待ちの見積もりも一時停止もないとき）、クリエイターが振込先を入れてクライアントさんに知らせる
--  ・見られるのは、その案件のクリエイター本人とクライアントさんだけ（運営も画面からは見ない）
--  ・「入金済み」「完了」「キャンセル」になったら、振込先の中身はデータベースから消す（知らせた日時だけ残す）
--  ・やり取りのメッセージとメールには口座番号を書かない（「振込先が届きました」だけ）
--  ・クリエイターは、自分用に振込先を保存できる（本人だけが見られる）
-- =====================================================================
create table if not exists public.project_payouts (
  project_id     uuid primary key references public.projects(id) on delete cascade,
  bank_name      text check (bank_name is null or char_length(bank_name) between 1 and 40),
  branch_name    text check (branch_name is null or char_length(branch_name) between 1 and 40),
  account_type   text check (account_type is null or account_type in ('普通','当座','貯蓄')),
  account_number text check (account_number is null or account_number ~ '^[0-9]{7}$'),
  holder_kana    text check (holder_kana is null or char_length(holder_kana) between 1 and 60),
  note           text check (note is null or char_length(note) <= 300),
  sent_at        timestamptz not null default now(),
  wiped_at       timestamptz
);
alter table public.project_payouts enable row level security;
revoke all on public.project_payouts from anon, authenticated;   -- 読み書きは下の関数だけ

create table if not exists public.creator_payout_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  bank_name      text not null check (char_length(bank_name) between 1 and 40),
  branch_name    text not null check (char_length(branch_name) between 1 and 40),
  account_type   text not null check (account_type in ('普通','当座','貯蓄')),
  account_number text not null check (account_number ~ '^[0-9]{7}$'),
  holder_kana    text not null check (char_length(holder_kana) between 1 and 60),
  updated_at     timestamptz not null default now()
);
alter table public.creator_payout_profiles enable row level security;
drop policy if exists payout_profile_own on public.creator_payout_profiles;
create policy payout_profile_own on public.creator_payout_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.creator_payout_profiles from anon, authenticated;
grant select, insert, update, delete on public.creator_payout_profiles to authenticated;

-- クリエイターが振込先を知らせる（もう一度送ると上書き）
create or replace function public.payout_send(p_project uuid, p_bank text, p_branch text, p_type text, p_number text, p_holder text, p_note text default null, p_save boolean default false)
returns void language plpgsql security definer set search_path to '' as $$
declare p public.projects; cu uuid; again boolean;
begin
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'この案件は見つかりません'; end if;
  if public.project_my_role(p_project) is distinct from 'creator' then raise exception '振込先を知らせられるのは、クリエイターだけです'; end if;
  if p.status not in ('in_progress','delivered') then raise exception '振込先を知らせられるのは、進行中か納品済みのあいだだけです'; end if;
  if coalesce(p.final_amount, p.terms_amount) is null then raise exception '金額が決まってから知らせてください'; end if;
  if exists (select 1 from public.project_quotes where project_id = p_project and status = 'proposed') then raise exception '確定待ちの見積もりがあります。金額が確定してから知らせてください'; end if;
  if exists (select 1 from public.project_pauses where project_id = p_project and ended_at is null) then raise exception '一時停止中です。金額が決まってから知らせてください'; end if;
  p_bank := btrim(coalesce(p_bank,'')); p_branch := btrim(coalesce(p_branch,'')); p_holder := btrim(coalesce(p_holder,''));
  p_number := regexp_replace(translate(coalesce(p_number,''), '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g');
  if p_bank = '' or p_branch = '' or p_holder = '' then raise exception '銀行名・支店名・口座の名義を入れてください'; end if;
  if p_type not in ('普通','当座','貯蓄') then raise exception '口座の種類を選んでください'; end if;
  if p_number !~ '^[0-9]{7}$' then raise exception '口座番号は7けたの数字で入れてください（ゆうちょ銀行は、振込用の店名・口座番号を入れてください）'; end if;
  again := exists (select 1 from public.project_payouts where project_id = p_project);
  insert into public.project_payouts (project_id, bank_name, branch_name, account_type, account_number, holder_kana, note, sent_at, wiped_at)
  values (p_project, p_bank, p_branch, p_type, p_number, p_holder, nullif(btrim(coalesce(p_note,'')), ''), now(), null)
  on conflict (project_id) do update set bank_name = excluded.bank_name, branch_name = excluded.branch_name, account_type = excluded.account_type,
    account_number = excluded.account_number, holder_kana = excluded.holder_kana, note = excluded.note, sent_at = now(), wiped_at = null;
  if p_save then
    insert into public.creator_payout_profiles (user_id, bank_name, branch_name, account_type, account_number, holder_kana, updated_at)
    values (auth.uid(), p_bank, p_branch, p_type, p_number, p_holder, now())
    on conflict (user_id) do update set bank_name = excluded.bank_name, branch_name = excluded.branch_name, account_type = excluded.account_type,
      account_number = excluded.account_number, holder_kana = excluded.holder_kana, updated_at = now();
  end if;
  -- メッセージとメールには口座番号を書かない
  insert into public.project_messages (project_id, sender_id, body) values (p_project, auth.uid(),
    '【振込先をお知らせしました】' || case when again then '（内容を直しました）' else '' end || chr(10)
    || 'お支払いの金額：' || to_char(coalesce(p.final_amount, p.terms_amount), 'FM999,999,999,999') || '円（税込）' || chr(10)
    || '振込先は、案件のページの「お支払い」に表示されています（見られるのはこの案件の2人だけ。入金済みになると消えます）。');
  select user_id into cu from public.clients where id = p.client_id;
  perform public.notify_push(cu, 'payout_sent', '【Eizo Maps】' || public.notify_name_creator(p.creator_id) || ' さんから振込先が届きました',
    public.notify_name_creator(p.creator_id) || ' さんから、案件「' || p.title || '」の振込先が届きました。' || chr(10)
      || 'お支払いの金額：' || to_char(coalesce(p.final_amount, p.terms_amount), 'FM999,999,999,999') || '円（税込）' || chr(10) || chr(10)
      || '振込先は、メールには書いていません。案件のページの「お支払い」で確かめてください。' || chr(10)
      || 'お振り込みが済んだら、「入金済みにする」を押してください。', '/projects/?id=' || p.id);
end $$;
revoke all on function public.payout_send(uuid, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.payout_send(uuid, text, text, text, text, text, text, boolean) to authenticated;

-- 振込先を見る（その案件の2人だけ。消したあとは知らせた日時だけ）
create or replace function public.payout_get(p_project uuid)
returns table (bank_name text, branch_name text, account_type text, account_number text, holder_kana text, note text, sent_at timestamptz, wiped_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select x.bank_name, x.branch_name, x.account_type, x.account_number, x.holder_kana, x.note, x.sent_at, x.wiped_at
    from public.project_payouts x
   where x.project_id = p_project and public.project_my_role(p_project) is not null;
$$;
revoke all on function public.payout_get(uuid) from public, anon;
grant execute on function public.payout_get(uuid) to authenticated;

-- 入金済み・完了・キャンセルで、振込先の中身を消す
create or replace function public.payout_wipe_on_end() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.status in ('paid','closed','cancelled') and old.status is distinct from new.status then
    update public.project_payouts set bank_name = null, branch_name = null, account_type = null, account_number = null, holder_kana = null, note = null, wiped_at = now()
     where project_id = new.id and wiped_at is null;
  end if;
  return null;
end $$;
drop trigger if exists trg_projects_payout_wipe on public.projects;
create trigger trg_projects_payout_wipe after update on public.projects for each row execute function public.payout_wipe_on_end();
