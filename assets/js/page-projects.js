/* Eizo Maps — 案件一覧・詳細・ステータス遷移・メッセージ */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var user = null, myCreatorId = null, myClientId = null;
    var projectId = EM.param('id');
    var isDetail = /^[0-9a-f-]{36}$/i.test(String(projectId || ''));

    if (EM.param('sent')) EM.notice(msg, '依頼を送りました。クリエイターの案件一覧に表示されます。', 'ok');

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return isDetail ? loadDetail() : loadList();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    var SELECT = 'id,title,description,kind,status,budget_amount,due_on,reference_url,' +
                 'started_at,delivered_at,paid_at,created_at,updated_at,client_id,creator_id,' +
                 'clients(display_name,company),creators(id,display_name,headline,avatar_url)';

    /* ---------------- 一覧 ---------------- */
    function loadList() {
      return Promise.all([
        sb.rpc('my_client_id'),
        sb.rpc('my_creator_id'),
        sb.from('projects').select(SELECT).order('updated_at', { ascending: false }).limit(200)
      ]).then(function (res) {
        myClientId = res[0].data || null;
        myCreatorId = res[1].data || null;
        if (res[2].error) throw res[2].error;
        var rows = res[2].data || [];
        renderList(EM.$('#asClient'),  rows.filter(function (p) { return p.client_id === myClientId; }),  'client');
        renderList(EM.$('#asCreator'), rows.filter(function (p) { return p.creator_id === myCreatorId; }), 'creator');
      });
    }

    function renderList(box, rows, role) {
      EM.clear(box);
      if (!rows.length) {
        box.appendChild(el('div', { class: 'empty', text: role === 'client'
          ? 'まだ依頼した案件はありません。クリエイターを探して依頼してみてください。'
          : 'まだ受けた案件はありません。' }));
        return;
      }
      rows.forEach(function (p) {
        var who = role === 'client'
          ? (p.creators && p.creators.display_name) || ''
          : (p.clients && (p.clients.company ? p.clients.company + '（' + p.clients.display_name + '）' : p.clients.display_name)) || '';
        box.appendChild(el('a', { class: 'card', href: '/projects/?id=' + encodeURIComponent(p.id) }, [
          el('div', { class: 'share-row' }, [
            el('div', null, [
              el('p', { class: 'pf-title', text: p.title }),
              el('p', { class: 'small muted', text: [who, p.kind, EM.budgetLabel(p.budget_amount)].filter(Boolean).join(' / ') })
            ]),
            el('div', { class: 'row' }, [
              EM.statusBadge(p.status),
              el('span', { class: 'small muted', text: EM.date(p.updated_at) })
            ])
          ])
        ]));
      });
    }

    /* ---------------- 詳細 ---------------- */
    function loadDetail() {
      EM.$('#listView').hidden = true;
      EM.$('#detailView').hidden = false;
      return Promise.all([
        sb.from('projects').select(SELECT).eq('id', projectId).maybeSingle(),
        sb.rpc('project_my_role', { p_project_id: projectId }),
        sb.from('reviews').select('id,status,score').eq('project_id', projectId).eq('reviewer_id', user.id)
      ]).then(function (res) {
        if (res[0].error) throw res[0].error;
        var p = res[0].data;
        if (!p) { EM.notice(msg, 'この案件は見つかりませんでした。', 'error'); EM.$('#detailView').hidden = true; return; }
        var role = res[1].data;
        var myReview = (res[2].data || [])[0] || null;   // 自分が投稿した評価だけ
        renderDetail(p, role, myReview);
        return loadMessages();
      });
    }

    function renderDetail(p, role, myReview) {
      document.title = p.title + ' — Eizo Maps';
      EM.$('#pageTitle').textContent = p.title;

      var who = role === 'client'
        ? (p.creators && p.creators.display_name) || ''
        : (p.clients && (p.clients.company ? p.clients.company + '（' + p.clients.display_name + '）' : p.clients.display_name)) || '';

      var head = EM.clear(EM.$('#detailHead'));
      head.appendChild(el('div', { class: 'row' }, [
        EM.statusBadge(p.status),
        el('span', { class: 'small muted', text: (role === 'client' ? '依頼先' : '依頼元') + '：' + who }),
        role === 'client' && p.creators
          ? el('a', { class: 'btn btn--sm btn--ghost', href: '/creators/detail.html?id=' + encodeURIComponent(p.creators.id), text: 'プロフィール' })
          : null
      ]));

      var dl = el('dl');
      function row(k, v) { if (!v) return; dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); }
      row('案件種別', p.kind);
      row('予算レンジ', EM.budgetLabel(p.budget_amount));
      row('希望納期', p.due_on || '');
      row('依頼日', EM.date(p.created_at));
      var ref = EM.safeUrl(p.reference_url);
      if (ref) {
        dl.appendChild(el('dt', { text: '参考URL' }));
        dl.appendChild(el('dd', null, el('a', { href: ref, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'mono small', text: ref })));
      }
      head.appendChild(el('div', { class: 'card' }, [
        p.description ? el('p', { text: p.description }) : null,
        dl
      ]));

      renderStatus(p, role, myReview);
    }

    function renderStatus(p, role, myReview) {
      var box = EM.clear(EM.$('#statusBox'));

      // 証跡（各ステータスに入った日時）
      var dl = el('dl');
      [['進行開始', p.started_at], ['納品', p.delivered_at], ['入金', p.paid_at]].forEach(function (r) {
        dl.appendChild(el('dt', { text: r[0] }));
        dl.appendChild(el('dd', { class: r[1] ? '' : 'muted', text: r[1] ? EM.date(r[1]) : '—' }));
      });
      box.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'small muted', text: 'ステータスの変更日時は自動で記録され、あとから書き換えることはできません。' }),
        dl
      ]));

      if (!role) return;

      var actions = el('div', { class: 'form-actions' });
      EM.nextStatuses(p.status, role).forEach(function (n) {
        actions.appendChild(el('button', {
          class: 'btn' + (n[0] === 'cancelled' ? ' btn--danger' : ' btn--primary'),
          type: 'button', text: n[1],
          onclick: function () { changeStatus(p, n[0], n[1]); }
        }));
      });

      if (EM.canReview(p.status)) {
        if (myReview) {
          actions.appendChild(el('span', { class: 'tag', text: myReview.status === 'published' ? '評価は公開済みです' : '評価は確認待ちです' }));
        } else {
          actions.appendChild(el('a', { class: 'btn', href: '/projects/review.html?id=' + encodeURIComponent(p.id), text: '相手を評価する' }));
        }
      }
      actions.appendChild(el('a', { class: 'btn btn--sm btn--ghost', href: '/report/?project_id=' + encodeURIComponent(p.id), text: 'この案件で問題を報告' }));
      box.appendChild(actions);
    }

    function changeStatus(p, next, label) {
      if (!confirm('この案件を「' + label.replace(/する$/, '') + '」ますか？\n記録は取り消せません。')) return;
      sb.from('projects').update({ status: next }).eq('id', p.id).then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.toast('ステータスを更新しました');
        loadDetail();
      });
    }

    /* ---------------- メッセージ ---------------- */
    function loadMessages() {
      return sb.from('project_messages')
        .select('id,sender_id,body,created_at')
        .eq('project_id', projectId)
        .order('created_at')
        .then(function (r) {
          var box = EM.clear(EM.$('#messages'));
          var rows = r.data || [];
          if (!rows.length) { box.appendChild(el('div', { class: 'empty', text: 'まだやり取りはありません。' })); return; }
          rows.forEach(function (m) {
            box.appendChild(el('div', { class: 'card' }, [
              el('p', { class: 'small muted', text: (m.sender_id === user.id ? '自分' : '相手') + ' / ' + EM.date(m.created_at) }),
              el('p', { text: m.body })
            ]));
          });
        });
    }

    EM.$('#messageForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = EM.$('#messageBody').value.trim();
      if (!body) return;
      sb.from('project_messages').insert({ project_id: projectId, sender_id: user.id, body: body })
        .then(function (r) {
          if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
          EM.$('#messageBody').value = '';
          loadMessages();
        });
    });
  });
})(window.EM);
