/* Eizo Maps — クリエイター詳細 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg'), box = EM.$('#profile');
    // 書き出し済みのページ（/@ハンドル）には、クリエイターの番号が埋め込まれている
    var pre = document.querySelector('meta[name="em-creator-id"]');
    var id = EM.param('id') || (pre && pre.content) || null;
    var handle = String(EM.param('h') || '').replace(/^@/, '').toLowerCase();

    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    // 商談モードで使うため、読み込んだ中身をまとめて持っておく
    var S = { c: null, works: [], packages: [], reviews: [], avg: null, avail: null };

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
        .select('id,user_id,handle,display_name,headline,bio,area_pref,area_city,years_of_experience,response_time_hours,avatar_url,website_url,contact_pref,contact_dm_url,updated_at,share_availability,service_area,travel_ok,equipment,business_type,invoice_registered,moods,creator_genres(genre_id)')
        .eq('id', id).maybeSingle(),
      sb.from('genres').select('id,name_ja'),
      sb.from('portfolios')
        .select('id,title,description,provider,video_id,video_url,thumbnail_url,sort_order,created_at,release_on,takedown_hold,role,media,purpose,industry,length_label,client_display,client_name,pinned,work_year,credits,is_showreel,portfolio_tags(tag)')
        .eq('creator_id', id).eq('visibility', 'public')
        .order('sort_order').order('created_at', { ascending: false }),
      sb.from('creator_project_stats').select('completed_count').eq('creator_id', id).maybeSingle(),
      sb.from('creator_links').select('platform,url,label,sort_order,created_at')
        .eq('creator_id', id).order('sort_order').order('created_at'),
      sb.from('creator_packages').select('id,title,description,price_yen,price_from,delivery_days,revisions,sort_order,created_at')
        .eq('creator_id', id).order('sort_order').order('created_at')
    ]).then(function (res) {
      var c = res[0].data;
      if (res[0].error) { EM.notice(msg, EM.errorText(res[0].error), 'error'); return; }
      if (!c) { showCard(); return; }

      var gmap = {}; (res[1].data || []).forEach(function (g) { gmap[g.id] = g.name_ja; });
      document.title = c.display_name + ' — Eizo Maps';

      S.c = c; S.gmap = gmap; S.completed = (res[3].data && res[3].data.completed_count) || 0;
      S.links = res[4].data || []; S.packages = res[5].data || [];
      renderProfile(c, gmap, S.completed, S.links);
      renderPortfolio(res[2].data || []);
      renderPackages(S.packages);
      loadReviews(c.user_id);
      mountReviewForm(c);
      mountFollow(c);
      mountAvailability(c);
      if (EM.stockShare) EM.stockShare.profile(c);   // 非公開の作品があります（鍵付きページの取り寄せ）
      // ハンドルが決まっている人は、アドレスバーも @ハンドル の形にそろえる
      if (c.handle && history.replaceState) history.replaceState(null, '', '/@' + c.handle);
      // 「?view=pitch」付きで開いたときは、そのまま商談モードで開く（評価・空き状況は届きしだい描き直す）
      if (EM.param('view') === 'pitch') openPitch();
      // 「?w=作品の番号」付きで開いたときは、その作品を全画面で開く（作品ごとのリンクを送れる）
      var wq = EM.param('w');
      if (wq) { var wi = S.works.map(function (x) { return x.id; }).indexOf(wq); if (wi >= 0) openWork(wi); }
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    // 表に中身を出せない人（承認待ち・停止中・非公開）のとき
    function showCard() {
      sb.rpc('creator_card', { p_creator_id: id }).then(function (r) {
        var d = r && r.data;
        if (d && d.state === 'suspended') { EM.notice(msg, 'このクリエイターは、利用規約違反により停止しています。', 'error'); return; }
        if (d && d.state === 'pending') {
          document.title = d.display_name + ' — Eizo Maps';
          EM.clear(box);
          var tags = el('div', { class: 'tags' });
          (d.genres || []).forEach(function (g) { tags.appendChild(el('span', { class: 'tag tag--accent', text: g })); });
          box.appendChild(el('div', { class: 'row profile-head' }, [
            EM.avatar(null, d.display_name, true),
            el('div', { class: 'profile-head__text' }, [
              el('h1', { text: d.display_name }),
              d.handle ? el('p', { class: 'profile-handle mono', text: '@' + d.handle }) : null,
              el('p', { class: 'small' }, el('span', { class: 'tag tag--warn', text: '運営の確認待ち' }))
            ])
          ]));
          box.appendChild(tags);
          box.appendChild(el('p', { class: 'small muted', text: '登録したばかりのクリエイターです。運営の確認が終わると、作品・自己紹介・評価が表示されます。' }));
          return;
        }
        EM.notice(msg, 'このクリエイターは見つかりませんでした（非公開の可能性があります）。', 'error');
      });
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
          el('p', { id: 'availBadge', hidden: true }),
          el('p', { class: 'lead', text: c.headline || '' }),
          el('p', { class: 'small muted', text: [c.area_pref, c.area_city].filter(Boolean).join(' ') }),
        ])
      ]));
      // 評価の平均と職種を1行に
      box.appendChild(el('div', { class: 'head-meta' }, [el('div', { class: 'row', id: 'ratingRow' }), tags]));
      // 自己紹介は2行だけ見せて「さらに表示」で全部（作品を最初の画面に入れるため）
      if (c.bio) {
        var bioP = el('p', { class: 'profile-bio is-clamped', id: 'bioText', text: c.bio });
        var bioBtn = el('button', { class: 'link-btn small', type: 'button', text: 'さらに表示', 'aria-controls': 'bioText', 'aria-expanded': 'false',
          onclick: function () {
            var open = bioP.classList.toggle('is-clamped') === false;
            bioBtn.textContent = open ? 'たたむ' : 'さらに表示';
            bioBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
          } });
        box.appendChild(el('div', { class: 'bio-box' }, [bioP, bioBtn]));
        // 2行に収まる短い紹介なら、ボタンは出さない
        setTimeout(function () { if (bioP.scrollHeight <= bioP.clientHeight + 2) bioBtn.hidden = true; }, 0);
      }
      // 作品をいちばん先に見せるため、自己紹介・数字・基本情報は作品と料金の下（#profileMore）に置く
      var more = EM.$('#profileMore');
      EM.clear(more);
      more.hidden = false;
      more.appendChild(el('hr', { class: 'divider' }));
      more.appendChild(el('p', { class: 'eyebrow', text: 'Profile' }));
      more.appendChild(el('h2', { text: 'プロフィール' }));
      if (c.updated_at) more.appendChild(el('p', { class: 'small muted', text: 'プロフィール更新 ' + EM.date(c.updated_at) }));
      more.appendChild(stats);
      var info = infoList(c);
      if (info) more.appendChild(info);
      if (site) more.appendChild(el('p', null, el('a', { class: 'btn btn--sm', href: site, rel: 'noopener noreferrer nofollow', target: '_blank', text: 'ウェブサイト' })));

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
        if (row.childNodes.length) more.appendChild(row);
      }
      // このページをシェア（goodportfolioさんの参考）
      var pageUrl = location.origin + (c.handle ? '/@' + c.handle : '/creators/detail.html?id=' + encodeURIComponent(c.id));
      more.appendChild(el('div', { class: 'share-row-pf' }, [
        el('span', { class: 'small muted', text: 'このページをシェア' }),
        el('a', { class: 'btn btn--sm', target: '_blank', rel: 'noopener noreferrer',
          href: 'https://x.com/intent/post?text=' + encodeURIComponent(c.display_name + ' のプロフィール｜Eizo Maps') + '&url=' + encodeURIComponent(pageUrl), text: 'X で共有' }),
        el('button', { class: 'btn btn--sm', type: 'button', text: 'URLをコピー', onclick: function () {
          (navigator.clipboard ? navigator.clipboard.writeText(pageUrl) : Promise.reject()).then(function () { EM.toast('URLをコピーしました'); }, function () { prompt('このURLをコピーしてください', pageUrl); });
        } })
      ]));

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
      // このクリエイター本人に届くメッセージ（Eizo Maps 運営へのお問い合わせはフッターから）
      var dmBtn = el('a', { class: 'btn', href: '/messages/?to=' + encodeURIComponent(c.id), text: 'メッセージを送る', title: c.display_name + ' さんに直接メッセージを送れます（ログインが必要です）' });
      actions.appendChild(dmBtn);
      EM.getUser().then(function (u) { if (u && u.id === c.user_id) dmBtn.hidden = true; });
      actions.appendChild(el('button', { class: 'btn btn--ghost', type: 'button', text: '商談で見せる', title: '画面共有用に、要点だけを大きく表示します', onclick: openPitch }));
      // ショーリール（作品の1本を本人が選ぶ）。作品が届いてから出す
      actions.insertBefore(el('button', { class: 'btn btn--reel', type: 'button', id: 'reelBtn', hidden: true, text: '▶ SHOWREEL',
        onclick: function () { var i = S.works.map(function (x) { return x.is_showreel; }).indexOf(true); if (i >= 0) openWork(i); } }), actions.firstChild);
      if (pref === 'dm' && dm) {
        box.appendChild(el('p', { class: 'small muted',
          text: c.display_name + ' さんは SNS の DM での連絡を希望しています。' }));
      }
      box.appendChild(actions);
      mountStickyBar(c, pref, dm);
    }

    /* スクロールして上のボタンが見えなくなったら、画面の下に「○○さんに相談する」を出す */
    function mountStickyBar(c, pref, dm) {
      var old = EM.$('#stickyAsk');
      if (old) old.parentNode.removeChild(old);
      var btns = [];
      if (pref === 'form' || pref === 'both') btns.push(el('a', { class: 'btn btn--primary btn--sm', href: '/request/?creator_id=' + encodeURIComponent(c.id), text: '依頼する' }));
      if ((pref === 'dm' || pref === 'both') && dm) btns.push(el('a', { class: 'btn btn--sm', href: dm, target: '_blank', rel: 'noopener noreferrer nofollow', text: 'SNS の DM' }));
      btns.push(el('a', { class: 'btn btn--sm', href: '/messages/?to=' + encodeURIComponent(c.id), text: 'メッセージを送る' }));
      var bar = el('div', { class: 'sticky-ask', id: 'stickyAsk', 'aria-hidden': 'true' }, [
        el('div', { class: 'wrap sticky-ask__inner' }, [
          el('p', { class: 'sticky-ask__text' }, [el('strong', { text: c.display_name }), document.createTextNode(' さんに相談する')]),
          el('div', { class: 'sticky-ask__btns' }, btns)
        ])
      ]);
      document.body.appendChild(bar);
      // パソコンでは右下にいつも丸い「相談する」（TYOさんの参考）。スマホは下の帯
      var oldFab = EM.$('#askFab');
      if (oldFab) oldFab.parentNode.removeChild(oldFab);
      var fab = el('a', { class: 'ask-fab', id: 'askFab', href: '/messages/?to=' + encodeURIComponent(c.id), 'aria-label': c.display_name + ' さんに相談する' }, [
        el('span', { class: 'ask-fab__main', text: '相談する' }), el('span', { class: 'ask-fab__sub', text: 'メッセージ' })]);
      document.body.appendChild(fab);
      EM.getUser().then(function (u) {
        if (u && u.id === c.user_id) { bar.parentNode && bar.parentNode.removeChild(bar); fab.parentNode && fab.parentNode.removeChild(fab); return; }  // 自分のページでは出さない
        var target = EM.$('#profile .form-actions');
        if (!target || !('IntersectionObserver' in window)) return;
        new IntersectionObserver(function (es) {
          var hidden = es[0].isIntersecting || es[0].boundingClientRect.top > 0;
          bar.classList.toggle('is-shown', !hidden);
          bar.setAttribute('aria-hidden', hidden ? 'true' : 'false');
        }).observe(target);
      });
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
      var WD = ['日', '月', '火', '水', '木', '金', '土'];
      function ymd(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
             + '-' + String(d.getDate()).padStart(2, '0');
      }
      function hm(m) { return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
      // 重なっている時間はまとめて、「6:00〜12:00、14:00〜18:00」のようにする
      function merge(list) {
        list.sort(function (a, b) { return a[0] - b[0]; });
        var out = [];
        list.forEach(function (r) {
          var last = out[out.length - 1];
          if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
          else out.push([r[0], r[1]]);
        });
        return out;
      }
      var loggedIn = false;
      // 時間まで見られるのはログインしている人だけ（ログアウトの人は日付だけ）
      EM.getUser().then(function (u) {
        loggedIn = !!u;
        return Promise.all([
          sb.rpc('creator_busy_days', { p_creator_id: c.id, p_from: ymd(from), p_to: ymd(to) }),
          loggedIn ? sb.rpc('creator_busy_times', { p_creator_id: c.id, p_from: ymd(from), p_to: ymd(to) }) : null
        ]);
      }).then(function (res) {
        var r = res[0];
        if (r.error) return;
        // 予定が1つもない＝60日ずっと空いている（空き状況を公開している人だけ）
        if (!r.data || !r.data.length) { if (c.share_availability) showAvailBadge({}); return; }
        var busy = {};
        r.data.forEach(function (x) {
          busy[typeof x === 'string' ? x : (x && x.creator_busy_days)] = true;
        });
        // 日ごとの「埋まっている時間」（件名などは来ない。時間だけ）
        var times = {};
        ((res[1] && !res[1].error && res[1].data) || []).forEach(function (t) {
          (times[t.day] = times[t.day] || []).push([t.start_min, t.end_min]);
        });
        Object.keys(times).forEach(function (k) { times[k] = merge(times[k]); });
        showAvailBadge(busy);

        var detail = el('p', { class: 'small avail-detail', 'aria-live': 'polite' });
        function show(key, d) {
          var label = (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）';
          var t = times[key];
          if (!busy[key]) { detail.textContent = label + '：空いています'; return; }
          if (!loggedIn) { detail.textContent = label + '：予定あり（ログインすると、予定のある時間が見られます）'; return; }
          if (!t || !t.length) { detail.textContent = label + '：予定あり'; return; }
          var allDay = t.length === 1 && t[0][0] === 0 && t[0][1] >= 1440;
          detail.textContent = label + '：予定あり　' + (allDay ? '終日' : t.map(function (x) { return hm(x[0]) + '〜' + hm(x[1]); }).join('、'));
        }

        var strip = el('div', { class: 'avail' });
        for (var i = 0; i < 60; i++) {
          (function (d) {
            var key = ymd(d);
            // 日付を入れる。月の1日（と最初の日）は「11/1」のように月も出す。土曜は青、日曜・祝日は赤
            var hol = EM.jpHoliday ? EM.jpHoliday(d) : '';
            var wk = hol || d.getDay() === 0 ? ' is-sun' : d.getDay() === 6 ? ' is-sat' : '';
            var label = (i === 0 || d.getDate() === 1) ? (d.getMonth() + 1) + '/' + d.getDate() : String(d.getDate());
            var desc = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）' + (hol ? hol : '') + (busy[key] ? '：予定あり' : '：空いています');
            strip.appendChild(el('button', {
              type: 'button',
              class: 'avail__day' + wk + (busy[key] ? ' is-busy' : '') + (label.length > 2 ? ' is-month' : ''),
              title: desc,
              'aria-label': desc,
              text: label,
              onclick: function () {
                EM.$$('.avail__day.is-picked', strip).forEach(function (b) { b.classList.remove('is-picked'); });
                this.classList.add('is-picked');
                show(key, d);
              }
            }));
          })(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i), i);
        }
        detail.textContent = loggedIn ? '色つきの日を押すと、予定のある時間が見られます。' : 'ログインすると、色つきの日を押して予定のある時間が見られます。';
        EM.$('#profileMore').appendChild(el('div', { class: 'avail-box' }, [
          el('p', { class: 'small muted', text: '今後60日の空き状況（オレンジが予定のある日。青は土曜、赤は日曜・祝日）' }),
          strip,
          detail
        ]));
      }).catch(function () { /* 補助情報なので失敗しても出さない */ });
    }


    function renderPortfolio(items) {
      var sec = EM.$('#portfolioSection'), grid = EM.$('#portfolioGrid');
      sec.hidden = false;
      EM.clear(grid);
      // 本人が自分のページを見たときも、解禁前・一時非公開の作品はほかの人と同じく出さない
      var today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      items = items.filter(function (p) { return !p.takedown_hold && !(p.release_on && p.release_on > today); });
      // 代表作（固定した作品）を先頭に。ほかは並べた順のまま
      items = items.filter(function (p) { return p.pinned; }).concat(items.filter(function (p) { return !p.pinned; }));
      S.works = items;
      var reel = EM.$('#reelBtn');
      if (reel) reel.hidden = !items.some(function (x) { return x.is_showreel; });
      var tabBox = EM.$('#workTabs');
      if (tabBox) { EM.clear(tabBox); tabBox.hidden = true; }
      if (!items.length) { grid.appendChild(el('div', { class: 'empty', text: '公開されている作品はまだありません。' })); return; }
      // ジャンルのタブ：本人が付けたタグ（なければ作品の目的）から、多い順に10個まで
      var count = {}, keyOf = {};
      var useTags = items.some(function (p) { return (p.portfolio_tags || []).length; });
      items.forEach(function (p) {
        var ks = useTags ? (p.portfolio_tags || []).map(function (t) { return t.tag; }) : (p.purpose ? [p.purpose] : []);
        keyOf[p.id] = ks;
        ks.forEach(function (k) { count[k] = (count[k] || 0) + 1; });
      });
      var keys = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 10);
      // 業種（食品・自動車など）でも絞り込める。発注する側は業種で探すことが多いため（TYOさんの参考）
      var indCount = {}, indOf = {};
      items.forEach(function (p) { if (p.industry) { indOf[p.id] = p.industry; indCount[p.industry] = (indCount[p.industry] || 0) + 1; } });
      var inds = Object.keys(indCount).sort(function (a, b) { return indCount[b] - indCount[a]; });
      // 媒体（広告・映画・ドラマ・テレビ番組…の大きな分け方）でも絞り込める（040）
      var medCount = {}, medOf = {};
      items.forEach(function (p) { var g = p.media && EM.mediaGroup ? EM.mediaGroup(p.media) : null; if (g) { medOf[p.id] = g; medCount[g] = (medCount[g] || 0) + 1; } });
      var meds = (EM.MEDIA || []).map(function (g) { return g[0]; }).filter(function (g) { return medCount[g]; });
      var filt = { tag: null, ind: null, med: null };
      function applyFilter() {
        EM.$$('[data-work]', grid).forEach(function (card) {
          var id = card.getAttribute('data-work');
          card.hidden = (filt.tag && (keyOf[id] || []).indexOf(filt.tag) < 0) || (filt.ind && indOf[id] !== filt.ind) || (filt.med && medOf[id] !== filt.med);
        });
      }
      function chipRow(label, list, cnt, key) {
        var row = el('div', { class: 'work-tabs__row', role: 'group', 'aria-label': label });
        if (label) row.appendChild(el('span', { class: 'work-tabs__label small muted', text: label }));
        [null].concat(list).forEach(function (k) {
          row.appendChild(el('button', { type: 'button', class: 'work-tab', 'aria-pressed': k === null ? 'true' : 'false',
            text: (k === null ? 'すべて' : k) + '（' + (k === null ? items.length : cnt[k]) + '）',
            onclick: function () {
              EM.$$('.work-tab', row).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
              this.setAttribute('aria-pressed', 'true');
              filt[key] = k; applyFilter();
            } }));
        });
        return row;
      }
      if (tabBox && (keys.length >= 2 || inds.length >= 2 || meds.length >= 2)) {
        tabBox.hidden = false;
        var many = (keys.length >= 2) + (inds.length >= 2) + (meds.length >= 2) > 1;
        if (meds.length >= 2) tabBox.appendChild(chipRow(many ? '媒体' : '', meds, medCount, 'med'));
        if (keys.length >= 2) tabBox.appendChild(chipRow(many ? 'ジャンル' : '', keys, count, 'tag'));
        if (inds.length >= 2) tabBox.appendChild(chipRow('業種', inds, indCount, 'ind'));
      }
      items.forEach(function (p) {
        var tags = el('div', { class: 'tags' });
        (p.portfolio_tags || []).forEach(function (t) { tags.appendChild(el('span', { class: 'tag', text: t.tag })); });
        var idx = items.indexOf(p);
        grid.appendChild(el('article', { class: 'card work-card', 'data-work': p.id }, [
          EM.workCover(p, function () { openWork(idx); }),
          p.pinned ? el('span', { class: 'tag tag--accent work-pin', text: '代表作' }) : null,
          el('h3', { class: 'pf-title', text: p.title }),
          workMeta(p),
          p.description ? el('p', { class: 'small muted', text: p.description }) : null,
          tags,
          el('p', { class: 'work-report-row' }, el('a', { class: 'work-report', href: '/takedown/?w=' + encodeURIComponent(p.id), text: 'この作品の掲載について申し立てる' }))
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

    /* ---------- 営業で見せるための表示 ---------- */
    function yen(n) { return Number(n).toLocaleString('ja-JP') + '円'; }
    function mdw(d) { return (d.getMonth() + 1) + '/' + d.getDate() + '（' + ['日', '月', '火', '水', '木', '金', '土'][d.getDay()] + '）'; }
    function ymdLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

    // 受付状況：空き状況（予定のある日）から自動で出す。本人は書き換えられない
    function showAvailBadge(busy) {
      var b = EM.$('#availBadge');
      if (!b) return;
      var now = new Date(), free14 = 0, firstFree = null;
      for (var i = 0; i < 60; i++) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        var k = ymdLocal(d);
        if (!busy[k]) { if (i < 14) free14++; if (!firstFree) firstFree = d; }
      }
      var text, cls;
      if (free14 > 0) { text = '受付中：この2週間で空き ' + free14 + '日'; cls = 'is-open'; }
      else if (firstFree) { text = mdw(firstFree) + ' から空きあり'; cls = 'is-later'; }
      else { text = '60日先まで予定が埋まっています'; cls = 'is-full'; }
      S.avail = { text: text, cls: cls };
      b.className = 'avail-badge ' + cls;
      b.textContent = text;
      b.title = '予定表の空き状況から自動で出しています（参考です。確定は相談のうえで）';
      b.hidden = false;
      refreshPitch();
    }

    var BUSINESS = { individual: '個人（フリーランス）', corporation: '法人' };
    function infoRows(c) {
      var rows = [];
      var area = c.service_area || [c.area_pref, c.area_city].filter(Boolean).join(' ');
      if (area || c.travel_ok != null) {
        rows.push(['対応エリア', [area, c.travel_ok === true ? '出張できます' : c.travel_ok === false ? '出張はしていません' : ''].filter(Boolean).join('／')]);
      }
      if (c.moods && c.moods.length) rows.push(['得意な雰囲気', c.moods.join('・')]);
      if (c.equipment) rows.push(['主な機材', c.equipment]);
      if (c.business_type) rows.push(['事業の形', BUSINESS[c.business_type] || '']);
      if (c.invoice_registered != null) rows.push(['インボイス', c.invoice_registered ? '適格請求書発行事業者（登録あり）' : '登録なし']);
      return rows;
    }
    function infoList(c) {
      var rows = infoRows(c);
      if (!rows.length) return null;
      var dl = el('dl', { class: 'info-list' });
      rows.forEach(function (r) { dl.appendChild(el('dt', { text: r[0] })); dl.appendChild(el('dd', { class: 'pre', text: r[1] })); });
      return dl;
    }

    // 作品の「担当・目的・業種・尺・取引先」
    function workMetaText(p) {
      var parts = [];
      if (p.role) parts.push('担当：' + p.role);
      if (p.media) parts.push('媒体：' + p.media);
      if (p.purpose) parts.push('目的：' + p.purpose);
      if (p.industry) parts.push('業種：' + p.industry);
      if (p.length_label) parts.push('尺：' + p.length_label);
      if (p.client_display === 'named' && p.client_name) parts.push('取引先：' + p.client_name);
      else if (p.client_display === 'industry' && p.industry) parts.push('取引先：' + p.industry + 'の企業（社名は非公開）');
      return parts;
    }
    function workMeta(p) {
      var parts = workMetaText(p);
      if (!parts.length) return null;
      var box = el('ul', { class: 'work-meta' });
      parts.forEach(function (t) { box.appendChild(el('li', { text: t })); });
      return box;
    }

    // 料金の目安
    function packageCard(k) {
      var sub = [];
      if (k.delivery_days) sub.push('納品の目安 ' + k.delivery_days + '日');
      if (k.revisions != null) sub.push('修正 ' + k.revisions + '回まで');
      return el('article', { class: 'card pkg' }, [
        el('p', { class: 'pkg__title', text: k.title }),
        el('p', { class: 'pkg__price' }, [
          el('span', { class: 'pkg__yen', text: yen(k.price_yen) }),
          el('span', { class: 'small muted', text: '（税込）' + (k.price_from ? '〜' : '') })
        ]),
        sub.length ? el('p', { class: 'small muted', text: sub.join('／') }) : null,
        k.description ? el('p', { class: 'small pre', text: k.description }) : null
      ]);
    }
    function renderPackages(list) {
      var sec = EM.$('#packageSection'), grid = EM.$('#packageGrid');
      if (!sec || !grid) return;
      EM.clear(grid);
      sec.hidden = !list.length;
      list.forEach(function (k) { grid.appendChild(packageCard(k)); });
    }

    /* ---------- 商談モード（Zoom などの画面共有で見せる用）----------
       メニューやフッターを消して、大きな文字で
       名前・肩書き → 数字 → 代表作 → 料金の目安 → 基本情報 → 評価 → 連絡先（QR）の順に並べる */
    function openPitch() {
      var c = S.c;
      if (!c) return;
      var old = EM.$('#pitch');
      if (old) old.parentNode.removeChild(old);
      var url = location.origin + basePath();

      var tags = el('div', { class: 'tags' });
      (c.creator_genres || []).forEach(function (x) { if (S.gmap[x.genre_id]) tags.appendChild(el('span', { class: 'tag tag--accent', text: S.gmap[x.genre_id] })); });

      function num(v, k) { return el('div', { class: 'pitch-num' }, [el('span', { class: 'v', text: v }), el('span', { class: 'k', text: k })]); }
      var nums = el('div', { class: 'pitch-nums' }, [
        num(String(S.completed), 'Eizo Maps での完了'),
        c.years_of_experience != null ? num(c.years_of_experience + '年', '経験') : null,
        c.response_time_hours != null ? num(c.response_time_hours + '時間', '返信の目安') : null,
        S.reviews.length ? num(S.avg.toFixed(1), '評価（' + S.reviews.length + '件）') : null
      ]);

      var page = el('div', { class: 'pitch-page' });
      page.appendChild(el('header', { class: 'pitch-hero', 'data-label': 'PROFILE' }, [
        EM.avatar(c.avatar_url, c.display_name, true),
        el('div', null, [
          el('h1', { class: 'pitch-name', text: c.display_name }),
          c.headline ? el('p', { class: 'pitch-headline', text: c.headline }) : null,
          tags,
          S.avail ? el('p', { class: 'avail-badge ' + S.avail.cls, text: S.avail.text }) : null
        ])
      ]));
      page.appendChild(nums);

      var pins = S.works.filter(function (p) { return p.pinned; });
      var feat = pins.length ? pins.slice(0, 4) : S.works.slice(0, 3);
      if (feat.length) {
        var g = el('div', { class: 'pitch-works' });
        feat.forEach(function (p) {
          g.appendChild(el('article', { class: 'pitch-work' }, [
            EM.workCover(p, function () { openWork(feat.indexOf(p), feat); }),
            el('h3', { text: p.title }),
            workMeta(p)
          ]));
        });
        page.appendChild(el('section', { class: 'pitch-sec', 'data-label': 'SELECTED' }, [el('h2', { text: '代表作' }), g]));
      }
      // 作品の壁：すき間なしの4列で、全部の作品を並べる（dadabさんの参考）
      if (S.works.length > feat.length) {
        var wall = el('div', { class: 'pitch-wall' });
        S.works.forEach(function (p, i) {
          wall.appendChild(el('div', { class: 'pitch-wall__item', title: p.title || '' }, [
            EM.workCover(p, function () { openWork(i); }),
            el('span', { class: 'pitch-wall__title', text: p.title || '' })
          ]));
        });
        page.appendChild(el('section', { class: 'pitch-sec pitch-sec--wall', 'data-label': 'WORKS' }, [el('h2', { text: '作品（' + S.works.length + '本）' }), wall]));
      }

      if (S.packages.length) {
        var pg = el('div', { class: 'pitch-pkgs' });
        S.packages.forEach(function (k) { pg.appendChild(packageCard(k)); });
        page.appendChild(el('section', { class: 'pitch-sec', 'data-label': 'PRICE' }, [el('h2', { text: '料金の目安' }), pg,
          el('p', { class: 'small muted', text: '内容によって変わります。正式な金額はお見積もりでお伝えします。' })]));
      }

      var rows = infoRows(c);
      if (rows.length) {
        var dl = el('dl', { class: 'info-list info-list--big' });
        rows.forEach(function (r) { dl.appendChild(el('dt', { text: r[0] })); dl.appendChild(el('dd', { class: 'pre', text: r[1] })); });
        page.appendChild(el('section', { class: 'pitch-sec', 'data-label': 'INFO' }, [el('h2', { text: '基本情報' }), dl]));
      }

      if (S.reviews.length) {
        var rl = el('div', { class: 'pitch-reviews' });
        S.reviews.slice(0, 3).forEach(function (v) {
          rl.appendChild(el('blockquote', { class: 'pitch-review' }, [
            el('p', { class: 'stars', text: EM.stars(v.score) + ' ' + Number(v.score).toFixed(1) }),
            el('p', { text: v.comment }),
            el('p', { class: 'small muted', text: (v.reviewer_role === 'client' ? 'クライアント' : 'クリエイター') + '／' + EM.date(v.published_at) + '／' + (v.source === 'external' ? 'Eizo Maps外の取引（自己申告）' : 'Eizo Maps での取引') })
          ]));
        });
        page.appendChild(el('section', { class: 'pitch-sec', 'data-label': 'REVIEWS' }, [el('h2', { text: '評価' }), rl,
          el('p', { class: 'small muted', text: '評価は、実際に取引した人だけが書けます。投稿者の名前は出ません。' })]));
      }

      var qr = null;
      if (window.qrcode) {
        try { var q = window.qrcode(0, 'M'); q.addData(url); q.make(); qr = el('img', { class: 'pitch-qr', src: q.createDataURL(6, 2), alt: 'プロフィールのQRコード', width: 180, height: 180 }); } catch (e) { qr = null; }
      }
      page.appendChild(el('section', { class: 'pitch-sec pitch-contact', 'data-label': 'CONTACT' }, [
        qr,
        el('div', null, [
          el('h2', { text: 'ご連絡はこちら' }),
          el('p', { class: 'pitch-url mono', text: url.replace(/^https?:\/\//, '') }),
          el('p', { class: 'small muted', text: 'スマホのカメラで読み取ると、このページが開きます。' })
        ])
      ]));

      var bar = el('div', { class: 'pitch-bar' }, [
        el('span', { class: 'small muted', text: '商談モード（画面共有用）' }),
        el('button', { class: 'btn btn--sm', type: 'button', text: 'PDFで持ち帰る', title: '印刷の画面で「PDFに保存」を選ぶと、この内容をPDFにできます', onclick: function () { window.print(); } }),
        el('button', { class: 'btn btn--sm', type: 'button', text: '全画面', onclick: function () { if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {}); } }),
        el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '閉じる（Esc）', onclick: closePitch })
      ]);
      // 右端に、いま見ている場所を縦書きで（dadabさんの参考）
      var rail = el('div', { class: 'pitch-rail', 'aria-hidden': 'true', text: 'PROFILE' });
      var wrap = el('div', { id: 'pitch', class: 'pitch', role: 'dialog', 'aria-modal': 'true', 'aria-label': c.display_name + ' の商談モード' }, [bar, page, rail]);
      document.body.appendChild(wrap);
      // 画面の真ん中より上に来ている最後の区切りの名前を出す
      var marks = EM.$$('[data-label]', page);
      function updateRail() {
        var mid = wrap.clientHeight / 2, label = marks.length ? marks[0].getAttribute('data-label') : '';
        marks.forEach(function (n) { if (n.getBoundingClientRect().top <= mid) label = n.getAttribute('data-label'); });
        rail.textContent = label;
      }
      wrap.addEventListener('scroll', updateRail, { passive: true });
      updateRail();
      document.body.classList.add('is-pitch');
      wrap.scrollTop = 0;
      if (history.replaceState) history.replaceState(null, '', basePath() + (basePath().indexOf('?') < 0 ? '?' : '&') + 'view=pitch');
      document.addEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape' && !document.fullscreenElement && !document.body.classList.contains('is-player')) closePitch(); }
    function closePitch() {
      var w = EM.$('#pitch');
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      if (w) w.parentNode.removeChild(w);
      document.body.classList.remove('is-pitch');
      document.removeEventListener('keydown', onKey);
      if (history.replaceState) history.replaceState(null, '', basePath());
    }
    // 作品を全画面で開く
    function openWork(i, list) {
      list = list || S.works;
      var inPitch = !!EM.$('#pitch');
      EM.openPlayer(list, i, {
        creatorName: S.c.display_name,
        askHref: '/messages/?to=' + encodeURIComponent(S.c.id),
        onShow: function (p) { if (!inPitch && history.replaceState) history.replaceState(null, '', basePath() + (basePath().indexOf('?') < 0 ? '?' : '&') + 'w=' + encodeURIComponent(p.id)); },
        onClose: function () { if (!inPitch && history.replaceState) history.replaceState(null, '', basePath()); }
      });
    }

    function basePath() { var c = S.c; return c.handle ? '/@' + c.handle : '/creators/detail.html?id=' + encodeURIComponent(c.id); }
    // 商談モードを開いている間に評価・空き状況が届いたら、描き直す
    function refreshPitch() { var w = EM.$('#pitch'); if (w) { var y = w.scrollTop; openPitch(); EM.$('#pitch').scrollTop = y; } }

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
          S.reviews = rows;
          if (!rows.length) { list.appendChild(el('div', { class: 'empty', text: 'まだ評価はありません。' })); return; }

          var avg = rows.reduce(function (a, b) { return a + Number(b.score); }, 0) / rows.length;
          S.avg = avg;
          refreshPitch();
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
