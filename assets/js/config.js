/* =====================================================================
   Eizo Maps — 接続設定
   ---------------------------------------------------------------
   ★ここだけ書き換えれば動きます。
     Supabase ダッシュボード > Project Settings > API Keys の
     「Publishable key」（sb_publishable_... で始まる鍵）を貼り付けてください。

   ★Publishable key はブラウザに埋め込む前提で作られた公開鍵です。
     GitHub に置いても問題ありません。
     Secret key（sb_secret_... ）は絶対にここへ書かないでください。
   ===================================================================== */

window.EM_CONFIG = {
  SUPABASE_URL:      'https://buquisjkkwvekoyuuxjx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_O21oZnU9tBQgLJVNDFisKg_BFsPqVKc',

  // 本番ドメイン（共有リンクの生成とメール認証の戻り先に使用）
  SITE_ORIGIN: 'https://eizo-maps.com',

  // 問い合わせ先
  CONTACT_EMAIL: 'info@eizo-maps.com',
  SUPPORT_EMAIL: 'support@eizo-maps.com'
};
