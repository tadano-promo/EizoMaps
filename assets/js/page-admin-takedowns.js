/* Eizo Maps — 管理画面「作品の削除の申し立て」
   ・届いた申し立ては、その時点で作品が一時非公開になっている
   ・「認める」＝非公開のまま ／「認めない」＝（ほかに申し立てがなければ）公開に戻す
   判断はサーバー側の関数が運営かどうかを確かめてから行う。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var box = EM.$('#adminTakedowns');
    if (!sb || !box) return;
    var msg = EM.$('#adminTakedownMsg');
    var REASON = { confidential: '守秘義務・公開前の作品', copyright: '著作権', portrait: '肖像権', impersonation: 'なりすまし・実績の偽り', other: 'その他' };
    var RELATION = { client: 'クライアント', agency: '代理店', production: '制作会社', performer: '出演者', creator: '制作に関わった人', other: 'その他' };
    var STATUS = { open: '未判断', upheld: '認めた（非公開のまま）', rejected: '認めなかった（公開に戻した）' };

    EM.requireUser().then(function (u) {
      if (!u) return;
      return EM.roles();
    }).then(function (roles) {
      if (!roles || !roles.admin) return;
      return load();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function load() {
      return sb.rpc('admin_takedown_queue').then(function (r) {
        if (r.error) throw r.error;
        render(r.data || []);
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function render(list) {
      EM.clear(box);
      if (!list.length) { box.appendChild(el('div', { class: 'empty', text: '申し立てはありません。' })); return; }
      list.forEach(function (t) {
        var days = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
        var card = el('div', { class: 'card stack' }, [
          el('div', { class: 'row' }, [
            el('strong', { text: t.work_title || '（作品は削除済み）' }),
            el('span', { class: 'tag' + (t.status === 'open' ? ' tag--warn' : ''), text: STATUS[t.status] + (t.status === 'open' ? '・' + days + '日経過' : '') })
          ]),
          el('p', { class: 'small muted', text: '載せた人：' + (t.creator_name || '不明') + ' ／ 届いた日：' + EM.date(t.created_at) }),
          t.video_url ? el('p', { class: 'small' }, el('a', { href: EM.safeUrl(t.video_url) || '#', target: '_blank', rel: 'noopener noreferrer', text: '作品の動画を開く' })) : null,
          el('p', { class: 'small', text: '申立人：' + t.requester_name + (t.requester_org ? '（' + t.requester_org + '）' : '') + ' ／ ' + (RELATION[t.relation] || t.relation) + ' ／ ' + t.requester_email }),
          el('p', { class: 'small', text: '理由：' + (REASON[t.reason] || t.reason) }),
          el('p', { class: 'small pre', text: t.detail }),
          el('p', { class: 'small' }, [el('span', { class: 'muted', text: '載せた人の言い分：' }),
            document.createTextNode(t.creator_response ? t.creator_response : 'まだありません')]),
          t.decided_note ? el('p', { class: 'small muted', text: '判断のメモ：' + t.decided_note }) : null
        ]);
        if (t.status === 'open') {
          var note = el('input', { type: 'text', maxlength: 2000, placeholder: '判断のメモ（例：制作会社さんにメールで確認、許可なしと回答あり）' });
          card.appendChild(note);
          card.appendChild(el('div', { class: 'row' }, [
            el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '認める（非公開のまま）', onclick: function () { decide(t, true, note.value); } }),
            el('button', { class: 'btn btn--sm', type: 'button', text: '認めない（公開に戻す）', onclick: function () { decide(t, false, note.value); } })
          ]));
        }
        box.appendChild(card);
      });
    }

    function decide(t, uphold, note) {
      if (!confirm(uphold ? '申し立てを認めます。作品は非公開のままになります。' : '申し立てを認めません。ほかに申し立てがなければ作品は公開に戻ります。')) return;
      sb.rpc('admin_decide_takedown', { p_id: t.id, p_uphold: uphold, p_note: note || '' }).then(function (r) {
        if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
        else { EM.toast('判断を記録しました'); load(); }
      });
    }
  });
})(window.EM);
