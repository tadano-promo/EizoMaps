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
      ['Failed to fetch', '通信に失敗しました。ネットワーク環境をご確認ください。']
    ];
    for (var i = 0; i < map.length; i++) if (m.indexOf(map[i][0]) !== -1) return map[i][1];
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
  EM.signOut = function () {
    var sb = EM.sb();
    if (!sb) return Promise.resolve();
    return sb.auth.signOut().then(function () { location.href = '/'; });
  };

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
    draft: '下書き', offered: '依頼中', in_progress: '進行中', delivered: '納品済み',
    paid: '入金済み', closed: '完了', cancelled: 'キャンセル'
  };

  // 次に進めるステータス。DB側のトリガと同じ規則をそのまま持たせている。
  EM.nextStatuses = function (status, role) {
    var out = [];
    if (status === 'draft' && role === 'client') out.push(['offered', '依頼を送る']);
    if (status === 'offered') out.push(['in_progress', '進行中にする']);
    if (status === 'in_progress' && role === 'creator') out.push(['delivered', '納品済みにする']);
    if (status === 'delivered' && role === 'client') out.push(['paid', '入金済みにする']);
    if (status === 'paid') out.push(['closed', '完了にする']);
    if (['draft', 'offered', 'in_progress'].indexOf(status) !== -1) out.push(['cancelled', 'キャンセルする']);
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
    return el('span', { class: 'tag' + (status === 'cancelled' ? '' : ' tag--accent'),
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
    ['/features/', '便利な機能'],
    ['/help/', '使い方・ヘルプ']
  ];
  var NAV_USER = [
    ['/mypage/', 'マイページ'],
    ['/mypage/portfolio.html', 'ポートフォリオ管理'],
    ['/mypage/stock.html', 'ストックページ'],
    ['/schedule/', 'スケジュール'],
    ['/schedule/gantt.html', 'ガントチャート'],
    ['/templates/', '定型文のひな形'],
    ['/projects/', '案件管理'],
    ['/report/', '問題報告']
  ];
  var NAV_FOOT = [
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
    image:    [['rect', 3, 4, 18, 16, 2], ['path', 'M3 16l5-5 4 4 3-3 6 6']]
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
  function mountTools(slot) {
    var menu = el('div', { class: 'qa__menu', role: 'menu', hidden: true }, EM.QUICK_ADD.map(function (q) {
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
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      btn.textContent = open ? '☰' : '✕';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.getAttribute('data-open') === 'true') btn.click();
    });

    // ログイン状態に応じてメニューを差し替える
    EM.getUser().then(function (u) {
      var hl = document.getElementById('headerLogin');
      if (hl && u) { hl.textContent = 'マイページ'; hl.setAttribute('href', '/mypage/'); }
      if (u) mountTools(document.getElementById('headerTools'));
      var slot = document.getElementById('navUserSlot');
      EM.clear(slot);
      var ul = el('ul');
      if (u) {
        NAV_USER.forEach(function (n) { ul.appendChild(el('li', null, el('a', { href: n[0], text: n[1] }))); });
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
  });

  global.EM = EM;
})(window);
