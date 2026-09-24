# Eizo Maps

> クリエイターとクライアントを対等につなぐ、映像制作の信頼プラットフォーム

- 本番ドメイン: `eizo-maps.com`
- 構成: GitHub Pages（静的配信） + Supabase（DB・認証・ストレージ）
- ランニングコスト: 0円（無料枠のみ）
- フレームワーク不使用 / ビルド工程なし。HTML を置けばそのまま動きます。

はじめて構築する場合は **[docs/DEPLOY.md](docs/DEPLOY.md)** を上から順に進めてください。

---

## ファイル構成

```
/
├── index.html               トップ
├── 404.html                 見つからないページ（/p/{token} 等の振り分けも担当）
├── auth/                    ログイン・新規登録
├── creators/
│   ├── index.html           検索・一覧・エリア表示
│   └── detail.html          クリエイター詳細（?id=...）
├── mypage/
│   ├── index.html           プロフィール編集
│   └── portfolio.html       ポートフォリオ管理・共有リンク発行
├── p/index.html             限定共有ページ（?t={token}）
├── request/index.html       依頼フォーム（?creator_id=...）
├── projects/
│   ├── index.html           案件一覧・詳細（?id=...）
│   └── review.html          評価投稿（?id=...）
├── report/index.html        問題報告フォーム
├── terms/ privacy/ legal/ contact/
├── assets/
│   ├── css/style.css        共通スタイル（ダークテーマ）
│   └── js/
│       ├── config.js        ★接続設定。ここだけ書き換える
│       ├── app.js           共通ライブラリ（DOM生成・認証・XSS対策）
│       ├── video.js         YouTube/Vimeo のURL解析とサムネイル取得
│       ├── router.js        404 からの振り分け
│       └── page-*.js        各ページの処理
├── supabase/
│   ├── schema.sql           ★テーブル・RLS・権限・初期データ（これ1本で完結）
│   └── verify.sql           セキュリティ確認クエリ（読み取りのみ）
├── .github/workflows/
│   ├── pages.yml            GitHub Pages への自動デプロイ + 鍵の混入チェック
│   └── keepalive.yml        Supabase 自動停止を防ぐ毎日1回の ping
├── CNAME                    eizo-maps.com
└── docs/DEPLOY.md           構築手順書
```

---

## セキュリティ設計（この3点が守られている限り、外部から書き換えられません）

1. **全テーブルで RLS を有効化（FORCE 付き）**
   `supabase/schema.sql` の末尾で、14テーブルすべてに `enable row level security` と
   `force row level security` を適用しています。ポリシーの無いテーブル（`app_admins`）は
   「誰も読めない・書けない」状態が正解です。

2. **列単位の権限で「触らせたくない列」を守る**
   RLS は行しか守れません。そこで `anon` / `authenticated` からいったん全権限を剥奪し、
   必要な列だけを `GRANT` し直しています。
   - `reviews.status` を渡していない → 自分の評価を勝手に「公開済み」にできない
   - `share_links.token` を渡していない → 共有リンクのトークンを偽造できない
   - `projects.delivered_at` 等を渡していない → 証跡の日時を改ざんできない
   - `app_admins` に一切権限なし → 自分を管理者にできない

3. **限定公開の作品はテーブルを直接読ませない**
   `visibility='link_only'` の作品は RLS で誰にも見えません。
   トークンを知っている人だけが `get_share_link()` という関数経由で取得できます。

加えて:
- フロントエンドは**ユーザー入力を `innerHTML` に渡しません**（`EM.el()` + `textContent`）。
  レビューやプロフィールに `<script>` を書かれても、文字として表示されるだけです。
- 全ページに Content-Security-Policy を設定し、読み込める外部リソースを限定しています。
- 外部 JS（supabase-js）は SRI ハッシュ付きで固定バージョンを読み込みます。
- デプロイ時に `service_role` らしき文字列が混入していないか自動チェックします。

**service_role key は、このリポジトリのどこにも書かないでください。**
anon key は公開前提の鍵なので `config.js` に書いて問題ありません。

---

## ストックページ（パスワード保護）

`/s/?u=<ページのURL>` で開く、パスワードを知っている人だけが見られるページです。
クリエイター1人につき1ページ、`/mypage/stock.html` から編集します。

守り方は次のとおりです。

- ページの中身（`stock_pages` / `stock_items`）は anon にも authenticated にも
  **テーブルとして一切読ませません**。閲覧の入口は `open_stock_page` RPC 1本だけです。
- パスワードは bcrypt（コスト10）でハッシュ化して保存します。
  `password_hash` 列には **SELECT 権限も UPDATE 権限も与えていません**。
  設定は `set_stock_password` RPC を通す以外に方法がありません。
- スラッグが違う場合とパスワードが違う場合で**同じ `null`** を返し、
  ページの存在を推測させません。
- 総当たり対策として、接続元ごとに15分で10回、ページごとに15分で200回を超える
  失敗でロックします（`stock_access_log`。IP は SHA-256 ハッシュで保存し、
  このテーブルには誰にも権限を与えていません）。
- 資料は外部サービス（Google ドライブ等）の共有リンクを並べる方式です。
  ファイル自体は預かりません。

## 運営（管理者）と、お知らせ・広告

トップページの一番上に出る「お知らせ」と、その横の広告枠は、
`/admin/` の管理画面から運営が登録します。

**管理者の決め方**

管理者かどうかは `app_admins` テーブルだけで決まります。
このテーブルには anon にも authenticated にも権限を与えていないため、
画面からは誰も自分を管理者にできません。増やすときは SQL Editor で:

```sql
insert into public.app_admins (user_id, note)
select id, '運営' from auth.users where email = 'admin@eizo-maps.com'
on conflict (user_id) do nothing;
```

**「運営専用の合言葉」を作らない理由**

静的サイトなので、画面側で合言葉を照合しても意味がありません
（ブラウザの中は誰でも書き換えられます）。
代わりに、運営専用のアカウントで普通にログインし、そのアカウントだけを
`app_admins` に入れる方式にしています。誰が操作したか記録が残り、
権限の付け外しも1行で済みます。

**守り方**

- 管理画面は「運営が使いやすいか」だけを担当します。
  書き込めるかどうかは RLS と管理者専用 RPC が決めるため、
  画面のコードを書き換えて管理画面を開いても、保存は通りません。
- 広告は画像とリンクだけを持ちます。外部の広告スクリプトは読み込みません。
- 記事（`articles`）は `status` / `published_at` / `source` / `author_user_id` を
  一般ユーザーに GRANT していません。執筆を許可された人は下書きと
  「確認待ち」までしか動かせず、**公開できるのは運営だけ**です。
- 将来の自動下書き（Claude の定期タスクなど）は `source='auto'` として
  service_role で投入する想定です。status は必ず `draft` から始まります。

## 変更するときの注意

- テーブルを追加したら、**必ず** `enable row level security` と `force row level security`、
  そして必要な `grant` を書いてください。Supabase の既定では新しいテーブルに
  権限が自動で付くため、`schema.sql` の `alter default privileges` でそれを止めています。
- 変更後は `supabase/verify.sql` を実行し、【1】に NG が無いこと、
  【5】が0行であることを確認してください。

## やらないこと

`docs/DEPLOY.md` および構築指示書のとおり、以下は実装しません。

- 未払い情報の実名公開・ブラックリスト公開
- Google Maps API のフル実装（エリア表示で代替）
- 動画ファイルの直接アップロード
- サイト内での決済・EC 機能
- React / Next.js 等のフレームワーク導入
