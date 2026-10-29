/* Eizo Maps — マイページ（プロフィール編集） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var user = null, creator = null, genres = [], selected = [];
    var bar = null, profileDirty = false, accountDirty = false;

    EM.PREFS.forEach(function (p) { EM.$('#areaPref').appendChild(el('option', { value: p, text: p })); });

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return Promise.all([
        sb.from('genres').select('id,name_ja,sort_order').order('sort_order'),
        sb.from('creators').select('*,creator_genres(genre_id)').eq('user_id', u.id).maybeSingle(),
        sb.from('users').select('account_type').eq('id', u.id).maybeSingle()
      ]);
    }).then(function (res) {
      if (!res) return;
      genres = res[0].data || [];
      creator = res[1].data || null;
      if (res[2].data) EM.$('#accountType').value = res[2].data.account_type;

      if (creator) {
        EM.$('#displayName').value   = creator.display_name || '';
        EM.$('#headline').value      = creator.headline || '';
        EM.$('#bio').value           = creator.bio || '';
        EM.$('#areaPref').value      = creator.area_pref || '';
        EM.$('#areaCity').value      = creator.area_city || '';
        EM.$('#years').value         = creator.years_of_experience != null ? creator.years_of_experience : '';
        EM.$('#responseHours').value = creator.response_time_hours != null ? creator.response_time_hours : '';
        EM.$('#websiteUrl').value    = creator.website_url || '';
        EM.$('#serviceArea').value   = creator.service_area || '';
        EM.$('#travelOk').value      = creator.travel_ok === true ? 'yes' : creator.travel_ok === false ? 'no' : '';
        EM.$('#businessType').value  = creator.business_type || '';
        EM.$('#invoiceRegistered').value = creator.invoice_registered === true ? 'yes' : creator.invoice_registered === false ? 'no' : '';
        EM.$('#equipment').value     = creator.equipment || '';
        moods = (creator.moods || []).slice();
        renderMoods();
        loadPackages();
        EM.$('#isPublished').checked = !!creator.is_published;
        selected = (creator.creator_genres || []).map(function (x) { return x.genre_id; });
        var link = EM.$('#viewPublicLink');
        link.href = creator.handle ? '/@' + creator.handle : '/creators/detail.html?id=' + encodeURIComponent(creator.id);
        link.hidden = !creator.is_published;
        showApproval();
        loadMatches();
      } else {
        EM.notice(msg, 'プロフィールがまだありません。表示名を入れて保存すると作成されます。');
      }
      renderAvatar();
      function showApproval() {
        var n = EM.$('#approvalNote');
        if (!n) return;
        n.hidden = !(creator.is_published && !creator.approved);
        n.textContent = '運営の確認待ちです。いまは活動名と職種だけが表に出ています。確認が終わると、作品・自己紹介・評価も表示されます（目安：数日以内）。';
      }
      // 「あなたではありませんか？」（プロフィールの SNS の URL と同じ、おすすめで作られたページ）
      function loadMatches() {
        var box = EM.$('#recMatches');
        if (!box) return;
        sb.rpc('my_recommendation_matches').then(function (r) {
          EM.clear(box);
          (r.data || []).forEach(function (m) {
            var acts = el('div', { class: 'form-actions' });
            if (m.claim === 'pending') acts.appendChild(el('span', { class: 'small muted', text: '「これは私です」を受け付けました。運営が確認しています。' }));
            else {
              var yes = el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: 'これは私です' });
              var no = el('button', { class: 'btn btn--sm', type: 'button', text: '違います' });
              [[yes, true], [no, false]].forEach(function (pair) {
                pair[0].addEventListener('click', function () {
                  pair[0].disabled = true;
                  sb.rpc('answer_recommendation', { p_rec_id: m.id, p_is_me: pair[1] }).then(function (x) {
                    if (x.error) throw x.error;
                    EM.toast(pair[1] ? '受け付けました。運営が確認してから、あなたのページにまとめます' : 'わかりました。このお知らせはもう出しません');
                    loadMatches();
                  }).catch(function (e) { pair[0].disabled = false; EM.notice(msg, EM.errorText(e), 'error'); });
                });
              });
              acts.appendChild(yes); acts.appendChild(no);
            }
            box.appendChild(el('div', { class: 'card stack rec-match' }, [
              el('strong', { text: 'あなたではありませんか？' }),
              el('p', { class: 'small', text: 'ほかの利用者のおすすめで「' + m.display_name + '」さんのページが作られています。あなたのプロフィールと同じ SNS の URL がのっています。' }),
              m.comment ? el('p', { class: 'small muted', text: 'おすすめのひとこと：' + m.comment }) : null,
              el('a', { class: 'small', href: '/creators/rec.html?id=' + encodeURIComponent(m.id), target: '_blank', rel: 'noopener', text: 'そのページを見る' }),
              acts
            ]));
          });
        });
      }
      renderGenres();
      initHandle();
      mountSaveBar();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    /* ---------------- @ハンドル ----------------
       入力のたびにサーバーへ「使えるか」を聞き、使えないときは理由と空いている候補を出す。
       最終的な重複チェックはデータベースが行う（同時に同じ名前を取られても二重にはならない）。 */
    var handleTimer = null, handleReq = 0, handleOk = false, keepSugg = false;
    var REASON = {
      taken: 'この @ハンドルは、すでにほかの人が使っています。',
      reserved: 'この @ハンドルは使えません（運営やページの名前とまぎらわしいため）。',
      format: '使えるのは半角の英小文字・数字・アンダーバー「_」で、3〜20文字です。'
    };

    function initHandle() {
      var has = !!(creator && creator.id);
      EM.$('#handleNeedProfile').hidden = has;
      EM.$('#handleEditor').hidden = !has;
      EM.$('#handleSummary').hidden = true;
      if (!has) return;
      // 決まっているときは、すっきりした表示だけにする
      if (creator.handle) { showHandleSummary(); return; }
      EM.$('#handleInput').value = creator.handle || '';
      showHandleUrl(creator.handle);
      if (!creator.handle) {
        setHandleStatus('まだ決まっていません。', '');
        // 表示名から候補を出しておく
        sb.rpc('handle_check', { p_handle: EM.$('#displayName').value || 'creator' }).then(function (r) {
          if (r.data && r.data.suggestions) renderSugg(r.data.suggestions);
          else if (r.data && r.data.ok) renderSugg([r.data.handle]);
        });
      } else {
        setHandleStatus('今の @ハンドルです。', 'ok');
      }
    }

    function showHandleSummary() {
      var h = creator.handle;
      var url = (EM.config.SITE_ORIGIN || location.origin) + '/@' + h;
      EM.$('#handleSumVal').textContent = h;
      var a = EM.$('#handleSumUrl');
      a.href = '/@' + h; a.textContent = url.replace(/^https?:\/\//, '');
      EM.$('#handleSummary').hidden = false;
      EM.$('#handleEditor').hidden = true;
      EM.$('#handleIntro').hidden = true;
    }
    function openHandleEditor() {
      EM.$('#handleSummary').hidden = true;
      EM.$('#handleEditor').hidden = false;
      EM.$('#handleIntro').hidden = false;
      EM.$('#handleCancelBtn').hidden = !creator.handle;
      EM.$('#handleInput').value = creator.handle || '';
      showHandleUrl(creator.handle);
      setHandleStatus(creator.handle ? '今の @ハンドルです。変えるときは新しいものを入れてください。' : 'まだ決まっていません。', creator.handle ? 'ok' : '');
      EM.$('#handleSugg').hidden = true;
      EM.$('#handleSaveBtn').disabled = true;
      handleOk = false;
      setTimeout(function () { EM.$('#handleInput').focus(); EM.$('#handleInput').select(); }, 50);
    }
    EM.$('#handleChangeBtn').addEventListener('click', openHandleEditor);
    EM.$('#handleCancelBtn').addEventListener('click', function () { if (creator && creator.handle) showHandleSummary(); });
    EM.$('#handleCopyBtn').addEventListener('click', function () {
      var url = (EM.config.SITE_ORIGIN || location.origin) + '/@' + creator.handle;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { EM.toast('URL をコピーしました'); }, function () { EM.toast(url); });
      } else { EM.toast(url); }
    });

    function showHandleUrl(h) {
      var line = EM.$('#handleUrlLine'), a = EM.$('#handleUrl');
      if (!h) { line.hidden = true; return; }
      var url = (EM.config.SITE_ORIGIN || location.origin) + '/@' + h;
      a.href = '/@' + h; a.textContent = url.replace(/^https?:\/\//, '');
      line.hidden = false;
    }

    function setHandleStatus(text, kind) {
      var st = EM.$('#handleStatus');
      st.textContent = text;
      st.className = 'small handle-status' + (kind ? ' is-' + kind : '');
    }

    function renderSugg(list) {
      var box = EM.$('#handleSuggList');
      EM.clear(box);
      (list || []).forEach(function (h) {
        box.appendChild(el('button', {
          type: 'button', class: 'chip', text: '@' + h,
          'aria-pressed': 'false',
          onclick: function () {
            EM.$$('#handleSuggList .chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
            this.setAttribute('aria-pressed', 'true');
            keepSugg = true;
            EM.$('#handleInput').value = h;
            EM.$('#handleInput').focus();
            checkHandle();
          }
        }));
      });
      EM.$('#handleSugg').hidden = !(list && list.length);
    }

    function checkHandle() {
      var v = EM.$('#handleInput').value.trim().replace(/^@/, '').toLowerCase();
      EM.$('#handleInput').value = v;
      handleOk = false;
      EM.$('#handleSaveBtn').disabled = true;
      if (!v) { setHandleStatus('', ''); EM.$('#handleSugg').hidden = true; return; }
      setHandleStatus('確認しています…', '');
      var my = ++handleReq;
      sb.rpc('handle_check', { p_handle: v }).then(function (r) {
        if (my !== handleReq) return;            // 古い問い合わせの答えは捨てる
        if (r.error) { setHandleStatus(EM.errorText(r.error), 'ng'); return; }
        var d = r.data || {};
        if (d.ok && d.reason === 'mine') {
          setHandleStatus('今の @ハンドルです。', 'ok');
          EM.$('#handleSugg').hidden = true;
          return;
        }
        if (d.ok) {
          handleOk = true;
          EM.$('#handleSaveBtn').disabled = false;
          setHandleStatus('@' + d.handle + ' は使えます。よければ「確定する」を押してください。', 'ok');
          // 候補から選んだときは、ほかの候補も残しておく（押し間違えてもすぐ選び直せるように）
          if (!keepSugg) EM.$('#handleSugg').hidden = true;
        } else {
          setHandleStatus(REASON[d.reason] || '使えません。', 'ng');
          renderSugg(d.suggestions);
        }
      });
    }

    EM.$('#handleInput').addEventListener('input', function () {
      keepSugg = false;
      EM.$$('#handleSuggList .chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
      clearTimeout(handleTimer);
      handleTimer = setTimeout(checkHandle, 350);
    });

    EM.$('#handleSaveBtn').addEventListener('click', function () {
      if (!handleOk) return;
      var b = this; b.setAttribute('aria-busy', 'true');
      var v = EM.$('#handleInput').value.trim();
      var ask = creator.handle
        ? '@' + creator.handle + ' から @' + v + ' に変えますか？\n前のアドレスは使えなくなります。'
        : '@' + v + ' で確定しますか？';
      if (!confirm(ask)) { b.removeAttribute('aria-busy'); return; }
      sb.rpc('set_my_handle', { p_handle: v }).then(function (r) {
        if (r.error) throw r.error;
        var d = r.data || {};
        if (!d.ok) {
          setHandleStatus(REASON[d.reason] || '使えません。', 'ng');
          renderSugg(d.suggestions);
          return;
        }
        creator.handle = d.handle;
        EM.toast('@' + d.handle + ' に決まりました');
        setHandleStatus('今の @ハンドルです。', 'ok');
        EM.$('#handleSugg').hidden = true;
        EM.$('#handleSaveBtn').disabled = true;
        showHandleUrl(d.handle);
        showHandleSummary();
        var link = EM.$('#viewPublicLink');
        link.href = '/@' + d.handle;
      }).catch(function (e) { setHandleStatus(EM.errorText(e), 'ng'); })
        .then(function () { b.removeAttribute('aria-busy'); });
    });

    function renderAvatar() {
      var box = EM.$('#avatarPreview');
      EM.clear(box);
      box.appendChild(EM.avatar(creator && creator.avatar_url, EM.$('#displayName').value || 'E', true));
    }

    function renderGenres() {
      var box = EM.$('#genreChips');
      EM.clear(box);
      genres.forEach(function (g) {
        var on = selected.indexOf(g.id) !== -1;
        var b = el('button', {
          class: 'chip', type: 'button', 'aria-pressed': on ? 'true' : 'false', text: g.name_ja,
          onclick: function () {
            var i = selected.indexOf(g.id);
            if (i !== -1) { selected.splice(i, 1); }
            else {
              if (selected.length >= 6) { EM.toast('職種は最大6件までです'); return; }
              selected.push(g.id);
            }
            b.setAttribute('aria-pressed', selected.indexOf(g.id) !== -1 ? 'true' : 'false');
            profileDirty = true;
            if (bar) bar.markDirty();
          }
        });
        box.appendChild(b);
      });
    }

    /* ---- アバター画像のアップロード ---- */
    EM.$('#avatarFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(f.type) === -1) { EM.toast('JPEG / PNG / WebP のみ対応しています'); return; }
      if (f.size > 2 * 1024 * 1024) { EM.toast('2MB 以下の画像を選んでください'); return; }
      var ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
      var path = user.id + '/avatar.' + ext;
      EM.notice(msg, 'アップロード中です…');
      sb.storage.from('avatars').upload(path, f, { upsert: true, contentType: f.type })
        .then(function (r) {
          if (r.error) throw r.error;
          var pub = sb.storage.from('avatars').getPublicUrl(path);
          var url = pub.data.publicUrl + '?v=' + Date.now();
          if (!creator) { creator = { avatar_url: url }; } else { creator.avatar_url = url; }
          EM.notice(msg, '画像を読み込みました。画面下の「保存する」を押すと反映されます。', 'ok');
          profileDirty = true;
          if (bar) bar.markDirty();
          renderAvatar();
        })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    });

    /* ---- 保存（画面下のバーで、プロフィールと利用種別をまとめて1回で） ---- */
    function mountSaveBar() {
      if (bar) return;
      bar = EM.saveBar({
        watch: [EM.$('#profileForm'), EM.$('#accountType')],
        savedAt: creator && creator.updated_at,
        onSave: saveAll
      });
      EM.$('#profileForm').addEventListener('input', function () { profileDirty = true; });
      EM.$('#profileForm').addEventListener('change', function () { profileDirty = true; });
      EM.$('#accountType').addEventListener('change', function () { accountDirty = true; });
    }

    // Enter キーで送信されたときも、画面下のバーで保存する
    EM.$('#profileForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (bar) bar.save().catch(function () {});
    });

    function saveAll() {
      var payload = null;
      if (profileDirty) {
        var name = EM.$('#displayName').value.trim();
        if (!name) { EM.notice(msg, '表示名を入力してください。', 'error'); return false; }
        var site = EM.$('#websiteUrl').value.trim();
        if (site && !EM.safeUrl(site)) { EM.notice(msg, 'ウェブサイトは https:// から始まる URL を入力してください。', 'error'); return false; }
        payload = {
          display_name: name,
          headline: EM.$('#headline').value.trim() || null,
          bio: EM.$('#bio').value.trim() || null,
          area_pref: EM.$('#areaPref').value || null,
          area_city: EM.$('#areaCity').value.trim() || null,
          years_of_experience: EM.$('#years').value === '' ? null : Number(EM.$('#years').value),
          response_time_hours: EM.$('#responseHours').value === '' ? null : Number(EM.$('#responseHours').value),
          website_url: site || null,
          service_area: EM.$('#serviceArea').value.trim() || null,
          travel_ok: yesNo(EM.$('#travelOk').value),
          business_type: EM.$('#businessType').value || null,
          invoice_registered: yesNo(EM.$('#invoiceRegistered').value),
          equipment: EM.$('#equipment').value.trim() || null,
          moods: moods.slice(0, 3),
          avatar_url: (creator && creator.avatar_url) || null,
          is_published: EM.$('#isPublished').checked
        };
      }
      var savedAt = null;
      var p1 = !payload ? Promise.resolve() : ((creator && creator.id)
        ? sb.from('creators').update(payload).eq('id', creator.id).select('*').single()
        : sb.from('creators').insert(Object.assign({ user_id: user.id }, payload)).select('*').single()
      ).then(function (r) {
        if (r.error) throw r.error;
        creator = Object.assign({}, r.data);
        savedAt = creator.updated_at;
        if (EM.$('#handleEditor').hidden) initHandle();
        if (EM.$('#packagesBox').hidden) loadPackages();
        return syncGenres(creator.id);
      }).then(function () {
        var link = EM.$('#viewPublicLink');
        link.href = creator.handle ? '/@' + creator.handle : '/creators/detail.html?id=' + encodeURIComponent(creator.id);
        link.hidden = !creator.is_published;
      });
      return p1.then(function () {
        if (!accountDirty) return null;
        return sb.from('users').update({ account_type: EM.$('#accountType').value, onboarded: true })
          .eq('id', user.id).then(function (r) { if (r.error) throw r.error; });
      }).then(function () {
        profileDirty = false; accountDirty = false;
        EM.notice(msg, '');
        return savedAt || new Date().toISOString();
      }).catch(function (err) {
        EM.notice(msg, EM.errorText(err), 'error');
        throw err;
      });
    }

    // 得意な雰囲気（3つまで）
    var MOODS = ['シネマティック', 'ドキュメンタリー', 'ポップ', 'クール', 'やさしい', 'ユニーク', 'シンプル', '上品', 'エネルギッシュ', 'かわいい'];
    var moods = [];
    function renderMoods() {
      var box = EM.$('#moodChips');
      if (!box) return;
      EM.clear(box);
      MOODS.forEach(function (m) {
        var on = moods.indexOf(m) >= 0;
        box.appendChild(el('button', { class: 'chip', type: 'button', 'aria-pressed': on ? 'true' : 'false', text: m, onclick: function () {
          var i = moods.indexOf(m);
          if (i >= 0) moods.splice(i, 1);
          else { if (moods.length >= 3) { EM.toast('得意な雰囲気は3つまでです'); return; } moods.push(m); }
          profileDirty = true;
          if (bar && bar.markDirty) bar.markDirty();
          renderMoods();
        } }));
      });
    }
    renderMoods();

    function yesNo(v) { return v === 'yes' ? true : v === 'no' ? false : null; }

    /* ---------- 料金の目安（6つまで。押したらすぐ保存） ---------- */
    var pkgs = [], pkgEditing = null;
    function loadPackages() {
      if (!creator || !creator.id) return;
      EM.$('#packagesBox').hidden = false;
      sb.from('creator_packages').select('*').eq('creator_id', creator.id).order('sort_order').order('created_at').then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        pkgs = r.data || [];
        renderPkgs();
      });
    }
    function renderPkgs() {
      var list = EM.$('#pkgList');
      EM.clear(list);
      if (!pkgs.length) list.appendChild(el('p', { class: 'small muted', text: 'まだありません。' }));
      pkgs.forEach(function (k, i) {
        var sub = [Number(k.price_yen).toLocaleString('ja-JP') + '円（税込）' + (k.price_from ? '〜' : '')];
        if (k.delivery_days) sub.push('納品 ' + k.delivery_days + '日');
        if (k.revisions != null) sub.push('修正 ' + k.revisions + '回まで');
        list.appendChild(el('div', { class: 'card row pkg-row' }, [
          el('div', { class: 'pkg-row__text' }, [
            el('p', { class: 'pf-title', text: k.title }),
            el('p', { class: 'small muted', text: sub.join('／') }),
            k.description ? el('p', { class: 'small pre', text: k.description }) : null
          ]),
          el('div', { class: 'pf-actions' }, [
            el('button', { class: 'btn btn--sm', type: 'button', text: '↑', 'aria-label': '上へ', disabled: i === 0, onclick: function () { movePkg(i, -1); } }),
            el('button', { class: 'btn btn--sm', type: 'button', text: '↓', 'aria-label': '下へ', disabled: i === pkgs.length - 1, onclick: function () { movePkg(i, 1); } }),
            el('button', { class: 'btn btn--sm', type: 'button', text: '直す', onclick: function () { editPkg(k); } }),
            el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '消す', onclick: function () { removePkg(k); } })
          ])
        ]));
      });
      var full = pkgs.length >= 6 && !pkgEditing;
      EM.$('#pkgForm').hidden = full;
    }
    function editPkg(k) {
      pkgEditing = k;
      EM.$('#pkgFormTitle').textContent = '「' + k.title + '」を直す';
      EM.$('#pkgTitle').value = k.title;
      EM.$('#pkgPrice').value = k.price_yen;
      EM.$('#pkgFrom').value = k.price_from ? 'from' : 'fixed';
      EM.$('#pkgDays').value = k.delivery_days != null ? k.delivery_days : '';
      EM.$('#pkgRevisions').value = k.revisions != null ? k.revisions : '';
      EM.$('#pkgDesc').value = k.description || '';
      EM.$('#pkgSave').textContent = '保存する';
      EM.$('#pkgCancel').hidden = false;
      EM.$('#pkgForm').hidden = false;
      EM.$('#pkgTitle').focus();
    }
    function resetPkgForm() {
      pkgEditing = null;
      EM.$('#pkgForm').reset();
      EM.$('#pkgFormTitle').textContent = '料金の目安を足す';
      EM.$('#pkgSave').textContent = '足す';
      EM.$('#pkgCancel').hidden = true;
    }
    EM.$('#pkgCancel').addEventListener('click', function () { resetPkgForm(); renderPkgs(); });
    EM.$('#pkgForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = EM.$('#pkgTitle').value.trim();
      var price = EM.$('#pkgPrice').value;
      if (!title) { EM.notice(msg, '料金の目安の名前を入れてください。', 'error'); return; }
      if (price === '' || Number(price) < 0) { EM.notice(msg, '金額（税込）を入れてください。', 'error'); return; }
      var row = {
        title: title,
        price_yen: Math.round(Number(price)),
        price_from: EM.$('#pkgFrom').value === 'from',
        delivery_days: EM.$('#pkgDays').value === '' ? null : Number(EM.$('#pkgDays').value),
        revisions: EM.$('#pkgRevisions').value === '' ? null : Number(EM.$('#pkgRevisions').value),
        description: EM.$('#pkgDesc').value.trim() || null
      };
      var q = pkgEditing
        ? sb.from('creator_packages').update(row).eq('id', pkgEditing.id)
        : sb.from('creator_packages').insert(Object.assign({ creator_id: creator.id, sort_order: pkgs.length }, row));
      q.then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.notice(msg, '');
        EM.toast(pkgEditing ? '料金の目安を直しました' : '料金の目安を足しました');
        resetPkgForm();
        loadPackages();
      });
    });
    function removePkg(k) {
      if (!confirm('「' + k.title + '」を消しますか？')) return;
      sb.from('creator_packages').delete().eq('id', k.id).then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.toast('消しました');
        if (pkgEditing && pkgEditing.id === k.id) resetPkgForm();
        loadPackages();
      });
    }
    function movePkg(i, dir) {
      var j = i + dir;
      if (j < 0 || j >= pkgs.length) return;
      Promise.all([
        sb.from('creator_packages').update({ sort_order: j }).eq('id', pkgs[i].id),
        sb.from('creator_packages').update({ sort_order: i }).eq('id', pkgs[j].id)
      ]).then(loadPackages);
    }

    function syncGenres(creatorId) {
      return sb.from('creator_genres').delete().eq('creator_id', creatorId).then(function () {
        if (!selected.length) return null;
        return sb.from('creator_genres').insert(selected.map(function (g) {
          return { creator_id: creatorId, genre_id: g };
        }));
      });
    }

    EM.$('#logoutBtn').addEventListener('click', function () { EM.signOut(); });
  });
})(window.EM);
