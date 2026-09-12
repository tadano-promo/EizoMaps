/* EizoMaps — 評価投稿 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var projectId = EM.param('id');
    var user = null, project = null, cp = null;

    if (!/^[0-9a-f-]{36}$/i.test(String(projectId || ''))) {
      EM.notice(msg, '案件が指定されていません。', 'error');
      return;
    }
    EM.$('#backLink').href = '/projects/?id=' + encodeURIComponent(projectId);

    var score = EM.$('#score'), scoreOut = EM.$('#scoreOut'), starsOut = EM.$('#starsOut');
    function syncScore() {
      var v = Number(score.value).toFixed(1);
      scoreOut.textContent = v;
      starsOut.textContent = EM.stars(v);
    }
    score.addEventListener('input', syncScore);
    syncScore();

    var comment = EM.$('#comment');
    comment.addEventListener('input', function () {
      EM.$('#commentCount').textContent = comment.value.trim().length + ' 文字';
    });

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return Promise.all([
        sb.from('projects').select('id,title,status,delivered_at,clients(display_name,company),creators(display_name)')
          .eq('id', projectId).maybeSingle(),
        sb.rpc('project_counterparty', { p_project_id: projectId }),
        sb.from('reviews').select('id,status').eq('project_id', projectId).eq('reviewer_id', u.id).maybeSingle()
      ]);
    }).then(function (res) {
      if (!res) return;
      project = res[0].data;
      cp = res[1].data;

      if (!project) { EM.notice(msg, 'この案件は見つかりませんでした。', 'error'); return; }
      if (!cp || !cp.reviewee_id) { EM.notice(msg, 'この案件の当事者ではないため、評価できません。', 'error'); return; }
      if (!EM.canReview(project.status)) {
        EM.notice(msg, '評価できるのは納品済み以降の案件のみです。現在のステータス：' + (EM.STATUS_LABEL[project.status] || project.status), 'error');
        return;
      }
      if (res[2].data) {
        EM.notice(msg, 'この案件にはすでに評価を投稿済みです。' +
          (res[2].data.status === 'published' ? '公開されています。' : '運営の確認待ちです。'), 'ok');
        return;
      }

      var who = cp.my_role === 'creator'
        ? (project.clients && (project.clients.company || project.clients.display_name)) || '依頼元'
        : (project.creators && project.creators.display_name) || '依頼先';

      var card = EM.$('#projectCard');
      card.hidden = false;
      card.appendChild(el('p', { class: 'small muted', text: '評価する案件' }));
      card.appendChild(el('p', { class: 'pf-title', text: project.title }));
      card.appendChild(el('p', { class: 'small muted', text: '評価する相手：' + who + '（' + (cp.my_role === 'creator' ? 'クライアント' : 'クリエイター') + '）' }));
      EM.$('#reviewForm').hidden = false;
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    EM.$('#reviewForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var text = comment.value.trim();
      if (text.length < 20) { EM.notice(msg, 'コメントは20文字以上でお願いします。', 'error'); return; }

      var btn = EM.$('#submitBtn');
      btn.setAttribute('aria-busy', 'true');

      sb.from('reviews').insert({
        project_id: projectId,
        reviewer_id: user.id,
        reviewee_id: cp.reviewee_id,
        reviewer_role: cp.my_role,
        score: Number(Number(score.value).toFixed(1)),
        comment: text
      }).then(function (r) {
        btn.removeAttribute('aria-busy');
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.$('#reviewForm').hidden = true;
        EM.notice(msg, '評価を投稿しました。運営が内容を確認したあとに公開されます。', 'ok');
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    });
  });
})(window.EM);
