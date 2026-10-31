-- =====================================================================
--  Eizo Maps / 040
--  作品の「媒体」（TVCM・WebCM・映画・ドラマ・バラエティ・MV・企業VP など）
--  ---------------------------------------------------------------
--  2026-10-31 翠くん：
--   「実績に関してはやっぱり CM 系とかに偏っちゃってるから、映画とかドラマとかバラエティとかっていう分け方は全然そのまま使っちゃってもいい」
--   「1は足します」（作品に媒体の欄を足す）
--  元の調べ：claude/Web開発部_職種の木と実績の分け方_まとめ.md の「3. 実績の分け方」
--  ★ 1作品に1つ。大きな分け方（広告・映画・ドラマ…）は画面側で持つ（assets/js/works-view.js の EM.MEDIA）
-- =====================================================================
alter table public.portfolios add column if not exists media text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'portfolios_media_check') then
    alter table public.portfolios add constraint portfolios_media_check check (media is null or media in
      ('TVCM','WebCM','ブランデッドムービー','屋外・サイネージ','グラフィック撮影','劇場映画','短編・自主映画','ドキュメンタリー映画','地上波ドラマ','配信ドラマ','縦型ショートドラマ','バラエティ','情報番組','報道・ニュース','ドキュメンタリー番組','歌番組','スポーツ中継','MV','ライブ映像','ライブ配信','YouTube番組','生配信','SNS縦型ショート','企業VP','採用動画','研修・マニュアル','イベント・セミナー収録','店舗紹介','TVアニメ','劇場アニメ','配信アニメ','OVA','アニメCM・PR','ゲーム映像','VTuber','舞台・演劇','プロジェクションマッピング','ウェディング・記念映像','メイキング','その他'));
  end if;
end $$;
create index if not exists idx_portfolios_media on public.portfolios (media) where media is not null;
grant select (media) on public.portfolios to anon, authenticated;
grant insert (media), update (media) on public.portfolios to authenticated;
