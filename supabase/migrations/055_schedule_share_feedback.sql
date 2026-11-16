-- =====================================================================
--  055: 共有した香盤表に、相手が「OK」「直してほしい」とひとこと返せるようにする（2026-11-16 翠くん）
--  ・翠くん「でもこれと、ここから派生する案をやることでもっと良くなると思う」
--    （海外の Boords さんは、相手が登録なしでコメント・承認できる。Eizo Maps の共有は見るだけだった）
--  ・相手は登録なし。リンクのパスワードが合ったときだけ送れる（開くときと同じ確かめ方）
--  ・名前（40文字まで）とひとこと（1000文字まで）。「直してほしい」はひとことが必要
--  ・送ったときに見ていた版（最終更新の日時）を一緒に残す → あとで予定を直したら「直す前の版でのOK」と分かる
--  ・作った人にはメールでお知らせ（同じリンクは30分に1通まで）
--  ・送りすぎ対策：同じリンクは1時間に20件まで、同じ接続元は1時間に10件まで
-- =====================================================================

-- 共有リンクから見える範囲の「最終更新」（open_schedule_share と同じ決まり）
create or replace function public.schedule_share_updated(p_share uuid)
returns timestamptz language sql stable security definer set search_path to '' as $function$
  select greatest(
           (select max(e.updated_at) from public.schedule_events e
             where e.sched_project_id = s.sched_project_id and e.owner_user_id = s.owner_user_id),
           (select max(i.updated_at) from public.schedule_items i
              join public.schedule_events e on e.id = i.event_id
             where e.sched_project_id = s.sched_project_id and e.owner_user_id = s.owner_user_id
               and (s.all_lanes or i.lane = any (s.lanes))),
           (select p.updated_at from public.schedule_projects p where p.id = s.sched_project_id))
    from public.schedule_shares s where s.id = p_share;
$function$;
revoke all on function public.schedule_share_updated(uuid) from public, anon, authenticated;

create table if not exists public.schedule_share_feedback (
  id           uuid primary key default gen_random_uuid(),
  share_id     uuid not null references public.schedule_shares(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('ok', 'change')),
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  comment      text check (comment is null or char_length(comment) <= 1000),
  seen_updated timestamptz,
  ip_hash      text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index if not exists idx_ssf_share on public.schedule_share_feedback (share_id, created_at desc);
create index if not exists idx_ssf_owner on public.schedule_share_feedback (owner_user_id, created_at desc);
alter table public.schedule_share_feedback enable row level security;
alter table public.schedule_share_feedback force row level security;
revoke all on public.schedule_share_feedback from anon, authenticated;
-- 作った人は読むだけ（既読にするのは専用の処理で）

-- ---------- 相手が送る（登録なし） ----------
create or replace function public.send_schedule_feedback(p_token text, p_password text, p_kind text, p_name text, p_comment text, p_seen timestamptz)
returns boolean language plpgsql volatile security definer set search_path to '' as $function$
declare
  sh record; raw_ip text; iph text; fails_ip int; nm text; cm text; pj text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,64}$' then return false; end if;
  if p_kind not in ('ok', 'change') then raise exception '送る種類が正しくありません'; end if;
  nm := btrim(coalesce(p_name, ''));
  cm := nullif(btrim(coalesce(p_comment, '')), '');
  if char_length(nm) < 1 or char_length(nm) > 40 then raise exception 'お名前を40文字までで入れてください'; end if;
  if cm is not null and char_length(cm) > 1000 then raise exception 'ひとことは1000文字までにしてください'; end if;
  if p_kind = 'change' and cm is null then raise exception '直してほしいところを、ひとこと書いてください'; end if;

  begin
    raw_ip := split_part(coalesce(
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
      (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip', 'unknown'), ',', 1);
  exception when others then raw_ip := 'unknown'; end;
  iph := encode(extensions.digest(coalesce(btrim(raw_ip), 'unknown'), 'sha256'), 'hex');

  if btrim(coalesce(raw_ip, '')) not in ('', 'unknown') then
    select count(*) into fails_ip from public.schedule_share_access_log
     where ip_hash = iph and not ok and attempted_at > now() - interval '15 minutes';
    if fails_ip >= 10 then
      raise exception '認証の失敗が続いたため、しばらく送れません。15分ほど時間をおいてからお試しください。';
    end if;
  end if;

  select * into sh from public.schedule_shares where token = p_token;
  if sh.id is null or sh.revoked_at is not null
     or public.schedule_share_expiry(sh.id) < (now() at time zone 'Asia/Tokyo')::date
     or p_password is null
     or extensions.crypt(p_password, sh.password_hash) <> sh.password_hash then
    insert into public.schedule_share_access_log (share_id, ip_hash, ok) values (sh.id, iph, false);
    return false;
  end if;

  if (select count(*) from public.schedule_share_feedback where share_id = sh.id and created_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.schedule_share_feedback where ip_hash = iph and created_at > now() - interval '1 hour') >= 10 then
    raise exception '送る回数が多すぎます。しばらく時間をおいてからお試しください。';
  end if;

  insert into public.schedule_share_feedback (share_id, owner_user_id, kind, name, comment, seen_updated, ip_hash)
  values (sh.id, sh.owner_user_id, p_kind, nm, cm, p_seen, iph);

  select name into pj from public.schedule_projects where id = sh.sched_project_id;
  perform public.notify_push(sh.owner_user_id, 'schedule_feedback',
    '【Eizo Maps】' || nm || ' さんから香盤表の' || case when p_kind = 'ok' then '「OK」' else '「直してほしい」' end || 'が届きました',
    '案件：' || coalesce(pj, '') || chr(10) || 'リンク：' || sh.label || chr(10) || '送った人：' || nm || chr(10)
      || case when p_kind = 'ok' then 'OK です' else '直してほしいところがあります' end
      || case when cm is not null then chr(10) || chr(10) || cm else '' end,
    '/schedule/projects.html', 'ssf:' || sh.id);
  return true;
end;
$function$;
revoke all on function public.send_schedule_feedback(text, text, text, text, text, timestamptz) from public;
grant execute on function public.send_schedule_feedback(text, text, text, text, text, timestamptz) to anon, authenticated;

-- ---------- 作った人が見る ----------
create or replace function public.my_schedule_feedback(p_project_id uuid)
returns table (id uuid, share_id uuid, label text, kind text, name text, comment text,
               seen_updated timestamptz, created_at timestamptz, read_at timestamptz, current_updated timestamptz)
language sql stable security definer set search_path to '' as $function$
  select f.id, f.share_id, s.label, f.kind, f.name, f.comment, f.seen_updated, f.created_at, f.read_at,
         public.schedule_share_updated(s.id)
    from public.schedule_share_feedback f
    join public.schedule_shares s on s.id = f.share_id
   where s.sched_project_id = p_project_id and s.owner_user_id = auth.uid()
   order by f.created_at desc
   limit 200;
$function$;
revoke all on function public.my_schedule_feedback(uuid) from public, anon;
grant execute on function public.my_schedule_feedback(uuid) to authenticated;

create or replace function public.read_schedule_feedback(p_project_id uuid)
returns void language sql volatile security definer set search_path to '' as $function$
  update public.schedule_share_feedback f set read_at = now()
    from public.schedule_shares s
   where s.id = f.share_id and s.sched_project_id = p_project_id
     and s.owner_user_id = auth.uid() and f.read_at is null;
$function$;
revoke all on function public.read_schedule_feedback(uuid) from public, anon;
grant execute on function public.read_schedule_feedback(uuid) to authenticated;
