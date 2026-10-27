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
        return Promise.all([loadSuspensions(), loadRecs()]);
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    // ---- 利用規約違反による停止 ----
    var REASONS = [
      ['false_works', '虚偽の実績（他人の作品・関わっていない作品を載せた）'],
      ['impersonation', 'なりすまし'],
      ['fraud', '評価の不正・詐欺的な行為'],
      ['other', 'その他の規約違反']
    ];
    function reasonText(k) { for (var i = 0; i < REASONS.length; i++) if (REASONS[i][0] === k) return REASONS[i][1]; return k; }

    function suspendForm(c, holder) {
      EM.clear(holder);
      var m = el('div', { class: 'notice', hidden: true });
      var reason = el('select', { 'aria-label': '理由' }, REASONS.map(function (r) { return el('option', { value: r[0], text: r[1] }); }));
      var note = el('textarea', { rows: 3, maxlength: 4000, placeholder: '何があったか（運営の中だけの記録。本人や外には出ません）' });
      var ev = el('textarea', { rows: 2, maxlength: 4000, placeholder: '証拠（URL・届いた連絡の要点など。なくても可）' });
      var ok = el('input', { type: 'checkbox' });
      var go = el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '止める' });
      var cancel = el('button', { class: 'btn btn--sm', type: 'button', text: 'やめる' });
      cancel.addEventListener('click', function () { EM.clear(holder); });
      go.addEventListener('click', function () {
        if (note.value.trim().length < 5) { EM.notice(m, '何があったかを5文字以上で書いてください。', 'error'); return; }
        if (!ok.checked) { EM.notice(m, '確認のチェックを入れてください。', 'error'); return; }
        go.disabled = true;
        sb.rpc('admin_suspend_creator', { p_creator_id: c.id, p_reason: reason.value, p_note: note.value, p_evidence: ev.value })
          .then(function (r) {
            if (r.error) throw r.error;
            EM.notice(msg, (c.display_name || 'このクリエイター') + ' を停止しました。', 'success');
            return load();
          }).catch(function (e) { go.disabled = false; EM.notice(m, EM.errorText(e), 'error'); });
      });
      holder.appendChild(el('div', { class: 'card stack suspend-form' }, [
        el('p', { class: 'small', text: '止めると：ログインできなくなり、プロフィール・作品・ストックページ・限定共有リンクがすべて見えなくなります。同じメールアドレス・Google アカウント・@ハンドルでは登録し直せません。データは証拠として残り、あとで解除もできます。' }),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '理由' }), reason]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '何があったか（必須）' }), note]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '証拠' }), ev]),
        el('label', { class: 'checkbox' }, [ok, el('span', { text: '内容を確かめたうえで止めます' })]),
        m,
        el('div', { class: 'form-actions' }, [go, cancel])
      ]));
    }

    function loadRecs() {
      var rb = EM.$('#adminRecs');
      if (!rb) return;
      return sb.rpc('admin_recommendations').then(function (r) {
        if (r.error) throw r.error;
        EM.clear(rb);
        var rows = r.data || [];
        if (!rows.length) { rb.appendChild(el('div', { class: 'empty', text: 'まだおすすめで作られたページはありません。' })); return; }
        rows.forEach(function (x) {
          var st = x.status === 'open' ? '公開中（本人未確認）' : x.status === 'claimed' ? '本人のページにまとめ済み（' + (x.claimed_creator || '') + '）' : '外した' + (x.removed_reason ? '：' + x.removed_reason : '');
          var claims = el('div', { class: 'stack' });
          (x.claims || []).forEach(function (cl) {
            var row = el('div', { class: 'form-actions' }, [el('span', { class: 'small', text: '名乗り出：' + cl.creator_name + '（' + EM.date(cl.created_at) + '・' + ({ pending: '確認待ち', approved: '認めた', rejected: '認めなかった' })[cl.status] + '）' })]);
            if (cl.status === 'pending') {
              [['認めて、まとめる', true, 'btn--primary'], ['認めない', false, '']].forEach(function (b) {
                var bt = el('button', { class: 'btn btn--sm ' + b[2], type: 'button', text: b[0] });
                bt.addEventListener('click', function () {
                  bt.disabled = true;
                  sb.rpc('admin_decide_claim', { p_claim_id: cl.id, p_approve: b[1] }).then(function (q) { if (q.error) throw q.error; EM.toast('記録しました'); return loadRecs(); })
                    .catch(function (e) { bt.disabled = false; EM.notice(msg, EM.errorText(e), 'error'); });
                });
                row.appendChild(bt);
              });
            }
            claims.appendChild(row);
          });
          var rm = null, holder = el('div');
          if (x.status === 'open') {
            rm = el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '表から外す' });
            rm.addEventListener('click', function () {
              EM.clear(holder);
              var why = el('input', { type: 'text', maxlength: 200, placeholder: '外す理由（例：ご本人から連絡があった）' });
              var ok = el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '外すのを確定' });
              ok.addEventListener('click', function () {
                ok.disabled = true;
                sb.rpc('admin_remove_recommendation', { p_rec_id: x.id, p_reason: why.value }).then(function (q) { if (q.error) throw q.error; EM.toast('表から外しました'); return loadRecs(); })
                  .catch(function (e) { ok.disabled = false; EM.notice(msg, EM.errorText(e), 'error'); });
              });
              holder.appendChild(el('div', { class: 'stack' }, [why, el('div', { class: 'form-actions' }, [ok])]));
            });
          }
          rb.appendChild(el('div', { class: 'admin-review' }, [
            el('div', { class: 'myreview__head' }, [el('strong', { text: x.display_name }), el('span', { class: 'small muted', text: EM.date(x.created_at) })]),
            el('p', { class: 'small', text: st }),
            el('p', { class: 'small muted', text: (x.links || []).join('　') }),
            x.comment ? el('p', { class: 'small', text: 'ひとこと：' + x.comment }) : null,
            el('p', { class: 'admin-review__private', text: 'おすすめした人（運営だけに見えています）：' + (x.recommended_by || '—') }),
            claims,
            el('div', { class: 'form-actions' }, [x.status === 'open' ? el('a', { class: 'btn btn--sm', href: '/creators/rec.html?id=' + encodeURIComponent(x.id), target: '_blank', rel: 'noopener', text: 'ページを開く' }) : null, rm]),
            holder
          ]));
        });
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function loadSuspensions() {
      var box2 = EM.$('#adminSuspensions');
      if (!box2) return;
      return sb.rpc('admin_suspensions').then(function (r) {
        if (r.error) throw r.error;
        EM.clear(box2);
        var rows = r.data || [];
        if (!rows.length) { box2.appendChild(el('div', { class: 'empty', text: 'まだ止めたアカウントはありません。' })); return; }
        rows.forEach(function (s) {
          var holder = el('div');
          var actions = null;
          if (!s.lifted_at) {
            var lift = el('button', { class: 'btn btn--sm', type: 'button', text: '解除する' });
            lift.addEventListener('click', function () {
              EM.clear(holder);
              var m = el('div', { class: 'notice', hidden: true });
              var why = el('input', { type: 'text', maxlength: 2000, placeholder: '解除する理由（例：本人の作品だと確認できた）' });
              var yes = el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '解除を確定' });
              yes.addEventListener('click', function () {
                yes.disabled = true;
                sb.rpc('admin_lift_suspension', { p_suspension_id: s.id, p_note: why.value }).then(function (r2) {
                  if (r2.error) throw r2.error;
                  EM.notice(msg, '停止を解除しました。公開に戻すかどうかは本人が決めます。', 'success');
                  return load();
                }).catch(function (e) { yes.disabled = false; EM.notice(m, EM.errorText(e), 'error'); });
              });
              holder.appendChild(el('div', { class: 'stack' }, [why, m, el('div', { class: 'form-actions' }, [yes])]));
            });
            actions = el('div', { class: 'form-actions' }, [lift]);
          }
          box2.appendChild(el('div', { class: 'admin-review' }, [
            el('div', { class: 'myreview__head' }, [
              el('strong', { text: s.display_name || '（名前未設定）' }),
              el('span', { class: 'tag ' + (s.lifted_at ? '' : 'tag--warn'), text: s.lifted_at ? '解除済み' : '停止中' })
            ]),
            el('p', { class: 'small', text: '理由：' + reasonText(s.reason) + '　／　止めた日 ' + EM.date(s.suspended_at) + (s.lifted_at ? '　／　解除 ' + EM.date(s.lifted_at) : '') }),
            el('p', { class: 'admin-review__private', text: '記録：' + s.note }),
            s.evidence ? el('p', { class: 'admin-review__private', text: '証拠：' + s.evidence }) : null,
            s.lifted_note ? el('p', { class: 'small muted', text: '解除の理由：' + s.lifted_note }) : null,
            actions, holder
          ]));
        });
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
        el('option', { value: 'waiting', text: '確認待ちの評価がある人' }),
        el('option', { value: 'suspended', text: '停止中の人' }),
        el('option', { value: 'unapproved', text: '承認待ちの人' })
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
      if (state.filter === 'suspended' && !c.suspended) return false;
      if (state.filter === 'unapproved' && (c.approved || !c.is_published)) return false;
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
        if (c.suspended) tags.appendChild(el('span', { class: 'tag tag--warn', text: '停止中（利用規約違反）' }));
        else tags.appendChild(el('span', { class: 'tag ' + (c.is_published ? 'tag--accent' : ''), text: c.is_published ? '公開中' : '非公開' }));
        if (!c.suspended && !c.approved) tags.appendChild(el('span', { class: 'tag tag--warn', text: c.is_published ? '承認待ち（活動名と職種だけ表示中）' : '未承認' }));
        (c.genres || []).forEach(function (g) { tags.appendChild(el('span', { class: 'tag', text: g })); });
        if (Number(c.reviews_waiting) > 0) tags.appendChild(el('span', { class: 'tag tag--warn', text: '確認待ちの評価 ' + c.reviews_waiting + '件' }));

        var area = [c.area_pref, c.area_city].filter(Boolean).join(' ');
        var stats = [
          '作品 ' + c.works + '件（公開 ' + c.works_public + '・パスワードページだけ ' + c.works_stock_only + '）',
          'ストックページ：' + (c.stock_slug ? (c.stock_active ? '公開中' : '非公開') : 'なし'),
          '限定共有リンク ' + c.share_links + '件',
          '評価 ' + c.reviews_public + '件' + (c.review_avg != null ? '（平均 ' + Number(c.review_avg).toFixed(1) + '）' : '')
        ];

        var aBtn = null;
        if (!c.suspended) {
          aBtn = el('button', { class: 'btn btn--sm ' + (c.approved ? '' : 'btn--primary'), type: 'button', text: c.approved ? '承認を取り消す' : '承認する' });
          aBtn.addEventListener('click', function () {
            aBtn.disabled = true;
            sb.rpc('admin_set_creator_approval', { p_creator_id: c.id, p_approved: !c.approved }).then(function (r) {
              if (r.error) throw r.error;
              EM.toast(c.approved ? '承認を取り消しました' : '承認しました。作品・自己紹介・評価が表に出ます');
              return load();
            }).catch(function (e) { aBtn.disabled = false; EM.notice(msg, EM.errorText(e), 'error'); });
          });
        }
        var sHolder = el('div');
        var sBtn = null;
        if (!c.suspended) {
          sBtn = el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '利用規約違反で止める' });
          sBtn.addEventListener('click', function () { suspendForm(c, sHolder); });
        }
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
              : el('span', { class: 'small muted', text: c.suspended ? '停止中なので表には何も出ていません' : '非公開なのでプロフィールは表に出ていません' }),
            aBtn,
            sBtn
          ]),
          sHolder
        ]));
      });
    }
  });
})(window.EM);
