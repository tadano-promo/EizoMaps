-- =====================================================================
-- 021 スケジュール3回目：自分で作る案件と、相手ごとの共有リンク（2026-10-18）
--
--   10/18 タキさんの決定
--   1. 案件は自分で名前を付けて作れる（例：「◯◯CM」）。依頼フォームの案件とは別に持つ
--   2. 共有リンクは相手ごとに分けられる（例：「クライアント用」「撮影部用」）。
--      リンクごとにパスワードと見せる範囲を持つ。1本だけ止めることもできる
--   3. 見せる範囲は班（列）ごとに選ぶ。大枠はどのリンクでも必ず見える
--   4. 場所・メモを見せるかはリンクごとに選ぶ。最初はオフ
--   5. 期限：案件の最後の日から30日後に自動で見られなくなる。延ばす・すぐ止めるもできる
--   6. 見た人は見るだけ（書き込みはできない）
--
--   ★ 安全の考え方
--     ・案件・共有リンクの表は、本人以外は1行も読めない
--     ・パスワードは bcrypt で保存し、誰にも読ませない（列ごと権限を渡さない）
--     ・リンクを開くのは専用の処理だけ。合言葉（token）とパスワードの両方が合ったときだけ中身を返す
--       リンクが無い・止めた・期限切れ・パスワード違いは、すべて同じ「開けません」にして推測させない
--     ・総当たり対策：同じ接続元は15分で10回まで、同じリンクは15分で200回まで（ストックページと同じ）
--   ※ 「消す・外す」系の命令は使わない（確認画面で止まるため）
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- 自分で作る案件 ----------
create table if not exists public.schedule_projects (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint schedule_projects_name_len check (char_length(btrim(name)) between 1 and 60)
);
create index if not exists idx_schedule_projects_owner on public.schedule_projects (owner_user_id);

alter table public.schedule_projects enable row level security;
alter table public.schedule_projects force row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'schedule_projects' and policyname = 'schedule_projects_own') then
    create policy schedule_projects_own on public.schedule_projects
      for all to authenticated
      using (owner_user_id = auth.uid())
      with check (owner_user_id = auth.uid());
  end if;
end $$;

grant select, delete on public.schedule_projects to authenticated;
grant insert (name) on public.schedule_projects to authenticated;
grant update (name) on public.schedule_projects to authenticated;

create or replace trigger trg_schedule_projects_updated_at
  before update on public.schedule_projects
  for each row execute function public.set_updated_at();

-- 1人が作れる案件は500まで
create or replace function public.schedule_projects_limit()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if (select count(*) from public.schedule_projects where owner_user_id = new.owner_user_id) >= 500 then
    raise exception '作れる案件は500件までです';
  end if;
  return new;
end;
$function$;

create or replace trigger trg_schedule_projects_limit
  before insert on public.schedule_projects
  for each row execute function public.schedule_projects_limit();

-- ---------- 予定（大枠）に「自分で作った案件」を付けられるようにする ----------
alter table public.schedule_events
  add column if not exists sched_project_id uuid references public.schedule_projects(id) on delete set null;
create index if not exists idx_schedule_events_sched_project on public.schedule_events (sched_project_id);

grant insert (sched_project_id) on public.schedule_events to authenticated;
grant update (sched_project_id) on public.schedule_events to authenticated;

-- 他人の案件には付けられない（予定の持ち主と案件の持ち主が同じときだけ）
create or replace function public.schedule_events_check_sched_project()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.sched_project_id is not null and not exists (
       select 1 from public.schedule_projects p
        where p.id = new.sched_project_id and p.owner_user_id = new.owner_user_id) then
    raise exception 'この案件には予定を付けられません';
  end if;
  return new;
end;
$function$;

create or replace trigger trg_schedule_events_check_sched_project
  before insert or update of sched_project_id on public.schedule_events
  for each row execute function public.schedule_events_check_sched_project();

-- ---------- 共有リンク ----------
create table if not exists public.schedule_shares (
  id               uuid primary key default gen_random_uuid(),
  sched_project_id uuid not null references public.schedule_projects(id) on delete cascade,
  owner_user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label            text not null,
  token            text not null unique,
  password_hash    text not null,
  all_lanes        boolean not null default false,   -- これから増える班も含めて全部見せる
  lanes            text[]  not null default '{}',    -- 見せる班（all_lanes が false のとき）
  show_details     boolean not null default false,   -- 場所・メモも見せる
  expires_on       date,                             -- 空なら「案件の最後の日から30日後」
  revoked_at       timestamptz,                      -- 止めた日時
  view_count       int not null default 0,
  last_viewed_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint schedule_shares_label_len check (char_length(btrim(label)) between 1 and 40),
  constraint schedule_shares_lanes_len check (cardinality(lanes) <= 100)
);
create index if not exists idx_schedule_shares_project on public.schedule_shares (sched_project_id);
create index if not exists idx_schedule_shares_owner   on public.schedule_shares (owner_user_id);

alter table public.schedule_shares enable row level security;
alter table public.schedule_shares force row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'schedule_shares' and policyname = 'schedule_shares_select_own') then
    create policy schedule_shares_select_own on public.schedule_shares
      for select to authenticated using (owner_user_id = auth.uid());
  end if;
end $$;

-- 読めるのはパスワード以外の列だけ。書き込みは専用の処理だけ
grant select (id, sched_project_id, owner_user_id, label, token, all_lanes, lanes, show_details,
              expires_on, revoked_at, view_count, last_viewed_at, created_at, updated_at)
  on public.schedule_shares to authenticated;

create or replace trigger trg_schedule_shares_updated_at
  before update on public.schedule_shares
  for each row execute function public.set_updated_at();

-- ---------- 開こうとした記録（総当たり対策）。誰にも読ませない ----------
create table if not exists public.schedule_share_access_log (
  id           bigserial primary key,
  share_id     uuid references public.schedule_shares(id) on delete cascade,
  ip_hash      text not null,
  ok           boolean not null,
  attempted_at timestamptz not null default now()
);
alter table public.schedule_share_access_log enable row level security;
alter table public.schedule_share_access_log force row level security;
create index if not exists idx_schedule_share_log_ip    on public.schedule_share_access_log (ip_hash, attempted_at desc);
create index if not exists idx_schedule_share_log_share on public.schedule_share_access_log (share_id, attempted_at desc);

-- ---------- 期限の計算（空なら案件の最後の日＋30日。予定がなければ作った日＋30日） ----------
create or replace function public.schedule_share_expiry(p_share_id uuid)
returns date language sql stable security definer set search_path to '' as $function$
  select coalesce(
    s.expires_on,
    (select max(e.ends_on) from public.schedule_events e where e.sched_project_id = s.sched_project_id) + 30,
    (s.created_at at time zone 'Asia/Tokyo')::date + 30)
  from public.schedule_shares s
  where s.id = p_share_id;
$function$;

-- ---------- 共有リンクを作る ----------
create or replace function public.create_schedule_share(
  p_project_id uuid, p_label text, p_password text,
  p_all_lanes boolean, p_lanes text[], p_show_details boolean, p_expires_on date)
returns jsonb language plpgsql volatile security definer set search_path to '' as $function$
declare
  tok text;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if not exists (select 1 from public.schedule_projects where id = p_project_id and owner_user_id = auth.uid()) then
    raise exception 'この案件の共有リンクは作れません';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 40 then
    raise exception 'リンクの名前は1〜40文字で入れてください（例：クライアント用）';
  end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'パスワードは6文字以上72文字以下で設定してください';
  end if;
  if (select count(*) from public.schedule_shares where sched_project_id = p_project_id) >= 30 then
    raise exception '1つの案件に作れる共有リンクは30本までです';
  end if;

  -- 推測できない合言葉（24文字）
  tok := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');

  insert into public.schedule_shares
    (sched_project_id, owner_user_id, label, token, password_hash, all_lanes, lanes, show_details, expires_on)
  values
    (p_project_id, auth.uid(), btrim(p_label), tok,
     extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
     coalesce(p_all_lanes, false),
     coalesce((select array_agg(distinct btrim(x)) from unnest(coalesce(p_lanes, '{}')) x where btrim(x) <> ''), '{}'),
     coalesce(p_show_details, false), p_expires_on)
  returning id into new_id;

  return jsonb_build_object('id', new_id, 'token', tok);
end;
$function$;

-- ---------- 共有リンクの設定を変える（パスワードは空なら今のまま） ----------
create or replace function public.update_schedule_share(
  p_share_id uuid, p_label text, p_password text,
  p_all_lanes boolean, p_lanes text[], p_show_details boolean, p_expires_on date)
returns void language plpgsql volatile security definer set search_path to '' as $function$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if not exists (select 1 from public.schedule_shares where id = p_share_id and owner_user_id = auth.uid()) then
    raise exception 'この共有リンクは変えられません';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 40 then
    raise exception 'リンクの名前は1〜40文字で入れてください（例：クライアント用）';
  end if;
  if p_password is not null and p_password <> ''
     and (char_length(p_password) < 6 or char_length(p_password) > 72) then
    raise exception 'パスワードは6文字以上72文字以下で設定してください';
  end if;

  update public.schedule_shares
     set label        = btrim(p_label),
         all_lanes    = coalesce(p_all_lanes, false),
         lanes        = coalesce((select array_agg(distinct btrim(x)) from unnest(coalesce(p_lanes, '{}')) x where btrim(x) <> ''), '{}'),
         show_details = coalesce(p_show_details, false),
         expires_on   = p_expires_on,
         password_hash = case when p_password is not null and p_password <> ''
                              then extensions.crypt(p_password, extensions.gen_salt('bf', 10))
                              else password_hash end
   where id = p_share_id and owner_user_id = auth.uid();
end;
$function$;

-- ---------- 止める／また使えるようにする ----------
create or replace function public.set_schedule_share_stopped(p_share_id uuid, p_stopped boolean)
returns void language plpgsql volatile security definer set search_path to '' as $function$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  update public.schedule_shares
     set revoked_at = case when p_stopped then now() else null end
   where id = p_share_id and owner_user_id = auth.uid();
  if not found then
    raise exception 'この共有リンクは変えられません';
  end if;
end;
$function$;

-- ---------- 自分の共有リンクの一覧（期限の計算つき） ----------
create or replace function public.my_schedule_shares(p_project_id uuid)
returns table (id uuid, label text, token text, all_lanes boolean, lanes text[], show_details boolean,
               expires_on date, effective_expiry date, revoked_at timestamptz,
               view_count int, last_viewed_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path to '' as $function$
  select s.id, s.label, s.token, s.all_lanes, s.lanes, s.show_details,
         s.expires_on, public.schedule_share_expiry(s.id), s.revoked_at,
         s.view_count, s.last_viewed_at, s.created_at
    from public.schedule_shares s
   where s.sched_project_id = p_project_id and s.owner_user_id = auth.uid()
   order by s.created_at;
$function$;

-- ---------- 共有リンクを開く（登録していない相手も使う） ----------
create or replace function public.open_schedule_share(p_token text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path to '' as $function$
declare
  sh       record;
  raw_ip   text;
  iph      text;
  fails_ip int;
  fails_sh int;
  matched  boolean := false;
  pj_name  text;
  owner_nm text;
  evs      jsonb;
  its      jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,64}$' then
    return null;
  end if;

  begin
    raw_ip := split_part(
      coalesce(
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip',
        'unknown'),
      ',', 1);
  exception when others then
    raw_ip := 'unknown';
  end;
  iph := encode(extensions.digest(coalesce(btrim(raw_ip), 'unknown'), 'sha256'), 'hex');

  if raw_ip is not null and btrim(raw_ip) <> '' and btrim(raw_ip) <> 'unknown' then
    select count(*) into fails_ip
      from public.schedule_share_access_log
     where ip_hash = iph and not ok and attempted_at > now() - interval '15 minutes';
    if fails_ip >= 10 then
      raise exception '認証の失敗が続いたため、しばらく開けません。15分ほど時間をおいてからお試しください。';
    end if;
  end if;

  select * into sh from public.schedule_shares where token = p_token;

  if sh.id is not null then
    select count(*) into fails_sh
      from public.schedule_share_access_log
     where share_id = sh.id and not ok and attempted_at > now() - interval '15 minutes';
    if fails_sh >= 200 then
      raise exception '認証の失敗が続いたため、しばらく開けません。15分ほど時間をおいてからお試しください。';
    end if;
  end if;

  if sh.id is not null and sh.revoked_at is null
     and public.schedule_share_expiry(sh.id) >= (now() at time zone 'Asia/Tokyo')::date
     and p_password is not null
     and extensions.crypt(p_password, sh.password_hash) = sh.password_hash then
    matched := true;
  end if;

  insert into public.schedule_share_access_log (share_id, ip_hash, ok) values (sh.id, iph, matched);
  if random() < 0.02 then
    delete from public.schedule_share_access_log where attempted_at < now() - interval '2 days';
  end if;

  if not matched then
    return null;
  end if;

  update public.schedule_shares
     set view_count = view_count + 1, last_viewed_at = now()
   where id = sh.id;

  select name into pj_name from public.schedule_projects where id = sh.sched_project_id;
  select c.display_name into owner_nm from public.creators c where c.user_id = sh.owner_user_id;

  -- 大枠：どのリンクでも見える。場所・メモは「見せる」にしたリンクだけ
  select coalesce(jsonb_agg(x order by x.starts_on, x.start_time nulls first), '[]'::jsonb) into evs
  from (
    select e.id, e.kind, e.title, e.starts_on, e.ends_on, e.start_time, e.end_time,
           case when sh.show_details then e.location end as location,
           case when sh.show_details then e.note end as note
      from public.schedule_events e
     where e.sched_project_id = sh.sched_project_id
       and e.owner_user_id = sh.owner_user_id
     limit 500
  ) x;

  -- 小枠：選んだ班だけ（全部の班にしたリンクは全部）
  select coalesce(jsonb_agg(y order by y.day, y.start_min), '[]'::jsonb) into its
  from (
    select i.event_id, i.day, i.lane, i.title, i.start_min, i.end_min,
           case when sh.show_details then i.note end as note
      from public.schedule_items i
      join public.schedule_events e on e.id = i.event_id
     where e.sched_project_id = sh.sched_project_id
       and e.owner_user_id = sh.owner_user_id
       and (sh.all_lanes or i.lane = any (sh.lanes))
     limit 3000
  ) y;

  return jsonb_build_object(
    'project', pj_name,
    'label', sh.label,
    'owner', owner_nm,
    'show_details', sh.show_details,
    'expires_on', public.schedule_share_expiry(sh.id),
    'events', evs,
    'items', its
  );
end;
$function$;

grant execute on function public.create_schedule_share(uuid, text, text, boolean, text[], boolean, date) to authenticated;
grant execute on function public.update_schedule_share(uuid, text, text, boolean, text[], boolean, date) to authenticated;
grant execute on function public.set_schedule_share_stopped(uuid, boolean) to authenticated;
grant execute on function public.my_schedule_shares(uuid) to authenticated;
grant execute on function public.open_schedule_share(text, text) to anon, authenticated;
