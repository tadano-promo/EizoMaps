/* Eizo Maps — おすすめで作られたページ（本人未確認・最小限） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg'), box = EM.$('#recBox');
    var id = EM.param('id');
    if (!sb) return;
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) { EM.notice(msg, 'ページが指定されていません。', 'error'); return; }
    sb.rpc('recommended_creator_card', { p_id: id }).then(function (r) {
      var d = r && r.data;
      if (!d) { EM.notice(msg, 'このページは見つかりませんでした（ご本人のご希望などで外された可能性があります）。', 'error'); return; }
      if (d.status === 'claimed') {
        location.replace(d.handle ? '/@' + d.handle : '/creators/detail.html?id=' + encodeURIComponent(d.creator_id));
        return;
      }
      document.title = d.display_name + '（おすすめで作られたページ） — Eizo Maps';
      var tags = el('div', { class: 'tags' });
      (d.genres || []).forEach(function (g) { tags.appendChild(el('span', { class: 'tag tag--accent', text: g })); });
      var links = el('ul', { class: 'rec-links' });
      (d.links || []).forEach(function (u) {
        var safe = EM.safeUrl(u);
        if (safe) links.appendChild(el('li', null, el('a', { href: safe, target: '_blank', rel: 'noopener noreferrer nofollow ugc', text: safe })));
      });
      EM.clear(box);
      box.appendChild(el('div', { class: 'row profile-head' }, [
        EM.avatar(null, d.display_name, true),
        el('div', { class: 'profile-head__text' }, [
          el('h1', { text: d.display_name }),
          el('p', { class: 'small' }, el('span', { class: 'tag tag--warn', text: 'おすすめで作られたページ（ご本人は未確認）' }))
        ])
      ]));
      box.appendChild(tags);
      box.appendChild(el('h2', { class: 'h3', text: '公開されているページ' }));
      box.appendChild(links);
      if (d.comment) {
        box.appendChild(el('h2', { class: 'h3', text: 'おすすめのひとこと' }));
        box.appendChild(el('p', { class: 'profile-bio', text: d.comment }));
      }
      box.appendChild(el('p', { class: 'small muted', text: 'このページは ' + EM.date(d.created_at) + ' に、ほかの利用者のおすすめで作られました。おすすめした人の名前は出していません。' }));
      box.appendChild(el('div', { class: 'card rec-box stack' }, [
        el('h2', { class: 'h3', text: 'ご本人の方へ' }),
        el('p', { class: 'small', text: 'Eizo Maps に登録して、プロフィールに上と同じ SNS の URL を入れると、「あなたではありませんか？」とお知らせが届きます。「これは私です」を押すと、運営が確認してから、このページをあなたのページにまとめます。' }),
        el('p', { class: 'small', text: 'このページを載せてほしくない場合は、このページの URL を添えて info@eizo-maps.com までご連絡ください。すぐに外します。' }),
        el('div', { class: 'form-actions' }, [
          el('a', { class: 'btn btn--primary btn--sm', href: '/auth/', text: '登録する（無料）' }),
          el('a', { class: 'btn btn--sm', href: 'mailto:info@eizo-maps.com?subject=' + encodeURIComponent('おすすめで作られたページについて') + '&body=' + encodeURIComponent(location.href), text: '載せないでほしい' })
        ])
      ]));
    });
  });
})(window.EM);
