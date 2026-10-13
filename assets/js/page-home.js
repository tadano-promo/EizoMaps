/* Eizo Maps — トップページのお知らせと広告枠
   見えてよいものだけが返るように、絞り込みはサーバー側（RLS）で行う。
   ここでは「返ってきたものを安全に描画する」ことだけを担当する。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    if (!sb) return;

    // ログイン済みなら、登録をすすめる大きな紹介の代わりに「自分用の入口」を出す
    EM.getUser().then(function (u) {
      if (!u) return;
      EM.$('#homeHero').hidden = true;
      EM.$('#homeMe').hidden = false;
      loadMe(u);
    });

    function pad(n) { return String(n).padStart(2, '0'); }
    function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    var WD = ['日', '月', '火', '水', '木', '金', '土'];
    function dayLabel(ymd) {
      var p = String(ymd).split('-');
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）';
    }
    var KIND = { shoot: '撮影', edit: '編集', meeting: '打合せ', delivery: '納品', hold: '仮押さえ', other: 'その他', private: '非公開' };

    function emptyLine(box, text) { EM.clear(box); box.appendChild(el('p', { class: 'small muted', text: text })); }

    function loadMe(u) {
      var t = today();
      Promise.all([
        sb.from('creators').select('id,display_name,is_published').eq('user_id', u.id).maybeSingle(),
        sb.from('schedule_events').select('id,kind,title,starts_on,ends_on,start_time')
          .eq('owner_user_id', u.id).gte('ends_on', t)
          .order('starts_on').order('start_time', { nullsFirst: true }).limit(3),
        sb.from('projects').select('id,title,status,due_on')
          .in('status', ['offered', 'in_progress', 'delivered'])
          .order('due_on', { ascending: true, nullsFirst: false }).limit(3)
      ]).then(function (r) {
        var c = !r[0].error && r[0].data;
        var name = (c && c.display_name) || '';
        EM.$('#homeHello').textContent = name ? 'おかえりなさい、' + name + ' さん' : 'おかえりなさい';
        if (c && c.is_published) {
          var pl = EM.$('#homeMyProfile');
          pl.href = '/creators/detail.html?id=' + encodeURIComponent(c.id);
          pl.hidden = false;
        }

        var next = EM.$('#homeNext');
        var evs = (!r[1].error && r[1].data) || [];
        if (!evs.length) emptyLine(next, 'これからの予定はまだありません。');
        else {
          EM.clear(next);
          evs.forEach(function (e) {
            var when = (e.starts_on <= t ? '今日' : dayLabel(e.starts_on)) + (e.ends_on > e.starts_on ? '〜' + dayLabel(e.ends_on) : '');
            next.appendChild(el('a', { class: 'home-me__row', href: '/schedule/' }, [
              el('span', { class: 'home-me__when mono', text: when + (e.start_time ? ' ' + e.start_time.slice(0, 5) : '') }),
              el('span', { class: 'home-me__tag', text: KIND[e.kind] || '予定' }),
              el('span', { class: 'home-me__title', text: e.title })
            ]));
          });
        }

        var pj = EM.$('#homeProjects');
        var ps = (!r[2].error && r[2].data) || [];
        if (!ps.length) emptyLine(pj, '今動いている案件はありません。');
        else {
          EM.clear(pj);
          ps.forEach(function (p) {
            pj.appendChild(el('a', { class: 'home-me__row', href: '/projects/?id=' + encodeURIComponent(p.id) }, [
              EM.statusBadge(p.status),
              el('span', { class: 'home-me__title', text: p.title }),
              p.due_on ? el('span', { class: 'home-me__when mono', text: '納期 ' + dayLabel(p.due_on) }) : null
            ]));
          });
        }
      }).catch(function () {
        emptyLine(EM.$('#homeNext'), '読み込めませんでした。');
        emptyLine(EM.$('#homeProjects'), '読み込めませんでした。');
      });
    }

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
        // 1行で見せて、押すと本文が開く（目立ちすぎないように）
        var hasMore = !!(n.body || href);
        var row = el(hasMore ? 'summary' : 'div', { class: 'news__row' }, [
          el('span', { class: 'news__date mono', text: EM.date(n.published_at) }),
          el('span', { class: 'news__kind', text: (n.pinned ? '重要・' : '') + (EM.ANNOUNCE_KIND[n.kind] || 'お知らせ') }),
          el('span', { class: 'news__headline', text: n.title })
        ]);
        list.appendChild(el(hasMore ? 'details' : 'div', { class: 'news__item' }, [
          row,
          n.body ? multiline(n.body, 'small muted news__body') : null,
          href ? el('a', {
            class: 'small news__link', href: href, target: '_blank', rel: 'noopener noreferrer',
            text: (n.link_label || '詳しく見る') + ' ↗'
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
