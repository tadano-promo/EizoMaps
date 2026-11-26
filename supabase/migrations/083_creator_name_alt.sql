-- =====================================================================
--  083: 名前の読み・別の表記（2026-11-27 翠くん「SEO を強くしたい」）
--  ・活動名が英字・漢字のとき、カタカナや別の書き方で検索されても、本人のページが出るようにする
--  ・公開ページの名前の下に小さく出し、検索エンジン向けの説明にも入れる（見えない文字として隠すことはしない）
-- =====================================================================
alter table public.creators add column if not exists name_alt text
  check (name_alt is null or char_length(name_alt) <= 80);
grant select (name_alt) on public.creators to anon, authenticated;
grant insert (name_alt) on public.creators to authenticated;
grant update (name_alt) on public.creators to authenticated;
