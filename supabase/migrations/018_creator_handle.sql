-- =====================================================================
-- 018 クリエイターの @ハンドル（2026-10-15）
--   ・プロフィールのアドレスを eizo-maps.com/@ハンドル にする
--   ・同じハンドルは絶対に2人に付かない（大文字小文字も区別せず1つだけ）
--   ・使われている／使えないときは、理由と空いている候補を返す
--   ※ 「消す・外す」系の命令は使わない（確認画面で止まるため）
-- =====================================================================

alter table public.creators add column if not exists handle text;

-- 形の決まり：半角英小文字・数字・アンダーバー、3〜20文字
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'creators_handle_format') then
    alter table public.creators
      add constraint creators_handle_format
      check (handle is null or handle ~ '^[a-z0-9_]{3,20}$');
  end if;
end $$;

-- 同じハンドルは1人だけ（最後の砦。画面の確認をすり抜けても DB が止める）
create unique index if not exists creators_handle_unique on public.creators (handle);

-- 誰でも見られるのはハンドルだけ（他の列の見え方は今まで通り）
grant select (handle) on public.creators to anon, authenticated;

-- ---------- 使えない言葉（運営・ページ名と紛らわしいもの） ----------
create or replace function public.handle_is_reserved(p text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p = any (array[
    'admin','administrator','root','system','support','info','help','contact','official',
    'eizo','eizomaps','eizo_maps','atreyu','staff','team','operator','moderator','mod',
    'api','app','www','mail','auth','login','logout','signup','register','settings',
    'mypage','creators','creator','projects','project','schedule','request','report',
    'features','feature','news','terms','privacy','legal','share','stock','search',
    'null','undefined','test','anonymous','guest','user','users','me','you'
  ]);
$function$;

-- ---------- 空いている候補をつくる ----------
create or replace function public.handle_suggestions(p_base text, p_count int default 5)
returns text[]
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  base text;
  cand text;
  out  text[] := array[]::text[];
  suffixes text[] := array['', '_film','_movie','_works','_video','_studio','_create','_edit','_cam'];
  s text;
  i int;
begin
  -- 使えない文字はアンダーバーに置きかえ、続いたアンダーバーは1つにまとめる
  base := regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_]', '_', 'g');
  base := regexp_replace(base, '_+', '_', 'g');
  base := trim(both '_' from base);
  if char_length(base) < 3 then base := base || 'creator'; end if;
  base := left(base, 14);

  foreach s in array suffixes loop
    cand := left(base, 20 - char_length(s)) || s;
    if cand ~ '^[a-z0-9_]{3,20}$'
       and not public.handle_is_reserved(cand)
       and not exists (select 1 from public.creators where handle = cand)
       and not (cand = any (out))
       and cand <> lower(coalesce(p_base, '')) then
      out := out || cand;
    end if;
    exit when cardinality(out) >= p_count;
  end loop;

  i := 0;
  while cardinality(out) < p_count and i < 40 loop
    i := i + 1;
    cand := left(base, 17) || lpad((floor(random() * 1000))::int::text, 2, '0');
    if cand ~ '^[a-z0-9_]{3,20}$'
       and not public.handle_is_reserved(cand)
       and not exists (select 1 from public.creators where handle = cand)
       and not (cand = any (out)) then
      out := out || cand;
    end if;
  end loop;

  return out;
end;
$function$;

-- ---------- 使えるか確かめる（入力中に呼ぶ） ----------
create or replace function public.handle_check(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  h text := lower(trim(coalesce(p_handle, '')));
  mine text;
begin
  if left(h, 1) = '@' then h := substr(h, 2); end if;

  if h !~ '^[a-z0-9_]{3,20}$' then
    return jsonb_build_object('ok', false, 'reason', 'format', 'handle', h,
      'suggestions', to_jsonb(public.handle_suggestions(h, 5)));
  end if;
  if public.handle_is_reserved(h) then
    return jsonb_build_object('ok', false, 'reason', 'reserved', 'handle', h,
      'suggestions', to_jsonb(public.handle_suggestions(h, 5)));
  end if;

  select handle into mine from public.creators where user_id = auth.uid();
  if mine is not null and mine = h then
    return jsonb_build_object('ok', true, 'reason', 'mine', 'handle', h);
  end if;

  if exists (select 1 from public.creators where handle = h) then
    return jsonb_build_object('ok', false, 'reason', 'taken', 'handle', h,
      'suggestions', to_jsonb(public.handle_suggestions(h, 5)));
  end if;

  return jsonb_build_object('ok', true, 'reason', 'free', 'handle', h);
end;
$function$;

-- ---------- 自分のハンドルを決める・変える ----------
create or replace function public.set_my_handle(p_handle text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  h text := lower(trim(coalesce(p_handle, '')));
  chk jsonb;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if not exists (select 1 from public.creators where user_id = auth.uid()) then
    raise exception '先にクリエイタープロフィールを作成してください';
  end if;
  if left(h, 1) = '@' then h := substr(h, 2); end if;

  chk := public.handle_check(h);
  if not (chk->>'ok')::boolean then
    return chk;
  end if;

  begin
    update public.creators set handle = h where user_id = auth.uid();
  exception when unique_violation then
    -- ほぼ同時に同じハンドルを取られたとき
    return jsonb_build_object('ok', false, 'reason', 'taken', 'handle', h,
      'suggestions', to_jsonb(public.handle_suggestions(h, 5)));
  end;

  return jsonb_build_object('ok', true, 'reason', 'saved', 'handle', h);
end;
$function$;

-- ---------- @ハンドルからプロフィールを探す（公開ページ用） ----------
create or replace function public.creator_id_by_handle(p_handle text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select id from public.creators
   where handle = lower(trim(both '@' from coalesce(p_handle, '')))
     and is_published
   limit 1;
$function$;

grant execute on function public.handle_check(text) to anon, authenticated;
grant execute on function public.set_my_handle(text) to authenticated;
grant execute on function public.creator_id_by_handle(text) to anon, authenticated;
