/* Eizo Maps — 依頼した会社の評価（一覧と1社分）
   ログインしていなくても見られる。出すのは会社名・都道府県・クリエイターからの評価とコメントだけ。
   依頼した人のお名前や連絡先は出さない。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    if (!sb) return;
    var msg = EM.$('#pageMsg');

    function marks(v) {
      var m = el('div', { class: 'tags review-marks' });
      m.appendChild(el('span', { class: 'tag', text: v.source === 'external' ? 'Eizo Maps外の取引（自己申告）' : 'Eizo Maps での取引' }));
      if (v.objected) m.appendChild(el('span', { class: 'tag tag--warn', text: '本人から異議申し立てあり（運営が確認中）' }));
      else if (v.objection_kept) m.appendChild(el('span', { class: 'tag tag--warn', text: '本人から異議申し立てあり・運営の確認により掲載継続' }));
      return m;
    }

    // ---- 一覧
    var list = EM.$('#companyList');
    if (list) {
      sb.rpc('public_companies').then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.clear(list);
        var rows = r.data || [];
        if (!rows.length) { list.appendChild(el('div', { class: 'empty', text: 'まだ評価の付いた会社はありません。' })); return; }
        var grid = el('div', { class: 'grid grid--3' });
        rows.forEach(function (c) {
          grid.appendChild(el('a', { class: 'card creator-card', href: '/companies/' + encodeURIComponent(c.id) }, [
            el('div', { class: 'body' }, [
              el('p', { class: 'name', text: c.company }),
              c.area_pref ? el('p', { class: 'small muted', text: c.area_pref }) : null,
              el('span', { class: 'rating' }, [
                el('span', { class: 'stars', text: EM.stars(c.avg_score) }),
                el('span', { class: 'count', text: Number(c.avg_score).toFixed(1) + '（' + c.rated_count + '件）' })
              ])
            ])
          ]));
        });
        list.appendChild(grid);
      });
      return;
    }

    // ---- 1社分
    var box = EM.$('#company');
    if (!box) return;
    var pre = document.querySelector('meta[name="em-company-id"]');
    var m = location.pathname.match(/^\/companies\/([0-9a-f-]{36})\/?$/i);
    var id = EM.param('id') || (pre && pre.content) || (m && m[1]) || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) { EM.notice(msg, '会社が指定されていません。', 'error'); return; }

    sb.rpc('public_company', { p_client_id: id }).then(function (r) {
      var d = r && r.data;
      if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
      if (!d) {
        EM.clear(box); EM.$('#reviewSection').hidden = true;
        EM.notice(msg, 'この会社のページは見つかりませんでした（評価がまだないか、公開をやめた可能性があります）。', 'error');
        return;
      }
      document.title = d.company + 'の評価 — Eizo Maps';
      var rows = d.reviews || [];
      var avg = rows.length ? rows.reduce(function (a, b) { return a + Number(b.score); }, 0) / rows.length : 0;
      EM.clear(box);
      box.appendChild(el('p', { class: 'eyebrow', text: 'Client' }));
      box.appendChild(el('h1', { text: d.company }));
      if (d.area_pref) box.appendChild(el('p', { class: 'small muted', text: d.area_pref }));
      box.appendChild(el('div', { class: 'row', id: 'ratingRow' }, el('span', { class: 'rating' }, [
        el('span', { class: 'score', text: avg.toFixed(1) }),
        el('span', { class: 'stars', text: EM.stars(avg) }),
        el('span', { class: 'count', text: rows.length + '件の評価' })
      ])));

      var sec = EM.$('#reviewSection'), listEl = EM.$('#reviewList');
      sec.hidden = false;
      EM.clear(listEl);
      rows.forEach(function (v) {
        listEl.appendChild(el('div', { class: 'review-item' }, [
          el('div', { class: 'review-head' }, [
            el('span', { class: 'rating' }, [
              el('span', { class: 'stars', text: EM.stars(v.score) }),
              el('span', { class: 'count', text: Number(v.score).toFixed(1) })
            ]),
            el('span', { class: 'small muted', text: 'クリエイター / ' + EM.date(v.published_at) })
          ]),
          marks(v),
          el('p', { class: 'small', text: v.comment })
        ]));
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
  });
})(window.EM);
