/* Eizo Maps — 職種の木（部署 → 職種）
   ・EM.jobs.load()            … 選べる職種を読み込む（部署の順・職種の順）
   ・EM.jobs.picker(box, list, selected, opts) … 部署ごとにたためる選び方＋言葉で探す
       opts.max      … 選べる数の上限（なければ無制限）
       opts.onChange … 選んだものが変わったとき
       opts.compact  … 探す画面用（選んだものの一覧を小さく）
   業界ごとの呼び名は「別名」で持つ。どの呼び名で探しても同じ職種に着く（例：ライトマン → 照明技師、PR → プロデューサー）
   2026-10-31 翠くん「職種の木は作り直す」 */
(function (EM) {
  'use strict';
  var el = EM.el;
  var FIELD_LABEL = { live: '実写', anime: 'アニメ・CG・モーション' };

  function load() {
    var sb = EM.sb();
    if (!sb) return Promise.resolve([]);
    return sb.from('genres').select('id,slug,name_ja,sort_order,dept,dept_order,field,aliases,note,active')
      .order('sort_order').then(function (r) {
        if (r.error) throw r.error;
        return (r.data || []).filter(function (g) { return g.active !== false; });
      });
  }

  function norm(s) {
    // 全角英数を半角に、カタカナとひらがなを同じに、大文字小文字をそろえる
    return String(s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); })
      .toLowerCase().replace(/[\s・（）()「」]/g, '');
  }
  function matches(g, q) {
    if (!q) return true;
    var n = norm(q);
    if (norm(g.name_ja).indexOf(n) !== -1 || norm(g.dept).indexOf(n) !== -1) return true;
    var al = g.aliases || [];
    for (var i = 0; i < al.length; i++) if (norm(al[i]).indexOf(n) !== -1) return true;
    return false;
  }
  function hint(g) {
    var parts = [];
    if (g.aliases && g.aliases.length) parts.push('別の呼び方：' + g.aliases.join('・'));
    if (g.note) parts.push(g.note);
    return parts.join('\n');
  }

  function group(list) {
    var depts = [], byDept = {};
    list.forEach(function (g) {
      var k = g.dept || 'そのほか';
      if (!byDept[k]) { byDept[k] = { name: k, field: g.field, order: g.dept_order || 99, items: [] }; depts.push(byDept[k]); }
      byDept[k].items.push(g);
    });
    depts.sort(function (a, b) { return a.order - b.order; });
    return depts;
  }

  function picker(box, list, selected, opts) {
    opts = opts || {};
    EM.clear(box);
    box.classList.add('jobs');
    var byId = {}; list.forEach(function (g) { byId[g.id] = g; });
    var chosen = el('div', { class: 'jobs__chosen' });
    var search = el('input', { type: 'search', class: 'jobs__search', placeholder: '職種を言葉で探す（例：ライトマン、PM、カラリスト、Live2D）', 'aria-label': '職種を言葉で探す', autocomplete: 'off' });
    var results = el('div', { class: 'chips jobs__results', hidden: true });
    var tree = el('div', { class: 'jobs__tree' });
    box.appendChild(chosen);
    box.appendChild(search);
    box.appendChild(results);
    box.appendChild(tree);

    function isOn(id) { return selected.indexOf(id) !== -1; }
    function toggle(id) {
      var i = selected.indexOf(id);
      if (i !== -1) selected.splice(i, 1);
      else {
        if (opts.max && selected.length >= opts.max) { EM.toast('職種は' + opts.max + 'つまで選べます'); return; }
        selected.push(id);
      }
      refresh();
      if (opts.onChange) opts.onChange(selected);
    }
    function chip(g) {
      return el('button', { class: 'chip', type: 'button', 'aria-pressed': isOn(g.id) ? 'true' : 'false', title: hint(g) || null,
        dataset: { jid: String(g.id) }, text: g.name_ja, onclick: function () { toggle(g.id); } });
    }

    function renderChosen() {
      EM.clear(chosen);
      if (!selected.length) {
        chosen.appendChild(el('p', { class: 'small muted', text: opts.compact ? '' : 'まだ選んでいません。下の部署を開くか、言葉で探してください。' + (opts.max ? '（' + opts.max + 'つまで）' : '') }));
        return;
      }
      var row = el('div', { class: 'chips' });
      selected.forEach(function (id) {
        var g = byId[id]; if (!g) return;
        row.appendChild(el('button', { class: 'chip jobs__on', type: 'button', 'aria-label': g.name_ja + ' を外す',
          onclick: function () { toggle(id); } }, [g.name_ja, el('span', { class: 'jobs__x', 'aria-hidden': 'true', text: '×' })]));
      });
      chosen.appendChild(el('p', { class: 'small muted jobs__label', text: '選んだ職種' + (opts.max ? '（' + selected.length + '／' + opts.max + '）' : '') }));
      chosen.appendChild(row);
    }

    var openState = {}, openDept = null;
    // 探す画面用：部署を小さなボタンで並べ、押した部署の職種だけを下に出す（縦に長くしない）
    function renderCompact() {
      EM.clear(tree);
      var depts = group(list);
      var row = el('div', { class: 'chips jobs__depts' });
      var below = el('div', { class: 'chips jobs__below' });
      depts.forEach(function (d) {
        var n = d.items.filter(function (g) { return isOn(g.id); }).length;
        row.appendChild(el('button', { class: 'chip chip--sm' + (n ? ' has-on' : ''), type: 'button', 'aria-pressed': openDept === d.name ? 'true' : 'false',
          onclick: function () { openDept = openDept === d.name ? null : d.name; renderCompact(); } },
          [d.name, n ? el('span', { class: 'jobs__count', text: String(n) }) : null]));
        if (openDept === d.name) d.items.forEach(function (g) { below.appendChild(chip(g)); });
      });
      tree.appendChild(row);
      if (openDept) tree.appendChild(below);
    }
    function renderTree() {
      if (opts.compact) { renderCompact(); return; }
      EM.clear(tree);
      var lastField = null;
      group(list).forEach(function (d) {
        if (d.field !== lastField) {
          lastField = d.field;
          tree.appendChild(el('p', { class: 'jobs__field', text: FIELD_LABEL[d.field] || 'そのほか' }));
        }
        var n = d.items.filter(function (g) { return isOn(g.id); }).length;
        var det = el('details', { class: 'jobs__dept' + (n ? ' has-on' : '') }, [
          el('summary', null, [el('span', { text: d.name }), n ? el('span', { class: 'jobs__count', text: String(n) }) : null,
            el('span', { class: 'jobs__peek small muted', text: d.items.slice(0, 3).map(function (g) { return g.name_ja; }).join('・') + (d.items.length > 3 ? ' ほか' : '') })]),
          el('div', { class: 'chips' }, d.items.map(chip))
        ]);
        if (openState[d.name]) det.open = true;
        det.addEventListener('toggle', function () { openState[d.name] = det.open; });
        tree.appendChild(det);
      });
    }

    function renderResults() {
      var q = search.value.trim();
      EM.clear(results);
      results.hidden = !q;
      tree.hidden = !!q;
      if (!q) return;
      var hit = list.filter(function (g) { return matches(g, q); });
      if (!hit.length) { results.appendChild(el('p', { class: 'small muted', text: '見つかりませんでした。別の呼び方でも探してみてください。' })); return; }
      hit.slice(0, 40).forEach(function (g) {
        var c = chip(g);
        c.appendChild(el('span', { class: 'jobs__dept-tag', text: g.dept }));
        results.appendChild(c);
      });
    }

    function refresh() { renderChosen(); renderTree(); renderResults(); }
    search.addEventListener('input', renderResults);
    refresh();
    return { refresh: refresh, clear: function () { selected.length = 0; search.value = ''; refresh(); } };
  }

  EM.jobs = { load: load, picker: picker, matches: matches, hint: hint };
})(window.EM);
