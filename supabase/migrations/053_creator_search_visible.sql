-- =====================================================================
--  053: クリエイターのページを Google などの検索に出すかを、本人が選べるようにする（2026-11-15 翠くん）
--  ・search_visible：true＝出す／false＝出さない／null＝まだ選んでいない
--  ・これから登録する人は、プロフィールを作るときに必ずどちらかを選ぶ（画面で必須）
--  ・すでに登録している人は「出す」にした（もともと検索に出ていたため・翠くん「出る設定だったことにしといて」）
--  ・false の人のページ（/@ハンドル）は「検索に出さない」印を付け、サイトの地図にも載せない
-- =====================================================================
alter table public.creators add column if not exists search_visible boolean;
alter table public.creators add column if not exists search_visible_at timestamptz;

grant select (search_visible) on public.creators to anon, authenticated;
grant insert (search_visible) on public.creators to authenticated;
grant update (search_visible) on public.creators to authenticated;

-- 選んだ日時を残す（あとで「いつ選んだか」を確かめられるように）
create or replace function public.creator_search_visible_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.search_visible is not null and (tg_op = 'INSERT' or new.search_visible is distinct from old.search_visible) then
    new.search_visible_at := now();
  elsif tg_op = 'UPDATE' then
    new.search_visible_at := old.search_visible_at;
  end if;
  return new;
end $$;
drop trigger if exists creator_search_visible_stamp on public.creators;
create trigger creator_search_visible_stamp before insert or update on public.creators
  for each row execute function public.creator_search_visible_stamp();

-- 前から登録していた人：もともと検索に出ていたので「出す」にする（2026-11-15 実行済み）
update public.creators set search_visible = true where search_visible is null;
