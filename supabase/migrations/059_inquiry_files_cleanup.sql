-- =====================================================================
--  059: お問い合わせのファイルの置き場がいっぱいにならないように（2026-11-17 翠くん「一旦今の体制でいけそう。進めて」）
--  ・翠くんが見るまで（「対応済みにする」を押すまで）は絶対に消さない
--  ・対応済みにしてから30日たったら、ファイルだけ自動で消す（文章は残す）。毎日の予約実行 → Edge Function inquiry-cleanup
--  ・お問い合わせのファイルは全部で500MBまで。超えたら新しいファイルは受け付けない（文章だけ送れる）
--  ・400MBを超えたら、運営にメールで知らせる（3日に1回まで）
-- =====================================================================
alter table public.inquiries add column if not exists done_at timestamptz;
alter table public.inquiries add column if not exists files_deleted_at timestamptz;

create or replace function public.inquiry_done_stamp() returns trigger
language plpgsql set search_path to '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then new.done_at := now(); end if;
  if new.status = 'new' then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_inquiry_done_stamp on public.inquiries;
create trigger trg_inquiry_done_stamp before update on public.inquiries for each row execute function public.inquiry_done_stamp();

-- 置き場の使っている量（バイト）
create or replace function public.inquiry_space_used() returns bigint
language sql stable security definer set search_path to '' as $$
  select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'inquiry-files';
$$;
revoke all on function public.inquiry_space_used() from public, anon, authenticated;

-- 画面から「まだ入るか」を聞く（500MBまで）
create or replace function public.inquiry_space_ok() returns boolean
language sql stable security definer set search_path to '' as $$
  select public.inquiry_space_used() < 500::bigint * 1024 * 1024;
$$;
revoke all on function public.inquiry_space_ok() from public, anon;
grant execute on function public.inquiry_space_ok() to authenticated;

-- 置き場に入れるときも、500MBを超えていたら止める
drop policy if exists inquiry_files_insert_own on storage.objects;
create policy inquiry_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'inquiry-files' and (storage.foldername(name))[1] = auth.uid()::text and public.inquiry_space_ok());

-- 400MBを超えたら運営に知らせる（send_inquiry のあとに呼ぶ）
create or replace function public.inquiry_space_alert() returns trigger
language plpgsql security definer set search_path to '' as $$
declare used bigint; last_at timestamptz; a record;
begin
  if cardinality(new.files) = 0 then return new; end if;
  used := public.inquiry_space_used();
  if used < 400::bigint * 1024 * 1024 then return new; end if;
  select nullif(value, '')::timestamptz into last_at from public.app_internal where key = 'inq_space_alert_at';
  if last_at is not null and last_at > now() - interval '3 days' then return new; end if;
  insert into public.app_internal (key, value) values ('inq_space_alert_at', now()::text)
    on conflict (key) do update set value = excluded.value;
  for a in select user_id from public.app_admins loop
    perform public.notify_push(a.user_id, 'inquiry_space',
      '【Eizo Maps】お問い合わせのファイルの置き場が' || round(used / 1048576.0) || 'MBになりました',
      'お問い合わせのファイルが ' || round(used / 1048576.0) || 'MB（上限 500MB）になりました。' || chr(10)
        || '管理画面の「お問い合わせ・改善案」で、見終わったものを「対応済みにする」を押すと、30日後にファイルが消えて空きができます。' || chr(10)
        || '500MBを超えると、新しい画像・動画は受け付けなくなります（文章は送れます）。',
      '/admin/#inquiries', 'inq-space');
  end loop;
  return new;
end $$;
drop trigger if exists trg_inquiry_space_alert on public.inquiries;
create trigger trg_inquiry_space_alert after insert on public.inquiries for each row execute function public.inquiry_space_alert();

-- 消してよいもの（対応済みから30日・ファイルあり）を返す。Edge Function（service_role）だけが使う
create or replace function public.inquiry_files_due() returns table (id uuid, files text[])
language sql stable security definer set search_path to '' as $$
  select i.id, i.files from public.inquiries i
   where i.status = 'done' and i.done_at < now() - interval '30 days' and cardinality(i.files) > 0
   order by i.done_at limit 200;
$$;
revoke all on function public.inquiry_files_due() from public, anon, authenticated;
grant execute on function public.inquiry_files_due() to service_role;

-- 毎日 4:37（日本時間）に消す
insert into public.app_internal (key, value) values ('inquiry_cleanup_cron', encode(extensions.gen_random_bytes(24), 'hex'))
  on conflict (key) do nothing;
select cron.unschedule('inquiry-cleanup') where exists (select 1 from cron.job where jobname = 'inquiry-cleanup');
select cron.schedule('inquiry-cleanup', '37 19 * * *', $cron$
  select net.http_post(
    url     := 'https://buquisjkkwvekoyuuxjx.supabase.co/functions/v1/inquiry-cleanup',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1cXVpc2pra3d2ZWtveXV1eGp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTU2NjQsImV4cCI6MjEwNDc5MTY2NH0.jPkr8vQycg3ICajTPVcY8ltfb8evK26fYHvfb-FrU3c',
      'x-cron-key',    (select value from public.app_internal where key = 'inquiry_cleanup_cron')
    ),
    body    := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
