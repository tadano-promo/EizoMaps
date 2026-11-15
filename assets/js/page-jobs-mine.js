/* Eizo Maps — 自分の募集・提案（2026-11-15 翠くん）
   クライアントとして使っているとき：出した募集（提案の数つき）
   クリエイターとして使っているとき：送った提案（返事待ち・選ばれた・見送り） */
(function (EM) {
  'use strict';
  var PROP_LABEL = { sent: '返事待ち', chosen: '選ばれました', passed: '今回は見送り', withdrawn: '取り下げ' };
  var POST_LABEL = { open: '募集中', filled: '決まりました', closed: '締め切りました' };

  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;
    var byId = {};

    EM.requireUser().then(function (u) {
      if (!u) return;
      return Promise.all([EM.myAccountType(), EM.jobs.load().catch(function () { return []; }), sb.rpc('my_client_id'), sb.rpc('my_creator_id')]);
    }).then(function (r) {
      if (!r) return;
      (r[1] || []).forEach(function (g) { byId[g.id] = g; });
      var mode = EM.viewModeFor(r[0]);
      if (mode === 'client') {
        EM.$('#mineTitle').textContent = '出した募集';
        EM.$('#mineEyebrow').classList.add('eyebrow--client');
        EM.$('#postsSection').hidden = false;
        return loadPosts(r[2].data);
      }
      EM.$('#mineTitle').textContent = '送った提案';
      EM.$('#propsSection').hidden = false;
      return loadProps(r[3].data);
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function loadPosts(clientId) {
      var box = EM.$('#myPosts');
      if (!clientId) { box.appendChild(el('div', { class: 'empty', text: 'まだ募集を出していません。' })); return; }
      return sb.from('job_posts').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(100).then(function (r) {
        if (r.error) throw r.error;
        var rows = r.data || [];
        if (!rows.length) { box.appendChild(el('div', { class: 'empty', text: 'まだ募集を出していません。だれに頼めばいいか決まっていないときに使えます。' })); return; }
        return sb.rpc('job_post_counts', { p_posts: rows.map(function (p) { return p.id; }) }).then(function (c) {
          var n = {}; (c.data || []).forEach(function (x) { n[x.post_id] = x.proposals; });
          rows.forEach(function (p) {
            var card = EM.jobCard(p, byId, n[p.id] || 0);
            var st = p.status === 'open' && EM.dayDiff(EM.today(), p.closes_on) < 0 ? '締め切りました（30日以内なら選べます）' : POST_LABEL[p.status];
            card.insertBefore(el('span', { class: 'tag' + (p.status === 'open' ? ' tag--client' : ''), text: st }), card.firstChild);
            box.appendChild(card);
          });
        });
      });
    }

    function loadProps(creatorId) {
      var box = EM.$('#myProps');
      if (!creatorId) { box.appendChild(el('div', { class: 'empty', text: '提案を送るには、クリエイターのプロフィールを作ってください。' })); return; }
      return sb.from('job_proposals').select('id,status,amount,due_on,created_at,post_id,job_posts(id,title,closes_on,status)')
        .eq('creator_id', creatorId).order('created_at', { ascending: false }).limit(100).then(function (r) {
          if (r.error) throw r.error;
          var rows = r.data || [];
          if (!rows.length) { box.appendChild(el('div', { class: 'empty', text: 'まだ提案を送っていません。' })); return; }
          rows.forEach(function (p) {
            var jp = p.job_posts || {};
            box.appendChild(el('a', { class: 'card job-card', href: '/jobs/detail.html?id=' + encodeURIComponent(p.post_id) }, [
              el('div', { class: 'job-card__top' }, [
                el('span', { class: 'tag' + (p.status === 'chosen' ? ' tag--accent' : ''), text: PROP_LABEL[p.status] || p.status }),
                el('span', { class: 'small muted', text: '送った日 ' + EM.date(p.created_at) })
              ]),
              el('p', { class: 'pf-title job-card__title', text: jp.title || '（見られなくなった募集）' }),
              el('p', { class: 'small muted', text: [
                p.amount == null ? '金額 相談' : '金額 ' + Number(p.amount).toLocaleString('ja-JP') + '円',
                p.due_on ? '納期 ' + EM.mdw(p.due_on) : ''
              ].filter(Boolean).join(' / ') })
            ]));
          });
        });
    }
  });
})(window.EM);
