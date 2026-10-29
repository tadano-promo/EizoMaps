-- 033: クリエイターへのメッセージ（DM）
--
-- 2026-10-30 翠くん：「お問い合わせボタンがマイページにあると絶対にそのクリエイターへの問い合わせだと思うだろうから、
--   本当にクリエイターへの問い合わせ用ボタンにしたい。DMを送れるみたいな」
--
-- ・送れるのはログインしている人だけ（いたずら・迷惑メッセージを防ぐため）
-- ・クリエイター1人と送る人1人で、やりとりは1本（スレッド）
-- ・送れる相手は、表に出ているクリエイター（公開・承認済み・停止していない）だけ。自分には送れない
-- ・送りすぎを防ぐ：新しい相手は1日10人まで、メッセージは1時間に30通まで
-- ・クリエイターは相手を「受け取らない」にできる。そのあと相手は送れない
-- ・中身を読めるのは、その2人と運営（問題の確認のため）だけ
-- ・書き込みはすべて下の関数を通す（表に直接は書けない）

create table if not exists public.dm_threads (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  creator_read_at timestamptz,
  sender_read_at timestamptz,
  blocked boolean not null default false,
  unique (creator_id, sender_id)
);
create index if not exists dm_threads_sender_idx on public.dm_threads(sender_id, last_message_at desc);
create index if not exists dm_threads_creator_idx on public.dm_threads(creator_id, last_message_at desc);

create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_thread_idx on public.dm_messages(thread_id, created_at);
create index if not exists dm_messages_sender_idx on public.dm_messages(sender_id, created_at desc);

alter table public.dm_threads enable row level security;
alter table public.dm_messages enable row level security;

create or replace function public.dm_can_see(p_thread_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dm_threads t
     where t.id = p_thread_id
       and (t.sender_id = auth.uid() or public.is_my_creator(t.creator_id) or public.is_admin())
  );
$$;
grant execute on function public.dm_can_see(uuid) to authenticated;

create policy dm_threads_select on public.dm_threads for select to authenticated
  using (sender_id = auth.uid() or public.is_my_creator(creator_id) or public.is_admin());
create policy dm_messages_select on public.dm_messages for select to authenticated
  using (public.dm_can_see(thread_id));

grant select on public.dm_threads, public.dm_messages to authenticated;

-- 送る（初めての相手なら、やりとりを作る）
create or replace function public.send_dm(p_creator_id uuid, p_body text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.dm_threads;
  body text := btrim(coalesce(p_body, ''));
begin
  if uid is null then raise exception 'ログインしてください'; end if;
  if char_length(body) < 1 or char_length(body) > 2000 then raise exception 'メッセージは1〜2000文字で書いてください'; end if;
  if not public.creator_is_published(p_creator_id) then raise exception 'このクリエイターには、いまメッセージを送れません'; end if;
  if exists (select 1 from public.creators c where c.id = p_creator_id and c.user_id = uid) then raise exception '自分にはメッセージを送れません'; end if;
  if exists (select 1 from public.creators c where c.user_id = uid and c.suspended) then raise exception 'いまメッセージを送れません'; end if;
  if (select count(*) from public.dm_messages m where m.sender_id = uid and m.created_at > now() - interval '1 hour') >= 30 then
    raise exception '短い時間に送りすぎています。しばらくしてから送ってください';
  end if;

  select * into t from public.dm_threads where creator_id = p_creator_id and sender_id = uid;
  if t.id is null then
    if (select count(*) from public.dm_threads x where x.sender_id = uid and x.created_at > now() - interval '1 day') >= 10 then
      raise exception '新しい相手に送れるのは1日10人までです';
    end if;
    insert into public.dm_threads(creator_id, sender_id, sender_read_at) values (p_creator_id, uid, now()) returning * into t;
  end if;
  if t.blocked then raise exception 'このクリエイターには、いまメッセージを送れません'; end if;

  insert into public.dm_messages(thread_id, sender_id, body) values (t.id, uid, body);
  update public.dm_threads set last_message_at = now(), sender_read_at = now() where id = t.id;
  return t.id;
end;
$$;

-- 返事をする（やりとりの中から。クリエイター側・送った人側のどちらも）
create or replace function public.reply_dm(p_thread_id uuid, p_body text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.dm_threads;
  mine_creator boolean;
  body text := btrim(coalesce(p_body, ''));
begin
  if uid is null then raise exception 'ログインしてください'; end if;
  if char_length(body) < 1 or char_length(body) > 2000 then raise exception 'メッセージは1〜2000文字で書いてください'; end if;
  select * into t from public.dm_threads where id = p_thread_id;
  if t.id is null then raise exception 'やりとりが見つかりません'; end if;
  mine_creator := exists (select 1 from public.creators c where c.id = t.creator_id and c.user_id = uid);
  if not (mine_creator or t.sender_id = uid) then raise exception 'やりとりが見つかりません'; end if;
  if t.blocked and not mine_creator then raise exception 'このクリエイターには、いまメッセージを送れません'; end if;
  if exists (select 1 from public.creators c where c.user_id = uid and c.suspended) then raise exception 'いまメッセージを送れません'; end if;
  if (select count(*) from public.dm_messages m where m.sender_id = uid and m.created_at > now() - interval '1 hour') >= 30 then
    raise exception '短い時間に送りすぎています。しばらくしてから送ってください';
  end if;
  insert into public.dm_messages(thread_id, sender_id, body) values (t.id, uid, body);
  if mine_creator then
    update public.dm_threads set last_message_at = now(), creator_read_at = now() where id = t.id;
  else
    update public.dm_threads set last_message_at = now(), sender_read_at = now() where id = t.id;
  end if;
end;
$$;

-- 読んだ印
create or replace function public.mark_dm_read(p_thread_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); t public.dm_threads;
begin
  select * into t from public.dm_threads where id = p_thread_id;
  if t.id is null then return; end if;
  if exists (select 1 from public.creators c where c.id = t.creator_id and c.user_id = uid) then
    update public.dm_threads set creator_read_at = now() where id = t.id;
  elsif t.sender_id = uid then
    update public.dm_threads set sender_read_at = now() where id = t.id;
  end if;
end;
$$;

-- 受け取らない（クリエイターだけ）
create or replace function public.block_dm(p_thread_id uuid, p_blocked boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.dm_threads t join public.creators c on c.id = t.creator_id
                  where t.id = p_thread_id and c.user_id = auth.uid()) then
    raise exception 'やりとりが見つかりません';
  end if;
  update public.dm_threads set blocked = coalesce(p_blocked, false) where id = p_thread_id;
end;
$$;

-- 自分のやりとりの一覧（相手の名前・最後のメッセージ・まだ読んでいないか）
-- 相手の名前：クリエイターならその活動名、依頼者なら会社名とお名前、どちらもなければ「Eizo Maps のユーザー」
create or replace function public.my_dm_threads()
returns table (id uuid, i_am text, other_name text, other_handle text, creator_id uuid, last_message_at timestamptz,
               last_body text, unread boolean, blocked boolean)
language sql stable security definer
set search_path = ''
as $$
  select t.id,
         case when c.user_id = auth.uid() then 'creator' else 'sender' end,
         case when c.user_id = auth.uid() then coalesce(
           (select c3.display_name from public.creators c3 where c3.user_id = t.sender_id and c3.is_published limit 1),
           (select coalesce(nullif(btrim(cl.company), '') || '　' || cl.display_name, cl.display_name) from public.clients cl where cl.user_id = t.sender_id limit 1),
           'Eizo Maps のユーザー') else c.display_name end,
         case when c.user_id = auth.uid() then (select c2.handle from public.creators c2 where c2.user_id = t.sender_id and c2.is_published limit 1) else c.handle end,
         t.creator_id, t.last_message_at,
         (select left(m.body, 80) from public.dm_messages m where m.thread_id = t.id order by m.created_at desc limit 1),
         exists (select 1 from public.dm_messages m where m.thread_id = t.id and m.sender_id <> auth.uid()
                  and m.created_at > coalesce(case when c.user_id = auth.uid() then t.creator_read_at else t.sender_read_at end, '-infinity'::timestamptz)),
         case when c.user_id = auth.uid() then t.blocked else false end
    from public.dm_threads t
    join public.creators c on c.id = t.creator_id
   where t.sender_id = auth.uid() or c.user_id = auth.uid()
   order by t.last_message_at desc
   limit 200;
$$;

-- まだ読んでいないやりとりの数（ヘッダーの印に使う）
create or replace function public.dm_unread_count()
returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(*)::int from public.my_dm_threads() x where x.unread;
$$;

grant execute on function public.send_dm(uuid, text) to authenticated;
grant execute on function public.reply_dm(uuid, text) to authenticated;
grant execute on function public.mark_dm_read(uuid) to authenticated;
grant execute on function public.block_dm(uuid, boolean) to authenticated;
grant execute on function public.my_dm_threads() to authenticated;
grant execute on function public.dm_unread_count() to authenticated;
