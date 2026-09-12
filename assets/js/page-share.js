/* EizoMaps — 限定共有ポートフォリオページ
   token はテーブルを直接読まず、RPC 経由でのみ解決する */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg'), head = EM.$('#shareHead'), items = EM.$('#shareItems');

    // /p/?t=xxxx と /p/xxxx の両方を受ける
    var token = EM.param('t');
    if (!token) {
      var m = location.pathname.match(/^\/p\/([0-9a-f]{32})\/?$/i);
      if (m) token = m[1];
    }

    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される
    if (!/^[0-9a-f]{32}$/i.test(String(token || ''))) {
      EM.notice(msg, 'リンクが正しくありません。共有された URL をもう一度ご確認ください。', 'error');
      return;
    }

    sb.rpc('get_share_link', { p_token: token.toLowerCase() }).then(function (r) {
      if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
      var d = r.data;
      if (!d) { EM.notice(msg, 'このリンクは無効か、有効期限が切れています。', 'error'); return; }

      sb.rpc('touch_share_link', { p_token: token.toLowerCase() });

      var c = d.creator || {};
      document.title = (d.title || c.display_name || 'ポートフォリオ') + ' — EizoMaps';

      EM.clear(head);
      head.appendChild(el('p', { class: 'eyebrow', text: 'Portfolio' }));
      head.appendChild(el('div', { class: 'row' }, [
        EM.avatar(c.avatar_url, c.display_name, true),
        el('div', null, [
          el('h1', { text: c.display_name || '' }),
          el('p', { class: 'lead', text: c.headline || '' }),
          el('p', { class: 'small muted', text: c.area_pref || '' })
        ])
      ]));
      if (d.note) head.appendChild(el('p', { class: 'f-note', text: d.note }));
      head.appendChild(el('hr', { class: 'divider' }));

      EM.clear(items);
      var list = d.items || [];
      if (!list.length) { items.appendChild(el('div', { class: 'empty', text: '作品が登録されていません。' })); return; }
      list.forEach(function (p) {
        var embed = EM.embedUrl(p.provider, p.video_id);
        items.appendChild(el('article', { class: 'card' }, [
          embed ? el('div', { class: 'embed' }, el('iframe', {
            src: embed, title: p.title, loading: 'lazy',
            allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
            allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin'
          })) : null,
          el('h3', { class: 'pf-title', text: p.title }),
          p.description ? el('p', { class: 'small muted', text: p.description }) : null
        ]));
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
  });
})(window.EM);
