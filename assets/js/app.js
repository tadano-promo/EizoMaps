/* =====================================================================
   Eizo Maps — 共通ライブラリ
   ---------------------------------------------------------------
   ★XSS対策の方針
     ユーザーが入力した文字列は innerHTML に絶対に渡しません。
     DOM は下の el() ヘルパーで組み立て、文字は textContent で入れます。
     この決まりを守っている限り、プロフィールやレビューに
     <script> を書かれても文字として表示されるだけです。
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- クリックジャッキング対策 ----------
     GitHub Pages はレスポンスヘッダーを設定できず、
     meta タグの frame-ancestors はブラウザに無視される。
     そのため JS で iframe 埋め込みを検知し、埋め込まれていたら抜け出す。 */
  try {
    if (global.top !== global.self) { global.top.location = global.self.location; }
  } catch (e) {
    document.documentElement.style.display = 'none';
  }

  /* ---------- 暗号化されていない接続（http://）で開かれたら、https:// に移す ----------
     ログインの合言葉などが途中で盗み見られないようにするため。
     本来は GitHub Pages の設定「Enforce HTTPS」で止めるが、その保険。 */
  try {
    if (global.location.protocol === 'http:' && /(^|\.)eizo-maps\.com$/.test(global.location.hostname)) {
      global.location.replace('https://' + global.location.host + global.location.pathname + global.location.search + global.location.hash);
    }
  } catch (e) { /* 何もしない */ }

  /* ---------- アクセス解析（Google アナリティクス 4） ----------
     何人来て、どのページが見られたかを数えるためのもの。
     ★個人情報を Google に送らないための決まり
       ・送るページの住所は「?」「#」より後ろを消す
         （共有ページの合言葉入りURLや、ログインの戻り値を送らないため）
       ・Google シグナル・広告のための個人向け設定は使わない
       ・管理画面・ログイン画面と、手元での試し（localhost）では動かさない
         （ログイン画面のURLには、ログインの戻り値が付くことがあるため）
     プライバシーポリシー第6条に、送る内容と送り先を書いている。 */
  try {
    var GA_ID = 'G-ZRRZBPW5K1';
    var host = global.location.hostname;
    var path = global.location.pathname;
    if (/(^|\.)eizo-maps\.com$/.test(host) && path.indexOf('/admin/') !== 0 && path.indexOf('/auth/') !== 0) {
      global.dataLayer = global.dataLayer || [];
      var gtag = function () { global.dataLayer.push(arguments); };
      global.gtag = gtag;
      gtag('js', new Date());
      gtag('config', GA_ID, {
        page_location: global.location.origin + path,
        page_referrer: document.referrer ? document.referrer.split(/[?#]/)[0] : '',
        allow_google_signals: false,
        allow_ad_personalization_signals: false
      });
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
      document.head.appendChild(s);
    }
  } catch (e) { /* 解析が動かなくてもサイトは普通に使える */ }

  var cfg = global.EM_CONFIG || {};
  var EM = {};
  EM.config = cfg;

  /* ---------- 結果の記録（Google アナリティクスの「キーイベント」） ----------
     2026-11-06 翠くん「analyticsの数値を正として、結果が出るようなSEO対策、AIO対策をしていく」
     ・generate_lead … 依頼を送った／はじめてメッセージを送った／鍵付きページを取り寄せた
     ・sign_up       … クリエイター／依頼する側のプロフィールを作った（method でどちらか）
     generate_lead の「どこから」はいつも lead_source で送る（2026-11-15 そろえた）
     ほかに数えるもの（2026-11-15 翠くん「進めていこう」）：
     ・project_reply   … クリエイターが案件に返事した（reply_type：accept／propose／decline）
     ・project_start   … クライアントが「この条件で始める」を押した＝取引が決まった（project_origin：direct／board）
     ・budget_estimate … 「予算の目安」を使った（video_type）
     ・estimate_save   … 実行表を新しく保存した
     ・cta_click       … コラム・トップのボタンや data-cta の付いたリンクが押された（cta_id・cta_text）
     名前・メール・本文などの個人の情報は送らない。解析が動いていないとき（手元の試しなど）は何もしない。
     done を渡すと、送り終わってから（長くても1.2秒で）呼ぶ（すぐ別のページに移るときに記録が消えないように） */
  EM.track = function (name, params, done) {
    var called = false, next = function () { if (!called) { called = true; if (done) done(); } };
    try {
      if (typeof global.gtag === 'function') {
        global.gtag('event', name, Object.assign({ transport_type: 'beacon', event_callback: next }, params || {}));
        setTimeout(next, 1200);
        return;
      }
    } catch (e) { /* 記録できなくても続ける */ }
    next();
  };

  /* ---------- ボタンが押された数（コラム→予算の目安→募集、の流れを見るため） ---------- */
  try {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[data-cta], article.doc a.btn, #pitchClient a.btn, #pitchCreator a.btn') : null;
      if (!a) return;
      EM.track('cta_click', { cta_id: a.getAttribute('data-cta') || (location.pathname.replace(/\/$/, '') || '/home'), cta_text: (a.textContent || '').trim().slice(0, 40), link_url: (a.getAttribute('href') || '').split('?')[0] });
    }, true);
  } catch (e) { /* 数えられなくても動く */ }

  /* ---------- Supabase クライアント ---------- */
  var _sb = null;
  EM.configured = function () {
    return !!(cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1 &&
              cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf('YOUR-ANON') === -1);
  };
  EM.sb = function () {
    if (_sb) return _sb;
    if (!global.supabase || !EM.configured()) return null;
    _sb = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return _sb;
  };

  /* ---------- DOM ヘルパー ---------- */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') { node.textContent = String(v); }
        else if (k === 'class') { node.className = v; }
        else if (k === 'html') { throw new Error('html プロパティは使用禁止です（XSS対策）'); }
        // style は必ずオブジェクトで渡す。
        // 文字列を style 属性に入れる方法は CSP（style-src に unsafe-inline を
        // 付けていない）に弾かれて“黙って効かない”ため、書けないようにしておく。
        // CSSOM 経由の代入は CSP の対象外なので、こちらは安全に効く。
        else if (k === 'style') {
          if (typeof v === 'string') {
            throw new Error('style は文字列ではなくオブジェクトで渡してください（CSP対策）');
          }
          Object.keys(v).forEach(function (prop) {
            if (prop.slice(0, 2) === '--') node.style.setProperty(prop, String(v[prop]));
            else node.style[prop] = v[prop];
          });
        }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') { node.addEventListener(k.slice(2), v); }
        else if (k === 'dataset') { Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; }); }
        else { node.setAttribute(k, v === true ? '' : String(v)); }
      });
    }
    (Array.isArray(children) ? children : (children ? [children] : [])).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  EM.el = el;
  EM.$  = function (sel, root) { return (root || document).querySelector(sel); };
  EM.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  EM.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };

  /* ---------- 外部リンクの安全化 ---------- */
  // ユーザーが入れた URL は https のみ許可する（javascript: 等を弾く）
  EM.safeUrl = function (url) {
    if (!url) return null;
    try {
      var u = new URL(String(url), global.location.origin);
      return u.protocol === 'https:' ? u.href : null;
    } catch (e) { return null; }
  };

  /* ---------- 通知 ---------- */
  var toastTimer = null;
  EM.toast = function (msg) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = el('div', { class: 'toast', role: 'status', text: msg });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 3200);
  };

  EM.notice = function (node, msg, kind) {
    if (!node) return;
    node.className = 'notice' + (kind === 'error' ? ' notice--error' : kind === 'ok' ? ' notice--ok' : '');
    node.textContent = msg || '';
    node.hidden = !msg;
  };

  /* ---------- エラーメッセージの日本語化 ---------- */
  EM.errorText = function (error) {
    if (!error) return '不明なエラーが発生しました。';
    var m = String(error.message || error);
    var map = [
      ['Invalid login credentials', 'メールアドレスまたはパスワードが違います。'],
      ['Email not confirmed', 'メールアドレスの確認が完了していません。届いたメールのリンクを開いてください。'],
      ['User already registered', 'このメールアドレスは既に登録されています。'],
      ['Password should be at least', 'パスワードが短すぎます。'],
      ['permission denied', '権限がありません。'],
      ['violates row-level security', 'この操作は許可されていません。'],
      ['duplicate key', 'すでに登録済みです。'],
      ['Failed to fetch', '通信に失敗しました。ネットワーク環境をご確認ください。'],
      // メールの送信まわり（Supabase の英語のメッセージを日本語にする）
      ['returned from hook', 'メールを送れませんでした。時間をおいてもう一度お試しください。'],
      ['Error sending', 'メールを送れませんでした。時間をおいてもう一度お試しください。'],
      ['rate limit', '短い時間に何度も送られています。しばらく待ってからもう一度お試しください。'],
      ['you can only request this after', '短い時間に何度も送られています。1分ほど待ってからもう一度お試しください。'],
      ['Unable to validate email address', 'メールアドレスの形が正しくありません。'],
      ['invalid format', 'メールアドレスの形が正しくありません。'],
      ['should be different from the old', '前と同じパスワードは使えません。'],
      ['Signup requires a valid password', 'パスワードを入力してください。'],
      ['Signups not allowed', 'いまは新しい登録を受け付けていません。']
    ];
    for (var i = 0; i < map.length; i++) if (m.indexOf(map[i][0]) !== -1) return map[i][1];
    // 日本語を含まない（英語だけの）メッセージは、そのまま出さない
    if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(m)) return 'うまくいきませんでした。時間をおいてもう一度お試しください。';
    return m;
  };

  /* ---------- 認証 ---------- */
  EM.getUser = function () {
    var sb = EM.sb();
    if (!sb) return Promise.resolve(null);
    return sb.auth.getUser().then(function (r) { return (r && r.data && r.data.user) || null; })
      .catch(function () { return null; });
  };
  EM.requireUser = function () {
    return EM.getUser().then(function (u) {
      if (!u) {
        var next = encodeURIComponent(location.pathname + location.search);
        location.replace('/auth/?next=' + next);
        return null;
      }
      return u;
    });
  };
  /* ---------- 画像・動画を付ける（お問い合わせ・問題の報告。2026-11-17 翠くん） ----------
     ・非公開の置き場 inquiry-files の「自分のフォルダ」に入れる。見られるのは本人と運営だけ
     ・5つまで・1つ50MBまで・画像（jpg/png/webp/gif/heic）と動画（mp4/mov/webm） */
  EM.attachBox = function (user) {
    var MAX = 5, MAXB = 50 * 1024 * 1024;
    var OK = /^(image\/(jpeg|png|webp|gif|heic|heif)|video\/(mp4|quicktime|webm))$/;
    var files = [];
    var input = el('input', { type: 'file', multiple: true, accept: 'image/*,video/mp4,video/quicktime,video/webm', class: 'attach__input' });
    var list = el('ul', { class: 'attach__list' });
    var err = el('p', { class: 'small attach__err', hidden: true });
    var node = el('div', { class: 'field attach' }, [
      el('span', { class: 'label', text: '画像・動画を付ける（任意・5つまで・1つ50MBまで）' }),
      user ? el('label', { class: 'btn btn--sm attach__pick' }, [input, document.createTextNode('＋ 画像・動画を選ぶ')]) : el('p', { class: 'small muted' }, [document.createTextNode('画像や動画（スクリーンショットなど）を付けるには、'), el('a', { href: '/auth/?next=' + encodeURIComponent(location.pathname + location.search), text: 'ログイン' }), document.createTextNode('してください。')]),
      list, err,
      el('span', { class: 'hint', text: '付けたファイルは、あなたと運営だけが見られます。' })
    ]);
    function draw() {
      EM.clear(list);
      files.forEach(function (f, i) {
        list.appendChild(el('li', null, [
          el('span', { class: 'small', text: (f.type.indexOf('video') === 0 ? '🎬 ' : '🖼 ') + f.name + '（' + (f.size / 1048576).toFixed(1) + 'MB）' }),
          el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: '外す', onclick: function () { files.splice(i, 1); draw(); } })
        ]));
      });
    }
    input.addEventListener('change', function () {
      var msgs = [];
      Array.prototype.forEach.call(input.files || [], function (f) {
        if (files.length >= MAX) { msgs.push('5つまでです。'); return; }
        if (!OK.test(f.type)) { msgs.push(f.name + '：この形式は付けられません（画像・動画だけ）。'); return; }
        if (f.size > MAXB) { msgs.push(f.name + '：50MBを超えています。短くするか、軽くしてから付けてください。'); return; }
        files.push(f);
      });
      input.value = '';
      err.hidden = !msgs.length; err.textContent = msgs.join(' ');
      draw();
    });
    function upload() {
      if (!files.length || !user) return Promise.resolve([]);
      var sb = EM.sb();
      return Promise.all(files.map(function (f) {
        var ext = (f.name.match(/\.([A-Za-z0-9]{1,5})$/) || [, ''])[1].toLowerCase();
        var id = (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
        var path = user.id + '/' + id + (ext ? '.' + ext : '');
        return sb.storage.from('inquiry-files').upload(path, f, { contentType: f.type, upsert: false }).then(function (r) {
          if (r.error) throw new Error(f.name + ' を送れませんでした：' + EM.errorText(r.error));
          return path;
        });
      }));
    }
    return { node: node, upload: upload, count: function () { return files.length; } };
  };

  EM.signOut = function () {
    var sb = EM.sb();
    if (!sb) return Promise.resolve();
    return sb.auth.signOut().then(function () { location.href = '/'; });
  };

  /* ---------- 日本の祝日（計算で出す。振替休日・国民の休日も含む） ----------
     EM.jpHoliday(new Date(2026, 10, 3)) → '文化の日'／祝日でなければ ''
     春分の日・秋分の日は計算の式によるもの（正式には前の年に国が発表する） */
  var holidayCache = {};
  function nthMonday(y, m, n) { var d = new Date(y, m, 1); var first = (8 - d.getDay()) % 7 + 1; return first + (n - 1) * 7; }
  function baseHolidays(y) {
    var h = {};
    function put(m, d, name) { h[(m + 1) + '-' + d] = name; }
    put(0, 1, '元日'); put(1, 11, '建国記念の日'); put(1, 23, '天皇誕生日'); put(3, 29, '昭和の日');
    put(4, 3, '憲法記念日'); put(4, 4, 'みどりの日'); put(4, 5, 'こどもの日'); put(7, 11, '山の日');
    put(10, 3, '文化の日'); put(10, 23, '勤労感謝の日');
    put(0, nthMonday(y, 0, 2), '成人の日'); put(6, nthMonday(y, 6, 3), '海の日');
    put(8, nthMonday(y, 8, 3), '敬老の日'); put(9, nthMonday(y, 9, 2), 'スポーツの日');
    put(2, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), '春分の日');
    put(8, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)), '秋分の日');
    return h;
  }
  function holidaysOf(y) {
    if (holidayCache[y]) return holidayCache[y];
    var h = baseHolidays(y), out = {};
    Object.keys(h).forEach(function (k) { out[k] = h[k]; });
    var keyOf = function (d) { return (d.getMonth() + 1) + '-' + d.getDate(); };
    // 国民の休日（祝日にはさまれた平日）
    for (var t = new Date(y, 0, 2); t.getFullYear() === y; t.setDate(t.getDate() + 1)) {
      var prev = new Date(t), next = new Date(t);
      prev.setDate(t.getDate() - 1); next.setDate(t.getDate() + 1);
      if (!out[keyOf(t)] && t.getDay() !== 0 && h[keyOf(prev)] && h[keyOf(next)] && prev.getFullYear() === y && next.getFullYear() === y) out[keyOf(t)] = '国民の休日';
    }
    // 振替休日（祝日が日曜なら、その後のいちばん近い祝日でない日）
    Object.keys(h).forEach(function (k) {
      var p = k.split('-'), d = new Date(y, +p[0] - 1, +p[1]);
      if (d.getDay() !== 0) return;
      var n = new Date(d);
      do { n.setDate(n.getDate() + 1); } while (out[keyOf(n)] && n.getFullYear() === y);
      if (n.getFullYear() === y) out[keyOf(n)] = '振替休日';
    });
    holidayCache[y] = out;
    return out;
  }
  EM.jpHoliday = function (d) { return holidaysOf(d.getFullYear())[(d.getMonth() + 1) + '-' + d.getDate()] || ''; };

  /* ---------- URL パラメータ ---------- */
  EM.param = function (name) { return new URLSearchParams(location.search).get(name); };

  /* ---------- 表示ヘルパー ---------- */
  EM.stars = function (score) {
    var s = Math.max(0, Math.min(5, Number(score) || 0));
    var full = Math.floor(s + 0.001);
    var half = (s - full) >= 0.5 ? 1 : 0;
    return '★'.repeat(full) + (half ? '⯨' : '') + '☆'.repeat(Math.max(0, 5 - full - half));
  };
  EM.initials = function (name) { return (String(name || '?').trim()[0] || '?').toUpperCase(); };
  EM.date = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  };
  // 日付＋時刻（例：2026.10.20 13:05）。「いつ保存したか」の表示に使う
  EM.datetime = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return EM.date(iso) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  /* ---------- 画面下にずっと出る「保存」バー ----------
     1つのページの中の入力をまとめて1回で保存する。
     ・入力が変わると「保存していない変更があります」になり、ボタンが押せるようになる
     ・保存できたら「最終保存 2026.10.20 13:05」を出す
     ・保存していない変更があるままページを離れようとすると、ブラウザが確認を出す
     使い方：var bar = EM.saveBar({ watch: [要素...], onSave: function () { return Promise; }, savedAt: iso });
       onSave は保存できたら「保存した時刻（ISO）」か何もない値で解決する Promise を返す */
  EM.saveBar = function (opts) {
    opts = opts || {};
    var dirty = false, busy = false, savedAt = opts.savedAt || null;
    var state = el('span', { class: 'savebar__state' });
    var time = el('span', { class: 'savebar__time mono' });
    var btn = el('button', { type: 'button', class: 'btn btn--primary savebar__btn', text: opts.label || '保存する' });
    var bar = el('div', { class: 'savebar', role: 'region', 'aria-label': '保存' }, [
      el('div', { class: 'savebar__inner' }, el('div', { class: 'savebar__row' }, [
        el('div', { class: 'savebar__info', 'aria-live': 'polite' }, [state, time]),
        btn
      ]))
    ]);
    document.body.appendChild(bar);
    document.body.classList.add('has-savebar');

    function paint() {
      bar.classList.toggle('is-dirty', dirty);
      state.textContent = busy ? '保存しています…' : dirty ? '保存していない変更があります' : '変更はすべて保存されています';
      time.textContent = savedAt ? '最終保存 ' + EM.datetime(savedAt) : '';
      btn.disabled = busy || !dirty;
      if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    }
    function markDirty() { if (!busy) { dirty = true; paint(); } }

    (opts.watch || []).forEach(function (node) {
      if (!node) return;
      node.addEventListener('input', markDirty);
      node.addEventListener('change', markDirty);
    });
    window.addEventListener('beforeunload', function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    function save() {
      if (busy || !dirty || typeof opts.onSave !== 'function') return Promise.resolve();
      busy = true; paint();
      var p;
      try { p = Promise.resolve(opts.onSave()); } catch (err) { p = Promise.reject(err); }
      return p.then(function (at) {
        if (at === false) { busy = false; paint(); return; }   // 入力の不備などで保存しなかった
        dirty = false;
        savedAt = (typeof at === 'string' && at) ? at : new Date().toISOString();
        busy = false; paint();
        EM.toast('保存しました');
      }, function (err) {
        busy = false; paint();
        throw err;
      });
    }
    btn.addEventListener('click', function () { save().catch(function () {}); });
    // Ctrl+S / ⌘+S でも保存
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        if (dirty) { e.preventDefault(); save().catch(function () {}); }
      }
    });
    paint();

    return {
      markDirty: markDirty,
      save: save,
      isDirty: function () { return dirty; },
      setSavedAt: function (iso) { savedAt = iso || savedAt; paint(); },
      reset: function (iso) { dirty = false; if (iso) savedAt = iso; paint(); }
    };
  };

  // 推測されにくい読みやすいパスワード（例：k7m3-x9pa-q2rt）。0/O・1/l/I など見間違えやすい文字は使わない
  EM.randomPassword = function () {
    var abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    var buf = new Uint32Array(12);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    var s = '';
    for (var i = 0; i < 12; i++) {
      s += abc[buf[i] % abc.length];
      if (i === 3 || i === 7) s += '-';
    }
    return s;
  };

  EM.avatar = function (url, name, big) {
    var safe = EM.safeUrl(url);
    if (safe) return el('img', { class: 'avatar' + (big ? ' avatar--lg' : ''), src: safe, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    return el('div', { class: 'avatar' + (big ? ' avatar--lg' : ''), 'aria-hidden': 'true' }, EM.initials(name));
  };

  /* ---------- アフィリエイト（A8 さん）の広告コード ----------
     A8 さんの決まりで、広告コードは変えずにそのまま載せる（リンク部分だけ使うのも禁止）。
     ただし Eizo Maps は HTML をそのまま差し込まない方針なので、
     コードを読み取り、a と img だけが A8 さんの住所を指しているときに限って、
     その要素を属性もそのままに写して並べる（中身は変えない）。条件に合わなければ何も出さない。 */
  var A8_HOST = /^https?:\/\/([a-z0-9-]+\.)*a8\.net\//i;
  var A8_ATTR = { A: ['href', 'rel', 'target'], IMG: ['src', 'width', 'height', 'border', 'alt'] };
  // checkOnly：形が正しいかだけ確かめ、ページの部品は作らない
  // （部品を作った時点で画像の読み込みが始まり、見せていない広告まで表示回数に数えられてしまうため）
  EM.a8Nodes = function (code, checkOnly) {
    if (!code || typeof DOMParser === 'undefined') return null;
    var doc = new DOMParser().parseFromString('<body>' + String(code) + '</body>', 'text/html');
    var ok = true;
    function check(node, insideA) {
      if (node.nodeType === 3) return;                       // 文字（テキストの広告・改行）
      if (node.nodeType !== 1) { ok = false; return; }
      var tag = node.tagName;
      if (!A8_ATTR[tag]) { if (tag !== 'BR') ok = false; return; }
      if (tag === 'A' && insideA) { ok = false; return; }
      for (var i = 0; i < node.attributes.length; i++) {
        if (A8_ATTR[tag].indexOf(node.attributes[i].name.toLowerCase()) === -1) { ok = false; return; }
      }
      var url = node.getAttribute(tag === 'A' ? 'href' : 'src') || '';
      if (!A8_HOST.test(url)) { ok = false; return; }
      for (var j = 0; j < node.childNodes.length; j++) check(node.childNodes[j], insideA || tag === 'A');
    }
    var kids = Array.prototype.slice.call(doc.body.childNodes);
    kids.forEach(function (n) { check(n, false); });
    if (!ok || !kids.some(function (n) { return n.nodeType === 1 && n.tagName === 'A'; })) return null;
    if (checkOnly) return true;
    return kids.map(function (n) { return document.importNode(n, true); });
  };
  // コードの中のリンク先（管理用に控えておく）
  EM.a8Href = function (code) {
    var nodes = EM.a8Nodes(code);
    if (!nodes) return null;
    for (var i = 0; i < nodes.length; i++) if (nodes[i].tagName === 'A') return nodes[i].getAttribute('href');
    return null;
  };

  /* ---------- 都道府県 ---------- */
  EM.PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県',
    '埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県',
    '岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
    '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県',
    '佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県','海外'];

  EM.TAG_PRESETS = ['CM','MV','ドキュメンタリー','ウェディング','企業VP','SNS動画','ドラマ','映画',
    'イベント','ライブ','アニメーション','商品紹介','採用動画','インタビュー'];

  /* ---------- 案件まわりの定義 ---------- */
  EM.PROJECT_KINDS = ['CM','MV','企業VP','SNS動画','イベント','ドキュメンタリー','ウェディング','ドラマ・映画','その他'];

  // 予算は「レンジの下限」を budget_amount に保存し、表示はラベルに戻す
  EM.BUDGETS = [
    { v: null,    l: '未定' },
    { v: 0,       l: '〜10万円' },
    { v: 100000,  l: '10〜30万円' },
    { v: 300000,  l: '30〜50万円' },
    { v: 500000,  l: '50〜100万円' },
    { v: 1000000, l: '100〜300万円' },
    { v: 3000000, l: '300万円〜' }
  ];
  EM.budgetLabel = function (v) {
    if (v === null || v === undefined) return '未定';
    for (var i = 0; i < EM.BUDGETS.length; i++) if (EM.BUDGETS[i].v === Number(v)) return EM.BUDGETS[i].l;
    return Number(v).toLocaleString('ja-JP') + '円';
  };

  EM.STATUS_LABEL = {
    draft: '下書き', offered: '返事待ち', proposed: '条件の返事あり', declined: 'お断り',
    in_progress: '進行中', delivered: '納品済み',
    paid: '入金済み', closed: '完了', cancelled: 'キャンセル'
  };

  // 次に進めるステータス。DB側のトリガと同じ規則をそのまま持たせている。
  EM.nextStatuses = function (status, role) {
    var out = [];
    if (status === 'draft' && role === 'client') out.push(['offered', '依頼を送る']);
    // 返事待ち → 条件の返事あり → 進行中 は、案件ページの専用ボタン（project_respond / project_start）で進める
    if (status === 'in_progress' && role === 'creator') out.push(['delivered', '納品済みにする']);
    if (status === 'delivered' && role === 'client') out.push(['paid', '入金済みにする']);
    if (status === 'paid') out.push(['closed', '完了にする']);
    // 返事の前後でクリエイターがやめるときは「お断りする」を使う
    if ((role === 'client' && ['draft', 'offered', 'proposed', 'in_progress'].indexOf(status) !== -1) ||
        (role === 'creator' && status === 'in_progress')) out.push(['cancelled', 'キャンセルする']);
    return out;
  };

  EM.canReview = function (status) {
    return ['delivered', 'paid', 'closed'].indexOf(status) !== -1;
  };

  EM.REPORT_CATEGORIES = [
    ['unpaid', '報酬の未払い'],
    ['harassment', 'ハラスメント・不当な扱い'],
    ['false_review', '事実と異なる評価'],
    ['other', 'その他']
  ];

  EM.statusBadge = function (status) {
    return el('span', { class: 'tag' + (status === 'cancelled' || status === 'declined' ? '' : status === 'proposed' ? ' tag--client' : ' tag--accent'),
                        text: EM.STATUS_LABEL[status] || status });
  };

  /* ---------- 権限（運営 / 執筆者） ---------- */
  // 画面の出し分けにだけ使う。実際の可否はすべてサーバー側（RLS と RPC）で判定する。
  var _rolesPromise = null;
  EM.roles = function () {
    if (_rolesPromise) return _rolesPromise;
    var sb = EM.sb();
    if (!sb) return Promise.resolve({ admin: false, writer: false });
    _rolesPromise = sb.rpc('my_roles')
      .then(function (r) {
        if (r.error || !r.data) return { admin: false, writer: false };
        return { admin: !!r.data.admin, writer: !!r.data.writer };
      })
      .catch(function () { return { admin: false, writer: false }; });
    return _rolesPromise;
  };

  EM.ANNOUNCE_KIND = {
    update: 'アップデート', notice: 'お知らせ',
    maintenance: 'メンテナンス', event: 'イベント'
  };

  /* ---------- 外部リンク（SNS など） ---------- */
  EM.LINK_PLATFORMS = [
    ['x', 'X（旧Twitter）'],
    ['instagram', 'Instagram'],
    ['tiktok', 'TikTok'],
    ['youtube', 'YouTube'],
    ['facebook', 'Facebook'],
    ['threads', 'Threads'],
    ['note', 'note'],
    ['website', 'ウェブサイト'],
    ['other', 'その他']
  ];
  EM.platformLabel = function (v) {
    for (var i = 0; i < EM.LINK_PLATFORMS.length; i++) {
      if (EM.LINK_PLATFORMS[i][0] === v) return EM.LINK_PLATFORMS[i][1];
    }
    return 'リンク';
  };
  // URL からサービスを推測する（入力の手間を減らすためだけの機能。
  // 判定に失敗しても website / other として扱えば安全側に倒れる）
  EM.guessPlatform = function (url) {
    var u;
    try { u = new URL(String(url || '')); } catch (e) { return 'website'; }
    if (u.protocol !== 'https:') return 'website';
    var h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h === 'x.com' || h === 'twitter.com' || h === 'mobile.twitter.com') return 'x';
    if (h === 'instagram.com') return 'instagram';
    if (h.indexOf('tiktok.com') !== -1) return 'tiktok';
    if (h === 'youtube.com' || h === 'youtu.be' || h === 'm.youtube.com') return 'youtube';
    if (h === 'facebook.com' || h === 'fb.com') return 'facebook';
    if (h === 'threads.net' || h === 'threads.com') return 'threads';
    if (h === 'note.com') return 'note';
    return 'website';
  };

  /* ---------- 依頼の受け取り方 ---------- */
  EM.CONTACT_PREFS = [
    ['form', 'Eizo Maps の依頼フォームで受け取る'],
    ['dm',   'SNS の DM で受け取る'],
    ['both', 'どちらでも受け取る']
  ];

  /* ---------- ヘッダー / フッター ---------- */
  var NAV_PUBLIC = [
    ['/', 'ホーム'],
    ['/creators/', 'クリエイターを探す'],
    ['/jobs/', '募集を見る'],
    ['/features/', '便利な機能'],
    ['/pricing/', '料金'],
    ['/help/', '使い方・ヘルプ']
  ];
  var NAV_USER = [
    ['/mypage/', 'マイページ'],
    ['/messages/', 'メッセージ'],
    ['/mypage/portfolio.html', 'ポートフォリオ管理'],
    ['/mypage/stock.html', 'ストックページ'],
    ['/schedule/', 'スケジュール'],
    ['/schedule/gantt.html', 'ガントチャート'],
    ['/templates/', '定型文のひな形'],
    ['/estimate/', '実行表（見積もり）'],
    ['/projects/', '案件管理'],
    ['/jobs/mine.html', '送った提案'],
    ['/report/', '問題報告']
  ];
  // クライアントとして使っているときのメニュー（制作側の道具は出さない・2026-11-15 翠くん）
  var NAV_CLIENT = [
    ['/mypage/client/', 'マイページ'],
    ['/messages/', 'メッセージ'],
    ['/projects/', '依頼した案件'],
    ['/jobs/new.html', '募集を出す'],
    ['/jobs/mine.html', '出した募集'],
    ['/estimate/quick/', '予算の目安'],
    ['/report/', '問題報告']
  ];
  var NAV_FOOT = [
    ['/companies/', '依頼した会社の評価'],
    ['/terms/', '利用規約'],
    ['/privacy/', 'プライバシーポリシー'],
    ['/legal/', '特定商取引法に基づく表記'],
    ['/contact/', 'お問い合わせ']
  ];

  /* ---------- 予定の種別と色（どの画面でも同じ色を使う） ----------
     色は「意味ごと」に決めて使い回す：撮影＝黄、編集＝青、打合せ＝紫、納品＝緑、仮押さえ＝橙 */
  EM.KINDS = [
    ['shoot',    '撮影',    '#e8ff47'],
    ['edit',     '編集',    '#7ad1ff'],
    ['meeting',  '打合せ',  '#b79cff'],
    ['delivery', '納品',    '#4ade80'],
    ['hold',     '仮押さえ', '#ff9d5c'],
    ['other',    'その他',  '#9aa0b5'],
    ['private',  '非公開',  '#5a6072']
  ];
  EM.kindLabel = function (k) { for (var i = 0; i < EM.KINDS.length; i++) if (EM.KINDS[i][0] === k) return EM.KINDS[i][1]; return '予定'; };
  EM.kindColor = function (k) { for (var i = 0; i < EM.KINDS.length; i++) if (EM.KINDS[i][0] === k) return EM.KINDS[i][2]; return '#9aa0b5'; };

  /* ---------- 日付の小道具（YYYY-MM-DD の文字で扱う） ---------- */
  function pad2(n) { return String(n).padStart(2, '0'); }
  EM.ymd = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  EM.parseYmd = function (s) { var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  EM.addDays = function (s, n) { var d = EM.parseYmd(s); d.setDate(d.getDate() + n); return EM.ymd(d); };
  EM.today = function () { return EM.ymd(new Date()); };
  EM.dayDiff = function (a, b) { return Math.round((EM.parseYmd(b) - EM.parseYmd(a)) / 86400000); };
  EM.WD = ['日', '月', '火', '水', '木', '金', '土'];
  EM.md = function (s) { var d = EM.parseYmd(s); return (d.getMonth() + 1) + '/' + d.getDate(); };
  EM.mdw = function (s) { var d = EM.parseYmd(s); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + EM.WD[d.getDay()] + '）'; };
  EM.weekStart = function (s) { var d = EM.parseYmd(s); var w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return EM.ymd(d); }; // 月曜はじまり

  /* ---------- アイコン（線だけのシンプルな絵。部品の見出しに必ず付ける） ---------- */
  var ICONS = {
    plus:     [['path', 'M12 5v14M5 12h14']],
    search:   [['circle', 11, 11, 7], ['path', 'M20 20l-3.6-3.6']],
    calendar: [['rect', 3, 5, 18, 16, 2], ['path', 'M3 10h18M8 3v4M16 3v4']],
    week:     [['rect', 3, 5, 18, 14, 2], ['path', 'M3 10h18M6 14h7M9 17h9']],
    gantt:    [['path', 'M4 4v16h16'], ['path', 'M7 8h7M10 12h8M8 16h5']],
    flag:     [['path', 'M5 21V4h11l-2 4 2 4H5']],
    check:    [['rect', 3, 3, 18, 18, 3], ['path', 'M8 12l3 3 5-6']],
    sun:      [['circle', 12, 12, 4], ['path', 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4']],
    cloud:    [['path', 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z']],
    rain:     [['path', 'M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z'], ['path', 'M8 18l-1 3M12 18l-1 3M16 18l-1 3']],
    snow:     [['path', 'M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 5.5 4.3 4.3 0 0 0 7 14z'], ['path', 'M8 18h.01M12 20h.01M16 18h.01']],
    doc:      [['path', 'M6 3h9l4 4v14H6z'], ['path', 'M14 3v5h5M9 13h7M9 17h5']],
    film:     [['rect', 3, 5, 18, 14, 2], ['path', 'M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4']],
    folder:   [['path', 'M3 6h6l2 2h10v11H3z']],
    clock:    [['circle', 12, 12, 9], ['path', 'M12 7v5l3 2']],
    copy:     [['rect', 8, 8, 13, 13, 2], ['path', 'M16 8V4H3v13h5']],
    edit:     [['path', 'M4 20h4L19 9l-4-4L4 16z']],
    up:       [['path', 'M6 15l6-6 6 6']],
    down:     [['path', 'M6 9l6 6 6-6']],
    eye:      [['path', 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'], ['circle', 12, 12, 3]],
    eyeoff:   [['path', 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.1 3.6M6.3 7.3A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.1-.9']],
    home:     [['path', 'M4 11l8-7 8 7v9H4z'], ['path', 'M10 20v-5h4v5']],
    image:    [['rect', 3, 4, 18, 16, 2], ['path', 'M3 16l5-5 4 4 3-3 6 6']],
    chat:     [['path', 'M4 5h16v11H9l-5 4z']],
    star:     [['path', 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z']],
    pin:      [['path', 'M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z'], ['circle', 12, 10, 2.2]]
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  EM.icon = function (name, cls) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    (ICONS[name] || []).forEach(function (s) {
      var n = document.createElementNS(SVGNS, s[0]);
      if (s[0] === 'path') n.setAttribute('d', s[1]);
      else if (s[0] === 'circle') { n.setAttribute('cx', s[1]); n.setAttribute('cy', s[2]); n.setAttribute('r', s[3]); }
      else if (s[0] === 'rect') { n.setAttribute('x', s[1]); n.setAttribute('y', s[2]); n.setAttribute('width', s[3]); n.setAttribute('height', s[4]); n.setAttribute('rx', s[5] || 0); }
      svg.appendChild(n);
    });
    return svg;
  };
  // 部品の見出しは必ず「アイコン＋見出し」の同じ形にする
  EM.widgetHead = function (icon, title, extra) {
    return el('div', { class: 'wg__head' }, [
      el('h2', { class: 'wg__title' }, [EM.icon(icon), el('span', { text: title })]),
      extra || null
    ]);
  };

  /* ---------- 全体の検索（ヘッダーの虫めがね・「/」キー・Ctrl+K） ----------
     自分の予定・案件・作品・ひな形・やることを、タイトルやメモの言葉で探す。
     読める範囲はデータベースの決まり（本人だけ）で絞られている。 */
  var searchDlg = null;
  function cleanQuery(q) { return String(q || '').replace(/[,()*\\%_"'.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40); }
  EM.openSearch = function () {
    var sb = EM.sb();
    if (!sb) return;
    if (searchDlg) { searchDlg.showModal(); searchDlg.querySelector('input').select(); return; }
    var input = el('input', { type: 'search', class: 'qs__input', placeholder: '予定・案件・作品・ひな形・やることを探す', 'aria-label': '探す', maxlength: '40', autocomplete: 'off' });
    var out = el('div', { class: 'qs__out', 'aria-live': 'polite' });
    var close = el('button', { type: 'button', class: 'qs__close', 'aria-label': '閉じる', text: '✕' });
    searchDlg = el('dialog', { class: 'qs', 'aria-label': '探す' }, [
      el('div', { class: 'qs__bar' }, [EM.icon('search'), input, close]), out,
      el('p', { class: 'qs__hint small muted', text: 'どの画面でも「/」キーで開けます。' })
    ]);
    document.body.appendChild(searchDlg);
    close.addEventListener('click', function () { searchDlg.close(); });
    // 入力欄の「Esc」は文字を消すだけのことがあるので、Esc で必ず閉じるようにする
    searchDlg.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); searchDlg.close(); } });
    searchDlg.addEventListener('click', function (e) { if (e.target === searchDlg) searchDlg.close(); });
    var timer = null, seq = 0, me = null, creatorId = null;
    EM.getUser().then(function (u) {
      me = u;
      if (u) sb.from('creators').select('id').eq('user_id', u.id).maybeSingle().then(function (r) { creatorId = r.data && r.data.id; });
    });
    function group(title, icon, rows) {
      if (!rows.length) return null;
      return el('div', { class: 'qs__group' }, [
        el('p', { class: 'qs__gtitle' }, [EM.icon(icon), el('span', { text: title + '（' + rows.length + '）' })]),
        el('ul', { class: 'qs__list' }, rows.map(function (r) {
          return el('li', null, el('a', { href: r.href, class: 'qs__item' }, [
            el('span', { class: 'qs__name', text: r.name }),
            r.sub ? el('span', { class: 'qs__sub small muted', text: r.sub }) : null
          ]));
        }))
      ]);
    }
    function run() {
      var q = cleanQuery(input.value);
      var my = ++seq;
      EM.clear(out);
      if (!q) return;
      if (!me) { out.appendChild(el('p', { class: 'small muted', text: 'ログインすると探せます。' })); return; }
      out.appendChild(el('p', { class: 'small muted', text: '探しています…' }));
      var like = '*' + q + '*';
      Promise.all([
        sb.from('schedule_events').select('id,title,kind,starts_on,ends_on,location').eq('owner_user_id', me.id)
          .or('title.ilike.' + like + ',note.ilike.' + like + ',location.ilike.' + like).order('starts_on', { ascending: false }).limit(8),
        sb.from('schedule_projects').select('id,name').ilike('name', like).limit(6),
        sb.from('projects').select('id,title,status').ilike('title', like).limit(6),
        creatorId ? sb.from('portfolios').select('id,title').eq('creator_id', creatorId).ilike('title', like).limit(6) : Promise.resolve({ data: [] }),
        sb.from('message_templates').select('id,name,category').or('name.ilike.' + like + ',body.ilike.' + like).limit(6),
        sb.from('user_home').select('todos').maybeSingle()
      ]).then(function (r) {
        if (my !== seq) return;
        EM.clear(out);
        var d = function (i) { return (r[i] && !r[i].error && r[i].data) || []; };
        var low = q.toLowerCase();
        var todos = ((r[5] && r[5].data && r[5].data.todos) || []).filter(function (t) { return String(t.t || '').toLowerCase().indexOf(low) !== -1; }).slice(0, 6);
        var groups = [
          group('予定', 'calendar', d(0).map(function (e) { return { name: e.title, sub: EM.kindLabel(e.kind) + '・' + EM.mdw(e.starts_on) + (e.ends_on > e.starts_on ? '〜' + EM.md(e.ends_on) : '') + (e.location ? '・' + e.location : ''), href: '/schedule/day.html?d=' + e.starts_on }; })),
          group('自分で作った案件', 'folder', d(1).map(function (p) { return { name: p.name, href: '/schedule/projects.html' }; })),
          group('依頼の案件', 'film', d(2).map(function (p) { return { name: p.title, sub: (EM.STATUS_LABEL[p.status] || ''), href: '/projects/?id=' + encodeURIComponent(p.id) }; })),
          group('作品', 'image', d(3).map(function (p) { return { name: p.title, href: '/mypage/portfolio.html' }; })),
          group('定型文のひな形', 'doc', d(4).map(function (t) { return { name: t.name, sub: t.category, href: '/templates/?id=' + encodeURIComponent(t.id) }; })),
          group('やること', 'check', todos.map(function (t) { return { name: t.t, sub: t.d ? '済み' : '', href: '/#todo' }; }))
        ].filter(Boolean);
        if (!groups.length) out.appendChild(el('p', { class: 'small muted', text: '「' + q + '」に合うものは見つかりませんでした。' }));
        groups.forEach(function (g) { out.appendChild(g); });
      }).catch(function () { if (my === seq) { EM.clear(out); out.appendChild(el('p', { class: 'small muted', text: '探せませんでした。少し時間をおいてお試しください。' })); } });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 300); });
    searchDlg.showModal();
    input.focus();
  };

  /* ---------- クイック追加（ヘッダーの「＋ 追加」） ---------- */
  EM.QUICK_ADD = [
    ['calendar', '予定を追加', function () { return '/schedule/?new=' + EM.today(); }],
    ['folder',   '案件を作る', function () { return '/schedule/projects.html?new=1'; }],
    ['check',    'やることを追加', function () { return '/?todo=new#todo'; }],
    ['doc',      '定型文のひな形を作る', function () { return '/templates/?new=1'; }],
    ['image',    '作品を追加', function () { return '/mypage/portfolio.html'; }]
  ];
  // クライアントとして使っているときの「＋ 追加」
  EM.QUICK_ADD_CLIENT = [
    ['search', 'クリエイターを探して依頼する', function () { return '/creators/'; }],
    ['doc',    '募集を出す', function () { return '/jobs/new.html'; }],
    ['film',   '依頼した案件を見る', function () { return '/projects/'; }]
  ];
  function mountTools(slot, mode) {
    var items = mode === 'client' ? EM.QUICK_ADD_CLIENT : EM.QUICK_ADD;
    var menu = el('div', { class: 'qa__menu', role: 'menu', hidden: true }, items.map(function (q) {
      return el('a', { class: 'qa__item', role: 'menuitem', href: q[2]() }, [EM.icon(q[0]), el('span', { text: q[1] })]);
    }));
    var addBtn = el('button', { type: 'button', class: 'btn btn--sm btn--primary qa__btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      [EM.icon('plus'), el('span', { class: 'qa__label', text: '追加' })]);
    var searchBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': '探す（/ キー）', title: '探す（/ キー）' }, EM.icon('search'));
    var wrap = el('div', { class: 'qa' }, [addBtn, menu]);
    slot.appendChild(searchBtn);
    slot.appendChild(wrap);
    function setOpen(open) { menu.hidden = !open; addBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    addBtn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(menu.hidden); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    searchBtn.addEventListener('click', EM.openSearch);
    document.addEventListener('keydown', function (e) {
      var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) { e.preventDefault(); EM.openSearch(); }
    });
  }

  /* ---------- クリエイター／クライアントの切り替え（2026-11-15 翠くん） ----------
     ・登録の種類（users.account_type）：creator／client／both
     ・both の人は「いまどちらとして使っているか」をこのブラウザに覚えておく
     ・クリエイターのマイページ（/mypage/）を開いたらクリエイター、
       クライアントのマイページ（/mypage/client/）を開いたらクライアントに切り替わる */
  var MODE_KEY = 'em_view_mode';
  var typePromise = null;
  EM.myAccountType = function (fresh) {
    if (typePromise && !fresh) return typePromise;
    var sb = EM.sb();
    typePromise = EM.getUser().then(function (u) {
      if (!u || !sb) return null;
      return sb.from('users').select('account_type').eq('id', u.id).maybeSingle().then(function (r) {
        return (r && r.data && r.data.account_type) || 'creator';
      }, function () { return 'creator'; });
    });
    return typePromise;
  };
  EM.setViewMode = function (mode) {
    try { localStorage.setItem(MODE_KEY, mode === 'client' ? 'client' : 'creator'); } catch (e) {}
  };
  function storedMode() {
    try { return localStorage.getItem(MODE_KEY) === 'client' ? 'client' : 'creator'; } catch (e) { return 'creator'; }
  }
  // 登録の種類から、いまの使い方（creator／client）を返す（ページを移らずに知りたいとき用）
  EM.viewModeFor = function (type) {
    if (type === 'client') return 'client';
    if (type === 'both') return isClientMypage() ? 'client' : isCreatorMypage() ? 'creator' : storedMode();
    return 'creator';
  };
  function isClientMypage() { return location.pathname.indexOf('/mypage/client') === 0; }
  function isCreatorMypage() { return /^\/mypage\/(index\.html)?$/.test(location.pathname); }
  // 今のページに合うモードを決める。種類と合わないマイページを開いたときは正しい方へ移す
  EM.applyViewMode = function (type) {
    if (type === 'client' && isCreatorMypage()) { location.replace('/mypage/client/'); return 'redirect'; }
    if (type === 'creator' && isClientMypage()) { location.replace('/mypage/'); return 'redirect'; }
    var mode;
    if (type === 'client') mode = 'client';
    else if (type === 'both') {
      if (isClientMypage()) EM.setViewMode('client');
      else if (isCreatorMypage()) EM.setViewMode('creator');
      mode = storedMode();
    } else mode = 'creator';
    document.body.setAttribute('data-mode', mode);
    return mode;
  };
  // 「いま：クリエイターとして／クライアントとして」の帯
  //   両方の人：どの画面でも出す（切り替えボタンつき）／片方だけの人：マイページでだけ出す
  function mountModeBand(type, mode, header) {
    if (!type) return;
    var onMypage = isClientMypage() || isCreatorMypage();
    if (type !== 'both' && !onMypage) return;
    var label = mode === 'client' ? 'クライアント' : 'クリエイター';
    var kids = [el('span', { class: 'mode-band__label' }, [
      el('span', { class: 'mode-band__dot', 'aria-hidden': 'true' }),
      document.createTextNode('いま：'), el('b', { text: label }), el('span', { class: 'mode-band__long', text: 'として使っています' })
    ])];
    if (type === 'both') {
      var to = mode === 'client' ? 'creator' : 'client';
      kids.push(el('a', {
        class: 'mode-band__switch', href: to === 'client' ? '/mypage/client/' : '/mypage/',
        text: (to === 'client' ? 'クライアント' : 'クリエイター') + 'に切り替え ⇄',
        onclick: function () { EM.setViewMode(to); }
      }));
    }
    var band = el('div', { class: 'mode-band mode-band--' + mode, role: 'status' }, el('div', { class: 'wrap' }, kids));
    header.parentNode.insertBefore(band, header.nextSibling);
  }

  /* ---------- メールのお知らせのオン・オフ（両方のマイページの「アカウント」・2026-11-15） ----------
     変えたらすぐ保存（保存ボタンは押さなくてよい） */
  EM.mountNotifyToggle = function (box) {
    var sb = EM.sb();
    if (!box || !sb) return;
    EM.getUser().then(function (u) {
      if (!u) return;
      sb.from('users').select('notify_email').eq('id', u.id).maybeSingle().then(function (r) {
        var on = !(r && r.data && r.data.notify_email === false);
        var cb = el('input', { type: 'checkbox', id: 'notifyEmail' });
        cb.checked = on;
        cb.addEventListener('change', function () {
          sb.from('users').update({ notify_email: cb.checked }).eq('id', u.id).then(function (x) {
            if (x.error) { cb.checked = !cb.checked; EM.toast(EM.errorText(x.error)); return; }
            EM.toast(cb.checked ? 'メールのお知らせをオンにしました' : 'メールのお知らせを止めました');
          });
        });
        box.appendChild(el('div', { class: 'field' }, [
          el('span', { class: 'label', text: 'メールのお知らせ' }),
          el('label', { class: 'notify-toggle' }, [cb, el('span', { text: '依頼・返事・提案・メッセージが届いたら、メールで知らせる' })]),
          el('span', { class: 'small muted', text: '例：「〇〇さんから依頼が届きました」「募集に提案が届きました」。メッセージは同じ相手から30分に1通までです。切り替えるとすぐ保存されます。' })
        ]));
      });
    });
  };

  EM.mountChrome = function () {
    var header = el('header', { class: 'site-header' }, [
      el('div', { class: 'wrap' }, [
        el('a', { href: '/', class: 'logo', 'aria-label': 'Eizo Maps ホーム' }, [
          el('span', { text: 'Eizo' }), el('b', { text: 'Maps' })
        ]),
        el('div', { class: 'header-actions' }, [
          el('div', { class: 'header-tools', id: 'headerTools' }),
          // ログインしていないときは「ログイン」、しているときは「マイページ」に切り替わる
          el('a', { class: 'btn btn--sm header-login', id: 'headerLogin', href: '/auth/', text: 'ログイン' }),
          el('button', {
            class: 'nav-toggle', type: 'button', id: 'navToggle',
            'aria-expanded': 'false', 'aria-controls': 'navPanel', 'aria-label': 'メニューを開く'
          }, '☰')
        ])
      ])
    ]);

    var list = el('ul');
    NAV_PUBLIC.forEach(function (n) { list.appendChild(el('li', null, el('a', { href: n[0], text: n[1] }))); });
    var userSlot = el('div', { id: 'navUserSlot' });
    var footList = el('ul');
    NAV_FOOT.forEach(function (n) { footList.appendChild(el('li', null, el('a', { href: n[0], text: n[1] }))); });

    var panel = el('nav', { class: 'nav-panel', id: 'navPanel', 'data-open': 'false' }, [
      el('div', { class: 'wrap' }, [list, userSlot, el('hr'), footList])
    ]);

    document.body.insertBefore(panel, document.body.firstChild);
    document.body.insertBefore(header, document.body.firstChild);

    var btn = document.getElementById('navToggle');
    btn.addEventListener('click', function () {
      var open = panel.getAttribute('data-open') === 'true';
      panel.setAttribute('data-open', open ? 'false' : 'true');
      document.body.classList.toggle('nav-open', !open);   // 開いているあいだは画面下の保存バーを隠す（最後の項目が隠れないように）
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      btn.textContent = open ? '☰' : '✕';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.getAttribute('data-open') === 'true') btn.click();
    });

    // ログイン状態に応じてメニューを差し替える
    EM.getUser().then(function (u) {
      return (u ? EM.myAccountType() : Promise.resolve(null)).then(function (type) { return [u, type]; });
    }).then(function (pair) {
      var u = pair[0], type = pair[1];
      var mode = u ? EM.applyViewMode(type) : null;
      if (mode === 'redirect') return;
      var hl = document.getElementById('headerLogin');
      if (hl && u) { hl.textContent = 'マイページ'; hl.setAttribute('href', mode === 'client' ? '/mypage/client/' : '/mypage/'); }
      if (u) mountTools(document.getElementById('headerTools'), mode);
      if (u) mountModeBand(type, mode, header);
      var slot = document.getElementById('navUserSlot');
      EM.clear(slot);
      var ul = el('ul');
      if (u) {
        (mode === 'client' ? NAV_CLIENT : NAV_USER).forEach(function (n) { ul.appendChild(el('li', null, el('a', { href: n[0], text: n[1] }))); });
        // まだ読んでいないメッセージがあれば、メニューとマイページのボタンに数を出す
        var sbm = EM.sb();
        if (sbm) sbm.rpc('dm_unread_count').then(function (r) {
          var n = r && !r.error ? Number(r.data) || 0 : 0;
          if (!n) return;
          var a = ul.querySelector('a[href="/messages/"]');
          if (a) a.appendChild(el('span', { class: 'nav-badge', text: String(n), 'aria-label': '未読 ' + n + '件' }));
          if (hl) hl.appendChild(el('span', { class: 'nav-badge', text: String(n), 'aria-label': '未読のメッセージ ' + n + '件' }));
        });
        // 自分の作品に削除の申し立てが届いていたら、どの画面でも上に知らせる（10/31 タキさん）
        if (sbm && location.pathname.indexOf('/mypage/portfolio') !== 0) sbm.rpc('my_takedown_requests').then(function (r) {
          var open = (r && !r.error && r.data || []).filter(function (t) { return t.status === 'open'; });
          var main = document.querySelector('main');
          if (!open.length || !main) return;
          var due = open.map(function (t) { return t.due_on; }).filter(Boolean).sort()[0];
          var dp = due ? String(due).split('-') : null;
          main.insertBefore(el('div', { class: 'wrap' }, el('div', { class: 'notice notice--warn', role: 'status' }, [
            el('strong', { text: 'あなたの作品に削除の申し立てが ' + open.length + '件 届いています。' }),
            document.createTextNode(' その作品は運営が判断するまで一時非公開です' + (dp ? '（判断の目安：' + (+dp[1]) + '/' + (+dp[2]) + ' まで）' : '') + '。言い分があれば '),
            el('a', { href: '/mypage/portfolio.html', text: 'ポートフォリオ管理' }),
            document.createTextNode(' から書いてください。')
          ])), main.firstChild);
        });
        // 鍵付きページのパスワードを前のしくみで保存している人に、設定し直しをお願いする（10/31 タキさん）
        //   新しいしくみでは本人が「見る」で確かめられる。同じパスワードを入れ直せば、前に渡した相手もそのまま開ける
        if (sbm && location.pathname.indexOf('/mypage/stock') !== 0) sbm.rpc('my_stock_pw_viewable').then(function (r) {
          var old = (r && !r.error && r.data || []).filter(function (x) { return !x.viewable; });
          var main = document.querySelector('main');
          if (!old.length || !main) return;
          main.insertBefore(el('div', { class: 'wrap' }, el('div', { class: 'notice notice--warn', role: 'status' }, [
            el('strong', { text: '誠に申し訳ございません。Eizo Maps のアップデートに伴い、鍵付きページのパスワードの再設定をお願いします（' + old.length + 'ページ）。' }),
            document.createTextNode(' 設定し直すと、パスワードをいつでも「見る」で確かめられるようになります。今と同じパスワードを入れ直しても大丈夫です（その場合、前にパスワードを渡した相手もそのまま開けます）。'),
            el('p', { class: 'notice__act' }, el('a', { class: 'btn btn--sm btn--primary', href: '/mypage/stock.html?p=' + old[0].page_id, text: 'パスワードを設定し直す' }))
          ])), main.firstChild);
        });
        var staffSlot = el('li');
        ul.appendChild(staffSlot);
        EM.roles().then(function (roles) {
          if (roles.admin) staffSlot.appendChild(el('a', { href: '/admin/', text: '管理画面' }));
        });
        ul.appendChild(el('li', null, el('a', {
          href: '#', text: 'ログアウト',
          onclick: function (e) { e.preventDefault(); EM.signOut(); }
        })));
        slot.appendChild(el('hr'));
        slot.appendChild(ul);
        slot.appendChild(el('p', { class: 'nav-meta', text: u.email || '' }));
      } else {
        ul.appendChild(el('li', null, el('a', { href: '/auth/', text: 'ログイン / 新規登録' })));
        slot.appendChild(el('hr'));
        slot.appendChild(ul);
      }
    });

    // フッター
    var fcols = el('div', { class: 'cols' });
    fcols.appendChild(el('div', null, [
      el('a', { href: '/', class: 'logo', 'aria-label': 'Eizo Maps' }, [el('span', { text: 'Eizo' }), el('b', { text: 'Maps' })]),
      el('p', { class: 'small f-note' }, [
        // 言葉の途中で折り返さないように、2つのまとまりに分けておく
        el('span', { text: 'クリエイターとクライアントを対等につなぐ、' }),
        el('span', { text: '映像制作の信頼プラットフォーム。' })
      ])
    ]));
    var fl = el('ul');
    NAV_PUBLIC.concat(NAV_FOOT).forEach(function (n) { fl.appendChild(el('li', null, el('a', { href: n[0], text: n[1] }))); });
    fcols.appendChild(fl);
    fcols.appendChild(el('ul', null, [
      el('li', null, el('a', { href: 'mailto:' + (cfg.CONTACT_EMAIL || ''), class: 'mono', text: cfg.CONTACT_EMAIL || '' }))
    ]));

    document.body.appendChild(el('footer', { class: 'site-footer' }, [
      el('div', { class: 'wrap' }, [
        fcols,
        el('p', { class: 'copy', text: '© ' + new Date().getFullYear() + ' Eizo Maps — Atreyu' })
      ])
    ]));

    if (!EM.configured()) {
      var warn = el('div', { class: 'wrap setup-warn' }, [
        el('div', { class: 'notice notice--error', text: 'Supabase の接続設定が未入力です。assets/js/config.js に Project URL と anon key を設定してください。' })
      ]);
      var main = document.querySelector('main');
      if (main) main.insertBefore(warn, main.firstChild);
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.body.hasAttribute('data-no-chrome')) EM.mountChrome();
    EM.checkAccount();
  });

  /* ---------- 退会の手続き中かどうか／また登録した人に前の評価をつなぐ（2026-11-15） ----------
     ・退会の手続き中（30日以内）の人は、どの画面を開いても「元に戻しますか？」の画面へ
     ・ログインしたら1回だけ、前のアカウント（退会して30日たったもの）の評価をつなぐ */
  EM.checkAccount = function () {
    var sb = EM.sb();
    if (!sb) return;
    EM.getUser().then(function (u) {
      if (!u) return;
      sb.rpc('my_withdrawal').then(function (r) {
        if (r && r.data && location.pathname.indexOf('/account/delete/') !== 0) {
          location.replace('/account/delete/');
        }
      });
      var key = 'em_relinked_' + u.id;
      var done = false;
      try { done = sessionStorage.getItem(key) === '1'; } catch (e) {}
      if (done) return;
      sb.rpc('relink_my_reviews').then(function (r) {
        try { sessionStorage.setItem(key, '1'); } catch (e) {}
        if (r && r.data > 0 && EM.toast) EM.toast('前のアカウントの評価（' + r.data + '件）をつなぎました');
      });
    });
  };

  global.EM = EM;
})(window);
