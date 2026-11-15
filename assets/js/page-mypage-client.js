/* Eizo Maps — クライアントのマイページ（2026-11-15 翠くん）
   ・評価をまだ書いていない、納品が終わった案件
   ・やりとり中の依頼
   ・基本情報（clients：名前・会社名・地域。依頼したクリエイターにだけ見える）
   ・評価（page-myreviews.js が #myReviews に出す）
   ・利用種別（変えたら、合うマイページへ移る） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }

    var user = null, client = null, bar = null;
    var formDirty = false, typeDirty = false;
    var ACTIVE = ['draft', 'offered', 'proposed', 'in_progress', 'delivered', 'paid'];

    EM.PREFS.forEach(function (p) { EM.$('#clArea').appendChild(el('option', { value: p, text: p })); });
    EM.$('#logoutBtn').addEventListener('click', function () { EM.signOut(); });
    EM.mountNotifyToggle(EM.$('#notifyBox'));

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return Promise.all([
        sb.from('clients').select('*').eq('user_id', u.id).maybeSingle(),
        EM.myAccountType(),
        sb.rpc('my_client_id')
      ]);
    }).then(function (res) {
      if (!res) return;
      client = res[0].data || null;
      EM.$('#accountType').value = res[1] || 'client';
      if (client) {
        EM.$('#clName').value = client.display_name || '';
        EM.$('#clCompany').value = client.company || '';
        EM.$('#clArea').value = client.area_pref || '';
        EM.$('#clSearchVisible').checked = client.search_visible !== false;
      } else {
        EM.notice(msg, 'まずは下の「基本情報」にお名前を入れて保存してください。依頼のときに、相手のクリエイターに伝わります。');
      }
      mountSaveBar();
      return loadProjects(res[2].data || null);
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    /* ---- 依頼した案件 ---- */
    function loadProjects(clientId) {
      var box = EM.$('#activeProjects');
      if (!clientId) { renderActive(box, []); return; }
      return Promise.all([
        sb.from('projects')
          .select('id,title,kind,status,budget_amount,updated_at,creators(id,display_name)')
          .eq('client_id', clientId).order('updated_at', { ascending: false }).limit(100),
        sb.from('reviews').select('project_id').eq('reviewer_id', user.id)
      ]).then(function (r) {
        if (r[0].error) throw r[0].error;
        var rows = r[0].data || [];
        var reviewed = {};
        (r[1].data || []).forEach(function (x) { if (x.project_id) reviewed[x.project_id] = true; });
        renderToReview(rows.filter(function (p) { return EM.canReview(p.status) && !reviewed[p.id]; }));
        renderActive(box, rows.filter(function (p) { return ACTIVE.indexOf(p.status) !== -1; }));
      });
    }

    function projectCard(p, extra) {
      var who = (p.creators && p.creators.display_name) || '';
      return el('div', { class: 'card cl-proj' }, [
        el('a', { class: 'cl-proj__main', href: '/projects/?id=' + encodeURIComponent(p.id) }, [
          el('p', { class: 'pf-title', text: p.title }),
          el('p', { class: 'small muted', text: [who ? who + ' さん' : '', p.kind, EM.budgetLabel(p.budget_amount)].filter(Boolean).join(' / ') })
        ]),
        el('div', { class: 'row' }, [EM.statusBadge(p.status), el('span', { class: 'small muted', text: EM.date(p.updated_at) })].concat(extra || []))
      ]);
    }

    function renderActive(box, rows) {
      EM.clear(box);
      if (!rows.length) {
        box.appendChild(el('div', { class: 'empty' }, [
          document.createTextNode('いま進んでいる依頼はありません。'),
          el('br'),
          el('a', { href: '/creators/', text: 'クリエイターを探す →' })
        ]));
        return;
      }
      rows.forEach(function (p) { box.appendChild(projectCard(p)); });
    }

    function renderToReview(rows) {
      var wrap = EM.$('#toReviewBox'), box = EM.clear(EM.$('#toReview'));
      wrap.hidden = !rows.length;
      rows.forEach(function (p) {
        box.appendChild(projectCard(p, [
          el('a', { class: 'btn btn--sm btn--primary', href: '/projects/review.html?id=' + encodeURIComponent(p.id), text: '評価を書く' })
        ]));
      });
    }

    /* ---- 保存（画面下のバーで、基本情報と利用種別をまとめて） ---- */
    function mountSaveBar() {
      if (bar) return;
      bar = EM.saveBar({
        watch: [EM.$('#clientForm'), EM.$('#accountType')],
        savedAt: client && client.updated_at,
        onSave: saveAll
      });
      EM.$('#clientForm').addEventListener('input', function () { formDirty = true; });
      EM.$('#clientForm').addEventListener('change', function () { formDirty = true; });
      EM.$('#accountType').addEventListener('change', function () { typeDirty = true; });
      EM.$('#clientForm').addEventListener('submit', function (e) { e.preventDefault(); bar.save().catch(function () {}); });
    }

    function saveAll() {
      var savedAt = null;
      var p1 = Promise.resolve();
      if (formDirty) {
        var name = EM.$('#clName').value.trim();
        if (!name) { EM.notice(msg, 'お名前を入力してください。', 'error'); return false; }
        var payload = {
          display_name: name,
          company: EM.$('#clCompany').value.trim() || null,
          area_pref: EM.$('#clArea').value || null,
          search_visible: EM.$('#clSearchVisible').checked
        };
        p1 = (client && client.id
          ? sb.from('clients').update(payload).eq('id', client.id).select('*').single()
          : sb.from('clients').insert(Object.assign({ user_id: user.id }, payload)).select('*').single()
        ).then(function (r) {
          if (r.error) throw r.error;
          if (!client) EM.track('sign_up', { method: 'client_profile' });
          client = r.data;
          savedAt = client.updated_at;
        });
      }
      return p1.then(function () {
        if (!typeDirty) return;
        var t = EM.$('#accountType').value;
        return sb.from('users').update({ account_type: t, onboarded: true }).eq('id', user.id).then(function (r) {
          if (r.error) throw r.error;
          // クリエイターだけにしたら、クリエイターのマイページへ。両方なら帯を付け直す
          if (t === 'creator') { EM.setViewMode('creator'); setTimeout(function () { location.replace('/mypage/'); }, 600); }
          else { EM.setViewMode('client'); setTimeout(function () { location.reload(); }, 600); }
        });
      }).then(function () {
        formDirty = false; typeDirty = false;
        EM.notice(msg, '');
        return savedAt || new Date().toISOString();
      }).catch(function (err) {
        EM.notice(msg, EM.errorText(err), 'error');
        throw err;
      });
    }
  });
})(window.EM);
