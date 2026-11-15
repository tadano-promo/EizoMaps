/* Eizo Maps — 募集の一覧（2026-11-15 翠くん）
   だれでも見られる。締め切り前の募集だけ。依頼した人の名前は出さない */
(function (EM) {
  'use strict';

  // 一覧・詳しいページ・トップの部品で使う、募集の小さな部品
  EM.jobDaysLeft = function (closesOn) {
    var n = EM.dayDiff(EM.today(), closesOn);
    return n < 0 ? '締め切りました' : n === 0 ? '今日まで' : 'あと' + n + '日で締め切り';
  };
  EM.jobCard = function (post, genresById, count) {
    var el = EM.el;
    var names = (post.genre_ids || []).map(function (id) { return genresById[id] && genresById[id].name_ja; }).filter(Boolean);
    return el('a', { class: 'card job-card', href: '/jobs/detail.html?id=' + encodeURIComponent(post.id) }, [
      el('div', { class: 'job-card__top' }, [
        el('span', { class: 'job-card__left' + (EM.dayDiff(EM.today(), post.closes_on) <= 3 ? ' is-soon' : ''), text: EM.jobDaysLeft(post.closes_on) }),
        count != null ? el('span', { class: 'small muted', text: '提案 ' + count + '件' }) : null
      ]),
      el('p', { class: 'pf-title job-card__title', text: post.title }),
      el('p', { class: 'small muted', text: [
        post.kind, post.area_pref || 'どこでも', post.remote_ok ? '遠方OK' : '',
        '予算 ' + EM.budgetLabel(post.budget_amount), post.due_on ? '納期 ' + EM.mdw(post.due_on) : ''
      ].filter(Boolean).join(' / ') }),
      names.length ? el('div', { class: 'chips' }, names.map(function (n) { return el('span', { class: 'chip chip--sm', text: n }); })) : null
    ]);
  };

  document.addEventListener('DOMContentLoaded', function () {
    var list = EM.$('#jobsList');
    if (!list) return;   // ほかのページで読み込まれたときは部品だけ
    var sb = EM.sb(), el = EM.el;
    if (!sb) { list.textContent = 'データを読み込めません。'; return; }

    var posts = [], counts = {}, genres = [], byId = {};
    var fGenre = EM.$('#fGenre'), fArea = EM.$('#fArea'), fRemote = EM.$('#fRemote');
    EM.PREFS.forEach(function (p) { fArea.appendChild(el('option', { value: p, text: p })); });

    EM.getUser().then(function (u) { if (u) EM.$('#mineLink').hidden = false; });

    Promise.all([
      EM.jobs.load().catch(function () { return []; }),
      sb.from('job_posts').select('id,title,kind,genre_ids,area_pref,remote_ok,budget_amount,due_on,closes_on,created_at')
        .eq('status', 'open').gte('closes_on', EM.today()).order('created_at', { ascending: false }).limit(300)
    ]).then(function (r) {
      genres = r[0] || [];
      genres.forEach(function (g) { byId[g.id] = g; fGenre.appendChild(el('option', { value: String(g.id), text: g.name_ja })); });
      if (r[1].error) throw r[1].error;
      posts = r[1].data || [];
      if (EM.param('genre')) fGenre.value = EM.param('genre');
      if (EM.param('area')) fArea.value = EM.param('area');
      render();
      if (!posts.length) return;
      return sb.rpc('job_post_counts', { p_posts: posts.map(function (p) { return p.id; }) }).then(function (c) {
        (c.data || []).forEach(function (x) { counts[x.post_id] = x.proposals; });
        render();
      });
    }).catch(function (e) { EM.clear(list); list.appendChild(el('p', { class: 'small muted', text: EM.errorText(e) })); });

    [fGenre, fArea, fRemote].forEach(function (x) { x.addEventListener('change', render); });

    function render() {
      EM.clear(list);
      var g = fGenre.value ? Number(fGenre.value) : null, a = fArea.value, rem = fRemote.checked;
      var rows = posts.filter(function (p) {
        if (g !== null && (p.genre_ids || []).length && (p.genre_ids || []).indexOf(g) === -1) return false;
        if (a && p.area_pref && p.area_pref !== a && !p.remote_ok) return false;
        if (rem && !p.remote_ok) return false;
        return true;
      });
      EM.$('#jobsCount').textContent = posts.length ? rows.length + '件の募集' : '';
      if (!rows.length) {
        list.appendChild(el('div', { class: 'empty' }, [
          document.createTextNode(posts.length ? '条件に合う募集はありません。条件を変えてみてください。' : 'いま出ている募集はありません。'),
          el('br'),
          el('a', { href: '/jobs/new.html', text: '募集を出す →' })
        ]));
        return;
      }
      rows.forEach(function (p) { list.appendChild(EM.jobCard(p, byId, counts[p.id])); });
    }
  });
})(window.EM);
