/* EizoMaps — サインアップ / ログイン */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb();
    var msg = EM.$('#authMsg');
    var form = EM.$('#authForm');
    var mode = 'login';

    var tabLogin = EM.$('#tabLogin'), tabSignup = EM.$('#tabSignup');
    var submitBtn = EM.$('#submitBtn'), typeField = EM.$('#typeField');
    var agreeWrap = EM.$('#agreeWrap'), agree = EM.$('#agree');
    var pw = EM.$('#password'), pwHint = EM.$('#pwHint');

    function nextUrl() {
      var n = EM.param('next');
      // オープンリダイレクト対策: 自サイト内の絶対パスのみ許可
      return (n && /^\/[^/\\]/.test(n)) ? n : '/mypage/';
    }

    function setMode(m) {
      mode = m;
      var signup = m === 'signup';
      tabLogin.setAttribute('aria-pressed', signup ? 'false' : 'true');
      tabSignup.setAttribute('aria-pressed', signup ? 'true' : 'false');
      EM.$('#authTitle').textContent = signup ? '新規登録' : 'ログイン';
      submitBtn.textContent = signup ? '登録する' : 'ログイン';
      typeField.hidden = !signup;
      agreeWrap.hidden = !signup;
      pw.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
      pwHint.textContent = signup ? '8文字以上で設定してください。' : '';
      EM.notice(msg, '');
    }
    tabLogin.addEventListener('click', function () { setMode('login'); });
    tabSignup.addEventListener('click', function () { setMode('signup'); });
    if (EM.param('mode') === 'signup') setMode('signup');

    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    // すでにログイン済みなら飛ばす。初回ログイン時は利用種別を反映する。
    sb.auth.getUser().then(function (r) {
      var u = r && r.data && r.data.user;
      if (!u) return;
      return applyOnboarding(u).then(function () { location.replace(nextUrl()); });
    });

    function applyOnboarding(u) {
      var t = (u.user_metadata && u.user_metadata.account_type) || null;
      if (!t) return Promise.resolve();
      return sb.from('users').select('onboarded').eq('id', u.id).maybeSingle().then(function (r) {
        if (r.error || !r.data || r.data.onboarded) return null;
        return sb.from('users').update({ account_type: t, onboarded: true }).eq('id', u.id);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = EM.$('#email').value.trim();
      var password = pw.value;
      if (!email || !password) { EM.notice(msg, 'メールアドレスとパスワードを入力してください。', 'error'); return; }
      if (mode === 'signup' && password.length < 8) { EM.notice(msg, 'パスワードは8文字以上にしてください。', 'error'); return; }
      if (mode === 'signup' && !agree.checked) { EM.notice(msg, '利用規約とプライバシーポリシーへの同意が必要です。', 'error'); return; }

      submitBtn.setAttribute('aria-busy', 'true');
      EM.notice(msg, '');

      var p = mode === 'signup'
        ? sb.auth.signUp({
            email: email, password: password,
            options: {
              emailRedirectTo: location.origin + '/auth/',
              data: { account_type: EM.$('#accountType').value }
            }
          })
        : sb.auth.signInWithPassword({ email: email, password: password });

      p.then(function (r) {
        submitBtn.removeAttribute('aria-busy');
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        if (mode === 'signup' && r.data && r.data.session === null) {
          EM.notice(msg, '確認メールを送りました。メール内のリンクを開くと登録が完了します。', 'ok');
          form.reset();
          return;
        }
        var u = r.data && r.data.user;
        (u ? applyOnboarding(u) : Promise.resolve()).then(function () { location.replace(nextUrl()); });
      }).catch(function (err) {
        submitBtn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    });

    EM.$('#googleBtn').addEventListener('click', function () {
      EM.notice(msg, '');
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + '/auth/?next=' + encodeURIComponent(nextUrl()) }
      }).then(function (r) { if (r.error) EM.notice(msg, EM.errorText(r.error), 'error'); });
    });

    EM.$('#resetBtn').addEventListener('click', function () {
      var email = EM.$('#email').value.trim();
      if (!email) { EM.notice(msg, '再設定メールの送り先となるメールアドレスを入力してください。', 'error'); return; }
      sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/auth/' }).then(function (r) {
        if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
        else EM.notice(msg, '再設定メールを送りました。メールをご確認ください。', 'ok');
      });
    });
  });
})(window.EM);
