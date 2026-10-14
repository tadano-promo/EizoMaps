/* Eizo Maps — 日ごとの予定（時間割）
   時間が縦に流れ、大枠（撮影など）ごとにまとまりを作る。
   大枠の中に「班・担当」ごとの列を自由に作り、小枠（細かい動き）を並べる。
   同じ時間に別の大枠（別の依頼）があれば、横に並んで見える。
   時刻は「その日の0時から何分後か」で扱う。25:00 = 翌日の1時。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    var HOUR = 56;                       // 1時間の高さ(px)
    var EV_COLS = 'id,owner_user_id,project_id,kind,title,location,starts_on,ends_on,start_time,end_time,busy,visibility';
    var KIND = {
      shoot: ['撮影', '#e8ff47'], edit: ['編集', '#7ad1ff'], meeting: ['打合せ', '#b79cff'],
      delivery: ['納品', '#4ade80'], hold: ['仮押さえ', '#ff9d5c'], other: ['その他', '#9aa0b5'], private: ['非公開', '#5a6072']
    };
    var WD = ['日', '月', '火', '水', '木', '金', '土'];

    var me = null, day = null, events = [], items = [], projects = {};

    /* ---------------- 日付と時刻 ---------------- */
    function pad(n) { return String(n).padStart(2, '0'); }
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
    function fmtMin(m) { return Math.floor(m / 60) + ':' + pad(m % 60); }
    function timeToMin(t) { if (!t) return null; var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); }
    // 「7:30」「730」「25:00」を分に。おかしければ null
    function parseHM(s) {
      var v = String(s || '').trim().replace('：', ':');
      var m = v.match(/^(\d{1,2}):?(\d{2})$/);
      if (!m) { m = v.match(/^(\d{1,2})$/); if (m) m = [m[0], m[1], '00']; }
      if (!m) return null;
      var h = +m[1], mi = +m[2];
      if (mi > 59 || h > 47) return null;
      return h * 60 + mi;
    }

    // 大枠がこの日のどの時間を占めるか（分）。複数日にまたがる予定にも対応
    function spanOf(e) {
      var s = 0, t = 24 * 60;
      if (e.starts_on === day && e.start_time) s = timeToMin(e.start_time);
      if (e.starts_on === day && e.start_time && e.end_time && e.ends_on === addDays(day, 1)) {
        t = 24 * 60 + timeToMin(e.end_time);   // 夜通しの撮影など：翌朝までを 25:00 のように続けて見せる
      } else if (e.ends_on === day && e.end_time) {
        t = timeToMin(e.end_time);
        if (t <= s) t += 24 * 60;        // 終了が開始より前なら翌日の時刻とみなす
      } else if (e.ends_on === day && e.start_time && !e.end_time && e.starts_on === day) {
        t = Math.min(s + 60, 48 * 60);
      }
      return { s: s, t: t, allDay: !e.start_time && e.starts_on === day && e.ends_on === day };
    }

    /* ---------------- 読み込み ---------------- */
    EM.requireUser().then(function (u) {
      if (!u) return;
      me = u;
      day = /^\d{4}-\d{2}-\d{2}$/.test(String(EM.param('d') || '')) ? EM.param('d') : ymd(new Date());
      EM.$('#dayBody').hidden = false;
      initForm();
      return sb.from('projects').select('id,title').limit(200).then(function (r) {
        (r.data || []).forEach(function (p) { projects[p.id] = p.title; });
        return load();
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function load() {
      var d = parseYmd(day);
      EM.$('#dayLabel').textContent = d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + '（' + WD[d.getDay()] + '）';
      EM.$('#dayPicker').value = day;
      EM.$('#toMonth').href = '/schedule/?m=' + day.slice(0, 7);
      EM.$('#newBigBtn').href = '/schedule/?new=' + day;
      history.replaceState(null, '', '/schedule/day.html?d=' + day);
      return Promise.all([
        sb.from('schedule_events').select(EV_COLS).lte('starts_on', day).gte('ends_on', day).order('start_time', { nullsFirst: true }),
        sb.from('schedule_items').select('id,event_id,day,lane,title,start_min,end_min,note,created_at').eq('day', day).order('created_at')
      ]).then(function (r) {
        if (r[0].error) throw r[0].error;
        events = r[0].data || [];
        items = (!r[1].error && r[1].data) || [];
        render();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function go(n) { day = addDays(day, n); closeForm(); load(); }
    EM.$('#prevDay').addEventListener('click', function () { go(-1); });
    EM.$('#nextDay').addEventListener('click', function () { go(1); });
    EM.$('#todayBtn').addEventListener('click', function () { day = ymd(new Date()); closeForm(); load(); });
    EM.$('#dayPicker').addEventListener('change', function () { if (this.value) { day = this.value; closeForm(); load(); } });

    /* ---------------- 描画 ---------------- */
    function lanesOf(ev) {
      var seen = [], list = items.filter(function (i) { return i.event_id === ev.id; });
      list.forEach(function (i) { if (seen.indexOf(i.lane) === -1) seen.push(i.lane); });
      return seen;
    }

    // 同じ列で時間が重なる小枠を、横に分けて並べる
    function packLane(list) {
      var cols = [];
      list.slice().sort(function (a, b) { return a.start_min - b.start_min; }).forEach(function (it) {
        for (var i = 0; i < cols.length; i++) {
          if (cols[i] <= it.start_min) { it._sub = i; cols[i] = it.end_min; return; }
        }
        it._sub = cols.length; cols.push(it.end_min);
      });
      return Math.max(1, cols.length);
    }

    function render() {
      var grid = EM.$('#dayGrid'), allBox = EM.$('#dayAllday');
      EM.clear(grid); EM.clear(allBox);

      // 時間軸の範囲：基本は 5:00〜24:00。予定がはみ出すなら広げる
      var from = 5 * 60, to = 24 * 60;
      var timed = [], allday = [];
      events.forEach(function (e) {
        var sp = spanOf(e);
        e._s = sp.s; e._t = sp.t;
        if (sp.allDay && !items.some(function (i) { return i.event_id === e.id; })) allday.push(e);
        else timed.push(e);
        if (!sp.allDay) { from = Math.min(from, sp.s); to = Math.max(to, sp.t); }
      });
      items.forEach(function (i) { from = Math.min(from, i.start_min); to = Math.max(to, i.end_min); });
      from = Math.floor(from / 60) * 60; to = Math.min(48 * 60, Math.ceil(to / 60) * 60);
      var height = (to - from) / 60 * HOUR;
      function y(m) { return (m - from) / 60 * HOUR; }

      // 終日の予定（時間が決まっていないもの）は上に帯で
      allBox.hidden = !allday.length;
      allday.forEach(function (e) {
        allBox.appendChild(el('button', {
          type: 'button', class: 'day-allday__item', style: { '--bar': (KIND[e.kind] || KIND.other)[1] },
          onclick: function () { if (e.owner_user_id === me.id) openNewItem(e, null, e._s + 9 * 60); }
        }, [
          el('span', { class: 'day-kind', text: (KIND[e.kind] || KIND.other)[0] }),
          el('span', { text: e.title + '（終日）' })
        ]));
      });

      EM.$('#dayEmpty').hidden = !!events.length;
      if (!timed.length) { grid.hidden = true; return; }
      grid.hidden = false;

      // 時刻の目盛り
      var axis = el('div', { class: 'day-axis', style: { height: height + 'px' } });
      for (var m = from; m <= to; m += 60) {
        axis.appendChild(el('span', { class: 'day-axis__h mono', style: { top: y(m) + 'px' }, text: fmtMin(m) }));
      }
      grid.appendChild(el('div', { class: 'day-col day-col--axis' }, [el('div', { class: 'day-head day-head--axis' }), axis]));

      // 大枠ごとのまとまり
      timed.forEach(function (e) {
        var mine = e.owner_user_id === me.id;
        var color = (KIND[e.kind] || KIND.other)[1];
        var lanes = lanesOf(e);
        var group = el('section', { class: 'day-group', style: { '--bar': color } });

        // いちばん上：案件名（あれば）と大枠の名前・時間
        var pj = e.project_id && projects[e.project_id];
        group.appendChild(el('header', { class: 'day-group__head' }, [
          pj ? el('p', { class: 'day-group__project', text: pj }) : null,
          el('p', { class: 'day-group__title' }, [
            el('span', { class: 'day-kind', text: (KIND[e.kind] || KIND.other)[0] }),
            el('span', { text: e.title })
          ]),
          el('p', { class: 'day-group__time mono', text: fmtMin(e._s) + '〜' + fmtMin(e._t) + (mine ? '' : '（案件の相手の予定）') })
        ]));

        var cols = el('div', { class: 'day-group__cols' });

        // 大枠そのものの帯
        var bandCol = el('div', { class: 'day-col day-col--band' }, [el('div', { class: 'day-head', text: '全体' })]);
        var bandBody = el('div', { class: 'day-body', style: { height: height + 'px' } });
        bandBody.appendChild(el('div', {
          class: 'day-band', style: { top: y(e._s) + 'px', height: Math.max(18, y(e._t) - y(e._s)) + 'px' },
          title: e.title
        }, el('span', { text: e.title })));
        bandCol.appendChild(bandBody);
        cols.appendChild(bandCol);

        // 班・担当ごとの列
        lanes.forEach(function (ln) { cols.appendChild(laneCol(e, ln, height, y, from, mine)); });

        // 新しい班を作る列
        if (mine) {
          cols.appendChild(el('div', { class: 'day-col day-col--add' }, [
            el('button', {
              type: 'button', class: 'day-head day-head--add', text: '＋ 班を追加',
              onclick: function () { openNewItem(e, '', e._s); }
            }),
            el('div', { class: 'day-body day-body--add', style: { height: height + 'px' },
              onclick: function (ev) { openNewItem(e, '', snap(from + (ev.offsetY / HOUR) * 60)); } })
          ]));
        }
        group.appendChild(cols);
        grid.appendChild(group);
      });
    }

    function snap(m) { return Math.max(0, Math.min(47 * 60, Math.round(m / 15) * 15)); }

    function laneCol(e, lane, height, y, from, mine) {
      var list = items.filter(function (i) { return i.event_id === e.id && i.lane === lane; });
      var subs = packLane(list);
      var col = el('div', { class: 'day-col' + (subs > 1 ? ' day-col--wide' : '') });
      col.appendChild(el('div', { class: 'day-head', title: lane, text: lane }));
      var body = el('div', {
        class: 'day-body', style: { height: height + 'px' },
        onclick: function (ev) {
          if (!mine || ev.target !== body) return;
          openNewItem(e, lane, snap(from + (ev.offsetY / HOUR) * 60));
        }
      });
      list.forEach(function (it) {
        var w = 100 / subs;
        body.appendChild(el('button', {
          type: 'button', class: 'day-item',
          style: { top: y(it.start_min) + 'px', height: Math.max(20, y(it.end_min) - y(it.start_min) - 2) + 'px',
                   left: 'calc(' + (it._sub * w) + '% + 2px)', width: 'calc(' + w + '% - 4px)' },
          title: it.title,
          onclick: function () { if (mine) openEditItem(it, e); }
        }, [
          el('span', { class: 'day-item__time mono', text: fmtMin(it.start_min) + '〜' + fmtMin(it.end_min) }),
          el('span', { class: 'day-item__title', text: it.title })
        ]));
      });
      col.appendChild(body);
      return col;
    }

    /* ---------------- 小枠の入力 ---------------- */
    function initForm() {
      EM.$('#itCancelBtn').addEventListener('click', closeForm);
      EM.$('#itSaveBtn').addEventListener('click', save);
      EM.$('#itDeleteBtn').addEventListener('click', remove);
    }

    function fillLaneList(eventId) {
      var dl = EM.$('#laneList'); EM.clear(dl);
      var seen = [];
      items.forEach(function (i) { if (seen.indexOf(i.lane) === -1) seen.push(i.lane); });
      ['撮影本隊', '別班', '車両部', '制作部', '美術部', '衣装・ヘアメイク'].forEach(function (x) { if (seen.indexOf(x) === -1) seen.push(x); });
      seen.forEach(function (x) { dl.appendChild(el('option', { value: x })); });
    }

    function parentLine(e) {
      var pj = e.project_id && projects[e.project_id];
      return (pj ? pj + ' ／ ' : '') + e.title + '（' + fmtMin(e._s) + '〜' + fmtMin(e._t) + '）の中';
    }

    function openNewItem(e, lane, startMin) {
      EM.$('#itemFormTitle').textContent = '小枠を追加';
      EM.$('#itemFormParent').textContent = parentLine(e);
      EM.$('#itId').value = ''; EM.$('#itEvent').value = e.id;
      EM.$('#itLane').value = lane || '';
      EM.$('#itTitle').value = '';
      EM.$('#itStart').value = fmtMin(startMin);
      EM.$('#itEnd').value = fmtMin(Math.min(startMin + 60, 48 * 60 - 1));
      EM.$('#itNote').value = '';
      EM.$('#itDeleteBtn').hidden = true;
      fillLaneList(e.id);
      showForm(lane ? '#itTitle' : '#itLane');
    }

    function openEditItem(it, e) {
      EM.$('#itemFormTitle').textContent = '小枠を編集';
      EM.$('#itemFormParent').textContent = parentLine(e);
      EM.$('#itId').value = it.id; EM.$('#itEvent').value = it.event_id;
      EM.$('#itLane').value = it.lane;
      EM.$('#itTitle').value = it.title;
      EM.$('#itStart').value = fmtMin(it.start_min);
      EM.$('#itEnd').value = fmtMin(it.end_min);
      EM.$('#itNote').value = it.note || '';
      EM.$('#itDeleteBtn').hidden = false;
      fillLaneList(it.event_id);
      showForm('#itTitle');
    }

    function showForm(focusSel) {
      var f = EM.$('#itemForm');
      f.hidden = false;
      f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { var x = EM.$(focusSel); if (x) x.focus(); }, 250);
    }
    function closeForm() { EM.$('#itemForm').hidden = true; EM.notice(msg, ''); }

    function save() {
      var lane = EM.$('#itLane').value.trim(), title = EM.$('#itTitle').value.trim();
      var s = parseHM(EM.$('#itStart').value), t = parseHM(EM.$('#itEnd').value);
      if (!lane) { EM.notice(msg, '班・担当を入れてください。', 'error'); return; }
      if (!title) { EM.notice(msg, '内容を入れてください。', 'error'); return; }
      if (s === null || t === null) { EM.notice(msg, '時刻は「7:30」や「25:00」のように入れてください。', 'error'); return; }
      if (t <= s) { EM.notice(msg, '終了は開始より後にしてください（翌日にまたぐときは 25:00 のように書けます）。', 'error'); return; }
      var row = { event_id: EM.$('#itEvent').value, day: day, lane: lane, title: title,
                  start_min: s, end_min: t, note: EM.$('#itNote').value.trim() || null };
      var id = EM.$('#itId').value;
      var btn = EM.$('#itSaveBtn'); btn.setAttribute('aria-busy', 'true');
      var q = id ? sb.from('schedule_items').update(row).eq('id', id)
                 : sb.from('schedule_items').insert(row);
      q.then(function (r) {
        if (r.error) throw r.error;
        closeForm(); EM.toast('保存しました');
        return load();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); })
        .then(function () { btn.removeAttribute('aria-busy'); });
    }

    function remove() {
      var id = EM.$('#itId').value;
      if (!id || !confirm('この小枠を削除しますか？')) return;
      sb.from('schedule_items').delete().eq('id', id).then(function (r) {
        if (r.error) throw r.error;
        closeForm(); return load();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }
  });
})(window.EM);
