/* Eizo Maps — 機能紹介ページ
   ログインしている人には「無料で作ってみる」の代わりに、その機能の画面へのボタンを出す。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    if (!EM.getUser) return;
    EM.getUser().then(function (u) {
      if (!u) return;
      EM.$$('[data-cta-out]').forEach(function (a) { a.hidden = true; });
      EM.$$('[data-cta-in]').forEach(function (a) { a.hidden = false; });
    });
  });
})(window.EM);
