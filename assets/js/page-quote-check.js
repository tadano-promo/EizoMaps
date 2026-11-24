/* Eizo Maps — 見積もりの抜けチェックのページ（2026-11-24）
   登録なし。貼った文章は送らない（このブラウザの中だけで調べる）。
   出す側：書かれていない項目に「足す文」／受け取る側：「相手に聞く文」を出す。 */
(function (EM) {
  'use strict';

  var SAMPLE = '【お見積もり】商品紹介動画 30秒×1本（縦型）\n撮影 1日　カメラマン　80,000円\n編集 3日　90,000円\nBGM　5,000円\n小計 175,000円（税込）\n納期：12月20日\n修正は2回まで。それを超える場合は別途お見積もりします。\nお支払い：月末締め翌月末振込\n納品形式：mp4（フルHD）';

  document.addEventListener('DOMContentLoaded', function () {
    var el = EM.el, Q = EM.quoteCheck;
    var box = EM.$('#qcResult'), txt = EM.$('#qcText');
    if (!box || !Q) return;

    function side() { var r = document.querySelector('input[name="qcSide"]:checked'); return r ? r.value : 'issue'; }
    function setSide(v) {
      var r = document.querySelector('input[name="qcSide"][value="' + v + '"]');
      if (r) r.checked = true;
      EM.$('#qcEyebrow').className = 'eyebrow' + (v === 'receive' ? ' eyebrow--client' : '');
    }

    // 入ってくる値：?as=receive（クライアントのメニュー）／実行表から（sessionStorage）
    var q = new URLSearchParams(location.search);
    setSide(q.get('as') === 'receive' ? 'receive' : 'issue');
    try {
      var pre = sessionStorage.getItem('em_qc_text');
      if (pre) { txt.value = pre; sessionStorage.removeItem('em_qc_text'); }
    } catch (e) { /* 使えなくても動く */ }

    function copy(s, done) {
      (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(function () { EM.toast(done || 'コピーしました'); }, function () { window.prompt('下の文字をコピーしてください', s); });
    }

    function sentence(it, mode) { return mode === 'receive' ? it.ask : it.add; }

    function card(it, mode) {
      var kids = [el('h3', { class: 'qc-item__name', text: it.name })];
      if (it.state === 'partial') kids.push(el('p', { class: 'qc-item__partial', text: '言葉はありますが、' + it.lacking.join('・') + 'が見つかりません。' }));
      kids.push(el('p', { class: 'small muted', text: '無いと：' + it.why }));
      var s = sentence(it, mode);
      kids.push(el('div', { class: 'qc-item__say' }, [
        el('span', { class: 'qc-item__label', text: mode === 'receive' ? '聞く文' : '足す文' }),
        el('span', { text: s })
      ]));
      kids.push(el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn--sm', text: 'この文をコピー', onclick: function () { copy(s); } })));
      return el('li', { class: 'qc-item qc-item--' + it.state }, kids);
    }

    function list(items, mode) { return el('ul', { class: 'qc-list' }, items.map(function (it) { return card(it, mode); })); }

    // まとめてコピーする文
    function bundle(items, mode) {
      if (mode === 'receive') {
        return 'お見積もりをありがとうございます。いくつか確認させてください。\n\n' + items.map(function (it, i) { return (i + 1) + '. ' + it.ask; }).join('\n') + '\n\nお手数ですが、ご確認をお願いします。';
      }
      return '【前提条件】\n' + items.map(function (it) { return it.add; }).join('\n');
    }

    function run() {
      var text = txt.value.trim();
      EM.clear(box);
      if (text.length < 15) { box.appendChild(el('p', { class: 'notice notice--error', text: '見積もりの文章を貼ってください（短すぎて調べられません）。' })); return; }
      var mode = side(), r = Q.run(text);
      var must = r.items.filter(function (i) { return i.level === 'must'; });
      var mustBad = must.filter(function (i) { return i.state !== 'ok'; });
      var shootBad = r.items.filter(function (i) { return i.level === 'shoot' && !i.skip && i.state !== 'ok'; });
      var maybeBad = r.items.filter(function (i) { return i.level === 'maybe' && i.state !== 'ok'; });
      var okItems = r.items.filter(function (i) { return !i.skip && i.state === 'ok'; });
      var shootTotal = r.items.filter(function (i) { return i.level === 'shoot'; }).length;

      EM.track('quote_check', { side: mode, missing_must: mustBad.length });

      // まとめ
      box.appendChild(el('div', { class: 'card qc-sum' }, [
        el('p', { class: 'small muted', text: 'どんな仕事でも書いておきたい項目' }),
        el('p', { class: 'qc-big' }, [el('b', { text: String(r.mustOk) }), document.createTextNode(' / ' + r.mustTotal + ' 項目が書かれています')]),
        el('p', { class: 'small muted', text: r.shoot ? '「撮影」の言葉があったので、撮影の項目（' + shootTotal + '）も見ています。' : '撮影の言葉が見つからなかったので、撮影の項目は見ていません。' })
      ]));

      if (mustBad.length) {
        box.appendChild(el('h2', { class: 'h3', text: mode === 'receive' ? '書かれていない項目（あとで揉めやすいので、聞いておきたい）' : '書かれていない項目（足したほうがよい）' }));
        box.appendChild(list(mustBad, mode));
      } else {
        box.appendChild(el('p', { class: 'notice', text: 'どんな仕事でも書いておきたい項目は、すべて書かれていました。' }));
      }
      if (shootBad.length) {
        box.appendChild(el('h2', { class: 'h3', text: '撮影がある仕事で、書かれていない項目' }));
        box.appendChild(list(shootBad, mode));
      }
      if (maybeBad.length) {
        var d = el('details', { class: 'qc-more' }, [el('summary', { text: '内容によっては、確かめたい項目（' + maybeBad.length + '）' }),
          el('p', { class: 'small muted', text: '仕事によっては要らないものも入っています。「入っていなくて大丈夫？」と軽く確認するための項目です。' }), list(maybeBad, mode)]);
        box.appendChild(d);
      }
      if (okItems.length) {
        box.appendChild(el('details', { class: 'qc-more' }, [el('summary', { text: '書かれていた項目（' + okItems.length + '）' }),
          el('ul', { class: 'qc-ok' }, okItems.map(function (it) { return el('li', { text: it.name + (it.found.length ? '（' + it.found.join('・') + '）' : '') }); }))]));
      }

      // まとめてコピー
      var all = mustBad.concat(shootBad);
      if (all.length) {
        box.appendChild(el('div', { class: 'form-actions qc-bundle' }, [
          el('button', { type: 'button', class: 'btn btn--primary', text: mode === 'receive' ? '上の質問をまとめてコピー（相手に送る文）' : '上の足す文をまとめてコピー（前提条件）', onclick: function () { copy(bundle(all, mode), 'まとめてコピーしました'); } })
        ]));
      }
      // つぎの行き先
      box.appendChild(el('p', { class: 'small' }, mode === 'receive'
        ? [el('a', { href: '/jobs/new.html', text: '募集を出して、見積もりを集める' }), document.createTextNode('　／　'), el('a', { href: '/estimate/quick/', text: '予算の目安を出す' })]
        : [el('a', { href: '/estimate/', text: '実行表で、見積もりと粗利を作る' }), document.createTextNode('　／　'), el('a', { href: '/auth/', text: 'Eizo Maps に登録する（無料）' })]));
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    EM.$('#qcRun').addEventListener('click', run);
    EM.$('#qcSample').addEventListener('click', function () { txt.value = SAMPLE; run(); });
    EM.$('#qcClear').addEventListener('click', function () { txt.value = ''; EM.clear(box); txt.focus(); });
    EM.$('#qcSide').addEventListener('change', function () { setSide(side()); if (box.firstChild && txt.value.trim()) run(); });
    if (txt.value.trim()) run();
  });
})(window.EM);
