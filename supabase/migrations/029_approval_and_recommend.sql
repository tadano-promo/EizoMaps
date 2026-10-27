-- =====================================================================
-- 029 クリエイターの「承認」と「他推（ほかの人のおすすめで仮のページ）」（2026-10-28）
--   タキさん 10/17 決定：「承認」「他推」の両方を作る
--   タキさん 10/28：「1やろう　すぐ」
--   10/28 タキさんの選択：
--     ・承認前は「活動名と職種だけ」表に出す（一覧にも出る。作品・自己紹介・評価は承認まで隠す）
--     ・仮のページは「公開・最小限」（活動名・職種・公開SNSのリンク・推薦のひとこと。「本人未確認」の印。本人から言われたらすぐ消す）
--     ・「あなたではありませんか？」は、SNSのURLが同じ人にマイページで知らせる
--     ・今公開しているクリエイターは承認済みにする
--   ※ 「消す」系の命令は使わない（作る・上書き・ポリシーの書きかえだけ）
-- =====================================================================

-- ---------- 1. 承認 ----------
alter table public.creators add column if not exists approved boolean not null default false;
alter table public.creators add column if not exists approved_at timestamptz;

-- 今いる人は承認済みにする（タキさん 10/28）
update public.creators set approved = true, approved_at = coalesce(approved_at, now()) where not approved;

-- 本人が自分で承認済みにできないようにする（運営だけが変えられる）
create or replace function public.creators_approval_guard()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if public.is_admin() or coalesce(current_setting('eizo.approve', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.approved := false; new.approved_at := null;
  elsif new.approved is distinct from old.approved or new.approved_at is distinct from old.approved_at then
    new.approved := old.approved; new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.creators_approval_guard() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_creators_approval_guard') then
    create trigger trg_creators_approval_guard before insert or update on public.creators
      for each row execute function public.creators_approval_guard();
  end if;
end $$;

-- 表に出してよいか：中身まで（承認済み）
create or replace function public.creator_is_published(p_creator_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select coalesce((select is_published and approved and not suspended from public.creators where id = p_creator_id), false);
$$;

-- 表に出してよいか：活動名と職種だけ（承認待ちもふくむ）
create or replace function public.creator_is_listed(p_creator_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select coalesce((select is_published and not suspended from public.creators where id = p_creator_id), false);
$$;
grant execute on function public.creator_is_listed(uuid) to anon, authenticated, service_role;

create or replace function public.portfolio_is_public(p_portfolio_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.portfolios p
    join public.creators c on c.id = p.creator_id
    where p.id = p_portfolio_id and p.visibility = 'public' and c.is_published and c.approved and not c.suspended
      and public.portfolio_released(p.release_on, p.takedown_hold)
  );
$$;

-- クリエイターの行（自己紹介などをふくむ）は、承認済みだけ誰でも読める
alter policy creators_select on public.creators
  using ((is_published and approved) or (user_id = auth.uid()) or public.is_my_project_creator(id) or public.is_admin());
-- 職種（ジャンル）は承認待ちでも出す
alter policy creator_genres_select on public.creator_genres
  using (public.creator_is_listed(creator_id) or public.owns_creator(creator_id));

-- @ハンドル：承認待ち・停止中の人も ID を返す（ページ側で「確認待ち」「停止中」を出すため）
create or replace function public.creator_id_by_handle(p_handle text)
returns uuid language sql stable security definer set search_path to ''
as $$
  select id from public.creators
   where handle = lower(trim(both '@' from coalesce(p_handle, '')))
     and (is_published or suspended)
   limit 1;
$$;

-- 承認待ちの一覧（活動名・職種・@ハンドルだけ）
create or replace function public.public_pending_creators()
returns jsonb language sql stable security definer set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'display_name', c.display_name, 'handle', c.handle,
      'genres', (select coalesce(jsonb_agg(g.name_ja order by g.sort_order), '[]'::jsonb)
                   from public.creator_genres cg join public.genres g on g.id = cg.genre_id where cg.creator_id = c.id),
      'genre_ids', (select coalesce(jsonb_agg(cg.genre_id), '[]'::jsonb) from public.creator_genres cg where cg.creator_id = c.id)
    ) order by c.created_at desc), '[]'::jsonb)
  from public.creators c
  where c.is_published and not c.approved and not c.suspended;
$$;
grant execute on function public.public_pending_creators() to anon, authenticated, service_role;

-- 承認待ちの人の1枚（プロフィールのページ用）
create or replace function public.creator_card(p_creator_id uuid)
returns jsonb language sql stable security definer set search_path to ''
as $$
  select case when c.id is null then null else jsonb_build_object(
      'id', c.id,
      'state', case when c.suspended then 'suspended' when not c.is_published then 'private'
                    when not c.approved then 'pending' else 'approved' end,
      'display_name', case when c.suspended or not c.is_published then null else c.display_name end,
      'handle', case when c.suspended or not c.is_published then null else c.handle end,
      'genres', case when c.suspended or not c.is_published then '[]'::jsonb else
                (select coalesce(jsonb_agg(g.name_ja order by g.sort_order), '[]'::jsonb)
                   from public.creator_genres cg join public.genres g on g.id = cg.genre_id where cg.creator_id = c.id) end
    ) end
  from (select 1) x left join public.creators c on c.id = p_creator_id;
$$;
grant execute on function public.creator_card(uuid) to anon, authenticated, service_role;

-- 運営：承認する／承認を取り消す
create or replace function public.admin_set_creator_approval(p_creator_id uuid, p_approved boolean)
returns void language plpgsql security definer set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  perform set_config('eizo.approve', 'on', true);
  update public.creators
     set approved = p_approved, approved_at = case when p_approved then now() else null end
   where id = p_creator_id;
  if not found then raise exception 'クリエイターが見つかりません'; end if;
end;
$$;
revoke execute on function public.admin_set_creator_approval(uuid, boolean) from public, anon;
grant execute on function public.admin_set_creator_approval(uuid, boolean) to authenticated, service_role;

-- 運営の一覧に承認の状態を足す
create or replace function public.admin_list_creators()
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare res jsonb;
begin
  if not public.is_admin() then raise exception '運営のみ利用できます'; end if;
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into res from (
    select
      c.id, c.user_id, c.display_name, c.headline, c.area_pref, c.area_city,
      c.years_of_experience, c.is_published, c.suspended, c.approved, c.approved_at, c.contact_pref, c.created_at, c.updated_at,
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

-- ---------- 2. 他推（ほかの人のおすすめで作る仮のページ） ----------
-- SNS の URL を比べやすい形にそろえる（例：https://www.Instagram.com/eizo/?hl=ja → instagram.com/eizo）
create or replace function public.normalize_sns_url(p_url text)
returns text language sql immutable set search_path to ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(btrim(coalesce(p_url, ''))), '^https?://', ''),
        '[?#].*$', ''),
      '^(www\.|m\.|mobile\.)', ''),
    '/+$', ''), '')
  ;
$$;
create or replace function public.sns_key(p_url text)
returns text language sql immutable set search_path to ''
as $$
  select regexp_replace(regexp_replace(public.normalize_sns_url(p_url), '^twitter\.com/', 'x.com/'), '^threads\.net/', 'threads.com/');
$$;
grant execute on function public.normalize_sns_url(text) to anon, authenticated, service_role;
grant execute on function public.sns_key(text) to anon, authenticated, service_role;

create table if not exists public.recommended_creators (
  id                 uuid primary key default gen_random_uuid(),
  display_name       text not null check (char_length(btrim(display_name)) between 1 and 60),
  genre_ids          smallint[] not null default '{}',
  links              text[] not null check (cardinality(links) between 1 and 5),
  link_keys          text[] not null,
  comment            text check (comment is null or char_length(comment) <= 200),
  recommended_by     uuid not null,
  status             text not null default 'open' check (status in ('open','claimed','removed')),
  claimed_creator_id uuid references public.creators(id) on delete set null,
  removed_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.recommended_creators enable row level security;
alter table public.recommended_creators force row level security;
revoke all on public.recommended_creators from anon, authenticated;
grant select, insert, update on public.recommended_creators to service_role;
create index if not exists idx_recommended_keys on public.recommended_creators using gin (link_keys);

create table if not exists public.recommendation_claims (
  id            uuid primary key default gen_random_uuid(),
  rec_id        uuid not null references public.recommended_creators(id) on delete cascade,
  creator_id    uuid not null references public.creators(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','dismissed')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  unique (rec_id, creator_id)
);
alter table public.recommendation_claims enable row level security;
alter table public.recommendation_claims force row level security;
revoke all on public.recommendation_claims from anon, authenticated;
grant select, insert, update on public.recommendation_claims to service_role;

-- おすすめする（ログインした人だけ・1日5件まで）
create or replace function public.recommend_creator(p_name text, p_genre_ids smallint[], p_links text[], p_comment text)
returns uuid language plpgsql security definer set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  clean text[] := '{}';
  keys text[] := '{}';
  l text;
  k text;
  rid uuid;
begin
  if uid is null then raise exception 'ログインしてください'; end if;
  if (select count(*) from public.recommended_creators where recommended_by = uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'おすすめは1日5件までです。また明日お願いします';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then raise exception '活動名を入れてください'; end if;
  if char_length(btrim(p_name)) > 60 then raise exception '活動名は60文字までです'; end if;
  if p_comment is not null and char_length(btrim(p_comment)) > 200 then raise exception 'ひとことは200文字までです'; end if;
  foreach l in array coalesce(p_links, '{}') loop
    l := btrim(l);
    continue when l = '';
    if l !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/|$)' then raise exception 'URL は https:// から始まる形で入れてください：%', l; end if;
    if char_length(l) > 300 then raise exception 'URL が長すぎます'; end if;
    k := public.sns_key(l);
    if k = any(keys) then continue; end if;
    clean := clean || l; keys := keys || k;
  end loop;
  if cardinality(clean) = 0 then raise exception '公開されている SNS か作品のページの URL を1つ以上入れてください'; end if;
  if cardinality(clean) > 5 then raise exception 'URL は5つまでです'; end if;
  if exists (select 1 from public.recommended_creators r where r.status = 'open' and r.link_keys && keys) then
    raise exception 'この方のページは、すでにおすすめで作られています';
  end if;
  if exists (select 1 from public.creator_links cl join public.creators c on c.id = cl.creator_id
              where c.is_published and not c.suspended and public.sns_key(cl.url) = any(keys)) then
    raise exception 'この方は、すでに Eizo Maps に登録しています';
  end if;
  insert into public.recommended_creators (display_name, genre_ids, links, link_keys, comment, recommended_by)
  values (btrim(p_name), coalesce((select array_agg(distinct g) from unnest(coalesce(p_genre_ids,'{}')) g
                                    where g in (select id from public.genres)), '{}'),
          clean, keys, nullif(btrim(coalesce(p_comment, '')), ''), uid)
  returning id into rid;
  return rid;
end;
$$;
revoke execute on function public.recommend_creator(text, smallint[], text[], text) from public, anon;
grant execute on function public.recommend_creator(text, smallint[], text[], text) to authenticated, service_role;

-- 一覧（だれでも・最小限。おすすめした人は出さない）
create or replace function public.public_recommended_creators()
returns jsonb language sql stable security definer set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'display_name', r.display_name, 'genre_ids', to_jsonb(r.genre_ids),
      'genres', (select coalesce(jsonb_agg(g.name_ja order by g.sort_order), '[]'::jsonb) from public.genres g where g.id = any(r.genre_ids)),
      'created_at', r.created_at
    ) order by r.created_at desc), '[]'::jsonb)
  from public.recommended_creators r where r.status = 'open';
$$;
grant execute on function public.public_recommended_creators() to anon, authenticated, service_role;

-- 仮のページの1枚（だれでも）。まとめ済みなら行き先を返す
create or replace function public.recommended_creator_card(p_id uuid)
returns jsonb language sql stable security definer set search_path to ''
as $$
  select case
    when r.id is null or r.status = 'removed' then null
    when r.status = 'claimed' then jsonb_build_object('status', 'claimed', 'creator_id', r.claimed_creator_id,
                                    'handle', (select handle from public.creators where id = r.claimed_creator_id))
    else jsonb_build_object('status', 'open', 'id', r.id, 'display_name', r.display_name,
      'genres', (select coalesce(jsonb_agg(g.name_ja order by g.sort_order), '[]'::jsonb) from public.genres g where g.id = any(r.genre_ids)),
      'links', to_jsonb(r.links), 'comment', r.comment, 'created_at', r.created_at)
  end
  from (select 1) x left join public.recommended_creators r on r.id = p_id;
$$;
grant execute on function public.recommended_creator_card(uuid) to anon, authenticated, service_role;

-- 本人へのお知らせ：自分のプロフィールの SNS の URL と同じ仮のページ（「あなたではありませんか？」）
create or replace function public.my_recommendation_matches()
returns jsonb language sql stable security definer set search_path to ''
as $$
  with me as (select id from public.creators where user_id = auth.uid()),
  keys as (select public.sns_key(cl.url) k from public.creator_links cl join me on me.id = cl.creator_id)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'display_name', r.display_name, 'comment', r.comment, 'links', to_jsonb(r.links),
      'claim', (select status from public.recommendation_claims c where c.rec_id = r.id and c.creator_id = (select id from me))
    ) order by r.created_at desc), '[]'::jsonb)
  from public.recommended_creators r
  where r.status = 'open' and exists (select 1 from me)
    and r.link_keys && (select coalesce(array_agg(k), '{}') from keys)
    and not exists (select 1 from public.recommendation_claims c where c.rec_id = r.id and c.creator_id = (select id from me) and c.status in ('dismissed','rejected'));
$$;
revoke execute on function public.my_recommendation_matches() from public, anon;
grant execute on function public.my_recommendation_matches() to authenticated, service_role;

-- 本人：「これは私です」／「違います」
create or replace function public.answer_recommendation(p_rec_id uuid, p_is_me boolean)
returns void language plpgsql security definer set search_path to ''
as $$
declare cid uuid;
begin
  select id into cid from public.creators where user_id = auth.uid();
  if cid is null then raise exception 'さきにプロフィールを作ってください'; end if;
  if not exists (select 1 from public.recommended_creators where id = p_rec_id and status = 'open') then
    raise exception 'このページは見つからないか、すでにまとめられています';
  end if;
  insert into public.recommendation_claims (rec_id, creator_id, status)
  values (p_rec_id, cid, case when p_is_me then 'pending' else 'dismissed' end)
  on conflict (rec_id, creator_id) do update set status = excluded.status, created_at = now(), decided_at = null
    where public.recommendation_claims.status not in ('approved','rejected');
end;
$$;
revoke execute on function public.answer_recommendation(uuid, boolean) from public, anon;
grant execute on function public.answer_recommendation(uuid, boolean) to authenticated, service_role;

-- 運営：おすすめの一覧（名乗り出もふくむ）
create or replace function public.admin_recommendations()
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'display_name', r.display_name, 'links', to_jsonb(r.links), 'comment', r.comment,
      'status', r.status, 'created_at', r.created_at, 'removed_reason', r.removed_reason,
      'recommended_by', (select email from auth.users u where u.id = r.recommended_by),
      'claimed_creator', (select display_name from public.creators where id = r.claimed_creator_id),
      'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'creator_id', c.creator_id,
                    'creator_name', cr.display_name, 'created_at', c.created_at) order by c.created_at), '[]'::jsonb)
                   from public.recommendation_claims c join public.creators cr on cr.id = c.creator_id
                  where c.rec_id = r.id and c.status in ('pending','approved','rejected'))
    ) order by (r.status = 'open') desc, r.created_at desc), '[]'::jsonb)
    from public.recommended_creators r);
end;
$$;
revoke execute on function public.admin_recommendations() from public, anon;
grant execute on function public.admin_recommendations() to authenticated, service_role;

-- 運営：名乗り出を認める（仮のページを本人のページにまとめる）／認めない
create or replace function public.admin_decide_claim(p_claim_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path to ''
as $$
declare c record;
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  select * into c from public.recommendation_claims where id = p_claim_id and status = 'pending';
  if c.id is null then raise exception 'この名乗り出は見つからないか、すでに判断済みです'; end if;
  update public.recommendation_claims set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now() where id = c.id;
  if p_approve then
    update public.recommended_creators set status = 'claimed', claimed_creator_id = c.creator_id, updated_at = now() where id = c.rec_id;
    update public.recommendation_claims set status = 'rejected', decided_at = now() where rec_id = c.rec_id and id <> c.id and status = 'pending';
  end if;
end;
$$;
revoke execute on function public.admin_decide_claim(uuid, boolean) from public, anon;
grant execute on function public.admin_decide_claim(uuid, boolean) to authenticated, service_role;

-- 運営：仮のページを表から外す（本人から言われたとき・不適切なとき）。記録は残す
create or replace function public.admin_remove_recommendation(p_rec_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to ''
as $$
begin
  if not public.is_admin() then raise exception '権限がありません'; end if;
  update public.recommended_creators set status = 'removed', removed_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   where id = p_rec_id and status = 'open';
  if not found then raise exception 'このページは見つからないか、すでに外されています'; end if;
end;
$$;
revoke execute on function public.admin_remove_recommendation(uuid, text) from public, anon;
grant execute on function public.admin_remove_recommendation(uuid, text) to authenticated, service_role;
