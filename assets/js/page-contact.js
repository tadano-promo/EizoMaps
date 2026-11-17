/* Eizo Maps — お問い合わせ・改善案（画像・動画を付けられる。2026-11-17 翠くん） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), msg = EM.$('#pageMsg');
    if (!sb) { EM.$('#inqForm').hidden = true; return; }
    var user = null, attach = null;
    var k = EM.param('kind');
    if (k && /^(idea|bug|question|other)$/.test(k)) EM.$('#inqKind').value = k;
    EM.getUser().then(function (u) {
      user = u;
      EM.$('#inqGuest').hidden = !!u;
      attach = EM.attachBox(u);
      EM.$('#inqAttach').appendChild(attach.node);
    });
    EM.$('#inqForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = EM.$('#inqBody').value.trim();
      if (body.length < 5) { EM.notice(msg, '内容を5文字以上で書いてください。', 'error'); return; }
      if (!user && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EM.$('#inqEmail').value.trim())) { EM.notice(msg, '返事を送るメールアドレスを入れてください。', 'error'); return; }
      var btn = EM.$('#inqSubmit'); btn.disabled = true;
      EM.notice(msg, attach && attach.count() ? 'ファイルを送っています…（動画は少し時間がかかります）' : '');
      (attach ? attach.upload() : Promise.resolve([])).then(function (paths) {
        return sb.rpc('send_inquiry', {
          p_kind: EM.$('#inqKind').value, p_name: user ? null : (EM.$('#inqName').value.trim() || null),
          p_email: user ? null : EM.$('#inqEmail').value.trim(), p_body: body,
          p_page: document.referrer && document.referrer.indexOf(location.origin) === 0 ? document.referrer.replace(location.origin, '') : null,
          p_files: paths
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        EM.notice(msg, '');
        EM.$('#inqForm').hidden = true; EM.$('#inqDone').hidden = false;
        EM.track('generate_lead', { lead_source: 'inquiry_' + EM.$('#inqKind').value });
      }).catch(function (err) { btn.disabled = false; EM.notice(msg, EM.errorText(err), 'error'); });
    });
  });
})(window.EM);
