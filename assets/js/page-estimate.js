/* Eizo Maps — 実行表（クリエイター用・2026-11-15 翠くん）
   ことば → 表（AI か、決まった言葉で読む）→ 抜けの聞き返し → 見積・実行・粗利 → 保存・書き出し */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el, E = EM.est;
    var msg = EM.$('#pageMsg');
    if (!sb || !E) return;

    var DEFAULT_COND = '・映像の長さ：（30秒）×（1本）\n・修正：（2回）まで。それを超える修正は別途お見積もりします\n・使用範囲：（自社のWebサイト・SNS）での使用\n・使用期間：（納品から1年間）\n・納品形式：（MP4／フルHD）\n・撮影：（1日・都内）。追加の撮影日は別途お見積もりします\n・お見積もりの有効期限：（発行から1ヶ月）';
    var user = null, cur = null, shootDays = 0, asks = [], bar = null;
    var state = { lines: [], target: 30, cond: DEFAULT_COND, excl: '', text: '' };

    E.CATS.forEach(function (c) { EM.$('#estAddCat').appendChild(el('option', { value: c[0], text: c[0] + ' ' + c[1] })); });

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      bar = EM.saveBar({ watch: [EM.$('#estTitle'), EM.$('#estCond'), EM.$('#estExcl'), EM.$('#estTable')], onSave: save, label: '保存する' });
      loadList();
      aiStatus();
      fillForm();
      render();
    });

    /* ---- 一覧・開く ---- */
    function loadList(selectId) {
      return sb.from('estimates').select('id,title,updated_at').order('updated_at', { ascending: false }).limit(300).then(function (r) {
        var sel = EM.$('#estPick');
        while (sel.options.length > 1) sel.remove(1);
        (r.data || []).forEach(function (e) { sel.appendChild(el('option', { value: e.id, text: e.title + '（' + EM.date(e.updated_at) + '）' })); });
        if (selectId) sel.value = selectId;
      });
    }
    EM.$('#estPick').addEventListener('change', function () {
      var id = this.value;
      if (!id) return;
      sb.from('estimates').select('*').eq('id', id).single().then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        cur = r.data;
        var d = cur.data || {};
        state = { lines: d.lines || [], target: d.target == null ? 30 : d.target, cond: d.cond == null ? DEFAULT_COND : d.cond, excl: d.excl || '', text: d.text || '' };
        asks = [];
        fillForm(); render(); renderAsks();
      });
    });
    EM.$('#estNew').addEventListener('click', function () {
      cur = null; state = { lines: [], target: 30, cond: DEFAULT_COND, excl: '', text: '' }; asks = [];
      EM.$('#estPick').value = '';
      fillForm(); render(); renderAsks();
    });
    function fillForm() {
      EM.$('#estTitle').value = cur ? cur.title : '';
      EM.$('#estCond').value = state.cond;
      EM.$('#estExcl').value = state.excl;
      EM.$('#estText').value = state.text;
      EM.$('#estDel').hidden = !cur;
    }

    /* ---- ことば → 表 ---- */
    function addLines(ls, qs) {
      state.lines = E.sortLines(state.lines.concat(ls));
      state.text = EM.$('#estText').value;
      asks = (qs || []).map(function (q) { return typeof q === 'string' ? [q, null] : q; });
      E.checks(state.lines, shootDays).forEach(function (c) {
        if (!asks.some(function (a) { return a[0] === c[0]; })) asks.push(c);
      });
      render(); renderAsks(); dirty();
    }
    EM.$('#estRule').addEventListener('click', function () {
      var t = EM.$('#estText').value.trim();
      if (!t) { EM.notice(msg, '「ことばで書く」に、案件の内容を書いてください。', 'error'); return; }
      var r = E.parse(t);
      shootDays = r.shootDays;
      if (!r.lines.length) { EM.notice(msg, '読み取れる言葉がありませんでした。「カメラマン」「編集3日」「出演2名」のように書くか、AI で表にしてください。', 'error'); return; }
      EM.notice(msg, '');
      addLines(r.lines, []);
      EM.toast(r.lines.length + '行を足しました');
    });
    function aiStatus() {
      sb.functions.invoke('estimate-ai', { body: { action: 'status' } }).then(function (r) {
        var d = r.data || {};
        var info = EM.$('#estAiInfo');
        if (!d.configured) { info.textContent = 'AI はまだ準備中です（いまは「決まった言葉」で表にできます）'; EM.$('#estAi').disabled = true; return; }
        if (!d.ok) { info.textContent = '今日（または今月）の AI の上限に達しました。「決まった言葉」で表にできます'; EM.$('#estAi').disabled = true; return; }
        info.textContent = '今日あと ' + d.left_today + '回';
      }).catch(function () { EM.$('#estAiInfo').textContent = ''; });
    }
    EM.$('#estAi').addEventListener('click', function () {
      var t = EM.$('#estText').value.trim();
      if (!t) { EM.notice(msg, '「ことばで書く」に、案件の内容を書いてください。', 'error'); return; }
      var btn = this; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      var pr = E.parse(t); shootDays = pr.shootDays;
      sb.functions.invoke('estimate-ai', { body: { text: t } }).then(function (r) {
        var d = r.data;
        if (!d && r.error && r.error.context && r.error.context.json) return r.error.context.json().then(function (x) { return x; });
        return d;
      }).then(function (d) {
        if (d && d.ok && d.lines && d.lines.length) {
          EM.notice(msg, '');
          addLines(d.lines, d.questions || []);
          EM.toast('AI が ' + d.lines.length + '行にしました。金額は目安なので、直して使ってください');
        } else {
          // AI が使えないときは、決まった言葉で読む
          if (pr.lines.length) addLines(pr.lines, []);
          EM.notice(msg, ((d && d.reason) || 'AI で読み取れませんでした') + '。かわりに決まった言葉で表にしました。', 'error');
        }
      }).catch(function () {
        if (pr.lines.length) addLines(pr.lines, []);
        EM.notice(msg, 'AI につながりませんでした。かわりに決まった言葉で表にしました。', 'error');
      }).then(function () { btn.disabled = false; btn.removeAttribute('aria-busy'); aiStatus(); });
    });

    /* ---- 聞き返し ---- */
    function renderAsks() {
      var box = EM.clear(EM.$('#estAskList'));
      EM.$('#estAsk').hidden = !asks.length;
      if (asks.filter(function (a) { return a[1]; }).length > 1) box.appendChild(el('div', { class: 'form-actions' }, [
        el('button', { type: 'button', class: 'btn btn--sm', text: '足せるものを全部足す', onclick: function () {
          state.lines = E.sortLines(state.lines.concat(asks.filter(function (a) { return a[1]; }).map(function (a) { return JSON.parse(JSON.stringify(a[1])); })));
          asks = asks.filter(function (a) { return !a[1]; }); render(); renderAsks(); dirty();
        } }),
        el('button', { type: 'button', class: 'btn btn--sm', text: '全部閉じる', onclick: function () { asks = []; renderAsks(); } })
      ]));
      asks.forEach(function (a, i) {
        var acts = [];
        if (a[1]) acts.push(el('button', { type: 'button', class: 'btn btn--sm btn--primary', text: '足す', onclick: function () {
          state.lines = E.sortLines(state.lines.concat([JSON.parse(JSON.stringify(a[1]))])); asks.splice(i, 1); render(); renderAsks(); dirty();
        } }));
        else if (/予備費/.test(a[0])) acts.push(el('button', { type: 'button', class: 'btn btn--sm btn--primary', text: '5%で足す', onclick: function () {
          var t = E.totals(state.lines);
          state.lines = E.sortLines(state.lines.concat([{ cat: '12', name: '予備費', unit: '式', qty: 1, price: Math.round(t.sell * 0.05 / 1000) * 1000, cost: 0, costQty: 1, note: '' }]));
          asks.splice(i, 1); render(); renderAsks(); dirty();
        } }));
        acts.push(el('button', { type: 'button', class: 'btn btn--sm', text: 'いらない', onclick: function () { asks.splice(i, 1); renderAsks(); } }));
        box.appendChild(el('div', { class: 'est-ask__row' }, [el('p', { text: a[0] }), el('div', { class: 'form-actions' }, acts)]));
      });
    }

    /* ---- 表 ---- */
    function cell(l, key, type, w) {
      var inp = el('input', { type: type || 'text', value: l[key] == null ? '' : String(l[key]), class: 'est-in est-in--' + (w || 'n'), 'aria-label': key });
      if (type === 'number') { inp.min = '0'; inp.step = key === 'qty' || key === 'costQty' ? '0.5' : '1000'; inp.inputMode = 'decimal'; }
      inp.addEventListener('input', function () { l[key] = type === 'number' ? (inp.value === '' ? 0 : Number(inp.value)) : inp.value; paintRow(); renderSum(); dirty(); });
      var tr; function paintRow() { tr = inp.closest('tr'); if (!tr) return; tr.querySelector('.est-a').textContent = E.yen(E.amount(l)); tr.querySelector('.est-c').textContent = E.yen(E.costAmount(l)); tr.querySelector('.est-p').textContent = E.yen(E.amount(l) - E.costAmount(l)); }
      return el('td', null, inp);
    }
    function render() {
      var tb = EM.clear(EM.$('#estTable'));
      tb.appendChild(el('thead', null, el('tr', null, ['項目', '見積単価', '数量', '単位', '見積金額', '実行単価', '実行数量', '実行金額', '粗利', ''].map(function (h) { return el('th', { text: h }); }))));
      var body = el('tbody');
      if (!state.lines.length) body.appendChild(el('tr', null, el('td', { colspan: '10', class: 'muted small', text: '上の「ことばで書く」から表にするか、「＋ 行を足す」で1行ずつ入れてください。' })));
      var lastCat = null;
      state.lines.forEach(function (l, i) {
        if (l.cat !== lastCat) {
          lastCat = l.cat;
          var c = E.CATS.filter(function (x) { return x[0] === l.cat; })[0];
          body.appendChild(el('tr', { class: 'est-cat' }, el('th', { colspan: '10', text: c ? c[0] + ' ' + c[1] : l.cat })));
        }
        if (l.costQty === undefined) l.costQty = l.qty;
        body.appendChild(el('tr', null, [
          cell(l, 'name', 'text', 'name'), cell(l, 'price', 'number'), cell(l, 'qty', 'number', 's'), cell(l, 'unit', 'text', 's'),
          el('td', { class: 'est-a num', text: E.yen(E.amount(l)) }),
          cell(l, 'cost', 'number'), cell(l, 'costQty', 'number', 's'),
          el('td', { class: 'est-c num', text: E.yen(E.costAmount(l)) }),
          el('td', { class: 'est-p num', text: E.yen(E.amount(l) - E.costAmount(l)) }),
          el('td', null, el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': l.name + 'を消す', text: '×', onclick: function () { state.lines.splice(i, 1); render(); dirty(); } }))
        ]));
      });
      tb.appendChild(body);
      renderSum();
    }
    EM.$('#estAddRow').addEventListener('click', function () {
      var cat = EM.$('#estAddCat').value;
      state.lines = E.sortLines(state.lines.concat([{ cat: cat, name: '', unit: '式', qty: 1, price: 0, cost: 0, costQty: 1, note: '' }]));
      render(); dirty();
    });

    function renderSum() {
      var t = E.totals(state.lines), box = EM.clear(EM.$('#estSum'));
      var tax = Math.round(t.sell * 0.1);
      var target = Number(state.target) || 0;
      var tgt = el('input', { type: 'number', min: '0', max: '90', step: '1', value: String(target), class: 'est-in est-in--s', 'aria-label': '目標の粗利率' });
      tgt.addEventListener('input', function () { state.target = Number(tgt.value) || 0; paintWarn(); dirty(); });
      var warn = el('p', { class: 'notice notice--warn', hidden: true });
      function paintWarn() { warn.hidden = !(t.sell && t.rate * 100 < (Number(state.target) || 0)); warn.textContent = '⚠ 粗利率が目標（' + state.target + '%）を下回っています。'; }
      var dl = el('dl', { class: 'est-dl' });
      [['見積（税抜）', E.yen(t.sell)], ['消費税（10%）', E.yen(tax)], ['見積（税込）', E.yen(t.sell + tax)], ['実行（実際にかかる額）', E.yen(t.cost)], ['粗利（手元に残る額）', E.yen(t.profit)], ['粗利率', t.sell ? Math.round(t.rate * 1000) / 10 + '%' : '—']]
        .forEach(function (r, i) { dl.appendChild(el('dt', { text: r[0] })); dl.appendChild(el('dd', { class: i === 4 ? 'est-big' : '', text: r[1] })); });
      box.appendChild(el('h2', { class: 'h3', text: '合計' }));
      box.appendChild(dl);
      box.appendChild(el('label', { class: 'est-target small' }, [document.createTextNode('目標の粗利率 '), tgt, document.createTextNode(' %')]));
      box.appendChild(warn);
      paintWarn();
      // 費目ごと（値引きの相談に使う）
      var rows = E.CATS.filter(function (c) { return t.byCat[c[0]]; }).map(function (c) {
        var b = t.byCat[c[0]];
        return el('li', null, [el('span', { text: c[0] + ' ' + c[1] }), el('span', { class: 'num', text: E.yen(b.sell) + '（粗利 ' + E.yen(b.sell - b.cost) + '）' })]);
      });
      if (rows.length) box.appendChild(el('details', { class: 'est-bycat' }, [el('summary', { text: '費目ごとの合計（値引きの相談に）' }), el('ul', null, rows)]));
    }

    /* ---- 保存・書き出し ---- */
    function dirty() { var t = EM.$('#estTable'); t.dispatchEvent(new Event('change', { bubbles: true })); }
    function collect() {
      state.cond = EM.$('#estCond').value; state.excl = EM.$('#estExcl').value; state.text = EM.$('#estText').value;
      return { lines: state.lines, target: state.target, cond: state.cond, excl: state.excl, text: state.text };
    }
    function save() {
      var title = EM.$('#estTitle').value.trim() || '無題の実行表', isNew = !cur;
      var data = collect();
      var q = cur ? sb.from('estimates').update({ title: title, data: data }).eq('id', cur.id).select('*').single()
                  : sb.from('estimates').insert({ title: title, data: data }).select('*').single();
      return q.then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); throw r.error; }
        cur = r.data; EM.$('#estDel').hidden = false;
        if (isNew) EM.track('estimate_save', { line_count: (data.lines || []).length });
        loadList(cur.id);
        return cur.updated_at;
      });
    }
    EM.$('#estDel').addEventListener('click', function () {
      if (!cur || !confirm('「' + cur.title + '」を消しますか？\n元に戻せません。')) return;
      sb.from('estimates').delete().eq('id', cur.id).then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.toast('消しました'); EM.$('#estNew').click(); loadList();
      });
    });
    function catName(id) { var c = E.CATS.filter(function (x) { return x[0] === id; })[0]; return c ? c[0] + ' ' + c[1] : id; }
    EM.$('#estCsv').addEventListener('click', function () {
      var rows = [['費目', '項目', '見積単価', '数量', '単位', '見積金額', '実行単価', '実行数量', '実行金額', '粗利']];
      state.lines.forEach(function (l) { rows.push([catName(l.cat), l.name, l.price, l.qty, l.unit, E.amount(l), l.cost, l.costQty, E.costAmount(l), E.amount(l) - E.costAmount(l)]); });
      var t = E.totals(state.lines);
      rows.push([]); rows.push(['', '合計', '', '', '', t.sell, '', '', t.cost, t.profit]);
      var csv = '﻿' + rows.map(function (r) { return r.map(function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\r\n');
      var a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: (EM.$('#estTitle').value.trim() || '実行表') + '.csv' });
      document.body.appendChild(a); a.click(); a.remove();
    });
    // お客さま向け：見積の金額だけ（実行・粗利は出さない）
    function customerText() {
      var t = E.totals(state.lines), tax = Math.round(t.sell * 0.1);
      var out = ['【お見積もり】' + (EM.$('#estTitle').value.trim() || '')], last = null;
      state.lines.forEach(function (l) {
        if (l.cat !== last) { last = l.cat; out.push(''); out.push('■ ' + catName(l.cat).slice(3)); }
        out.push('・' + l.name + '　' + E.yen(l.price) + ' × ' + l.qty + l.unit + ' ＝ ' + E.yen(E.amount(l)));
      });
      out.push(''); out.push('小計 ' + E.yen(t.sell) + '／消費税 ' + E.yen(tax) + '／合計 ' + E.yen(t.sell + tax));
      var c = EM.$('#estCond').value.trim(), x = EM.$('#estExcl').value.trim();
      if (c) { out.push(''); out.push('【前提条件】'); out.push(c); }
      if (x) { out.push(''); out.push('【このお見積もりに含まれないもの】'); out.push(x); }
      return out.join('\n');
    }
    EM.$('#estCopy').addEventListener('click', function () {
      var s = customerText();
      (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(function () { EM.toast('コピーしました（実行の金額と粗利は入れていません）'); }, function () { window.prompt('下の文字をコピーしてください', s); });
    });
    // 書き出した見積もりの文章を、抜けチェックに渡す（送信はしない。このブラウザの中だけ）
    var chk = EM.$('#estCheck');
    if (chk) chk.addEventListener('click', function () {
      try { sessionStorage.setItem('em_qc_text', customerText()); } catch (e) { /* 渡せなくても開く */ }
      location.href = '/estimate/check/';
    });
  });
})(window.EM);
