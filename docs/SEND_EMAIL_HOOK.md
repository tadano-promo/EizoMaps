# 確認メールに「文字だけの版」を付ける（Send Email Hook）

登録・ログイン・パスワード再設定のメールを、Supabase の標準の送り方（HTML だけ）から、
関数 `send-email` の送り方（文字だけの版＋HTML の2つ入り）に切りかえる手順。

## しくみ
- Supabase Auth がメールを送る代わりに、関数 `supabase/functions/send-email` を呼ぶ
- 関数は合言葉（署名）で「本当に Supabase Auth から来たか」を確かめてから、さくらのメールサーバーに 465番で送る
- 送れなかったときは、画面に「メールを送れませんでした」と出る（黙って消えない）

## 本番に入れる順番
1. Web開発部：関数 `send-email` を Supabase に置く（JWT の確認は切る。合言葉で確かめるため）。置いただけでは何も変わらない
2. 翠くん：Supabase の Edge Functions > Secrets に入れる
   - `SMTP_HOST` … Authentication > Emails > SMTP Settings の「Host」と同じもの
   - `SMTP_USER` … 同じ画面の「Username」と同じもの
   - `SMTP_PASS` … さくらのメールのパスワード
   - `MAIL_FROM` … `Eizo Maps <info@eizo-maps.com>`
3. 翠くん：Authentication > Auth Hooks > 「Send Email」を追加
   - 種類：HTTPS／URL：`https://buquisjkkwvekoyuuxjx.supabase.co/functions/v1/send-email`
   - 「Generate secret」で作った合言葉（`v1,whsec_...`）を、2 の Secrets に `SEND_EMAIL_HOOK_SECRET` として入れる
4. 翠くん：別のメールアドレスで新規登録してみる → メールが届く・リンクで登録が終わる、を確かめる
   - うまくいかなければ、Auth Hooks の「Send Email」をオフにする → すぐ今までの送り方に戻る

## 気をつけること
- 文面は関数の中（`bodyFor`）にある。Supabase の画面の「Email Templates」は、フックをオンにしている間は使われない
- メールアドレス・リンク・コードは記録（ログ）に出さない
