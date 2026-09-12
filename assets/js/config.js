/* =====================================================================
   EizoMaps — 接続設定
   ---------------------------------------------------------------
   ★ここだけ書き換えれば動きます。
     Supabase ダッシュボード > Project Settings > API Keys の
     「Project URL」と「anon public」キーを貼り付けてください。

   ★anon key はブラウザに埋め込む前提で作られた公開鍵です。
     GitHub に置いても問題ありません。
     service_role key は絶対にここへ書かないでください。
   ===================================================================== */

window.EM_CONFIG = {
  SUPABASE_URL:      'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  // 本番ドメイン（共有リンクの生成とメール認証の戻り先に使用）
  SITE_ORIGIN: 'https://eizo-maps.com',

  // 問い合わせ先
  CONTACT_EMAIL: 'info@eizo-maps.com',
  SUPPORT_EMAIL: 'support@eizo-maps.com'
};
