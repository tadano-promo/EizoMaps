/* Eizo Maps — ポートフォリオ管理と共有リンク */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var creator = null, items = [], links = [], parsed = null, pickedTags = [];

    EM.requireUser().then(function (u) {
      if (!u) return;
      return sb.from('creators').select('id,display_name').eq('user_id', u.id).maybeSingle();
    }).then(function (r) {
      if (!r) return;
      if (r.error) throw r.error;
      if (!r.data) {
        EM.notice(msg, 'さきにプロフィールを作成してください。', 'error');
        EM.$('#addForm').hidden = true;
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
          .select('id,title,description,provider,video_id,video_url,thumbnail_url,visibility,sort_order,created_at,portfolio_tags(tag)')
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

    var urlInput = EM.$('#videoUrl');
    urlInput.addEventListener('change', preview);
    urlInput.addEventListener('blur', preview);

    function preview() {
      parsed = EM.parseVideoUrl(urlInput.value);
      var box = EM.$('#previewBox'), thumb = EM.$('#previewThumb');
      if (!parsed) {
        box.hidden = true;
        if (urlInput.value.trim()) EM.notice(msg, 'YouTube または Vimeo の URL を入力してください。', 'error');
        return;
      }
      EM.notice(msg, '');
      EM.fetchThumbnail(parsed).then(function (url) {
        parsed.thumbnail_url = url;
        EM.clear(thumb);
        if (url) thumb.appendChild(EM.thumbImg(url, ''));
        thumb.appendChild(el('span', { class: 'badge', text: parsed.provider }));
        box.hidden = false;
      });
    }

    EM.$('#addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!parsed) { preview(); if (!parsed) return; }
      var title = EM.$('#title').value.trim();
      if (!title) { EM.notice(msg, 'タイトルを入力してください。', 'error'); return; }

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
        if (!pickedTags.length) return null;
        return sb.from('portfolio_tags').insert(pickedTags.map(function (t) {
          return { portfolio_id: r.data.id, tag: t };
        }));
      }).then(function () {
        btn.removeAttribute('aria-busy');
        EM.$('#addForm').reset();
        EM.$('#previewBox').hidden = true;
        parsed = null; pickedTags = [];
        EM.$$('#tagChips .chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        EM.toast('作品を登録しました');
        EM.notice(msg, '');
        return reload();
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    });

    /* ---------------- 一覧・並び替え ---------------- */
    function renderList() {
      var box = EM.$('#pfList');
      EM.clear(box);
      EM.$('#pfCount').textContent = '（' + items.length + ' / 30件）';
      if (!items.length) { box.appendChild(el('div', { class: 'empty', text: 'まだ作品がありません。上のフォームから追加してください。' })); return; }

      items.forEach(function (p, idx) {
        var thumb = el('div', { class: 'thumb' }, [
          p.thumbnail_url ? EM.thumbImg(p.thumbnail_url, '') : null,
          el('span', { class: 'badge', text: p.provider })
        ]);
        var tags = el('div', { class: 'tags' });
        (p.portfolio_tags || []).forEach(function (t) { tags.appendChild(el('span', { class: 'tag', text: t.tag })); });

        box.appendChild(el('div', { class: 'card pf-item' }, [
          thumb,
          el('div', null, [
            el('h3', { class: 'pf-title', text: p.title }),
            el('p', { class: 'small muted', text: (p.visibility === 'public' ? '公開' : '限定リンクのみ') + ' / ' + EM.date(p.created_at) }),
            p.description ? el('p', { class: 'small', text: p.description }) : null,
            tags,
            el('div', { class: 'pf-actions' }, [
              el('button', { class: 'btn btn--sm', type: 'button', text: '↑', 'aria-label': '上へ移動', disabled: idx === 0, onclick: function () { move(idx, -1); } }),
              el('button', { class: 'btn btn--sm', type: 'button', text: '↓', 'aria-label': '下へ移動', disabled: idx === items.length - 1, onclick: function () { move(idx, 1); } }),
              el('button', { class: 'btn btn--sm', type: 'button', text: p.visibility === 'public' ? '限定リンクのみにする' : '公開する', onclick: function () { toggleVis(p); } }),
              el('a', { class: 'btn btn--sm btn--ghost', href: EM.safeUrl(p.video_url) || '#', target: '_blank', rel: 'noopener noreferrer', text: '動画を開く' }),
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

    function toggleVis(p) {
      sb.from('portfolios').update({ visibility: p.visibility === 'public' ? 'link_only' : 'public' })
        .eq('id', p.id).then(function (r) {
          if (r.error) EM.notice(msg, EM.errorText(r.error), 'error'); else reload();
        });
    }

    function remove(p) {
      if (!confirm('「' + p.title + '」を削除します。よろしいですか？')) return;
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
      items.forEach(function (p) {
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
  });
})(window.EM);
