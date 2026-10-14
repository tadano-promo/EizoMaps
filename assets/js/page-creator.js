/* Eizo Maps — クリエイター詳細 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg'), box = EM.$('#profile');
    var id = EM.param('id');
    var handle = String(EM.param('h') || '').replace(/^@/, '').toLowerCase();

    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    // eizo-maps.com/@ハンドル から来たときは、ハンドルからクリエイターを探す
    var resolve = Promise.resolve(id);
    if (!id && /^[a-z0-9_]{3,20}$/.test(handle)) {
      resolve = sb.rpc('creator_id_by_handle', { p_handle: handle }).then(function (r) { return r.data || null; });
    }
    resolve.then(function (found) {
      id = found;
      if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) {
        EM.notice(msg, handle ? '@' + handle + ' のクリエイターは見つかりませんでした（非公開の可能性があります）。' : 'クリエイターが指定されていません。', 'error');
        return;
      }
      loadAll();
    });

    function loadAll() {
    Promise.all([
      sb.from('creators')
        .select('id,user_id,handle,display_name,headline,bio,area_pref,area_city,years_of_experience,response_time_hours,avatar_url,website_url,contact_pref,contact_dm_url,creator_genres(genre_id)')
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
      mountReviewForm(c);
      mountFollow(c);
      mountAvailability(c);
      // ハンドルが決まっている人は、アドレスバーも @ハンドル の形にそろえる
      if (c.handle && history.replaceState) history.replaceState(null, '', '/@' + c.handle);
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function renderProfile(c, gmap, completedCount, links) {
      var tags = el('div', { class: 'tags' });
      (c.creator_genres || []).forEach(function (x) {
        if (gmap[x.genre_id]) tags.appendChild(el('span', { class: 'tag tag--accent', text: gmap[x.genre_id] }));
      });

      var stats = el('div', { class: 'row profile-stats' });
      function stat(k, v) { return el('div', { class: 'stat' }, [el('span', { class: 'v', text: v }), el('span', { class: 'k', text: k })]); }
      stats.appendChild(stat('Completed', String(completedCount)));
      if (c.years_of_experience != null) stats.appendChild(stat('Career', c.years_of_experience + 'y'));
      if (c.response_time_hours != null) stats.appendChild(stat('Reply', c.response_time_hours + 'h'));

      var site = EM.safeUrl(c.website_url);

      EM.clear(box);
      box.appendChild(el('div', { class: 'row profile-head' }, [
        EM.avatar(c.avatar_url, c.display_name, true),
        el('div', { class: 'profile-head__text' }, [
          el('h1', { text: c.display_name }),
          c.handle ? el('p', { class: 'profile-handle mono', text: '@' + c.handle }) : null,
          el('p', { class: 'lead', text: c.headline || '' }),
          el('p', { class: 'small muted', text: [c.area_pref, c.area_city].filter(Boolean).join(' ') })
        ])
      ]));
      box.appendChild(el('div', { class: 'row', id: 'ratingRow' }));
      box.appendChild(tags);
      box.appendChild(stats);
      if (c.bio) box.appendChild(el('p', { class: 'profile-bio', text: c.bio }));
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

    /* 空き状況。公開している人だけ、埋まっている日付だけが返る。
       件名・場所・メモはサーバーから出てこない。 */
    function mountAvailability(c) {
      var from = new Date();
      var to = new Date(); to.setDate(to.getDate() + 59);
      function ymd(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
             + '-' + String(d.getDate()).padStart(2, '0');
      }
      sb.rpc('creator_busy_days', { p_creator_id: c.id, p_from: ymd(from), p_to: ymd(to) })
        .then(function (r) {
          if (r.error || !r.data || !r.data.length) return;
          var busy = {};
          r.data.forEach(function (x) {
            busy[typeof x === 'string' ? x : (x && x.creator_busy_days)] = true;
          });
          var strip = el('div', { class: 'avail' });
          for (var i = 0; i < 60; i++) {
            var d = new Date(); d.setDate(d.getDate() + i);
            var key = ymd(d);
            strip.appendChild(el('i', {
              class: 'avail__day' + (busy[key] ? ' is-busy' : ''),
              title: key + (busy[key] ? '：埋まっています' : '：空いています')
            }));
          }
          box.appendChild(el('div', { class: 'avail-box' }, [
            el('p', { class: 'small muted', text: '今後60日の空き状況（色つきが埋まっている日）' }),
            strip
          ]));
        }).catch(function () { /* 補助情報なので失敗しても出さない */ });
    }

    function renderPortfolio(items) {
      var sec = EM.$('#portfolioSection'), grid = EM.$('#portfolioGrid');
      sec.hidden = false;
      EM.clear(grid);
      if (!items.length) { grid.appendChild(el('div', { class: 'empty', text: '公開されている作品はまだありません。' })); return; }
      items.forEach(function (p) {
        var tags = el('div', { class: 'tags' });
        (p.portfolio_tags || []).forEach(function (t) { tags.appendChild(el('span', { class: 'tag', text: t.tag })); });
        grid.appendChild(el('article', { class: 'card' }, [
          EM.workMedia(p),
          el('h3', { class: 'pf-title', text: p.title }),
          p.description ? el('p', { class: 'small muted', text: p.description }) : null,
          tags
        ]));
      });
    }

    // 評価に付ける印（取引の種類・異議申し立て）
    function reviewMarks(v) {
      var marks = el('div', { class: 'tags review-marks' });
      marks.appendChild(el('span', { class: 'tag',
        text: v.source === 'external' ? 'Eizo Maps外の取引（自己申告）' : 'Eizo Maps での取引' }));
      if (v.objected) {
        marks.appendChild(el('span', { class: 'tag tag--warn', text: '本人から異議申し立てあり（運営が確認中）' }));
      } else if (v.objection_kept) {
        marks.appendChild(el('span', { class: 'tag tag--warn', text: '本人から異議申し立てあり・運営の確認により掲載継続' }));
      }
      return marks;
    }

    /* 評価を書く（Eizo Maps の外で依頼し、完了した人向け）
       書けるのはログインしている人だけ。自分自身には書けない。
       公開は運営の確認後。名前は出さない。 */
    function mountReviewForm(c) {
      var box = EM.$('#reviewWrite');
      if (!box) return;
      EM.getUser().then(function (u) {
        EM.clear(box);
        if (!u) {
          box.appendChild(el('p', { class: 'small muted' }, [
            'このクリエイターに依頼したことがある方は、',
            el('a', { href: '/auth/?next=' + encodeURIComponent(location.pathname + location.search), text: 'ログイン' }),
            'すると評価を書けます。'
          ]));
          return;
        }
        if (u.id === c.user_id) return;
        return sb.from('reviews').select('id,status')
          .eq('reviewer_id', u.id).eq('reviewee_id', c.user_id).eq('source', 'external').maybeSingle()
          .then(function (r) {
            if (r.data) {
              var label = { pending: '運営が確認中です', published: '公開されています', rejected: '運営の判断で掲載していません',
                            withdrawn: '取り下げ済みです', removed: '運営が削除しました' }[r.data.status] || '';
              box.appendChild(el('p', { class: 'small muted', text: 'このクリエイターへのあなたの評価は' + label + '。（マイページの「評価」から確認できます）' }));
              return;
            }
            box.appendChild(buildForm(u, c));
          });
      }).catch(function () {});
    }

    function buildForm(u, c) {
      var wrap = el('div', { class: 'card review-form' });
      var open = el('button', { class: 'btn', type: 'button', text: 'このクリエイターの評価を書く' });
      var form = el('form', { class: 'stack', hidden: true, novalidate: true });

      var scoreSel = el('select', { 'aria-label': '評価' });
      [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].forEach(function (n) {
        scoreSel.appendChild(el('option', { value: String(n), text: EM.stars(n) + '  ' + n.toFixed(1) }));
      });
      var comment = el('textarea', { maxlength: '2000', rows: '5', placeholder: '依頼した内容、進め方、仕上がりなど（20文字以上）' });
      var note = el('input', { type: 'text', maxlength: '300', placeholder: '例：2026年8月 飲食店のSNS動画3本' });
      var agree = el('input', { type: 'checkbox' });
      var send = el('button', { class: 'btn btn--primary', type: 'submit', text: '運営に送る' });

      form.appendChild(el('p', { class: 'small muted', text: 'Eizo Maps の外で依頼し、取引が完了した方向けです。送った評価は運営が確認してから公開されます。' }));
      form.appendChild(el('label', { class: 'field' }, [el('span', { class: 'label', text: '評価' }), scoreSel]));
      form.appendChild(el('label', { class: 'field' }, [el('span', { class: 'label', text: 'コメント（公開されます・20〜2000文字）' }), comment]));
      form.appendChild(el('label', { class: 'field' }, [
        el('span', { class: 'label', text: '取引の概要（公開されません・運営の確認用）' }), note,
        el('span', { class: 'hint', text: 'いつ頃、どんな依頼をしたか。案件名を出せない場合はぼかして大丈夫です。' })
      ]));
      form.appendChild(el('label', { class: 'checkbox' }, [agree,
        el('span', { text: 'このクリエイターに実際に依頼し、取引が完了しています。事実と違う内容は削除の対象になることを了承します。' })]));
      form.appendChild(el('div', { class: 'form-actions' }, send));

      open.addEventListener('click', function () { open.hidden = true; form.hidden = false; });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var cm = comment.value.trim(), nt = note.value.trim();
        if (cm.length < 20) { EM.notice(msg, 'コメントは20文字以上で書いてください。', 'error'); return; }
        if (nt.length < 5) { EM.notice(msg, '取引の概要を5文字以上で書いてください（公開はされません）。', 'error'); return; }
        if (!agree.checked) { EM.notice(msg, '内容の確認にチェックを入れてください。', 'error'); return; }
        send.setAttribute('aria-busy', 'true');
        sb.from('reviews').insert({
          reviewer_id: u.id, reviewee_id: c.user_id, reviewer_role: 'client',
          score: Number(scoreSel.value), comment: cm, source: 'external', external_note: nt
        }).then(function (r) {
          if (r.error) throw r.error;
          EM.notice(msg, '');
          EM.clear(wrap);
          wrap.appendChild(el('p', { text: '評価を送りました。運営が確認してから公開されます。ありがとうございました。' }));
        }).catch(function (err) {
          send.removeAttribute('aria-busy');
          EM.notice(msg, EM.errorText(err), 'error');
          msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });

      wrap.appendChild(open);
      wrap.appendChild(form);
      return wrap;
    }

    function loadReviews(userId) {
      sb.from('public_reviews')
        .select('id,score,comment,reviewer_role,published_at,source,objected,objection_kept')
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
              reviewMarks(v),
              el('p', { class: 'small', text: v.comment })
            ]));
          });
        });
    }
  });
})(window.EM);
