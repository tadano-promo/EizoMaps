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
    var EV_COLS = 'id,owner_user_id,project_id,kind,title,note,location,starts_on,ends_on,start_time,end_time,busy,visibility,color';

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

    var me = null, creator = null, projects = [], events = [];
    var cursor = new Date(); cursor.setDate(1);

    EM.requireUser().then(function (u) {
      if (!u) return;
      me = u;
      EM.$('#scheduleBody').hidden = false;
      initForm();
      return Promise.all([
        sb.from('creators').select('id,share_availability').eq('user_id', u.id).maybeSingle(),
        sb.from('projects').select('id,title,status,creator_id,client_id').order('created_at', { ascending: false }).limit(60)
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
      fillProjectSelect();
      return finishConnect().then(loadGcal).then(load);
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
      return sb.from('schedule_events').select(EV_COLS)
        .lte('starts_on', to).gte('ends_on', from)
        .order('starts_on')
        .then(function (r) {
          if (r.error) throw r.error;
          events = r.data || [];
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
    // 表示する列を決める。今月に予定がある案件＋動いている案件、最後に「個人」。
    function columns() {
      var used = {};
      events.forEach(function (e) { if (e.project_id) used[e.project_id] = true; });
      var live = { draft: 1, offered: 1, in_progress: 1, delivered: 1 };
      var cols = projects.filter(function (p) { return used[p.id] || live[p.status]; })
        .slice(0, 8)
        .map(function (p) { return { id: p.id, label: p.title }; });
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
        box.appendChild(el('div', {
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
          return c.id ? e.project_id === c.id : !e.project_id;
        });
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
      EM.$('#saveShareBtn').addEventListener('click', saveShare);
    }

    function fillProjectSelect() {
      var sel = EM.$('#evProject');
      EM.clear(sel);
      sel.appendChild(el('option', { value: '', text: '案件なし（個人の予定）' }));
      projects.forEach(function (p) { sel.appendChild(el('option', { value: p.id, text: p.title })); });
    }

    function syncVisibilityRow() {
      var hasProject = !!EM.$('#evProject').value;
      EM.$('#evVisibilityRow').hidden = !hasProject;
      if (!hasProject) EM.$('#evVisibility').checked = false;
    }

    function openNew() {
      EM.$('#eventFormTitle').textContent = '予定を追加';
      EM.$('#evId').value = '';
      EM.$('#evProject').value = '';
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
      syncVisibilityRow();
      showForm();
    }

    function openEdit(e) {
      EM.$('#eventFormTitle').textContent = '予定を編集';
      EM.$('#evId').value = e.id;
      EM.$('#evProject').value = e.project_id || '';
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

      var pid = EM.$('#evProject').value || null;
      var row = {
        project_id: pid,
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
      var q = id ? sb.from('schedule_events').update(row).eq('id', id)
                 : sb.from('schedule_events').insert(row);
      q.then(function (r) {
        if (r.error) throw r.error;
        closeForm();
        EM.toast('保存しました');
        return load();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); })
        .then(function () { btn.removeAttribute('aria-busy'); });
    }

    function remove() {
      var id = EM.$('#evId').value;
      if (!id || !confirm('この予定を削除しますか？')) return;
      sb.from('schedule_events').delete().eq('id', id)
        .then(function (r) { if (r.error) throw r.error; closeForm(); return load(); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    /* ---------------- Google カレンダー連携 ----------------
       Google を直接叩くのはサーバー側（Edge Function）だけ。
       この画面がやるのは「許可をもらってくる」ことと「同期して」と頼むことだけ。 */
    var gcal = null;

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

    function loadGcal() {
      return sb.rpc('my_calendar_link').then(function (r) {
        if (r.error) throw r.error;
        gcal = r.data || { connected: false };
        renderGcal();
      }).catch(function () {
        EM.$('#gcalState').textContent = '連携の状態を確認できませんでした。';
      });
    }

    function renderGcal() {
      var st = EM.$('#gcalState');
      var connected = !!(gcal && gcal.connected);
      EM.$('#gcalConnectBtn').hidden = connected;
      EM.$('#gcalSyncBtn').hidden = !connected;
      EM.$('#gcalSaveBtn').hidden = !connected;
      EM.$('#gcalDisconnectBtn').hidden = !connected;
      EM.$('#gcalOptions').hidden = !connected;

      if (!connected) {
        st.textContent = '連携していません。連携すると、この画面の予定が Google カレンダーにも入ります。';
        return;
      }
      EM.$('#gcalPush').checked = !!gcal.sync_push;
      EM.$('#gcalPull').checked = !!gcal.sync_pull;
      var parts = [(gcal.google_email || 'Google アカウント') + ' と連携中'];
      parts.push(gcal.last_sync_at ? '最終同期: ' + EM.date(gcal.last_sync_at) : 'まだ同期していません');
      if (gcal.pending) parts.push('未同期の予定: ' + gcal.pending + '件');
      if (gcal.google_busy_days) parts.push('Google側で埋まっている日: ' + gcal.google_busy_days + '日');
      st.textContent = parts.join(' ／ ');
      if (gcal.last_sync_error) {
        EM.notice(msg, '前回の同期で問題がありました: ' + gcal.last_sync_error, 'error');
      }
    }

    EM.$('#gcalConnectBtn').addEventListener('click', function () {
      EM.notice(msg, '');
      // access_type=offline と prompt=consent を付けないと、
      // 裏で同期し続けるための許可（リフレッシュトークン）がもらえない。
      sb.auth.linkIdentity({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
          redirectTo: (EM.config.SITE_ORIGIN || location.origin) + '/schedule/?gcal=back',
          queryParams: { access_type: 'offline', prompt: 'consent' }
        }
      }).then(function (r) {
        if (!r || !r.error) return;
        var m = String(r.error.message || '');
        // すでに Google でログインしている人は「追加」ではなく「取り直し」になる
        if (/already|linked|exists/i.test(m)) {
          return sb.auth.signInWithOAuth({
            provider: 'google',
            options: {
              scopes: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
              redirectTo: (EM.config.SITE_ORIGIN || location.origin) + '/schedule/?gcal=back',
              queryParams: { access_type: 'offline', prompt: 'consent' }
            }
          });
        }
        EM.notice(msg, m + '（Supabase の Authentication 設定で「Manual linking」が有効か確認してください）', 'error');
      });
    });

    // Google から戻ってきたら、許可を一度だけサーバーへ預ける
    function finishConnect() {
      if (EM.param('gcal') !== 'back') return Promise.resolve();
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
        EM.toast('書き出し ' + ((d.pushed || 0) + (d.updated || 0)) + '件 ／ 取り込み ' + (d.busy_days || 0) + '日');
        return loadGcal();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); })
        .then(function () { b.removeAttribute('aria-busy'); });
    });

    EM.$('#gcalSaveBtn').addEventListener('click', function () {
      sb.rpc('set_calendar_sync', {
        p_push: EM.$('#gcalPush').checked,
        p_pull: EM.$('#gcalPull').checked
      }).then(function (r) {
        if (r.error) throw r.error;
        EM.toast('保存しました');
        return loadGcal();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    });

    EM.$('#gcalDisconnectBtn').addEventListener('click', function () {
      if (!confirm('Google カレンダーとの連携を解除しますか？\nGoogle 側に書き出した予定はそのまま残ります。')) return;
      gcalCall({ action: 'disconnect' }).then(function () {
        EM.toast('連携を解除しました');
        return loadGcal();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    });

    function saveShare() {
      if (!creator) { EM.notice(msg, 'クリエイタープロフィールを作成すると公開できます。', 'error'); return; }
      sb.from('creators').update({ share_availability: EM.$('#shareAvailability').checked })
        .eq('id', creator.id)
        .then(function (r) { if (r.error) throw r.error; EM.toast('保存しました'); EM.notice(msg, ''); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }
  });
})(window.EM);
