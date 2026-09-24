/* Eizo Maps — ストックページの閲覧（パスワード保護）
   中身はテーブルから直接取らない。open_stock_page RPC が唯一の入口。
   認証が通るまでサーバーは1文字も返さない。
   解除後の中身はメモリ上だけに置き、保存しない（共有端末での覗き見防止）。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    var slug = String(EM.param('u') || '').toLowerCase();
    var lock = EM.$('#lockBox');
    var content = EM.$('#contentBox');

    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(slug)) {
      EM.notice(msg, 'ページの URL が正しくありません。共有された URL をもう一度ご確認ください。', 'error');
      return;
    }

    lock.hidden = false;
    document.title = 'ストックページ — Eizo Maps';

    // ロック画面に出すのはタイトルと持ち主の名前だけ（中身は含まない）
    sb.rpc('get_stock_page_meta', { p_slug: slug }).then(function (r) {
      if (r.error) throw r.error;
      var head = EM.$('#lockHead');
      EM.clear(head);
      if (!r.data) {
        head.appendChild(el('h1', { text: '限定ページ' }));
        head.appendChild(el('p', { class: 'small muted',
          text: 'このページは現在ご覧いただけません。URL とパスワードをご確認ください。' }));
        return;
      }
      head.appendChild(el('div', { class: 'lock__who' }, [
        EM.avatar(r.data.avatar_url, r.data.creator_name),
        el('div', null, [
          el('p', { class: 'eyebrow', text: 'Protected' }),
          el('h1', { text: r.data.title || '限定ページ' }),
          el('p', { class: 'small muted', text: (r.data.creator_name || '') + ' さんの限定ページです' })
        ])
      ]));
      document.title = (r.data.title || 'ストックページ') + ' — Eizo Maps';
    }).catch(function () { /* メタ情報は出せなくても入力は続けられる */ });

    EM.$('#lockForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = EM.$('#password').value;
      if (!pw) return;
      var btn = EM.$('#openBtn');
      btn.setAttribute('aria-busy', 'true');
      EM.notice(msg, '');
      sb.rpc('open_stock_page', { p_slug: slug, p_password: pw }).then(function (r) {
        if (r.error) throw r.error;
        if (!r.data) {
          EM.notice(msg, 'パスワードが違います。', 'error');
          EM.$('#password').value = '';
          EM.$('#password').focus();
          return;
        }
        EM.$('#password').value = '';
        render(r.data);
      }).catch(function (err) {
        EM.notice(msg, EM.errorText(err), 'error');
      }).then(function () { btn.removeAttribute('aria-busy'); });
    });

    /* ---------------- 表示 ---------------- */
    function render(data) {
      lock.hidden = true;
      content.hidden = false;
      var page = data.page || {}, c = data.creator || {};
      document.title = (page.title || 'ストックページ') + ' — Eizo Maps';

      var head = EM.$('#stockHead');
      EM.clear(head);
      head.appendChild(el('div', { class: 'stock-head' }, [
        el('div', { class: 'stock-head__who' }, [
          EM.avatar(c.avatar_url, c.display_name),
          el('div', null, [
            el('p', { class: 'eyebrow', text: 'Portfolio stock' }),
            el('h1', { text: page.title || '' }),
            el('p', { class: 'small muted', text: [c.display_name, c.headline, c.area_pref].filter(Boolean).join(' ／ ') })
          ])
        ]),
        el('button', {
          class: 'btn btn--sm', type: 'button', text: 'ページを閉じる',
          onclick: function () { location.reload(); }
        })
      ]));
      if (page.intro) head.appendChild(multiline(page.intro, 'lead stock-intro'));
      if ((data.links || []).length) head.appendChild(linkRow(data.links));

      var box = EM.$('#stockItems');
      EM.clear(box);
      (data.items || []).forEach(function (it) { box.appendChild(block(it)); });
      if (!(data.items || []).length) {
        box.appendChild(el('div', { class: 'empty stock-block--full' },
          el('p', { text: 'まだ中身が登録されていません。' })));
      }

      EM.clear(EM.$('#stockFoot')).appendChild(contactBox(c));
      window.scrollTo(0, 0);
    }

    // 改行を <br> ではなくテキストノード＋br で組み立てる（HTML を混ぜない）
    function multiline(text, cls) {
      var p = el('p', { class: cls || '' });
      String(text).split(/\r?\n/).forEach(function (line, i) {
        if (i) p.appendChild(el('br'));
        p.appendChild(document.createTextNode(line));
      });
      return p;
    }

    function linkRow(links) {
      var row = el('div', { class: 'chips stock-links' });
      links.forEach(function (l) {
        var href = EM.safeUrl(l.url);
        if (!href) return;
        row.appendChild(el('a', {
          class: 'chip', href: href, target: '_blank', rel: 'noopener noreferrer',
          text: l.label || EM.platformLabel(l.platform)
        }));
      });
      return row;
    }

    function block(it) {
      var cls = 'stock-block stock-block--' + (it.width === 'half' ? 'half' : 'full');

      if (it.kind === 'heading') {
        return el('div', { class: 'stock-block stock-block--full stock-block--heading' },
          el('h2', { text: it.title || '' }));
      }

      if (it.kind === 'note') {
        return el('div', { class: cls },
          el('div', { class: 'card stack' }, [
            it.title ? el('h3', { text: it.title }) : null,
            multiline(it.description || '', 'stock-note')
          ]));
      }

      if (it.kind === 'video') {
        return el('div', { class: cls }, videoCard(it));
      }

      // doc / link
      var href = EM.safeUrl(it.url);
      return el('div', { class: cls },
        el('div', { class: 'card stack' }, [
          el('span', { class: 'tag tag--accent', text: it.kind === 'doc' ? '資料' : 'リンク' }),
          el('h3', { text: it.title || (href || '') }),
          it.description ? multiline(it.description, 'small muted') : null,
          href ? el('a', {
            class: 'btn btn--sm', href: href, target: '_blank', rel: 'noopener noreferrer',
            text: it.kind === 'doc' ? '資料を開く' : 'リンクを開く'
          }) : el('p', { class: 'small muted', text: 'リンクを表示できません。' })
        ]));
    }

    // 動画はクリックされてから iframe を読み込む（初期表示を軽くする）
    function videoCard(it) {
      var embed = EM.embedUrl(it.provider, it.video_id);
      var vertical = EM.isVertical(it.provider);
      var frame = el('div', { class: 'embed' + (vertical ? ' embed--vertical' : '') });

      function load() {
        if (!embed) return;
        EM.clear(frame);
        frame.appendChild(el('iframe', {
          src: embed, title: it.title || '動画', loading: 'lazy',
          allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
          referrerpolicy: 'strict-origin-when-cross-origin', allowfullscreen: true
        }));
      }

      var cover = el('button', { class: 'embed__cover', type: 'button',
        'aria-label': (it.title || '動画') + ' を再生', onclick: load });
      var thumb = EM.safeUrl(it.thumbnail_url);
      if (thumb) {
        var img = EM.thumbImg(thumb, it.title || '');
        // サムネイルが取得できないときは、割れた画像を出さずに消す
        img.addEventListener('error', function () {
          if (img.parentNode) img.parentNode.removeChild(img);
        });
        cover.appendChild(img);
      }
      cover.appendChild(el('span', { class: 'embed__play', text: '▶' }));
      cover.appendChild(el('span', { class: 'badge', text: EM.PROVIDER_LABEL[it.provider] || '動画' }));
      frame.appendChild(cover);

      return el('div', { class: 'card stack' }, [
        frame,
        it.title ? el('h3', { text: it.title }) : null,
        it.description ? multiline(it.description, 'small muted') : null,
        EM.safeUrl(it.url) ? el('a', {
          class: 'small muted stock-src', href: EM.safeUrl(it.url),
          target: '_blank', rel: 'noopener noreferrer', text: '元の動画を開く'
        }) : null
      ]);
    }

    function contactBox(c) {
      var pref = c.contact_pref || 'form';
      var box = el('div', { class: 'card stack stock-contact' }, [
        el('h2', { text: 'この内容について相談する' })
      ]);
      var actions = el('div', { class: 'form-actions' });

      if ((pref === 'form' || pref === 'both') && c.id) {
        actions.appendChild(el('a', {
          class: 'btn btn--primary', href: '/request/?creator_id=' + encodeURIComponent(c.id),
          text: 'Eizo Maps から依頼する'
        }));
      }
      var dm = EM.safeUrl(c.contact_dm_url);
      if ((pref === 'dm' || pref === 'both') && dm) {
        actions.appendChild(el('a', {
          class: 'btn', href: dm, target: '_blank', rel: 'noopener noreferrer',
          text: 'SNS の DM で連絡する'
        }));
      }

      if (!actions.childNodes.length) {
        box.appendChild(el('p', { class: 'small muted',
          text: '連絡先は、この URL を共有してくれた方にお問い合わせください。' }));
      } else {
        if (pref === 'dm') {
          box.appendChild(el('p', { class: 'small muted',
            text: (c.display_name || 'このクリエイター') + ' さんは SNS の DM での連絡を希望しています。' }));
        }
        box.appendChild(actions);
      }
      return box;
    }
  });
})(window.EM);
