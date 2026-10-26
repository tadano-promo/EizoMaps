-- =====================================================================
-- 027 利用規約違反のアカウントを止める（一発停止）＋登録し直しを防ぐ（2026-10-25）
--   タキさん：「1発アウト＋ブラックリスト入り(虚偽クリエイター)」「うん。作ろう！」
--   ・管理者が止めると：ログインできなくなる（Supabase の利用停止）、今のログインも切れる、
--     プロフィール・作品は誰にも見えなくなる（データは証拠として残す）
--   ・同じメールアドレス／同じ Google アカウント／同じ @ハンドルでは、クリエイターとして登録し直せない
--     （運営の中だけの記録。値そのものではなく、元に戻せない形＝指紋で持つ）
--   ・解除もできる（誤りが分かったとき）。記録は消さずに「解除した」と残す
--   ・外に出すのは「利用規約違反により停止しています」の一文だけ。理由の中身は出さない
--   ※ 「消す」系の命令は使わない（ログインの切断も、消さずに無効の印を付ける形）
--   ※ 安全案：ログインの仕組み（auth）の表には、仕掛け（トリガー）を付けない
-- =====================================================================

alter table public.creators add column if not exists suspended boolean not null default false;

create table if not exists public.account_suspensions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  creator_id    uuid references public.creators(id) on delete set null,
  display_name  text,
  reason        text not null check (reason in ('false_works','impersonation','fraud','other')),
  note          text not null check (char_length(note) between 5 and 4000),
  evidence      text check (evidence is null or char_length(evidence) <= 4000),
  suspended_by  uuid,
  suspended_at  timestamptz not null default now(),
  lifted_at     timestamptz,
  lifted_by     uuid,
  lifted_note   text check (lifted_note is null or char_length(lifted_note) <= 2000)
);
alter table public.account_suspensions enable row level security;
alter table public.account_suspensions force row level security;
revoke all on public.account_suspensions from anon, authenticated;
grant select, insert, update on public.account_suspensions to service_role;

create table if not exists public.blocked_identities (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('email','google','handle')),
  fingerprint    text not null,
  suspension_id  uuid not null references public.account_suspensions(id) on delete cascade,
  created_at     timestamptz not null default now()
);
alter table public.blocked_identities enable row level security;
alter table public.blocked_identities force row level security;
revoke all on public.blocked_identities from anon, authenticated;
grant select, insert on public.blocked_identities to service_role;
create index if not exists idx_blocked_identities on public.blocked_identities (kind, fingerprint);

-- 指紋（元に戻せない形）
create or replace function public.identity_fingerprint(p_kind text, p_value text)
returns text
language sql
immutable
set search_path to ''
as $$
  select encode(extensions.digest(p_kind || ':' || lower(btrim(coalesce(p_value, ''))), 'sha256'), 'hex');
$$;
revoke execute on function public.identity_fingerprint(text, text) from public, anon, authenticated;

-- いま止めている（解除していない）指紋か
create or replace function public.identity_is_blocked(p_kind text, p_value text)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select p_value is not null and btrim(p_value) <> '' and exists (
    select 1 from public.blocked_identities b
    join public.account_suspensions s on s.id = b.suspension_id
    where b.kind = p_kind and b.fingerprint = public.identity_fingerprint(p_kind, p_value)
      and s.lifted_at is null
  );
$$;
revoke execute on function public.identity_is_blocked(text, text) from public, anon, authenticated;

-- 登録し直しを防ぐ（安全案・10/25 タキさん「安全案でお願い！」）
--   ログインの仕組み（auth）そのものには手を入れない。
--   止めた人と同じメールアドレス／Google アカウントのアカウントでは、クリエイターのプロフィールを作れない・公開できない
create or replace function public.user_is_blocked(p_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select exists (select 1 from auth.users u where u.id = p_user_id and public.identity_is_blocked('email', u.email))
      or exists (select 1 from auth.identities i where i.user_id = p_user_id and i.provider = 'google'
                   and public.identity_is_blocked('google', i.provider_id));
$$;
revoke execute on function public.user_is_blocked(uuid) from public, anon, authenticated;

-- @ハンドルの使い回しを防ぐ・止めた人が自分で公開に戻せないようにする
create or replace function public.creators_suspension_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.handle is not null and (tg_op = 'INSERT' or new.handle is distinct from old.handle)
     and public.identity_is_blocked('handle', new.handle) then
    raise exception 'この @ハンドルは使えません';
  end if;
  if (tg_op = 'INSERT' or (new.is_published and not old.is_published))
     and not public.is_admin() and public.user_is_blocked(new.user_id) then
    raise exception 'このアカウントではクリエイターとして登録・公開できません（利用規約違反による停止）';
  end if;
  if tg_op = 'UPDATE' and old.suspended and not public.is_admin()
     and coalesce(current_setting('eizo.suspend', true), '') <> 'on' then
    if new.suspended is distinct from old.suspended or (new.is_published and not old.is_published) then
      raise exception 'このアカウントは停止中です';
    end if;
  end if;
  if tg_op = 'INSERT' then new.suspended := false; end if;
  if tg_op = 'UPDATE' and new.suspended is distinct from old.suspended
     and not public.is_admin() and coalesce(current_setting('eizo.suspend', true), '') <> 'on' then
    new.suspended := old.suspended;
  end if;
  return new;
end;
$$;
revoke execute on function public.creators_suspension_guard() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_creators_suspension_guard') then
    create trigger trg_creators_suspension_guard before insert or update on public.creators
      for each row execute function public.creators_suspension_guard();
  end if;
end $$;

-- 運営：止める
create or replace function public.admin_suspend_creator(p_creator_id uuid, p_reason text, p_note text, p_evidence text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  c record;
  u record;
  sid uuid;
  g record;
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  select id, user_id, display_name, handle into c from public.creators where id = p_creator_id;
  if c.id is null then raise exception 'クリエイターが見つかりません'; end if;
  if c.user_id = auth.uid() then raise exception '自分自身は止められません'; end if;
  if exists (select 1 from public.app_admins where user_id = c.user_id) then raise exception '運営のアカウントは止められません'; end if;
  if p_note is null or char_length(btrim(p_note)) < 5 then raise exception '止める理由を5文字以上で書いてください'; end if;

  insert into public.account_suspensions (user_id, creator_id, display_name, reason, note, evidence, suspended_by)
  values (c.user_id, c.id, c.display_name, p_reason, btrim(p_note), nullif(btrim(coalesce(p_evidence, '')), ''), auth.uid())
  returning id into sid;

  select id, email into u from auth.users where id = c.user_id;
  if u.email is not null then
    insert into public.blocked_identities (kind, fingerprint, suspension_id) values ('email', public.identity_fingerprint('email', u.email), sid);
  end if;
  for g in select provider_id from auth.identities where user_id = c.user_id and provider = 'google' loop
    insert into public.blocked_identities (kind, fingerprint, suspension_id) values ('google', public.identity_fingerprint('google', g.provider_id), sid);
  end loop;
  if c.handle is not null then
    insert into public.blocked_identities (kind, fingerprint, suspension_id) values ('handle', public.identity_fingerprint('handle', c.handle), sid);
  end if;

  perform set_config('eizo.suspend', 'on', true);
  update public.creators set suspended = true, is_published = false where id = c.id;
  -- ストックページ・限定共有リンクも止める（解除しても自動では戻さない。本人が戻す）
  update public.stock_pages set is_active = false where creator_id = c.id;
  update public.share_links set is_active = false where creator_id = c.id;
  -- ログインできなくする・今のログインも切る
  update auth.users set banned_until = 'infinity' where id = c.user_id;
  -- 「ログインを続ける券」を無効にする（消さずに無効の印を付ける）。今の画面も最長1時間で切れる
  update auth.refresh_tokens set revoked = true where user_id = c.user_id::text and not revoked;
  return sid;
end;
$$;
revoke execute on function public.admin_suspend_creator(uuid, text, text, text) from public, anon;
grant execute on function public.admin_suspend_creator(uuid, text, text, text) to authenticated, service_role;

-- 運営：解除する（誤りが分かったとき）。公開に戻すかは本人が決める
create or replace function public.admin_lift_suspension(p_suspension_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare s record;
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  select * into s from public.account_suspensions where id = p_suspension_id and lifted_at is null;
  if s.id is null then raise exception 'この停止は見つからないか、すでに解除されています'; end if;
  update public.account_suspensions set lifted_at = now(), lifted_by = auth.uid(), lifted_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = s.id;
  if not exists (select 1 from public.account_suspensions where user_id = s.user_id and lifted_at is null) then
    perform set_config('eizo.suspend', 'on', true);
    update public.creators set suspended = false where user_id = s.user_id;
    update auth.users set banned_until = null where id = s.user_id;
  end if;
end;
$$;
revoke execute on function public.admin_lift_suspension(uuid, text) from public, anon;
grant execute on function public.admin_lift_suspension(uuid, text) to authenticated, service_role;

-- 運営：止めた記録の一覧
create or replace function public.admin_suspensions()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'creator_id', s.creator_id, 'display_name', s.display_name, 'reason', s.reason,
      'note', s.note, 'evidence', s.evidence, 'suspended_at', s.suspended_at,
      'lifted_at', s.lifted_at, 'lifted_note', s.lifted_note
    ) order by (s.lifted_at is null) desc, s.suspended_at desc), '[]'::jsonb)
    from public.account_suspensions s);
end;
$$;
revoke execute on function public.admin_suspensions() from public, anon;
grant execute on function public.admin_suspensions() to authenticated, service_role;

-- 誰でも：このクリエイターは停止中か（理由の中身は返さない）
create or replace function public.creator_suspended(p_creator_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select coalesce((select suspended from public.creators where id = p_creator_id), false);
$$;
grant execute on function public.creator_suspended(uuid) to anon, authenticated, service_role;

-- 運営の一覧に「停止中」を出す（026 までの内容に suspended を足しただけ）
create or replace function public.admin_list_creators()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare res jsonb;
begin
  if not public.is_admin() then raise exception '運営のみ利用できます'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into res from (
    select
      c.id, c.user_id, c.display_name, c.headline, c.area_pref, c.area_city,
      c.years_of_experience, c.is_published, c.suspended, c.contact_pref, c.created_at, c.updated_at,
      u.email,
      u.last_sign_in_at,
      (select coalesce(jsonb_agg(g.name_ja order by g.sort_order), '[]'::jsonb)
         from public.creator_genres cg join public.genres g on g.id = cg.genre_id
        where cg.creator_id = c.id) as genres,
      (select count(*) from public.portfolios p where p.creator_id = c.id) as works,
      (select count(*) from public.portfolios p where p.creator_id = c.id and p.visibility = 'public') as works_public,
      (select count(*) from public.portfolios p where p.creator_id = c.id and p.visibility = 'stock_only') as works_stock_only,
      (select sp.slug from public.stock_pages sp where sp.creator_id = c.id) as stock_slug,
      (select sp.is_active from public.stock_pages sp where sp.creator_id = c.id) as stock_active,
      (select count(*) from public.share_links s where s.creator_id = c.id) as share_links,
      (select count(*) from public.reviews r where r.reviewee_id = c.user_id and r.status = 'published') as reviews_public,
      (select round(avg(r.score)::numeric, 1) from public.reviews r where r.reviewee_id = c.user_id and r.status = 'published') as review_avg,
      (select count(*) from public.reviews r where r.reviewee_id = c.user_id and r.status = 'pending') as reviews_waiting
    from public.creators c
    left join auth.users u on u.id = c.user_id
  ) x;
  return res;
end;
$function$;
