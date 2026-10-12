/* Eizo Maps — 管理画面「評価の確認」
   ・確認待ちの評価：公開 / 掲載しない
   ・異議申し立て：掲載継続（印が付く） / 削除（あまりにも不適切な場合）
   ・掲載継続にしたもの：あとから削除に変えられる（本人から説明があった場合など）
   判断はすべてサーバー側の関数が運営かどうかを確かめてから行う。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var box = EM.$('#adminReviews');
    if (!sb || !box) return;
    var msg = EM.$('#adminReviewMsg');

    EM.requireUser().then(function (u) {
      if (!u) return;
      return EM.roles();
    }).then(function (roles) {
      if (!roles || !roles.admin) return;
      return load();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function load() {
      return sb.rpc('admin_review_queue').then(function (r) {
        if (r.error) throw r.error;
        render(r.data || {});
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function src(v) { return v === 'external' ? 'Eizo Maps外の取引（自己申告）' : 'Eizo Maps での取引'; }

    function base(x, extra) {
      return el('div', { class: 'admin-review' }, [
        el('div', { class: 'myreview__head' }, [
          el('span', { class: 'rating' }, [
            el('span', { class: 'stars', text: EM.stars(x.score) }),
            el('span', { class: 'count', text: Number(x.score).toFixed(1) })
          ]),
          el('span', { class: 'tags' }, [el('span', { class: 'tag', text: src(x.source) })])
        ]),
        el('p', { class: 'small muted', text: extra }),
        el('p', { class: 'myreview__body small', text: x.comment }),
        x.external_note ? el('p', { class: 'admin-review__private', text: '取引の概要（非公開）：' + x.external_note }) : null
      ]);
    }

    function act(label, cls, fn) {
      var b = el('button', { class: 'btn btn--sm ' + (cls || ''), type: 'button', text: label });
      b.addEventListener('click', function () {
        b.setAttribute('aria-busy', 'true');
        Promise.resolve(fn()).then(function (r) {
          if (r && r.error) throw r.error;
          if (r === false) { b.removeAttribute('aria-busy'); return; }
          EM.toast('反映しました');
          EM.notice(msg, '');
          return load();
        }).catch(function (err) {
          b.removeAttribute('aria-busy');
          EM.notice(msg, EM.errorText(err), 'error');
        });
      });
      return b;
    }

    function render(d) {
      EM.clear(box);
      var pend = d.pending || [], objs = d.objections || [], kept = d.kept || [];

      box.appendChild(el('h3', { text: '確認待ちの評価（' + pend.length + '件）' }));
      if (!pend.length) box.appendChild(el('div', { class: 'empty', text: '確認待ちの評価はありません。' }));
      pend.forEach(function (x) {
        var card = base(x, x.reviewer_name + ' さん → ' + x.reviewee_name + ' さん ／ ' + EM.date(x.created_at));
        card.appendChild(el('div', { class: 'form-actions' }, [
          act('公開する', 'btn--primary', function () {
            return sb.rpc('admin_decide_review', { p_review_id: x.id, p_publish: true });
          }),
          act('掲載しない', 'btn--danger', function () {
            if (!confirm('この評価を掲載しません。よろしいですか？')) return false;
            return sb.rpc('admin_decide_review', { p_review_id: x.id, p_publish: false });
          })
        ]));
        box.appendChild(card);
      });

      box.appendChild(el('hr', { class: 'divider' }));
      box.appendChild(el('h3', { text: '異議申し立て（' + objs.length + '件）' }));
      box.appendChild(el('p', { class: 'small muted', text: '削除は「あまりにも不適切」と判断した場合だけ。削除しない場合は「運営の確認により掲載継続」の印が付いて公開され続けます。' }));
      if (!objs.length) box.appendChild(el('div', { class: 'empty', text: '未対応の異議申し立てはありません。' }));
      objs.forEach(function (x) {
        var card = base(x, x.reviewee_name + ' さんへの評価 ／ 公開日 ' + EM.date(x.published_at));
        card.appendChild(el('p', { class: 'admin-review__private', text: '本人からの理由：' + x.reason }));
        var note = el('input', { type: 'text', maxlength: '1000', placeholder: '判断のメモ（本人に表示されます・任意）' });
        card.appendChild(el('label', { class: 'field' }, [el('span', { class: 'label', text: 'メモ' }), note]));
        card.appendChild(el('div', { class: 'form-actions' }, [
          act('掲載継続（印を付ける）', '', function () {
            return sb.rpc('admin_resolve_objection', { p_objection_id: x.id, p_remove: false, p_note: note.value.trim() || null });
          }),
          act('削除する（あまりにも不適切）', 'btn--danger', function () {
            if (!confirm('この評価を削除します。よろしいですか？')) return false;
            return sb.rpc('admin_resolve_objection', { p_objection_id: x.id, p_remove: true, p_note: note.value.trim() || null });
          })
        ]));
        box.appendChild(card);
      });

      box.appendChild(el('hr', { class: 'divider' }));
      box.appendChild(el('h3', { text: '掲載継続にした評価（' + kept.length + '件）' }));
      box.appendChild(el('p', { class: 'small muted', text: '本人から説明があり、やはり削除してよいと判断した場合はここから削除できます。' }));
      if (!kept.length) box.appendChild(el('div', { class: 'empty', text: 'ありません。' }));
      kept.forEach(function (x) {
        var card = base(x, x.reviewee_name + ' さんへの評価 ／ 判断日 ' + EM.date(x.resolved_at));
        card.appendChild(el('p', { class: 'admin-review__private', text: '本人からの理由：' + x.reason + (x.admin_note ? '\n前回のメモ：' + x.admin_note : '') }));
        var note = el('input', { type: 'text', maxlength: '1000', placeholder: '削除の理由（本人に表示されます・任意）' });
        card.appendChild(el('label', { class: 'field' }, [el('span', { class: 'label', text: 'メモ' }), note]));
        card.appendChild(el('div', { class: 'form-actions' }, [
          act('やはり削除する', 'btn--danger', function () {
            if (!confirm('掲載継続にしていた評価を削除します。よろしいですか？')) return false;
            return sb.rpc('admin_resolve_objection', { p_objection_id: x.id, p_remove: true, p_note: note.value.trim() || null });
          })
        ]));
        box.appendChild(card);
      });
    }
  });
})(window.EM);
