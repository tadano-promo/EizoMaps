/* Eizo Maps — 管理画面「途中キャンセルの申請」（2026-11-25 翠くん）
   当事者どうしで決まらない申請を、運営が中身を見て取り消せる。判断の理由は2人に届き、記録に残る */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var box = EM.$('#adminCancels');
    if (!sb || !box) return;
    var msg = EM.$('#adminCancelMsg');
    var STATUS_JA = { open: '返事待ち', agreed: '同意してキャンセル', declined: '同意なし', withdrawn: '取り下げ', no_reply: '返事がなく、取り消し', admin: '運営が取り消し' };

    function load() {
      return sb.rpc('admin_cancel_requests').then(function (r) {
        if (r.error) throw r.error;
        render(r.data || []);
      });
    }
    EM.requireUser().then(function (u) {
      if (!u) return;
      return EM.roles();
    }).then(function (roles) {
      if (!roles || !roles.admin) return;
      return load();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function render(rows) {
      EM.clear(box);
      if (!rows.length) { box.appendChild(el('div', { class: 'empty', text: '途中キャンセルの申請はありません。' })); return; }
      var need = rows.filter(function (q) { return (q.status === 'open' || q.status === 'declined') && q.project_status === 'in_progress'; }).length;
      box.appendChild(el('p', { class: 'small', text: '決まっていないもの ' + need + '件 ／ ぜんぶで ' + rows.length + '件' }));
      rows.forEach(function (q) {
        var can = (q.status === 'open' || q.status === 'declined') && q.project_status === 'in_progress';
        var card = el('div', { class: 'card stack' }, [
          el('p', { class: 'pf-title' }, [el('a', { href: '/projects/?id=' + encodeURIComponent(q.project_id), text: q.title })]),
          el('p', { class: 'small muted', text: 'クライアント：' + q.client_name + '　／　クリエイター：' + q.creator_name }),
          el('p', { class: 'small', text: (q.requester_role === 'client' ? 'クライアントが申請' : 'クリエイターが申請') + '：' + EM.cancelReasonLabel(q.reason_code) + (q.reason_note ? '　／　' + q.reason_note : '') }),
          q.settle ? el('p', { class: 'small muted', text: 'お金の希望：' + EM.cancelSettleLabel(q.settle) }) : null,
          el('div', { class: 'row' }, [
            el('span', { class: 'tag' + (can ? ' tag--accent' : ''), text: STATUS_JA[q.status] || q.status }),
            q.reason_disputed ? el('span', { class: 'tag', text: '理由には同意なし' }) : null,
            el('span', { class: 'small muted', text: '申請 ' + EM.date(q.created_at) + (q.responded_at ? '　返事 ' + EM.date(q.responded_at) : '') })
          ]),
          q.respond_note ? el('p', { class: 'small muted', text: '相手のひとこと：' + q.respond_note }) : null,
          q.admin_note ? el('p', { class: 'small muted', text: '運営の判断：' + q.admin_note }) : null
        ]);
        if (can) {
          var note = el('textarea', { rows: 2, maxlength: 500, placeholder: '判断の理由（当事者の2人に届きます。例：やり取りを確かめたところ、2週間、進み具合の連絡がありませんでした）' });
          card.appendChild(note);
          function go(fault) {
            if (!note.value.trim()) { EM.notice(msg, '判断の理由を書いてください。', 'error'); return; }
            if (!confirm('この案件を、運営として取り消します。元に戻せません。\n' + (fault ? '申請の理由を認めます（相手の記録に数えます）。' : '理由は認めません（「同意していません」と同じ扱いにします）。'))) return;
            sb.rpc('admin_project_cancel', { p_request: q.id, p_fault: fault, p_note: note.value }).then(function (r) {
              if (r.error) { EM.notice(msg, r.error.message && !r.error.code ? r.error.message : EM.errorText(r.error), 'error'); return; }
              EM.toast('取り消しました'); load();
            });
          }
          card.appendChild(el('div', { class: 'form-actions' }, [
            el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '取り消す（理由を認める）', onclick: function () { go(true); } }),
            el('button', { class: 'btn btn--sm', type: 'button', text: '取り消す（理由は認めない）', onclick: function () { go(false); } })
          ]));
          card.appendChild(el('p', { class: 'small muted', text: '先に、案件のページでやり取りを読んでから判断してください。' }));
        }
        box.appendChild(card);
      });
    }
  });
})(window.EM);
