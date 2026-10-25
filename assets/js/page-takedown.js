/* Eizo Maps — 作品の掲載についての申し立て（ログイン不要）
   送ると、その作品はすぐ一時非公開になる（サーバー側の submit_takedown が行う）。
   申立人のお名前・メールアドレスは、作品を載せた人には伝わらない。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el, msg = EM.$('#pageMsg');
    if (!sb) return;
    var wid = String(EM.param('w') || '');
    if (!/^[0-9a-f-]{36}$/.test(wid)) {
      EM.notice(msg, '申し立てる作品が分かりません。作品のページにある「この作品の掲載について申し立てる」から開いてください。', 'error');
      EM.$('#tdForm').hidden = true;
      return;
    }

    // 作品の名前を見せる（すでに非公開なら名前は出せないが、申し立ては受け付ける）
    sb.from('portfolios').select('id,title,creator_id,creators(display_name)').eq('id', wid).maybeSingle().then(function (r) {
      var box = EM.$('#workBox');
      if (r.data) {
        box.appendChild(el('p', { class: 'small muted', text: '申し立てる作品' }));
        box.appendChild(el('p', null, el('strong', { text: r.data.title })));
        if (r.data.creators && r.data.creators.display_name) box.appendChild(el('p', { class: 'small muted', text: '載せた人：' + r.data.creators.display_name }));
        box.hidden = false;
      }
    });

    EM.$('#tdForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = {
        name: EM.$('#tdName').value.trim(), org: EM.$('#tdOrg').value.trim(), email: EM.$('#tdEmail').value.trim(),
        relation: EM.$('#tdRelation').value, reason: EM.$('#tdReason').value, detail: EM.$('#tdDetail').value.trim(),
        agree: EM.$('#tdAgree').checked
      };
      if (!v.name) return EM.notice(msg, 'お名前を入力してください。', 'error');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return EM.notice(msg, 'メールアドレスを正しく入力してください。', 'error');
      if (!v.relation) return EM.notice(msg, '作品とのご関係を選んでください。', 'error');
      if (!v.reason) return EM.notice(msg, '理由を選んでください。', 'error');
      if (v.detail.length < 10) return EM.notice(msg, 'くわしい内容を10文字以上で書いてください。', 'error');
      if (!v.agree) return EM.notice(msg, '内容が事実であることの確認にチェックを入れてください。', 'error');
      var btn = EM.$('#tdSubmit'); btn.setAttribute('aria-busy', 'true');
      sb.rpc('submit_takedown', {
        p_portfolio_id: wid, p_name: v.name, p_org: v.org, p_email: v.email,
        p_relation: v.relation, p_reason: v.reason, p_detail: v.detail, p_agree: true
      }).then(function (r) {
        btn.removeAttribute('aria-busy');
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.notice(msg, '');
        EM.$('#tdForm').hidden = true; EM.$('#workBox').hidden = true; EM.$('#tdDone').hidden = false;
        window.scrollTo(0, 0);
      });
    });
  });
})(window.EM);
