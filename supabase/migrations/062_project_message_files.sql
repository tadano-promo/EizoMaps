-- =====================================================================
--  062: 案件のやり取りに画像・PDFを付ける（2026-11-17 翠くん。相手の方の「作りかけの画像を添付できたら」から）
--  ・置き場 project-files（非公開）。パスは <案件ID>/<ランダム>.<拡張子>。見られる・入れられるのはその案件の2人だけ（と運営）
--  ・画像（jpg/png/webp/gif/heic）とPDFだけ。1つ10MBまで・1通5つまで。動画はGoogleドライブなどのリンクで
--  ・案件が終わってから（完了・キャンセル・お断り）90日たったら自動で消す。消える7日前に2人へお知らせ
--  ・置き場は全部で300MBまで（お問い合わせ500MBと合わせて、無料の1GBに収める）。250MBで運営に知らせる
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.projects add column if not exists ended_at timestamptz;
alter table public.projects add column if not exists files_notice_at timestamptz;
alter table public.projects add column if not exists files_deleted_at timestamptz;
alter table public.project_messages add column if not exists files text[] not null default '{}';
alter table public.project_messages drop constraint if exists project_messages_files_check;
alter table public.project_messages add constraint project_messages_files_check check (cardinality(files) <= 5);

-- 終わった日を記録（完了・キャンセル・お断り）
create or replace function public.stamp_project_ended() returns trigger
language plpgsql set search_path to '' as $$
begin
  -- 画面から（本人の操作で）は、この3つは書き換えさせない。毎日の片付け（関数の中）だけが書く
  if current_user in ('authenticated', 'anon') then
    new.ended_at := old.ended_at; new.files_notice_at := old.files_notice_at; new.files_deleted_at := old.files_deleted_at;
  end if;
  if new.status in ('closed','cancelled','declined') and old.status is distinct from new.status then new.ended_at := now();
  elsif new.status not in ('closed','cancelled','declined') then new.ended_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_projects_zz_ended on public.projects;
create trigger trg_projects_zz_ended before update on public.projects for each row execute function public.stamp_project_ended();

-- 置き場の量
create or replace function public.project_space_used() returns bigint
language sql stable security definer set search_path to '' as $$
  select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'project-files';
$$;
revoke all on function public.project_space_used() from public, anon, authenticated;
create or replace function public.project_space_ok() returns boolean
language sql stable security definer set search_path to '' as $$
  select public.project_space_used() < 300::bigint * 1024 * 1024;
$$;
revoke all on function public.project_space_ok() from public, anon;
grant execute on function public.project_space_ok() to authenticated;

-- 置き場の決まり：その案件の2人だけ。終わった案件・ファイルを消した案件には入れられない
create or replace function public.project_folder_party(p_folder text) returns boolean
language sql stable security definer set search_path to '' as $$
  select p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.is_project_party(p_folder::uuid);
$$;
revoke all on function public.project_folder_party(text) from public, anon;
grant execute on function public.project_folder_party(text) to authenticated;
create or replace function public.project_folder_open(p_folder text) returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.projects p where p.id::text = p_folder and p.ended_at is null and p.files_deleted_at is null);
$$;
revoke all on function public.project_folder_open(text) from public, anon;
grant execute on function public.project_folder_open(text) to authenticated;

drop policy if exists project_files_insert on storage.objects;
create policy project_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and public.project_folder_party((storage.foldername(name))[1])
              and public.project_folder_open((storage.foldername(name))[1]) and public.project_space_ok());
drop policy if exists project_files_select on storage.objects;
create policy project_files_select on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and (public.project_folder_party((storage.foldername(name))[1]) or public.is_admin()));

-- メッセージに付けるファイルは、その案件のフォルダにあるものだけ
create or replace function public.project_message_files_ok() returns trigger
language plpgsql security definer set search_path to '' as $$
declare f text;
begin
  if cardinality(new.files) = 0 then return new; end if;
  foreach f in array new.files loop
    if f is null or f not like new.project_id::text || '/%' or not exists (select 1 from storage.objects o where o.bucket_id = 'project-files' and o.name = f) then
      raise exception '付けたファイルが見つかりません。もう一度選び直してください。';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_project_message_files on public.project_messages;
create trigger trg_project_message_files before insert on public.project_messages for each row execute function public.project_message_files_ok();

-- 250MBを超えたら運営に知らせる（3日に1回まで）
create or replace function public.project_space_alert() returns trigger
language plpgsql security definer set search_path to '' as $$
declare used bigint; last_at timestamptz; a record;
begin
  if cardinality(new.files) = 0 then return new; end if;
  used := public.project_space_used();
  if used < 250::bigint * 1024 * 1024 then return new; end if;
  select nullif(value, '')::timestamptz into last_at from public.app_internal where key = 'proj_space_alert_at';
  if last_at is not null and last_at > now() - interval '3 days' then return new; end if;
  insert into public.app_internal (key, value) values ('proj_space_alert_at', now()::text) on conflict (key) do update set value = excluded.value;
  for a in select user_id from public.app_admins loop
    perform public.notify_push(a.user_id, 'project_space',
      '【Eizo Maps】案件のやり取りのファイルが' || round(used / 1048576.0) || 'MBになりました',
      '案件のやり取りに付いた画像・PDFが ' || round(used / 1048576.0) || 'MB（上限 300MB）になりました。' || chr(10)
        || '終わった案件のファイルは90日で自動で消えます。300MBを超えると、新しいファイルは付けられなくなります（文章は送れます）。',
      '/admin/', 'proj-space');
  end loop;
  return new;
end $$;
drop trigger if exists trg_project_space_alert on public.project_messages;
create trigger trg_project_space_alert after insert on public.project_messages for each row execute function public.project_space_alert();

-- 毎日の片付け（Edge Function inquiry-cleanup から呼ぶ。service_role だけ）
-- ① 終わってから83日：2人に「7日後に消えます」と知らせる
create or replace function public.project_files_notice() returns integer
language plpgsql security definer set search_path to '' as $$
declare r record; n integer := 0; u uuid;
begin
  for r in select p.id, p.title, p.ended_at, c.user_id cu, cl.user_id lu from public.projects p
             join public.creators c on c.id = p.creator_id join public.clients cl on cl.id = p.client_id
            where p.ended_at < now() - interval '83 days' and p.files_notice_at is null and p.files_deleted_at is null
              and exists (select 1 from public.project_messages m where m.project_id = p.id and cardinality(m.files) > 0)
            limit 200 loop
    foreach u in array array[r.cu, r.lu] loop
      perform public.notify_push(u, 'project_files',
        '【Eizo Maps】「' || r.title || '」のやり取りの画像・PDFが7日後に消えます',
        '案件「' || r.title || '」は終わってから90日たつため、やり取りに付いた画像・PDFが ' || to_char((r.ended_at + interval '90 days') at time zone 'Asia/Tokyo', 'MM/DD') || ' ごろに自動で消えます。' || chr(10)
          || '残しておきたいものは、それまでにダウンロードしてください。メッセージの文章は消えません。',
        '/projects/?id=' || r.id, 'proj-files-' || r.id);
    end loop;
    update public.projects set files_notice_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.project_files_notice() from public, anon, authenticated;
grant execute on function public.project_files_notice() to service_role;

-- ② 終わってから90日：消すファイルの一覧
create or replace function public.project_files_due() returns table (id uuid, files text[])
language sql stable security definer set search_path to '' as $$
  select p.id, coalesce(array_agg(f) filter (where f is not null), '{}')
    from public.projects p left join public.project_messages m on m.project_id = p.id left join lateral unnest(m.files) f on true
   where p.ended_at < now() - interval '90 days' and p.files_deleted_at is null
   group by p.id order by min(p.ended_at) limit 50;
$$;
revoke all on function public.project_files_due() from public, anon, authenticated;
grant execute on function public.project_files_due() to service_role;

-- ③ 消したあとの記録
create or replace function public.project_files_mark_deleted(p_id uuid) returns void
language sql security definer set search_path to '' as $$
  update public.project_messages set files = '{}' where project_id = p_id and cardinality(files) > 0;
  update public.projects set files_deleted_at = now() where id = p_id and ended_at < now() - interval '90 days';
$$;
revoke all on function public.project_files_mark_deleted(uuid) from public, anon, authenticated;
grant execute on function public.project_files_mark_deleted(uuid) to service_role;

-- 画面から files も入れられるように（列ごとの許可。062 の追加）
grant insert (files) on public.project_messages to authenticated;
