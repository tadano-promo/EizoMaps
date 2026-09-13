# Eizo Maps 構築手順書

上から順に進めてください。所要時間の目安は 1〜2時間です。
費用は発生しません（すべて無料枠）。

---

## フェーズ1：土台

### 1-1. Supabase プロジェクトを用意する

1. https://supabase.com にログインし、プロジェクトを開く（未作成なら New project）。
   - Region は **Northeast Asia (Tokyo)** を選ぶと表示が速くなります。
   - Database Password は控えておいてください（このサイトでは使いませんが、再発行が面倒です）。
2. 左メニュー **SQL Editor** を開く。
3. `supabase/schema.sql` の中身を**全部**貼り付けて **Run**。
   - 「NOTICE: ... does not exist, skipping」はすべて正常です（作り直しに備えた命令のため）。
   - 何度実行しても同じ結果になります。安心して再実行できます。
4. 続けて `supabase/verify.sql` を貼って **Run**。
   - 【1】の `result` がすべて `OK` であること
   - 【5】が **0行** であること
   この2つを必ず確認してください。

### 1-2. 認証の設定

**Authentication > Sign In / Providers**

- **Email**: 有効のまま。`Confirm email` は ON 推奨（迷惑登録を防げます）。
- **Google**: 使う場合のみ有効化。Google Cloud Console で OAuth クライアントを作り、
  Client ID / Secret を貼り付けます。Google 側の「承認済みのリダイレクト URI」には
  Supabase が表示する `https://<プロジェクト>.supabase.co/auth/v1/callback` を登録します。

**Authentication > URL Configuration**

| 項目 | 値 |
|---|---|
| Site URL | `https://eizo-maps.com` |
| Redirect URLs | `https://eizo-maps.com/**` と `http://localhost:8000/**` |

※ ここを設定しないと、確認メールのリンクや Google ログインが戻ってきません。

### 1-3. config.js を書き換える

**Project Settings > API Keys** から次の2つをコピーし、`assets/js/config.js` に貼ります。

- `Project URL` → `SUPABASE_URL`
- `anon` `public` キー → `SUPABASE_ANON_KEY`

> anon key はブラウザに埋め込む前提の公開鍵です。GitHub に置いて構いません。
> **`service_role` キーは絶対に貼らないでください。** これは DB のパスワードと同じ扱いです。

### 1-4. GitHub にアップする

このフォルダの中身をリポジトリ `tadano-promo/EizoMaps` の**ルート**に置いて push します。

```bash
git add .
git commit -m "Eizo Maps v1: フェーズ1〜2（土台＋コア機能）"
git push origin main
```

### 1-5. GitHub Pages を有効にする

**Settings > Pages**

- Source: **GitHub Actions** を選択
  （`.github/workflows/pages.yml` が自動でデプロイします）
- Custom domain: `eizo-maps.com` を入力して Save
- 証明書が発行されたら **Enforce HTTPS** にチェック（数分〜1時間ほどかかります）

### 1-6. DNS を設定する（さくらのコントロールパネル）

「ドメイン/SSL」→ 対象ドメイン →「ゾーン編集（DNSレコード設定）」。

**追加・変更するレコード**

| 種別 | ホスト名 | 値 |
|---|---|---|
| A | @（空欄） | 185.199.108.153 |
| A | @（空欄） | 185.199.109.153 |
| A | @（空欄） | 185.199.110.153 |
| A | @（空欄） | 185.199.111.153 |
| CNAME | www | tadano-promo.github.io. |

> IP アドレスは GitHub の公式ドキュメント
> 「Managing a custom domain for your GitHub Pages site」で最新の値をご確認ください。

### ⚠️ 絶対に触らないレコード

| 種別 | 内容 |
|---|---|
| MX | `atreyu-jp.sakura.ne.jp`（優先度10） |
| TXT | SPF |
| TXT | DKIM（セレクタ `rs20260910`） |
| TXT | DMARC |

これらを消すと `info@eizo-maps.com` / `support@eizo-maps.com` のメールが止まります。
**A レコードと www の CNAME だけ**を触ってください。

反映後、`info@eizo-maps.com` 宛にテストメールを送って受信できることを確認します。

### 1-7. Supabase の自動停止を防ぐ

無料プロジェクトは **7日間アクセスがないと一時停止** します。
`.github/workflows/keepalive.yml` が毎日1回 ping を打つので、下記を設定してください。

**Settings > Secrets and variables > Actions**

| 場所 | 名前 | 値 |
|---|---|---|
| Variables タブ | `SUPABASE_URL` | `https://<プロジェクト>.supabase.co` |
| Secrets タブ | `SUPABASE_ANON_KEY` | anon public キー |

設定したら **Actions > Supabase keepalive > Run workflow** で1回手動実行し、
`HTTP 200` と `"ok"` が返ることを確認してください。

> リポジトリが60日間まったく更新されないと、GitHub はスケジュール実行を自動停止します。
> その場合は同じ画面から手動実行すれば再開します。

---

## フェーズ2：動作確認

ブラウザで `https://eizo-maps.com` を開き、次を順に試します。

1. `/auth/` で新規登録 → 確認メールが届き、リンクを開くとログインできる
2. `/mypage/` で表示名・職種・エリアを入力し、「プロフィールを公開する」にチェックして保存
3. `/creators/` に自分が表示される。職種チップとエリア表示でも絞り込める
4. `/mypage/portfolio.html` で YouTube の URL を貼る → サムネイルが出る → 登録できる
5. 作品を1つ「限定リンクのみ」にする → `/creators/detail.html?id=...` に出ないことを確認
6. 共有リンクを発行 → コピーされた URL を**別のブラウザ（未ログイン）**で開き、
   選んだ作品だけが見えることを確認

### ローカルで試したいとき

```bash
cd EizoMaps
python3 -m http.server 8000
# http://localhost:8000 を開く
```

※ `file://` で直接開くと動きません（パスとブラウザの制限のため）。必ずサーバー経由で。

---

## デプロイ前チェックリスト

- [ ] `supabase/verify.sql` の【1】がすべて OK
- [ ] `supabase/verify.sql` の【5】が 0 行
- [ ] `supabase/verify.sql` の【4】に INSERT / UPDATE / DELETE が出ていない
- [ ] `service_role key` がリポジトリのどこにも無い（`git grep service_role` で確認）
- [ ] `.gitignore` に `.env` が含まれている
- [ ] 別アカウント（またはログアウト状態）で他人の非公開データが見えない
- [ ] `reports` テーブルが本人以外から読めない
- [ ] MX / SPF / DKIM / DMARC を変更していない
- [ ] `info@eizo-maps.com` でメールを受信できる
- [ ] HTTPS（Enforce HTTPS）が有効
- [ ] スマートフォン表示が崩れていない
- [ ] keepalive の手動実行が成功している
- [ ] 案件のステータスが、決められた役割以外からは変更できない
- [ ] 投稿直後の評価が公開されていない（`pending` のまま）
- [ ] 他人の問題報告が読めない

---

## 運営作業のやり方

### 自分を管理者にする

SQL Editor で実行します（`app_admins` はフロントからは操作できません）。

```sql
insert into public.app_admins (user_id, note)
select id, '運営' from auth.users where email = 'あなたのメールアドレス';
```

### 評価を公開する（当面は目視確認）

投稿された評価は `pending` のまま保留されます。内容を確認して公開します。

```sql
-- 保留中の評価を見る
select r.id, r.score, r.comment, r.created_at
from public.reviews r where r.status = 'pending' order by r.created_at;

-- 公開する
update public.reviews
   set status = 'published', published_at = now()
 where id = '（上で確認したID）';

-- 却下する
update public.reviews set status = 'rejected' where id = '（ID）';
```

> 件数が増えてきたら自動フィルタを検討します。最初から AI 審査は作り込みません。

### 問題報告を確認する

```sql
select * from public.reports order by created_at desc;
```

報告内容は公開されません。行政の相談窓口への案内は `/contact/` に掲載済みです。

---

## フェーズ3（取引機能）について

依頼から評価までが一通り動きます。DBの追加分は `supabase/schema.sql` の
**セクション20** に入っているので、フェーズ2の時点で一度実行済みの場合も、
**もう一度 schema.sql を最初から流し直してください**（何度実行しても安全です）。

| 画面 | パス |
|---|---|
| 依頼フォーム | `/request/?creator_id=...` |
| 案件一覧・詳細 | `/projects/` `/projects/?id=...` |
| 評価投稿 | `/projects/review.html?id=...` |
| 問題報告 | `/report/` |

### ステータス遷移の決まり

誰がどのステータスに進められるかは、DB側のトリガで固定しています。
画面のボタンを書き換えても、ルール外の変更はデータベースが拒否します。

| 変更 | 実行できる人 |
|---|---|
| 下書き → 依頼中 | クライアント |
| 依頼中 → 進行中 | どちらでも |
| 進行中 → 納品済み | クリエイター |
| 納品済み → 入金済み | クライアント |
| 入金済み → 完了 | どちらでも |
| 依頼中・進行中 → キャンセル | どちらでも |

入金済み以降は巻き戻せません。各ステータスに入った日時は自動で記録され、
利用者側からは書き換えられません（列の書き込み権限を渡していないため）。

### 通知について

**メール通知は実装していません。** メール送信には外部サービスの契約が必要で、
ランニングコスト0円の方針から外れるためです。
依頼が届いたことは、クリエイターが `/projects/` を開くと分かります。

当面はアトレイユファミリーのコミュニティ（Discord等）で
「依頼が来たら案件管理を見る」という運用でカバーしてください。
将来メール通知が必要になったら、Supabase Edge Functions と
メール配信サービスの組み合わせを改めてご相談します。

### 動作確認の手順

アカウントを2つ（クリエイター役・クライアント役）用意して試します。

1. クライアント役で `/creators/` からクリエイターを開き、「依頼する」
2. フォームを送信 → `/projects/` に「依頼した案件」として出る
3. クリエイター役でログイン → 「受けた案件」に出る
4. どちらかが「進行中にする」→ クリエイター役で「納品済みにする」
5. クライアント役で「入金済みにする」→「完了にする」
6. 双方で「相手を評価する」→ 投稿後は `pending` のまま公開されないことを確認
7. 運営として SQL Editor で `published` に変更 → クリエイター詳細ページに匿名で表示される
8. `/report/` から問題報告を送り、別アカウントでは一切見えないことを確認

### 評価の公開作業

投稿された評価は保留されたままなので、運営が確認して公開します。
手順は下の「運営作業のやり方」に書いてあります。

---

## 法務まわりの確認のお願い

`terms/`（利用規約）、`privacy/`（プライバシーポリシー）、`legal/`（特定商取引法に基づく表記）は
一般的な雛形をもとにした**たたき台**です。公開前に内容をご確認ください。
特に次の箇所は事実に合わせて修正が必要です。

- `legal/index.html` の所在地・電話番号の表記方法
- 事業者名・運営統括責任者の表記
- 有料プランを開始する際の価格・支払方法・返金条件

内容によっては専門家の確認をおすすめします。
