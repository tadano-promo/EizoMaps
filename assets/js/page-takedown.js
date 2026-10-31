/* Eizo Maps — 作品の掲載についての申し立て（ログイン不要）
   10/31 タキさん決定：「メールの確認」を通した瞬間に作品を一時非公開にする。
     1. 申し立てを送る（この時点では作品はまだ止めない）
     2. 入力したメールアドレスに確認のリンクが届く（Eizo Maps のログイン用リンクを使う）
     3. リンクを開くと /auth/ 経由でこのページに戻り、confirm_takedown が作品を止める
   すでに同じメールアドレスでログインしている人は、1 の時点で受け付け・すぐ止まる。
   申立人のお名前・メールアドレス・アカウントは、作品を載せた人には伝わらない（運営だけが見る）。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el, msg = EM.$('#pageMsg');
    if (!sb) return;
    var form = EM.$('#tdForm');

    function show(id) {
      ['tdForm', 'workBox', 'tdSent', 'tdDone'].forEach(function (k) { var n = EM.$('#' + k); if (n) n.hidden = (k !== id); });
      window.scrollTo(0, 0);
    }

    /* ---------- 2. 確認メールのリンクから戻ってきたとき ---------- */
    var confirmId = String(EM.param('confirm') || '');
    if (confirmId) {
      form.hidden = true;
      if (!/^[0-9a-f-]{36}$/.test(confirmId)) { EM.notice(msg, 'リンクが正しくありません。届いたメールのリンクをもう一度開いてください。', 'error'); return; }
      EM.notice(msg, '確認しています…');
      sb.auth.getUser().then(function (r) {
        var u = r && r.data && r.data.user;
        if (!u) throw new Error('メールの確認ができていません。届いたメールのリンクをもう一度開いてください（リンクの期限が切れている場合は、お手数ですが申し立てをもう一度送ってください）。');
        return sb.rpc('confirm_takedown', { p_id: confirmId });
      }).then(function (r) {
        if (r.error) throw r.error;
        EM.notice(msg, '');
        var d = r.data || {};
        EM.$('#tdDoneTitle').textContent = d.already ? 'この申し立ては受け付け済みです。' : '確認できました。申し立てを受け付け、作品を一時非公開にしました。';
        show('tdDone');
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
      return;
    }

    /* ---------- 1. 申し立てを書く ---------- */
    var wid = String(EM.param('w') || '');
    if (!/^[0-9a-f-]{36}$/.test(wid)) {
      EM.notice(msg, '申し立てる作品が分かりません。作品のページにある「この作品の掲載について申し立てる」から開いてください。', 'error');
      form.hidden = true;
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

    // ログイン中なら、そのアカウントのメールアドレスを入れておく（そのまま送るとすぐ受け付け）
    sb.auth.getUser().then(function (r) {
      var u = r && r.data && r.data.user;
      if (!u || !u.email) return;
      var input = EM.$('#tdEmail');
      if (!input.value) input.value = u.email;
      EM.$('#tdEmailHint').textContent = 'ログイン中のアカウント（' + u.email + '）のアドレスのままなら、確認メールなしですぐ受け付けます。';
    });

    form.addEventListener('submit', function (e) {
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
        if (r.error) throw r.error;
        var d = r.data || {};
        if (d.verified) { EM.notice(msg, ''); show('tdDone'); return null; }
        // 確認メールを送る（戻り先は /auth/ → このページの確認画面）
        var next = '/takedown/?confirm=' + d.id;
        return sb.auth.signInWithOtp({
          email: v.email,
          options: { shouldCreateUser: true, emailRedirectTo: location.origin + '/auth/?next=' + encodeURIComponent(next) }
        }).then(function (o) {
          if (o.error) throw o.error;
          EM.notice(msg, '');
          EM.$('#tdSentTo').textContent = v.email;
          show('tdSent');
        });
      }).catch(function (err) {
        EM.notice(msg, EM.errorText(err), 'error');
      }).then(function () { btn.removeAttribute('aria-busy'); });
    });
  });
})(window.EM);
