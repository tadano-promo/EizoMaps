-- =====================================================================
--  084: メッセージに「いいね」（2026-11-29 翠くん「いいねの機能とかは嬉しいね」）
--  きっかけ：相手がお知らせメールに Gmail の 👍 で返していた（Eizo Maps には届かない）。
--  「了解しました」だけ伝えたいときに、Eizo Maps の中で押せるようにする。
--  ・案件のメッセージ（project）と、ダイレクトメッセージ（dm）の両方
--  ・押せるのは相手のメッセージだけ（自分のには押せない）。もう一度押すと取り消し
--  ・お知らせのメールは送らない（いいねのたびにメールが届くとうるさいため）
-- =====================================================================
create table if not exists public.message_likes (
  kind       text not null check (kind in ('project','dm')),
  message_id uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kind, message_id, user_id)
);
alter table public.message_likes enable row level security;
alter table public.message_likes force row level security;
revoke all on public.message_likes from anon, authenticated;
-- 読み書きは下の関数からだけ（直接は触れない）

-- そのメッセージを見られる人か・送った人はだれか
create or replace function public.message_like_target(p_kind text, p_message uuid)
returns table(sender uuid, can_see boolean)
language sql stable security definer set search_path = '' as $$
  select m.sender_id, public.is_project_party(m.project_id)
    from public.project_messages m where p_kind = 'project' and m.id = p_message
  union all
  select m.sender_id, public.dm_can_see(m.thread_id)
    from public.dm_messages m where p_kind = 'dm' and m.id = p_message;
$$;
revoke all on function public.message_like_target(text, uuid) from public, anon, authenticated;

-- 押す・取り消す（戻り値：押した状態なら true）
create or replace function public.toggle_message_like(p_kind text, p_message uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  if p_kind not in ('project','dm') then raise exception '使えない種類です'; end if;
  select * into t from public.message_like_target(p_kind, p_message);
  if not found or not t.can_see then raise exception 'このメッセージは見つかりません'; end if;
  if t.sender = auth.uid() then raise exception '自分のメッセージには、いいねできません'; end if;
  if exists (select 1 from public.message_likes where kind = p_kind and message_id = p_message and user_id = auth.uid()) then
    delete from public.message_likes where kind = p_kind and message_id = p_message and user_id = auth.uid();
    return false;
  end if;
  insert into public.message_likes (kind, message_id, user_id) values (p_kind, p_message, auth.uid());
  return true;
end $$;
grant execute on function public.toggle_message_like(text, uuid) to authenticated;

-- 1つの案件（または1つのダイレクトメッセージ）の、いいねの一覧
create or replace function public.message_likes_for(p_kind text, p_parent uuid)
returns table(message_id uuid, user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_kind = 'project' then
    if not public.is_project_party(p_parent) then return; end if;
    return query select l.message_id, l.user_id from public.message_likes l
      join public.project_messages m on m.id = l.message_id where l.kind = 'project' and m.project_id = p_parent;
  elsif p_kind = 'dm' then
    if not public.dm_can_see(p_parent) then return; end if;
    return query select l.message_id, l.user_id from public.message_likes l
      join public.dm_messages m on m.id = l.message_id where l.kind = 'dm' and m.thread_id = p_parent;
  end if;
end $$;
grant execute on function public.message_likes_for(text, uuid) to authenticated;
