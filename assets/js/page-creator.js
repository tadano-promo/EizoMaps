/* Eizo Maps — クリエイター詳細 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg'), box = EM.$('#profile');
    var id = EM.param('id');

    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) {
      EM.notice(msg, 'クリエイターが指定されていません。', 'error');
      return;
    }

    Promise.all([
      sb.from('creators')
        .select('id,user_id,display_name,headline,bio,area_pref,area_city,years_of_experience,response_time_hours,avatar_url,website_url,contact_pref,contact_dm_url,creator_genres(genre_id)')
        .eq('id', id).maybeSingle(),
      sb.from('genres').select('id,name_ja'),
      sb.from('portfolios')
        .select('id,title,description,provider,video_id,video_url,thumbnail_url,sort_order,created_at,portfolio_tags(tag)')
        .eq('creator_id', id).eq('visibility', 'public')
        .order('sort_order').order('created_at', { ascending: false }),
      sb.from('creator_project_stats').select('completed_count').eq('creator_id', id).maybeSingle(),
      sb.from('creator_links').select('platform,url,label,sort_order,created_at')
        .eq('creator_id', id).order('sort_order').order('created_at')
    ]).then(function (res) {
      var c = res[0].data;
      if (res[0].error) { EM.notice(msg, EM.errorText(res[0].error), 'error'); return; }
      if (!c) { EM.notice(msg, 'このクリエイターは見つかりませんでした（非公開の可能性があります）。', 'error'); return; }

      var gmap = {}; (res[1].data || []).forEach(function (g) { gmap[g.id] = g.name_ja; });
      document.title = c.display_name + ' — Eizo Maps';

      renderProfile(c, gmap, (res[3].data && res[3].data.completed_count) || 0, res[4].data || []);
      renderPortfolio(res[2].data || []);
      loadReviews(c.user_id);
      mountFollow(c);
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function renderProfile(c, gmap, completedCount, links) {
      var tags = el('div', { class: 'tags' });
      (c.creator_genres || []).forEach(function (x) {
        if (gmap[x.genre_id]) tags.appendChild(el('span', { class: 'tag tag--accent', text: gmap[x.genre_id] }));
      });

      var stats = el('div', { class: 'row' });
      function stat(k, v) { return el('div', { class: 'stat' }, [el('span', { class: 'v', text: v }), el('span', { class: 'k', text: k })]); }
      stats.appendChild(stat('Completed', String(completedCount)));
      if (c.years_of_experience != null) stats.appendChild(stat('Career', c.years_of_experience + 'y'));
      if (c.response_time_hours != null) stats.appendChild(stat('Reply', c.response_time_hours + 'h'));

      var site = EM.safeUrl(c.website_url);

      EM.clear(box);
      box.appendChild(el('div', { class: 'row' }, [
        EM.avatar(c.avatar_url, c.display_name, true),
        el('div', null, [
          el('h1', { text: c.display_name }),
          el('p', { class: 'lead', text: c.headline || '' }),
          el('p', { class: 'small muted', text: [c.area_pref, c.area_city].filter(Boolean).join(' ') })
        ])
      ]));
      box.appendChild(el('div', { class: 'row', id: 'ratingRow' }));
      box.appendChild(tags);
      box.appendChild(stats);
      if (c.bio) box.appendChild(el('p', { class: 'f-note', text: c.bio }));
      if (site) box.appendChild(el('p', null, el('a', { class: 'btn btn--sm', href: site, rel: 'noopener noreferrer nofollow', target: '_blank', text: 'ウェブサイト' })));

      // SNS などの外部リンク
      if ((links || []).length) {
        var row = el('div', { class: 'chips stock-links' });
        links.forEach(function (l) {
          var href = EM.safeUrl(l.url);
          if (!href) return;
          row.appendChild(el('a', {
            class: 'chip', href: href, target: '_blank', rel: 'noopener noreferrer nofollow',
            text: l.label || EM.platformLabel(l.platform)
          }));
        });
        if (row.childNodes.length) box.appendChild(row);
      }

      // 依頼の受け取り方に合わせて導線を出し分ける
      var pref = c.contact_pref || 'form';
      var dm = EM.safeUrl(c.contact_dm_url);
      var actions = el('div', { class: 'form-actions' });
      if (pref === 'form' || pref === 'both') {
        actions.appendChild(el('a', {
          class: 'btn btn--primary',
          href: '/request/?creator_id=' + encodeURIComponent(c.id), text: '依頼する'
        }));
      }
      if ((pref === 'dm' || pref === 'both') && dm) {
        actions.appendChild(el('a', {
          class: pref === 'dm' ? 'btn btn--primary' : 'btn',
          href: dm, target: '_blank', rel: 'noopener noreferrer nofollow',
          text: 'SNS の DM で連絡する'
        }));
      }
      actions.appendChild(el('span', { id: 'followSlot' }));
      actions.appendChild(el('a', { class: 'btn', href: '/contact/', text: 'お問い合わせ' }));
      if (pref === 'dm' && dm) {
        box.appendChild(el('p', { class: 'small muted',
          text: c.display_name + ' さんは SNS の DM での連絡を希望しています。' }));
      }
      box.appendChild(actions);
    }

    /* フォロー。ログインしている人にだけ出す。
       いまは通知の宛先リストを作るためだけの機能。 */
    function mountFollow(c) {
      var slot = EM.$('#followSlot');
      if (!slot) return;
      EM.getUser().then(function (u) {
        if (!u || u.id === c.user_id) return;
        return sb.from('creator_follows').select('creator_id')
          .eq('creator_id', c.id).eq('follower_user_id', u.id).maybeSingle()
          .then(function (r) {
            if (r.error) throw r.error;
            paint(u, !!r.data);
          });
      }).catch(function () { /* フォローは補助機能なので失敗しても黙って出さない */ });

      function paint(u, following) {
        EM.clear(slot);
        var btn = el('button', {
          class: 'btn' + (following ? '' : ' btn--ghost'), type: 'button',
          text: following ? 'フォロー中' : 'フォローする',
          onclick: function () {
            btn.setAttribute('aria-busy', 'true');
            var q = following
              ? sb.from('creator_follows').delete()
                  .eq('creator_id', c.id).eq('follower_user_id', u.id)
              : sb.from('creator_follows').insert({ creator_id: c.id, follower_user_id: u.id });
            q.then(function (r) {
              if (r.error) throw r.error;
              paint(u, !following);
              EM.toast(following ? 'フォローを解除しました' : 'フォローしました');
            }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); })
              .then(function () { btn.removeAttribute('aria-busy'); });
          }
        });
        slot.appendChild(btn);
      }
    }

    function renderPortfolio(items) {
      var sec = EM.$('#portfolioSection'), grid = EM.$('#portfolioGrid');
      sec.hidden = false;
      EM.clear(grid);
      if (!items.length) { grid.appendChild(el('div', { class: 'empty', text: '公開されている作品はまだありません。' })); return; }
      items.forEach(function (p) {
        var embed = EM.embedUrl(p.provider, p.video_id);
        var tags = el('div', { class: 'tags' });
        (p.portfolio_tags || []).forEach(function (t) { tags.appendChild(el('span', { class: 'tag', text: t.tag })); });
        grid.appendChild(el('article', { class: 'card' }, [
          embed ? el('div', { class: 'embed' }, el('iframe', {
            src: embed, title: p.title, loading: 'lazy',
            allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
            allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin'
          })) : null,
          el('h3', { class: 'pf-title', text: p.title }),
          p.description ? el('p', { class: 'small muted', text: p.description }) : null,
          tags
        ]));
      });
    }

    function loadReviews(userId) {
      sb.from('public_reviews')
        .select('id,score,comment,reviewer_role,published_at')
        .eq('reviewee_id', userId)
        .order('published_at', { ascending: false })
        .limit(50)
        .then(function (r) {
          var sec = EM.$('#reviewSection'), list = EM.$('#reviewList');
          sec.hidden = false;
          EM.clear(list);
          var rows = r.data || [];
          if (!rows.length) { list.appendChild(el('div', { class: 'empty', text: 'まだ評価はありません。' })); return; }

          var avg = rows.reduce(function (a, b) { return a + Number(b.score); }, 0) / rows.length;
          var rr = EM.$('#ratingRow');
          if (rr) {
            EM.clear(rr);
            rr.appendChild(el('span', { class: 'rating' }, [
              el('span', { class: 'score', text: avg.toFixed(1) }),
              el('span', { class: 'stars', text: EM.stars(avg) }),
              el('span', { class: 'count', text: rows.length + '件の評価' })
            ]));
          }

          rows.forEach(function (v) {
            list.appendChild(el('div', { class: 'review-item' }, [
              el('div', { class: 'review-head' }, [
                el('span', { class: 'rating' }, [
                  el('span', { class: 'stars', text: EM.stars(v.score) }),
                  el('span', { class: 'count', text: Number(v.score).toFixed(1) })
                ]),
                el('span', { class: 'small muted', text: (v.reviewer_role === 'client' ? 'クライアント' : 'クリエイター') + ' / ' + EM.date(v.published_at) })
              ]),
              el('p', { class: 'small', text: v.comment })
            ]));
          });
        });
    }
  });
})(window.EM);
