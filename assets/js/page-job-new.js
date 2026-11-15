/* Eizo Maps — 募集を出す（2026-11-15 翠くん）
   はじめての人は「依頼元の情報（clients）」も一緒に作る。クリエイターだけの人が出したら「両方」にする */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;
    var user = null, client = null, selected = [];

    EM.PROJECT_KINDS.forEach(function (k) { EM.$('#kind').appendChild(el('option', { value: k, text: k })); });
    EM.BUDGETS.forEach(function (b, i) { EM.$('#budget').appendChild(el('option', { value: b.v === null ? '' : String(b.v), text: b.l, selected: i === 0 })); });
    EM.PREFS.forEach(function (p) { EM.$('#area').appendChild(el('option', { value: p, text: p })); });
    var t = EM.today();
    var closes = EM.$('#closesOn');
    closes.min = t; closes.max = EM.addDays(t, 60); closes.value = EM.addDays(t, 14);
    EM.$('#dueOn').min = t;

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return Promise.all([
        sb.from('clients').select('id,display_name,company,area_pref').eq('user_id', u.id).maybeSingle(),
        EM.jobs.load().catch(function () { return []; })
      ]);
    }).then(function (r) {
      if (!r) return;
      client = r[0].data || null;
      EM.$('#clientBox').hidden = !!client;
      if (client && client.area_pref) EM.$('#area').value = client.area_pref;
      EM.jobs.picker(EM.$('#genrePick'), r[1] || [], selected, { max: 5, compact: true });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    EM.$('#postForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = EM.$('#title').value.trim(), desc = EM.$('#description').value.trim();
      if (!client && !EM.$('#clName').value.trim()) return bad('お名前を入れてください。');
      if (!title) return bad('募集のタイトルを入れてください。');
      if (desc.length < 10) return bad('内容は10文字以上で書いてください。どんな動画か・どこで使うかがあると、提案が集まりやすくなります。');
      if (!closes.value) return bad('募集の締め切りを選んでください。');
      var due = EM.$('#dueOn').value || null;
      if (due && due < closes.value) return bad('希望納期は、締め切りより後の日にしてください。');
      var btn = EM.$('#submitBtn'); btn.disabled = true;

      var ensureClient = client ? Promise.resolve(client) :
        sb.from('clients').insert({ user_id: user.id, display_name: EM.$('#clName').value.trim(), company: EM.$('#clCompany').value.trim() || null, area_pref: EM.$('#area').value || null })
          .select('id').single().then(function (r) { if (r.error) throw r.error; client = r.data; EM.track('sign_up', { method: 'client_profile' }); return client; });

      ensureClient.then(function () {
        // クリエイターだけで登録している人が募集を出したら「両方」にする（依頼したときと同じ）
        return EM.myAccountType().then(function (tp) {
          if (tp === 'creator') return sb.from('users').update({ account_type: 'both' }).eq('id', user.id).then(function () { EM.setViewMode('client'); });
        });
      }).then(function () {
        var b = EM.$('#budget').value;
        return sb.from('job_posts').insert({
          client_id: client.id, title: title, description: desc,
          kind: EM.$('#kind').value || null, genre_ids: selected.slice(0, 5),
          area_pref: EM.$('#area').value || null, remote_ok: EM.$('#remoteOk').checked,
          budget_amount: b === '' ? null : Number(b), due_on: due, closes_on: closes.value
        }).select('id').single();
      }).then(function (r) {
        if (r.error) throw r.error;
        EM.track('generate_lead', { method: 'job_post' });
        location.href = '/jobs/detail.html?id=' + encodeURIComponent(r.data.id) + '&posted=1';
      }).catch(function (err) {
        btn.disabled = false;
        bad(EM.errorText(err));
      });
    });

    function bad(text) { EM.notice(msg, text, 'error'); msg.scrollIntoView({ block: 'center' }); return false; }
  });
})(window.EM);
