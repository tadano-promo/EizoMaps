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
  EM.avatar = function (url, name, big) {
    var safe = EM.safeUrl(url);
    if (safe) return el('img', { class: 'avatar' + (big ? ' avatar--lg' : ''), src: safe, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    return el('div', { class: 'avatar' + (big ? ' avatar--lg' : ''), 'aria-hidden': 'true' }, EM.initials(name));
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
    ['/creators/', 'クリエイターを探す']
  ];
  var NAV_USER = [
    ['/mypage/', 'マイページ'],
    ['/mypage/portfolio.html', 'ポートフォリオ管理'],
    ['/mypage/stock.html', 'ストックページ'],
    ['/projects/', '案件管理'],
    ['/report/', '問題報告']
  ];
  var NAV_FOOT = [
    ['/terms/', '利用規約'],
    ['/privacy/', 'プライバシーポリシー'],
    ['/legal/', '特定商取引法に基づく表記'],
    ['/contact/', 'お問い合わせ']
  ];

  EM.mountChrome = function () {
    var header = el('header', { class: 'site-header' }, [
      el('div', { class: 'wrap' }, [
        el('a', { href: '/', class: 'logo', 'aria-label': 'Eizo Maps ホーム' }, [
          el('span', { text: 'Eizo' }), el('b', { text: 'Maps' })
        ]),
        el('button', {
          class: 'nav-toggle', type: 'button', id: 'navToggle',
          'aria-expanded': 'false', 'aria-controls': 'navPanel', 'aria-label': 'メニューを開く'
        }, '☰')
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
      el('p', { class: 'small f-note', text: 'クリエイターとクライアントを対等につなぐ、映像制作の信頼プラットフォーム。' })
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
