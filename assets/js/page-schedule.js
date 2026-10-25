/* Eizo Maps — 縦型カレンダー（業界標準の縦型ガントチャート）
   日付が縦に並び、列が案件。個人の予定はいちばん右の列にまとめる。
   見えてよい予定だけが返るように、絞り込みはサーバー側（RLS）で行う。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    var ROW = 34;                 // 1日ぶんの高さ(px)。CSS の grid-auto-rows と合わせる
    var EV_COLS = 'id,owner_user_id,project_id,sched_project_id,kind,title,note,location,starts_on,ends_on,start_time,end_time,busy,visibility,color';

    var KINDS = [
      ['shoot',    '撮影',    '#e8ff47'],
      ['edit',     '編集',    '#7ad1ff'],
      ['meeting',  '打合せ',  '#b79cff'],
      ['delivery', '納品',    '#4ade80'],
      ['hold',     '仮押さえ', '#ff9d5c'],
      ['other',    'その他',  '#9aa0b5'],
      ['private',  '非公開',  '#5a6072']
    ];
    function kindLabel(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === k) return KINDS[i][1]; return k; }
    function kindColor(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === k) return KINDS[i][2]; return '#9aa0b5'; }

    var me = null, creator = null, projects = [], sprojects = [], events = [];
    var gbusy = {};   // Google 側で予定がある日（日付だけ。件名などは持たない）
    var cursor = new Date(); cursor.setDate(1);
    var qm = String(EM.param('m') || ''), qnew = String(EM.param('new') || '');
    if (/^\d{4}-\d{2}$/.test(qm)) cursor = new Date(+qm.slice(0, 4), +qm.slice(5, 7) - 1, 1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(qnew)) cursor = new Date(+qnew.slice(0, 4), +qnew.slice(5, 7) - 1, 1);

    EM.requireUser().then(function (u) {
      if (!u) return;
      me = u;
      EM.$('#scheduleBody').hidden = false;
      initForm();
      return Promise.all([
        sb.from('creators').select('id,share_availability').eq('user_id', u.id).maybeSingle(),
        sb.from('projects').select('id,title,status,creator_id,client_id').order('created_at', { ascending: false }).limit(60),
        sb.from('schedule_projects').select('id,name').order('created_at', { ascending: false }).limit(300)
      ]);
    }).then(function (r) {
      if (!r) return;
      if (!r[0].error && r[0].data) {
        creator = r[0].data;
        EM.$('#shareAvailability').checked = !!creator.share_availability;
      } else {
        EM.$('#shareAvailability').disabled = true;
      }
      projects = (!r[1].error && r[1].data) || [];
      sprojects = (!r[2].error && r[2].data) || [];
      fillProjectSelect();
      return finishConnect().then(finishAddAccount).then(loadGcal).then(load).then(function () {
        // 日ごとの表示から「予定を追加」で来たとき
        if (/^\d{4}-\d{2}-\d{2}$/.test(qnew)) {
          openNew();
          EM.$('#evStart').value = qnew; EM.$('#evEnd').value = qnew;
        }
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    /* ---------------- 日付まわり ---------------- */
    function pad(n) { return String(n).padStart(2, '0'); }
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
    function monthStart() { return new Date(cursor.getFullYear(), cursor.getMonth(), 1); }
    function monthEnd() { return new Date(cursor.getFullYear(), cursor.getMonth(), daysInMonth(cursor)); }
    var WD = ['日', '月', '火', '水', '木', '金', '土'];

    /* ---------------- 読み込み ---------------- */
    function load() {
      var from = ymd(monthStart()), to = ymd(monthEnd());
      EM.$('#monthLabel').textContent = cursor.getFullYear() + '.' + pad(cursor.getMonth() + 1);
      return Promise.all([
        sb.from('schedule_events').select(EV_COLS)
          .lte('starts_on', to).gte('ends_on', from)
          .order('starts_on'),
        sb.from('google_busy').select('day').gte('day', from).lte('day', to)
      ]).then(function (rs) {
          var r = rs[0];
          if (r.error) throw r.error;
          events = r.data || [];
          gbusy = {};
          (rs[1].data || []).forEach(function (g) { gbusy[g.day] = true; });
          render();
        }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    EM.$('#prevMonth').addEventListener('click', function () {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); load();
    });
    EM.$('#nextMonth').addEventListener('click', function () {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); load();
    });
    EM.$('#thisMonth').addEventListener('click', function () {
      cursor = new Date(); cursor.setDate(1); load();
    });

    /* ---------------- 描画 ---------------- */
    // 表示する列を決める。今月に予定がある「自分で作った案件」＋今月に予定がある・動いている依頼の案件、最後に「個人」。
    function columns() {
      var used = {}, usedSp = {};
      events.forEach(function (e) {
        if (e.project_id) used[e.project_id] = true;
        if (e.sched_project_id) usedSp[e.sched_project_id] = true;
      });
      var live = { draft: 1, offered: 1, in_progress: 1, delivered: 1 };
      var cols = sprojects.filter(function (p) { return usedSp[p.id]; })
        .map(function (p) { return { sp: p.id, label: p.name }; })
        .concat(projects.filter(function (p) { return used[p.id] || live[p.status]; })
          .map(function (p) { return { id: p.id, label: p.title }; }))
        .slice(0, 8);
      cols.push({ id: null, label: '個人の予定' });
      return cols;
    }

    // 同じ列で日が重なる予定を横に並べる（レーン割り当て）
    function assignLanes(list) {
      var lanes = [];
      list.forEach(function (e) {
        var s = parseYmd(e.starts_on).getTime(), t = parseYmd(e.ends_on).getTime();
        var placed = false;
        for (var i = 0; i < lanes.length; i++) {
          var ok = lanes[i].every(function (x) {
            return t < parseYmd(x.starts_on).getTime() || s > parseYmd(x.ends_on).getTime();
          });
          if (ok) { lanes[i].push(e); e._lane = i; placed = true; break; }
        }
        if (!placed) { lanes.push([e]); e._lane = lanes.length - 1; }
      });
      return Math.max(1, lanes.length);
    }

    function render() {
      var box = EM.$('#vcal');
      EM.clear(box);
      var cols = columns();
      var days = daysInMonth(cursor);
      var mStart = monthStart();

      box.style.gridTemplateColumns = '58px repeat(' + cols.length + ', minmax(116px, 1fr))';

      // 見出し
      box.appendChild(el('div', { class: 'vcal__head vcal__head--date', text: '日付' }));
      cols.forEach(function (c) {
        box.appendChild(el('div', { class: 'vcal__head', title: c.label }, el('span', { text: c.label })));
      });

      // 日付の列
      var today = ymd(new Date());
      for (var i = 0; i < days; i++) {
        var d = new Date(mStart.getFullYear(), mStart.getMonth(), i + 1);
        var wd = d.getDay();
        box.appendChild(el('a', {
          href: '/schedule/day.html?d=' + ymd(d),
          title: 'この日の時間割を開く',
          class: 'vcal__day' + (wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : '')
                 + (ymd(d) === today ? ' is-today' : ''),
          style: { gridColumn: '1', gridRow: String(i + 2) }
        }, [
          el('span', { class: 'vcal__dnum', text: String(i + 1) }),
          el('span', { class: 'vcal__dwd', text: WD[wd] })
        ]));
      }

      // 各列の予定
      cols.forEach(function (c, ci) {
        var lane = el('div', {
          class: 'vcal__col',
          style: {
            gridColumn: String(ci + 2),
            gridRow: '2 / span ' + days,
            height: (days * ROW) + 'px'
          }
        });
        var list = events.filter(function (e) {
          if (c.sp) return e.sched_project_id === c.sp;
          if (c.id) return e.project_id === c.id && !e.sched_project_id;
          return !e.project_id && !e.sched_project_id;
        });
        // 個人の予定の列に、Google 側で予定がある日の印を敷く（予定のバーの下に出る）
        if (!c.id && !c.sp) {
          for (var di = 0; di < days; di++) {
            var dk = ymd(new Date(mStart.getFullYear(), mStart.getMonth(), di + 1));
            if (!gbusy[dk]) continue;
            lane.appendChild(el('div', {
              class: 'vcal__gbusy',
              style: { top: (di * ROW + 2) + 'px', height: (ROW - 4) + 'px' },
              title: 'Google カレンダーに予定があります'
            }, el('span', { text: 'Google に予定あり' })));
          }
        }
        var laneCount = assignLanes(list);
        list.forEach(function (e) {
          lane.appendChild(bar(e, mStart, days, laneCount));
        });
        box.appendChild(lane);
      });

      renderLegend();
    }

    function bar(e, mStart, days, laneCount) {
      var s = parseYmd(e.starts_on), t = parseYmd(e.ends_on);
      var sIdx = Math.max(0, Math.round((s - mStart) / 86400000));
      var eIdx = Math.min(days - 1, Math.round((t - mStart) / 86400000));
      var top = sIdx * ROW + 2;
      var height = (eIdx - sIdx + 1) * ROW - 4;
      var w = 100 / laneCount;
      var mine = e.owner_user_id === me.id;

      var timeText = e.start_time
        ? e.start_time.slice(0, 5) + (e.end_time ? '–' + e.end_time.slice(0, 5) : '')
        : null;

      var node = el('button', {
        type: 'button',
        class: 'vcal__bar' + (mine ? '' : ' is-others') + (e.busy ? '' : ' is-free'),
        style: {
          top: top + 'px',
          height: height + 'px',
          left: (e._lane * w) + '%',
          width: 'calc(' + w + '% - 4px)',
          '--bar': kindColor(e.kind)
        },
        title: e.title + (e.location ? ' / ' + e.location : ''),
        onclick: function () { mine ? openEdit(e) : openView(e); }
      }, [
        el('span', { class: 'vcal__bar-kind', text: kindLabel(e.kind) }),
        el('span', { class: 'vcal__bar-title', text: e.title }),
        timeText ? el('span', { class: 'vcal__bar-time mono', text: timeText }) : null
      ]);
      return node;
    }

    function renderLegend() {
      var box = EM.$('#legend');
      EM.clear(box);
      KINDS.forEach(function (k) {
        box.appendChild(el('span', { class: 'vcal-key' }, [
          el('i', { class: 'vcal-key__dot', style: { background: k[2] } }),
          el('span', { class: 'small muted', text: k[1] })
        ]));
      });
      if (gcal && gcal.connected && gcal.sync_pull) {
        box.appendChild(el('span', { class: 'vcal-key' }, [
          el('i', { class: 'vcal-key__dot vcal-key__dot--g' }),
          el('span', { class: 'small muted', text: 'Google に予定あり' })
        ]));
      }
    }

    /* ---------------- 入力フォーム ---------------- */
    function initForm() {
      var kind = EM.$('#evKind');
      KINDS.forEach(function (k) { kind.appendChild(el('option', { value: k[0], text: k[1] })); });
      EM.$('#evProject').addEventListener('change', syncVisibilityRow);
      EM.$('#newEventBtn').addEventListener('click', function () { openNew(); });
      EM.$('#evCancelBtn').addEventListener('click', closeForm);
      EM.$('#evSaveBtn').addEventListener('click', save);
      EM.$('#evDeleteBtn').addEventListener('click', remove);
      EM.$('#shareAvailability').addEventListener('change', saveShare);
      // Google 連携の設定は、変えたら少し待って自動で保存する（チェックをまとめて変えても1回で済むように）
      EM.$('#gcalOptions').addEventListener('change', function () {
        clearTimeout(gcalSaveTimer);
        gcalSaveTimer = setTimeout(saveGcal, 700);
      });
    }

    // 案件の選び方：自分で作った案件（sp:）／依頼の案件（rq:）／新しく作る（new）
    function fillProjectSelect() {
      var sel = EM.$('#evProject');
      EM.clear(sel);
      sel.appendChild(el('option', { value: '', text: '案件なし（個人の予定）' }));
      if (sprojects.length) {
        sel.appendChild(el('optgroup', { label: '自分で作った案件' },
          sprojects.map(function (p) { return el('option', { value: 'sp:' + p.id, text: p.name }); })));
      }
      if (projects.length) {
        sel.appendChild(el('optgroup', { label: 'Eizo Maps の依頼の案件' },
          projects.map(function (p) { return el('option', { value: 'rq:' + p.id, text: p.title }); })));
      }
      sel.appendChild(el('option', { value: 'new', text: '＋ 新しい案件を作る' }));
    }

    function syncVisibilityRow() {
      var v = EM.$('#evProject').value;
      var isRq = v.indexOf('rq:') === 0;
      EM.$('#evVisibilityRow').hidden = !isRq;
      if (!isRq) EM.$('#evVisibility').checked = false;
      EM.$('#evNewProjectRow').hidden = v !== 'new';
      if (v === 'new') setTimeout(function () { EM.$('#evNewProject').focus(); }, 50);
    }

    function openNew() {
      EM.$('#eventFormTitle').textContent = '予定を追加';
      EM.$('#evId').value = '';
      EM.$('#evProject').value = '';
      EM.$('#evNewProject').value = '';
      EM.$('#evKind').value = 'shoot';
      EM.$('#evTitle').value = '';
      var d = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      EM.$('#evStart').value = d;
      EM.$('#evEnd').value = d;
      EM.$('#evStartTime').value = '';
      EM.$('#evEndTime').value = '';
      EM.$('#evLocation').value = '';
      EM.$('#evNote').value = '';
      EM.$('#evBusy').checked = true;
      EM.$('#evVisibility').checked = false;
      EM.$('#evDeleteBtn').hidden = true;
      EM.$('#evDayLink').hidden = true;
      syncVisibilityRow();
      showForm();
    }

    function openEdit(e) {
      EM.$('#eventFormTitle').textContent = '予定を編集';
      EM.$('#evId').value = e.id;
      EM.$('#evProject').value = e.sched_project_id ? 'sp:' + e.sched_project_id : (e.project_id ? 'rq:' + e.project_id : '');
      EM.$('#evNewProject').value = '';
      EM.$('#evKind').value = e.kind;
      EM.$('#evTitle').value = e.title;
      EM.$('#evStart').value = e.starts_on;
      EM.$('#evEnd').value = e.ends_on;
      EM.$('#evStartTime').value = e.start_time ? e.start_time.slice(0, 5) : '';
      EM.$('#evEndTime').value = e.end_time ? e.end_time.slice(0, 5) : '';
      EM.$('#evLocation').value = e.location || '';
      EM.$('#evNote').value = e.note || '';
      EM.$('#evBusy').checked = !!e.busy;
      EM.$('#evVisibility').checked = e.visibility === 'project';
      EM.$('#evDeleteBtn').hidden = false;
      EM.$('#evDayLink').href = '/schedule/day.html?d=' + e.starts_on;
      EM.$('#evDayLink').hidden = false;
      syncVisibilityRow();
      showForm();
    }

    // 他人（案件の相手）の予定は読むだけ
    function openView(e) {
      EM.notice(msg, [kindLabel(e.kind), e.title, e.location, e.starts_on + '〜' + e.ends_on]
        .filter(Boolean).join(' / '), 'ok');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showForm() {
      var f = EM.$('#eventForm');
      f.hidden = false;
      f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function closeForm() { EM.$('#eventForm').hidden = true; EM.notice(msg, ''); }

    function save() {
      var title = EM.$('#evTitle').value.trim();
      var starts = EM.$('#evStart').value;
      var ends = EM.$('#evEnd').value || starts;
      if (!title) { EM.notice(msg, '件名を入力してください。', 'error'); return; }
      if (!starts) { EM.notice(msg, '開始日を入力してください。', 'error'); return; }
      if (ends < starts) { EM.notice(msg, '終了日は開始日以降にしてください。', 'error'); return; }

      var st = EM.$('#evStartTime').value, et = EM.$('#evEndTime').value;
      if (!st && et) { EM.notice(msg, '終了時刻だけの指定はできません。開始時刻も入れてください。', 'error'); return; }

      var pv = EM.$('#evProject').value;
      var newName = EM.$('#evNewProject').value.trim();
      if (pv === 'new' && !newName) { EM.notice(msg, '新しい案件の名前を入れてください（例：◯◯CM）。', 'error'); return; }
      var pid = pv.indexOf('rq:') === 0 ? pv.slice(3) : null;
      var spid = pv.indexOf('sp:') === 0 ? pv.slice(3) : null;
      var row = {
        project_id: pid,
        sched_project_id: spid,
        kind: EM.$('#evKind').value,
        title: title,
        note: EM.$('#evNote').value.trim() || null,
        location: EM.$('#evLocation').value.trim() || null,
        starts_on: starts,
        ends_on: ends,
        start_time: st || null,
        end_time: et || null,
        busy: EM.$('#evBusy').checked,
        visibility: (pid && EM.$('#evVisibility').checked) ? 'project' : 'private'
      };

      var id = EM.$('#evId').value;
      var btn = EM.$('#evSaveBtn'); btn.setAttribute('aria-busy', 'true');
      // 「新しい案件を作る」を選んだときは、先に案件を作ってから予定を保存する
      var pre = pv === 'new'
        ? sb.from('schedule_projects').insert({ name: newName }).select('id,name').single().then(function (r) {
            if (r.error) throw r.error;
            sprojects.unshift(r.data);
            row.sched_project_id = r.data.id;
          })
        : Promise.resolve();
      pre.then(function () {
        return id ? sb.from('schedule_events').update(row).eq('id', id)
                  : sb.from('schedule_events').insert(row);
      }).then(function (r) {
        if (r.error) throw r.error;
        if (pv === 'new') fillProjectSelect();
        closeForm();
        EM.toast('保存しました');
        quietSync();
        return load();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); })
        .then(function () { btn.removeAttribute('aria-busy'); });
    }

    function remove() {
      var id = EM.$('#evId').value;
      if (!id || !confirm('この予定を削除しますか？')) return;
      sb.from('schedule_events').delete().eq('id', id)
        .then(function (r) { if (r.error) throw r.error; closeForm(); quietSync(); return load(); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    /* ---------------- Google カレンダー連携 ----------------
       Google を直接叩くのはサーバー側（Edge Function）だけ。
       この画面がやるのは「許可をもらってくる」ことと「同期して」と頼むことだけ。 */
    var gcal = null;
    var gcalCals = null;   // Google のカレンダー一覧（名前と書き込めるかだけ）。つないだ全部のアカウント分
    var gcalAccts = null;  // [{id: null（1つ目）か番号, email, main, error, calendars, busy_calendar_ids}]
    var gcalPushAcct = null;

    function gcalCall(body) {
      return sb.functions.invoke('google-calendar', { body: body }).then(function (r) {
        if (r.error) {
          // 関数からのエラー本文を拾って日本語のまま出す
          if (r.error.context && typeof r.error.context.json === 'function') {
            return r.error.context.json().then(function (j) {
              throw new Error((j && j.error) || r.error.message);
            }, function () { throw new Error(r.error.message); });
          }
          throw new Error(r.error.message);
        }
        if (r.data && r.data.error) throw new Error(r.data.error);
        return r.data;
      });
    }

    // 予定を入れた・消したときに、裏でそっと Google と同期する（失敗しても15分ごとの自動同期で追いつく）
    var quietTimer = null;
    function quietSync() {
      if (!gcal || !gcal.connected) return;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(function () {
        gcalCall({ action: 'sync' }).then(function (d) {
          if (d && d.removed_from_eizo) load();
          return loadGcal();
        }).catch(function () { /* 次の自動同期に任せる */ });
      }, 800);
    }

    // ページを開いたとき、前の同期から5分以上たっていれば同期しておく
    var openedSync = false;
    function syncOnOpen() {
      if (openedSync || !gcal || !gcal.connected) return;
      openedSync = true;
      var last = gcal.last_sync_at ? Date.parse(gcal.last_sync_at) : 0;
      if (Date.now() - last < 5 * 60 * 1000) return;
      gcalCall({ action: 'sync' }).then(function () {
        return loadGcal();
      }).then(load).catch(function () { /* 画面には出さない */ });
    }

    function loadGcal() {
      return sb.rpc('my_calendar_link').then(function (r) {
        if (r.error) throw r.error;
        gcal = r.data || { connected: false };
        renderGcal();
      }).catch(function () {
        EM.$('#gcalState').textContent = '連携の状態を確認できませんでした。';
      });
    }

    var gcalOpen = EM.param('gcal') === 'back' || EM.param('gcal') === 'added';   // つないだ直後は、カレンダーを選べるように開いておく
    function setGcalOpen(open) {
      gcalOpen = open;
      var connected = !!(gcal && gcal.connected);
      EM.$('#gcalOptions').hidden = !(connected && open);
      EM.$('#gcalDisconnectBtn').hidden = !(connected && open);
      var t = EM.$('#gcalOptToggle');
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
      t.textContent = open ? '同期の設定を閉じる' : '同期の設定を開く';
    }
    EM.$('#gcalOptToggle').addEventListener('click', function () { setGcalOpen(!gcalOpen); });

    function renderGcal() {
      var st = EM.$('#gcalState');
      var connected = !!(gcal && gcal.connected);
      EM.$('#gcalConnectBtn').hidden = connected;
      EM.$('#gcalSyncBtn').hidden = !connected;
      // 連携したあとは、状態の1行と「今すぐ同期」だけをすっきり見せる。細かい設定と解除は「同期の設定を開く」の中
      EM.$('#gcalIntro').hidden = connected;
      EM.$('#gcalOptToggle').hidden = !connected;
      setGcalOpen(connected && gcalOpen);

      if (!connected) {
        st.textContent = '連携していません。連携すると、この画面の予定が Google カレンダーにも入ります。';
        return;
      }
      EM.$('#gcalPush').checked = !!gcal.sync_push;
      EM.$('#gcalPull').checked = !!gcal.sync_pull;
      var nAcct = 1 + (gcal.accounts || []).length;
      var parts = [nAcct > 1 ? 'Google アカウント ' + nAcct + 'つと連携中' : (gcal.google_email || 'Google アカウント') + ' と連携中'];
      parts.push(gcal.last_sync_at ? '最終同期: ' + syncTime(gcal.last_sync_at) : 'まだ同期していません');
      if (gcal.pending) parts.push('未同期の予定: ' + gcal.pending + '件');
      if (gcal.google_busy_days) parts.push('埋まっている日: ' + gcal.google_busy_days + '日');
      st.textContent = parts.join(' ／ ');
      if (gcal.last_sync_error) {
        EM.notice(msg, '前回の同期で問題がありました: ' + gcal.last_sync_error, 'error');
      }
      renderAccounts();
      loadCalendars();
      syncOnOpen();
    }

    function syncTime(iso) {
      var d = new Date(iso);
      var mins = Math.round((Date.now() - d.getTime()) / 60000);
      if (mins < 1) return 'たった今';
      if (mins < 60) return mins + '分前';
      return EM.date(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // 「＋ Google アカウントを追加」は全部で6つになるまで出す
    function renderAccounts() {
      var n = 1 + ((gcal && gcal.accounts) || []).length;
      EM.$('#gcalAddBtn').hidden = n >= 6;
      var note = EM.$('#gcalAddNote');
      note.hidden = n < 6;
      note.textContent = 'つなげられる Google アカウントは6つまでです。';
    }

    function removeAccount(a) {
      if (!confirm((a.google_email || 'このアカウント') + ' を外しますか？\nこのアカウントのカレンダーは「埋まっている日」に使わなくなります。\nこのアカウントに書き出した Eizo Maps の予定は Google 側から消し、今の書き出し先に書き直します。')) return;
      gcalCall({ action: 'remove_account', account_id: a.id }).then(function () {
        gcalCals = null; gcalAccts = null;
        EM.toast('外しました');
        return loadGcal();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    // 書き出す先・埋まっている日に含めるカレンダーを選ぶ欄
    function loadCalendars() {
      var p = gcalAccts ? Promise.resolve(null) : gcalCall({ action: 'list_calendars' });
      return p.then(function (d) {
        if (d) {
          gcalAccts = d.accounts || [{ id: null, email: gcal.google_email, main: true, calendars: d.calendars || [],
            busy_calendar_ids: d.busy_calendar_ids }];
          gcalPushAcct = d.push_account_id || null;
          gcalCals = [];
          gcalAccts.forEach(function (a) { gcalCals = gcalCals.concat(a.calendars || []); });
        }
        renderCalendars();
      }).catch(function () {
        EM.$('#gcalWriteWrap').hidden = true;
        EM.$('#gcalBusyList').textContent = '';
      });
    }

    function isPrimaryIn(cals, id) {
      return id === 'primary' || (cals || []).some(function (c) { return c.primary && c.id === id; });
    }
    function sameCalIn(cals, a, b) { return a === b || (isPrimaryIn(cals, a) && isPrimaryIn(cals, b)); }
    function acctKey(id) { return id || 'main'; }
    function acctLabel(a) { return (a.email || 'Google アカウント') + (a.main ? '（1つ目）' : ''); }

    function calLabel(c) { return c.primary ? 'メイン' : c.name; }
    function acctError(a) {
      if (a.error) return 'カレンダーを読めませんでした';
      var x = ((gcal && gcal.accounts) || []).filter(function (g) { return g.id === a.id; })[0];
      return x && x.last_sync_error ? '許可が切れています' : '';
    }

    // アカウントごとに1枚のカード：見出し（アカウント）＋カレンダーのボタン（押すと「埋まっている日」に入る・外れる）
    function renderCalendars() {
      if (!gcalAccts || !gcalAccts.length) return;
      var writeId = (gcal && gcal.calendar_id) || 'primary';
      var multi = gcalAccts.length > 1;

      // 書き出す先：アカウントが2つ以上なら、アカウントごとにまとめて出す
      var sel = EM.$('#gcalWriteCal');
      sel.textContent = '';
      gcalAccts.forEach(function (a) {
        var parent = sel;
        if (multi) {
          parent = document.createElement('optgroup');
          parent.label = a.email || 'Google アカウント';
          sel.appendChild(parent);
        }
        (a.calendars || []).filter(function (c) { return c.writable; }).forEach(function (c) {
          var o = document.createElement('option');
          o.value = acctKey(a.id) + '|' + c.id;
          // 閉じているときもどのアカウントか分かるように、アカウント名（@の前）を添える
          var who = String(a.email || '').split('@')[0];
          o.textContent = calLabel(c) + (multi && who ? '（' + who + '）' : '');
          if (acctKey(a.id) === acctKey(gcalPushAcct) && sameCalIn(a.calendars, c.id, writeId)) o.selected = true;
          parent.appendChild(o);
        });
      });

      var list = EM.$('#gcalBusyList');
      list.textContent = '';
      gcalAccts.forEach(function (a) {
        var card = document.createElement('div');
        card.className = 'gcal-card';

        var head = document.createElement('div');
        head.className = 'gcal-card__head';
        var main = (a.calendars || []).filter(function (c) { return c.primary; })[0];
        var av = document.createElement('span');
        av.className = 'gcal-card__avatar';
        av.textContent = String(a.email || 'G').charAt(0).toUpperCase();
        if (main && main.color) av.style.background = main.color;
        head.appendChild(av);
        var name = document.createElement('span');
        name.className = 'gcal-card__name';
        name.textContent = a.email || 'Google アカウント';
        name.title = a.email || '';
        head.appendChild(name);
        var err = acctError(a);
        if (err) {
          var e = document.createElement('span');
          e.className = 'gcal-card__err';
          e.textContent = err;
          head.appendChild(e);
        }
        if (!a.main) {
          var rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'gcal-card__remove';
          rm.textContent = '外す';
          rm.setAttribute('aria-label', (a.email || 'このアカウント') + ' を外す');
          rm.addEventListener('click', function () { removeAccount({ id: a.id, google_email: a.email }); });
          head.appendChild(rm);
        }
        card.appendChild(head);

        var chips = document.createElement('div');
        chips.className = 'gcal-chips';
        var busy = a.busy_calendar_ids || [];
        (a.calendars || []).forEach(function (c) {
          var lab = document.createElement('label');
          lab.className = 'gcal-chip';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = c.id;
          cb.setAttribute('data-acct', acctKey(a.id));
          cb.checked = busy.some(function (b) { return sameCalIn(a.calendars, b, c.id); });
          lab.classList.toggle('is-on', cb.checked);
          cb.addEventListener('change', function () { lab.classList.toggle('is-on', cb.checked); });
          var dot = document.createElement('span');
          dot.className = 'gcal-dot';
          if (c.color) dot.style.background = c.color;
          var t = document.createElement('span');
          t.textContent = calLabel(c);
          lab.appendChild(cb); lab.appendChild(dot); lab.appendChild(t);
          chips.appendChild(lab);
        });
        card.appendChild(chips);
        list.appendChild(card);
      });

      syncSubVisibility();
    }

    // 別の Google アカウントを追加する：Google の画面でアカウントを選んで許可 → google-callback.html → この画面に戻る
    function b64url(bytes) {
      var s = '';
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function randomText(n) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
    function addRedirect() {
      var base = location.origin === 'http://127.0.0.1:8123' ? location.origin : (EM.config.SITE_ORIGIN || location.origin);
      return base + '/schedule/google-callback.html';
    }

    EM.$('#gcalAddBtn').addEventListener('click', function () {
      var b = this; b.setAttribute('aria-busy', 'true');
      EM.notice(msg, '');
      var verifier = randomText(48);
      var state = randomText(24);
      var redirect = addRedirect();
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (h) {
        return gcalCall({ action: 'add_account_url', code_challenge: b64url(new Uint8Array(h)), state: state, redirect_uri: redirect });
      }).then(function (d) {
        sessionStorage.setItem('em_gadd', JSON.stringify({ verifier: verifier, state: state, redirect: redirect, at: Date.now() }));
        location.href = d.url;
      }).catch(function (e) {
        b.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(e), 'error');
      });
    });

    // google-callback.html から戻ってきたら、許可の番号をサーバーで許可に引き換えてもらう（このタブで始めたものだけ）
    function finishAddAccount() {
      if (EM.param('gcal') !== 'added') return Promise.resolve();
      var start = null, back = null;
      try {
        start = JSON.parse(sessionStorage.getItem('em_gadd') || 'null');
        back = JSON.parse(sessionStorage.getItem('em_gadd_back') || 'null');
      } catch (e) { /* 下で知らせる */ }
      try { sessionStorage.removeItem('em_gadd'); sessionStorage.removeItem('em_gadd_back'); } catch (e) { /* なし */ }
      history.replaceState(null, '', '/schedule/');
      if (!back || !start) return Promise.resolve();
      if (back.error) {
        EM.notice(msg, back.error === 'access_denied' ? 'Google アカウントの追加をやめました。' : 'Google アカウントを追加できませんでした（' + String(back.error).slice(0, 60) + '）', back.error === 'access_denied' ? '' : 'error');
        return Promise.resolve();
      }
      if (!back.code || back.state !== start.state || Date.now() - (start.at || 0) > 15 * 60 * 1000) {
        EM.notice(msg, 'Google からの戻りを確かめられませんでした。もう一度「別の Google アカウントを追加」からお試しください。', 'error');
        return Promise.resolve();
      }
      return gcalCall({ action: 'add_account', code: back.code, code_verifier: start.verifier, redirect_uri: start.redirect }).then(function (d) {
        gcalCals = null; gcalAccts = null;
        EM.toast(d.same_as_main ? (d.email || '') + ' は1つ目のアカウントです（許可を新しくしました）'
          : d.again ? (d.email || '') + ' の許可を新しくしました'
          : (d.email || 'Google アカウント') + ' を追加しました');
        return gcalCall({ action: 'sync' }).catch(function () { /* 15分ごとの自動同期に任せる */ });
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function syncSubVisibility() {
      var ready = !!(gcalCals && gcalCals.length);
      EM.$('#gcalWriteWrap').hidden = !ready || !EM.$('#gcalPush').checked;
      var pull = EM.$('#gcalPull').checked;
      EM.$('#gcalBusyList').classList.toggle('is-off', !pull);
      EM.$('#gcalBusyHint').textContent = pull
        ? 'タップしたカレンダーの予定を「埋まっている日」に含めます（件名・場所は取り込みません）。'
        : 'つないでいる Google アカウント（「埋まっている日」に含めるをオンにすると、カレンダーを選べます）';
    }
    EM.$('#gcalPush').addEventListener('change', syncSubVisibility);
    EM.$('#gcalPull').addEventListener('change', syncSubVisibility);

    EM.$('#gcalConnectBtn').addEventListener('click', function () {
      EM.notice(msg, '');
      // access_type=offline と prompt=consent を付けないと、
      // 裏で同期し続けるための許可（リフレッシュトークン）がもらえない。
      var opts = {
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
          redirectTo: (EM.config.SITE_ORIGIN || location.origin) + '/schedule/?gcal=back',
          queryParams: { access_type: 'offline', prompt: 'consent' }
        }
      };
      sb.auth.getUser().then(function (r) {
        var u = r.data && r.data.user;
        var hasGoogle = !!(u && (u.identities || []).some(function (i) { return i.provider === 'google'; }));
        // すでに Google でもログインできる人は「Google でログインし直す」形で許可をもらう。
        // まだの人は、今のアカウントに Google を追加する形にする。
        if (hasGoogle) return sb.auth.signInWithOAuth(opts);
        return sb.auth.linkIdentity(opts).then(function (res) {
          if (res && res.error) {
            EM.notice(msg, String(res.error.message || '') + '（Supabase の Authentication 設定で「Manual linking」が有効か確認してください）', 'error');
          }
        });
      });
    });

    // Google から戻ってきたときにエラーが付いていたら、わかる言葉で知らせる
    function backError() {
      var q = new URLSearchParams(location.search);
      var h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      var d = q.get('error_description') || h.get('error_description') || '';
      if (!d) return false;
      if (/already linked/i.test(d)) {
        EM.notice(msg, '選んだ Google アカウントは、別の Eizo Maps のアカウントにつながっています。いまログインしている Eizo Maps のアカウントを確かめてから、もう一度お試しください。', 'error');
      } else {
        EM.notice(msg, 'Google との連携ができませんでした（' + d.slice(0, 120) + '）', 'error');
      }
      return true;
    }

    // Google から戻ってきたら、許可を一度だけサーバーへ預ける
    function finishConnect() {
      if (EM.param('gcal') !== 'back') return Promise.resolve();
      if (backError()) return Promise.resolve();
      return sb.auth.getSession().then(function (r) {
        var sess = r.data && r.data.session;
        var rt = sess && sess.provider_refresh_token;
        var ident = (sess && sess.user && sess.user.identities || []).filter(function (i) {
          return i.provider === 'google';
        })[0];
        if (!rt) {
          EM.notice(msg, 'Google からの許可を受け取れませんでした。Google アカウントの「サードパーティ アプリとの連携」で Eizo Maps の許可をいったん削除してから、もう一度お試しください。', 'error');
          return;
        }
        return gcalCall({
          action: 'connect',
          refresh_token: rt,
          google_email: (ident && ident.identity_data && ident.identity_data.email) || (sess.user && sess.user.email),
          google_sub: ident && ident.id,
          scope: 'calendar.events'
        }).then(function () {
          // ブラウザ側に許可が残らないよう、セッションを取り直す
          return sb.auth.refreshSession();
        }).then(function () {
          EM.toast('連携しました');
          return gcalCall({ action: 'sync' });
        }).then(function () {
          history.replaceState(null, '', '/schedule/');
        });
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    EM.$('#gcalSyncBtn').addEventListener('click', function () {
      var b = this; b.setAttribute('aria-busy', 'true');
      EM.notice(msg, '');
      gcalCall({ action: 'sync' }).then(function (d) {
        var t = '書き出し ' + ((d.pushed || 0) + (d.updated || 0)) + '件 ／ 取り込み ' + (d.busy_days || 0) + '日';
        if (d.removed_from_eizo) t += ' ／ Google で消された予定 ' + d.removed_from_eizo + '件を削除';
        EM.toast(t);
        return Promise.all([loadGcal(), d.removed_from_eizo ? load() : null]);
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); })
        .then(function () { b.removeAttribute('aria-busy'); });
    });

    // 自動保存の状態を出す（例：保存しました（2026.10.20 13:05））
    function autosaveState(node, state, err) {
      node.classList.toggle('is-busy', state === 'busy');
      node.textContent = state === 'busy' ? '保存しています…'
        : state === 'error' ? '保存できませんでした：' + err
        : '保存しました（' + EM.datetime(new Date().toISOString()) + '）';
    }

    var gcalSaveTimer = null;
    function saveGcal() {
      var st = EM.$('#gcalSaved');
      var checked = EM.$$('#gcalBusyList input:checked');
      var busyIds = checked.map(function (cb) { return cb.value; });
      if (EM.$('#gcalPull').checked && gcalCals && gcalCals.length && !busyIds.length) {
        autosaveState(st, 'error', '「埋まっている日」に含めるカレンダーを1つ以上選んでください。');
        return;
      }
      autosaveState(st, 'busy');
      sb.rpc('set_calendar_sync', {
        p_push: EM.$('#gcalPush').checked,
        p_pull: EM.$('#gcalPull').checked
      }).then(function (r) {
        if (r.error) throw r.error;
        if (!gcalCals || !gcalCals.length) return null;
        var w = String(EM.$('#gcalWriteCal').value || 'main|primary');
        var cut = w.indexOf('|');
        var wAcct = w.slice(0, cut), wCal = w.slice(cut + 1);
        // アカウントごとに「埋まっている日」に使うカレンダーをまとめる（何も選ばなかったアカウントも空で送る）
        var busy = (gcalAccts || []).map(function (a) {
          var k = acctKey(a.id);
          return {
            account_id: a.id,
            ids: checked.filter(function (cb) { return cb.getAttribute('data-acct') === k; }).map(function (cb) { return cb.value; })
          };
        });
        return gcalCall({
          action: 'set_calendars',
          write: { account_id: wAcct === 'main' ? null : wAcct, calendar_id: wCal },
          busy: busy
        }).then(function () { gcalAccts = null; });
      }).then(function () {
        autosaveState(st, 'ok');
        return loadGcal();
      }).catch(function (e) { autosaveState(st, 'error', EM.errorText(e)); });
    }

    EM.$('#gcalDisconnectBtn').addEventListener('click', function () {
      var many = gcal && gcal.accounts && gcal.accounts.length;
      if (!confirm('Google カレンダーとの連携を解除しますか？' + (many ? '\nつないでいる全部の Google アカウントの連携が外れます（1つだけ外すときは、アカウントの一覧の「外す」を使ってください）。' : '') + '\nGoogle 側に書き出した予定はそのまま残ります。')) return;
      gcalCall({ action: 'disconnect' }).then(function () {
        gcalCals = null; gcalAccts = null;
        EM.toast('連携を解除しました');
        return loadGcal();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    });

    function saveShare() {
      var st = EM.$('#shareSaved');
      if (!creator) { autosaveState(st, 'error', 'クリエイタープロフィールを作成すると公開できます。'); return; }
      autosaveState(st, 'busy');
      sb.from('creators').update({ share_availability: EM.$('#shareAvailability').checked })
        .eq('id', creator.id)
        .then(function (r) { if (r.error) throw r.error; autosaveState(st, 'ok'); })
        .catch(function (err) { autosaveState(st, 'error', EM.errorText(err)); });
    }
  });
})(window.EM);
