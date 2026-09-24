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
    var items = [];
    var links = [];
    var addKind = 'video';

    var PAGE_COLS = 'id,creator_id,slug,title,intro,password_updated_at,is_active,view_count,created_at,updated_at';
    var ITEM_COLS = 'id,kind,title,description,provider,video_id,url,thumbnail_url,width,sort_order,created_at';

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
        .eq('creator_id', creator.id).maybeSingle()
        .then(function (r) {
          if (r.error) throw r.error;
          page = r.data;
          if (!page) {
            EM.$('#createSection').hidden = false;
            EM.$('#editSection').hidden = true;
            return;
          }
          EM.$('#createSection').hidden = true;
          EM.$('#editSection').hidden = false;
          fillPageForm();
          fillContactForm();
          return Promise.all([loadItems(), loadLinks()]);
        });
    }

    function loadItems() {
      return sb.from('stock_items').select(ITEM_COLS)
        .eq('page_id', page.id).order('sort_order').order('created_at')
        .then(function (r) {
          if (r.error) throw r.error;
          items = r.data || [];
          renderItems();
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
        creator_id: creator.id, slug: slug, title: title, is_active: false
      }).select(PAGE_COLS).single().then(function (r) {
        if (r.error) throw r.error;
        EM.notice(msg, 'ページを作りました。次にパスワードを設定してください。', 'ok');
        return loadPage();
      }).catch(function (err) {
        var m = String(err.message || '');
        EM.notice(msg, m.indexOf('duplicate key') !== -1
          ? 'この URL はすでに使われています。別の文字列にしてください。'
          : EM.errorText(err), 'error');
      }).then(function () { btn.removeAttribute('aria-busy'); });
    });

    /* ---------------- 公開の設定 ---------------- */
    function fillPageForm() {
      EM.$('#slug').value = page.slug;
      EM.$('#title').value = page.title;
      EM.$('#intro').value = page.intro || '';
      EM.$('#isActive').checked = !!page.is_active;
      EM.$('#publicUrl').textContent = '公開URL: ' + publicUrlFor(page.slug);
      EM.$('#openPageLink').href = publicUrlFor(page.slug);
      EM.$('#viewCount').textContent = '開かれた回数: ' + (page.view_count || 0) + ' 回';
      EM.$('#pwState').textContent = page.password_updated_at
        ? 'パスワード設定済み（最終更新: ' + EM.date(page.password_updated_at) + '）'
        : 'パスワードがまだ設定されていません。設定するまでページは公開できません。';
    }

    EM.$('#slug').addEventListener('input', function (e) {
      e.target.value = normalizeSlug(e.target.value);
      EM.$('#publicUrl').textContent = '公開URL: ' + publicUrlFor(e.target.value);
    });

    EM.$('#pageForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var slug = normalizeSlug(EM.$('#slug').value);
      var title = EM.$('#title').value.trim();
      var active = EM.$('#isActive').checked;
      if (!validSlug(slug)) { EM.notice(msg, 'URL は半角英小文字・数字・ハイフンで3〜32文字にしてください。', 'error'); return; }
      if (!title) { EM.notice(msg, 'タイトルを入力してください。', 'error'); return; }
      if (active && !page.password_updated_at) {
        EM.notice(msg, 'パスワードを設定してから公開してください。', 'error');
        EM.$('#isActive').checked = false;
        return;
      }
      var btn = EM.$('#savePageBtn'); btn.setAttribute('aria-busy', 'true');
      sb.from('stock_pages').update({
        slug: slug, title: title, intro: EM.$('#intro').value.trim() || null, is_active: active
      }).eq('id', page.id).select(PAGE_COLS).single().then(function (r) {
        if (r.error) throw r.error;
        page = r.data;
        fillPageForm();
        EM.toast('保存しました');
        EM.notice(msg, '');
      }).catch(function (err) {
        var m = String(err.message || '');
        EM.notice(msg, m.indexOf('duplicate key') !== -1
          ? 'この URL はすでに使われています。' : EM.errorText(err), 'error');
      }).then(function () { btn.removeAttribute('aria-busy'); });
    });

    EM.$('#copyUrlBtn').addEventListener('click', function () {
      var url = publicUrlFor(EM.$('#slug').value);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { EM.toast('URL をコピーしました'); },
          function () { EM.toast(url); });
      } else { EM.toast(url); }
    });

    /* ---------------- パスワード ---------------- */
    EM.$('#showPwBtn').addEventListener('click', function () {
      var f = EM.$('#newPassword');
      var shown = f.type === 'text';
      f.type = shown ? 'password' : 'text';
      this.textContent = shown ? '入力内容を表示' : '入力内容を隠す';
    });

    EM.$('#pwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = EM.$('#newPassword').value;
      if (!pw || pw.length < 6) { EM.notice(msg, 'パスワードは6文字以上にしてください。', 'error'); return; }
      var btn = EM.$('#savePwBtn'); btn.setAttribute('aria-busy', 'true');
      sb.rpc('set_stock_password', { p_password: pw }).then(function (r) {
        if (r.error) throw r.error;
        EM.$('#newPassword').value = '';
        EM.toast('パスワードを設定しました');
        EM.notice(msg, '');
        return loadPage();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); })
        .then(function () { btn.removeAttribute('aria-busy'); });
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
      var pref = EM.$('#contactPref').value;
      var dm = EM.$('#contactDmUrl').value.trim();
      if (pref !== 'form') {
        if (!dm) { EM.notice(msg, 'DM の宛先 URL を入力してください。', 'error'); return; }
        if (!EM.safeUrl(dm)) { EM.notice(msg, 'DM の宛先は https:// から始まる URL にしてください。', 'error'); return; }
      }
      sb.from('creators').update({
        contact_pref: pref, contact_dm_url: pref === 'form' ? null : dm
      }).eq('id', creator.id).select('id,display_name,contact_pref,contact_dm_url').single()
        .then(function (r) {
          if (r.error) throw r.error;
          creator = r.data;
          EM.toast('保存しました');
          EM.notice(msg, '');
        }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
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

    function syncAddForm() {
      var needUrl = (addKind === 'video' || addKind === 'doc' || addKind === 'link');
      EM.$('#addUrlField').hidden = !needUrl;
      EM.$('#addTitleField').hidden = (addKind === 'note');
      EM.$('#addDescField').hidden = (addKind === 'heading');
      var label = EM.$('#addUrlLabel'), hint = EM.$('#addUrlHint'), input = EM.$('#addUrl');
      if (addKind === 'video') {
        label.textContent = '動画の URL';
        input.placeholder = 'https://www.youtube.com/watch?v=...';
        hint.textContent = 'YouTube・Vimeo・TikTok に対応。TikTok は「www.tiktok.com/@…/video/…」の長い方の URL を貼ってください。';
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
      EM.$('#addTitleNote').textContent = (addKind === 'heading')
        ? '（120文字まで・必須）' : '（120文字まで・省略可）';
    }

    EM.$('#addItemBtn').addEventListener('click', function () {
      var title = EM.$('#addTitle').value.trim();
      var desc = EM.$('#addDesc').value.trim();
      var url = EM.$('#addUrl').value.trim();
      var row = { page_id: page.id, kind: addKind, width: 'full', sort_order: items.length };

      if (addKind === 'video') {
        var v = EM.parseVideoUrl(url);
        if (!v) { EM.notice(msg, '動画の URL を認識できませんでした。YouTube・Vimeo・TikTok の URL を貼ってください。', 'error'); return; }
        row.provider = v.provider; row.video_id = v.video_id; row.url = v.video_url;
        row.title = title || null; row.description = desc || null;
        var btn = this; btn.setAttribute('aria-busy', 'true');
        EM.fetchThumbnail(v).then(function (thumb) {
          row.thumbnail_url = thumb || null;
          return insertItem(row);
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
        el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '削除',
          onclick: function () { removeItem(it); } })
      ]);

      var body = el('div', { class: 'stack stock-edit__body' });
      if (it.kind !== 'note') {
        body.appendChild(el('label', { class: 'field' }, [
          el('span', { class: 'label', text: it.kind === 'heading' ? '見出しの文字' : 'タイトル' }),
          el('input', { type: 'text', maxlength: '120', value: it.title || '', dataset: { f: 'title' } })
        ]));
      }
      if (it.kind !== 'heading') {
        body.appendChild(el('label', { class: 'field' }, [
          el('span', { class: 'label', text: '説明' }),
          el('textarea', { maxlength: '2000', rows: '3', dataset: { f: 'description' } }, it.description || '')
        ]));
      }
      if (it.url) {
        body.appendChild(el('p', { class: 'small muted mono stock-edit__url', text: it.url }));
      }
      var saveBtn = el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: 'この内容を保存' });
      body.appendChild(el('div', { class: 'form-actions' }, saveBtn));

      var card = el('div', { class: 'card stock-edit' }, [
        el('div', { class: 'row-item' }, [head, ops]),
        body
      ]);

      saveBtn.addEventListener('click', function () {
        var patch = {};
        var t = body.querySelector('[data-f="title"]');
        var d = body.querySelector('[data-f="description"]');
        if (t) patch.title = t.value.trim() || null;
        if (d) patch.description = d.value.trim() || null;
        if (it.kind === 'heading' && !patch.title) { EM.notice(msg, '見出しの文字は空にできません。', 'error'); return; }
        if (it.kind === 'note' && !patch.description) { EM.notice(msg, '本文は空にできません。', 'error'); return; }
        saveBtn.setAttribute('aria-busy', 'true');
        sb.from('stock_items').update(patch).eq('id', it.id).then(function (r) {
          if (r.error) throw r.error;
          it.title = patch.title !== undefined ? patch.title : it.title;
          it.description = patch.description !== undefined ? patch.description : it.description;
          EM.toast('保存しました');
          EM.notice(msg, '');
        }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); })
          .then(function () { saveBtn.removeAttribute('aria-busy'); });
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
      if (!confirm('このブロックを削除しますか？')) return;
      sb.from('stock_items').delete().eq('id', it.id).then(function (r) {
        if (r.error) throw r.error;
        return loadItems();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }
  });
})(window.EM);
