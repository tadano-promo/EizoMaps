/* Eizo Maps — 404 ページでの簡易ルーティング
   GitHub Pages は静的配信のため /p/{token} のような動的パスを直接返せない。
   存在しないパスは 404.html が返るので、ここで正規のページへ振り分ける。
   （通常の共有リンクは最初から /p/?t=... の形で発行されるため、
     ここを通るのは手打ちや古いリンクのときだけ） */
(function () {
  'use strict';
  var path = location.pathname;
  var m;

  m = path.match(/^\/p\/([0-9a-f]{32})\/?$/i);
  if (m) { location.replace('/p/?t=' + encodeURIComponent(m[1].toLowerCase())); return; }

  m = path.match(/^\/creators\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  if (m) { location.replace('/creators/detail.html?id=' + encodeURIComponent(m[1])); return; }

  document.addEventListener('DOMContentLoaded', function () {
    var n = document.getElementById('notFoundMsg');
    if (n) n.textContent = 'お探しのページ（' + path + '）は見つかりませんでした。';
  });
})();
