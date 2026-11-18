/* Eizo Maps — 募集の詳しいページ（2026-11-15 翠くん）
   ・募集を出した人：届いた提案を比べて「この人を選ぶ」／「募集を締め切る」
   ・クリエイター：「提案を送る」（金額・納期・ひとこと・見てほしい作品3つまで）／送った提案の取り下げ
   ・そのほかの人：内容だけ見られる */
(function (EM) {
  'use strict';
  var PROP_LABEL = { sent: '送りました（返事待ち）', chosen: '選ばれました', passed: '今回は見送りになりました', withdrawn: '取り下げました' };

  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    var postBox = EM.$('#postBox'), act = EM.$('#actionBox');
    if (!sb) return;
    var id = EM.param('id');
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) { EM.clear(postBox); EM.notice(msg, '募集が指定されていません。', 'error'); return; }
    if (EM.param('edited')) EM.notice(msg, '募集の内容を直しました。', 'ok');
    if (EM.param('posted')) EM.notice(msg, '募集を出しました。提案が届くと、このページに並びます。トップの「出した募集」や、メニューの「出した募集」からも見られます。', 'ok');

    var post = null, genres = [], byId = {}, user = null, myClient = null, myCreator = null;

    Promise.all([
      sb.from('job_posts').select('*').eq('id', id).maybeSingle(),
      EM.jobs.load().catch(function () { return []; }),
      EM.getUser()
    ]).then(function (r) {
      post = r[0].data || null;
      genres = r[1] || []; genres.forEach(function (g) { byId[g.id] = g; });
      user = r[2];
      if (!post) {
        EM.clear(postBox);
        postBox.appendChild(el('div', { class: 'empty' }, [
          document.createTextNode('この募集は締め切られたか、見つかりませんでした。'), el('br'),
          el('a', { href: '/jobs/', text: 'ほかの募集を見る →' })
        ]));
        return;
      }
      document.title = post.title + ' — 募集 — Eizo Maps';
      renderPost();
      if (!user) { renderGuest(); return; }
      return Promise.all([sb.rpc('my_client_id'), sb.rpc('my_creator_id')]).then(function (x) {
        myClient = x[0].data || null; myCreator = x[1].data || null;
        if (myClient && myClient === post.client_id) return renderOwner();
        if (myCreator) return renderCreator();
        renderGuest();
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function renderPost() {
      EM.clear(postBox);
      var names = (post.genre_ids || []).map(function (g) { return byId[g] && byId[g].name_ja; }).filter(Boolean);
      var dl = el('dl');
      function row(k, v) { if (!v) return; dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); }
      row('案件の種類', post.kind);
      row('予算', EM.budgetLabel(post.budget_amount));
      row('地域', (post.area_pref || 'どこでも') + (post.remote_ok ? '（遠方・オンラインもOK）' : ''));
      row('希望納期', post.due_on ? EM.mdw(post.due_on) : '相談');
      row('締め切り', EM.mdw(post.closes_on) + '　' + (post.status === 'open' ? EM.jobDaysLeft(post.closes_on) : ''));
      row('掲載日', EM.date(post.created_at));
      var state = post.status === 'filled' ? '決まりました' : post.status === 'closed' || EM.dayDiff(EM.today(), post.closes_on) < 0 ? '締め切りました' : '募集中';
      postBox.appendChild(el('p', { class: 'eyebrow eyebrow--client', text: 'Job · ' + state }));
      postBox.appendChild(el('h1', { text: post.title }));
      if (names.length) postBox.appendChild(el('div', { class: 'chips' }, names.map(function (n) { return el('span', { class: 'chip', text: n }); })));
      postBox.appendChild(el('div', { class: 'card' }, [el('p', { class: 'job-desc', text: post.description }), dl]));
      postBox.appendChild(el('p', { class: 'small muted', text: '依頼した人の名前は、提案が選ばれたときにわかります。' }));
    }
    function isOpen() { return post.status === 'open' && EM.dayDiff(EM.today(), post.closes_on) >= 0; }

    /* ---- そのほかの人 ---- */
    function renderGuest() {
      EM.clear(act);
      if (!isOpen()) return;
      act.appendChild(el('div', { class: 'card stack' }, [
        el('h2', { text: 'この募集に提案する' }),
        el('p', { text: '提案を送れるのは、プロフィールを公開しているクリエイターです。' }),
        el('div', { class: 'form-actions' }, user
          ? [el('a', { class: 'btn btn--primary', href: '/mypage/', text: 'クリエイターのプロフィールを作る' })]
          : [el('a', { class: 'btn btn--primary', href: '/auth/?next=' + encodeURIComponent(location.pathname + location.search), text: 'ログイン・登録して提案する' })])
      ]));
    }

    /* ---- クリエイター ---- */
    function renderCreator() {
      return Promise.all([
        sb.from('job_proposals').select('*').eq('post_id', post.id).eq('creator_id', myCreator).maybeSingle(),
        sb.from('creators').select('is_published').eq('id', myCreator).maybeSingle(),
        sb.from('portfolios').select('id,title,thumbnail_url').eq('creator_id', myCreator).eq('visibility', 'public').order('sort_order').limit(60)
      ]).then(function (r) {
        EM.clear(act);
        var mine = r[0].data, pub = r[1].data && r[1].data.is_published, works = r[2].data || [];
        if (mine) { act.appendChild(myProposalCard(mine, works)); return; }
        if (!isOpen()) { act.appendChild(el('p', { class: 'muted', text: 'この募集は締め切られました。' })); return; }
        if (!pub) {
          act.appendChild(el('div', { class: 'notice' }, [
            document.createTextNode('提案を送るには、プロフィールを公開してください。 '),
            el('a', { href: '/mypage/', text: 'マイページへ →' })
          ]));
          return;
        }
        act.appendChild(proposalForm(works));
      });
    }
    function myProposalCard(p, works) {
      var card = el('div', { class: 'card stack job-prop job-prop--' + p.status }, [
        el('h2', { text: 'あなたの提案' }),
        el('p', { class: 'job-prop__state', text: PROP_LABEL[p.status] || p.status }),
        propBody(p, works)
      ]);
      if (p.status === 'chosen') {
        sb.from('projects').select('id').eq('job_post_id', post.id).eq('creator_id', myCreator).maybeSingle().then(function (x) {
          if (x.data) card.appendChild(el('a', { class: 'btn btn--primary', href: '/projects/?id=' + encodeURIComponent(x.data.id), text: '案件のページを開く' }));
        });
      }
      if (p.status === 'sent') {
        card.appendChild(el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn--sm btn--danger', text: '提案を取り下げる', onclick: function () {
          if (!confirm('この提案を取り下げますか？\nもう一度は送れません。')) return;
          sb.from('job_proposals').update({ status: 'withdrawn' }).eq('id', p.id).then(function (x) {
            if (x.error) { EM.notice(msg, EM.errorText(x.error), 'error'); return; }
            EM.toast('取り下げました'); renderCreator();
          });
        } })));
      }
      return card;
    }
    function proposalForm(works) {
      var amt = el('input', { type: 'number', min: '0', step: '1000', inputmode: 'numeric', placeholder: '例：120000' });
      var due = el('input', { type: 'date', min: EM.today() });
      if (post.due_on) due.value = post.due_on;
      var note = el('textarea', { rows: '6', maxlength: '2000', placeholder: '例：同じようなカフェの縦型動画を10本以上作っています。撮影は半日、編集込みで1週間で納品できます。' });
      var picked = [];
      var workBox = el('div', { class: 'job-works' });
      if (!works.length) workBox.appendChild(el('p', { class: 'small muted', text: '公開中の作品がまだありません（作品がなくても送れます）。' }));
      works.forEach(function (w) {
        var cb = el('input', { type: 'checkbox', value: w.id });
        cb.addEventListener('change', function () {
          if (cb.checked) { if (picked.length >= 3) { cb.checked = false; EM.toast('作品は3つまで選べます'); return; } picked.push(w.id); }
          else picked.splice(picked.indexOf(w.id), 1);
        });
        workBox.appendChild(el('label', { class: 'job-work' }, [cb,
          w.thumbnail_url ? el('img', { src: w.thumbnail_url, alt: '', loading: 'lazy' }) : null,
          el('span', { class: 'small', text: w.title })]));
      });
      var f = el('form', { class: 'card stack', novalidate: true }, [
        el('h2', { text: 'この募集に提案する' }),
        el('p', { class: 'small muted', text: '提案は、募集を出した人にだけ見えます。選ばれると案件のページができ、そこで条件を確かめてから始まります。' }),
        el('div', { class: 'row' }, [
          el('label', { class: 'field' }, [el('span', { class: 'label', text: '金額（税込・円）' }), amt]),
          el('label', { class: 'field' }, [el('span', { class: 'label', text: '納期' }), due])
        ]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: 'ひとこと（必須・10〜2000文字）' }), note]),
        el('div', { class: 'field' }, [el('span', { class: 'label', text: '見てほしい作品（3つまで）' }), workBox]),
        EM.dealRulesBox({ title: '仕事を始めるときの決まり', lead: '提案が選ばれて仕事が始まるときは、クライアントさんがこの決まりに同意してから始めます。', compact: true }),
        el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn--primary', text: '提案を送る' }))
      ]);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (note.value.trim().length < 10) { EM.notice(msg, 'ひとことは10文字以上で書いてください。', 'error'); return; }
        sb.from('job_proposals').insert({
          post_id: post.id, creator_id: myCreator, message: note.value.trim(),
          amount: amt.value === '' ? null : Math.round(Number(amt.value)), due_on: due.value || null, portfolio_ids: picked
        }).then(function (x) {
          if (x.error) { EM.notice(msg, EM.errorText(x.error), 'error'); return; }
          EM.track('generate_lead', { lead_source: 'job_proposal' });
          EM.toast('提案を送りました'); renderCreator();
        });
      });
      return f;
    }
    function propBody(p, works) {
      var byW = {}; (works || []).forEach(function (w) { byW[w.id] = w; });
      var dl = el('dl');
      dl.appendChild(el('dt', { text: '金額' })); dl.appendChild(el('dd', { class: 'flow-big', text: p.amount == null ? '相談' : Number(p.amount).toLocaleString('ja-JP') + '円（税込）' }));
      dl.appendChild(el('dt', { text: '納期' })); dl.appendChild(el('dd', { text: p.due_on ? EM.mdw(p.due_on) : '相談' }));
      var ws = (p.portfolio_ids || []).map(function (i) { return byW[i]; }).filter(Boolean);
      return el('div', null, [
        dl,
        el('p', { class: 'job-desc', text: p.message }),
        ws.length ? el('div', { class: 'job-works job-works--view' }, ws.map(function (w) {
          return el('a', { class: 'job-work', href: '/creators/detail.html?id=' + encodeURIComponent(p.creator_id) + '#works', target: '_blank', rel: 'noopener' }, [
            w.thumbnail_url ? el('img', { src: w.thumbnail_url, alt: '', loading: 'lazy' }) : null,
            el('span', { class: 'small', text: w.title })]);
        })) : null,
        el('p', { class: 'small muted', text: '送った日時：' + EM.datetime(p.created_at) })
      ]);
    }

    /* ---- 募集を出した人 ---- */
    function renderOwner() {
      return sb.from('job_proposals').select('*,creators(id,handle,display_name,headline,avatar_url,area_pref)')
        .eq('post_id', post.id).order('created_at').then(function (r) {
          if (r.error) throw r.error;
          var props = (r.data || []).filter(function (p) { return p.status !== 'withdrawn'; });
          var wids = []; props.forEach(function (p) { wids = wids.concat(p.portfolio_ids || []); });
          return (wids.length ? sb.from('portfolios').select('id,title,thumbnail_url').in('id', wids) : Promise.resolve({ data: [] }))
            .then(function (w) { drawOwner(props, w.data || []); });
        });
    }
    function drawOwner(props, works) {
      EM.clear(act);
      var head = el('div', { class: 'page-head' }, [el('h2', { text: '届いた提案（' + props.length + '件）' })]);
      if (post.status === 'open') {
        head.appendChild(el('div', { class: 'form-actions' }, [
          el('a', { class: 'btn btn--sm', href: '/jobs/new.html?id=' + encodeURIComponent(post.id), text: '内容を直す' }),
          el('button', { type: 'button', class: 'btn btn--sm', text: '募集を締め切る', onclick: closePost })
        ]));
      }
      act.appendChild(head);
      if (post.status === 'filled' && post.filled_project_id) {
        act.appendChild(el('div', { class: 'notice' }, [document.createTextNode('この募集は決まりました。 '),
          el('a', { href: '/projects/?id=' + encodeURIComponent(post.filled_project_id), text: '案件のページを開く →' })]));
      }
      if (!props.length) {
        act.appendChild(el('div', { class: 'empty', text: post.status === 'open'
          ? 'まだ提案は届いていません。届くと、ここに金額・納期・ひとことが並びます。'
          : '提案は届きませんでした。' }));
        return;
      }
      act.appendChild(el('p', { class: 'small muted', text: '「この人を選ぶ」を押すと案件のページができ、ほかの人の提案は「今回は見送り」になります。選んだあと、案件のページで条件を確かめて「この条件で始める」を押すと始まります。' }));
      props.forEach(function (p) {
        var c = p.creators || {};
        var card = el('div', { class: 'card stack job-prop job-prop--' + p.status }, [
          el('div', { class: 'row job-prop__who' }, [
            EM.avatar(c.avatar_url, c.display_name),
            el('div', null, [
              el('a', { class: 'pf-title', href: c.handle ? '/@' + c.handle : '/creators/detail.html?id=' + encodeURIComponent(c.id), target: '_blank', rel: 'noopener', text: (c.display_name || '') + ' さん' }),
              el('p', { class: 'small muted', text: [c.headline, c.area_pref].filter(Boolean).join(' / ') })
            ]),
            p.status !== 'sent' ? el('span', { class: 'tag', text: p.status === 'chosen' ? '選んだ人' : '見送り' }) : null
          ]),
          propBody(p, works)
        ]);
        if (p.status === 'sent' && post.status === 'open') {
          card.appendChild(el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn--primary', text: 'この人を選ぶ', onclick: function () { choose(p, c); } })));
        }
        act.appendChild(card);
      });
    }
    function choose(p, c) {
      if (!confirm((c.display_name || '') + ' さんの提案を選びますか？\nほかの人の提案は「今回は見送り」になります。\n選んだあと、案件のページで条件を確かめてから始めます。')) return;
      sb.rpc('choose_job_proposal', { p_proposal: p.id }).then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        location.href = '/projects/?id=' + encodeURIComponent(r.data);
      });
    }
    function closePost() {
      if (!confirm('この募集を締め切りますか？\n届いている提案はすべて「今回は見送り」になります。')) return;
      sb.from('job_posts').update({ status: 'closed' }).eq('id', post.id).select('*').single().then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        post = r.data; EM.toast('締め切りました'); renderPost(); renderOwner();
      });
    }
  });
})(window.EM);
