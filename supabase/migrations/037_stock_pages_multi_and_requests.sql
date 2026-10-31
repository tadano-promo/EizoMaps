-- =====================================================================
--  Eizo Maps / 037
--  鍵付きページ（ストックページ）を1人5つまで・取り寄せと受け渡し
--  ---------------------------------------------------------------
--  2026-10-31 翠くん：
--   「クライアント側はいくつかクリックしたら簡単に取り寄せられるようにしたいけど(もちろんメッセージもつけられる、
--     会社名の誰々ですみたいな)、ただクリエイター側はここはあえてボタンで終わらせないで、どのページかをチェックで
--     選んだあと、パスワードはちゃんとメッセージで送るようにしたい。」
--   「鍵付きページは5個までに一旦しておこう。もっと欲しい人は要望として送って欲しい。」
--   「取り寄せでログインした人だけにしか見れないってのも大正解！」
--   「Aがいいかな　運営は記録とかはしない」（本人のログイン中だけパスワードを見られる）
--   「一度渡された人は、ログインしていればパスワードなしで開ける　これだけはやめて」
--
--  ★ 決めたこと
--   ・1人5つまで。ページごとに別のパスワード
--   ・パスワードは2つの形で持つ
--       password_hash … 開けるかどうかの確認用（元に戻せない）
--       password_enc  … 本人に見せるための形（鍵をかけて保存。鍵は Vault に置き、関数の中でだけ使う）
--     運営の画面・API には、どちらも出さない（列の SELECT 権限を誰にも渡さない）
--   ・取り寄せも受け渡しも、メッセージ（033）の上で行う。ログインが必要。回数の上限はメッセージと同じ
--   ・返事を待っている間は、同じ人が同じページをもう一度取り寄せられない
--   ・受け渡しでは、クリエイターがパスワードを自分で打つ。そのページのパスワードと合わなければ送れない（誤送信を防ぐ）
--   ・パスワードはメッセージの本文には入れない（本文は問題の確認のため運営が読むことがあるため）。
--     受け取った人と送った本人だけが、関数を通して見られる
--   ・渡された人も、開くには毎回パスワードが要る（ログインだけでは開けない）
--  （本番には 037a〜037f の6回に分けて適用済み）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 1人1ページの決まりを外し、5つまでにする
-- ---------------------------------------------------------------------
alter table public.stock_pages drop constraint if exists stock_pages_creator_id_key;
create index if not exists idx_stock_pages_creator on public.stock_pages (creator_id, created_at);
alter table public.stock_pages add column if not exists password_enc bytea;

create or replace function public.check_stock_page_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.stock_pages where creator_id = new.creator_id) >= 5 then
    raise exception '鍵付きページは5つまでです。もっと必要なときは、お問い合わせから教えてください';
  end if;
  return new;
end;
$$;
revoke execute on function public.check_stock_page_limit() from public, anon, authenticated;
drop trigger if exists trg_stock_page_limit on public.stock_pages;
create trigger trg_stock_page_limit before insert on public.stock_pages
  for each row execute function public.check_stock_page_limit();

-- 管理画面の一覧：ページが複数になっても1つだけ出す（いちばん古いもの）
do $$
declare d text;
begin
  d := pg_get_functiondef('public.admin_list_creators()'::regprocedure);
  if position('order by sp.created_at limit 1' in d) = 0 then
    d := replace(d, 'from public.stock_pages sp where sp.creator_id = c.id)',
                    'from public.stock_pages sp where sp.creator_id = c.id order by sp.created_at limit 1)');
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. 本人に見せるための鍵（Vault）
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'stock_pw_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'stock_pw_key',
      '鍵付きページのパスワードを本人と受け取った人に見せるための鍵（037）');
  end if;
end $$;

create or replace function public.stock_pw_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'stock_pw_key' limit 1;
$$;
revoke execute on function public.stock_pw_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. パスワードの設定（ページを選んで）
-- ---------------------------------------------------------------------
create or replace function public.set_stock_page_password(p_page_id uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := public.my_creator_id();
begin
  if cid is null then raise exception 'クリエイター登録が必要です'; end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'パスワードは6文字以上72文字以下で設定してください';
  end if;
  update public.stock_pages
     set password_hash       = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         password_enc        = extensions.pgp_sym_encrypt(p_password, public.stock_pw_key()),
         password_updated_at = now()
   where id = p_page_id and creator_id = cid;
  if not found then raise exception 'ページが見つかりません'; end if;
end;
$$;
revoke execute on function public.set_stock_page_password(uuid, text) from public, anon;
grant execute on function public.set_stock_page_password(uuid, text) to authenticated;

-- 前の形（ページを選ばない）：ページが1つの人だけ動く。古い画面が残っていても、ほかのページを書き換えない
create or replace function public.set_stock_password(p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cid uuid := public.my_creator_id();
  pid uuid;
begin
  if cid is null then raise exception 'クリエイター登録が必要です'; end if;
  if (select count(*) from public.stock_pages where creator_id = cid) <> 1 then
    raise exception '画面が古くなっています。ページを読み込み直してください';
  end if;
  select id into pid from public.stock_pages where creator_id = cid;
  perform public.set_stock_page_password(pid, p_password);
end;
$$;

-- 本人がパスワードを見る（ログイン中の本人だけ。運営の画面には出さない）
create or replace function public.reveal_stock_password(p_page_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  cid uuid := public.my_creator_id();
  enc bytea;
begin
  if cid is null then raise exception 'ページが見つかりません'; end if;
  select password_enc into enc from public.stock_pages where id = p_page_id and creator_id = cid;
  if not found then raise exception 'ページが見つかりません'; end if;
  if enc is null then return null; end if;
  return extensions.pgp_sym_decrypt(enc, public.stock_pw_key());
end;
$$;
revoke execute on function public.reveal_stock_password(uuid) from public, anon;
grant execute on function public.reveal_stock_password(uuid) to authenticated;

-- 本人に見せられる形で保存されているか（前のしくみで設定したページは見られない）
create or replace function public.my_stock_pw_viewable()
returns table (page_id uuid, viewable boolean) language sql stable security definer set search_path = '' as $$
  select sp.id, sp.password_enc is not null
    from public.stock_pages sp
   where sp.creator_id = public.my_creator_id();
$$;
revoke execute on function public.my_stock_pw_viewable() from public, anon;
grant execute on function public.my_stock_pw_viewable() to authenticated;

-- ---------------------------------------------------------------------
-- 4. プロフィールに出す「非公開の作品があります」（名前と数だけ。URL もパスワードも出さない）
-- ---------------------------------------------------------------------
create or replace function public.public_stock_pages(p_creator_id uuid)
returns table (id uuid, title text, item_count integer)
language sql stable security definer set search_path = '' as $$
  select sp.id, sp.title,
         (select count(*)::int from public.stock_items i where i.page_id = sp.id and i.kind in ('video','doc','link'))
    from public.stock_pages sp
   where sp.creator_id = p_creator_id
     and sp.is_active and sp.password_hash is not null
     and public.creator_is_published(p_creator_id)
   order by sp.created_at
   limit 5;
$$;
revoke execute on function public.public_stock_pages(uuid) from public;
grant execute on function public.public_stock_pages(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. メッセージに「取り寄せ」「受け渡し」「見送り」のカードを載せる
-- ---------------------------------------------------------------------
alter table public.dm_messages add column if not exists kind text not null default 'text';
alter table public.dm_messages add column if not exists meta jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dm_messages_kind_check') then
    alter table public.dm_messages add constraint dm_messages_kind_check
      check (kind in ('text','stock_request','stock_give','stock_decline'));
  end if;
end $$;

create table if not exists public.stock_requests (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid not null references public.stock_pages(id) on delete cascade,
  creator_id   uuid not null references public.creators(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  thread_id    uuid not null references public.dm_threads(id) on delete cascade,
  message_id   uuid references public.dm_messages(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending','given','declined')),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create unique index if not exists uq_stock_requests_pending
  on public.stock_requests (page_id, requester_id) where status = 'pending';
create index if not exists idx_stock_requests_thread on public.stock_requests (thread_id, created_at);
alter table public.stock_requests enable row level security;
alter table public.stock_requests force row level security;
drop policy if exists stock_requests_select on public.stock_requests;
create policy stock_requests_select on public.stock_requests for select to authenticated
  using (requester_id = auth.uid() or public.is_my_creator(creator_id));
grant select on public.stock_requests to authenticated;

create table if not exists public.stock_handovers (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid not null references public.stock_pages(id) on delete cascade,
  creator_id   uuid not null references public.creators(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  thread_id    uuid not null references public.dm_threads(id) on delete cascade,
  message_id   uuid references public.dm_messages(id) on delete set null,
  password_enc bytea not null,
  given_at     timestamptz not null default now()
);
create index if not exists idx_stock_handovers_recipient on public.stock_handovers (recipient_id, given_at desc);
create index if not exists idx_stock_handovers_page on public.stock_handovers (page_id, given_at desc);
alter table public.stock_handovers enable row level security;
alter table public.stock_handovers force row level security;
drop policy if exists stock_handovers_select on public.stock_handovers;
create policy stock_handovers_select on public.stock_handovers for select to authenticated
  using (recipient_id = auth.uid() or public.is_my_creator(creator_id));
-- password_enc は誰にも見せない
grant select (id, page_id, creator_id, recipient_id, thread_id, message_id, given_at)
  on public.stock_handovers to authenticated;
-- Supabase は新しい表に全部の権限を自動で付けるので、いったん外して付け直す
revoke all on public.stock_requests from anon, authenticated;
revoke all on public.stock_handovers from anon, authenticated;
grant select on public.stock_requests to authenticated;
grant select (id, page_id, creator_id, recipient_id, thread_id, message_id, given_at)
  on public.stock_handovers to authenticated;

-- 取り寄せる（クライアント側）
create or replace function public.request_stock(p_creator_id uuid, p_page_ids uuid[], p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  ids uuid[];
  pages jsonb;
  tid uuid;
  mid uuid;
  body text := btrim(coalesce(p_body, ''));
begin
  if uid is null then raise exception 'ログインしてください'; end if;
  if p_page_ids is null or cardinality(p_page_ids) < 1 then raise exception '見たいページを選んでください'; end if;
  if cardinality(p_page_ids) > 5 then raise exception '一度に選べるのは5つまでです'; end if;

  -- 公開していて、パスワードがあるページだけ。返事待ちのものは外す
  select array_agg(sp.id order by sp.created_at),
         jsonb_agg(jsonb_build_object('id', sp.id, 'title', sp.title) order by sp.created_at)
    into ids, pages
    from public.stock_pages sp
   where sp.id = any(p_page_ids) and sp.creator_id = p_creator_id
     and sp.is_active and sp.password_hash is not null
     and not exists (select 1 from public.stock_requests r
                      where r.page_id = sp.id and r.requester_id = uid and r.status = 'pending');
  if ids is null then
    raise exception '選んだページは、いま返事を待っているか、見せてもらえない状態です';
  end if;

  if body = '' then body := '鍵付きページを見せていただけないでしょうか。'; end if;
  tid := public.send_dm(p_creator_id, body);
  select id into mid from public.dm_messages
   where thread_id = tid and sender_id = uid and kind = 'text' and meta is null order by created_at desc limit 1;
  update public.dm_messages set kind = 'stock_request', meta = jsonb_build_object('pages', pages) where id = mid;

  insert into public.stock_requests (page_id, creator_id, requester_id, thread_id, message_id)
  select unnest(ids), p_creator_id, uid, tid, mid;
  return tid;
end;
$$;
revoke execute on function public.request_stock(uuid, uuid[], text) from public, anon;
grant execute on function public.request_stock(uuid, uuid[], text) to authenticated;

-- 渡す（クリエイター側）：p_items = [{"page_id": "...", "password": "..."}]
create or replace function public.give_stock(p_thread_id uuid, p_items jsonb, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.dm_threads;
  it jsonb;
  sp record;
  pw text;
  mid uuid;
  pages jsonb := '[]'::jsonb;
  hid uuid;
  body text := btrim(coalesce(p_body, ''));
begin
  if uid is null then raise exception 'ログインしてください'; end if;
  select * into t from public.dm_threads where id = p_thread_id;
  if t.id is null or not exists (select 1 from public.creators c where c.id = t.creator_id and c.user_id = uid) then
    raise exception 'やりとりが見つかりません';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception '渡すページを選んでください';
  end if;
  if jsonb_array_length(p_items) > 5 then raise exception '一度に渡せるのは5つまでです'; end if;

  -- 先に全部を確かめる（1つでも合わなければ、何も送らない）
  for it in select * from jsonb_array_elements(p_items) loop
    pw := it ->> 'password';
    select id, title, slug, is_active, password_hash into sp
      from public.stock_pages where id = (it ->> 'page_id')::uuid and creator_id = t.creator_id;
    if sp.id is null then raise exception 'ページが見つかりません'; end if;
    if sp.password_hash is null then raise exception '「%」はパスワードがまだ設定されていません', sp.title; end if;
    if not sp.is_active then raise exception '「%」はまだ公開していません。公開してから渡してください', sp.title; end if;
    if pw is null or btrim(pw) = '' then raise exception '「%」のパスワードを入れてください', sp.title; end if;
    if extensions.crypt(pw, sp.password_hash) <> sp.password_hash then
      raise exception '「%」のパスワードと違います。ほかのページのパスワードになっていないか確かめてください', sp.title;
    end if;
    if position(pw in body) > 0 then
      raise exception 'パスワードは本文ではなく、パスワードの欄に入れてください';
    end if;
  end loop;

  if body = '' then body := '鍵付きページをお送りします。'; end if;
  perform public.reply_dm(p_thread_id, body);
  select id into mid from public.dm_messages
   where thread_id = p_thread_id and sender_id = uid and kind = 'text' and meta is null order by created_at desc limit 1;

  for it in select * from jsonb_array_elements(p_items) loop
    select id, title, slug into sp from public.stock_pages where id = (it ->> 'page_id')::uuid;
    insert into public.stock_handovers (page_id, creator_id, recipient_id, thread_id, message_id, password_enc)
    values (sp.id, t.creator_id, t.sender_id, t.id, mid,
            extensions.pgp_sym_encrypt(it ->> 'password', public.stock_pw_key()))
    returning id into hid;
    pages := pages || jsonb_build_array(jsonb_build_object('id', sp.id, 'title', sp.title, 'slug', sp.slug, 'handover_id', hid));
    update public.stock_requests set status = 'given', decided_at = now()
     where thread_id = t.id and page_id = sp.id and status = 'pending';
  end loop;

  update public.dm_messages set kind = 'stock_give', meta = jsonb_build_object('pages', pages) where id = mid;
end;
$$;
revoke execute on function public.give_stock(uuid, jsonb, text) from public, anon;
grant execute on function public.give_stock(uuid, jsonb, text) to authenticated;

-- 見送る（クリエイター側）。理由は相手に見せない
create or replace function public.decline_stock(p_thread_id uuid, p_page_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t public.dm_threads;
  pages jsonb;
  mid uuid;
begin
  select * into t from public.dm_threads where id = p_thread_id;
  if t.id is null or not exists (select 1 from public.creators c where c.id = t.creator_id and c.user_id = uid) then
    raise exception 'やりとりが見つかりません';
  end if;
  select jsonb_agg(jsonb_build_object('id', sp.id, 'title', sp.title)) into pages
    from public.stock_pages sp
   where sp.id = any(p_page_ids)
     and exists (select 1 from public.stock_requests r where r.thread_id = t.id and r.page_id = sp.id and r.status = 'pending');
  if pages is null then raise exception '返事を待っている取り寄せはありません'; end if;
  update public.stock_requests set status = 'declined', decided_at = now()
   where thread_id = t.id and page_id = any(p_page_ids) and status = 'pending';
  perform public.reply_dm(p_thread_id, '今回は、鍵付きページをお見せするのを見送らせてください。');
  select id into mid from public.dm_messages
   where thread_id = p_thread_id and sender_id = uid and kind = 'text' and meta is null order by created_at desc limit 1;
  update public.dm_messages set kind = 'stock_decline', meta = jsonb_build_object('pages', pages) where id = mid;
end;
$$;
revoke execute on function public.decline_stock(uuid, uuid[]) from public, anon;
grant execute on function public.decline_stock(uuid, uuid[]) to authenticated;

-- 渡されたパスワードを見る（受け取った人と、渡した本人だけ）。今も開けるかどうかも返す
create or replace function public.get_handover_password(p_handover_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  h public.stock_handovers;
  sp record;
  pw text;
begin
  select * into h from public.stock_handovers where id = p_handover_id;
  if h.id is null or not (h.recipient_id = auth.uid() or public.is_my_creator(h.creator_id)) then
    raise exception '見つかりません';
  end if;
  select is_active, password_hash into sp from public.stock_pages where id = h.page_id;
  pw := extensions.pgp_sym_decrypt(h.password_enc, public.stock_pw_key());
  return jsonb_build_object(
    'password', pw,
    'valid', coalesce(sp.is_active, false) and sp.password_hash is not null
             and extensions.crypt(pw, sp.password_hash) = sp.password_hash
  );
end;
$$;
revoke execute on function public.get_handover_password(uuid) from public, anon;
grant execute on function public.get_handover_password(uuid) to authenticated;

-- 見せてもらった作品の一覧（クライアント側）。ページごとに新しい1件。開くには毎回パスワードが要る
create or replace function public.my_received_stock()
returns table (handover_id uuid, page_id uuid, title text, slug text, creator_name text, creator_handle text,
               creator_id uuid, thread_id uuid, given_at timestamptz, valid boolean)
language sql stable security definer set search_path = '' as $$
  select x.id, x.page_id, sp.title, sp.slug, c.display_name, c.handle, c.id, x.thread_id, x.given_at,
         sp.is_active and sp.password_hash is not null
           and extensions.crypt(extensions.pgp_sym_decrypt(x.password_enc, public.stock_pw_key()), sp.password_hash) = sp.password_hash
    from (select distinct on (h.page_id) h.* from public.stock_handovers h
           where h.recipient_id = auth.uid() order by h.page_id, h.given_at desc) x
    join public.stock_pages sp on sp.id = x.page_id
    join public.creators c on c.id = x.creator_id
   order by x.given_at desc
   limit 50;
$$;
revoke execute on function public.my_received_stock() from public, anon;
grant execute on function public.my_received_stock() to authenticated;

-- このページを渡した相手（クリエイター側。中身やパスワードを変えるときの注意に使う）
create or replace function public.my_stock_page_shares(p_page_id uuid)
returns table (recipient_name text, given_at timestamptz, still_valid boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce(
           (select c3.display_name from public.creators c3 where c3.user_id = x.recipient_id and c3.is_published limit 1),
           (select coalesce(nullif(btrim(cl.company), '') || '　' || cl.display_name, cl.display_name)
              from public.clients cl where cl.user_id = x.recipient_id limit 1),
           'Eizo Maps のユーザー'),
         x.given_at,
         sp.password_hash is not null
           and extensions.crypt(extensions.pgp_sym_decrypt(x.password_enc, public.stock_pw_key()), sp.password_hash) = sp.password_hash
    from (select distinct on (h.recipient_id) h.* from public.stock_handovers h
           where h.page_id = p_page_id order by h.recipient_id, h.given_at desc) x
    join public.stock_pages sp on sp.id = x.page_id
   where sp.creator_id = public.my_creator_id()
   order by x.given_at desc
   limit 50;
$$;
revoke execute on function public.my_stock_page_shares(uuid) from public, anon;
grant execute on function public.my_stock_page_shares(uuid) to authenticated;
