/* Eizo Maps — ポートフォリオ管理と共有リンク */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var creator = null, user = null, items = [], links = [], parsed = null, pickedTags = [];

    // 作品の見せ方（作品棚）
    var VIS = [
      ['public',     '誰でも見られる（プロフィールに表示）'],
      ['link_only',  '限定リンクのみ'],
      ['stock_only', 'パスワードページだけ']
    ];
    function visLabel(v) {
      for (var i = 0; i < VIS.length; i++) if (VIS[i][0] === v) return VIS[i][1];
      return v;
    }
    var LIMIT = 120;

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return sb.from('creators').select('id,display_name').eq('user_id', u.id).maybeSingle();
    }).then(function (r) {
      if (!r) return;
      if (r.error) throw r.error;
      if (!r.data) {
        EM.notice(msg, 'さきにプロフィールを作成してください。', 'error');
        EM.$('#addForm').hidden = true;
        EM.$('#workAddBtn').hidden = true;
        EM.$('#shareForm').hidden = true;
        EM.$('#pfList').appendChild(el('div', { class: 'empty' }, el('a', { class: 'btn', href: '/mypage/', text: 'プロフィールを作成する' })));
        return;
      }
      creator = r.data;
      renderTagPresets();
      return reload();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function reload() {
      return Promise.all([
        sb.from('portfolios')
          .select('id,title,description,provider,video_id,video_url,thumbnail_url,visibility,sort_order,created_at,portfolio_tags(tag),stock_items(id)')
          .eq('creator_id', creator.id).order('sort_order').order('created_at', { ascending: false }),
        sb.from('share_links')
          .select('id,token,title,is_active,view_count,created_at,share_link_items(portfolio_id)')
          .eq('creator_id', creator.id).order('created_at', { ascending: false })
      ]).then(function (res) {
        if (res[0].error) throw res[0].error;
        items = res[0].data || [];
        links = res[1].data || [];
        renderList();
        renderPicker();
        renderLinks();
      });
    }

    /* ---------------- 作品の追加 ---------------- */
    function renderTagPresets() {
      var box = EM.$('#tagChips');
      EM.clear(box);
      EM.TAG_PRESETS.forEach(function (t) {
        var b = el('button', {
          class: 'chip', type: 'button', 'aria-pressed': 'false', text: t,
          onclick: function () {
            var i = pickedTags.indexOf(t);
            if (i !== -1) pickedTags.splice(i, 1);
            else {
              if (pickedTags.length >= 8) { EM.toast('タグは最大8件までです'); return; }
              pickedTags.push(t);
            }
            b.setAttribute('aria-pressed', pickedTags.indexOf(t) !== -1 ? 'true' : 'false');
          }
        });
        box.appendChild(b);
      });
    }

    /* サムネイル画像の選択（ボタンの文字を日本語にするため、元の部品は隠している） */
    var thumbFile = EM.$('#thumbFile'), pickedThumbData = null;
    EM.$('#thumbPickBtn').addEventListener('click', function () { thumbFile.click(); });
    EM.$('#thumbClearBtn').addEventListener('click', function () { thumbFile.value = ''; onThumbPicked(); });
    thumbFile.addEventListener('change', onThumbPicked);
    function onThumbPicked() {
      var f = thumbFile.files && thumbFile.files[0];
      pickedThumbData = null;
      EM.$('#thumbPickName').textContent = f ? f.name : '選んでいません';
      EM.$('#thumbClearBtn').hidden = !f;
      if (f && checkImage(f)) { EM.notice(msg, checkImage(f), 'error'); thumbFile.value = ''; return onThumbPicked(); }
      if (!f) { drawPreview(); return; }
      var rd = new FileReader();
      rd.onload = function () { pickedThumbData = String(rd.result || ''); drawPreview(); };
      rd.readAsDataURL(f);
    }

    var urlInput = EM.$('#videoUrl');
    urlInput.addEventListener('change', preview);
    urlInput.addEventListener('blur', preview);

    function preview() {
      parsed = EM.parseVideoUrl(urlInput.value, true);
      var box = EM.$('#previewBox'), thumb = EM.$('#previewThumb');
      if (!parsed) {
        box.hidden = true;
        if (urlInput.value.trim()) EM.notice(msg, 'https:// から始まる URL を入力してください。', 'error');
        return;
      }
      EM.notice(msg, '');
      EM.fetchThumbnail(parsed).then(function (url) {
        parsed.thumbnail_url = url;
        drawPreview();
        EM.notice(msg, parsed.provider === 'link'
          ? 'このサイトはページの中で再生できないため、「リンク」として載せます。見る人が押すと、そのページが開きます。'
          : '');
      });
    }

    // 表紙の見本：自分で選んだ画像 → 自動で取れた画像 → サイト名の印だけ、の順
    function drawPreview() {
      var box = EM.$('#previewBox'), thumb = EM.$('#previewThumb');
      if (!parsed) { box.hidden = true; return; }
      EM.clear(thumb);
      if (pickedThumbData && /^data:image\/(png|jpeg|webp);base64,/.test(pickedThumbData)) {
        thumb.appendChild(el('img', { src: pickedThumbData, alt: '' }));
      } else if (parsed.thumbnail_url) {
        thumb.appendChild(EM.thumbImg(parsed.thumbnail_url, ''));
      }
      thumb.appendChild(el('span', { class: 'badge', text: EM.PROVIDER_LABEL[parsed.provider] || parsed.provider }));
      box.hidden = false;
    }

    EM.$('#addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!parsed) { preview(); if (!parsed) return; }
      var title = EM.$('#title').value.trim();
      if (!title) { EM.notice(msg, 'タイトルを入力してください。', 'error'); return; }
      var tf = EM.$('#thumbFile').files && EM.$('#thumbFile').files[0];
      if (tf && checkImage(tf)) { EM.notice(msg, checkImage(tf), 'error'); return; }

      var btn = EM.$('#addBtn');
      btn.setAttribute('aria-busy', 'true');

      sb.from('portfolios').insert({
        creator_id: creator.id,
        title: title,
        description: EM.$('#description').value.trim() || null,
        provider: parsed.provider,
        video_id: parsed.video_id,
        video_url: parsed.video_url,
        thumbnail_url: parsed.thumbnail_url || null,
        visibility: EM.$('#visibility').value,
        sort_order: items.length
      }).select('id').single().then(function (r) {
        if (r.error) throw r.error;
        var newId = r.data.id;
        var file = EM.$('#thumbFile').files && EM.$('#thumbFile').files[0];
        return (file ? uploadThumb(newId, file) : Promise.resolve()).then(function () {
          if (!pickedTags.length) return null;
          return sb.from('portfolio_tags').insert(pickedTags.map(function (t) {
            return { portfolio_id: newId, tag: t };
          }));
        });
      }).then(function () {
        btn.removeAttribute('aria-busy');
        EM.$('#addForm').reset();
        EM.$('#previewBox').hidden = true;
        EM.$('#thumbFile').value = ''; onThumbPicked();
        parsed = null; pickedTags = [];
        EM.$$('#tagChips .chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        EM.toast('作品を登録しました');
        if (EM.portfolioCloseAdd) EM.portfolioCloseAdd();
        EM.notice(msg, '');
        return reload();
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    });

    /* ---------------- サムネイル画像 ---------------- */
    // 画像はプロフィール写真と同じ置き場所の「自分のフォルダ」に入れる（本人しか書き込めない）
    function checkImage(f) {
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(f.type) === -1) return 'JPEG / PNG / WebP の画像を選んでください。';
      if (f.size > 2 * 1024 * 1024) return '2MB 以下の画像を選んでください。';
      return null;
    }
    function uploadThumb(portfolioId, f) {
      var bad = checkImage(f);
      if (bad) return Promise.reject(new Error(bad));
      var ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
      var path = user.id + '/works/' + portfolioId + '-' + Date.now() + '.' + ext;
      return sb.storage.from('avatars').upload(path, f, { upsert: true, contentType: f.type }).then(function (r) {
        if (r.error) throw r.error;
        var url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
        return sb.from('portfolios').update({ thumbnail_url: url }).eq('id', portfolioId);
      }).then(function (r) { if (r && r.error) throw r.error; });
    }
    function thumbButton(p) {
      var input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) return;
        EM.notice(msg, '画像をアップロードしています…');
        uploadThumb(p.id, f).then(function () {
          EM.notice(msg, ''); EM.toast('サムネイルを変えました'); return reload();
        }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
      });
      var btn = el('button', { class: 'btn btn--sm', type: 'button', text: p.thumbnail_url ? 'サムネイルを変える' : 'サムネイルを設定',
        onclick: function () { input.click(); } });
      return el('span', null, [btn, input]);
    }

    /* ---------------- 一覧・並び替え ---------------- */
    function renderList() {
      var box = EM.$('#pfList');
      EM.clear(box);
      EM.$('#pfCount').textContent = '（' + items.length + ' / ' + LIMIT + '件）';
      if (!items.length) { box.appendChild(el('div', { class: 'empty', text: 'まだ作品がありません。右上の「＋ 作品を追加」から登録できます。' })); return; }

      items.forEach(function (p, idx) {
        var thumb = el('div', { class: 'thumb' }, [
          p.thumbnail_url ? EM.thumbImg(p.thumbnail_url, '') : null,
          el('span', { class: 'badge', text: EM.PROVIDER_LABEL[p.provider] || p.provider })
        ]);
        var tags = el('div', { class: 'tags' });
        (p.portfolio_tags || []).forEach(function (t) { tags.appendChild(el('span', { class: 'tag', text: t.tag })); });

        box.appendChild(el('div', { class: 'card pf-item' }, [
          thumb,
          el('div', null, [
            el('h3', { class: 'pf-title', text: p.title }),
            el('p', { class: 'small muted', text: visLabel(p.visibility) + ' / ' + EM.date(p.created_at) }),
            inStock(p) ? el('p', { class: 'small' }, el('span', { class: 'tag tag--accent', text: 'ストックページで使用中' })) : null,
            p.description ? el('p', { class: 'small', text: p.description }) : null,
            tags,
            el('div', { class: 'pf-actions' }, [
              el('button', { class: 'btn btn--sm', type: 'button', text: '↑', 'aria-label': '上へ移動', disabled: idx === 0, onclick: function () { move(idx, -1); } }),
              el('button', { class: 'btn btn--sm', type: 'button', text: '↓', 'aria-label': '下へ移動', disabled: idx === items.length - 1, onclick: function () { move(idx, 1); } }),
              visSelect(p),
              thumbButton(p),
              el('a', { class: 'btn btn--sm btn--ghost', href: EM.safeUrl(p.video_url) || '#', target: '_blank', rel: 'noopener noreferrer', text: p.provider === 'link' ? 'ページを開く' : '動画を開く' }),
              el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '削除', onclick: function () { remove(p); } })
            ])
          ])
        ]));
      });
    }

    function move(idx, dir) {
      var j = idx + dir;
      if (j < 0 || j >= items.length) return;
      var a = items[idx], b = items[j];
      Promise.all([
        sb.from('portfolios').update({ sort_order: j }).eq('id', a.id),
        sb.from('portfolios').update({ sort_order: idx }).eq('id', b.id)
      ]).then(reload).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function inStock(p) { return (p.stock_items || []).length > 0; }

    function inShareLinks(p) {
      return links.some(function (s) {
        return (s.share_link_items || []).some(function (x) { return x.portfolio_id === p.id; });
      });
    }

    function visSelect(p) {
      var sel = el('select', { class: 'select--sm', 'aria-label': '見せ方' }, VIS.map(function (v) {
        return el('option', { value: v[0], text: v[1] });
      }));
      sel.value = p.visibility;
      sel.addEventListener('change', function () {
        var next = sel.value;
        if (next === 'stock_only' && inShareLinks(p) &&
            !confirm('この作品は限定共有リンクに入っています。「パスワードページだけ」にすると、共有リンクには表示されなくなります。よろしいですか？')) {
          sel.value = p.visibility; return;
        }
        sb.from('portfolios').update({ visibility: next }).eq('id', p.id).then(function (r) {
          if (r.error) { sel.value = p.visibility; EM.notice(msg, EM.errorText(r.error), 'error'); }
          else { EM.toast('見せ方を変えました'); reload(); }
        });
      });
      return sel;
    }

    function remove(p) {
      var where = [];
      if (inStock(p)) where.push('ストックページ');
      if (inShareLinks(p)) where.push('限定共有リンク');
      var note = where.length ? '\n\nこの作品は' + where.join('と') + 'でも使われています。作品棚から削除すると、そちらからも消えます。' : '';
      if (!confirm('「' + p.title + '」を作品棚から削除します。よろしいですか？' + note)) return;
      sb.from('portfolios').delete().eq('id', p.id).then(function (r) {
        if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
        else { EM.toast('削除しました'); reload(); }
      });
    }

    /* ---------------- 共有リンク ---------------- */
    function renderPicker() {
      var box = EM.$('#sharePicker');
      EM.clear(box);
      if (!items.length) { box.appendChild(el('p', { class: 'small muted', text: '作品を登録すると選べるようになります。' })); return; }
      var shareable = items.filter(function (p) { return p.visibility !== 'stock_only'; });
      if (!shareable.length) { box.appendChild(el('p', { class: 'small muted', text: '限定リンクで共有できる作品がありません（「パスワードページだけ」の作品は選べません）。' })); return; }
      shareable.forEach(function (p) {
        box.appendChild(el('label', { class: 'checkbox' }, [
          el('input', { type: 'checkbox', value: p.id, dataset: { pf: '1' } }),
          el('span', { text: p.title + (p.visibility === 'link_only' ? '（限定）' : '') })
        ]));
      });
    }

    EM.$('#shareForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var picked = EM.$$('#sharePicker input[data-pf]').filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
      if (!picked.length) { EM.notice(msg, '共有する作品を1つ以上選んでください。', 'error'); return; }

      sb.from('share_links').insert({
        creator_id: creator.id,
        title: EM.$('#shareTitle').value.trim() || null
      }).select('id,token').single().then(function (r) {
        if (r.error) throw r.error;
        return sb.from('share_link_items').insert(picked.map(function (id, i) {
          return { share_link_id: r.data.id, portfolio_id: id, sort_order: i };
        })).then(function () { return r.data; });
      }).then(function (link) {
        EM.$('#shareForm').reset();
        EM.toast('共有リンクを発行しました');
        copy(shareUrl(link.token));
        return reload();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    });

    function shareUrl(token) {
      var origin = (EM.config.SITE_ORIGIN || location.origin).replace(/\/$/, '');
      return origin + '/p/?t=' + token;
    }

    function copy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { EM.toast('リンクをコピーしました'); },
          function () { EM.toast('コピーできませんでした。手動で選択してください'); });
      } else { EM.toast('コピーできませんでした。手動で選択してください'); }
    }

    function renderLinks() {
      var box = EM.$('#shareList');
      EM.clear(box);
      if (!links.length) { box.appendChild(el('div', { class: 'empty', text: '共有リンクはまだありません。' })); return; }
      links.forEach(function (s) {
        var url = shareUrl(s.token);
        box.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'share-row' }, [
            el('div', null, [
              el('p', { class: 'pf-title', text: s.title || '（名称未設定）' }),
              el('p', { class: 'small muted', text: (s.share_link_items || []).length + '作品 / 閲覧 ' + s.view_count + '回 / ' + EM.date(s.created_at) + (s.is_active ? '' : ' / 停止中') })
            ]),
            el('div', { class: 'pf-actions' }, [
              el('button', { class: 'btn btn--sm', type: 'button', text: 'リンクをコピー', onclick: function () { copy(url); } }),
              el('a', { class: 'btn btn--sm btn--ghost', href: '/p/?t=' + encodeURIComponent(s.token), target: '_blank', rel: 'noopener', text: '開く' }),
              el('button', { class: 'btn btn--sm', type: 'button', text: s.is_active ? '停止' : '再開', onclick: function () {
                sb.from('share_links').update({ is_active: !s.is_active }).eq('id', s.id).then(reload);
              } }),
              el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '削除', onclick: function () {
                if (!confirm('この共有リンクを削除します。よろしいですか？')) return;
                sb.from('share_links').delete().eq('id', s.id).then(reload);
              } })
            ])
          ]),
          el('p', { class: 'share-url', text: url })
        ]));
      });
    }
    // 見出しの「＋ 作品を追加」：入力欄へ移ってすぐ入力できるように
    var workAdd = EM.$('#workAddBtn');
    function openAdd() {
      EM.$('#addCard').hidden = false;
      workAdd.hidden = true;   // 開いている間は右上のボタンを隠す（同じボタンを2つ並べない）
      setTimeout(function () { EM.$('#videoUrl').focus(); }, 50);
    }
    function closeAdd() { EM.$('#addCard').hidden = true; workAdd.hidden = false; }
    EM.portfolioCloseAdd = closeAdd;
    workAdd.addEventListener('click', function (e) { e.preventDefault(); openAdd(); });
  });
})(window.EM);
