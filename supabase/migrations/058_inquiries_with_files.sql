-- =====================================================================
--  058: お問い合わせ・改善案・問題の報告に、画像や動画を付けられるようにする（2026-11-17 翠くん）
--  翠くん「最悪画像、また動画をつけれるようにしとかないと、スクショとかも送れないから、すごい不便だってなる気がする」
--  ・ファイルは非公開の置き場（inquiry-files）に入れる。見られるのは送った本人と運営だけ
--  ・1回に5つまで・1つ50MBまで。画像（jpg/png/webp/gif/heic）と動画（mp4/mov/webm）だけ
--  ・ファイルを付けられるのはログインしている人だけ（だれでも置けると悪用されるため）。文だけならログインなしでも送れる
--  ・届いたら運営にメールでお知らせ
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inquiry-files', 'inquiry-files', false, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inquiry_files_insert_own on storage.objects;
create policy inquiry_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'inquiry-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists inquiry_files_select on storage.objects;
create policy inquiry_files_select on storage.objects for select to authenticated
  using (bucket_id = 'inquiry-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create table if not exists public.inquiries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null check (kind in ('question','idea','bug','other')),
  name       text check (name is null or char_length(name) <= 60),
  email      text check (email is null or char_length(email) <= 200),
  body       text not null check (char_length(btrim(body)) between 5 and 4000),
  page       text check (page is null or char_length(page) <= 300),
  files      text[] not null default '{}' check (cardinality(files) <= 5),
  ip_hash    text,
  status     text not null default 'new' check (status in ('new','done')),
  created_at timestamptz not null default now()
);
create index if not exists idx_inquiries_created on public.inquiries (created_at desc);
alter table public.inquiries enable row level security;
alter table public.inquiries force row level security;
revoke all on public.inquiries from anon, authenticated;
grant select, update (status) on public.inquiries to authenticated;
drop policy if exists inquiries_admin_select on public.inquiries;
create policy inquiries_admin_select on public.inquiries for select to authenticated using (public.is_admin());
drop policy if exists inquiries_admin_update on public.inquiries;
create policy inquiries_admin_update on public.inquiries for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 問題の報告にもファイルを付けられるように
alter table public.reports add column if not exists files text[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reports_files_max') then
    alter table public.reports add constraint reports_files_max check (cardinality(files) <= 5);
  end if;
end $$;
grant insert (files), select (files) on public.reports to authenticated;

-- 付けたファイルが「本人の置き場のものか」を確かめる
create or replace function public.inquiry_files_ok(p_files text[])
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(bool_and(f like auth.uid()::text || '/%' and f !~ '\.\.'), true)
    from unnest(coalesce(p_files, '{}')) f;
$$;
revoke all on function public.inquiry_files_ok(text[]) from public, anon;
grant execute on function public.inquiry_files_ok(text[]) to authenticated;

create or replace function public.reports_files_check() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if cardinality(new.files) > 0 and not public.inquiry_files_ok(new.files) then
    raise exception '付けたファイルが正しくありません';
  end if;
  return new;
end $$;
drop trigger if exists trg_reports_files_check on public.reports;
create trigger trg_reports_files_check before insert on public.reports for each row execute function public.reports_files_check();

-- ---------- 送る（ログインなしでも文だけなら送れる） ----------
create or replace function public.send_inquiry(p_kind text, p_name text, p_email text, p_body text, p_page text, p_files text[])
returns uuid language plpgsql volatile security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); raw_ip text; iph text; new_id uuid; a record; kind_label text;
begin
  if p_kind not in ('question','idea','bug','other') then raise exception '種類を選んでください'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 5 then raise exception '内容を5文字以上で書いてください'; end if;
  if char_length(p_body) > 4000 then raise exception '内容は4000文字までにしてください'; end if;
  if cardinality(coalesce(p_files, '{}')) > 5 then raise exception 'ファイルは5つまでです'; end if;
  if cardinality(coalesce(p_files, '{}')) > 0 and (uid is null or not public.inquiry_files_ok(p_files)) then
    raise exception 'ファイルを付けるには、ログインしてください';
  end if;
  if uid is null and (p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception '返事を送るメールアドレスを入れてください';
  end if;
  begin
    raw_ip := split_part(coalesce((nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for', 'unknown'), ',', 1);
  exception when others then raw_ip := 'unknown'; end;
  iph := encode(extensions.digest(coalesce(btrim(raw_ip), 'unknown'), 'sha256'), 'hex');
  if (select count(*) from public.inquiries where created_at > now() - interval '1 day'
        and ((uid is not null and user_id = uid) or ip_hash = iph)) >= 10 then
    raise exception '今日はこれ以上送れません。急ぎのときは support@eizo-maps.com へメールでご連絡ください';
  end if;

  insert into public.inquiries (user_id, kind, name, email, body, page, files, ip_hash)
  values (uid, p_kind, nullif(left(btrim(coalesce(p_name, '')), 60), ''), nullif(left(btrim(coalesce(p_email, '')), 200), ''),
          btrim(p_body), nullif(left(coalesce(p_page, ''), 300), ''), coalesce(p_files, '{}'), iph)
  returning id into new_id;

  kind_label := case p_kind when 'question' then '質問' when 'idea' then '改善案' when 'bug' then '不具合' else 'その他' end;
  for a in select user_id from public.app_admins loop
    perform public.notify_push(a.user_id, 'inquiry',
      '【Eizo Maps】お問い合わせ（' || kind_label || '）が届きました',
      left(btrim(p_body), 600) || chr(10) || chr(10) || 'ファイル：' || cardinality(coalesce(p_files, '{}')) || '件'
        || coalesce(chr(10) || 'ページ：' || nullif(p_page, ''), ''),
      '/admin/#inquiries', 'inq:' || new_id);
  end loop;
  return new_id;
end $$;
revoke all on function public.send_inquiry(text, text, text, text, text, text[]) from public;
grant execute on function public.send_inquiry(text, text, text, text, text, text[]) to anon, authenticated;
