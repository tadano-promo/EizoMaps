/* Eizo Maps — 管理画面「作品の削除の申し立て」
   10/31 タキさん：
   ・メールの確認が済んだ申し立てだけが「受付」。その時点で作品は一時非公開になっている
   ・押した人の記録（メール・アカウント・接続元・これまでの申し立て）は運営だけが見る
   ・判断はかならず人がする。理由は必須（申し立てた人と作品を載せた人の両方に伝える）
   ・事実と違う申し立ては「いたずら」の印を付け、くり返す人は受付を止める
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

    function md(s) { if (!s) return ''; var p = String(s).split('-'); return (+p[1]) + '/' + (+p[2]); }
    function daysLeft(due) {
      if (!due) return null;
      var d = new Date(due + 'T23:59:59+09:00').getTime();
      return Math.ceil((d - Date.now()) / 86400000);
    }

    function render(list) {
      EM.clear(box);
      if (!list.length) { box.appendChild(el('div', { class: 'empty', text: '申し立てはありません。' })); return; }
      list.forEach(function (t) {
        var confirmed = !!t.verified_at;
        var tag;
        if (!confirmed) tag = el('span', { class: 'tag', text: 'メールの確認待ち（作品は止めていない）' });
        else if (t.status === 'open') {
          var left = daysLeft(t.due_on);
          tag = el('span', { class: 'tag ' + (left !== null && left <= 1 ? 'tag--danger' : 'tag--warn'),
            text: '未判断・目安 ' + md(t.due_on) + (left !== null ? (left < 0 ? '（' + (-left) + '日過ぎています）' : '（あと' + left + '日）') : '') });
        } else tag = el('span', { class: 'tag', text: STATUS[t.status] + (t.abusive ? '・いたずら' : '') });

        var h = t.history || {};
        var histText = 'この人のほかの申し立て：' + (h.total || 0) + '件'
          + (h.rejected ? '（認めなかった ' + h.rejected + '件）' : '')
          + (h.abusive ? '（いたずら ' + h.abusive + '件）' : '')
          + (h.unconfirmed ? '（確認しなかった ' + h.unconfirmed + '件）' : '');

        var card = el('div', { class: 'card stack' + (confirmed ? '' : ' muted') }, [
          el('div', { class: 'row' }, [el('strong', { text: t.work_title || '（作品は削除済み）' }), tag]),
          el('p', { class: 'small muted', text: '載せた人：' + (t.creator_name || '不明') + ' ／ 送られた日時：' + EM.datetime(t.created_at) + (confirmed ? ' ／ 受付（メール確認）：' + EM.datetime(t.verified_at) : '') }),
          t.video_url ? el('p', { class: 'small' }, el('a', { href: EM.safeUrl(t.video_url) || '#', target: '_blank', rel: 'noopener noreferrer', text: '作品の動画を開く' })) : null,
          el('p', { class: 'small', text: '理由：' + (REASON[t.reason] || t.reason) + ' ／ 関係：' + (RELATION[t.relation] || t.relation) }),
          el('p', { class: 'small pre', text: t.detail }),
          el('p', { class: 'small' }, [el('span', { class: 'muted', text: '載せた人の言い分：' }),
            document.createTextNode(t.creator_response ? t.creator_response + '（' + EM.datetime(t.responded_at) + '）' : 'まだありません')])
        ]);

        // 押した人の記録（運営だけ）
        var who = el('details', { class: 'small' }, [
          el('summary', { text: '押した人の記録（運営だけが見られます）' + (t.blocked ? ' ・受付を止めています' : '') }),
          el('p', { text: '名前：' + t.requester_name + (t.requester_org ? '（' + t.requester_org + '）' : '') }),
          el('p', { text: 'メール：' + t.requester_email + (confirmed ? '（確認済み）' : '（未確認）') }),
          el('p', { text: 'アカウント：' + (t.requester_user_id ? t.requester_user_id + (t.requester_account ? ' ／ ' + t.requester_account : '') : 'なし') }),
          el('p', { text: '接続元の印：' + (t.ip_tag || '不明') + ' ／ ブラウザ：' + (t.user_agent || '不明') }),
          el('p', { text: histText })
        ]);
        card.appendChild(who);

        if (t.decided_note) card.appendChild(el('p', { class: 'small muted', text: '判断の理由：' + t.decided_note + '（' + EM.datetime(t.decided_at) + '）' }));

        if (confirmed && t.status === 'open') {
          var note = el('textarea', { rows: 2, maxlength: 2000, placeholder: '判断の理由（必須・両方に伝えます）例：制作会社さんに確認したところ、掲載の許可は出ていないとのことでした' });
          var abusive = el('input', { type: 'checkbox' });
          card.appendChild(note);
          card.appendChild(el('div', { class: 'row' }, [
            el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '認める（非公開のまま）', onclick: function () { decide(t, true, note.value, false); } }),
            el('button', { class: 'btn btn--sm', type: 'button', text: '認めない（公開に戻す）', onclick: function () { decide(t, false, note.value, abusive.checked); } }),
            el('label', { class: 'small' }, [abusive, document.createTextNode(' 事実と違う申し立て（いたずら）として記録する')])
          ]));
        }

        if (confirmed && t.status !== 'open') card.appendChild(mailBox(t));

        card.appendChild(el('div', { class: 'row' }, [
          t.blocked
            ? el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'この人の受付を止めるのをやめる', onclick: function () { unblock(t); } })
            : el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'この人からの申し立ての受付を止める', onclick: function () { block(t); } })
        ]));
        box.appendChild(card);
      });
    }

    // 申し立てた人へのお知らせの文（運営のメールから送る。コピーして使う）
    function mailBox(t) {
      var upheld = t.status === 'upheld';
      var body = t.requester_name + ' 様\n\nEizo Maps 運営です。作品「' + (t.work_title || '') + '」についての申し立て（' + EM.date(t.verified_at) + ' 受付）について、確認の結果をお知らせします。\n\n'
        + '結果：' + (upheld ? '申し立てを認め、作品は非公開のままとしました。' : '申し立ては認められず、作品の掲載を続けることにしました。') + '\n'
        + '理由：' + (t.decided_note || '') + '\n\n'
        + (upheld ? '' : 'この判断に納得できない場合は、理由を添えてこのメールにご返信ください。最初とは別の目で見直します。\n\n')
        + '──\nEizo Maps 運営\ninfo@eizo-maps.com';
      var ta = el('textarea', { rows: 8, readonly: true });
      ta.value = body;
      return el('details', { class: 'small' }, [
        el('summary', { text: '申し立てた人へのお知らせの文（' + t.requester_email + ' へ送る）' }),
        ta,
        el('button', { class: 'btn btn--sm', type: 'button', text: '文をコピー', onclick: function () {
          (navigator.clipboard ? navigator.clipboard.writeText(body) : Promise.reject()).then(function () { EM.toast('コピーしました'); }, function () { ta.select(); });
        } })
      ]);
    }

    function decide(t, uphold, note, abusive) {
      if (!note || note.trim().length < 5) { EM.notice(msg, '判断の理由を5文字以上で書いてください（申し立てた人と作品を載せた人の両方に伝えます）。', 'error'); return; }
      if (!confirm(uphold ? '申し立てを認めます。作品は非公開のままになります。' : '申し立てを認めません。ほかに申し立てがなければ作品は公開に戻ります。' + (abusive ? '\n「いたずら」として記録します。' : ''))) return;
      sb.rpc('admin_decide_takedown_v2', { p_id: t.id, p_uphold: uphold, p_note: note, p_abusive: !!abusive }).then(function (r) {
        if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
        else { EM.notice(msg, ''); EM.toast('判断を記録しました。申し立てた人へのお知らせの文が出ます'); load(); }
      });
    }

    function block(t) {
      var reason = prompt('この人（' + t.requester_email + '）からの申し立ての受付を止めます。\n止める理由を書いてください（運営だけが見ます）', '事実と違う申し立てをくり返したため');
      if (reason === null) return;
      sb.rpc('admin_block_takedown_requester', { p_request_id: t.id, p_reason: reason }).then(function (r) {
        if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
        else { EM.toast('受付を止めました'); load(); }
      });
    }

    function unblock(t) {
      if (!confirm('この人（' + t.requester_email + '）からの申し立てを、また受け付けるようにします。')) return;
      sb.rpc('admin_unblock_takedown_requester', { p_request_id: t.id }).then(function (r) {
        if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
        else { EM.toast('受付を戻しました'); load(); }
      });
    }
  });
})(window.EM);
