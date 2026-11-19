-- 071: 作品の業種を増やす（2026-11-19 翠くん「業種すくなくない？主要な映像業における業種選択ができるようにしてほしい」）
-- 電通さん「日本の広告費」の21業種をもとに、映像の仕事で多いもの（ブライダル・VTuber・ゲームなど）を足した35個。
-- 前からある17個の名前はそのまま（入れてある作品はそのまま使える）。画面の一覧は assets/js/page-portfolio.js の INDUSTRIES
alter table public.portfolios drop constraint if exists portfolios_industry_check;
alter table public.portfolios add constraint portfolios_industry_check check (industry is null or industry in (
  '食品・飲料','酒類','化粧品・美容','日用品・トイレタリー','医薬品・ヘルスケア','ファッション','家電・AV機器','家具・インテリア','趣味・スポーツ用品・おもちゃ','ゲーム・アプリ',
  '自動車','交通・旅行・ホテル','テーマパーク・レジャー','不動産・住宅',
  '飲食','小売・EC','美容室・サロン','ブライダル・冠婚葬祭','保険・金融','IT・通信','人材','教育','医療・介護','士業・コンサル',
  '製造・BtoB','建設','エネルギー・インフラ','行政・自治体','団体・NPO',
  'エンタメ・音楽','映画・アニメ','スポーツ（チーム・大会）','出版・メディア','VTuber・配信者',
  'その他'));
