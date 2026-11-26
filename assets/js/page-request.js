/* Eizo Maps — 依頼フォーム */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var creatorId = EM.param('creator_id');
    var user = null, client = null, creator = null;

    if (!/^[0-9a-f-]{36}$/i.test(String(creatorId || ''))) {
      EM.notice(msg, '依頼先のクリエイターが指定されていません。', 'error');
      return;
    }
    EM.$('#backLink').href = '/creators/detail.html?id=' + encodeURIComponent(creatorId);

    // 選択肢を組み立てる
    EM.PREFS.forEach(function (p) { EM.$('#clientArea').appendChild(el('option', { value: p, text: p })); });
    EM.PROJECT_KINDS.forEach(function (k) { EM.$('#kind').appendChild(el('option', { value: k, text: k })); });
    EM.BUDGETS.forEach(function (b, i) {
      EM.$('#budget').appendChild(el('option', { value: b.v === null ? '' : String(b.v), text: b.l, selected: i === 0 }));
    });

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return Promise.all([
        sb.from('creators').select('id,display_name,headline,area_pref,avatar_url,is_published,contact_pref,contact_dm_url').eq('id', creatorId).maybeSingle(),
        sb.from('clients').select('*').eq('user_id', u.id).maybeSingle()
      ]);
    }).then(function (res) {
      if (!res) return;
      creator = res[0].data;
      client = res[1].data;

      if (!creator || !creator.is_published) {
        EM.notice(msg, 'このクリエイターは現在依頼を受け付けていません。', 'error');
        return;
      }

      var card = EM.$('#creatorCard');
      card.hidden = false;
      card.appendChild(el('div', { class: 'row' }, [
        EM.avatar(creator.avatar_url, creator.display_name),
        el('div', null, [
          el('p', { class: 'small muted', text: '依頼先' }),
          el('p', { class: 'pf-title', text: creator.display_name }),
          el('p', { class: 'small muted', text: [creator.headline, creator.area_pref].filter(Boolean).join(' / ') })
        ])
      ]));

      // DM のみで受け付けているクリエイターには、フォームではなく DM へ案内する
      if (creator.contact_pref === 'dm') {
        var dm = EM.safeUrl(creator.contact_dm_url);
        EM.notice(msg, creator.display_name + ' さんは SNS の DM での連絡を希望しています。', 'error');
        if (dm) {
          card.appendChild(el('div', { class: 'form-actions' },
            el('a', { class: 'btn btn--primary', href: dm, target: '_blank',
                      rel: 'noopener noreferrer nofollow', text: 'SNS の DM で連絡する' })));
        }
        return;
      }

      if (client) {
        EM.$('#clientName').value = client.display_name || '';
        EM.$('#clientCompany').value = client.company || '';
        EM.$('#clientArea').value = client.area_pref || '';
      }
      EM.$('#requestForm').hidden = false;
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    /* ---- どこまで頼むか（2026-11-26 翠くん）----
       クリエイターから言いにくいこと（編集だけだと変えられる所が少ない／企画・撮影は別の予算）を、Eizo Maps が先に伝える。
       選んだ内容は、依頼の文のいちばん上に入る（クリエイターにも同じ文が見える） */
    var planAsk = null;
    function scopes() { return Array.prototype.slice.call(document.querySelectorAll('input[name="scope"]:checked')).map(function (x) { return x.value; }); }
    function scopeHint() {
      var box = EM.$('#scopeHint'), sc = scopes();
      EM.clear(box); planAsk = null;
      var editOnly = sc.length === 1 && sc[0] === '編集';
      var noPlan = sc.length && sc.indexOf('企画・構成') === -1 && sc.indexOf('まだ決めていない') === -1;
      if (!noPlan) { box.hidden = true; return; }
      box.hidden = false;
      var A = EM.ASSIST;
      box.appendChild(el('p', { class: 'small' }, [el('strong', { text: editOnly ? '編集だけのご依頼ですね。先に1つだけお伝えします。' : '先に、動画づくりの3つの役割をお伝えします。' })]));
      if (editOnly) box.appendChild(el('p', { class: 'small', text: A.editOnlyLead }));
      box.appendChild(el('ul', { class: 'small scope-roles' }, A.roles.map(function (r) {
        return el('li', null, [el('strong', { text: r[0] }), document.createTextNode('：' + r[1])]);
      })));
      box.appendChild(el('p', { class: 'small', text: A.consult }));
      planAsk = el('input', { type: 'checkbox' });
      box.appendChild(el('label', { class: 'small scope-ask' }, [planAsk, document.createTextNode(' 企画も相談したい（予算は相談）')]));
    }
    EM.$('#scopePick').addEventListener('change', scopeHint);
    function scopeText() {
      var sc = scopes(), out = [];
      if (sc.length) out.push('■ 頼みたい範囲：' + sc.join('・'));   // 「【」で始めない（「【」で始まるメッセージは自動の記録として、お知らせが飛ばない）
      if (planAsk && planAsk.checked) out.push('■ 企画について：企画も相談したいです（予算は相談させてください）');
      return out.join('\n');
    }
    function fullDescription() {
      var head = scopeText(), body = EM.$('#description').value.trim();
      return ((head ? head + '\n\n' : '') + body).slice(0, 4000);
    }

    EM.$('#requestForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = EM.$('#clientName').value.trim();
      var title = EM.$('#title').value.trim();
      if (!name)  { EM.notice(msg, 'お名前を入力してください。', 'error'); return; }
      if (!title) { EM.notice(msg, '案件タイトルを入力してください。', 'error'); return; }

      var ref = EM.$('#referenceUrl').value.trim();
      if (ref && !EM.safeUrl(ref)) { EM.notice(msg, '参考URLは https:// から始まる URL を入力してください。', 'error'); return; }

      var btn = EM.$('#submitBtn');
      btn.setAttribute('aria-busy', 'true');
      EM.notice(msg, '送信しています…');

      var clientPayload = {
        display_name: name,
        company: EM.$('#clientCompany').value.trim() || null,
        area_pref: EM.$('#clientArea').value || null
      };

      var ensureClient = client
        ? sb.from('clients').update(clientPayload).eq('id', client.id).select('id').single()
        : sb.from('clients').insert(Object.assign({ user_id: user.id }, clientPayload)).select('id').single();

      ensureClient.then(function (r) {
        if (r.error) throw r.error;
        var budgetRaw = EM.$('#budget').value;
        return sb.from('projects').insert({
          client_id: r.data.id,
          creator_id: creator.id,
          title: title,
          description: fullDescription() || null,
          kind: EM.$('#kind').value || null,
          status: 'offered',
          budget_amount: budgetRaw === '' ? null : Number(budgetRaw),
          due_on: EM.$('#dueOn').value || null,
          reference_url: ref || null
        }).select('id').single();
      }).then(function (r) {
        if (r.error) throw r.error;
        // 依頼内容を最初のメッセージとしても残す（やり取りの起点になる）
        var body = fullDescription();
        var first = body
          ? sb.from('project_messages').insert({ project_id: r.data.id, sender_id: user.id, body: body })
          : Promise.resolve();
        return first.then(function () { return r.data.id; });
      }).then(function (id) {
        // 利用種別を「クライアント」側に寄せておく
        sb.from('users').select('account_type').eq('id', user.id).maybeSingle().then(function (u2) {
          if (u2.data && u2.data.account_type === 'creator') {
            sb.from('users').update({ account_type: 'both' }).eq('id', user.id);
          }
        });
        EM.track('generate_lead', { lead_source: 'request_form' }, function () {
          location.replace('/projects/?id=' + encodeURIComponent(id) + '&sent=1');
        });
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    });
  });
})(window.EM);
