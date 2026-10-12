/* Eizo Maps — ヘルプページの絞り込み
   入れた言葉を含む項目だけを表示し、開いた状態にする。外部への通信はしない。 */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var q = document.getElementById('helpQuery');
    if (!q) return;
    var items = Array.prototype.slice.call(document.querySelectorAll('.faq'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('.help-group'));
    var count = document.getElementById('helpCount');
    var empty = document.getElementById('helpEmpty');
    var toc = document.querySelector('.help-toc');

    function norm(s) {
      // 全角英数を半角に、カタカナをひらがなに、大文字を小文字にそろえて比べる
      return String(s || '')
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
        .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
        .toLowerCase();
    }
    items.forEach(function (d) { d._hay = norm(d.textContent + ' ' + (d.getAttribute('data-keywords') || '')); });

    function apply() {
      var words = norm(q.value).split(/[\s　]+/).filter(Boolean);
      var hits = 0;
      items.forEach(function (d) {
        var ok = words.every(function (w) { return d._hay.indexOf(w) !== -1; });
        d.hidden = !ok;
        if (ok) hits++;
        if (words.length) d.open = ok;
      });
      groups.forEach(function (g) {
        g.hidden = !g.querySelector('.faq:not([hidden])');
      });
      if (!words.length) {
        items.forEach(function (d) { d.open = false; });
        count.textContent = '';
      } else {
        count.textContent = hits ? hits + '件見つかりました' : '';
      }
      empty.hidden = hits !== 0;
      if (toc) toc.hidden = words.length > 0;
    }
    q.addEventListener('input', apply);

    // ?q=… で開いたときは、その言葉で絞り込んだ状態で表示する
    try {
      var p = new URLSearchParams(location.search).get('q');
      if (p) { q.value = p.slice(0, 50); apply(); }
    } catch (e) { /* 何もしない */ }
  });
})();
