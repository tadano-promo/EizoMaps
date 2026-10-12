/* Eizo Maps — 管理画面「クリエイター一覧」
   運営だけが見られる。データは admin_list_creators（サーバー側で運営か確認）から取る。
   画面はユーザー入力を textContent でしか出さない。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var box = EM.$('#adminCreators');
    if (!sb || !box) return;
    var msg = EM.$('#adminCreatorMsg');
    var all = [];
    var state = { q: '', filter: 'all', sort: 'new' };

    EM.requireUser().then(function (u) {
      if (!u) return;
      return EM.roles();
    }).then(function (roles) {
      if (!roles || !roles.admin) return;
      return load();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function load() {
      return sb.rpc('admin_list_creators').then(function (r) {
        if (r.error) throw r.error;
        all = r.data || [];
        renderControls();
        renderList();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function renderControls() {
      var bar = EM.$('#adminCreatorBar');
      if (!bar || bar.childNodes.length) return;
      var q = el('input', { type: 'search', placeholder: '名前・職種・エリア・メールで探す', 'aria-label': '検索' });
      q.addEventListener('input', function () { state.q = q.value.trim().toLowerCase(); renderList(); });
      var f = el('select', { class: 'select--sm', 'aria-label': 'しぼりこみ' }, [
        el('option', { value: 'all', text: 'すべて' }),
        el('option', { value: 'public', text: '公開中だけ' }),
        el('option', { value: 'private', text: '非公開だけ' }),
        el('option', { value: 'noworks', text: '作品がまだない人' }),
        el('option', { value: 'waiting', text: '確認待ちの評価がある人' })
      ]);
      f.addEventListener('change', function () { state.filter = f.value; renderList(); });
      var s = el('select', { class: 'select--sm', 'aria-label': '並び順' }, [
        el('option', { value: 'new', text: '登録が新しい順' }),
        el('option', { value: 'updated', text: '更新が新しい順' }),
        el('option', { value: 'works', text: '作品が多い順' }),
        el('option', { value: 'name', text: '名前順' })
      ]);
      s.addEventListener('change', function () { state.sort = s.value; renderList(); });
      bar.appendChild(el('div', { class: 'admin-creator-bar' }, [q, f, s]));
    }

    function matches(c) {
      if (state.filter === 'public' && !c.is_published) return false;
      if (state.filter === 'private' && c.is_published) return false;
      if (state.filter === 'noworks' && Number(c.works) > 0) return false;
      if (state.filter === 'waiting' && !(Number(c.reviews_waiting) > 0)) return false;
      if (!state.q) return true;
      var hay = [c.display_name, c.headline, c.area_pref, c.area_city, c.email]
        .concat(c.genres || []).join(' ').toLowerCase();
      return hay.indexOf(state.q) !== -1;
    }

    function sorted(list) {
      var a = list.slice();
      if (state.sort === 'updated') a.sort(function (x, y) { return String(y.updated_at).localeCompare(String(x.updated_at)); });
      else if (state.sort === 'works') a.sort(function (x, y) { return Number(y.works) - Number(x.works); });
      else if (state.sort === 'name') a.sort(function (x, y) { return String(x.display_name || '').localeCompare(String(y.display_name || ''), 'ja'); });
      return a;
    }

    function renderList() {
      var list = EM.$('#adminCreatorList');
      EM.clear(list);
      var rows = sorted(all.filter(matches));
      EM.$('#adminCreatorCount').textContent = '（' + rows.length + ' / ' + all.length + '人）';
      if (!rows.length) { list.appendChild(el('div', { class: 'empty', text: all.length ? '条件に合うクリエイターはいません。' : 'まだクリエイターの登録はありません。' })); return; }

      rows.forEach(function (c) {
        var tags = el('div', { class: 'tags' });
        tags.appendChild(el('span', { class: 'tag ' + (c.is_published ? 'tag--accent' : ''), text: c.is_published ? '公開中' : '非公開' }));
        (c.genres || []).forEach(function (g) { tags.appendChild(el('span', { class: 'tag', text: g })); });
        if (Number(c.reviews_waiting) > 0) tags.appendChild(el('span', { class: 'tag tag--warn', text: '確認待ちの評価 ' + c.reviews_waiting + '件' }));

        var area = [c.area_pref, c.area_city].filter(Boolean).join(' ');
        var stats = [
          '作品 ' + c.works + '件（公開 ' + c.works_public + '・パスワードページだけ ' + c.works_stock_only + '）',
          'ストックページ：' + (c.stock_slug ? (c.stock_active ? '公開中' : '非公開') : 'なし'),
          '限定共有リンク ' + c.share_links + '件',
          '評価 ' + c.reviews_public + '件' + (c.review_avg != null ? '（平均 ' + Number(c.review_avg).toFixed(1) + '）' : '')
        ];

        list.appendChild(el('div', { class: 'admin-review' }, [
          el('div', { class: 'myreview__head' }, [
            el('strong', { text: c.display_name || '（名前未設定）' }),
            el('span', { class: 'small muted', text: '登録 ' + EM.date(c.created_at) + ' ／ 更新 ' + EM.date(c.updated_at) })
          ]),
          c.headline ? el('p', { class: 'small', text: c.headline }) : null,
          tags,
          el('p', { class: 'small muted admin-creator-stats', text: stats.join('　／　') }),
          el('p', { class: 'small muted', text: [area || 'エリア未設定',
            c.years_of_experience != null ? '経験 ' + c.years_of_experience + '年' : null,
            '最終ログイン ' + (EM.date(c.last_sign_in_at) || '—')].filter(Boolean).join(' ／ ') }),
          el('p', { class: 'admin-review__private', text: '連絡先（運営だけに見えています）：' + (c.email || '—') }),
          el('div', { class: 'form-actions' }, [
            c.is_published
              ? el('a', { class: 'btn btn--sm', href: '/creators/detail.html?id=' + encodeURIComponent(c.id), target: '_blank', rel: 'noopener', text: 'プロフィールを開く' })
              : el('span', { class: 'small muted', text: '非公開なのでプロフィールは表に出ていません' })
          ])
        ]));
      });
    }
  });
})(window.EM);
