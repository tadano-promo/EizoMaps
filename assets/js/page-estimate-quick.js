/* Eizo Maps — 予算の目安（クライアント用・2026-11-15 翠くん）
   選ぶだけ・登録なしで使える。「だいたいこれくらい」が分かればよいので、細かい入力はしない。
   金額は小〜中規模の目安（幅で出す）。この表（TYPE など）を直せば計算も変わる。 */
(function (EM) {
  'use strict';
  // [値, 表示, 企画・構成, 撮影1日あたりのチーム＋機材, 案件の種類（募集を出すとき用）]
  var TYPE = [
    ['sns', 'SNS の縦型動画（リール・TikTok）', 30000, 120000, 'SNS動画'],
    ['webcm', 'WebCM・広告動画', 150000, 250000, 'CM'],
    ['vp', '会社・商品の紹介動画（VP）', 100000, 250000, '企業VP'],
    ['recruit', '採用動画', 80000, 220000, '企業VP'],
    ['mv', 'ミュージックビデオ（MV）', 100000, 280000, 'MV'],
    ['event', 'イベントの記録', 30000, 150000, 'イベント']
  ];
  var LEN = [['15', '〜15秒', 30000], ['60', '〜1分', 60000], ['180', '〜3分', 100000], ['600', '3分より長い', 180000]];
  var COUNT = [['1', '1本', 1], ['3', '3本', 3], ['5', '5本', 5], ['10', '10本', 10]];
  var SHOOT = [['1', '1日', 1], ['0.5', '半日', 0.5], ['2', '2日', 2], ['0', '撮影なし（素材・アニメで作る）', 0]];
  var CAST = [['none', 'いない・社員やお店の人', 0], ['pro2', 'プロの出演者 1〜2人', 150000], ['pro3', 'プロの出演者 3人以上', 300000]];
  var PLACE = [['inside', '社内・お店の中', 0], ['loc', '外（ロケ）', 50000], ['studio', 'スタジオ', 150000]];

  function pick(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i]; return list[0]; }
  function man(n) { return Math.round(n / 10000) + '万円'; }

  document.addEventListener('DOMContentLoaded', function () {
    var el = EM.el, box = EM.$('#qResult');
    if (!box) return;
    function fill(id, list) { var s = EM.$(id); list.forEach(function (o) { s.appendChild(el('option', { value: o[0], text: o[1] })); }); }
    fill('#qType', TYPE); fill('#qLen', LEN); fill('#qCount', COUNT); fill('#qShoot', SHOOT); fill('#qCast', CAST); fill('#qPlace', PLACE);
    EM.$('#qLen').value = '60';
    var counted = false;
    EM.$('#qForm').addEventListener('change', function () {
      calc();
      // 「予算の目安」を使った（1ページで1回だけ数える。選んだ中身は送らない・種類だけ）
      if (!counted) { counted = true; EM.track('budget_estimate', { video_type: EM.$('#qType').value }); }
    });
    calc();

    function calc() {
      var t = pick(TYPE, EM.$('#qType').value), len = pick(LEN, EM.$('#qLen').value), n = pick(COUNT, EM.$('#qCount').value)[2];
      var days = pick(SHOOT, EM.$('#qShoot').value)[2], cast = pick(CAST, EM.$('#qCast').value)[2], place = pick(PLACE, EM.$('#qPlace').value)[2];
      var parts = [];
      parts.push(['企画・構成', t[2]]);
      if (days) parts.push(['撮影（スタッフ・機材 ' + (days === 0.5 ? '半日' : days + '日') + '）', t[3] * days]);
      if (days && cast) parts.push(['出演者', cast]);
      if (days && place) parts.push(['場所の使用料', place * Math.max(1, days)]);
      var edit = len[2] + len[2] * 0.6 * (n - 1);
      parts.push(['編集（' + n + '本）', edit]);
      if (EM.$('#qNarr').checked) parts.push(['ナレーション', 60000]);
      parts.push([EM.$('#qMusic').checked ? 'オリジナルの音楽' : '音楽（BGM）', EM.$('#qMusic').checked ? 150000 : 20000]);
      if (EM.$('#qCg').checked || !days) parts.push(['CG・アニメーション', 100000]);
      var sub = parts.reduce(function (s, p) { return s + p[1]; }, 0);
      parts.push(['進行・管理（打ち合わせ・調整）', sub * 0.15]);
      var total = parts.reduce(function (s, p) { return s + p[1]; }, 0);
      if (EM.$('#qRush').checked) { parts.push(['急ぎ', total * 0.2]); total *= 1.2; }
      var lo = Math.floor(total * 0.8 / 10000) * 10000, hi = Math.ceil(total * 1.3 / 10000) * 10000;

      EM.clear(box);
      box.appendChild(el('p', { class: 'small muted', text: '予算の目安（税抜）' }));
      box.appendChild(el('p', { class: 'q-range', text: man(lo) + ' 〜 ' + man(hi) }));
      box.appendChild(el('details', null, [el('summary', { text: 'だいたいの内訳' }),
        el('ul', { class: 'q-parts' }, parts.map(function (p) { return el('li', null, [el('span', { text: p[0] }), el('span', { class: 'num', text: man(p[1]) })]); }))]));
      box.appendChild(el('p', { class: 'small muted', text: '小〜中規模の制作の目安です。実際の金額は、頼むクリエイターの見積もりで決まります。' }));
      var title = t[1].replace(/（.*?）/, '') + '（' + len[1] + '・' + n + '本）';
      var desc = [t[1] + '／' + len[1] + '／' + n + '本', '撮影：' + pick(SHOOT, EM.$('#qShoot').value)[1], '出る人：' + pick(CAST, EM.$('#qCast').value)[1], '撮る場所：' + pick(PLACE, EM.$('#qPlace').value)[1]]
        .concat([EM.$('#qNarr').checked ? 'ナレーションあり' : '', EM.$('#qMusic').checked ? 'オリジナルの音楽あり' : '', EM.$('#qCg').checked ? 'CG・アニメーションあり' : '', EM.$('#qRush').checked ? '急ぎ' : ''].filter(Boolean)).join('\n');
      var q = 'title=' + encodeURIComponent(title) + '&desc=' + encodeURIComponent(desc + '\n（予算の目安：' + man(lo) + '〜' + man(hi) + '）') + '&kind=' + encodeURIComponent(t[4]) + '&budget=' + lo;
      box.appendChild(el('div', { class: 'form-actions' }, [
        el('a', { class: 'btn btn--primary', href: '/jobs/new.html?' + q, text: 'この内容で募集を出す', 'data-cta': 'quick_to_job' }),
        el('a', { class: 'btn', href: '/creators/', text: 'クリエイターを探す' })
      ]));
    }
  });
})(window.EM);
