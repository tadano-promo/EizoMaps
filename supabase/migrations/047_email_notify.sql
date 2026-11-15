-- =====================================================================
--  047 メールのお知らせ（2026-11-15 翠くん）
--   依頼・返事・開始・納品・募集への提案・選ばれた／見送り・メッセージが届いたら、相手にメールで知らせる
--   ・出来事が起きたら notify_queue に1行入れる（トリガー）
--   ・5分ごとに関数 notify が queue を読んで、さくらのメールで送る
--   ・メッセージのお知らせは、同じ相手・同じやり取りなら30分に1通まで（たくさん届かないように）
--   ・本人がマイページで止められる（users.notify_email）
-- =====================================================================

alter table public.users add column if not exists notify_email boolean not null default true;
grant update (notify_email) on public.users to authenticated;

create table if not exists public.notify_queue (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  subject     text not null check (char_length(subject) <= 200),
  body        text not null check (char_length(body) <= 4000),
  link        text not null check (link ~ '^/'),
  group_key   text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  tries       smallint not null default 0,
  last_error  text
);
alter table public.notify_queue enable row level security;
alter table public.notify_queue force row level security;
revoke all on public.notify_queue from anon, authenticated;
create index if not exists idx_notify_queue_unsent on public.notify_queue (created_at) where sent_at is null;
create index if not exists idx_notify_queue_group on public.notify_queue (group_key, created_at desc);

insert into public.app_internal (key, value)
select 'notify_cron', encode(extensions.gen_random_bytes(32), 'hex')
where not exists (select 1 from public.app_internal where key = 'notify_cron');

-- ---- 名前を出す小さな関数（画面で使っている名前。本名ではない） ----
create or replace function public.notify_name_creator(p_creator uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(display_name), ''), 'クリエイター') from public.creators where id = p_creator;
$$;
create or replace function public.notify_name_client(p_client uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(company), ''), nullif(btrim(display_name), ''), 'クライアント') from public.clients where id = p_client;
$$;
revoke all on function public.notify_name_creator(uuid) from public, anon, authenticated;
revoke all on function public.notify_name_client(uuid) from public, anon, authenticated;

-- 1通入れる（相手がお知らせを止めていれば入れない／group_key があれば30分に1通まで）
create or replace function public.notify_push(p_user uuid, p_kind text, p_subject text, p_body text, p_link text, p_group text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if exists (select 1 from public.users where id = p_user and notify_email = false) then return; end if;
  if p_group is not null and exists (
       select 1 from public.notify_queue where group_key = p_group and user_id = p_user and created_at > now() - interval '30 minutes') then
    return;
  end if;
  insert into public.notify_queue (user_id, kind, subject, body, link, group_key)
  values (p_user, p_kind, left(p_subject, 200), left(p_body, 4000), p_link, p_group);
end;
$$;
revoke all on function public.notify_push(uuid, text, text, text, text, text) from public, anon, authenticated;

-- ---- 案件：依頼が届いた・返事・お断り・開始・納品・入金 ----
create or replace function public.notify_on_project()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cu uuid; ku uuid; cn text; kn text; link text;
begin
  select user_id into cu from public.clients where id = new.client_id;
  select user_id into ku from public.creators where id = new.creator_id;
  cn := public.notify_name_client(new.client_id);
  kn := public.notify_name_creator(new.creator_id);
  link := '/projects/?id=' || new.id;

  if tg_op = 'INSERT' then
    if new.status = 'offered' then
      perform public.notify_push(ku, 'project_offered', '【Eizo Maps】' || cn || ' さんから依頼が届きました',
        cn || ' さんから依頼が届きました。' || chr(10) || '案件：' || new.title || chr(10) || chr(10)
        || '案件のページで「この内容で受ける」「条件を提案する」「お断りする」から返事をしてください。', link);
    elsif new.status = 'proposed' and new.origin = 'board' then
      perform public.notify_push(ku, 'job_chosen', '【Eizo Maps】あなたの提案が選ばれました',
        '募集「' || new.title || '」で、あなたの提案が選ばれました。' || chr(10) || chr(10)
        || 'クライアントさんが条件を確かめて「この条件で始める」を押すと、仕事が始まります。案件のページから、メッセージも送れます。', link);
    end if;
    return null;
  end if;

  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'offered' then
    perform public.notify_push(ku, 'project_offered', '【Eizo Maps】' || cn || ' さんから依頼が届きました',
      cn || ' さんから依頼が届きました。' || chr(10) || '案件：' || new.title || chr(10) || chr(10)
      || '案件のページで返事をしてください。', link);
  elsif new.status = 'proposed' then
    perform public.notify_push(cu, 'project_proposed', '【Eizo Maps】' || kn || ' さんから返事が届きました',
      kn || ' さんから、依頼への返事（条件）が届きました。' || chr(10) || '案件：' || new.title || chr(10)
      || '金額：' || coalesce(to_char(new.terms_amount, 'FM999,999,999,999') || '円（税込）', '相談') || chr(10)
      || '納期：' || coalesce(to_char(new.terms_due_on, 'YYYY/MM/DD'), '相談') || chr(10) || chr(10)
      || 'この条件でよければ、案件のページで「この条件で始める」を押してください。', link);
  elsif new.status = 'declined' then
    perform public.notify_push(cu, 'project_declined', '【Eizo Maps】' || kn || ' さんから返事が届きました',
      kn || ' さんは、今回の依頼をお断りしました。' || chr(10) || '案件：' || new.title || chr(10) || chr(10)
      || 'ほかのクリエイターを探すか、募集を出すこともできます。', link);
  elsif new.status = 'in_progress' then
    perform public.notify_push(ku, 'project_started', '【Eizo Maps】仕事が始まりました',
      cn || ' さんが「この条件で始める」を押しました。仕事が始まります。' || chr(10) || '案件：' || new.title, link);
  elsif new.status = 'delivered' then
    perform public.notify_push(cu, 'project_delivered', '【Eizo Maps】' || kn || ' さんが納品済みにしました',
      kn || ' さんが「納品済み」にしました。' || chr(10) || '案件：' || new.title || chr(10) || chr(10)
      || '中身を確かめて、お支払いが済んだら「入金済みにする」を押してください。評価も書けるようになりました。', link);
  elsif new.status = 'paid' then
    perform public.notify_push(ku, 'project_paid', '【Eizo Maps】入金済みになりました',
      cn || ' さんが「入金済み」にしました。' || chr(10) || '案件：' || new.title || chr(10) || chr(10)
      || 'よければ、案件のページから相手を評価してください。', link);
  elsif new.status = 'cancelled' then
    perform public.notify_push(case when public.project_my_role(new.id) = 'client' then ku else cu end,
      'project_cancelled', '【Eizo Maps】案件がキャンセルされました',
      '案件「' || new.title || '」がキャンセルされました。', link);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_projects_notify on public.projects;
create trigger trg_projects_notify after insert or update on public.projects
  for each row execute function public.notify_on_project();

-- ---- 案件のやり取り（自動で入る【】の行は、状態のお知らせと重なるので送らない） ----
create or replace function public.notify_on_project_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.projects; cu uuid; ku uuid; to_user uuid; from_name text;
begin
  if new.body like '【%' then return null; end if;
  select * into p from public.projects where id = new.project_id;
  select user_id into cu from public.clients where id = p.client_id;
  select user_id into ku from public.creators where id = p.creator_id;
  if new.sender_id = cu then to_user := ku; from_name := public.notify_name_client(p.client_id);
  else to_user := cu; from_name := public.notify_name_creator(p.creator_id); end if;
  perform public.notify_push(to_user, 'project_message', '【Eizo Maps】' || from_name || ' さんからメッセージが届きました',
    from_name || ' さんから、案件「' || p.title || '」にメッセージが届きました。' || chr(10) || chr(10)
    || left(new.body, 300) || case when char_length(new.body) > 300 then '…' else '' end,
    '/projects/?id=' || p.id, 'pm:' || p.id);
  return null;
end;
$$;
drop trigger if exists trg_project_messages_notify on public.project_messages;
create trigger trg_project_messages_notify after insert on public.project_messages
  for each row execute function public.notify_on_project_message();

-- ---- ダイレクトメッセージ ----
create or replace function public.notify_on_dm()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.dm_threads; ku uuid; to_user uuid; from_name text;
begin
  select * into t from public.dm_threads where id = new.thread_id;
  if t.id is null or coalesce(t.blocked, false) then return null; end if;
  select user_id into ku from public.creators where id = t.creator_id;
  if new.sender_id = ku then
    to_user := t.sender_id; from_name := public.notify_name_creator(t.creator_id);
  else
    to_user := ku;
    from_name := coalesce((select public.notify_name_client(c.id) from public.clients c where c.user_id = new.sender_id),
                          (select public.notify_name_creator(c.id) from public.creators c where c.user_id = new.sender_id),
                          'Eizo Maps のユーザー');
  end if;
  perform public.notify_push(to_user, 'dm', '【Eizo Maps】' || from_name || ' さんからメッセージが届きました',
    from_name || ' さんからメッセージが届きました。' || chr(10) || chr(10)
    || left(coalesce(new.body, ''), 300) || case when char_length(coalesce(new.body, '')) > 300 then '…' else '' end,
    '/messages/?t=' || t.id, 'dm:' || t.id);
  return null;
end;
$$;
drop trigger if exists trg_dm_messages_notify on public.dm_messages;
create trigger trg_dm_messages_notify after insert on public.dm_messages
  for each row execute function public.notify_on_dm();

-- ---- 募集：提案が届いた（募集主へ）／見送り（クリエイターへ） ----
create or replace function public.notify_on_job_proposal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  post public.job_posts; cu uuid; ku uuid;
begin
  select * into post from public.job_posts where id = new.post_id;
  select user_id into cu from public.clients where id = post.client_id;
  select user_id into ku from public.creators where id = new.creator_id;
  if tg_op = 'INSERT' then
    perform public.notify_push(cu, 'job_proposal', '【Eizo Maps】募集に提案が届きました',
      '募集「' || post.title || '」に、' || public.notify_name_creator(new.creator_id) || ' さんから提案が届きました。' || chr(10)
      || '金額：' || coalesce(to_char(new.amount, 'FM999,999,999,999') || '円（税込）', '相談') || chr(10) || chr(10)
      || '募集のページで、届いた提案を比べて「この人を選ぶ」を押せます。',
      '/jobs/detail.html?id=' || post.id, 'jp:' || post.id);
  elsif new.status = 'passed' and old.status = 'sent' then
    perform public.notify_push(ku, 'job_passed', '【Eizo Maps】募集の結果のお知らせ',
      '募集「' || post.title || '」は、今回は見送りになりました。' || chr(10)
      || '提案してくださって、ありがとうございました。ほかの募集も見てみてください。',
      '/jobs/');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_job_proposals_notify on public.job_proposals;
create trigger trg_job_proposals_notify after insert or update on public.job_proposals
  for each row execute function public.notify_on_job_proposal();

-- ---- 送る関数（notify）が使う：まだ送っていないものを取る／送った印を付ける ----
create or replace function public.notify_take(p_limit integer default 50)
returns table (id uuid, user_id uuid, kind text, subject text, body text, link text)
language sql security definer set search_path = '' as $$
  update public.notify_queue q set tries = q.tries + 1
   where q.id in (select id from public.notify_queue where sent_at is null and tries < 5
                   order by created_at limit greatest(1, least(p_limit, 200)) for update skip locked)
  returning q.id, q.user_id, q.kind, q.subject, q.body, q.link;
$$;
create or replace function public.notify_done(p_id uuid, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update public.notify_queue set sent_at = case when p_error is null then now() else sent_at end,
         last_error = left(p_error, 300) where id = p_id;
$$;
revoke all on function public.notify_take(integer) from public, anon, authenticated;
revoke all on function public.notify_done(uuid, text) from public, anon, authenticated;
grant execute on function public.notify_take(integer) to service_role;
grant execute on function public.notify_done(uuid, text) to service_role;

-- 送ったものは90日で消す
create or replace function public.notify_cleanup()
returns void language sql security definer set search_path = '' as $$
  delete from public.notify_queue where created_at < now() - interval '90 days';
$$;
revoke all on function public.notify_cleanup() from public, anon, authenticated;
grant execute on function public.notify_cleanup() to service_role;

-- 5分ごとに送る（関数 notify を呼ぶ）
select cron.schedule('email-notify', '*/5 * * * *', $cron$
  select net.http_post(
    url     := 'https://buquisjkkwvekoyuuxjx.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1cXVpc2pra3d2ZWtveXV1eGp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTU2NjQsImV4cCI6MjEwNDc5MTY2NH0.jPkr8vQycg3ICajTPVcY8ltfb8evK26fYHvfb-FrU3c',
      'x-cron-key',    (select value from public.app_internal where key = 'notify_cron')
    ),
    body    := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
