-- =====================================================================
-- 010 評価の仕組み v2（2026-10-12）
-- ---------------------------------------------------------------------
-- 決めたこと（タキさん）
-- ・Eizo Maps の外で完了した取引も評価できる。自己申告＋運営が確認してから公開。
--   公開時は「Eizo Maps外の取引（自己申告）」と区別して表示する。
-- ・書かれた本人ができるのは「異議申し立て」だけ。
-- ・異議申し立て中の評価は表示したまま「本人から異議申し立てあり」の印を付ける。
-- ・異議申し立てがあった評価を消せるのは
--     ① 書いた本人（取り下げ）
--     ② 運営が「あまりにも不適切」と判断したとき
-- ・運営が確認して削除しなかった評価には「異議申し立てあり・運営の確認により掲載継続」
--   の印を付けて公開し続ける（ごまかしを防ぐため）。
-- ・その後、本人から説明があり運営が「やはり削除」と判断した場合は、あとから削除に変えられる。
-- ・消した評価は表に出さないだけで、記録としては残す（status で管理）。
--
-- このファイルは「表・関数・公開ビュー」。権限（grant / policy）は
-- 010b_reviews_v2_permissions.sql に分けている。
-- 何度実行しても同じ結果になる。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. reviews：外の取引に対応
-- ---------------------------------------------------------------------
alter table public.reviews alter column project_id drop not null;

alter table public.reviews
  add column if not exists source text not null default 'platform';
alter table public.reviews drop constraint if exists reviews_source_check;
alter table public.reviews
  add constraint reviews_source_check check (source in ('platform', 'external'));

-- 外の取引の概要（案件名・時期など）。運営の確認用で、公開しない
alter table public.reviews add column if not exists external_note text;
alter table public.reviews drop constraint if exists reviews_external_note_check;
alter table public.reviews
  add constraint reviews_external_note_check
  check (external_note is null or char_length(external_note) between 5 and 300);

alter table public.reviews drop constraint if exists reviews_source_shape;
alter table public.reviews
  add constraint reviews_source_shape check (
    (source = 'platform' and project_id is not null and external_note is null)
    or (source = 'external' and project_id is null and external_note is not null)
  );

-- 状態：pending（確認待ち）/ published（公開）/ rejected（運営が不掲載）
--       withdrawn（書いた本人が取り下げ）/ removed（運営が削除）
alter table public.reviews drop constraint if exists reviews_status_check;
alter table public.reviews
  add constraint reviews_status_check
  check (status in ('pending', 'published', 'rejected', 'withdrawn', 'removed'));

alter table public.reviews add column if not exists closed_at timestamptz;

-- 外の取引の評価は、同じ相手に1人1件まで
create unique index if not exists uq_reviews_external_once
  on public.reviews (reviewer_id, reviewee_id) where source = 'external';

-- 投稿資格のチェック（RLS が万一緩んでも通さない）
create or replace function public.check_review_eligibility()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p record;
  v_creator_user uuid;
  v_client_user  uuid;
begin
  if new.source = 'external' then
    if new.project_id is not null then
      raise exception 'Eizo Maps 外の取引の評価に案件は指定できません';
    end if;
    if new.reviewer_id = new.reviewee_id then
      raise exception '自分自身は評価できません';
    end if;
    if not exists (
      select 1 from public.creators c
       where c.user_id = new.reviewee_id and c.is_published
    ) then
      raise exception '評価できるのは公開中のクリエイターだけです';
    end if;
    new.reviewer_role := 'client';
  else
    select * into p from public.projects where id = new.project_id;
    if p is null then
      raise exception '案件が見つかりません';
    end if;
    if p.status not in ('delivered','paid','closed') then
      raise exception '納品済み以降の案件のみ評価できます';
    end if;

    select user_id into v_creator_user from public.creators where id = p.creator_id;
    select user_id into v_client_user  from public.clients  where id = p.client_id;

    if new.reviewer_role = 'client' then
      if new.reviewer_id <> v_client_user or new.reviewee_id <> v_creator_user then
        raise exception '評価の当事者が案件と一致しません';
      end if;
    else
      if new.reviewer_id <> v_creator_user or new.reviewee_id <> v_client_user then
        raise exception '評価の当事者が案件と一致しません';
      end if;
    end if;
  end if;

  new.status := 'pending';
  new.published_at := null;
  new.closed_at := null;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. 異議申し立て
-- ---------------------------------------------------------------------
create table if not exists public.review_objections (
  id           uuid primary key default gen_random_uuid(),
  review_id    uuid not null unique references public.reviews(id) on delete cascade,
  reviewee_id  uuid not null references auth.users(id) on delete cascade,
  reason       text not null check (char_length(reason) between 10 and 2000),
  status       text not null default 'open'
               check (status in ('open', 'kept', 'removed', 'withdrawn')),
  admin_note   text check (admin_note is null or char_length(admin_note) <= 1000),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
alter table public.review_objections enable row level security;
alter table public.review_objections force row level security;

-- 書かれた本人が、公開中の評価に異議を申し立てる
create or replace function public.object_to_review(p_review_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  select * into r from public.reviews where id = p_review_id;
  if r is null or r.reviewee_id <> auth.uid() then
    raise exception 'この評価には異議を申し立てられません';
  end if;
  if r.status <> 'published' then
    raise exception '公開中の評価だけが対象です';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 or char_length(p_reason) > 2000 then
    raise exception '理由は10文字以上2000文字以下で書いてください';
  end if;
  if exists (select 1 from public.review_objections where review_id = p_review_id) then
    raise exception 'この評価にはすでに異議申し立てがあります';
  end if;
  insert into public.review_objections (review_id, reviewee_id, reason)
  values (p_review_id, auth.uid(), btrim(p_reason));
end;
$$;

-- 書いた本人が取り下げる（確認待ちの間、または異議申し立て中のときだけ）
create or replace function public.withdraw_review(p_review_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; has_open boolean;
begin
  if auth.uid() is null then raise exception 'ログインが必要です'; end if;
  select * into r from public.reviews where id = p_review_id;
  if r is null or r.reviewer_id <> auth.uid() then
    raise exception 'この評価は取り下げられません';
  end if;
  select exists (
    select 1 from public.review_objections
     where review_id = p_review_id and status = 'open'
  ) into has_open;
  if not (r.status = 'pending' or (r.status = 'published' and has_open)) then
    raise exception '取り下げられるのは、確認待ちの評価か、異議申し立てがあった評価だけです';
  end if;
  update public.reviews set status = 'withdrawn', closed_at = now() where id = p_review_id;
  update public.review_objections set status = 'withdrawn', resolved_at = now()
   where review_id = p_review_id and status = 'open';
end;
$$;

-- ---------------------------------------------------------------------
-- 3. 運営用
-- ---------------------------------------------------------------------
-- 確認待ちの評価と、未対応の異議申し立てをまとめて返す
create or replace function public.admin_review_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pend jsonb; objs jsonb; kept jsonb;
begin
  if not public.is_admin() then raise exception '運営のみ利用できます'; end if;

  select coalesce(jsonb_agg(x order by x.created_at), '[]'::jsonb) into pend from (
    select r.id, r.source, r.score, r.comment, r.external_note, r.reviewer_role, r.created_at,
           coalesce(cw.display_name, uw.display_name, '（名前未設定）') as reviewer_name,
           coalesce(ct.display_name, ut.display_name, '（名前未設定）') as reviewee_name
      from public.reviews r
      left join public.creators cw on cw.user_id = r.reviewer_id
      left join public.users    uw on uw.id      = r.reviewer_id
      left join public.creators ct on ct.user_id = r.reviewee_id
      left join public.users    ut on ut.id      = r.reviewee_id
     where r.status = 'pending'
  ) x;

  select coalesce(jsonb_agg(y order by y.created_at), '[]'::jsonb) into objs from (
    select o.id, o.review_id, o.reason, o.created_at,
           r.source, r.score, r.comment, r.external_note, r.published_at,
           coalesce(ct.display_name, ut.display_name, '（名前未設定）') as reviewee_name
      from public.review_objections o
      join public.reviews r on r.id = o.review_id
      left join public.creators ct on ct.user_id = r.reviewee_id
      left join public.users    ut on ut.id      = r.reviewee_id
     where o.status = 'open'
  ) y;

  select coalesce(jsonb_agg(z order by z.resolved_at desc), '[]'::jsonb) into kept from (
    select o.id, o.review_id, o.reason, o.admin_note, o.created_at, o.resolved_at,
           r.source, r.score, r.comment, r.external_note, r.published_at,
           coalesce(ct.display_name, ut.display_name, '（名前未設定）') as reviewee_name
      from public.review_objections o
      join public.reviews r on r.id = o.review_id
      left join public.creators ct on ct.user_id = r.reviewee_id
      left join public.users    ut on ut.id      = r.reviewee_id
     where o.status = 'kept' and r.status = 'published'
  ) z;

  return jsonb_build_object('pending', pend, 'objections', objs, 'kept', kept);
end;
$$;

-- 確認待ちの評価を「公開」または「不掲載」にする
create or replace function public.admin_decide_review(p_review_id uuid, p_publish boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '運営のみ利用できます'; end if;
  update public.reviews
     set status       = case when p_publish then 'published' else 'rejected' end,
         published_at = case when p_publish then now() else null end,
         closed_at    = case when p_publish then null else now() end
   where id = p_review_id and status = 'pending';
  if not found then raise exception '確認待ちの評価が見つかりません'; end if;
end;
$$;

-- 異議申し立てへの判断
--   p_remove = true  … 「あまりにも不適切」として評価を削除
--   p_remove = false … 掲載継続（公開ビューに「運営の確認により掲載継続」の印が出る）
--   掲載継続にしたもの（kept）も、あとから削除に変えられる（本人から説明があった場合など）
create or replace function public.admin_resolve_objection(p_objection_id uuid, p_remove boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  if not public.is_admin() then raise exception '運営のみ利用できます'; end if;
  select * into o from public.review_objections where id = p_objection_id
     and (status = 'open' or (status = 'kept' and p_remove));
  if o is null then raise exception '対応できる異議申し立てが見つかりません'; end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'メモは1000文字までです';
  end if;
  update public.review_objections
     set status = case when p_remove then 'removed' else 'kept' end,
         admin_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), admin_note),
         resolved_at = now()
   where id = p_objection_id;
  if p_remove then
    update public.reviews set status = 'removed', closed_at = now() where id = o.review_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. 公開ビュー：取引の種類・「異議申し立て中」・「掲載継続」の印を足す
--    （列は末尾に追加。取引の概要 external_note は公開しない）
-- ---------------------------------------------------------------------
create or replace view public.public_reviews
with (security_barrier = true) as
select
  r.id,
  r.reviewee_id,
  r.reviewer_role,
  r.score,
  r.comment,
  r.published_at,
  r.source,
  exists (
    select 1 from public.review_objections o
     where o.review_id = r.id and o.status = 'open'
  ) as objected,
  exists (
    select 1 from public.review_objections o
     where o.review_id = r.id and o.status = 'kept'
  ) as objection_kept
from public.reviews r
where r.status = 'published';
