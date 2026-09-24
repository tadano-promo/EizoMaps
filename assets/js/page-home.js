/* Eizo Maps — トップページのお知らせと広告枠
   見えてよいものだけが返るように、絞り込みはサーバー側（RLS）で行う。
   ここでは「返ってきたものを安全に描画する」ことだけを担当する。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    if (!sb) return;

    var section = EM.$('#newsSection');
    var list = EM.$('#newsList');
    var adBox = EM.$('#adSlot');

    Promise.all([
      sb.from('announcements')
        .select('id,kind,title,body,link_url,link_label,pinned,published_at')
        .order('pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(5),
      sb.from('ads')
        .select('id,slot,title,body,sponsor,image_url,link_url,sort_order')
        .eq('slot', 'home_top')
        .order('sort_order')
        .limit(3)
    ]).then(function (res) {
      var news = (res[0] && !res[0].error && res[0].data) || [];
      var ads  = (res[1] && !res[1].error && res[1].data) || [];

      if (news.length) renderNews(news);
      if (ads.length)  renderAds(ads);
      if (news.length || ads.length) section.hidden = false;
    }).catch(function () {
      // お知らせは補助的な情報なので、取れなくてもトップページは普通に出す
    });

    // 改行を保ったまま、テキストとしてだけ差し込む（HTML は一切解釈しない）
    function multiline(text, cls) {
      var p = el('p', { class: cls || '' });
      String(text).split(/\r?\n/).forEach(function (line, i) {
        if (i) p.appendChild(el('br'));
        p.appendChild(document.createTextNode(line));
      });
      return p;
    }

    function renderNews(rows) {
      EM.clear(list);
      rows.forEach(function (n) {
        var href = EM.safeUrl(n.link_url);
        list.appendChild(el('article', { class: 'news__item' }, [
          el('div', { class: 'news__meta' }, [
            el('span', { class: 'tag tag--accent', text: EM.ANNOUNCE_KIND[n.kind] || 'お知らせ' }),
            n.pinned ? el('span', { class: 'tag', text: '重要' }) : null,
            el('span', { class: 'small muted mono', text: EM.date(n.published_at) })
          ]),
          el('h3', { class: 'news__headline', text: n.title }),
          n.body ? multiline(n.body, 'small muted news__body') : null,
          href ? el('a', {
            class: 'btn btn--sm', href: href, target: '_blank', rel: 'noopener noreferrer',
            text: n.link_label || '詳しく見る'
          }) : null
        ]));
      });
    }

    function renderAds(rows) {
      EM.clear(adBox);
      adBox.appendChild(el('p', { class: 'eyebrow', text: 'PR' }));
      rows.forEach(function (a) {
        var href = EM.safeUrl(a.link_url);
        if (!href) return;
        var img = EM.safeUrl(a.image_url);
        var imgEl = null;
        if (img) {
          imgEl = el('img', {
            class: 'ad__img', src: img, alt: a.title,
            loading: 'lazy', referrerpolicy: 'no-referrer'
          });
          // 画像が消えていたら、割れた画像を出さずに文字だけにする
          imgEl.addEventListener('error', function () {
            if (imgEl.parentNode) imgEl.parentNode.removeChild(imgEl);
          });
        }
        var card = el('a', {
          class: 'ad', href: href, target: '_blank', rel: 'noopener noreferrer sponsored'
        }, [
          imgEl,
          el('div', { class: 'ad__body' }, [
            el('p', { class: 'ad__title', text: a.title }),
            a.body ? el('p', { class: 'small muted', text: a.body }) : null,
            a.sponsor ? el('p', { class: 'ad__sponsor small muted', text: a.sponsor }) : null
          ])
        ]);
        adBox.appendChild(card);
      });
      if (adBox.childNodes.length > 1) adBox.hidden = false;
    }
  });
})(window.EM);
