# Google カレンダー連携の設定手順

コードとデータベースの準備は終わっています。
ここに書いてあるのは、**鍵とアカウントを扱うため、運営本人しかできない作業**だけです。

連携は任意の機能です。連携しなくても Eizo Maps は今までどおり動きます。
連携した人だけ、予定が Google カレンダーにも入り、Google 側の予定も
「埋まっている日」に含められるようになります。

**発表は Google の審査が通ってからです。** 審査前でも、下の手順6まで終われば
自分のアカウントで動作を確認できます。

---

## 1. Google Cloud で OAuth クライアントを作る

1. https://console.cloud.google.com/ を開き、新しいプロジェクトを作る（名前は `Eizo Maps` など）。
2. 「API とサービス」→「ライブラリ」→ **Google Calendar API** を検索して **有効にする**。
3. 「API とサービス」→「OAuth 同意画面」
   - User Type は **外部（External）**
   - アプリ名：`Eizo Maps`
   - ユーザーサポートメール：`info@eizo-maps.com`
   - アプリのホームページ：`https://eizo-maps.com/`
   - プライバシーポリシー：`https://eizo-maps.com/privacy/`
   - 利用規約：`https://eizo-maps.com/terms/`
   - 承認済みドメイン：`eizo-maps.com`
   - デベロッパーの連絡先：`info@eizo-maps.com`
4. 「スコープ」で次の2つを追加する。
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`
5. 「テストユーザー」に自分の Google アカウントを追加する。
6. 「認証情報」→「認証情報を作成」→ **OAuth クライアント ID**
   - 種類：**ウェブアプリケーション**
   - 承認済みのリダイレクト URI に、次の1行をそのまま貼る。

     ```
     https://buquisjkkwvekoyuuxjx.supabase.co/auth/v1/callback
     ```

   - 作成すると **クライアント ID** と **クライアント シークレット** が出る。
     このあと使うので、閉じずに置いておく。

---

## 2. Supabase に Google ログインを設定する

**Authentication → Sign In / Providers → Google**

- Google を **有効化**
- Client ID と Client Secret に、手順1で出た値を貼る
- 保存

**Authentication → URL Configuration → Redirect URLs**

次の2行を追加する。

```
https://eizo-maps.com/schedule/
https://eizo-maps.com/schedule/*
```

**Authentication → Sign In / Providers（ページ下部）→ Manual Linking**

- **有効にする**（すでにメールで登録している人が、あとから Google を足せるようにするため）

---

## 3. 暗号化の鍵を作る

Google の許可（リフレッシュトークン）は、そのままデータベースに入れません。
Edge Function が暗号化してから入れ、鍵は Edge Function の中にしか置きません。
こうしておくと、仮にデータベースを丸ごと抜かれても、その許可は使えません。

鍵は次のコマンドで作ります（Mac / Linux のターミナル）。

```
openssl rand -base64 32
```

Windows なら PowerShell で：

```
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

出てきた文字列を控えておきます。**この鍵は誰にも見せないでください。**
なくすと、連携済みの人が全員つなぎ直しになります。

---

## 4. Edge Function を置く

**Supabase ダッシュボード → Edge Functions → Deploy a new function → Via Editor**

- 関数名：`google-calendar`
- 中身：`supabase/functions/google-calendar/index.ts` の内容をそのまま貼り付け
- Deploy

---

## 5. Edge Function に鍵を登録する

**Edge Functions → Secrets（または Project Settings → Edge Functions）**

次の3つを登録します。

| 名前 | 値 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | 手順1のクライアント ID |
| `GOOGLE_CLIENT_SECRET` | 手順1のクライアント シークレット |
| `TOKEN_ENC_KEY` | 手順3で作った文字列 |

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Supabase が自動で入れるので、
自分で登録する必要はありません。

---

## 6. 動作を確かめる

1. `https://eizo-maps.com/schedule/` を開く。
2. いちばん下の「Google カレンダー連携」で **連携する** を押す。
3. Google の画面で許可する（審査前なので「このアプリは確認されていません」と出ます。
   テストユーザーに自分を入れてあるので、詳細を開けば進めます）。
4. 戻ってきたら、予定をいくつか作って **今すぐ同期する** を押す。
5. Google カレンダー側に `[撮影] 本編撮影` のように入っていれば成功です。

**注意：審査前（Testing 状態）のあいだは、Google の許可が7日で切れます。**
7日経つと同期が止まるので、そのつど連携し直してください。
Production に上がれば起きなくなります。

---

## 7. 審査に出す

自分のアカウントで問題なく動くことを確認してから。

1. Google Search Console で `eizo-maps.com` の所有権を確認しておく。
2. OAuth 同意画面で **アプリを公開（Production に変更）** する。
3. **確認を申請**する。求められるもの：
   - スコープが必要な理由の説明
     （例：ユーザー自身が Eizo Maps に登録した撮影・編集・納品の予定を、
     本人の Google カレンダーに書き出すため。読み取りは空き時間の判定にのみ使用し、
     予定の件名や場所は取得も保存もしない）
   - 操作の様子を撮った YouTube 動画
     （連携ボタン → Google の同意画面 → 戻ってきて同期 → カレンダーに入る、までを画面録画）
4. 通常 **3〜5営業日**で結果が返ってきます。費用はかかりません。
5. 通ったら、警告画面も100人の上限も消えます。**ここで発表します。**

---

## 何を Google に渡していて、何を渡していないか

| 項目 | 内容 |
| --- | --- |
| Google へ書き出すもの | 予定の件名（種別つき）・説明・場所・日時 |
| Google から取り込むもの | **埋まっている時間帯だけ**。件名・場所・参加者は取得しない |
| 保存する許可 | リフレッシュトークンを AES-GCM で暗号化したもののみ |
| 復号の鍵の置き場所 | Edge Function の環境変数だけ。データベースには無い |
| 連携テーブルの権限 | anon にも authenticated にも一切与えていない |
| 連携を解除したとき | Google 側で許可を取り消し、こちらの保存分も削除する |
