/* Eizo Maps — 問題報告（内容は公開しない） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var user = null, projects = [];

    EM.REPORT_CATEGORIES.forEach(function (c) {
      EM.$('#category').appendChild(el('option', { value: c[0], text: c[1] }));
    });

    var detail = EM.$('#detail');
    detail.addEventListener('input', function () {
      EM.$('#detailCount').textContent = detail.value.trim().length + ' 文字';
    });

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return sb.from('projects')
        .select('id,title,status,created_at,clients(display_name,company),creators(display_name)')
        .order('updated_at', { ascending: false }).limit(100);
    }).then(function (r) {
      if (!r) return;
      if (r.error) throw r.error;
      projects = r.data || [];
      var sel = EM.$('#projectId');
      projects.forEach(function (p) {
        sel.appendChild(el('option', { value: p.id, text: p.title + '（' + (EM.STATUS_LABEL[p.status] || p.status) + '）' }));
      });
      var pre = EM.param('project_id');
      if (pre && projects.some(function (p) { return p.id === pre; })) sel.value = pre;
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    EM.$('#reportForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var text = detail.value.trim();
      if (text.length < 20) { EM.notice(msg, '詳細は20文字以上でお願いします。', 'error'); return; }

      var ev = EM.$('#evidenceUrl').value.trim();
      if (ev && !EM.safeUrl(ev)) { EM.notice(msg, '証拠のURLは https:// から始まる URL を入力してください。', 'error'); return; }

      var pid = EM.$('#projectId').value || null;
      var btn = EM.$('#submitBtn');
      btn.setAttribute('aria-busy', 'true');

      // 案件を選んでいれば、その相手を報告対象として紐づける
      var target = pid
        ? sb.rpc('project_counterparty', { p_project_id: pid }).then(function (r) {
            return (r.data && r.data.reviewee_id) || null;
          }).catch(function () { return null; })
        : Promise.resolve(null);

      target.then(function (targetUserId) {
        return sb.from('reports').insert({
          reporter_id: user.id,
          target_user_id: targetUserId,
          project_id: pid,
          category: EM.$('#category').value,
          detail: text,
          evidence_url: ev || null
        });
      }).then(function (r) {
        btn.removeAttribute('aria-busy');
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.notice(msg, '');
        EM.$('#reportForm').hidden = true;
        EM.$('#doneView').hidden = false;
        window.scrollTo(0, 0);
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    });
  });
})(window.EM);
