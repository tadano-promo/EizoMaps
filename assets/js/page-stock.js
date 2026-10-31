/* Eizo Maps — ストックページの編集
   パスワードは列として書かない。必ず RPC（set_stock_password）を通す。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    var creator = null;   // { id, display_name, contact_pref, contact_dm_url }
    var page = null;      // stock_pages の1行（password_hash は含まない）
    var pages = [];       // 自分のページ（5つまで）
    var MAX_PAGES = 5;
    var shares = [];      // このページを渡した相手（my_stock_page_shares）
    var contentOk = false; // 渡し済みのページの中身を変えてよいと確かめたか
    var pwViewable = true; // パスワードを「見る」で出せる形で保存しているか
    var hideTimer = null;
    var items = [];
    var links = [];
    var addKind = 'video';
    var videoSrc = 'library';   // 'library'（作品棚から選ぶ） | 'new'（新しい URL）
    var library = [];           // 作品棚（portfolios）
    var bar = null;             // 画面下の「保存」バー（ページの中の入力を1回でまとめて保存する）
    var contactDirty = false;   // 依頼の受け取り方を変えたか
    var dirtyItems = {};        // 中身を直したブロック（id → ブロック）

    // 冒頭あいさつのひな形（クリエイターが自由に書き換え・削除できる）
    var INTRO_TEMPLATE = 'ご覧いただき誠にありがとうございます。本ページはパスワード付きのポートフォリオページです。掲載作品には守秘義務があるため、外部への共有・転載はご遠慮ください。\nまた、パスワードは定期的に変更する場合がございます。あらかじめご了承ください。';

    var PAGE_COLS = 'id,creator_id,slug,title,intro,password_updated_at,is_active,view_count,created_at,updated_at';
    var ITEM_COLS = 'id,kind,title,description,provider,video_id,url,thumbnail_url,width,sort_order,created_at,portfolio_id,' +
                    'portfolios(id,title,description,provider,video_id,video_url,thumbnail_url,visibility)';
    var VIS_LABEL = { 'public': '誰でも見られる', 'link_only': '限定リンクのみ', 'stock_only': 'パスワードページだけ' };

    var KINDS = [
      ['video',   '動画'],
      ['doc',     '資料'],
      ['link',    'リンク'],
      ['note',    'テキスト'],
      ['heading', '見出し']
    ];

    EM.requireUser().then(function (u) {
      if (!u) return;
      return sb.from('creators')
        .select('id,display_name,contact_pref,contact_dm_url')
        .eq('user_id', u.id).maybeSingle();
    }).then(function (r) {
      if (!r) return;
      if (r.error) throw r.error;
      if (!r.data) {
        EM.notice(msg, 'さきにクリエイタープロフィールを作成してください。', 'error');
        EM.$('#createSection').hidden = true;
        EM.$('#editSection').hidden = true;
        EM.$('.doc').appendChild(el('div', { class: 'empty' },
          el('a', { class: 'btn', href: '/mypage/', text: 'プロフィールを作成する' })));
        return;
      }
      creator = r.data;
      return loadPage();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function loadPage() {
      return sb.from('stock_pages').select(PAGE_COLS)
        .eq('creator_id', creator.id).order('created_at')
        .then(function (r) {
          if (r.error) throw r.error;
          pages = r.data || [];
          var want = EM.param('p');
          page = pages.filter(function (x) { return x.id === want; })[0] || pages[0] || null;
          renderTabs();
          if (!page) {
            EM.$('#createSection').hidden = false;
            EM.$('#editSection').hidden = true;
            return;
          }
          EM.$('#createSection').hidden = true;
          EM.$('#editSection').hidden = false;
          fillPageForm();
          fillContactForm();
          mountSaveBar();
          if (EM.param('made')) EM.notice(msg, 'ページを作りました。次にパスワードを設定してください。', 'ok');
          return Promise.all([loadItems(), loadLinks(), loadLibrary(), loadShares(), loadViewable()]);
        });
    }

    /* ---------------- ページの切りかえ（5つまで） ---------------- */
    function renderTabs() {
      var box = EM.$('#pageTabs');
      EM.clear(box);
      box.hidden = !pages.length;
      if (!pages.length) return;
      pages.forEach(function (x) {
        box.appendChild(el('a', {
          class: 'chip stock-tab', href: '/mypage/stock.html?p=' + x.id,
          'aria-pressed': page && x.id === page.id ? 'true' : 'false'
        }, [
          el('span', { text: x.title }),
          el('span', { class: 'stock-tab__state', text: x.is_active ? '公開中' : '非公開' })
        ]));
      });
      if (pages.length < MAX_PAGES) {
        box.appendChild(el('button', { class: 'chip stock-tab stock-tab--new', type: 'button',
          text: '＋ 新しいページ（あと' + (MAX_PAGES - pages.length) + 'つ）', onclick: showCreate }));
      } else {
        box.appendChild(el('p', { class: 'small muted stock-tabs__full' }, [
          '鍵付きページは5つまでです。もっと必要なときは ',
          el('a', { href: '/contact/', text: 'お問い合わせ' }),
          ' から教えてください。'
        ]));
      }
    }

    function showCreate() {
      EM.$('#createSection').hidden = false;
      EM.$('#editSection').hidden = true;
      EM.$('#createCancelBtn').hidden = !pages.length;
      EM.$('#newSlug').focus();
    }
    EM.$('#createCancelBtn').addEventListener('click', function () {
      EM.$('#createSection').hidden = true;
      EM.$('#editSection').hidden = !page;
    });

    /* ---------------- このページを渡した相手 ---------------- */
    function loadShares() {
      return sb.rpc('my_stock_page_shares', { p_page_id: page.id }).then(function (r) {
        shares = (r && !r.error && r.data) || [];
        renderShares();
      });
    }
    function validShares() { return shares.filter(function (x) { return x.still_valid; }); }
    function renderShares() {
      var box = EM.$('#sharesBox'), warn = EM.$('#contentShareWarn');
      EM.clear(box); EM.clear(warn);
      box.hidden = !shares.length;
      var v = validShares();
      warn.hidden = !v.length;
      if (!shares.length) return;
      box.appendChild(el('p', { class: 'small', text: 'このページを渡した人（' + shares.length + '人）' }));
      var ul = el('ul', { class: 'small stock-shares__list' });
      shares.forEach(function (x) {
        ul.appendChild(el('li', null, [
          x.recipient_name + '（' + EM.date(x.given_at) + '）',
          x.still_valid ? null : el('span', { class: 'muted', text: '　パスワードを変えたので、もう開けません' })
        ]));
      });
      box.appendChild(ul);
      if (v.length) {
        warn.appendChild(el('p', { text: 'このページは ' + shareNames(v) + ' に渡しています。中身を変えると、パスワードを知っている人には新しい中身が見えます。別の会社に見せたいときは、新しいページを作るか、パスワードを変えてください。' }));
        var acts = el('p', { class: 'page-links' });
        if (pages.length < MAX_PAGES) acts.appendChild(el('button', { class: 'btn btn--sm', type: 'button', text: '新しいページを作る', onclick: showCreate }));
        acts.appendChild(el('button', { class: 'btn btn--sm', type: 'button', text: 'パスワードも変える', onclick: function () {
          EM.$('#pwChangeBtn').click();
          EM.$('#newPassword').scrollIntoView({ block: 'center' });
        } }));
        warn.appendChild(acts);
      }
    }
    function shareNames(list) {
      var names = list.slice(0, 3).map(function (x) { return x.recipient_name + 'さん（' + EM.date(x.given_at) + '）'; });
      return names.join('、') + (list.length > 3 ? ' ほか' + (list.length - 3) + '人' : '');
    }
    // 渡し済みのページの中身を変える前に、一度だけ確かめる
    function okToChangeContent() {
      var v = validShares();
      if (!v.length || contentOk) return true;
      var yes = confirm('このページは ' + shareNames(v) + ' に渡しています。\n中身を変えると、パスワードを知っている人には新しい中身が見えます。\n\n別の会社に見せるためなら「キャンセル」を押して、新しいページを作るか、パスワードを変えてください。\nこのまま変えますか？');
      if (yes) contentOk = true;
      return yes;
    }

    /* ---------------- パスワードを見る（ログイン中の本人だけ・30秒で隠す） ---------------- */
    function loadViewable() {
      return sb.rpc('my_stock_pw_viewable').then(function (r) {
        var row = ((r && r.data) || []).filter(function (x) { return x.page_id === page.id; })[0];
        pwViewable = !!(row && row.viewable);
      });
    }
    function hidePw() {
      clearTimeout(hideTimer);
      EM.$('#pwShown').textContent = '●●●●●●●●';
      EM.$('#pwRevealBtn').textContent = '見る';
      EM.$('#pwRevealCopyBtn').hidden = true;
      EM.$('#pwRevealCopyBtn').dataset.v = '';
    }
    EM.$('#pwRevealBtn').addEventListener('click', function () {
      if (EM.$('#pwRevealCopyBtn').dataset.v) { hidePw(); return; }
      var note = EM.$('#pwRevealNote');
      if (!pwViewable) {
        note.hidden = false;
        note.textContent = '前のしくみで保存したパスワードなので、表示できません。「パスワードを変える」で設定し直すと、次から見られます。';
        return;
      }
      var btn = this; btn.setAttribute('aria-busy', 'true');
      sb.rpc('reveal_stock_password', { p_page_id: page.id }).then(function (r) {
        btn.removeAttribute('aria-busy');
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        if (!r.data) { pwViewable = false; btn.click(); return; }
        note.hidden = true;
        EM.$('#pwShown').textContent = r.data;
        btn.textContent = '隠す';
        var cp = EM.$('#pwRevealCopyBtn'); cp.hidden = false; cp.dataset.v = r.data;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hidePw, 30000);
      });
    });
    EM.$('#pwRevealCopyBtn').addEventListener('click', function () {
      var v = this.dataset.v;
      if (!v) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(function () { EM.toast('パスワードをコピーしました'); }, function () { EM.toast(v); });
      } else { EM.toast(v); }
    });

    /* ---------------- 使い回すときの注意（閉じた状態を覚える） ---------------- */
    (function initReuseWarn() {
      var KEY = 'em_stock_reuse_warn_closed', closed = false;
      try { closed = localStorage.getItem(KEY) === '1'; } catch (e) {}
      function apply() {
        EM.$('#reuseWarnBody').hidden = closed;
        EM.$('#reuseWarnToggle').textContent = closed ? '開く' : '閉じる';
        EM.$('#reuseWarnToggle').setAttribute('aria-expanded', closed ? 'false' : 'true');
      }
      EM.$('#reuseWarnToggle').addEventListener('click', function () {
        closed = !closed;
        try { localStorage.setItem(KEY, closed ? '1' : '0'); } catch (e) {}
        apply();
      });
      apply();
    })();

    function loadItems() {
      return sb.from('stock_items').select(ITEM_COLS)
        .eq('page_id', page.id).order('sort_order').order('created_at')
        .then(function (r) {
          if (r.error) throw r.error;
          var prev = {};
          items.forEach(function (o) { prev[o.id] = o; });
          items = (r.data || []).map(function (it) {
            // 作品棚の作品は、作品棚の内容を表示に使う
            var p = it.portfolios;
            if (p) {
              it.pf = p;
              it.title = p.title; it.description = p.description;
              it.provider = p.provider; it.video_id = p.video_id;
              it.url = p.video_url; it.thumbnail_url = p.thumbnail_url;
            }
            // 読み込み直しても、書きかけ（まだ保存していない内容）は引き継ぐ
            var o = prev[it.id];
            if (o && (o._dt !== undefined || o._dd !== undefined)) {
              it._dt = o._dt; it._dd = o._dd;
              if (dirtyItems[it.id]) dirtyItems[it.id] = it;
            }
            return it;
          });
          // 外したブロックは、保存する対象からも外す
          Object.keys(dirtyItems).forEach(function (id) { if (!prev[id] || !items.some(function (x) { return x.id === id; })) delete dirtyItems[id]; });
          renderItems();
          renderLibrary();
        });
    }

    function loadLibrary() {
      return sb.from('portfolios')
        .select('id,title,provider,video_id,video_url,thumbnail_url,visibility,sort_order,created_at')
        .eq('creator_id', creator.id).order('sort_order').order('created_at', { ascending: false })
        .then(function (r) {
          if (r.error) throw r.error;
          library = r.data || [];
          renderLibrary();
        });
    }

    function onPage(pid) {
      return items.some(function (it) { return it.portfolio_id === pid; });
    }

    function renderLibrary() {
      var box = EM.$('#libPicker');
      if (!box) return;
      EM.clear(box);
      var free = library.filter(function (p) { return !onPage(p.id); });
      if (!library.length) {
        box.appendChild(el('p', { class: 'small muted', text: '作品棚にまだ作品がありません。「新しい URL を貼る」から追加するか、ポートフォリオ管理で登録してください。' }));
        return;
      }
      if (!free.length) {
        box.appendChild(el('p', { class: 'small muted', text: '作品棚の作品は、すべてこのページに並んでいます。' }));
        return;
      }
      free.forEach(function (p) {
        box.appendChild(el('button', {
          class: 'lib-pick', type: 'button',
          onclick: function () { addFromLibrary(p, this); }
        }, [
          el('div', { class: 'thumb' }, p.thumbnail_url ? EM.thumbImg(p.thumbnail_url, '') : null),
          el('div', null, [
            el('div', { class: 'lib-pick__title', text: p.title }),
            el('div', { class: 'lib-pick__meta', text: (EM.PROVIDER_LABEL[p.provider] || p.provider) + ' ・ ' + (VIS_LABEL[p.visibility] || p.visibility) })
          ])
        ]));
      });
    }

    function addFromLibrary(p, btn) {
      if (!okToChangeContent()) return;
      if (btn) btn.setAttribute('aria-busy', 'true');
      sb.from('stock_items').insert({
        page_id: page.id, kind: 'video', portfolio_id: p.id, width: 'full', sort_order: items.length
      }).then(function (r) {
        if (r.error) throw r.error;
        EM.toast('「' + p.title + '」を並べました');
        EM.notice(msg, '');
        return loadItems();
      }).catch(function (err) {
        if (btn) btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    }

    function loadLinks() {
      return sb.from('creator_links').select('id,platform,url,label,sort_order,created_at')
        .eq('creator_id', creator.id).order('sort_order').order('created_at')
        .then(function (r) {
          if (r.error) throw r.error;
          links = r.data || [];
          renderLinks();
        });
    }

    /* ---------------- ページの作成 ---------------- */
    function normalizeSlug(v) {
      return String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    }
    function validSlug(v) { return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(v); }
    function publicUrlFor(slug) {
      return (EM.config.SITE_ORIGIN || location.origin) + '/s/?u=' + encodeURIComponent(slug);
    }

    EM.$('#newSlug').addEventListener('input', function (e) {
      e.target.value = normalizeSlug(e.target.value);
      EM.$('#slugPreview').textContent = e.target.value
        ? '公開URL: ' + publicUrlFor(e.target.value) : '';
    });

    EM.$('#createForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var slug = normalizeSlug(EM.$('#newSlug').value);
      var title = EM.$('#newTitle').value.trim();
      if (!validSlug(slug)) { EM.notice(msg, 'URL は半角英小文字・数字・ハイフンで3〜32文字にしてください。', 'error'); return; }
      if (!title) { EM.notice(msg, 'タイトルを入力してください。', 'error'); return; }
      var btn = EM.$('#createBtn'); btn.setAttribute('aria-busy', 'true');
      sb.from('stock_pages').insert({
        creator_id: creator.id, slug: slug, title: title, intro: INTRO_TEMPLATE, is_active: false
      }).select(PAGE_COLS).single().then(function (r) {
        if (r.error) throw r.error;
        if (pages.length) { location.href = '/mypage/stock.html?p=' + r.data.id + '&made=1'; return; }
        EM.notice(msg, 'ページを作りました。次にパスワードを設定してください。', 'ok');
        return loadPage();
      }).catch(function (err) {
        var m = String(err.message || '');
        EM.notice(msg, m.indexOf('duplicate key') !== -1
          ? 'この URL はすでに使われています。別の文字列にしてください。'
          : EM.errorText(err), 'error');
      }).then(function () { btn.removeAttribute('aria-busy'); });
    });

    EM.$('#introTemplateBtn').addEventListener('click', function () {
      var box = EM.$('#intro');
      box.value = box.value.trim() ? box.value.trim() + '\n\n' + INTRO_TEMPLATE : INTRO_TEMPLATE;
      EM.$('#introTemplateBtn').hidden = true;
      if (bar) bar.markDirty();
      EM.toast('ひな形を入れました。「保存する」で反映されます');
    });

    /* ---------------- 公開の設定 ---------------- */
    function fillPageForm() {
      EM.$('#slug').value = page.slug;
      EM.$('#title').value = page.title;
      EM.$('#intro').value = page.intro || '';
      EM.$('#introTemplateBtn').hidden = !!(page.intro && page.intro.trim());
      EM.$('#isActive').checked = !!page.is_active;
      EM.$('#publicUrl').textContent = publicUrlFor(page.slug).replace(/^https?:\/\//, '');
      EM.$('#openPageLink').href = publicUrlFor(page.slug);
      EM.$('#slugEdit').hidden = true;
      EM.$('#slugEditBtn').hidden = false;
      EM.$('#viewCount').textContent = '開かれた回数: ' + (page.view_count || 0) + ' 回';
      // パスワード：設定済みなら「設定済み」だけを見せ、入力欄は「変える」を押したときだけ開く
      var hasPw = !!page.password_updated_at;
      EM.$('#pwSummary').hidden = !hasPw;
      EM.$('#pwForm').hidden = hasPw;
      EM.$('#pwCancelBtn').hidden = true;
      EM.$('#pwSumWhen').textContent = hasPw ? '最終変更 ' + EM.datetime(page.password_updated_at) : '';
      hidePw();
      EM.$('#pwRevealNote').hidden = true;
      EM.$('#pwState').textContent = hasPw ? ''
        : 'パスワードがまだ設定されていません。自動で作った案を入れてあります。そのままでも、書き換えても大丈夫です。保存すると設定されます。';
      EM.$('#pwState').hidden = hasPw;
      EM.$('#pwLabel').firstChild.textContent = hasPw ? '新しいパスワード ' : 'パスワード ';
      EM.$('#newPassword').placeholder = '6文字以上';
    }

    /* ---------------- まとめて保存（画面下のバー） ---------------- */
    function mountSaveBar() {
      if (bar) { bar.reset(page.updated_at); return; }
      bar = EM.saveBar({
        watch: [EM.$('#pageForm'), EM.$('#pwForm'), EM.$('#contactForm'), EM.$('#itemList')],
        savedAt: page.updated_at,
        onSave: saveAll
      });
      EM.$('#contactForm').addEventListener('input', function () { contactDirty = true; });
      EM.$('#contactForm').addEventListener('change', function () { contactDirty = true; });
      // パスワードがまだ無いページには、最初からランダムな案を入れておく
      if (!page.password_updated_at && !EM.$('#newPassword').value) {
        EM.$('#newPassword').value = EM.randomPassword();
        bar.markDirty();
      }
    }

    function saveAll() {
      var slug = normalizeSlug(EM.$('#slug').value);
      var title = EM.$('#title').value.trim();
      var active = EM.$('#isActive').checked;
      var pw = EM.$('#newPassword').value;
      if (!validSlug(slug)) { EM.notice(msg, 'URL は半角英小文字・数字・ハイフンで3〜32文字にしてください。', 'error'); return false; }
      if (!title) { EM.notice(msg, 'タイトルを入力してください。', 'error'); return false; }
      if (pw && pw.length < 6) { EM.notice(msg, 'パスワードは6文字以上にしてください。', 'error'); return false; }
      if (active && !page.password_updated_at && !pw) {
        EM.notice(msg, 'パスワードを入れてから公開してください。', 'error');
        return false;
      }
      var pref = EM.$('#contactPref').value;
      var dm = EM.$('#contactDmUrl').value.trim();
      if (contactDirty && pref !== 'form') {
        if (!dm) { EM.notice(msg, 'DM の宛先 URL を入力してください。', 'error'); return false; }
        if (!EM.safeUrl(dm)) { EM.notice(msg, 'DM の宛先は https:// から始まる URL にしてください。', 'error'); return false; }
      }
      // 直したブロックの中身を確かめる
      var patches = [];
      for (var id in dirtyItems) {
        var it = dirtyItems[id], card = EM.$('[data-item="' + id + '"]');
        if (!card) continue;
        var patch = {};
        var t = card.querySelector('[data-f="title"]'), d = card.querySelector('[data-f="description"]');
        if (t) patch.title = t.value.trim() || null;
        if (d) patch.description = d.value.trim() || null;
        if (it.kind === 'heading' && !patch.title) { EM.notice(msg, '見出しの文字は空にできません。', 'error'); return false; }
        if (it.kind === 'note' && !patch.description) { EM.notice(msg, '本文は空にできません。', 'error'); return false; }
        if (it.pf && !patch.title) { EM.notice(msg, '作品のタイトルは空にできません。', 'error'); return false; }
        patches.push({ it: it, patch: patch });
      }

      if (pw && page.password_updated_at && validShares().length) {
        var vs = validShares();
        if (!confirm('このページを渡した人が' + vs.length + '人います（' + shareNames(vs) + '）。\nパスワードを変えると、その人たちは開けなくなります。\n\n変えますか？')) return false;
      }
      var chain = pw
        ? sb.rpc('set_stock_page_password', { p_page_id: page.id, p_password: pw }).then(function (r) { if (r.error) throw r.error; })
        : Promise.resolve();
      return chain.then(function () {
        return sb.from('stock_pages').update({
          slug: slug, title: title, intro: EM.$('#intro').value.trim() || null, is_active: active
        }).eq('id', page.id).select(PAGE_COLS).single();
      }).then(function (r) {
        if (r.error) throw r.error;
        page = r.data;
        if (!contactDirty) return null;
        return sb.from('creators').update({
          contact_pref: pref, contact_dm_url: pref === 'form' ? null : dm
        }).eq('id', creator.id).select('id,display_name,contact_pref,contact_dm_url').single()
          .then(function (rc) { if (rc.error) throw rc.error; creator = rc.data; });
      }).then(function () {
        return Promise.all(patches.map(function (x) {
          var q = x.it.pf
            ? sb.from('portfolios').update(x.patch).eq('id', x.it.pf.id)   // 作品棚と共通
            : sb.from('stock_items').update(x.patch).eq('id', x.it.id);
          return q.then(function (r) {
            if (r.error) throw r.error;
            if (x.patch.title !== undefined) x.it.title = x.patch.title;
            if (x.patch.description !== undefined) x.it.description = x.patch.description;
            delete x.it._dt; delete x.it._dd;
          });
        }));
      }).then(function () {
        var pwChanged = !!EM.$('#newPassword').value;
        EM.$('#newPassword').value = '';
        contactDirty = false;
        dirtyItems = {};
        fillPageForm();
        pages = pages.map(function (x) { return x.id === page.id ? page : x; });
        renderTabs();
        if (pwChanged) { pwViewable = true; loadShares(); }
        EM.notice(msg, '');
        return page.updated_at;
      }).catch(function (err) {
        var m = String(err.message || '');
        EM.notice(msg, m.indexOf('duplicate key') !== -1
          ? 'この URL はすでに使われています。別の文字列にしてください。' : EM.errorText(err), 'error');
        throw err;
      });
    }

    EM.$('#slug').addEventListener('input', function (e) {
      e.target.value = normalizeSlug(e.target.value);
      EM.$('#publicUrl').textContent = publicUrlFor(e.target.value).replace(/^https?:\/\//, '');
    });
    EM.$('#slugEditBtn').addEventListener('click', function () {
      EM.$('#slugEdit').hidden = false;
      this.hidden = true;
      EM.$('#slug').focus();
    });
    EM.$('#pwChangeBtn').addEventListener('click', function () {
      EM.$('#pwSummary').hidden = true;
      EM.$('#pwForm').hidden = false;
      EM.$('#pwCancelBtn').hidden = false;
      EM.$('#newPassword').value = EM.randomPassword();
      if (bar) bar.markDirty();
      EM.$('#newPassword').focus();
      EM.$('#newPassword').select();
    });
    EM.$('#pwCancelBtn').addEventListener('click', function () {
      EM.$('#newPassword').value = '';
      EM.$('#pwSummary').hidden = false;
      EM.$('#pwForm').hidden = true;
      this.hidden = true;
    });

    // Enter キーで送信されたときも、画面下のバーで保存する
    EM.$('#pageForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (bar) bar.save().catch(function () {});
    });

    EM.$('#copyUrlBtn').addEventListener('click', function () {
      var url = publicUrlFor(EM.$('#slug').value);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { EM.toast('URL をコピーしました'); },
          function () { EM.toast(url); });
      } else { EM.toast(url); }
    });

    /* ---------------- パスワード ----------------
       ランダムに作ることも、自分で決めることもできる。保存は画面下のバーで、ほかの項目とまとめて行う。 */
    EM.$('#genPwBtn').addEventListener('click', function () {
      EM.$('#newPassword').value = EM.randomPassword();
      if (bar) bar.markDirty();
      EM.toast('パスワードを作りました。保存すると設定されます');
    });
    EM.$('#copyPwBtn').addEventListener('click', function () {
      var v = EM.$('#newPassword').value;
      if (!v) { EM.toast('コピーするパスワードがありません。「ランダムに作る」か、入力してください'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(function () { EM.toast('パスワードをコピーしました'); },
          function () { EM.toast(v); });
      } else { EM.toast(v); }
    });

    /* ---------------- 依頼の受け取り方 ---------------- */
    function fillContactForm() {
      var sel = EM.$('#contactPref');
      EM.clear(sel);
      EM.CONTACT_PREFS.forEach(function (c) {
        sel.appendChild(el('option', { value: c[0], text: c[1] }));
      });
      sel.value = creator.contact_pref || 'form';
      EM.$('#contactDmUrl').value = creator.contact_dm_url || '';
      toggleDmField();
      sel.addEventListener('change', toggleDmField);
    }
    function toggleDmField() {
      var v = EM.$('#contactPref').value;
      EM.$('#dmField').hidden = (v === 'form');
    }

    EM.$('#contactForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (bar) bar.save().catch(function () {});
    });

    /* ---------------- SNS・外部リンク ---------------- */
    (function initLinkForm() {
      var sel = EM.$('#linkPlatform');
      EM.LINK_PLATFORMS.forEach(function (p) {
        sel.appendChild(el('option', { value: p[0], text: p[1] }));
      });
      EM.$('#linkUrl').addEventListener('input', function (e) {
        var g = EM.guessPlatform(e.target.value);
        if (g) sel.value = g;
      });
    })();

    EM.$('#linkForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var url = EM.safeUrl(EM.$('#linkUrl').value.trim());
      if (!url) { EM.notice(msg, 'リンクは https:// から始まる URL にしてください。', 'error'); return; }
      sb.from('creator_links').insert({
        creator_id: creator.id,
        platform: EM.$('#linkPlatform').value,
        url: url,
        label: EM.$('#linkLabel').value.trim() || null,
        sort_order: links.length
      }).then(function (r) {
        if (r.error) throw r.error;
        EM.$('#linkUrl').value = '';
        EM.$('#linkLabel').value = '';
        EM.notice(msg, '');
        return loadLinks();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    });

    function renderLinks() {
      var box = EM.$('#linkList');
      EM.clear(box);
      if (!links.length) {
        box.appendChild(el('p', { class: 'small muted', text: 'まだリンクがありません。' }));
        return;
      }
      links.forEach(function (l, idx) {
        box.appendChild(el('div', { class: 'row-item' }, [
          el('div', { class: 'row-item__main' }, [
            el('span', { class: 'tag', text: EM.platformLabel(l.platform) }),
            el('span', { class: 'row-item__title', text: l.label || l.url })
          ]),
          el('div', { class: 'row-item__ops' }, [
            el('button', { class: 'btn btn--sm', type: 'button', text: '↑', 'aria-label': '上へ',
              disabled: idx === 0, onclick: function () { moveLink(idx, -1); } }),
            el('button', { class: 'btn btn--sm', type: 'button', text: '↓', 'aria-label': '下へ',
              disabled: idx === links.length - 1, onclick: function () { moveLink(idx, 1); } }),
            el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '削除',
              onclick: function () { removeLink(l); } })
          ])
        ]));
      });
    }

    function moveLink(idx, dir) {
      var j = idx + dir;
      if (j < 0 || j >= links.length) return;
      var tmp = links[idx]; links[idx] = links[j]; links[j] = tmp;
      renderLinks();
      persistOrder('creator_links', links);
    }

    function removeLink(l) {
      if (!confirm('このリンクを削除しますか？')) return;
      sb.from('creator_links').delete().eq('id', l.id).then(function (r) {
        if (r.error) throw r.error;
        return loadLinks();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    /* 並び順の保存。値が変わった行だけ送る。 */
    function persistOrder(table, arr) {
      var jobs = [];
      arr.forEach(function (row, i) {
        if (row.sort_order !== i) {
          row.sort_order = i;
          jobs.push(sb.from(table).update({ sort_order: i }).eq('id', row.id));
        }
      });
      if (!jobs.length) return Promise.resolve();
      return Promise.all(jobs).then(function (res) {
        for (var i = 0; i < res.length; i++) if (res[i].error) throw res[i].error;
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    /* ---------------- ブロックの追加 ---------------- */
    (function initKindChips() {
      var box = EM.$('#kindChips');
      KINDS.forEach(function (k) {
        box.appendChild(el('button', {
          class: 'chip', type: 'button', text: k[1],
          'aria-pressed': k[0] === addKind ? 'true' : 'false',
          onclick: function () {
            addKind = k[0];
            EM.$$('#kindChips .chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
            this.setAttribute('aria-pressed', 'true');
            syncAddForm();
          }
        }));
      });
      syncAddForm();
    })();

    EM.$$('#videoSrcChips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        videoSrc = c.getAttribute('data-src');
        EM.$$('#videoSrcChips .chip').forEach(function (x) {
          x.setAttribute('aria-pressed', x === c ? 'true' : 'false');
        });
        syncAddForm();
      });
    });

    function syncAddForm() {
      var isVideo = addKind === 'video';
      var fromLib = isVideo && videoSrc === 'library';
      EM.$('#videoSrcBox').hidden = !isVideo;
      EM.$('#libBox').hidden = !fromLib;
      EM.$('#newVideoNote').hidden = !(isVideo && !fromLib);
      EM.$('#addActions').hidden = fromLib;
      if (fromLib) {
        EM.$('#addUrlField').hidden = true;
        EM.$('#addTitleField').hidden = true;
        EM.$('#addDescField').hidden = true;
        return;
      }
      var needUrl = (addKind === 'video' || addKind === 'doc' || addKind === 'link');
      EM.$('#addUrlField').hidden = !needUrl;
      EM.$('#addTitleField').hidden = (addKind === 'note');
      EM.$('#addDescField').hidden = (addKind === 'heading');
      var label = EM.$('#addUrlLabel'), hint = EM.$('#addUrlHint'), input = EM.$('#addUrl');
      if (addKind === 'video') {
        label.textContent = '動画の URL';
        input.placeholder = 'https://www.youtube.com/watch?v=...';
        hint.textContent = 'YouTube・Vimeo・TikTok・X・Instagram・Facebook はページの中で再生できます。それ以外のサイト（クライアントのホームページなど）はリンクとして並びます。TikTok は「www.tiktok.com/@…/video/…」の長い方の URL を貼ってください。';
      } else if (addKind === 'doc') {
        label.textContent = '資料の共有 URL';
        input.placeholder = 'https://drive.google.com/...';
        hint.textContent = 'Google ドライブや Dropbox などの共有リンクを貼ってください。閲覧できる相手の設定は各サービス側で行います。';
      } else if (addKind === 'link') {
        label.textContent = 'リンクの URL';
        input.placeholder = 'https://';
        hint.textContent = '';
      }
      EM.$('#addTitleLabel').textContent = (addKind === 'heading') ? '見出しの文字' : 'タイトル';
      EM.$('#addTitleNote').textContent = (addKind === 'heading') ? '（120文字まで・必須）'
        : isVideo ? '（80文字まで・必須）' : '（120文字まで・省略可）';
      EM.$('#addTitle').maxLength = isVideo ? 80 : 120;
      EM.$('#addDesc').maxLength = isVideo ? 1000 : 2000;
    }

    EM.$('#addItemBtn').addEventListener('click', function () {
      if (!okToChangeContent()) return;
      var title = EM.$('#addTitle').value.trim();
      var desc = EM.$('#addDesc').value.trim();
      var url = EM.$('#addUrl').value.trim();
      var row = { page_id: page.id, kind: addKind, width: 'full', sort_order: items.length };

      if (addKind === 'video') {
        var v = EM.parseVideoUrl(url, true);
        if (!v) { EM.notice(msg, 'URL を認識できませんでした。https:// から始まる URL を貼ってください。', 'error'); return; }
        if (!title) { EM.notice(msg, '動画のタイトルを入力してください（作品棚にも同じ名前で登録されます）。', 'error'); return; }
        var btn = this; btn.setAttribute('aria-busy', 'true');
        var newId = null;
        EM.fetchThumbnail(v).then(function (thumb) {
          // 1) 作品棚に「パスワードページだけ」で登録
          return sb.from('portfolios').insert({
            creator_id: creator.id, title: title.slice(0, 80), description: desc ? desc.slice(0, 1000) : null,
            provider: v.provider, video_id: v.video_id, video_url: v.video_url,
            thumbnail_url: thumb || null, visibility: 'stock_only', sort_order: library.length
          }).select('id').single();
        }).then(function (r) {
          if (r.error) throw r.error;
          newId = r.data.id;
          // 2) このページに並べる
          return sb.from('stock_items').insert({
            page_id: page.id, kind: 'video', portfolio_id: newId, width: 'full', sort_order: items.length
          });
        }).then(function (r) {
          if (r.error) throw r.error;
          EM.$('#addUrl').value = ''; EM.$('#addTitle').value = ''; EM.$('#addDesc').value = '';
          EM.notice(msg, '');
          EM.toast('追加しました（作品棚にも登録しました）');
          return Promise.all([loadItems(), loadLibrary()]);
        }).catch(function (err) {
          // 並べるのに失敗したら、作品棚に入れた分も取り消す
          if (newId) sb.from('portfolios').delete().eq('id', newId).then(function () {});
          EM.notice(msg, EM.errorText(err), 'error');
        }).then(function () { btn.removeAttribute('aria-busy'); });
        return;
      }

      if (addKind === 'doc' || addKind === 'link') {
        var safe = EM.safeUrl(url);
        if (!safe) { EM.notice(msg, 'https:// から始まる URL を入力してください。', 'error'); return; }
        row.url = safe; row.title = title || null; row.description = desc || null;
      } else if (addKind === 'note') {
        if (!desc) { EM.notice(msg, '本文を入力してください。', 'error'); return; }
        row.description = desc; row.title = title || null;
      } else if (addKind === 'heading') {
        if (!title) { EM.notice(msg, '見出しの文字を入力してください。', 'error'); return; }
        row.title = title;
      }
      insertItem(row);
    });

    function insertItem(row) {
      return sb.from('stock_items').insert(row).then(function (r) {
        if (r.error) throw r.error;
        EM.$('#addUrl').value = ''; EM.$('#addTitle').value = ''; EM.$('#addDesc').value = '';
        EM.notice(msg, '');
        EM.toast('追加しました');
        return loadItems();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    /* ---------------- ブロックの一覧 ---------------- */
    function kindLabel(k) {
      for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === k) return KINDS[i][1];
      return k;
    }

    function renderItems() {
      var box = EM.$('#itemList');
      EM.clear(box);
      if (!items.length) {
        box.appendChild(el('div', { class: 'empty' },
          el('p', { text: 'まだ何も並んでいません。上のフォームから追加してください。' })));
        return;
      }
      items.forEach(function (it, idx) {
        box.appendChild(itemCard(it, idx));
      });
    }

    function itemCard(it, idx) {
      var badge = el('span', { class: 'tag tag--accent', text: kindLabel(it.kind) });
      var head = el('div', { class: 'row-item__main' }, [
        badge,
        it.provider ? el('span', { class: 'tag', text: (EM.PROVIDER_LABEL[it.provider] || it.provider) }) : null,
        el('span', { class: 'row-item__title', text: it.title || it.url || (it.description || '').slice(0, 40) })
      ]);

      var ops = el('div', { class: 'row-item__ops' }, [
        el('button', { class: 'btn btn--sm', type: 'button', text: '↑', 'aria-label': '上へ',
          disabled: idx === 0, onclick: function () { moveItem(idx, -1); } }),
        el('button', { class: 'btn btn--sm', type: 'button', text: '↓', 'aria-label': '下へ',
          disabled: idx === items.length - 1, onclick: function () { moveItem(idx, 1); } }),
        el('button', { class: 'btn btn--sm', type: 'button',
          text: it.width === 'half' ? '幅: 半分' : '幅: 全体',
          onclick: function () { toggleWidth(it); } }),
        el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: it.pf ? 'ページから外す' : '削除',
          onclick: function () { removeItem(it); } })
      ]);

      var body = el('div', { class: 'stack stock-edit__body' });
      if (it.pf) {
        body.appendChild(el('p', { class: 'stock-shared-note',
          text: '作品棚の作品です（見せ方：' + (VIS_LABEL[it.pf.visibility] || it.pf.visibility) + '）。タイトルと説明は作品棚と共通なので、ここで直すとポートフォリオにも反映されます。' }));
      }
      if (it.kind !== 'note') {
        body.appendChild(el('label', { class: 'field' }, [
          el('span', { class: 'label', text: it.kind === 'heading' ? '見出しの文字' : 'タイトル' }),
          el('input', { type: 'text', maxlength: it.pf ? '80' : '120', value: (it._dt !== undefined ? it._dt : it.title) || '', dataset: { f: 'title' } })
        ]));
      }
      if (it.kind !== 'heading') {
        body.appendChild(el('label', { class: 'field' }, [
          el('span', { class: 'label', text: '説明' }),
          el('textarea', { maxlength: it.pf ? '1000' : '2000', rows: '3', dataset: { f: 'description' } }, (it._dd !== undefined ? it._dd : it.description) || '')
        ]));
      }
      if (it.url) {
        body.appendChild(el('p', { class: 'small muted mono stock-edit__url', text: it.url }));
      }
      var card = el('div', { class: 'card stock-edit', dataset: { item: it.id } }, [
        el('div', { class: 'row-item' }, [head, ops]),
        body
      ]);

      // 直したら「保存していない変更」として覚えておき、画面下のバーでまとめて保存する
      // 並べ替えで画面を描き直しても、書きかけの内容が消えないように控えておく
      body.addEventListener('focusin', function (e) {
        if (e.target.matches('input,textarea') && !okToChangeContent()) e.target.blur();
      });
      body.addEventListener('input', function () {
        dirtyItems[it.id] = it;
        var t = body.querySelector('[data-f="title"]'), d = body.querySelector('[data-f="description"]');
        if (t) it._dt = t.value;
        if (d) it._dd = d.value;
      });

      return card;
    }

    function moveItem(idx, dir) {
      var j = idx + dir;
      if (j < 0 || j >= items.length) return;
      var tmp = items[idx]; items[idx] = items[j]; items[j] = tmp;
      renderItems();
      persistOrder('stock_items', items);
    }

    function toggleWidth(it) {
      var w = it.width === 'half' ? 'full' : 'half';
      sb.from('stock_items').update({ width: w }).eq('id', it.id).then(function (r) {
        if (r.error) throw r.error;
        it.width = w;
        renderItems();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    function removeItem(it) {
      if (!okToChangeContent()) return;
      var q = it.pf
        ? 'このページから外しますか？（作品棚には残ります）'
        : 'このブロックを削除しますか？';
      if (!confirm(q)) return;
      sb.from('stock_items').delete().eq('id', it.id).then(function (r) {
        if (r.error) throw r.error;
        return loadItems();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }
  });
})(window.EM);
