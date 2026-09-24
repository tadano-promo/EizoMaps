/* Eizo Maps — クリエイター検索・一覧・エリア表示 */
(function (EM) {
  'use strict';

  var REGIONS = [
    ['北海道・東北', ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県']],
    ['関東',         ['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県']],
    ['中部',         ['新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県']],
    ['近畿',         ['三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県']],
    ['中国・四国',   ['鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県']],
    ['九州・沖縄',   ['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']],
    ['その他',       ['海外']]
  ];

  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb();
    var el = EM.el;
    var listView = EM.$('#listView'), mapView = EM.$('#mapView'), count = EM.$('#resultCount');
    var state = { q: '', genres: [], area: '', view: 'list' };
    var all = [], genres = [], ratings = {}, completed = {};
    // 空き状況の絞り込み。busyIds が null のときは絞り込みをしていない状態。
    var busyIds = null;

    // エリア選択肢
    var areaSelect = EM.$('#areaSelect');
    EM.PREFS.forEach(function (p) { areaSelect.appendChild(el('option', { value: p, text: p })); });

    // URL の ?genre= / ?area= / ?q= を初期値に
    state.q = EM.param('q') || '';
    state.area = EM.param('area') || '';
    if (state.q) EM.$('#q').value = state.q;
    if (state.area) areaSelect.value = state.area;

    if (!sb) { renderEmpty('データを読み込めません。'); return; }

    skeletons();

    Promise.all([
      sb.from('genres').select('id,slug,name_ja,sort_order').order('sort_order'),
      sb.from('creators')
        .select('id,user_id,display_name,headline,area_pref,area_city,years_of_experience,response_time_hours,avatar_url,updated_at,creator_genres(genre_id)')
        .eq('is_published', true)
        .order('updated_at', { ascending: false })
        .limit(300),
      sb.from('creator_rating_stats').select('user_id,avg_score,rated_count'),
      sb.from('creator_project_stats').select('creator_id,completed_count')
    ]).then(function (res) {
      if (res[0].data) genres = res[0].data;
      if (res[1].error) { renderEmpty(EM.errorText(res[1].error)); return; }
      all = res[1].data || [];
      (res[2].data || []).forEach(function (r) { ratings[r.user_id] = r; });
      (res[3].data || []).forEach(function (r) { completed[r.creator_id] = r.completed_count; });
      buildGenreChips();
      render();
    }).catch(function (e) { renderEmpty(EM.errorText(e)); });

    function skeletons() {
      EM.clear(listView);
      for (var i = 0; i < 4; i++) listView.appendChild(el('div', { class: 'card skeleton', 'aria-hidden': 'true' }, el('div', { class: 'f-note' }, ' ')));
    }

    function buildGenreChips() {
      var box = EM.$('#genreChips');
      EM.clear(box);
      genres.forEach(function (g) {
        var b = el('button', {
          class: 'chip', type: 'button', 'aria-pressed': 'false', text: g.name_ja,
          onclick: function () {
            var i = state.genres.indexOf(g.id);
            if (i === -1) state.genres.push(g.id); else state.genres.splice(i, 1);
            b.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
            render();
          }
        });
        box.appendChild(b);
      });
    }

    // 絞り込みはすべてブラウザ側で行う（検索語をDBのフィルタ式に混ぜないため）
    function filtered() {
      var q = state.q.trim().toLowerCase();
      return all.filter(function (c) {
        if (state.area && c.area_pref !== state.area) return false;
        if (state.genres.length) {
          var ids = (c.creator_genres || []).map(function (x) { return x.genre_id; });
          for (var i = 0; i < state.genres.length; i++) if (ids.indexOf(state.genres[i]) === -1) return false;
        }
        if (busyIds && busyIds[c.id]) return false;
        if (q) {
          var hay = [c.display_name, c.headline, c.area_pref, c.area_city].join(' ').toLowerCase();
          var gnames = (c.creator_genres || []).map(function (x) {
            var g = genres.filter(function (gg) { return gg.id === x.genre_id; })[0];
            return g ? g.name_ja : '';
          }).join(' ').toLowerCase();
          if (hay.indexOf(q) === -1 && gnames.indexOf(q) === -1) return false;
        }
        return true;
      });
    }

    /* 空き状況での絞り込み。
       サーバーからは「その期間に埋まっている人の ID」だけが返る。
       予定の件名や場所は一切返らない。 */
    function applyAvailability() {
      var from = EM.$('#freeFrom').value, to = EM.$('#freeTo').value;
      var note = EM.$('#freeNote');
      if (!from && !to) { busyIds = null; note.textContent = ''; render(); return; }
      if (!from || !to) { note.textContent = '開始日と終了日の両方を入れてください'; return; }
      if (to < from) { note.textContent = '終了日は開始日以降にしてください'; return; }
      note.textContent = '確認中…';
      sb.rpc('creators_busy_between', { p_from: from, p_to: to }).then(function (r) {
        if (r.error) throw r.error;
        busyIds = {};
        (r.data || []).forEach(function (x) {
          busyIds[typeof x === 'string' ? x : (x && x.creators_busy_between)] = true;
        });
        note.textContent = '空き状況を公開している人のみ判定しています';
        render();
      }).catch(function (e) {
        busyIds = null;
        note.textContent = EM.errorText(e);
        render();
      });
    }
    EM.$('#freeFrom').addEventListener('change', applyAvailability);
    EM.$('#freeTo').addEventListener('change', applyAvailability);

    function genreName(id) {
      var g = genres.filter(function (gg) { return gg.id === id; })[0];
      return g ? g.name_ja : '';
    }

    function card(c) {
      var r = ratings[c.user_id];
      var tags = el('div', { class: 'tags' });
      (c.creator_genres || []).slice(0, 4).forEach(function (x) {
        tags.appendChild(el('span', { class: 'tag', text: genreName(x.genre_id) }));
      });
      var meta = [];
      if (c.area_pref) meta.push(c.area_pref + (c.area_city ? ' ' + c.area_city : ''));
      if (c.years_of_experience !== null && c.years_of_experience !== undefined) meta.push('キャリア' + c.years_of_experience + '年');
      if (c.response_time_hours !== null && c.response_time_hours !== undefined) meta.push('返信目安' + c.response_time_hours + '時間');
      if (completed[c.id]) meta.push('完了' + completed[c.id] + '件');

      return el('a', { class: 'card creator-card', href: '/creators/detail.html?id=' + encodeURIComponent(c.id) }, [
        EM.avatar(c.avatar_url, c.display_name),
        el('div', { class: 'body' }, [
          el('p', { class: 'name', text: c.display_name }),
          el('p', { class: 'headline', text: c.headline || '' }),
          r ? el('span', { class: 'rating' }, [
                el('span', { class: 'stars', text: EM.stars(r.avg_score) }),
                el('span', { class: 'count', text: r.avg_score + '（' + r.rated_count + '件）' })
              ])
            : el('span', { class: 'small muted', text: '評価はまだありません' }),
          tags,
          meta.length ? el('p', { class: 'small muted', text: meta.join(' / ') }) : null
        ])
      ]);
    }

    function renderEmpty(text) {
      EM.clear(listView);
      listView.appendChild(el('div', { class: 'empty', text: text }));
      count.textContent = '';
    }

    function render() {
      var rows = filtered();
      count.textContent = rows.length + ' 名';

      var isMap = state.view === 'map';
      EM.$('#viewList').setAttribute('aria-pressed', isMap ? 'false' : 'true');
      EM.$('#viewMap').setAttribute('aria-pressed', isMap ? 'true' : 'false');
      listView.hidden = isMap;
      mapView.hidden = !isMap;

      if (isMap) { renderMap(rows); return; }

      EM.clear(listView);
      if (!rows.length) { listView.appendChild(el('div', { class: 'empty', text: '条件に合うクリエイターが見つかりませんでした。' })); return; }
      rows.forEach(function (c) { listView.appendChild(card(c)); });
    }

    // 簡易エリア表示。地図APIは使わず、都道府県単位の人数で見せる。
    function renderMap(rows) {
      var counts = {};
      rows.forEach(function (c) { if (c.area_pref) counts[c.area_pref] = (counts[c.area_pref] || 0) + 1; });
      EM.clear(mapView);
      var unset = rows.filter(function (c) { return !c.area_pref; }).length;

      REGIONS.forEach(function (reg) {
        var box = el('div', { class: 'area-region' }, el('h3', { text: reg[0] }));
        var chips = el('div', { class: 'chips' });
        reg[1].forEach(function (pref) {
          var n = counts[pref] || 0;
          chips.appendChild(el('button', {
            class: 'chip area-pref-btn', type: 'button',
            dataset: { empty: n ? 'false' : 'true' },
            'aria-pressed': state.area === pref ? 'true' : 'false',
            onclick: function () {
              state.area = state.area === pref ? '' : pref;
              areaSelect.value = state.area;
              state.view = 'list';
              render();
            }
          }, [pref, el('span', { class: 'n', text: String(n) })]));
        });
        box.appendChild(chips);
        mapView.appendChild(box);
      });
      if (unset) mapView.appendChild(el('p', { class: 'small muted', text: 'エリア未設定：' + unset + ' 名' }));
    }

    EM.$('#searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      state.q = EM.$('#q').value;
      state.view = 'list';
      render();
    });
    areaSelect.addEventListener('change', function () { state.area = areaSelect.value; render(); });
    EM.$('#viewList').addEventListener('click', function () { state.view = 'list'; render(); });
    EM.$('#viewMap').addEventListener('click', function () { state.view = 'map'; render(); });
    EM.$('#clearBtn').addEventListener('click', function () {
      state = { q: '', genres: [], area: '', view: state.view };
      busyIds = null;
      EM.$('#q').value = ''; areaSelect.value = '';
      EM.$('#freeFrom').value = ''; EM.$('#freeTo').value = ''; EM.$('#freeNote').textContent = '';
      EM.$$('#genreChips .chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      render();
    });
  });
})(window.EM);
