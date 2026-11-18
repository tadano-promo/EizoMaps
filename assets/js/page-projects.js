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
                 'final_amount,final_due_on,final_at,rules_version,rules_agreed_at,withholding,clients(display_name,company),creators(id,display_name,headline,avatar_url,handle,search_visible)';

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
        // 札（あなたの番・一時停止中など）は読み終わったら描き直す
        return EM.projectFlags(rows.map(function (p) { return p.id; })).then(function (m) {
          flags = m;
          renderList(EM.$('#asClient'),  rows.filter(function (p) { return p.client_id === myClientId; }),  'client');
          renderList(EM.$('#asCreator'), rows.filter(function (p) { return p.creator_id === myCreatorId; }), 'creator');
        });
      });
    }

    var flags = {};
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
              EM.statusBadge(p.status)
            ].concat(EM.projectBadges(p, flags[p.id])).concat([
              el('span', { class: 'small muted', text: EM.date(p.updated_at) })
            ]))
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
        sb.from('reviews').select('id,status,score').eq('project_id', projectId).eq('reviewer_id', user.id),
        sb.from('project_quotes').select('id,version,amount,due_on,note,status,decline_reason,created_at,decided_at,no_pause').eq('project_id', projectId).order('version'),
        sb.from('project_pauses').select('id,started_at,ended_at,end_reason,shifted_days,due_before,due_after').eq('project_id', projectId).order('started_at'),
        sb.rpc('payout_get', { p_project: projectId }),
        sb.from('creator_payout_profiles').select('bank_name,branch_name,account_type,account_number,holder_kana').eq('user_id', user.id).maybeSingle()
      ]).then(function (res) {
        payout = (res[5] && res[5].data && res[5].data[0]) || null;
        payoutProfile = (res[6] && res[6].data) || null;
        quotes = (res[3] && res[3].data) || [];
        pauses = (res[4] && res[4].data) || [];
        if (res[0].error) throw res[0].error;
        var p = res[0].data;
        if (!p) { EM.notice(msg, 'この案件は見つかりませんでした。', 'error'); EM.$('#detailView').hidden = true; return; }
        var role = res[1].data;
        names = partyNames(p, role);
        var myReview = (res[2].data || [])[0] || null;   // 自分が投稿した評価だけ
        renderDetail(p, role, myReview);
        return loadMessages();
      });
    }

    /* お互いの名前（2026-11-17 翠くん「途中で名前を呼ぼうと思ったときに呼べなくて不便」） */
    var names = { me: 'あなた', other: '相手' };
    function partyNames(p, role) {
      var cl = p.clients ? (p.clients.company ? p.clients.company + '（' + (p.clients.display_name || '') + '）' : (p.clients.display_name || '')) : '';
      var cr = (p.creators && p.creators.display_name) || '';
      return role === 'client' ? { me: cl || 'あなた', other: cr || '相手', otherRole: 'クリエイター', meRole: 'クライアント' }
           : role === 'creator' ? { me: cr || 'あなた', other: cl || '相手', otherRole: 'クライアント', meRole: 'クリエイター' }
           : { me: 'あなた', other: '相手' };
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
        openPause() && ['in_progress', 'delivered'].indexOf(p.status) !== -1 ? el('span', { class: 'tag tag--pause', text: '一時停止中' }) : null,
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
      if (role) mountAttach(p);
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
      var pend = pendingQuote(), pz = openPause();
      // 見積もりを出しただけでは止まらない（クリエイターが自分で納期を伸ばせないように。2026-11-17 翠くん）
      if (pend && !pz && ['in_progress', 'delivered'].indexOf(p.status) !== -1) {
        return el('div', { class: 'flow-next ' + (c ? 'is-mine' : 'is-wait') }, [
          el('p', { class: 'flow-next__who', text: c ? 'あなたの番です' : '相手の番です（待つだけでOK）' }),
          el('p', { text: c ? 'クリエイターから見積もり（' + pend.version + '回目）が届いています。下の「金額の記録」で、いまの金額と見比べて「この金額で確定する」か「見送る」を押してください。' + (pend.no_pause ? 'この見積もりは「見送られても止めない」で出されているので、見送っても作業と納期はそのままです。' : '見送ると、始めるときの決まりのとおり、話し合いのあいだ作業は止まり' + (p.rules_agreed_at ? '、納期は止まった日数だけうしろにずれます。' : 'ます。'))
                           : '見積もり（' + pend.version + '回目）を出しました。クライアントさんの返事を待つあいだも、作業と納期はそのままです。見送られたときは、話し合いのあいだ作業を止めて大丈夫です（納期は止まった日数だけ自動でうしろにずれます）。' })
        ]);
      }
      if (pz && ['in_progress', 'delivered'].indexOf(p.status) !== -1) {
        // 見積もりの話し合い中は、作業は一時停止（2026-11-17 翠くん「クライアントさんが納得するまで一旦停止、クリエイターも安心して」）
        var since = '（' + EM.mdw(pz.started_at.slice(0, 10)) + 'から・' + pauseDays(pz) + '日目）';
        var mine2 = c ? !!pend : !pend;
        var t2 = c
          ? (pend ? 'クリエイターから見積もり（' + pend.version + '回目）が届いています。下の「金額の記録」で、いまの金額と見比べて「この金額で確定する」か「見送る」を押してください。'
                  : '見積もりは見送りました。クリエイターさんと、納得できるまでメッセージで話し合ってください。決まると、クリエイターさんが見積もりを出し直すか、いまの金額のまま再開します。')
          : (pend ? '見積もり（' + pend.version + '回目）を出しました。クライアントさんが「この金額で確定する」を押すのを待っています。'
                  : '見積もりが見送られました。メッセージでとことん話し合って、決まったら「見積もりを出し直す」か「取り下げて、いまの金額のまま再開」を押してください。納期を動かせないと分かっているなら「止めずに作業を続ける（納期はずらさない）」も選べます。');
        return el('div', { class: 'flow-next flow-pause ' + (mine2 ? 'is-mine' : 'is-wait') }, [
          el('p', { class: 'flow-next__who', text: '一時停止中：作業はいったん止まっています' + since }),
          el('p', { class: 'flow-pause__lead', text: c
            ? '金額が決まるまで、クリエイターさんは作業を止めています。' + (p.rules_agreed_at ? '始めるときの決まりのとおり、納期は止まった日数だけ自動でうしろにずれます' + (dueNow(p) ? '（いま再開すると ' + EM.mdw(dueNow(p)) + ' → ' + EM.mdw(addDays(dueNow(p), pauseDays(pz))) + '）' : '') + '。' : '') + 'あわてず、納得できるまで話し合ってください。'
            : '金額が決まるまで、作業は止めて大丈夫です。' + (p.rules_agreed_at ? '納期は止まった日数だけ自動でうしろにずれるので、損はしません' + (dueNow(p) ? '（いま再開すると ' + EM.mdw(dueNow(p)) + ' → ' + EM.mdw(addDays(dueNow(p), pauseDays(pz))) + '）' : '') + '。' : 'この案件は決まりができる前に始まったので、納期は自動ではずれません。必要なら、見積もりの中で新しい納期を決めてください。') }),
          el('p', { class: 'flow-next__who', text: mine2 ? 'あなたの番です' : '相手の番です（待つだけでOK）' }),
          el('p', { text: t2 })
        ]);
      }
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
    /* 完了したら SNS にシェア（2026-11-17 翠くん）。案件名・金額は出さない。クリエイターは自分のページ、クライアントはクリエイターのページを紹介 */
    function shareBox(p, role) {
      var c = p.creators || {};
      var shown = c.search_visible !== false;
      var profile = location.origin + (c.handle ? '/@' + c.handle : '/creators/detail.html?id=' + encodeURIComponent(c.id || ''));
      // クリエイター：本人のページ／クライアント：クリエイターさんの名前とページでお礼（2026-11-17 翠くん「最初のやつでよかった」）
      // クリエイターさんが「検索に出さない」設定なら、名前を出さず Eizo Maps のトップ
      var url = shown && c.id ? profile : location.origin + '/';
      var text = role === 'creator'
        ? 'Eizo Maps で、映像の仕事を1件完了しました🎬\nこれまでの実績や評価はこちらから👇'
        : (shown && c.display_name
            ? 'Eizo Maps で依頼した映像の制作が完了しました🎬\n' + c.display_name + ' さん、ありがとうございました！'
            : 'Eizo Maps で依頼した映像の制作が完了しました🎬');
      var tag = '#EizoMaps';
      var links = [
        ['X', 'https://x.com/intent/post?text=' + encodeURIComponent(text + '\n' + tag) + '&url=' + encodeURIComponent(url)],
        ['Threads', 'https://www.threads.com/intent/post?text=' + encodeURIComponent(text + '\n' + tag) + '&url=' + encodeURIComponent(url)],
        ['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)]
      ];
      return el('div', { class: 'card share-done' + (role === 'client' ? ' share-done--client' : '') }, [
        el('p', { class: 'share-done__title', text: '🎉 案件を完了しました' }),
        el('p', { class: 'small', text: role === 'creator'
          ? 'おつかれさまでした。実績として SNS にシェアしてみませんか？ あなたの Eizo Maps のページが一緒に載ります。'
          : 'おつかれさまでした。よければ SNS にシェアしてください。クリエイターさんへのお礼と紹介になり、とても喜ばれます。' }),
        el('div', { class: 'form-actions' }, links.map(function (l) {
          return el('a', { class: 'btn btn--sm', href: l[1], target: '_blank', rel: 'noopener noreferrer', text: l[0] + ' にシェア',
            onclick: function () { EM.track('share', { method: l[0], content_type: 'project_closed', item_id: role }); } });
        })),
        el('p', { class: 'small muted', text: '案件の名前や金額は載りません。投稿する前に、文章は自由に書き換えられます。' })
      ]);
    }
    /* ---- 見積もりの出し直し（2026-11-17 翠くん） ----
       始めたときの条件＝1回目。クリエイターが2回目・3回目…を出し、クライアントさんが確定する。経緯はぜんぶ残る */
    var quotes = [], pauses = [];
    function openPause() { for (var i = 0; i < pauses.length; i++) if (!pauses[i].ended_at) return pauses[i]; return null; }
    // 日本時間の日付で数える（11/21 に止まって 11/23 に再開 → 2日）。データベースの pause_days と同じ数え方
    function jstDay(t) { return Math.floor((new Date(t).getTime() + 9 * 3600000) / 86400000); }
    function pauseDays(z) { return Math.max(0, jstDay(z.ended_at || Date.now()) - jstDay(z.started_at)); }
    function dueNow(p) { return p.final_due_on || p.terms_due_on || null; }
    function addDays(ymd, n) { var d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
    var curP = null;
    // 確定したときの納期（見積もりに日付があればその日、止まっていて決まりに同意済みなら止まった日数ぶんうしろ、それ以外はいまのまま）
    function quoteDueText(p, q) {
      var dn = dueNow(p), pz = openPause();
      if (q.due_on) return EM.mdw(q.due_on) + (dn && q.due_on === dn ? '（いまのまま）' : '');
      if (!dn) return '相談';
      if (pz && p.rules_agreed_at) return EM.mdw(addDays(dn, pauseDays(pz))) + '（止まった日数だけうしろへ。いま確定した場合）';
      return EM.mdw(dn) + '（いまのまま）';
    }
    function pendingQuote() { for (var i = 0; i < quotes.length; i++) if (quotes[i].status === 'proposed') return quotes[i]; return null; }
    var QST = { proposed: ['確定待ち', 'tag--accent'], accepted: ['確定', 'tag--ok'], declined: ['見送り', ''], replaced: ['出し直しで取り下げ', ''], withdrawn: ['取り下げ', ''] };
    function quotesCard(p, role) {
      curP = p;
      var c = role === 'client';
      var open = ['in_progress', 'delivered'].indexOf(p.status) !== -1;
      var now = p.final_amount != null ? p.final_amount : p.terms_amount;
      var list = el('ol', { class: 'quote-list' });
      list.appendChild(el('li', null, [
        el('span', { class: 'quote-list__v', text: '1回目' }),
        el('span', null, [el('strong', { text: yen(p.terms_amount) }), el('span', { class: 'small muted', text: '　始めたときの条件' + (p.terms_at ? '・' + EM.date(p.terms_at) : '') })])
      ]));
      quotes.forEach(function (q) {
        var st = QST[q.status] || [q.status, ''];
        list.appendChild(el('li', { class: q.status === 'replaced' || q.status === 'declined' ? 'is-off' : '' }, [
          el('span', { class: 'quote-list__v', text: q.version + '回目' }),
          el('span', null, [
            el('strong', { text: yen(q.amount) }), ' ', el('span', { class: 'tag ' + st[1], text: st[0] }),
            q.no_pause ? el('span', { class: 'tag', text: '見送っても止めない' }) : null,
            el('span', { class: 'small muted', text: '　' + EM.date(q.created_at) + (q.due_on ? '・納期 ' + EM.mdw(q.due_on) : '') }),
            q.note ? el('span', { class: 'small quote-list__note', text: q.note }) : null,
            q.decline_reason ? el('span', { class: 'small muted quote-list__note', text: '見送りの理由：' + q.decline_reason }) : null
          ])
        ]));
      });
      var pend = pendingQuote();
      var card = el('div', { class: 'card flow-terms quote-card' }, [
        el('p', { class: 'flow-terms__title', text: '金額の記録（見積もり）' }),
        el('p', { class: 'quote-now' }, [
          el('span', { class: 'small muted', text: p.final_at ? 'いまの金額（確定）' : 'いまの金額' }),
          el('strong', { class: 'flow-amt', text: now != null ? Number(now).toLocaleString('ja-JP') + '円' : '未定' }),
          now != null ? el('span', { class: 'small muted', text: '（税込）' }) : null,
          p.final_at ? el('span', { class: 'small muted', text: '　' + EM.date(p.final_at) + ' に確定' }) : null
        ]),
        el('p', { class: 'quote-now' }, [
          el('span', { class: 'small muted', text: 'いまの納期' }),
          el('strong', { text: dueNow(p) ? EM.mdw(dueNow(p)) : '相談' }),
          (p.terms_due_on && dueNow(p) && dueNow(p) !== p.terms_due_on) ? el('span', { class: 'small muted', text: '（始めたときは ' + EM.mdw(p.terms_due_on) + '）' }) : null
        ]),
        list,
        pauses.length ? el('div', { class: 'quote-pauses' }, [
          el('p', { class: 'small', text: '一時停止の記録（合計 ' + pauses.reduce(function (n, z) { return n + pauseDays(z); }, 0) + '日）' }),
          el('ul', null, pauses.map(function (z) {
            return el('li', { class: 'small muted', text: EM.mdw(z.started_at.slice(0, 10)) + ' 〜 ' + (z.ended_at ? EM.mdw(z.ended_at.slice(0, 10)) : 'いま') + '（' + pauseDays(z) + '日）'
              + (z.end_reason === 'accepted' ? '・確定して再開' : z.end_reason === 'withdrawn' ? '・取り下げて再開' : z.end_reason === 'closed' ? '・案件の終わりで解除' : z.end_reason === 'continued' ? '・止めずに続行（納期そのまま）' : '・話し合い中')
              + (z.shifted_days > 0 && z.due_before && z.due_after ? '・納期 ' + EM.mdw(z.due_before) + ' → ' + EM.mdw(z.due_after) : '') });
          }))
        ]) : null,
        el('p', { class: 'small muted', text: '出した見積もりと返事は、すべてここと「やり取り」に残ります。あとから消したり書き換えたりはできません。' }),
        el('p', { class: 'small muted', text: p.rules_agreed_at ? 'この案件は ' + EM.date(p.rules_agreed_at) + ' に「この案件の決まり（' + p.rules_version + '版）」に同意して始まりました。' : 'この案件は、決まりができる前に始まりました（見送っても納期は自動ではずれません）。' })
      ]);
      if (!open) return card;
      if (c && pend) {
        var why = el('textarea', { rows: '2', maxlength: '500', placeholder: '例：予算を少し超えてしまうため。（書かなくても大丈夫です）' });
        // 見送る前に、納期がずれることを必ず見せる（2026-11-18 翠くん「クリエイターが損しないように、クライアント側には事前に伝える」）
        var dn = dueNow(p);
        var dec = el('div', { class: 'stack', hidden: true }, [
          pend.no_pause ? el('div', { class: 'notice decline-warn' }, [
            el('p', { text: 'この見積もりは「見送られても止めない」で出されています。見送っても作業はそのまま続き、納期' + (dn ? ' ' + EM.mdw(dn) : '') + ' も変わりません。' })
          ]) : p.rules_agreed_at ? el('div', { class: 'notice notice--warn decline-warn' }, [
            el('strong', { text: '始めるときに同意した決まりのとおり、' }),
            el('p', { text: '見送ると、金額が決まるまで作業は一時停止になり、納期は止まった日数だけ自動でうしろにずれます。' }),
            dn ? el('p', { text: '例：今日見送って、3日後に話がまとまったら → 納期 ' + EM.mdw(dn) + ' が ' + EM.mdw(addDays(dn, 3)) + ' になります。' }) : null
          ]) : el('div', { class: 'notice decline-warn' }, [
            el('p', { text: '見送ると、金額が決まるまで作業は一時停止になります。この案件は決まりができる前に始まったため、納期は自動ではずれません。納期は、話し合って見積もりの中で決めてください。' })
          ]),
          el('label', { class: 'field' }, [el('span', { class: 'label', text: '見送る理由（相手に届きます・任意）' }), why]),
          el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn--danger', text: '見送る', onclick: function () {
            if (!confirm(pend.no_pause ? '見送りますか？\n作業はそのまま続き、納期は変わりません。' : p.rules_agreed_at ? '見送りますか？\n金額が決まるまで作業は一時停止になり、納期は止まった日数だけうしろにずれます。' : '見送りますか？\n金額が決まるまで作業は一時停止になります。')) return;
            decideQuote(pend, 'decline', why.value.trim());
          } }))
        ]);
        card.appendChild(el('div', { class: 'form-actions' }, [
          el('p', { class: 'small', text: '確定すると → 金額 ' + yen(pend.amount) + '・納期 ' + quoteDueText(p, pend) }),
          el('button', { type: 'button', class: 'btn btn--primary', text: '確定する（' + Number(pend.amount).toLocaleString('ja-JP') + '円・納期 ' + (pend.due_on ? EM.mdw(pend.due_on) : dueNow(p) ? EM.mdw(openPause() && p.rules_agreed_at ? addDays(dueNow(p), pauseDays(openPause())) : dueNow(p)) : '相談') + '）', onclick: function () { decideQuote(pend, 'accept'); } }),
          el('button', { type: 'button', class: 'btn', text: '見送る', onclick: function () { dec.hidden = !dec.hidden; } })
        ]));
        card.appendChild(dec);
      } else if (c) {
        card.appendChild(el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn--sm', text: '見積もりの出し直しをお願いする', onclick: function () {
          var t = EM.$('#messageBody'); t.value = '金額について相談させてください。見積もりを出し直していただけますか？\n'; t.scrollIntoView({ block: 'center' }); t.focus();
        } })));
      } else {
        var f = quoteForm(p, now);
        card.appendChild(el('div', { class: 'form-actions' }, [
          el('button', { type: 'button', class: 'btn' + (pend ? '' : ' btn--primary'), text: pend ? '見積もりを出し直す（いまの確定待ちは取り下げ）' : '見積もりを出し直す', onclick: function () { f.hidden = !f.hidden; } }),
          openPause() ? el('button', { type: 'button', class: 'btn', text: '止めずに作業を続ける（納期はずらさない）', onclick: function () { continueWork(p); } }) : null,
          openPause() ? el('button', { type: 'button', class: 'btn', text: '取り下げて、いまの金額のまま再開', onclick: function () { withdrawResume(p, now, true); } })
            : pend ? el('button', { type: 'button', class: 'btn btn--ghost', text: '出した見積もりを取り下げる', onclick: function () { withdrawResume(p, now, false); } }) : null
        ]));
        card.appendChild(f);
      }
      return card;
    }
    function quoteForm(p, now) {
      var amt = el('input', { type: 'number', min: '0', step: '1000', inputmode: 'numeric', placeholder: '例：40000', value: now != null ? String(now) : '' });
      var pz = openPause(), dn = dueNow(p);
      var due = el('input', { type: 'date', min: EM.today(), value: pz && dn && dn >= EM.today() ? dn : '' });
      var note = el('textarea', { rows: '3', maxlength: '1000', placeholder: '例：構成づくりが加わったため、構成代 10,000円を足しました。' });
      var noPause = el('input', { type: 'checkbox' });
      var modeShift = el('input', { type: 'radio', name: 'dueMode', value: 'shift', checked: true });
      var modeFix = el('input', { type: 'radio', name: 'dueMode', value: 'fix' });
      var dueBox;
      if (pz && p.rules_agreed_at && dn) {
        // 止まっているあいだ：納期の決め方を選ぶ（空欄のまま出すと自動でずれてしまう落とし穴をなくす。2026-11-18）
        var fixWrap = el('div', { class: 'stack due-fix', hidden: true }, [
          due,
          el('span', { class: 'hint', text: '納期を動かせないときはこちら。間に合わせるためにかかる費用（特急の分など）は、金額と「何が変わったか」に書いてください。' })
        ]);
        var syncMode = function () { fixWrap.hidden = !modeFix.checked; };
        modeShift.addEventListener('change', syncMode); modeFix.addEventListener('change', syncMode);
        dueBox = el('fieldset', { class: 'field due-mode' }, [
          el('legend', { class: 'label', text: '納期の決め方' }),
          el('label', { class: 'checkbox' }, [modeShift, el('span', { text: '止まった日数だけうしろへ（いま確定すると ' + EM.mdw(addDays(dn, pauseDays(pz))) + '。確定した日で決まります）' })]),
          el('label', { class: 'checkbox' }, [modeFix, el('span', { text: 'この日にする' })]),
          fixWrap
        ]);
      } else {
        dueBox = el('label', { class: 'field' }, [el('span', { class: 'label', text: '納期（変えるときだけ）' }), due]);
      }
      var f = el('form', { class: 'stack flow-form', hidden: true, novalidate: true }, [
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '新しい金額（税込・円・必須）' }), amt]),
        dueBox,
        !pz ? el('label', { class: 'checkbox' }, [noPause, el('span', { text: '見送られても、作業は止めない（この案件は納期を動かせないと分かっています。納期はずらしません）' })]) : null,
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '何が変わったか（1000文字まで）' }), note,
          el('span', { class: 'hint', text: '「何を足した・減らしたから、いくら変わったか」を書くと、クライアントさんが判断しやすくなります。' })]),
        el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn--primary', text: 'この見積もりを送る' }))
      ]);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (amt.value === '') { EM.notice(msg, '新しい金額を入れてください。', 'error'); amt.focus(); return; }
        var dueVal = (pz && p.rules_agreed_at && dn) ? (modeFix.checked ? due.value : null) : (due.value || null);
        if (pz && p.rules_agreed_at && dn && modeFix.checked && !dueVal) { EM.notice(msg, '「この日にする」を選んだときは、日付を入れてください。', 'error'); due.focus(); return; }
        if (busy) return; busy = true;
        sb.rpc('quote_propose', { p_project: p.id, p_amount: Math.round(Number(amt.value)), p_due: dueVal, p_note: note.value.trim() || null, p_no_pause: !pz && noPause.checked }).then(function (r) {
          busy = false;
          if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
          EM.toast('見積もりを送りました'); EM.track('quote_propose', {}); loadDetail();
        });
      });
      return f;
    }
    function continueWork(p) {
      if (!confirm('止めずに作業を続けますか？\n納期は ' + (dueNow(p) ? EM.mdw(dueNow(p)) : '相談') + ' のまま変わりません（止まった日数ぶんはずらしません）。\nクライアントさんにお知らせが届きます。')) return;
      if (busy) return; busy = true;
      sb.rpc('pause_continue', { p_project: p.id }).then(function (r) {
        busy = false;
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.toast('作業を続けることにしました'); EM.track('project_resume', { reply_type: 'continue' }); loadDetail();
      });
    }
    function withdrawResume(p, now, paused) {
      if (!confirm(paused ? '見積もりの出し直しを取り下げて、いまの金額（' + yen(now) + '）のまま作業を再開しますか？\nクライアントさんにお知らせが届きます。'
                          : '出した見積もりを取り下げて、いまの金額（' + yen(now) + '）のまま進めますか？\nクライアントさんにお知らせが届きます。')) return;
      if (busy) return; busy = true;
      sb.rpc('quote_withdraw_resume', { p_project: p.id, p_note: null }).then(function (r) {
        busy = false;
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.toast(paused ? '作業を再開しました' : '見積もりを取り下げました'); EM.track('project_resume', { reply_type: paused ? 'resume' : 'withdraw' }); loadDetail();
      });
    }
    function decideQuote(q, action, reason) {
      if (action === 'accept' && !confirm(q.version + '回目の見積もりで確定しますか？\n金額：' + yen(q.amount) + '\n納期：' + quoteDueText(curP, q) + '\n確定すると、この金額と納期が記録に残ります。')) return;
      if (busy) return; busy = true;
      sb.rpc('quote_decide', { p_quote: q.id, p_action: action, p_reason: reason || null }).then(function (r) {
        busy = false;
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.toast(action === 'accept' ? '確定しました' : '見送りを送りました'); EM.track('quote_decide', { reply_type: action }); loadDetail();
      });
    }
    /* ---- 振込先（2026-11-18 翠くん「入金済みで隠す」） ----
       金額が決まったら、クリエイターが入れてクライアントさんに知らせる。見られるのはその案件の2人だけ。
       入金済み・完了・キャンセルで中身はデータベースから消える。メッセージとメールに口座番号は書かない */
    var payout = null, payoutProfile = null;
    function payoutCard(p, role) {
      var c = role === 'client';
      var amt = p.final_amount != null ? p.final_amount : p.terms_amount;
      var card = el('div', { class: 'card flow-terms payout-card' }, [el('p', { class: 'flow-terms__title', text: 'お支払い（振込先）' })]);
      if (payout && payout.wiped_at) {
        card.appendChild(el('p', { class: 'small muted', text: '入金済みになったので、振込先は消しました（' + EM.date(payout.sent_at) + ' に届いたもの）。' }));
        return card;
      }
      if (['paid', 'closed'].indexOf(p.status) !== -1) { card.appendChild(el('p', { class: 'small muted', text: '入金済みです。' })); return card; }
      card.appendChild(el('p', { class: 'quote-now' }, [el('span', { class: 'small muted', text: 'お支払いの金額' }), el('strong', { text: amt != null ? yen(amt) : '未定' })]));
      var ready = amt != null && !pendingQuote() && !openPause();
      if (payout) {
        var rows = [['銀行', payout.bank_name], ['支店', payout.branch_name], ['種類', payout.account_type], ['口座番号', payout.account_number], ['名義（カナ）', payout.holder_kana]];
        card.appendChild(el('dl', { class: 'payout-dl' }, rows.reduce(function (a, r) {
          a.push(el('dt', { text: r[0] }));
          a.push(el('dd', null, [document.createTextNode(r[1] || ''), c ? el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: 'コピー', onclick: function () {
            try { navigator.clipboard.writeText(r[1] || ''); EM.toast(r[0] + 'をコピーしました'); } catch (e) {}
          } }) : null]));
          return a;
        }, [])));
        if (payout.note) card.appendChild(el('p', { class: 'small', text: 'ひとこと：' + payout.note }));
        card.appendChild(el('p', { class: 'small muted', text: EM.date(payout.sent_at) + ' に届きました。見られるのはこの案件の2人だけです。「入金済み」になると、この振込先は消えます。' }));
        if (c) card.appendChild(el('p', { class: 'small', text: 'お振り込みが済んだら、下の「入金済みにする」を押してください。振込手数料をどちらが持つかは、決まっていなければメッセージで確かめてください。' }));
      } else if (c) {
        card.appendChild(el('p', { class: 'small muted', text: ready ? 'クリエイターさんから振込先が届くと、ここに表示されます。' : '金額が決まると、クリエイターさんから振込先が届きます。' }));
      }
      if (!c && ['in_progress', 'delivered'].indexOf(p.status) !== -1) {
        if (!ready) {
          card.appendChild(el('p', { class: 'small muted', text: '確定待ちの見積もりや一時停止があるあいだは、振込先を送れません。金額が決まってから送ってください。' }));
        } else {
          var f = payoutForm(p, payout || payoutProfile);
          if (payout) { f.hidden = true; card.appendChild(el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn--sm', text: '振込先を直して送り直す', onclick: function () { f.hidden = !f.hidden; } }))); }
          else card.appendChild(el('p', { class: 'small', text: '金額が決まりました。振込先を入れて、クライアントさんに知らせましょう。' }));
          card.appendChild(f);
        }
      }
      return card;
    }
    function payoutForm(p, pre) {
      pre = pre || {};
      var bank = el('input', { type: 'text', maxlength: '40', placeholder: '例：〇〇銀行', value: pre.bank_name || '', autocomplete: 'off' });
      var branch = el('input', { type: 'text', maxlength: '40', placeholder: '例：渋谷支店', value: pre.branch_name || '', autocomplete: 'off' });
      var type = el('select', null, ['普通', '当座', '貯蓄'].map(function (t) { return el('option', { value: t, text: t, selected: (pre.account_type || '普通') === t }); }));
      var num = el('input', { type: 'text', inputmode: 'numeric', maxlength: '7', placeholder: '7けた', value: pre.account_number || '', autocomplete: 'off' });
      var holder = el('input', { type: 'text', maxlength: '60', placeholder: '例：ヤマダ タロウ', value: pre.holder_kana || '', autocomplete: 'off' });
      var note = el('input', { type: 'text', maxlength: '300', placeholder: '例：振込手数料はご負担をお願いします（任意）' });
      var save = el('input', { type: 'checkbox', checked: !!payoutProfile });
      var f = el('form', { class: 'stack flow-form', novalidate: true }, [
        el('div', { class: 'row' }, [el('label', { class: 'field' }, [el('span', { class: 'label', text: '銀行名' }), bank]), el('label', { class: 'field' }, [el('span', { class: 'label', text: '支店名' }), branch])]),
        el('div', { class: 'row' }, [el('label', { class: 'field' }, [el('span', { class: 'label', text: '口座の種類' }), type]), el('label', { class: 'field' }, [el('span', { class: 'label', text: '口座番号（7けた）' }), num])]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '口座の名義（カナ）' }), holder]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: 'ひとこと（任意）' }), note]),
        el('label', { class: 'checkbox' }, [save, el('span', { text: 'この振込先を保存して、次の案件から使う（見られるのは自分だけです）' })]),
        el('p', { class: 'hint', text: '見られるのは、この案件のクライアントさんだけです。やり取りのメッセージやメールには口座番号を書きません。「入金済み」になると、この案件の振込先はデータベースから消えます。' }),
        el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn--primary', text: 'この振込先を知らせる' }))
      ]);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var n = num.value.replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); }).replace(/[^0-9]/g, '');
        if (!bank.value.trim() || !branch.value.trim() || !holder.value.trim()) { EM.notice(msg, '銀行名・支店名・口座の名義を入れてください。', 'error'); return; }
        if (!/^[0-9]{7}$/.test(n)) { EM.notice(msg, '口座番号は7けたの数字で入れてください。', 'error'); num.focus(); return; }
        if (!confirm('この振込先をクライアントさんに知らせますか？\n' + bank.value.trim() + '　' + branch.value.trim() + '\n' + type.value + '　' + n + '\n' + holder.value.trim())) return;
        if (busy) return; busy = true;
        sb.rpc('payout_send', { p_project: p.id, p_bank: bank.value, p_branch: branch.value, p_type: type.value, p_number: n, p_holder: holder.value, p_note: note.value || null, p_save: save.checked }).then(function (r) {
          busy = false;
          if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
          EM.toast('振込先を知らせました'); EM.track('payout_send', {}); loadDetail();
        });
      });
      return f;
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
      if (p.status === 'closed') { box.appendChild(shareBox(p, role)); }
      var wrap = el('div', { class: 'flow' }, [steps(p.status), nextBox(p, role)]);
      box.appendChild(wrap);

      if (['offered', 'proposed'].indexOf(p.status) === -1) {
        if (p.status === 'in_progress') wrap.appendChild(guideBox(role));
        if (p.terms_at) wrap.appendChild(termsCard(p, '始めたときの条件（あとから変えられません）'));
        if (['in_progress', 'delivered', 'paid', 'closed'].indexOf(p.status) !== -1) wrap.appendChild(quotesCard(p, role));
        if (['in_progress', 'delivered', 'paid', 'closed'].indexOf(p.status) !== -1) wrap.appendChild(payoutCard(p, role));
        // 書類（見積書・発注書・納品書・請求書）（2026-11-18）
        if (window.EMDocs && ['proposed', 'in_progress', 'delivered', 'paid', 'closed'].indexOf(p.status) !== -1) {
          wrap.appendChild(EMDocs.card(p, role, { sb: sb, user: user, msg: msg, reload: loadDetail, pendingQuote: pendingQuote, openPause: openPause, quotes: function () { return quotes; } }));
        }
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
        // 始める前に、決まりを読んで同意してもらう（2026-11-18 翠くん「取引開始時にちゃんと知らせる」）
        var agree = el('input', { type: 'checkbox', id: 'dealAgree' });
        var startBtn = el('button', { type: 'button', class: 'btn btn--primary', text: 'この条件で始める', disabled: true, onclick: function () { startProject(p); } });
        agree.addEventListener('change', function () { startBtn.disabled = noAmt || !agree.checked; });
        if (!noAmt) {
          wrap.appendChild(EM.dealRulesBox({ title: '始める前に、この案件の決まりを読んでください', lead: 'この決まりは、クリエイターさんにも同じものが見えています。納得できないところがあれば、始める前にメッセージで相談してください。' }));
          wrap.appendChild(el('label', { class: 'checkbox deal-agree' }, [agree, el('span', { text: '決まりを読んで、同意しました（特に「見送ると作業は一時停止・納期はその分うしろへ」）' })]));
        }
        wrap.appendChild(el('div', { class: 'form-actions' }, [
          startBtn,
          el('button', { type: 'button', class: 'btn', text: '条件を相談する', onclick: function () {
            var t = EM.$('#messageBody'); t.value = noAmt ? '金額を入れた条件を出していただけますか？\n' : '条件について相談させてください。\n'; t.scrollIntoView({ block: 'center' }); t.focus();
          } })
        ]));
        wrap.appendChild(el('p', { class: 'small muted', text: '「この条件で始める」を押すと進行中になり、金額と納期はあとから変えられなくなります。' }));
        return;
      }
      // クリエイター：返事をする前に、始めるときの決まりを見せる（クライアントさんはこれに同意して始める）
      wrap.appendChild(EM.dealRulesBox({ title: 'この案件の決まり', lead: 'クライアントさんは、この決まりに同意してから「この条件で始める」を押します。納期に余裕がない依頼は、条件を出す前にメッセージで確かめておくと安心です。', compact: true }));
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
    var busy = false;   // ボタンの2回押しよけ
    function respond(p, action, amount, due, note) {
      if (action === 'accept' && !confirm('依頼したときの希望のまま受けますか？\n金額：' + yen(p.budget_amount) + '\n納期：' + (p.due_on ? EM.mdw(p.due_on) : '相談') + '\nクライアントさんが「この条件で始める」を押すと進行中になります。')) return;
      if (busy) return; busy = true;
      sb.rpc('project_respond', { p_project: p.id, p_action: action, p_amount: amount === undefined ? null : amount, p_due: due || null, p_note: note || null })
        .then(function (r) {
          busy = false;
          if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
          EM.toast(action === 'decline' ? 'お断りを送りました' : '返事を送りました');
          EM.track('project_reply', { reply_type: action });
          loadDetail();
        });
    }
    function startProject(p) {
      var ag = EM.$('#dealAgree');
      if (!ag || !ag.checked) { EM.notice(msg, '「この案件の決まり」を読んで、チェックを入れてから始めてください。', 'error'); return; }
      if (!confirm('この条件で始めますか？\n金額：' + yen(p.terms_amount) + '\n納期：' + (p.terms_due_on ? EM.mdw(p.terms_due_on) : '相談') + '\n始めたあとは条件を変えられません。\n「この案件の決まり」に同意して始めます。')) return;
      if (busy) return; busy = true;
      sb.rpc('project_start', { p_project: p.id, p_rules_version: EM.DEAL_RULES_VERSION }).then(function (r) {
        busy = false;
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
        .select('id,sender_id,body,files,created_at')
        .eq('project_id', projectId)
        .order('created_at')
        .then(function (r) {
          var box = EM.clear(EM.$('#messages'));
          var whoBox = EM.clear(EM.$('#msgWho'));
          if (names.otherRole) {
            whoBox.hidden = false;
            whoBox.appendChild(el('p', { class: 'small' }, [
              el('span', { class: 'muted', text: '相手（' + names.otherRole + '）：' }), el('strong', { text: names.other + ' さん' }),
              el('span', { class: 'muted', text: '　／　あなた：' }), el('span', { text: names.me })
            ]));
          }
          var rows = r.data || [];
          if (!rows.length) { box.appendChild(el('div', { class: 'empty', text: 'まだやり取りはありません。' })); return; }
          // 付いた画像・PDFは、1時間だけ開けるリンクをまとめてもらう
          var all = []; rows.forEach(function (m) { (m.files || []).forEach(function (f) { all.push(f); }); });
          var urlsP = all.length ? sb.storage.from('project-files').createSignedUrls(all, 3600).then(function (x) {
            var map = {}; (x.data || []).forEach(function (d) { if (d.signedUrl) map[d.path] = d.signedUrl; }); return map;
          }) : Promise.resolve({});
          rows.forEach(function (m) {
            var mine = m.sender_id === user.id;
            var filesBox = (m.files || []).length ? el('div', { class: 'msg__files' }) : null;
            if (filesBox) urlsP.then(function (map) {
              var pdfNo = 0, pdfAll = m.files.filter(function (f) { return /\.pdf$/i.test(f); }).length;
              m.files.forEach(function (f) {
                var u = map[f]; var isPdf = /\.pdf$/i.test(f);
                if (!u) { filesBox.appendChild(el('span', { class: 'small muted', text: 'ファイルを開けませんでした' })); return; }
                if (isPdf) { pdfNo++; filesBox.appendChild(el('a', { class: 'btn btn--sm', href: u, target: '_blank', rel: 'noopener', text: '📄 PDF を開く' + (pdfAll > 1 ? '（' + pdfNo + '）' : '') })); }
                else filesBox.appendChild(el('a', { class: 'msg__thumb', href: u, target: '_blank', rel: 'noopener', title: '大きく見る' }, el('img', { src: u, alt: '付いた画像', loading: 'lazy' })));
              });
            });
            box.appendChild(el('div', { class: 'card msg' + (mine ? ' msg--mine' : '') }, [
              el('p', { class: 'small muted' }, [
                el('strong', { class: 'msg__name', text: mine ? names.me + '（あなた）' : names.other + ' さん' }),
                document.createTextNode(' / ' + EM.datetime(m.created_at))
              ]),
              (m.body && m.body !== FILE_ONLY) ? el('p', { class: 'msg__body' }, EM.linkify(m.body)) : null,
              filesBox
            ]));
          });
        });
    }

    var sending = false;
    var FILE_ONLY = '（画像・ファイルを送りました）';
    var attach = null;
    // やり取りに画像・PDFを付ける（2026-11-17 相手の方「作りかけの画像を添付できたら」）。終わった案件には付けられない
    function mountAttach(p) {
      var slot = EM.$('#messageAttach'); if (!slot) return;
      EM.clear(slot); attach = null;
      if (['closed', 'cancelled', 'declined'].indexOf(p.status) !== -1) {
        slot.appendChild(el('p', { class: 'small muted', text: 'この案件は終わっているので、新しい画像・PDFは付けられません。付いている画像・PDFは、終わってから90日で自動で消えます。' }));
        return;
      }
      attach = EM.attachBox(user, {
        bucket: 'project-files', folder: p.id, maxMB: 10, spaceRpc: 'project_space_ok',
        ok: /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/, accept: 'image/*,application/pdf',
        kindText: '画像・PDF', formatHelp: '動画は Google ドライブなどに置いて、リンクを文章に貼ってください。',
        sizeHelp: '画像は小さくしてから、大きいものは Google ドライブなどのリンクで送ってください。',
        fullText: 'いまは画像・PDFを付けられません（置き場がいっぱいです）。Google ドライブなどのリンクを文章に貼って送ってください。',
        hint: '見られるのは、この案件の2人だけです。動画は Google ドライブなどのリンクを文章に貼ってください（URLは押せるリンクになります）。案件が終わってから90日たつと、画像・PDFは自動で消えます（文章は残ります）。'
      });
      slot.appendChild(attach.node);
    }
    EM.$('#messageForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = EM.$('#messageBody').value.trim();
      var nFiles = attach ? attach.count() : 0;
      if ((!body && !nFiles) || sending) return;
      if (!body) body = FILE_ONLY;
      // 2回押しで同じものが2つ届かないように、送っている間はボタンを止める（2026-11-17 同じメッセージが0.1秒差で2つ届いた）
      sending = true;
      var btn = EM.$('#messageSend'); btn.disabled = true; btn.textContent = '送信中…';
      (nFiles ? attach.upload() : Promise.resolve([]))
        .then(function (paths) { return sb.from('project_messages').insert({ project_id: projectId, sender_id: user.id, body: body, files: paths }); })
        .catch(function (e) { return { error: e }; })
        .then(function (r) {
          sending = false; btn.disabled = false; btn.textContent = '送信';
          if (r.error) { EM.notice(msg, r.error.message && !r.error.code ? r.error.message : EM.errorText(r.error), 'error'); return; }
          if (attach) attach.clear();
          EM.$('#messageBody').value = '';
          loadMessages();
        });
    });
  });
})(window.EM);
