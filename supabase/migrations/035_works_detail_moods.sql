-- 035: 作品の詳細・ショーリール・雰囲気（2026-10-30 翠くん「全部おけ」：dadabさん・TYOさん・goodportfolioさんの参考10案）
-- ・作品に「年」「ほかのスタッフ（クレジット）」を足す（TYOさんの「項目名 → 中身」の表）
-- ・作品の1本を「ショーリール」にできる（1人1本。プロフィールの上の「SHOWREEL」ボタンで再生）
-- ・クリエイターに「雰囲気」を3つまで（探す画面の絞り込みに使う。goodportfolioさんの「雰囲気」）

alter table public.portfolios
  add column if not exists work_year integer,
  add column if not exists credits text,
  add column if not exists is_showreel boolean not null default false;

alter table public.portfolios
  add constraint portfolios_work_year_check check (work_year is null or work_year between 1950 and 2100),
  add constraint portfolios_credits_len check (credits is null or char_length(credits) between 1 and 500);

alter table public.creators
  add column if not exists moods text[] not null default '{}';

alter table public.creators
  add constraint creators_moods_check check (
    cardinality(moods) <= 3
    and moods <@ array['シネマティック','ドキュメンタリー','ポップ','クール','やさしい','ユニーク','シンプル','上品','エネルギッシュ','かわいい']::text[]);

grant select (work_year, credits, is_showreel) on public.portfolios to anon, authenticated;
grant insert (work_year, credits, is_showreel), update (work_year, credits, is_showreel) on public.portfolios to authenticated;
grant select (moods) on public.creators to anon, authenticated;
grant insert (moods), update (moods) on public.creators to authenticated;

-- ショーリールは1人1本：新しく選んだら、ほかの作品のショーリールは外す
create or replace function public.portfolios_one_showreel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_showreel and (tg_op = 'INSERT' or not old.is_showreel) then
    update public.portfolios set is_showreel = false
     where creator_id = new.creator_id and id <> new.id and is_showreel;
  end if;
  return new;
end;
$$;
create trigger trg_portfolios_one_showreel after insert or update of is_showreel on public.portfolios
  for each row when (new.is_showreel) execute function public.portfolios_one_showreel();
