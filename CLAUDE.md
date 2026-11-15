# Eizo Maps — 作るときの決まり

## クリエイター側とクライアント側を、毎回両方考える（2026-11-15 翠くん）
- 機能を足す・直すときは、毎回「クリエイター側」「クライアント側」の両方でどう見えるか・何が要るかを考えて、両方を更新する。
  - 例：トップの部品を足したら、クライアント用の部品（page-home.js の CLIENT_WIDGETS）にも要るか考える。
  - 例：メニューに項目を足したら、NAV_USER（クリエイター）と NAV_CLIENT（クライアント）の両方を見直す。
- 登録の種類は users.account_type（creator／client／both）。いまの使い方は EM.viewModeFor(type)、帯とメニューは app.js の mountModeBand・NAV_CLIENT。
- マイページ：クリエイター＝/mypage/、クライアント＝/mypage/client/。
- 色：クリエイター＝黄色（--accent）、クライアント＝青（--client）。
- 確認用アカウント：クライアント側は ikuzak8.s.s@gmail.com のブラウザで実際に開いて確かめる。
