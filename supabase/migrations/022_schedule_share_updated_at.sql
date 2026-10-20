-- =====================================================================
-- 022 共有されたスケジュールに「最終更新」の日時を出す（2026-10-20）
--   相手（チーム・クライアント）が「この予定表はいつ直されたものか」を分かるようにする。
--   open_schedule_share の返す中身に updated_at を足すだけ（作る・上書きだけ）。
-- =====================================================================

create or replace function public.open_schedule_share(p_token text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path to '' as $function$
declare
  sh       record;
  raw_ip   text;
  iph      text;
  fails_ip int;
  fails_sh int;
  matched  boolean := false;
  pj_name  text;
  owner_nm text;
  evs      jsonb;
  its      jsonb;
  upd      timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,64}$' then
    return null;
  end if;

  begin
    raw_ip := split_part(
      coalesce(
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for',
        (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'cf-connecting-ip',
        'unknown'),
      ',', 1);
  exception when others then
    raw_ip := 'unknown';
  end;
  iph := encode(extensions.digest(coalesce(btrim(raw_ip), 'unknown'), 'sha256'), 'hex');

  if raw_ip is not null and btrim(raw_ip) <> '' and btrim(raw_ip) <> 'unknown' then
    select count(*) into fails_ip
      from public.schedule_share_access_log
     where ip_hash = iph and not ok and attempted_at > now() - interval '15 minutes';
    if fails_ip >= 10 then
      raise exception '認証の失敗が続いたため、しばらく開けません。15分ほど時間をおいてからお試しください。';
    end if;
  end if;

  select * into sh from public.schedule_shares where token = p_token;

  if sh.id is not null then
    select count(*) into fails_sh
      from public.schedule_share_access_log
     where share_id = sh.id and not ok and attempted_at > now() - interval '15 minutes';
    if fails_sh >= 200 then
      raise exception '認証の失敗が続いたため、しばらく開けません。15分ほど時間をおいてからお試しください。';
    end if;
  end if;

  if sh.id is not null and sh.revoked_at is null
     and public.schedule_share_expiry(sh.id) >= (now() at time zone 'Asia/Tokyo')::date
     and p_password is not null
     and extensions.crypt(p_password, sh.password_hash) = sh.password_hash then
    matched := true;
  end if;

  insert into public.schedule_share_access_log (share_id, ip_hash, ok) values (sh.id, iph, matched);
  if random() < 0.02 then
    delete from public.schedule_share_access_log where attempted_at < now() - interval '2 days';
  end if;

  if not matched then
    return null;
  end if;

  update public.schedule_shares
     set view_count = view_count + 1, last_viewed_at = now()
   where id = sh.id;

  select name into pj_name from public.schedule_projects where id = sh.sched_project_id;
  select c.display_name into owner_nm from public.creators c where c.user_id = sh.owner_user_id;

  -- 大枠：どのリンクでも見える。場所・メモは「見せる」にしたリンクだけ
  select coalesce(jsonb_agg(x order by x.starts_on, x.start_time nulls first), '[]'::jsonb) into evs
  from (
    select e.id, e.kind, e.title, e.starts_on, e.ends_on, e.start_time, e.end_time,
           case when sh.show_details then e.location end as location,
           case when sh.show_details then e.note end as note
      from public.schedule_events e
     where e.sched_project_id = sh.sched_project_id
       and e.owner_user_id = sh.owner_user_id
     limit 500
  ) x;

  -- 小枠：選んだ班だけ（全部の班にしたリンクは全部）
  select coalesce(jsonb_agg(y order by y.day, y.start_min), '[]'::jsonb) into its
  from (
    select i.event_id, i.day, i.lane, i.title, i.start_min, i.end_min,
           case when sh.show_details then i.note end as note
      from public.schedule_items i
      join public.schedule_events e on e.id = i.event_id
     where e.sched_project_id = sh.sched_project_id
       and e.owner_user_id = sh.owner_user_id
       and (sh.all_lanes or i.lane = any (sh.lanes))
     limit 3000
  ) y;

  -- 最終更新：予定（大枠）・小枠・案件名のうち、いちばん新しく直された日時
  select greatest(
           (select max(e.updated_at) from public.schedule_events e
             where e.sched_project_id = sh.sched_project_id and e.owner_user_id = sh.owner_user_id),
           (select max(i.updated_at) from public.schedule_items i
              join public.schedule_events e on e.id = i.event_id
             where e.sched_project_id = sh.sched_project_id and e.owner_user_id = sh.owner_user_id
               and (sh.all_lanes or i.lane = any (sh.lanes))),            -- 見せていない班の更新は数えない
           (select p.updated_at from public.schedule_projects p where p.id = sh.sched_project_id))
    into upd;

  return jsonb_build_object(
    'project', pj_name,
    'updated_at', upd,
    'label', sh.label,
    'owner', owner_nm,
    'show_details', sh.show_details,
    'expires_on', public.schedule_share_expiry(sh.id),
    'events', evs,
    'items', its
  );
end;
$function$;

grant execute on function public.open_schedule_share(text, text) to anon, authenticated;
