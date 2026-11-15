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

    if (EM.param('sent')) EM.notice(msg, '依頼を送りました。クリエイターから返事（受ける・条件の提案・お断り）が届くと、この画面に出ます。', 'ok');

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return isDetail ? loadDetail() : loadList();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    var SELECT = 'id,title,description,kind,status,budget_amount,due_on,reference_url,' +
                 'started_at,delivered_at,paid_at,created_at,updated_at,client_id,creator_id,' +
                 'terms_amount,terms_due_on,terms_note,terms_at,declined_reason,declined_at,origin,job_post_id,' +
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
      EM.$('#pageAddBtn').hidden = true;
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
          : null,
        p.origin === 'board' ? el('a', { class: 'tag', href: p.job_post_id ? '/jobs/detail.html?id=' + encodeURIComponent(p.job_post_id) : '/jobs/', text: '募集から' }) : null
      ]));

      var dl = el('dl');
      function row(k, v) { if (!v) return; dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); }
      row('案件種別', p.kind);
      row('予算', EM.budgetLabel(p.budget_amount));
      row('希望納期', p.due_on ? EM.mdw(p.due_on) : '');
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
      if (role) renderFlow(box, p, role);   // いま何をすればいいかを、いちばん上に

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

    /* ---- 依頼してから始まるまで（2026-11-15 翠くん） ----
       ① 返事待ち（offered） ② 条件の返事あり（proposed） ③ 進行中（in_progress）
       クリエイター：受ける／条件を提案する／お断り   クライアント：この条件で始める */
    function yen(v) { return v === null || v === undefined ? '相談' : Number(v).toLocaleString('ja-JP') + '円（税込）'; }
    function termsCard(p, title) {
      var dl = el('dl');
      dl.appendChild(el('dt', { text: '金額' })); dl.appendChild(el('dd', { class: 'flow-big', text: yen(p.terms_amount) }));
      dl.appendChild(el('dt', { text: '納期' })); dl.appendChild(el('dd', { text: p.terms_due_on ? EM.mdw(p.terms_due_on) + '（' + p.terms_due_on + '）' : '相談' }));
      if (p.terms_note) { dl.appendChild(el('dt', { text: '中身・ひとこと' })); dl.appendChild(el('dd', { class: 'flow-note', text: p.terms_note })); }
      return el('div', { class: 'card flow-terms' }, [
        el('p', { class: 'flow-terms__title', text: title }),
        dl,
        p.terms_at ? el('p', { class: 'small muted', text: '返事の日時：' + EM.datetime(p.terms_at) }) : null
      ]);
    }
    function steps(status) {
      var at = status === 'offered' ? 0 : status === 'proposed' ? 1 : 2;
      var names = ['① 返事待ち', '② 条件の返事あり', '③ 進行中'];
      return el('ol', { class: 'flow-steps' }, names.map(function (n, i) {
        return el('li', { class: i < at ? 'is-done' : i === at ? 'is-now' : '', text: n });
      }));
    }
    function renderFlow(box, p, role) {
      if (p.status === 'declined') {
        box.appendChild(el('div', { class: 'notice' }, [
          el('strong', { text: 'クリエイターがお断りしました。' }),
          p.declined_reason ? el('p', { text: '理由：' + p.declined_reason }) : null,
          role === 'client' ? el('p', null, [document.createTextNode('ほかのクリエイターを '), el('a', { href: '/creators/', text: '探す' }), document.createTextNode(' か、'), el('a', { href: '/jobs/new.html', text: '募集を出す' }), document.createTextNode(' こともできます。')]) : null
        ]));
        return;
      }
      if (['offered', 'proposed'].indexOf(p.status) === -1) {
        if (p.terms_at) box.appendChild(termsCard(p, '始めたときの条件（あとから変えられません）'));
        return;
      }
      var wrap = el('div', { class: 'flow' }, [steps(p.status)]);
      box.appendChild(wrap);

      if (p.status === 'offered' && role === 'client') {
        wrap.appendChild(el('p', { class: 'flow-lead', text: 'クリエイターの返事を待っています。返事が届くと、ここに金額と納期が出ます。' }));
        wrap.appendChild(el('p', { class: 'small muted', text: '伝え忘れたことは、下の「やり取り」から送れます。' }));
        return;
      }
      if (p.status === 'proposed') {
        wrap.appendChild(termsCard(p, role === 'client' ? 'クリエイターからの条件' : 'あなたが出した条件'));
      }
      if (role === 'client') {
        wrap.appendChild(el('p', { class: 'flow-lead', text: 'この条件でよければ「この条件で始める」を押してください。押すと進行中になり、条件はあとから変えられなくなります。' }));
        wrap.appendChild(el('div', { class: 'form-actions' }, [
          el('button', { type: 'button', class: 'btn btn--primary', text: 'この条件で始める', onclick: function () { startProject(p); } }),
          el('button', { type: 'button', class: 'btn', text: '条件を相談する', onclick: function () {
            var t = EM.$('#messageBody'); t.value = '条件について相談させてください。\n'; t.scrollIntoView({ block: 'center' }); t.focus();
          } })
        ]));
        return;
      }
      // クリエイター
      wrap.appendChild(el('p', { class: 'flow-lead', text: p.status === 'offered'
        ? '依頼が届いています。内容を見て、返事をしてください。'
        : 'クライアントさんが「この条件で始める」を押すと進行中になります。条件を変えたいときは出し直せます。' }));
      var form = respondForm(p);
      var btns = el('div', { class: 'form-actions' }, [
        p.status === 'offered' ? el('button', { type: 'button', class: 'btn btn--primary', text: 'この内容で受ける', onclick: function () { respond(p, 'accept'); } }) : null,
        el('button', { type: 'button', class: 'btn' + (p.status === 'proposed' ? ' btn--primary' : ''), text: p.status === 'offered' ? '条件を提案する' : '条件を出し直す', onclick: function () { form.hidden = !form.hidden; decline.hidden = true; } }),
        el('button', { type: 'button', class: 'btn btn--danger', text: 'お断りする', onclick: function () { decline.hidden = !decline.hidden; form.hidden = true; } })
      ]);
      var decline = declineForm(p);
      wrap.appendChild(btns);
      wrap.appendChild(form);
      wrap.appendChild(decline);
    }
    function respondForm(p) {
      var amt = el('input', { type: 'number', min: '0', step: '1000', inputmode: 'numeric', placeholder: '例：120000', value: p.terms_amount != null ? String(p.terms_amount) : (p.budget_amount != null ? String(p.budget_amount) : '') });
      var due = el('input', { type: 'date', min: EM.today(), value: p.terms_due_on || p.due_on || '' });
      var note = el('textarea', { rows: '4', maxlength: '1000', placeholder: '例：縦型15秒×3本。撮影は半日、修正2回まで。' });
      if (p.terms_note) note.value = p.terms_note;
      var f = el('form', { class: 'card stack flow-form', hidden: true, novalidate: true }, [
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '金額（税込・円）' }), amt]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '納期' }), due]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '中身・ひとこと（1000文字まで）' }), note]),
        el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn--primary', text: 'この条件を送る' }))
      ]);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        respond(p, 'propose', amt.value === '' ? null : Math.round(Number(amt.value)), due.value || null, note.value.trim() || null);
      });
      return f;
    }
    function declineForm(p) {
      var why = el('textarea', { rows: '3', maxlength: '500', placeholder: '例：その日は別の撮影が入っているため。（書かなくても大丈夫です）' });
      var f = el('form', { class: 'card stack flow-form', hidden: true, novalidate: true }, [
        el('label', { class: 'field' }, [el('span', { class: 'label', text: 'お断りの理由（相手に届きます・任意）' }), why]),
        el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn--danger', text: 'お断りを送る' }))
      ]);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!confirm('この依頼をお断りしますか？\nあとから取り消せません。')) return;
        respond(p, 'decline', null, null, why.value.trim() || null);
      });
      return f;
    }
    function respond(p, action, amount, due, note) {
      if (action === 'accept' && !confirm('依頼の内容（予算・希望納期）のまま受けますか？\nクライアントさんが「この条件で始める」を押すと進行中になります。')) return;
      sb.rpc('project_respond', { p_project: p.id, p_action: action, p_amount: amount === undefined ? null : amount, p_due: due || null, p_note: note || null })
        .then(function (r) {
          if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
          EM.toast(action === 'decline' ? 'お断りを送りました' : '返事を送りました');
          loadDetail();
        });
    }
    function startProject(p) {
      if (!confirm('この条件で始めますか？\n金額：' + yen(p.terms_amount) + '\n納期：' + (p.terms_due_on || '相談') + '\n始めたあとは条件を変えられません。')) return;
      sb.rpc('project_start', { p_project: p.id }).then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.toast('始めました。進行中になりました');
        loadDetail();
      });
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
