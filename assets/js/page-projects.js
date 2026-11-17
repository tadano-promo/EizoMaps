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
    // 依頼した側の希望と、クリエイターの条件を並べる（2026-11-17 翠くん「希望がそのまま返ってきたのか、向こうの条件なのか分かりづらい」）
    function termsCard(p, title) {
      function cmp(wish, terms, same) {
        return el('span', { class: 'tag flow-cmp ' + (same ? '' : 'is-changed'), text: same ? '希望のまま' : (wish ? '変更あり' : 'クリエイターが決めた') });
      }
      var tbl = el('div', { class: 'flow-table' }, [
        el('div', { class: 'flow-table__row flow-table__head' }, [el('span'), el('span', { text: '依頼したときの希望' }), el('span', { text: 'クリエイターの条件' })]),
        el('div', { class: 'flow-table__row' }, [
          el('span', { class: 'flow-table__k', text: '金額' }),
          el('span', { text: p.budget_amount != null ? Number(p.budget_amount).toLocaleString('ja-JP') + '円' : '未定' }),
          el('span', null, [el('strong', { class: 'flow-amt', text: p.terms_amount != null ? Number(p.terms_amount).toLocaleString('ja-JP') + '円' : '相談' }), p.terms_amount != null ? el('span', { class: 'small muted', text: '（税込）' }) : null, ' ', p.terms_amount != null ? cmp(p.budget_amount != null, p.terms_amount, p.budget_amount === p.terms_amount) : null])
        ]),
        el('div', { class: 'flow-table__row' }, [
          el('span', { class: 'flow-table__k', text: '納期' }),
          el('span', { text: p.due_on ? EM.mdw(p.due_on) : '未定' }),
          el('span', null, [el('strong', { text: p.terms_due_on ? EM.mdw(p.terms_due_on) : '相談' }), ' ', p.terms_due_on ? cmp(!!p.due_on, p.terms_due_on, p.due_on === p.terms_due_on) : null])
        ])
      ]);
      return el('div', { class: 'card flow-terms' }, [
        el('p', { class: 'flow-terms__title', text: title }),
        tbl,
        p.terms_note ? el('p', { class: 'flow-note' }, [el('span', { class: 'small muted', text: 'クリエイターからのひとこと：' }), document.createTextNode(p.terms_note)]) : null,
        p.terms_amount == null ? el('p', { class: 'small flow-warn', text: '金額がまだ決まっていません（「相談」のまま）。' }) : null,
        p.terms_at ? el('p', { class: 'small muted', text: '返事の日時：' + EM.datetime(p.terms_at) }) : null
      ]);
    }
    function steps(status) {
      var order = ['offered', 'proposed', 'in_progress', 'delivered', 'paid'];
      var at = order.indexOf(status); if (status === 'closed') at = 5;
      var names = ['① 返事待ち', '② 条件の確認', '③ 進行中', '④ 納品', '⑤ 入金'];
      return el('ol', { class: 'flow-steps' }, names.map(function (n, i) {
        return el('li', { class: i < at ? 'is-done' : i === at ? 'is-now' : '', text: n });
      }));
    }
    // いま誰の番で、何をすればいいか（両方の側で、どの状態でも出す）
    function nextBox(p, role) {
      var mine, text;
      var c = role === 'client';
      switch (p.status) {
        case 'offered':
          mine = !c;
          text = c ? 'クリエイターの返事を待っています。返事（金額と納期）が届くと、メールでお知らせします。あなたが押すボタンは、まだありません。'
                   : (p.budget_amount == null
                       ? '依頼が届いています。予算が「未定」なので、下の欄に金額と納期を入れて「この条件を送る」で返事をしてください。'
                       : '依頼が届いています。下の「この内容で受ける」「条件を提案する」「お断りする」から返事をしてください。');
          break;
        case 'proposed':
          mine = c;
          text = c ? (p.terms_amount == null
                       ? 'クリエイターから返事が届きましたが、金額が「相談」のままです。メッセージで金額を相談し、クリエイターに金額を入れて出し直してもらってください。'
                       : 'クリエイターから条件が届きました。下の表で「依頼したときの希望」と見比べて、よければ「この条件で始める」を押してください。押すまで仕事は始まりません。')
                   : 'クライアントさんが条件を確かめて「この条件で始める」を押すのを待っています。始まるまでは、条件を出し直せます。始まったら、あなたから企画・構成を提案して進めます。';
          break;
        case 'in_progress':
          mine = !c;
          text = c ? 'ここからはクリエイターが進めます。まずクリエイターから「どんな動画にするか（企画・構成）」の提案が届きます。待つ間に、使ってほしい写真・ロゴ・入れたい言葉・参考にしたい動画があれば、下の「伝えておくこと」から送っておくと早く進みます。'
                   : 'ここからはあなたが進める番です。クライアントさんは動画づくりに慣れていないことが多いので、まず「どんな動画にするか（企画・構成）」をあなたから提案してください。下の「企画の提案を書く」を押すと、書く順番の見本が入ります。';
          break;
        case 'delivered':
          mine = c;
          text = c ? '納品されました。中身を確かめて、代金を支払ったら「入金済みにする」を押してください。'
                   : 'クライアントさんの確認と入金を待っています。';
          break;
        case 'paid':
          mine = true;
          text = '入金済みです。「完了にする」を押して、お互いに評価を書きましょう。';
          break;
        default: return null;
      }
      return el('div', { class: 'flow-next ' + (mine ? 'is-mine' : 'is-wait') }, [
        el('p', { class: 'flow-next__who', text: mine ? 'あなたの番です' : '相手の番です（待つだけでOK）' }),
        el('p', { text: text })
      ]);
    }
    // 進行中の「進め方の目安」と、書き出しの見本（2026-11-17 翠くん「クリエイターが主導で進めないといけないのに、使い方が分からないと進められない」）
    var TPL_CREATOR = '■ 企画の提案\n\n【目的】この動画で伝えたいこと：\n【見てほしい人】\n【使う場所】（例：Instagram のリール）\n【長さ・本数】（例：30秒×1本）\n【構成案】\n1. 最初の3秒：\n2. まん中：\n3. 最後：\n【雰囲気】（例：明るく、テンポよく）\n【いただきたいもの】（例：ロゴ・写真・入れたい言葉）\n【このあとの流れ】構成OK → 制作 → 初稿 ○/○ → 修正（○回まで） → 納品 ○/○\n\nこの方向でよいか、ご意見をください。';
    var TPL_CLIENT = '■ 伝えておくこと\n\n【いちばん伝えたいこと】\n【見てほしい人】\n【参考にしたい動画】（URL）\n【入れたい言葉・入れてはいけない言葉】\n【お渡しできる素材】（例：ロゴ・写真・商品）\n【気になっていること】';
    function guideBox(role) {
      var c = role === 'client';
      var steps = [
        ['企画・構成の提案', c ? 'クリエイターから届きます' : 'あなたから出します'],
        ['方向性の確認', c ? 'よければ「この方向でOK」と返事' : 'クライアントさんのOKをもらう'],
        ['制作・撮影', c ? '素材を渡す・撮影に立ち会う' : '素材を受け取り、作る'],
        ['初稿の確認と修正', c ? '直してほしいところを具体的に伝える' : '初稿を送り、修正する'],
        ['納品', c ? '受け取って確認' : '納品したら「納品済みにする」']
      ];
      function fill(t) { var m = EM.$('#messageBody'); if (!m) return; m.value = t; m.scrollIntoView({ block: 'center' }); m.focus(); }
      return el('div', { class: 'card flow-guide' }, [
        el('p', { class: 'flow-terms__title', text: '進め方の目安' }),
        el('ol', { class: 'flow-guide__list' }, steps.map(function (x) { return el('li', null, [el('strong', { text: x[0] }), el('span', { class: 'small muted', text: '　' + x[1] })]); })),
        el('div', { class: 'form-actions' }, [
          el('button', { type: 'button', class: 'btn btn--sm' + (c ? '' : ' btn--primary'), text: c ? '伝えておくことを書く' : '企画の提案を書く', onclick: function () { fill(c ? TPL_CLIENT : TPL_CREATOR); } })
        ]),
        el('p', { class: 'small muted', text: c ? '分からないことは、そのままメッセージで聞いて大丈夫です。' : '見本の【　】に書き込んで送ってください。いらない項目は消してかまいません。' })
      ]);
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
      if (['cancelled', 'draft'].indexOf(p.status) !== -1) return;
      var wrap = el('div', { class: 'flow' }, [steps(p.status), nextBox(p, role)]);
      box.appendChild(wrap);

      if (['offered', 'proposed'].indexOf(p.status) === -1) {
        if (p.status === 'in_progress') wrap.appendChild(guideBox(role));
        if (p.terms_at) wrap.appendChild(termsCard(p, '始めたときの条件（あとから変えられません）'));
        return;
      }
      if (p.status === 'offered' && role === 'client') {
        wrap.appendChild(el('p', { class: 'small muted', text: '伝え忘れたことは、下の「やり取り」から送れます。' }));
        return;
      }
      if (p.status === 'proposed') {
        wrap.appendChild(termsCard(p, role === 'client' ? 'クリエイターから届いた条件' : 'あなたが出した条件'));
      }
      if (role === 'client') {
        var noAmt = p.terms_amount == null;
        wrap.appendChild(el('div', { class: 'form-actions' }, [
          el('button', { type: 'button', class: 'btn btn--primary', text: 'この条件で始める', disabled: noAmt, onclick: function () { startProject(p); } }),
          el('button', { type: 'button', class: 'btn', text: '条件を相談する', onclick: function () {
            var t = EM.$('#messageBody'); t.value = noAmt ? '金額を入れた条件を出していただけますか？\n' : '条件について相談させてください。\n'; t.scrollIntoView({ block: 'center' }); t.focus();
          } })
        ]));
        wrap.appendChild(el('p', { class: 'small muted', text: '「この条件で始める」を押すと進行中になり、金額と納期はあとから変えられなくなります。' }));
        return;
      }
      // クリエイター
      var noBudget = p.budget_amount == null;
      if (p.status === 'offered') {
        wrap.appendChild(el('p', { class: 'small muted', text: noBudget
          ? 'この依頼は予算が「未定」です。「条件を提案する」から、金額と納期を入れて返事をしてください。'
          : '「この内容で受ける」は、依頼したときの予算（' + yen(p.budget_amount) + '）と希望納期（' + (p.due_on ? EM.mdw(p.due_on) : '未定') + '）のまま受けます。変えたいときは「条件を提案する」へ。' }));
      }
      var form = respondForm(p);
      var btns = el('div', { class: 'form-actions' }, [
        p.status === 'offered' && !noBudget ? el('button', { type: 'button', class: 'btn btn--primary', text: 'この内容で受ける', onclick: function () { respond(p, 'accept'); } }) : null,
        el('button', { type: 'button', class: 'btn' + (p.status === 'proposed' || noBudget ? ' btn--primary' : ''), text: p.status === 'offered' ? '条件を提案する' : '条件を出し直す', onclick: function () { form.hidden = !form.hidden; decline.hidden = true; } }),
        el('button', { type: 'button', class: 'btn btn--danger', text: 'お断りする', onclick: function () { decline.hidden = !decline.hidden; form.hidden = true; } })
      ]);
      var decline = declineForm(p);
      wrap.appendChild(btns);
      wrap.appendChild(form);
      wrap.appendChild(decline);
      if (noBudget && p.status === 'offered') form.hidden = false;
    }
    function respondForm(p) {
      var amt = el('input', { type: 'number', min: '0', step: '1000', inputmode: 'numeric', placeholder: '例：120000', value: p.terms_amount != null ? String(p.terms_amount) : (p.budget_amount != null ? String(p.budget_amount) : '') });
      var due = el('input', { type: 'date', min: EM.today(), value: p.terms_due_on || p.due_on || '' });
      var note = el('textarea', { rows: '4', maxlength: '1000', placeholder: '例：縦型15秒×3本。撮影は半日、修正2回まで。' });
      if (p.terms_note) note.value = p.terms_note;
      var f = el('form', { class: 'card stack flow-form', hidden: true, novalidate: true }, [
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '金額（税込・円・必須）' }), amt]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '納期' }), due]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '中身・ひとこと（1000文字まで）' }), note,
          el('span', { class: 'hint', text: 'どんな動画にするか（方向性）、本数・長さ、修正の回数を書くと、クライアントさんが判断しやすくなります。' })]),
        el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn--primary', text: 'この条件を送る' }))
      ]);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (amt.value === '') { EM.notice(msg, '金額を入れてください。決めにくいときは、だいたいの金額と、中身の欄に「〇〇なら△△円」のように書いてください。', 'error'); amt.focus(); return; }
        respond(p, 'propose', Math.round(Number(amt.value)), due.value || null, note.value.trim() || null);
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
      if (action === 'accept' && !confirm('依頼したときの希望のまま受けますか？\n金額：' + yen(p.budget_amount) + '\n納期：' + (p.due_on ? EM.mdw(p.due_on) : '相談') + '\nクライアントさんが「この条件で始める」を押すと進行中になります。')) return;
      sb.rpc('project_respond', { p_project: p.id, p_action: action, p_amount: amount === undefined ? null : amount, p_due: due || null, p_note: note || null })
        .then(function (r) {
          if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
          EM.toast(action === 'decline' ? 'お断りを送りました' : '返事を送りました');
          EM.track('project_reply', { reply_type: action });
          loadDetail();
        });
    }
    function startProject(p) {
      if (!confirm('この条件で始めますか？\n金額：' + yen(p.terms_amount) + '\n納期：' + (p.terms_due_on ? EM.mdw(p.terms_due_on) : '相談') + '\n始めたあとは条件を変えられません。')) return;
      sb.rpc('project_start', { p_project: p.id }).then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.toast('始めました。進行中になりました');
        EM.track('project_start', { project_origin: p.origin || 'direct' });
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
