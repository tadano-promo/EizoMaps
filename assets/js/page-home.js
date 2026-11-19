/* Eizo Maps — トップページのお知らせと広告枠
   見えてよいものだけが返るように、絞り込みはサーバー側（RLS）で行う。
   ここでは「返ってきたものを安全に描画する」ことだけを担当する。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    if (!sb) return;

    // ログイン済みなら、登録をすすめる大きな紹介の代わりに「自分用の入口」を出す
    EM.getUser().then(function (u) {
      if (!u) return;
      EM.$('#homeHero').hidden = true;
      EM.$('#homeMe').hidden = false;
      loadMe(u);
    });

    /* ---------------- 自分用トップの部品 ----------------
       部品は必ず「アイコン＋見出し＋中身」の同じ形。並びと出し入れは user_home に保存（本人だけが読める） */
    // クリエイターとして使っているときの部品
    var CREATOR_WIDGETS = [
      { id: 'week',      title: '今週の予定',        icon: 'week',     wide: true },
      { id: 'countdown', title: '納品・納期まで',     icon: 'flag' },
      { id: 'next',      title: '次の予定',          icon: 'calendar' },
      { id: 'projects',  title: '動いている案件',     icon: 'film' },
      { id: 'jobs',      title: 'あなたに合う募集',   icon: 'search' },
      { id: 'todo',      title: 'やること',          icon: 'check' },
      { id: 'weather',   title: '天気',              icon: 'sun' },
      { id: 'links',     title: 'よく使うページ',     icon: 'home',     wide: true }
    ];
    // クライアントとして使っているときの部品（2026-11-15 翠くん）
    //   クリエイター側の道具（予定・やること・ガント）は出さない
    var CLIENT_WIDGETS = [
      { id: 'c_msgs',    title: 'メッセージ',            icon: 'chat' },
      { id: 'c_review',  title: '評価を書いてください',   icon: 'star' },
      { id: 'c_active',  title: 'やりとり中の依頼',       icon: 'film',     wide: true },
      { id: 'c_due',     title: '納期が近い依頼',         icon: 'flag' },
      { id: 'c_posts',   title: '出した募集',             icon: 'doc' },
      { id: 'c_find',    title: 'クリエイターを探す',     icon: 'search' },
      { id: 'c_weather', title: '天気',                  icon: 'sun' }
    ];
    var WIDGETS = CREATOR_WIDGETS, mode = 'creator', otherWidgets = [];
    function wdef(id) { for (var i = 0; i < WIDGETS.length; i++) if (WIDGETS[i].id === id) return WIDGETS[i]; return null; }

    var me = null, creator = null, home = { widgets: [], todos: [], weather_pref: null }, editing = false;
    var data = { events: [], projects: [], delivery: [] };
    var weekFrom = EM.weekStart(EM.today());

    // 並びは user_home.widgets に、クリエイター用とクライアント用をまとめて入れる。
    // いま使っていない側の並びは otherWidgets に取っておき、保存のときに一緒に書き戻す
    function normWidgets(list) {
      var out = [], seen = {};
      otherWidgets = [];
      (Array.isArray(list) ? list : []).forEach(function (w) {
        if (w && wdef(w.id) && !seen[w.id]) { seen[w.id] = 1; out.push({ id: w.id, on: w.on !== false }); }
        else if (w && w.id && !wdef(w.id)) otherWidgets.push({ id: w.id, on: w.on !== false });
      });
      WIDGETS.forEach(function (w) { if (!seen[w.id]) out.push({ id: w.id, on: true }); });
      return out;
    }

    function stateText(t) { EM.$('#homeSaveState').textContent = t || ''; }
    var saveSeq = 0;
    // 変えたらすぐ保存する（保存ボタンなし）。保存できたら「保存しました（時刻）」
    function saveHome(fields) {
      var my = ++saveSeq;
      if (fields.widgets) fields = Object.assign({}, fields, { widgets: fields.widgets.concat(otherWidgets) });
      stateText('保存しています…');
      return sb.from('user_home').upsert(fields, { onConflict: 'user_id' }).select('updated_at').single().then(function (r) {
        if (r.error) throw r.error;
        if (my === saveSeq) stateText('保存しました（' + EM.datetime(r.data.updated_at) + '）');
      }).catch(function (e) { if (my === saveSeq) stateText(''); EM.toast(EM.errorText(e)); });
    }

    function loadMe(u) {
      me = u;
      var t = EM.today();
      EM.$('#homeEditBtn').addEventListener('click', function () {
        editing = !editing;
        this.setAttribute('aria-pressed', editing ? 'true' : 'false');
        this.textContent = editing ? '並べ替えを終わる' : '部品を並べ替える';
        EM.$('#homeEditHint').hidden = !editing;
        renderWidgets();
      });
      EM.myAccountType().then(function (type) {
        mode = EM.viewModeFor(type);
        // ログインしている人には「使いはじめの流れ」は出さない。紹介はいまの使い方に合わせる
        var howto = EM.$('#homeHowto'); if (howto) howto.hidden = true;
        if (mode === 'client') {
          var pc = EM.$('#pitchCreator'), pl = EM.$('#pitchClient');
          if (pc) pc.hidden = true; if (pl) pl.hidden = false;
          WIDGETS = CLIENT_WIDGETS; loadClient(u);
        }
        else loadCreator(u);
      });
    }

    /* ---------------- クライアントとして使っているとき ---------------- */
    var cdata = { client: null, projects: [], reviewed: {}, unread: 0, genres: [] };
    function loadClient(u) {
      var t = EM.today();
      var eb = EM.$('#homeEyebrow');
      if (eb) { eb.textContent = 'Client · My Eizo Maps'; eb.classList.add('eyebrow--client'); }
      Promise.all([
        sb.from('clients').select('id,display_name,company,area_pref').eq('user_id', u.id).maybeSingle(),
        sb.rpc('my_client_id'),
        sb.from('reviews').select('project_id').eq('reviewer_id', u.id),
        sb.rpc('dm_unread_count'),
        sb.from('user_home').select('widgets,todos,weather_pref,updated_at').maybeSingle(),
        EM.jobs ? EM.jobs.load().catch(function () { return []; }) : Promise.resolve([])
      ]).then(function (r) {
        cdata.client = (!r[0].error && r[0].data) || null;
        creator = cdata.client ? { area_pref: cdata.client.area_pref } : null;   // 天気のふだんの地域に使う
        var name = (cdata.client && cdata.client.display_name) || '';
        EM.$('#homeHello').textContent = name ? 'おかえりなさい、' + name + ' さん' : 'おかえりなさい';
        (r[2].data || []).forEach(function (x) { if (x.project_id) cdata.reviewed[x.project_id] = true; });
        cdata.unread = (!r[3].error && Number(r[3].data)) || 0;
        if (!r[4].error && r[4].data) home = r[4].data;
        home.widgets = normWidgets(home.widgets);
        home.todos = Array.isArray(home.todos) ? home.todos : [];
        cdata.genres = r[5] || [];
        var cid = r[1].data || null;
        if (!cid) return null;
        return sb.from('projects').select('id,title,kind,status,due_on,updated_at,creators(display_name)')
          .eq('client_id', cid).order('updated_at', { ascending: false }).limit(100);
      }).then(function (pr) {
        cdata.projects = (pr && !pr.error && pr.data) || [];
        return EM.projectFlags(cdata.projects.map(function (p) { return p.id; }));
      }).then(function (m) {
        cdata.flags = m || {};
        renderWidgets();
      }).catch(function () {
        var box = EM.$('#homeWidgets');
        EM.clear(box);
        box.appendChild(el('p', { class: 'small muted', text: '読み込めませんでした。少し時間をおいて開き直してください。' }));
      });
    }
    // 募集のデータ（トップの部品で共有。1回だけ読む）
    var jobsPromise = null;
    function jobsData() {
      if (jobsPromise) return jobsPromise;
      jobsPromise = Promise.all([
        sb.from('job_posts').select('id,title,genre_ids,area_pref,remote_ok,budget_amount,closes_on,status,client_id,created_at')
          .order('created_at', { ascending: false }).limit(200),
        sb.rpc('my_client_id')
      ]).then(function (r) {
        var all = (r[0].data || []), cid = r[1].data || null, t = EM.today();
        var d = { open: all.filter(function (p) { return p.status === 'open' && p.closes_on >= t && p.client_id !== cid; }),
                  mine: all.filter(function (p) { return cid && p.client_id === cid; }), counts: {} };
        if (!d.mine.length) return d;
        return sb.rpc('job_post_counts', { p_posts: d.mine.map(function (p) { return p.id; }) }).then(function (c) {
          (c.data || []).forEach(function (x) { d.counts[x.post_id] = x.proposals; });
          return d;
        });
      }).catch(function () { return { open: [], mine: [], counts: {} }; });
      return jobsPromise;
    }
    function cWho(p) { return p.creators && p.creators.display_name ? p.creators.display_name + ' さん' : ''; }

    /* ---------------- クリエイターとして使っているとき ---------------- */
    function loadCreator(u) {
      var t = EM.today();
      Promise.all([
        sb.from('creators').select('id,handle,display_name,is_published,area_pref,creator_genres(genre_id)').eq('user_id', u.id).maybeSingle(),
        sb.from('schedule_events').select('id,kind,title,starts_on,ends_on,start_time,end_time')
          .eq('owner_user_id', u.id).gte('ends_on', EM.addDays(t, -7)).lte('starts_on', EM.addDays(t, 120))
          .order('starts_on').order('start_time', { nullsFirst: true }).limit(500),
        sb.from('projects').select('id,title,status,due_on')
          .in('status', ['offered', 'proposed', 'in_progress', 'delivered'])
          .order('due_on', { ascending: true, nullsFirst: false }).limit(20),
        sb.from('user_home').select('widgets,todos,weather_pref,updated_at').maybeSingle()
      ]).then(function (r) {
        creator = (!r[0].error && r[0].data) || null;
        var name = (creator && creator.display_name) || '';
        EM.$('#homeHello').textContent = name ? 'おかえりなさい、' + name + ' さん' : 'おかえりなさい';
        data.events = (!r[1].error && r[1].data) || [];
        data.projects = (!r[2].error && r[2].data) || [];
        data.flags = {};
        EM.projectFlags(data.projects.map(function (p) { return p.id; })).then(function (m) { data.flags = m; renderWidgets(); });
        if (!r[3].error && r[3].data) home = r[3].data;
        home.widgets = normWidgets(home.widgets);
        home.todos = Array.isArray(home.todos) ? home.todos : [];
        renderWidgets();
        if (EM.param('todo') === 'new') {
          var w = home.widgets.filter(function (x) { return x.id === 'todo'; })[0];
          if (w && !w.on) { w.on = true; renderWidgets(); }
          setTimeout(function () { var i = EM.$('#todoInput'); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); } }, 100);
        }
      }).catch(function () {
        var box = EM.$('#homeWidgets');
        EM.clear(box);
        box.appendChild(el('p', { class: 'small muted', text: '読み込めませんでした。少し時間をおいて開き直してください。' }));
      });
    }

    function renderWidgets() {
      var box = EM.$('#homeWidgets');
      EM.clear(box);
      box.classList.toggle('is-editing', editing);
      home.widgets.forEach(function (w, idx) {
        if (!w.on && !editing) return;
        var def = wdef(w.id);
        var tools = null;
        if (editing) {
          var up = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': def.title + 'を上へ', disabled: idx === 0 }, EM.icon('up'));
          var down = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': def.title + 'を下へ', disabled: idx === home.widgets.length - 1 }, EM.icon('down'));
          var vis = el('button', { type: 'button', class: 'icon-btn icon-btn--sm', 'aria-label': w.on ? def.title + 'をしまう' : def.title + 'を出す', 'aria-pressed': w.on ? 'true' : 'false' }, EM.icon(w.on ? 'eye' : 'eyeoff'));
          up.addEventListener('click', function () { move(idx, -1); });
          down.addEventListener('click', function () { move(idx, 1); });
          vis.addEventListener('click', function () { w.on = !w.on; renderWidgets(); saveHome({ widgets: home.widgets }); });
          tools = el('div', { class: 'wg__tools' }, [up, down, vis]);
        }
        var card = el('section', { class: 'card wg wg--' + w.id + (def.wide ? ' wg--wide' : '') + (w.on ? '' : ' is-off'), id: w.id === 'todo' ? 'todo' : null }, [
          EM.widgetHead(def.icon, def.title, tools)
        ]);
        var body = el('div', { class: 'wg__body' });
        card.appendChild(body);
        box.appendChild(card);
        if (editing && !w.on) { body.appendChild(el('p', { class: 'small muted', text: 'しまっています（目のボタンで出せます）' })); return; }
        RENDER[w.id](body);
      });
    }
    function move(idx, d) {
      var j = idx + d;
      if (j < 0 || j >= home.widgets.length) return;
      var tmp = home.widgets[idx]; home.widgets[idx] = home.widgets[j]; home.widgets[j] = tmp;
      renderWidgets();
      saveHome({ widgets: home.widgets });
    }

    function emptyLine(box, text) { box.appendChild(el('p', { class: 'small muted', text: text })); }

    var RENDER = {
      /* ===== クライアント用 ===== */
      c_msgs: function (body) {
        if (cdata.unread > 0) {
          body.appendChild(el('a', { class: 'cl-alert', href: '/messages/' }, [
            el('b', { class: 'num', text: String(cdata.unread) }),
            el('span', { text: '件の新しいメッセージが届いています' })
          ]));
        } else emptyLine(body, '新しいメッセージはありません。');
        body.appendChild(el('div', { class: 'wg__foot' }, el('a', { class: 'small', href: '/messages/', text: 'メッセージを開く →' })));
      },
      c_review: function (body) {
        var ps = cdata.projects.filter(function (p) { return EM.canReview(p.status) && !cdata.reviewed[p.id]; });
        if (!ps.length) { emptyLine(body, '評価を待っている案件はありません。納品が終わると、ここに出ます。'); return; }
        ps.slice(0, 4).forEach(function (p) {
          body.appendChild(el('a', { class: 'home-me__row', href: '/projects/review.html?id=' + encodeURIComponent(p.id) }, [
            el('span', { class: 'home-me__title', text: p.title }),
            el('span', { class: 'home-me__when', text: cWho(p) }),
            el('span', { class: 'cl-go', text: '評価を書く →' })
          ]));
        });
      },
      c_active: function (body) {
        var ps = cdata.projects.filter(function (p) { return ['draft', 'offered', 'proposed', 'in_progress', 'delivered', 'paid'].indexOf(p.status) !== -1; });
        if (!ps.length) {
          emptyLine(body, 'いま進んでいる依頼はありません。');
          body.appendChild(el('div', { class: 'wg__foot' }, el('a', { class: 'small', href: '/creators/', text: 'クリエイターを探して依頼する →' })));
          return;
        }
        ps.slice(0, 6).forEach(function (p) {
          body.appendChild(el('a', { class: 'home-me__row', href: '/projects/?id=' + encodeURIComponent(p.id) }, [
            EM.statusBadge(p.status),
            el('span', { class: 'home-me__title', text: p.title }),
            el('span', { class: 'home-me__when', text: cWho(p) })
          ].concat(EM.projectBadges(p, (cdata.flags || {})[p.id], { max: 1 }))));
        });
        body.appendChild(el('div', { class: 'wg__foot' }, el('a', { class: 'small', href: '/projects/', text: '依頼した案件をすべて見る →' })));
      },
      c_due: function (body) {
        var t = EM.today();
        var ps = cdata.projects.filter(function (p) { return p.due_on && p.due_on >= t && ['offered', 'proposed', 'in_progress'].indexOf(p.status) !== -1; })
          .sort(function (a, b) { return a.due_on < b.due_on ? -1 : 1; });
        if (!ps.length) { emptyLine(body, '納期が決まっている依頼はありません。'); return; }
        ps.slice(0, 5).forEach(function (p) {
          var k = EM.dayDiff(t, p.due_on);
          body.appendChild(el('a', { class: 'cd__row', href: '/projects/?id=' + encodeURIComponent(p.id) }, [
            el('span', { class: 'cd__left mono', text: k === 0 ? '今日' : 'あと' + k + '日' }),
            el('span', { class: 'cd__rtitle', text: p.title }),
            el('span', { class: 'small muted mono', text: EM.md(p.due_on) })
          ]));
        });
      },
      c_find: function (body) {
        var job = el('select', { 'aria-label': '職種' }, [el('option', { value: '', text: '職種（すべて）' })]);
        cdata.genres.forEach(function (g) { job.appendChild(el('option', { value: String(g.id), text: g.name_ja })); });
        var area = el('select', { 'aria-label': '地域' }, [el('option', { value: '', text: '地域（すべて）' })]);
        EM.PREFS.forEach(function (p) { area.appendChild(el('option', { value: p, text: p })); });
        if (cdata.client && cdata.client.area_pref) area.value = cdata.client.area_pref;
        var go = el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: '探す' });
        go.addEventListener('click', function () {
          var q = [];
          if (job.value) q.push('genre=' + encodeURIComponent(job.value));
          if (area.value) q.push('area=' + encodeURIComponent(area.value));
          location.href = '/creators/' + (q.length ? '?' + q.join('&') : '');
        });
        body.appendChild(el('div', { class: 'cl-find' }, [job, area, go]));
        body.appendChild(el('p', { class: 'small muted', text: '例：「カメラマン」×「東京都」。くわしい条件は探す画面で足せます。' }));
        body.appendChild(el('div', { class: 'wg__foot' }, el('a', { class: 'small', href: '/estimate/quick/', text: '予算の目安を出す →' })));
      },
      c_weather: function (body) { RENDER.weather(body); },
      c_posts: function (body) {
        jobsData().then(function (d) {
          var mine = d.mine;
          if (!mine.length) {
            emptyLine(body, 'だれに頼めばいいか決まっていないときは、募集を出すとクリエイターから提案が届きます。');
            body.appendChild(el('div', { class: 'wg__foot' }, el('a', { class: 'small', href: '/jobs/new.html', text: '募集を出す →' })));
            return;
          }
          mine.slice(0, 4).forEach(function (p) {
            var open = p.status === 'open';
            body.appendChild(el('a', { class: 'home-me__row', href: '/jobs/detail.html?id=' + encodeURIComponent(p.id) }, [
              el('span', { class: 'home-me__tag', text: open ? '提案 ' + (d.counts[p.id] || 0) + '件' : p.status === 'filled' ? '決まった' : '締め切り' }),
              el('span', { class: 'home-me__title', text: p.title }),
              open ? el('span', { class: 'home-me__when', text: EM.jobDaysLeft(p.closes_on) }) : null
            ]));
          });
          body.appendChild(el('div', { class: 'wg__foot' }, [el('a', { class: 'small', href: '/jobs/mine.html', text: '出した募集を見る →' }), el('a', { class: 'small', href: '/jobs/new.html', text: '募集を出す →' })]));
        });
      },
      /* ===== クリエイター用：あなたに合う募集（職種・地域が合うもの） ===== */
      jobs: function (body) {
        jobsData().then(function (d) {
          var gs = ((creator && creator.creator_genres) || []).map(function (x) { return x.genre_id; });
          var pref = creator && creator.area_pref;
          var rows = d.open.filter(function (p) {
            var gOk = !(p.genre_ids || []).length || !gs.length || p.genre_ids.some(function (g) { return gs.indexOf(g) !== -1; });
            var aOk = !p.area_pref || !pref || p.area_pref === pref || p.remote_ok;
            return gOk && aOk;
          });
          if (!rows.length) emptyLine(body, 'いま、あなたの職種・地域に合う募集はありません。');
          rows.slice(0, 4).forEach(function (p) {
            body.appendChild(el('a', { class: 'home-me__row', href: '/jobs/detail.html?id=' + encodeURIComponent(p.id) }, [
              el('span', { class: 'home-me__tag', text: EM.budgetLabel(p.budget_amount) }),
              el('span', { class: 'home-me__title', text: p.title }),
              el('span', { class: 'home-me__when', text: EM.jobDaysLeft(p.closes_on) })
            ]));
          });
          body.appendChild(el('div', { class: 'wg__foot' }, [el('a', { class: 'small', href: '/jobs/', text: '募集をすべて見る →' }), el('a', { class: 'small', href: '/jobs/mine.html', text: '送った提案 →' })]));
        });
      },

      /* ===== クリエイター用 ===== */
      /* ---- 今週の予定（週の帯カレンダー）：何日も続く予定は日をまたぐ1本の帯 ---- */
      week: function (body) {
        var t = EM.today(), to = EM.addDays(weekFrom, 6);
        var nav = el('div', { class: 'wk__nav' }, [
          el('button', { type: 'button', class: 'btn btn--sm', 'aria-label': '前の週', text: '←', onclick: function () { weekFrom = EM.addDays(weekFrom, -7); refreshWeek(); } }),
          el('span', { class: 'wk__range mono', text: weekFrom.replace(/-/g, '/') + ' 〜 ' + EM.md(to) }),
          el('button', { type: 'button', class: 'btn btn--sm', 'aria-label': '次の週', text: '→', onclick: function () { weekFrom = EM.addDays(weekFrom, 7); refreshWeek(); } }),
          el('button', { type: 'button', class: 'btn btn--sm', text: '今週', onclick: function () { weekFrom = EM.weekStart(EM.today()); refreshWeek(); } })
        ]);
        body.appendChild(nav);
        var grid = el('div', { class: 'wk' });
        var evs = data.events.filter(function (e) { return e.starts_on <= to && e.ends_on >= weekFrom; })
          .sort(function (a, b) { var la = EM.dayDiff(a.starts_on, a.ends_on), lb = EM.dayDiff(b.starts_on, b.ends_on); return a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : lb - la; });
        // 帯をぶつからない段に並べる
        var lanes = [], placed = [];
        evs.forEach(function (e) {
          var s = Math.max(0, EM.dayDiff(weekFrom, e.starts_on)), f = Math.min(6, EM.dayDiff(weekFrom, e.ends_on));
          var L = 0;
          while (lanes[L] && lanes[L].some(function (x) { return !(f < x[0] || s > x[1]); })) L++;
          (lanes[L] = lanes[L] || []).push([s, f]);
          placed.push({ e: e, s: s, f: f, L: L });
        });
        var MAXL = 6, rows = Math.min(lanes.length, MAXL);
        for (var i = 0; i < 7; i++) {
          var d = EM.addDays(weekFrom, i), wd = EM.parseYmd(d).getDay();
          grid.appendChild(el('div', { class: 'wk__col' + (d === t ? ' is-today' : ''), style: { gridColumn: String(i + 1), gridRow: '1 / span ' + (rows + 2) } }));
          grid.appendChild(el('a', {
            class: 'wk__day' + (d === t ? ' is-today' : '') + (wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : ''),
            href: '/schedule/day.html?d=' + d, style: { gridColumn: String(i + 1), gridRow: '1' }
          }, [el('span', { class: 'wk__dnum mono', text: EM.md(d) }), el('span', { class: 'wk__dwd', text: EM.WD[wd] })]));
        }
        var hidden = {};
        placed.forEach(function (p) {
          if (p.L >= MAXL) { for (var k = p.s; k <= p.f; k++) hidden[k] = (hidden[k] || 0) + 1; return; }
          var e = p.e, col = EM.kindColor(e.kind);
          grid.appendChild(el('a', {
            class: 'wk__bar' + (e.kind === 'hold' ? ' is-hold' : '') + (e.starts_on < weekFrom ? ' is-cut-l' : '') + (e.ends_on > to ? ' is-cut-r' : ''),
            href: '/schedule/day.html?d=' + (e.starts_on < weekFrom ? weekFrom : e.starts_on),
            title: EM.kindLabel(e.kind) + '：' + e.title,
            style: { gridColumn: (p.s + 1) + ' / ' + (p.f + 2), gridRow: String(p.L + 2), '--bar': col }
          }, [
            e.start_time && e.starts_on >= weekFrom ? el('span', { class: 'wk__time mono', text: e.start_time.slice(0, 5) }) : null,
            el('span', { class: 'wk__title', text: e.title })
          ]));
        });
        Object.keys(hidden).forEach(function (k) {
          grid.appendChild(el('a', { class: 'wk__more small', href: '/schedule/day.html?d=' + EM.addDays(weekFrom, +k), style: { gridColumn: String(+k + 1), gridRow: String(rows + 2) }, text: '+' + hidden[k] + '件' }));
        });
        var scroll = el('div', { class: 'wk-scroll' }, grid);
        body.appendChild(scroll);
        if (!evs.length) emptyLine(body, 'この週の予定はありません。');
        body.appendChild(el('div', { class: 'wg__foot' }, [
          el('a', { class: 'small', href: '/schedule/', text: '月の表示 →' }),
          el('a', { class: 'small', href: '/schedule/gantt.html', text: 'ガントチャート →' })
        ]));
      },

      /* ---- 納品・納期まで あと◯日 ---- */
      countdown: function (body) {
        var t = EM.today(), list = [];
        data.events.forEach(function (e) { if (e.kind === 'delivery' && e.ends_on >= t) list.push({ d: e.ends_on, title: e.title, href: '/schedule/day.html?d=' + e.ends_on, tag: '納品' }); });
        data.projects.forEach(function (p) { if (p.due_on && p.due_on >= t && p.status !== 'delivered') list.push({ d: p.due_on, title: p.title, href: '/projects/?id=' + encodeURIComponent(p.id), tag: '納期' }); });
        list.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
        if (!list.length) { emptyLine(body, 'これからの納品・納期はありません。スケジュールで種別「納品」の予定を入れると、ここで数えます。'); return; }
        var first = list[0], n = EM.dayDiff(t, first.d);
        body.appendChild(el('a', { class: 'cd__main', href: first.href }, [
          el('span', { class: 'cd__num' }, n === 0 ? [el('b', { text: '今日' })] : [el('small', { text: 'あと' }), el('b', { class: 'num', text: String(n) }), el('small', { text: '日' })]),
          el('span', { class: 'cd__info' }, [
            el('span', { class: 'cd__tag', text: first.tag }),
            el('span', { class: 'cd__title', text: first.title }),
            el('span', { class: 'small muted mono', text: EM.mdw(first.d) })
          ])
        ]));
        var rest = list.slice(1, 5);
        if (rest.length) body.appendChild(el('ul', { class: 'cd__list' }, rest.map(function (x) {
          var k = EM.dayDiff(t, x.d);
          return el('li', null, el('a', { href: x.href, class: 'cd__row' }, [
            el('span', { class: 'cd__left mono', text: k === 0 ? '今日' : 'あと' + k + '日' }),
            el('span', { class: 'cd__rtitle', text: x.title }),
            el('span', { class: 'small muted mono', text: EM.md(x.d) })
          ]));
        })));
      },

      /* ---- 次の予定 ---- */
      next: function (body) {
        var t = EM.today();
        var evs = data.events.filter(function (e) { return e.ends_on >= t; }).slice(0, 4);
        if (!evs.length) emptyLine(body, 'これからの予定はまだありません。');
        evs.forEach(function (e) {
          var when = (e.starts_on <= t ? '今日' : EM.mdw(e.starts_on)) + (e.ends_on > e.starts_on ? '〜' + EM.mdw(e.ends_on) : '');
          body.appendChild(el('a', { class: 'home-me__row', href: '/schedule/day.html?d=' + (e.starts_on < t ? t : e.starts_on) }, [
            el('span', { class: 'home-me__when mono', text: when + (e.start_time ? ' ' + e.start_time.slice(0, 5) : '') }),
            el('span', { class: 'home-me__tag', style: { '--bar': EM.kindColor(e.kind) }, text: EM.kindLabel(e.kind) }),
            el('span', { class: 'home-me__title', text: e.title })
          ]));
        });
        body.appendChild(el('div', { class: 'wg__foot' }, el('a', { class: 'small', href: '/schedule/', text: 'スケジュールを開く →' })));
      },

      /* ---- 動いている案件 ---- */
      projects: function (body) {
        var ps = data.projects.slice(0, 4);
        if (!ps.length) emptyLine(body, '今動いている案件はありません。');
        ps.forEach(function (p) {
          body.appendChild(el('a', { class: 'home-me__row', href: '/projects/?id=' + encodeURIComponent(p.id) }, [
            EM.statusBadge(p.status),
            el('span', { class: 'home-me__title', text: p.title }),
            p.due_on ? el('span', { class: 'home-me__when mono', text: '納期 ' + EM.mdw(p.due_on) }) : null
          ].concat(EM.projectBadges(p, (data.flags || {})[p.id], { max: 1 }))));
        });
        body.appendChild(el('div', { class: 'wg__foot' }, el('a', { class: 'small', href: '/projects/', text: '案件管理を開く →' })));
      },

      /* ---- やること（入れたらすぐ保存） ---- */
      todo: function (body) {
        var input = el('input', { type: 'text', id: 'todoInput', maxlength: '100', placeholder: '例：〇〇さんに香盤表を送る', 'aria-label': 'やることを入れる' });
        var add = el('button', { type: 'button', class: 'btn btn--sm btn--primary', text: '追加' });
        function doAdd() {
          var v = input.value.trim();
          if (!v) { input.focus(); return; }
          if (home.todos.length >= 200) { EM.toast('やることは200件までです。済んだものを片付けてください。'); return; }
          home.todos.unshift({ t: v.slice(0, 100), d: false });
          input.value = '';
          paintList(); saveHome({ todos: home.todos });
          input.focus();
        }
        add.addEventListener('click', doAdd);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doAdd(); } });
        body.appendChild(el('div', { class: 'todo__add' }, [input, add]));
        var ul = el('ul', { class: 'todo__list' });
        var foot = el('div', { class: 'wg__foot' });
        body.appendChild(ul); body.appendChild(foot);
        function paintList() {
          EM.clear(ul); EM.clear(foot);
          if (!home.todos.length) { ul.appendChild(el('li', { class: 'small muted', text: 'やることはありません。' })); return; }
          home.todos.slice(0, 30).forEach(function (it, i) {
            var cb = el('input', { type: 'checkbox', 'aria-label': it.t + 'を済みにする' });
            cb.checked = !!it.d;
            cb.addEventListener('change', function () { it.d = cb.checked; paintList(); saveHome({ todos: home.todos }); });
            var del = el('button', { type: 'button', class: 'todo__del', 'aria-label': it.t + 'を消す', text: '✕' });
            del.addEventListener('click', function () { home.todos.splice(i, 1); paintList(); saveHome({ todos: home.todos }); });
            ul.appendChild(el('li', { class: 'todo__item' + (it.d ? ' is-done' : '') }, [el('label', { class: 'todo__lbl' }, [cb, el('span', { text: it.t })]), del]));
          });
          var done = home.todos.filter(function (x) { return x.d; }).length;
          foot.appendChild(el('span', { class: 'small muted', text: '残り ' + (home.todos.length - done) + '件' + (home.todos.length > 30 ? '（新しい30件を表示）' : '') }));
          if (done) foot.appendChild(el('button', { type: 'button', class: 'btn btn--sm', text: '済みを片付ける（' + done + '件）', onclick: function () {
            home.todos = home.todos.filter(function (x) { return !x.d; }); paintList(); saveHome({ todos: home.todos });
          } }));
        }
        paintList();
      },

      /* ---- 天気（気象庁さんの予報。撮影の日に印） ---- */
      weather: function (body) {
        var usual = home.weather_pref || (creator && creator.area_pref) || '東京都';
        if (!JMA[usual]) usual = '東京都';
        var pref = (wxHere && JMA[wxHere]) ? wxHere : usual;
        var sel = el('select', { class: 'wx__pref', 'aria-label': '天気の地域' });
        Object.keys(JMA).forEach(function (p) { sel.appendChild(el('option', { value: p, text: p })); });
        sel.value = pref;
        sel.addEventListener('change', function () { wxHere = null; home.weather_pref = sel.value; saveHome({ weather_pref: sel.value }); var b = body; EM.clear(b); RENDER.weather(b); });

        // 「現在地」：押したときだけ位置情報の許可を聞き、いちばん近い都道府県に切り替える。
        // 位置はこの端末の中で都道府県に変えるだけ。Eizo Maps にも外にも送らず、保存もしない
        var hereBtn = el('button', { class: 'btn btn--sm wx__here', type: 'button', 'aria-label': '現在地の天気にする' }, [EM.icon('pin'), '現在地']);
        var msg = el('span', { class: 'small muted wx__msg', 'aria-live': 'polite' });
        hereBtn.addEventListener('click', function () {
          if (!navigator.geolocation) { msg.textContent = 'この端末では現在地を使えません'; return; }
          hereBtn.disabled = true;
          msg.textContent = '現在地を確認しています…';
          navigator.geolocation.getCurrentPosition(function (pos) {
            hereBtn.disabled = false;
            var p = nearestPref(pos.coords.latitude, pos.coords.longitude);
            if (!p) { msg.textContent = '日本の外にいるため、切り替えられませんでした'; return; }
            wxHere = p;
            var b = body; EM.clear(b); RENDER.weather(b);
          }, function (err) {
            hereBtn.disabled = false;
            msg.textContent = err && err.code === 1
              ? '位置情報の利用が許可されていません（端末やブラウザの設定で変えられます）'
              : '現在地を確認できませんでした。少し待ってからお試しください';
          }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
        });
        var top = [sel, hereBtn];
        body.appendChild(el('div', { class: 'wx__top' }, top));
        if (wxHere && pref === wxHere) {
          var back = el('button', { class: 'linklike small', type: 'button', text: 'いつもの地域（' + usual + '）に戻す' });
          back.addEventListener('click', function () { wxHere = null; var b = body; EM.clear(b); RENDER.weather(b); });
          body.appendChild(el('p', { class: 'small muted wx__note' }, ['現在地付近（' + JMA[pref][1] + 'の予報）・保存はしていません　', back]));
        } else {
          body.appendChild(el('p', { class: 'small muted wx__note' }, [JMA[pref][1] + 'の予報', msg]));
        }
        var out = el('div', { class: 'wx__days' }, el('p', { class: 'small muted', text: '読み込み中…' }));
        body.appendChild(out);
        body.appendChild(el('p', { class: 'wx__src small muted' }, [
          '出典：', el('a', { href: 'https://www.jma.go.jp/bosai/forecast/', target: '_blank', rel: 'noopener noreferrer', text: '気象庁ホームページ' }), '（天気予報）'
        ]));
        fetchJma(JMA[pref][0]).then(function (days) {
          EM.clear(out);
          var t = EM.today();
          var shoot = {};
          data.events.forEach(function (e) {
            if (e.kind !== 'shoot' && e.kind !== 'hold') return;
            for (var d = e.starts_on, n = 0; d <= e.ends_on && n < 30; d = EM.addDays(d, 1), n++) shoot[d] = shoot[d] || e.title;
          });
          var keys = Object.keys(days).filter(function (d) { return d >= t; }).sort().slice(0, 7);
          if (!keys.length) { emptyLine(out, '予報を読み込めませんでした。'); return; }
          keys.forEach(function (d) {
            var w = days[d];
            out.appendChild(el('div', { class: 'wx__day' + (d === t ? ' is-today' : '') + (shoot[d] ? ' is-shoot' : ''), title: shoot[d] ? '撮影：' + shoot[d] : null }, [
              el('span', { class: 'wx__date mono', text: d === t ? '今日' : EM.mdw(d) }),
              EM.icon(wxIcon(w.code), 'wx__ico wx__ico--' + wxIcon(w.code)),
              el('span', { class: 'wx__lbl', text: wxLabel(w) }),
              el('span', { class: 'wx__pop mono', text: w.pop != null && w.pop !== '' ? w.pop + '%' : '' }),
              el('span', { class: 'wx__tmp mono' }, [
                w.max ? el('span', { class: 'wx__max', text: w.max + '°' }) : null,
                w.min ? el('span', { class: 'wx__min', text: ' / ' + w.min + '°' }) : null
              ]),
              shoot[d] ? el('span', { class: 'wx__shoot', text: '撮影' }) : null
            ]));
          });
        }).catch(function () { EM.clear(out); emptyLine(out, '予報を読み込めませんでした。少し時間をおいてお試しください。'); });
      },

      /* ---- よく使うページ ---- */
      links: function (body) {
        var nav = el('nav', { class: 'home-me__links', 'aria-label': 'よく使うページ' }, [
          ['/mypage/', 'マイページ'], ['/mypage/portfolio.html', '作品を追加・編集'], ['/mypage/stock.html', 'ストックページ'],
          ['/schedule/', 'スケジュール'], ['/schedule/gantt.html', 'ガントチャート'], ['/templates/', '定型文のひな形'],
          ['/projects/', '案件管理'], ['/help/', '使い方・ヘルプ']
        ].map(function (l) { return el('a', { class: 'btn btn--sm', href: l[0], text: l[1] }); }));
        if (creator && creator.is_published) {
          nav.appendChild(el('a', { class: 'btn btn--sm', href: creator.handle ? '/@' + creator.handle : '/creators/detail.html?id=' + encodeURIComponent(creator.id), target: '_blank', rel: 'noopener', text: 'クライアントからの見え方 ↗' }));
        }
        body.appendChild(nav);
      }
    };

    function refreshWeek() {
      var card = EM.$('.wg--week .wg__body');
      if (!card) return;
      EM.clear(card); RENDER.week(card);
    }

    /* ---------------- 天気：気象庁さんの予報（都道府県ごとの代表地点） ---------------- */
    /* 現在地 → 都道府県（いちばん近い点の都道府県にする）。
       県庁所在地に、広い県の主な町を足して、県境の近くでもずれにくくしている */
    var wxHere = null;
    var PREF_POINTS = [
      ['北海道',43.06,141.35],['北海道',43.77,142.37],['北海道',41.77,140.73],['北海道',42.98,144.38],['北海道',42.92,143.20],['北海道',44.02,144.27],['北海道',45.42,141.67],['北海道',42.32,140.97],
      ['青森県',40.82,140.74],['青森県',40.51,141.49],['岩手県',39.70,141.15],['岩手県',39.64,141.95],['岩手県',39.29,141.11],['宮城県',38.27,140.87],['宮城県',38.43,141.30],
      ['秋田県',39.72,140.10],['秋田県',39.31,140.56],['山形県',38.24,140.36],['山形県',38.91,139.84],['福島県',37.75,140.47],['福島県',37.49,139.93],['福島県',37.05,140.89],
      ['茨城県',36.34,140.45],['茨城県',36.08,140.11],['栃木県',36.57,139.88],['栃木県',36.87,140.02],['群馬県',36.39,139.06],['群馬県',36.32,139.00],['埼玉県',35.86,139.65],['埼玉県',36.15,139.39],['埼玉県',35.99,139.09],
      ['千葉県',35.61,140.12],['千葉県',35.05,140.10],['千葉県',35.73,140.83],['東京都',35.69,139.69],['東京都',35.67,139.30],['神奈川県',35.45,139.64],['神奈川県',35.26,139.15],['神奈川県',35.57,139.37],
      ['新潟県',37.90,139.02],['新潟県',37.15,138.24],['新潟県',37.45,138.85],['富山県',36.70,137.21],['石川県',36.59,136.63],['石川県',37.39,136.90],['福井県',36.07,136.22],['福井県',35.49,135.75],
      ['山梨県',35.66,138.57],['長野県',36.65,138.18],['長野県',36.24,137.97],['長野県',35.51,137.82],['長野県',36.40,138.25],['岐阜県',35.42,136.76],['岐阜県',36.15,137.25],
      ['静岡県',34.98,138.38],['静岡県',34.71,137.73],['静岡県',35.10,138.86],['愛知県',35.18,136.91],['愛知県',34.77,137.39],['三重県',34.73,136.51],['三重県',34.07,136.19],
      ['滋賀県',35.00,135.87],['滋賀県',35.38,136.27],['京都府',35.02,135.76],['京都府',35.47,135.39],['大阪府',34.69,135.52],['大阪府',34.47,135.39],['兵庫県',34.69,135.18],['兵庫県',34.82,134.69],['兵庫県',35.54,134.82],
      ['奈良県',34.69,135.83],['奈良県',34.13,135.84],['和歌山県',34.23,135.17],['和歌山県',33.73,135.38],['鳥取県',35.50,134.24],['鳥取県',35.43,133.33],['島根県',35.47,133.05],['島根県',34.68,131.84],
      ['岡山県',34.66,133.93],['岡山県',35.07,134.00],['広島県',34.40,132.46],['広島県',34.49,133.36],['広島県',34.81,132.86],['山口県',34.19,131.47],['山口県',33.96,130.94],['山口県',34.17,132.22],
      ['徳島県',34.07,134.56],['徳島県',33.80,134.34],['香川県',34.34,134.04],['愛媛県',33.84,132.77],['愛媛県',33.22,132.56],['愛媛県',33.96,133.28],['高知県',33.56,133.53],['高知県',32.91,132.92],['高知県',33.29,134.15],
      ['福岡県',33.61,130.42],['福岡県',33.88,130.88],['福岡県',33.32,130.51],['佐賀県',33.25,130.30],['長崎県',32.74,129.87],['長崎県',33.18,129.72],['熊本県',32.79,130.74],['熊本県',32.21,130.76],
      ['大分県',33.24,131.61],['大分県',33.32,130.94],['宮崎県',31.91,131.42],['宮崎県',32.58,131.66],['鹿児島県',31.56,130.56],['鹿児島県',31.38,130.85],['鹿児島県',28.38,129.49],['沖縄県',26.21,127.68],['沖縄県',24.34,124.16],['沖縄県',26.59,127.98]
    ];
    function nearestPref(lat, lon) {
      // 日本のだいたいの範囲の外なら切り替えない
      if (!(lat > 20 && lat < 46.5 && lon > 122 && lon < 154.5)) return null;
      var best = null, bd = Infinity, k = Math.cos(lat * Math.PI / 180);
      PREF_POINTS.forEach(function (p) {
        var dy = lat - p[1], dx = (lon - p[2]) * k, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p[0]; }
      });
      return best;
    }
    var JMA = {
      '北海道': ['016000', '札幌'], '青森県': ['020000', '青森'], '岩手県': ['030000', '盛岡'], '宮城県': ['040000', '仙台'],
      '秋田県': ['050000', '秋田'], '山形県': ['060000', '山形'], '福島県': ['070000', '福島'], '茨城県': ['080000', '水戸'],
      '栃木県': ['090000', '宇都宮'], '群馬県': ['100000', '前橋'], '埼玉県': ['110000', '熊谷'], '千葉県': ['120000', '千葉'],
      '東京都': ['130000', '東京'], '神奈川県': ['140000', '横浜'], '新潟県': ['150000', '新潟'], '富山県': ['160000', '富山'],
      '石川県': ['170000', '金沢'], '福井県': ['180000', '福井'], '山梨県': ['190000', '甲府'], '長野県': ['200000', '長野'],
      '岐阜県': ['210000', '岐阜'], '静岡県': ['220000', '静岡'], '愛知県': ['230000', '名古屋'], '三重県': ['240000', '津'],
      '滋賀県': ['250000', '大津'], '京都府': ['260000', '京都'], '大阪府': ['270000', '大阪'], '兵庫県': ['280000', '神戸'],
      '奈良県': ['290000', '奈良'], '和歌山県': ['300000', '和歌山'], '鳥取県': ['310000', '鳥取'], '島根県': ['320000', '松江'],
      '岡山県': ['330000', '岡山'], '広島県': ['340000', '広島'], '山口県': ['350000', '下関'], '徳島県': ['360000', '徳島'],
      '香川県': ['370000', '高松'], '愛媛県': ['380000', '松山'], '高知県': ['390000', '高知'], '福岡県': ['400000', '福岡'],
      '佐賀県': ['410000', '佐賀'], '長崎県': ['420000', '長崎'], '熊本県': ['430000', '熊本'], '大分県': ['440000', '大分'],
      '宮崎県': ['450000', '宮崎'], '鹿児島県': ['460100', '鹿児島'], '沖縄県': ['471000', '那覇']
    };
    var jmaCache = {};
    function fetchJma(code) {
      if (jmaCache[code]) return jmaCache[code];
      jmaCache[code] = fetch('https://www.jma.go.jp/bosai/forecast/data/forecast/' + code + '.json', { credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(function (r) { if (!r.ok) throw new Error('jma'); return r.json(); })
        .then(function (j) {
          var days = {};
          function day(iso) { var k = String(iso).slice(0, 10); return days[k] = days[k] || {}; }
          try {
            var a0 = j[0].timeSeries[0], ar = a0.areas[0];
            a0.timeDefines.forEach(function (iso, i) { var d = day(iso); d.code = ar.weatherCodes[i]; d.text = String(ar.weathers[i] || '').replace(/　/g, ' '); });
            // 今日・明日の降水確率（6時間ごと）のうち、いちばん高いもの
            var p0 = j[0].timeSeries[1], pr = p0.areas[0];
            p0.timeDefines.forEach(function (iso, i) { var d = day(iso), v = +pr.pops[i]; if (pr.pops[i] !== '' && (d.pop == null || v > d.pop)) d.pop = v; });
          } catch (e) { /* 形が変わっていたら週間予報だけ使う */ }
          try {
            var w0 = j[1].timeSeries[0], wr = w0.areas[0];
            w0.timeDefines.forEach(function (iso, i) { var d = day(iso); if (!d.code) d.code = wr.weatherCodes[i]; if (d.pop == null && wr.pops[i] !== '') d.pop = +wr.pops[i]; });
            var w1 = j[1].timeSeries[1], tr = w1.areas[0];
            w1.timeDefines.forEach(function (iso, i) { var d = day(iso); if (tr.tempsMax[i]) d.max = tr.tempsMax[i]; if (tr.tempsMin[i]) d.min = tr.tempsMin[i]; });
          } catch (e) { /* 週間予報が無い地域もある */ }
          return days;
        });
      jmaCache[code].catch(function () { delete jmaCache[code]; });
      return jmaCache[code];
    }
    function wxIcon(code) { var c = String(code || '')[0]; return c === '1' ? 'sun' : c === '3' ? 'rain' : c === '4' ? 'snow' : 'cloud'; }
    var WX = { '100': '晴れ', '101': '晴れ時々くもり', '102': '晴れ一時雨', '104': '晴れ一時雪', '110': '晴れのちくもり', '111': '晴れのちくもり', '112': '晴れのち雨', '113': '晴れのち雨', '114': '晴れのち雨',
      '200': 'くもり', '201': 'くもり時々晴れ', '202': 'くもり一時雨', '203': 'くもり時々雨', '204': 'くもり一時雪', '210': 'くもりのち晴れ', '211': 'くもりのち晴れ', '212': 'くもりのち雨', '213': 'くもりのち雨', '214': 'くもりのち雨', '218': 'くもりのち雪',
      '300': '雨', '301': '雨時々晴れ', '302': '雨時々止む', '303': '雨時々雪', '308': '大雨', '311': '雨のち晴れ', '313': '雨のちくもり', '314': '雨のち雪', '400': '雪', '401': '雪時々晴れ', '402': '雪時々止む', '403': '雪時々雨', '411': '雪のち晴れ', '413': '雪のちくもり', '414': '雪のち雨' };
    function wxLabel(w) { return WX[w.code] || { sun: '晴れ', cloud: 'くもり', rain: '雨', snow: '雪' }[wxIcon(w.code)]; }

    var section = EM.$('#newsSection');
    var list = EM.$('#newsList');
    var adBox = EM.$('#adSlot');

    Promise.all([
      sb.from('announcements')
        .select('id,kind,title,body,link_url,link_label,pinned,published_at')
        .order('published_at', { ascending: false })
        .limit(10),
      sb.from('ads')
        .select('id,slot,title,body,sponsor,image_url,link_url,ad_code,sort_order')
        .eq('slot', 'home_top')
        .order('sort_order')
        .limit(3)
    ]).then(function (res) {
      var news = (res[0] && !res[0].error && res[0].data) || [];
      var ads  = (res[1] && !res[1].error && res[1].data) || [];

      if (news.length) renderNews(news);
      if (ads.length)  renderAds(ads);
      if (news.length) section.hidden = false;
    }).catch(function () {
      // お知らせは補助的な情報なので、取れなくてもトップページは普通に出す
    });

    // 改行を保ったまま、テキストとしてだけ差し込む（HTML は一切解釈しない）
    function multiline(text, cls) {
      var p = el('p', { class: cls || '' });
      String(text).split(/\r?\n/).forEach(function (line, i) {
        if (i) p.appendChild(el('br'));
        p.appendChild(document.createTextNode(line));
      });
      return p;
    }

    // トップに出すのは新しい2件だけ。それより前のものは「過去のお知らせ」にしまう
    var NEWS_SHOWN = 2;
    function renderNews(rows) {
      EM.clear(list);
      var older = null;
      if (rows.length > NEWS_SHOWN) {
        older = el('div', { class: 'news__older-list' });
      }
      rows.forEach(function (n, idx) {
        var target = (older && idx >= NEWS_SHOWN) ? older : list;
        var href = EM.safeUrl(n.link_url);
        // 1行で見せて、押すと本文が開く（目立ちすぎないように）
        var hasMore = !!(n.body || href);
        var row = el(hasMore ? 'summary' : 'div', { class: 'news__row' }, [
          el('span', { class: 'news__date mono', text: EM.date(n.published_at) }),
          el('span', { class: 'news__kind', text: (n.pinned ? '重要・' : '') + (EM.ANNOUNCE_KIND[n.kind] || 'お知らせ') }),
          el('span', { class: 'news__headline', text: n.title })
        ]);
        target.appendChild(el(hasMore ? 'details' : 'div', { class: 'news__item' }, [
          row,
          n.body ? multiline(n.body, 'small muted news__body') : null,
          href ? el('a', {
            class: 'small news__link', href: href, target: '_blank', rel: 'noopener noreferrer',
            text: (n.link_label || '詳しく見る') + ' ↗'
          }) : null
        ]));
      });
      if (older) {
        list.appendChild(el('details', { class: 'news__older' }, [
          el('summary', { class: 'small muted', text: '過去のお知らせ（' + (rows.length - NEWS_SHOWN) + '件）' }),
          older
        ]));
      }
    }

    /* ---------- 広告枠 ----------
       ・ページの下の方に、一度に1つだけ、控えめに出す
       ・8秒ごとに入れ替える（マウスを乗せている間・別のタブを見ている間・
         「動きを減らす」設定の人には自動で入れ替えない。丸を押せば切り替えられる）
       ・A8 さんの広告コードは1文字も変えない。見せる・隠すを切り替えるだけ
       ・まだ見せていない広告は読み込まない（表示回数を水増ししないため） */
    var AD_INTERVAL = 8000;
    function renderAds(rows) {
      var items = [];
      var hasAffiliate = false;
      rows.forEach(function (a) {
        if (a.ad_code) {
          if (!EM.a8Nodes(a.ad_code, true)) return;   // 形が正しいかだけ先に確かめる（読み込みはしない）
          hasAffiliate = true;
          items.push({ title: a.title, build: function () {
            return el('div', { class: 'ad ad--affiliate' }, EM.a8Nodes(a.ad_code));
          } });
          return;
        }
        var href = EM.safeUrl(a.link_url);
        if (!href) return;
        items.push({ title: a.title, build: function () {
          var img = EM.safeUrl(a.image_url);
          var imgEl = null;
          if (img) {
            imgEl = el('img', { class: 'ad__img', src: img, alt: a.title, referrerpolicy: 'no-referrer' });
            // 画像が消えていたら、割れた画像を出さずに文字だけにする
            imgEl.addEventListener('error', function () {
              if (imgEl.parentNode) imgEl.parentNode.removeChild(imgEl);
            });
          }
          return el('a', { class: 'ad', href: href, target: '_blank', rel: 'noopener noreferrer sponsored' }, [
            imgEl,
            el('div', { class: 'ad__body' }, [
              el('p', { class: 'ad__title', text: a.title }),
              a.body ? el('p', { class: 'small muted', text: a.body }) : null,
              a.sponsor ? el('p', { class: 'ad__sponsor small muted', text: a.sponsor }) : null
            ])
          ]);
        } });
      });
      if (!items.length) return;

      EM.clear(adBox);
      // A8 さんの決まり：広告だと分かる表示を、広告の上に
      adBox.appendChild(el('p', { class: 'ad-slot__label' }, [
        el('span', { class: 'ad-slot__pr', text: 'PR' }),
        hasAffiliate ? el('span', { text: 'このサイトはアフィリエイト広告を利用しています' }) : null
      ]));
      var stage = el('div', { class: 'ad-slot__stage', 'aria-live': 'off' });
      adBox.appendChild(stage);
      var frames = items.map(function () {
        var fr = el('div', { class: 'ad-slot__frame', 'aria-hidden': 'true' });
        stage.appendChild(fr);
        return fr;
      });

      var dots = [];
      if (items.length > 1) {
        var nav = el('div', { class: 'ad-slot__dots' });
        items.forEach(function (it, i) {
          var d = el('button', { class: 'ad-slot__dot', type: 'button', 'aria-label': '広告 ' + (i + 1) + ' / ' + items.length });
          d.addEventListener('click', function () { show(i); restart(); });
          nav.appendChild(d);
          dots.push(d);
        });
        adBox.appendChild(nav);
      }

      var cur = -1;
      function show(i) {
        if (!frames[i].firstChild) frames[i].appendChild(items[i].build());   // 初めて見せるときに読み込む
        frames.forEach(function (fr, k) {
          var on = k === i;
          fr.classList.toggle('is-on', on);
          fr.setAttribute('aria-hidden', on ? 'false' : 'true');
          fr.inert = !on;
        });
        dots.forEach(function (d, k) { d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
        cur = i;
      }

      var timer = null;
      var paused = false;
      var reduce = false;
      try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* なし */ }
      function stop() { if (timer) { clearInterval(timer); timer = null; } }
      function restart() {
        stop();
        if (items.length < 2 || reduce || paused || document.hidden) return;
        timer = setInterval(function () { show((cur + 1) % items.length); }, AD_INTERVAL);
      }
      adBox.addEventListener('mouseenter', function () { paused = true; stop(); });
      adBox.addEventListener('mouseleave', function () { paused = false; restart(); });
      adBox.addEventListener('focusin', function () { paused = true; stop(); });
      adBox.addEventListener('focusout', function () { paused = false; restart(); });
      document.addEventListener('visibilitychange', restart);

      show(0);
      EM.$('#adArea').hidden = false;
      restart();
    }
  });
})(window.EM);
