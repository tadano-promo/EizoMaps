-- =====================================================================
--  045 掲示板形式の募集（2026-11-15 翠くん）
--   ・クライアントが募集を出す（job_posts）。だれでも一覧で見られる（締め切りまで）
--   ・クリエイターが提案を送る（job_proposals）。見られるのは本人と募集を出した人だけ
--   ・クライアントが1人を選ぶ（choose_job_proposal）
--        → 案件ができる（状態は「条件の返事あり」＝ 044 の流れの③から）
--        → ほかの提案は「見送り」になる
--   ・依頼した人の名前は一覧には出さない（clients は公開しない決まり）
-- =====================================================================

create table if not exists public.job_posts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 100),
  description   text not null check (char_length(btrim(description)) between 10 and 4000),
  kind          text check (kind is null or char_length(kind) <= 30),
  genre_ids     smallint[] not null default '{}' check (cardinality(genre_ids) <= 5),
  area_pref     text check (area_pref is null or char_length(area_pref) <= 20),
  remote_ok     boolean not null default false,
  budget_amount integer check (budget_amount is null or (budget_amount >= 0 and budget_amount <= 1000000000)),
  due_on        date,
  closes_on     date not null,
  status        text not null default 'open' check (status in ('open','filled','closed')),
  filled_project_id uuid references public.projects(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.job_posts enable row level security;
alter table public.job_posts force row level security;
create index if not exists idx_job_posts_open on public.job_posts (status, closes_on, created_at desc);
create index if not exists idx_job_posts_client on public.job_posts (client_id, created_at desc);

drop trigger if exists trg_job_posts_updated_at on public.job_posts;
create trigger trg_job_posts_updated_at before update on public.job_posts
  for each row execute function public.set_updated_at();

create table if not exists public.job_proposals (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.job_posts(id) on delete cascade,
  creator_id    uuid not null references public.creators(id) on delete cascade,
  amount        integer check (amount is null or (amount >= 0 and amount <= 1000000000)),
  due_on        date,
  message       text not null check (char_length(btrim(message)) between 10 and 2000),
  portfolio_ids uuid[] not null default '{}' check (cardinality(portfolio_ids) <= 3),
  status        text not null default 'sent' check (status in ('sent','chosen','passed','withdrawn')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (post_id, creator_id)
);
alter table public.job_proposals enable row level security;
alter table public.job_proposals force row level security;
create index if not exists idx_job_proposals_post on public.job_proposals (post_id, created_at);
create index if not exists idx_job_proposals_creator on public.job_proposals (creator_id, created_at desc);

drop trigger if exists trg_job_proposals_updated_at on public.job_proposals;
create trigger trg_job_proposals_updated_at before update on public.job_proposals
  for each row execute function public.set_updated_at();

alter table public.projects
  add column if not exists job_post_id uuid references public.job_posts(id) on delete set null;

-- ---- 見てよい人を決める小さな関数 ----
create or replace function public.owns_job_post(p_post uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_posts jp join public.clients c on c.id = jp.client_id
                  where jp.id = p_post and c.user_id = auth.uid());
$$;
create or replace function public.proposed_to_job_post(p_post uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_proposals pr join public.creators c on c.id = pr.creator_id
                  where pr.post_id = p_post and c.user_id = auth.uid());
$$;
grant execute on function public.owns_job_post(uuid) to authenticated;
grant execute on function public.proposed_to_job_post(uuid) to authenticated;

-- ---- job_posts の見え方・書き方 ----
drop policy if exists job_posts_select on public.job_posts;
create policy job_posts_select on public.job_posts for select to anon, authenticated
  using ((status = 'open' and closes_on >= current_date)
         or client_id = public.my_client_id()
         or public.proposed_to_job_post(id)
         or public.is_admin());
drop policy if exists job_posts_insert on public.job_posts;
create policy job_posts_insert on public.job_posts for insert to authenticated
  with check (client_id = public.my_client_id());
drop policy if exists job_posts_update on public.job_posts;
create policy job_posts_update on public.job_posts for update to authenticated
  using (client_id = public.my_client_id()) with check (client_id = public.my_client_id());

revoke all on public.job_posts from anon, authenticated;
grant select on public.job_posts to anon, authenticated;
grant insert (client_id, title, description, kind, genre_ids, area_pref, remote_ok, budget_amount, due_on, closes_on)
  on public.job_posts to authenticated;
grant update (title, description, kind, genre_ids, area_pref, remote_ok, budget_amount, due_on, closes_on, status)
  on public.job_posts to authenticated;

-- 募集の決まり：出せるのは同時に10件まで／締め切りは今日〜60日後／
--   本人が変えられる状態は「募集中 → 締め切る」だけ（「決まった」は選ぶ関数だけが付ける）
create or replace function public.check_job_post()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.job_posts where client_id = new.client_id and status = 'open' and closes_on >= current_date) >= 10 then
      raise exception '募集中にできるのは10件までです。終わった募集を締め切ってから出してください';
    end if;
    new.status := 'open';
    new.filled_project_id := null;
  else
    if old.status <> 'open' and (new.title, new.description, new.kind, new.genre_ids, new.area_pref, new.remote_ok,
         new.budget_amount, new.due_on, new.closes_on) is distinct from
        (old.title, old.description, old.kind, old.genre_ids, old.area_pref, old.remote_ok,
         old.budget_amount, old.due_on, old.closes_on) then
      raise exception '終わった募集は書き換えられません';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'open' and new.status = 'closed')
       and coalesce(current_setting('em.job_choose', true), '') <> '1' then
      raise exception 'この募集の状態は変えられません';
    end if;
    if new.filled_project_id is distinct from old.filled_project_id
       and coalesce(current_setting('em.job_choose', true), '') <> '1' then
      raise exception 'この項目は変えられません';
    end if;
  end if;
  if new.closes_on is distinct from (case when tg_op = 'UPDATE' then old.closes_on end)
     and (new.closes_on < current_date or new.closes_on > current_date + 60) then
    raise exception '締め切りは、今日から60日後までの日にしてください';
  end if;
  if new.due_on is not null and new.due_on < new.closes_on then
    raise exception '希望納期は、締め切りより後の日にしてください';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_job_posts_check on public.job_posts;
create trigger trg_job_posts_check before insert or update on public.job_posts
  for each row execute function public.check_job_post();

-- 締め切ったら、まだ選ばれていない提案は「見送り」にする
create or replace function public.job_post_after_close()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and old.status = 'open' then
    perform set_config('em.job_choose', '1', true);
    update public.job_proposals set status = 'passed' where post_id = new.id and status = 'sent';
    perform set_config('em.job_choose', '', true);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_job_posts_after_close on public.job_posts;
create trigger trg_job_posts_after_close after update on public.job_posts
  for each row execute function public.job_post_after_close();

-- ---- job_proposals の見え方・書き方 ----
drop policy if exists job_proposals_select on public.job_proposals;
create policy job_proposals_select on public.job_proposals for select to authenticated
  using (creator_id = public.my_creator_id() or public.owns_job_post(post_id) or public.is_admin());
drop policy if exists job_proposals_insert on public.job_proposals;
create policy job_proposals_insert on public.job_proposals for insert to authenticated
  with check (creator_id = public.my_creator_id());
drop policy if exists job_proposals_update on public.job_proposals;
create policy job_proposals_update on public.job_proposals for update to authenticated
  using (creator_id = public.my_creator_id()) with check (creator_id = public.my_creator_id());

revoke all on public.job_proposals from anon, authenticated;
grant select on public.job_proposals to authenticated;
grant insert (post_id, creator_id, amount, due_on, message, portfolio_ids) on public.job_proposals to authenticated;
grant update (amount, due_on, message, portfolio_ids, status) on public.job_proposals to authenticated;

-- 提案の決まり：公開中のプロフィールが要る／募集中で締め切り前／自分の募集には出せない／
--   直せるのは「送った」のまま募集中のあいだだけ／本人が変えられる状態は「取り下げ」だけ／作品は自分の公開作品だけ
create or replace function public.check_job_proposal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  post public.job_posts;
  c public.creators;
begin
  select * into post from public.job_posts where id = new.post_id;
  select * into c from public.creators where id = new.creator_id;
  if coalesce(current_setting('em.job_choose', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if not coalesce(c.is_published, false) or coalesce(c.suspended, false) then
      raise exception '提案を送るには、プロフィールを公開してください';
    end if;
    if exists (select 1 from public.clients cl where cl.id = post.client_id and cl.user_id = c.user_id) then
      raise exception '自分の募集には提案できません';
    end if;
    new.status := 'sent';
  else
    if new.post_id is distinct from old.post_id or new.creator_id is distinct from old.creator_id then
      raise exception 'この項目は変えられません';
    end if;
    if old.status <> 'sent' then raise exception 'この提案はもう変えられません'; end if;
    if new.status is distinct from old.status and new.status <> 'withdrawn' then
      raise exception 'この提案の状態は変えられません';
    end if;
  end if;
  -- 取り下げは、締め切りのあとでもできる
  if tg_op = 'UPDATE' and new.status = 'withdrawn' then return new; end if;
  if post.status <> 'open' or post.closes_on < current_date then
    raise exception 'この募集は締め切られています';
  end if;
  if new.due_on is not null and new.due_on < current_date then
    raise exception '納期が過ぎた日になっています';
  end if;
  if cardinality(new.portfolio_ids) > 0 and exists (
       select 1 from unnest(new.portfolio_ids) pid
        where not exists (select 1 from public.portfolios pf
                           where pf.id = pid and pf.creator_id = new.creator_id and pf.visibility = 'public')) then
    raise exception '見てほしい作品は、自分の公開中の作品から選んでください';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_job_proposals_check on public.job_proposals;
create trigger trg_job_proposals_check before insert or update on public.job_proposals
  for each row execute function public.check_job_proposal();

-- ---- 1人を選ぶ ----
create or replace function public.choose_job_proposal(p_proposal uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.job_proposals;
  post public.job_posts;
  new_id uuid;
begin
  select * into pr from public.job_proposals where id = p_proposal for update;
  if not found then raise exception 'この提案は見つかりません'; end if;
  select * into post from public.job_posts where id = pr.post_id for update;
  if not public.owns_job_post(post.id) then raise exception '選べるのは、募集を出した人だけです'; end if;
  if post.status <> 'open' then raise exception 'この募集はもう終わっています'; end if;
  if post.closes_on < current_date - 30 then raise exception '締め切りから30日を過ぎた募集では選べません'; end if;
  if pr.status <> 'sent' then raise exception 'この提案は選べません（取り下げ・見送りずみ）'; end if;

  perform set_config('em.job_choose', '1', true);
  insert into public.projects (client_id, creator_id, title, description, kind, status, budget_amount, due_on,
                               terms_amount, terms_due_on, terms_note, terms_at, origin, job_post_id)
  values (post.client_id, pr.creator_id, post.title, post.description, post.kind, 'proposed', post.budget_amount, post.due_on,
          pr.amount, pr.due_on, left(pr.message, 1000), now(), 'board', post.id)
  returning id into new_id;

  update public.job_proposals set status = 'chosen' where id = pr.id;
  update public.job_proposals set status = 'passed' where post_id = post.id and id <> pr.id and status = 'sent';
  update public.job_posts set status = 'filled', filled_project_id = new_id where id = post.id;
  perform set_config('em.job_choose', '', true);

  insert into public.project_messages (project_id, sender_id, body)
  values (new_id, auth.uid(), '【募集から】この提案を選びました。条件を確かめて、よければ「この条件で始める」を押します。');
  return new_id;
end;
$$;
revoke all on function public.choose_job_proposal(uuid) from public, anon;
grant execute on function public.choose_job_proposal(uuid) to authenticated;

-- 募集ごとの提案の数（一覧に「提案 3件」と出す用。中身は見せない）
create or replace function public.job_post_counts(p_posts uuid[])
returns table (post_id uuid, proposals integer)
language sql stable security definer set search_path = '' as $$
  select jp.id, (select count(*)::int from public.job_proposals pr where pr.post_id = jp.id and pr.status <> 'withdrawn')
    from public.job_posts jp
   where jp.id = any (p_posts)
     and ((jp.status = 'open' and jp.closes_on >= current_date) or public.owns_job_post(jp.id));
$$;
grant execute on function public.job_post_counts(uuid[]) to anon, authenticated;
