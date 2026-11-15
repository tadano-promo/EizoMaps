/* Eizo Maps — 募集を出す（2026-11-15 翠くん）
   はじめての人は「依頼元の情報（clients）」も一緒に作る。クリエイターだけの人が出したら「両方」にする */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;
    var user = null, client = null, selected = [];
    // ?id=… なら「出した募集を直す」（募集中のあいだだけ）
    var editId = /^[0-9a-f-]{36}$/i.test(String(EM.param('id') || '')) ? EM.param('id') : null, editing = null;

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
        EM.jobs.load().catch(function () { return []; }),
        editId ? sb.from('job_posts').select('*').eq('id', editId).maybeSingle() : Promise.resolve({ data: null })
      ]);
    }).then(function (r) {
      if (!r) return;
      client = r[0].data || null;
      EM.$('#clientBox').hidden = !!client;
      if (client && client.area_pref) EM.$('#area').value = client.area_pref;
      // 「予算の目安」から来たときは、選んだ内容を入れておく
      if (!editId && EM.param('title')) {
        EM.$('#title').value = String(EM.param('title')).slice(0, 100);
        EM.$('#description').value = String(EM.param('desc') || '').slice(0, 4000);
        if (EM.param('kind')) EM.$('#kind').value = EM.param('kind');
        var bv = Number(EM.param('budget')), best = null;
        EM.BUDGETS.forEach(function (b) { if (b.v !== null && b.v <= bv) best = b.v; });
        if (best !== null) EM.$('#budget').value = String(best);
      }
      if (editId) {
        editing = r[2].data;
        if (!editing || !client || editing.client_id !== client.id || editing.status !== 'open') {
          EM.notice(msg, 'この募集は直せません（募集中の、自分の募集だけ直せます）。', 'error');
          EM.$('#postForm').hidden = true;
          return;
        }
        document.title = '募集を直す — Eizo Maps';
        EM.$('h1').textContent = '募集を直す';
        EM.$('#submitBtn').textContent = 'この内容に直す';
        EM.notice(msg, '直した内容は、すでに提案してくれた人にもそのまま見えます。金額や納期を大きく変えるときは、提案した人にメッセージで伝えるのがおすすめです。');
        EM.$('#title').value = editing.title;
        EM.$('#description').value = editing.description;
        EM.$('#kind').value = editing.kind || '';
        EM.$('#budget').value = editing.budget_amount == null ? '' : String(editing.budget_amount);
        EM.$('#area').value = editing.area_pref || '';
        EM.$('#remoteOk').checked = !!editing.remote_ok;
        EM.$('#dueOn').value = editing.due_on || '';
        closes.min = editing.closes_on < t ? editing.closes_on : t;
        closes.value = editing.closes_on;
        (editing.genre_ids || []).forEach(function (g) { selected.push(g); });
      }
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
        var row = {
          title: title, description: desc,
          kind: EM.$('#kind').value || null, genre_ids: selected.slice(0, 5),
          area_pref: EM.$('#area').value || null, remote_ok: EM.$('#remoteOk').checked,
          budget_amount: b === '' ? null : Number(b), due_on: due, closes_on: closes.value
        };
        if (editing) return sb.from('job_posts').update(row).eq('id', editing.id).select('id').single();
        return sb.from('job_posts').insert(Object.assign({ client_id: client.id }, row)).select('id').single();
      }).then(function (r) {
        if (r.error) throw r.error;
        if (!editing) EM.track('generate_lead', { method: 'job_post' });
        location.href = '/jobs/detail.html?id=' + encodeURIComponent(r.data.id) + (editing ? '&edited=1' : '&posted=1');
      }).catch(function (err) {
        btn.disabled = false;
        bad(EM.errorText(err));
      });
    });

    function bad(text) { EM.notice(msg, text, 'error'); msg.scrollIntoView({ block: 'center' }); return false; }
  });
})(window.EM);
