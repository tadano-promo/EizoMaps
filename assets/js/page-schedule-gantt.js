/* Eizo Maps — ガントチャート（案件ごとの期間を横に並べて見る）
   ・案件ごとに1つのまとまり。まとまりの行には「最初の予定〜最後の予定」の細い棒と、納品・納期の ◆
   ・開くと、その案件の予定が1行ずつ（種別の色の棒。納品は ◆）
   ・本人の予定だけを読む（データベースの決まりで本人以外は読めない） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    var DAYW = { 4: 30, 8: 20, 13: 14, 26: 8 };
    var weeks = 8, from = EM.weekStart(EM.today()), me = null;
    var closed = {};
    try { closed = JSON.parse(localStorage.getItem('em.gantt.closed') || '{}') || {}; } catch (e) { closed = {}; }
    function saveClosed() { try { localStorage.setItem('em.gantt.closed', JSON.stringify(closed)); } catch (e) { /* 保存できなくても表示は普通に動く */ } }
    try { var w = +localStorage.getItem('em.gantt.weeks'); if (DAYW[w]) weeks = w; } catch (e) { /* なし */ }
    EM.$('#gWeeks').value = String(weeks);

    EM.requireUser().then(function (u) {
      if (!u) return;
      me = u;
      EM.$('#ganttBody').hidden = false;
      EM.$('#gPrev').addEventListener('click', function () { from = EM.addDays(from, -7 * step()); load(); });
      EM.$('#gNext').addEventListener('click', function () { from = EM.addDays(from, 7 * step()); load(); });
      EM.$('#gToday').addEventListener('click', function () { from = EM.weekStart(EM.today()); load(); });
      EM.$('#gWeeks').addEventListener('change', function () {
        weeks = +this.value || 8;
        try { localStorage.setItem('em.gantt.weeks', String(weeks)); } catch (e) { /* なし */ }
        load();
      });
      EM.$('#gShowDone').addEventListener('change', render);
      EM.$('#gOpenAll').addEventListener('click', function () { closed = {}; saveClosed(); render(); });
      EM.$('#gCloseAll').addEventListener('click', function () { groups.forEach(function (g) { closed[g.key] = 1; }); saveClosed(); render(); });
      legend();
      return load();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function step() { return Math.max(1, Math.floor(weeks / 2)); }
    function to() { return EM.addDays(from, weeks * 7 - 1); }

    var groups = [];

    function load() {
      var t = to();
      EM.$('#gRange').textContent = from.replace(/-/g, '/') + ' 〜 ' + EM.md(t);
      return Promise.all([
        sb.from('schedule_events').select('id,kind,title,starts_on,ends_on,start_time,project_id,sched_project_id,busy')
          .eq('owner_user_id', me.id).lte('starts_on', t).gte('ends_on', from)
          .order('starts_on').limit(2000),
        sb.from('schedule_projects').select('id,name').limit(500),
        sb.from('projects').select('id,title,status,due_on').limit(300)
      ]).then(function (r) {
        if (r[0].error) throw r[0].error;
        var evs = r[0].data || [];
        var sp = {}, rq = {};
        (r[1].data || []).forEach(function (p) { sp[p.id] = p; });
        (r[2].data || []).forEach(function (p) { rq[p.id] = p; });
        var map = {};
        function grp(key, name, href, kind) {
          if (!map[key]) map[key] = { key: key, name: name, href: href, kind: kind, evs: [], due: [] };
          return map[key];
        }
        evs.forEach(function (e) {
          var g;
          if (e.sched_project_id && sp[e.sched_project_id]) g = grp('sp:' + e.sched_project_id, sp[e.sched_project_id].name, '/schedule/projects.html', 'sp');
          else if (e.project_id && rq[e.project_id]) g = grp('rq:' + e.project_id, rq[e.project_id].title, '/projects/?id=' + encodeURIComponent(e.project_id), 'rq');
          else g = grp('none', '案件なし（個人の予定など）', null, 'none');
          g.evs.push(e);
        });
        // 依頼の案件の納期（予定が無くても ◆ だけ出す）
        Object.keys(rq).forEach(function (id) {
          var p = rq[id];
          if (!p.due_on || p.due_on < from || p.due_on > t) return;
          if (p.status === 'cancelled') return;
          grp('rq:' + id, p.title, '/projects/?id=' + encodeURIComponent(id), 'rq').due.push(p.due_on);
        });
        groups = Object.keys(map).map(function (k) {
          var g = map[k], s = null, e = null;
          g.evs.forEach(function (x) { if (!s || x.starts_on < s) s = x.starts_on; if (!e || x.ends_on > e) e = x.ends_on; });
          g.due.forEach(function (d) { if (!s || d < s) s = d; if (!e || d > e) e = d; });
          g.start = s; g.end = e;
          g.done = e < EM.today();
          return g;
        }).sort(function (a, b) {
          if (a.kind === 'none') return 1;
          if (b.kind === 'none') return -1;
          return a.start < b.start ? -1 : a.start > b.start ? 1 : a.name.localeCompare(b.name, 'ja');
        });
        render();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function legend() {
      var box = EM.$('#gLegend');
      EM.clear(box);
      EM.KINDS.forEach(function (k) {
        if (k[0] === 'private') return;
        box.appendChild(el('span', { class: 'vcal-key small' }, [el('span', { class: 'vcal-key__dot', style: { background: k[2] } }), k[1]]));
      });
      box.appendChild(el('span', { class: 'vcal-key small' }, [el('span', { class: 'gantt__dia gantt__dia--key' }), '納品・納期']));
      box.appendChild(el('span', { class: 'vcal-key small' }, [el('span', { class: 'gantt__todaykey' }), '今日']));
    }

    function render() {
      var box = EM.$('#gantt');
      EM.clear(box);
      var dw = DAYW[weeks] || 20, n = weeks * 7, t = to(), today = EM.today();
      box.style.setProperty('--gday', dw + 'px');
      box.style.setProperty('--gdays', n);
      var showDone = EM.$('#gShowDone').checked;
      var list = groups.filter(function (g) { return showDone || !g.done; });

      // 見出し：月と週（月曜）の目盛り
      var head = el('div', { class: 'gantt__track gantt__track--head' });
      for (var i = 0; i < n; i++) {
        var d = EM.addDays(from, i), dt = EM.parseYmd(d);
        if (i === 0 || dt.getDate() === 1) head.appendChild(el('span', { class: 'gantt__month mono', style: { left: (i * dw) + 'px' }, text: (dt.getMonth() + 1) + '月' }));
        if (dt.getDay() === 1) head.appendChild(el('span', { class: 'gantt__wk mono' + (d <= today && today < EM.addDays(d, 7) ? ' is-now' : ''), style: { left: (i * dw) + 'px' }, text: EM.md(d) }));
      }
      box.appendChild(el('div', { class: 'gantt__row gantt__row--head' }, [el('div', { class: 'gantt__name gantt__name--head', text: '案件・予定' }), head]));

      // 背景：土日の色・週の区切り・今日の線（行の後ろに1枚だけ敷く）
      var bg = el('div', { class: 'gantt__bg', 'aria-hidden': 'true' });
      for (var j = 0; j < n; j++) {
        var dd = EM.addDays(from, j), wd = EM.parseYmd(dd).getDay();
        if (wd === 0 || wd === 6) bg.appendChild(el('span', { class: 'gantt__we', style: { left: (j * dw) + 'px', width: dw + 'px' } }));
        if (wd === 1 && j) bg.appendChild(el('span', { class: 'gantt__sep', style: { left: (j * dw) + 'px' } }));
      }
      if (today >= from && today <= t) bg.appendChild(el('span', { class: 'gantt__today', style: { left: (EM.dayDiff(from, today) * dw + dw / 2) + 'px' } }));
      box.appendChild(bg);

      if (!list.length) {
        box.appendChild(el('div', { class: 'gantt__row' }, [
          el('div', { class: 'gantt__name gantt__name--empty muted small', text: groups.length ? 'この期間に動いている案件はありません（「終わった案件も出す」で過去のものも見られます）。' : 'この期間の予定はまだありません。スケジュールで予定を追加すると、ここに並びます。' }),
          el('div', { class: 'gantt__track' })
        ]));
        return;
      }

      function pos(s, e) {
        var a = s < from ? from : s, b = e > t ? t : e;
        return { left: EM.dayDiff(from, a) * dw, width: (EM.dayDiff(a, b) + 1) * dw, cutL: s < from, cutR: e > t };
      }
      function dia(d, cls, title) {
        if (d < from || d > t) return null;
        return el('span', { class: 'gantt__dia' + (cls ? ' ' + cls : ''), title: title, style: { left: (EM.dayDiff(from, d) * dw + dw / 2) + 'px' } });
      }

      list.forEach(function (g) {
        var isClosed = !!closed[g.key];
        var track = el('div', { class: 'gantt__track' });
        if (g.start && g.end) {
          var p = pos(g.start, g.end);
          track.appendChild(el('span', {
            class: 'gantt__span' + (p.cutL ? ' is-cut-l' : '') + (p.cutR ? ' is-cut-r' : '') + (g.done ? ' is-done' : ''),
            style: { left: p.left + 'px', width: Math.max(p.width - 2, 4) + 'px' }
          }, p.width >= 84 ? el('span', { class: 'gantt__lbl mono', text: EM.md(g.start) + '〜' + EM.md(g.end) }) : null));
        }
        g.evs.forEach(function (e) { if (e.kind === 'delivery') { var x = dia(e.ends_on, null, '納品：' + e.title); if (x) track.appendChild(x); } });
        g.due.forEach(function (d) { var x = dia(d, 'gantt__dia--due', '納期'); if (x) track.appendChild(x); });

        var toggle = el('button', { type: 'button', class: 'gantt__tg', 'aria-expanded': isClosed ? 'false' : 'true', 'aria-label': isClosed ? '開く' : '閉じる', text: isClosed ? '▸' : '▾' });
        toggle.addEventListener('click', function () { if (closed[g.key]) delete closed[g.key]; else closed[g.key] = 1; saveClosed(); render(); });
        var nameEl = g.href ? el('a', { class: 'gantt__gname', href: g.href, text: g.name }) : el('span', { class: 'gantt__gname', text: g.name });
        box.appendChild(el('div', { class: 'gantt__row gantt__row--group' + (g.done ? ' is-done' : '') }, [
          el('div', { class: 'gantt__name' }, [toggle, el('span', { class: 'gantt__gdot gantt__gdot--' + g.kind }), nameEl, el('span', { class: 'gantt__count mono', text: String(g.evs.length) })]),
          track
        ]));
        if (isClosed) return;

        g.evs.slice().sort(function (a, b) { return a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : String(a.start_time || '').localeCompare(String(b.start_time || '')); })
          .forEach(function (e) {
            var tr = el('div', { class: 'gantt__track' });
            var col = EM.kindColor(e.kind);
            if (e.kind === 'delivery' && e.starts_on === e.ends_on) {
              tr.appendChild(el('a', { class: 'gantt__dia gantt__dia--link', href: '/schedule/day.html?d=' + e.starts_on, title: '納品 ' + EM.mdw(e.starts_on), style: { left: (EM.dayDiff(from, e.starts_on) * dw + dw / 2) + 'px' } }));
            } else {
              var q = pos(e.starts_on, e.ends_on);
              var past = e.ends_on < today;
              tr.appendChild(el('a', {
                class: 'gantt__bar' + (e.kind === 'hold' ? ' is-hold' : '') + (past ? ' is-past' : '') + (q.cutL ? ' is-cut-l' : '') + (q.cutR ? ' is-cut-r' : ''),
                href: '/schedule/day.html?d=' + (e.starts_on < from ? from : e.starts_on),
                title: EM.kindLabel(e.kind) + '：' + e.title + '（' + EM.mdw(e.starts_on) + (e.ends_on > e.starts_on ? '〜' + EM.mdw(e.ends_on) : '') + '）',
                style: { left: q.left + 'px', width: Math.max(q.width - 2, 6) + 'px', '--bar': col }
              }, q.width >= 84 ? el('span', { class: 'gantt__lbl mono', text: e.ends_on > e.starts_on ? EM.md(e.starts_on) + '〜' + EM.md(e.ends_on) : EM.md(e.starts_on) }) : null));
            }
            box.appendChild(el('div', { class: 'gantt__row gantt__row--item' + (e.ends_on < today ? ' is-past' : '') }, [
              el('a', { class: 'gantt__name gantt__name--item', href: '/schedule/day.html?d=' + e.starts_on }, [
                el('span', { class: 'gantt__kdot', style: { background: col } }),
                el('span', { class: 'gantt__iname', text: e.title }),
                el('span', { class: 'gantt__kind', text: EM.kindLabel(e.kind) })
              ]),
              tr
            ]));
          });
      });

      // 今日が見える位置まで横に送る（左端に少し余白）
      var sc = EM.$('#gScroll');
      if (today >= from && today <= t) sc.scrollLeft = Math.max(0, EM.dayDiff(from, today) * dw - 40);
    }
  });
})(window.EM);
