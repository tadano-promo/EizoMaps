/* Eizo Maps — 退会の手続き（2026-11-15 翠くん決定：30日の猶予・評価は残す）
   ・退会の手続き中なら「元に戻す」画面
   ・まだなら説明 → データの保存（任意）→「退会する」と入れて退会 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb();
    var msg = EM.$('#pageMsg');
    if (!sb) return;
    var user = null;

    function dateText(iso) {
      var d = new Date(iso);
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
    function show(id) {
      ['#restoreBox', '#deleteBox', '#doneBox'].forEach(function (s) { EM.$(s).hidden = (s !== id); });
    }

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return sb.rpc('my_withdrawal').then(function (r) {
        if (r.error) throw r.error;
        if (r.data) {
          EM.$('#purgeDate').textContent = dateText(r.data.purge_after);
          show('#restoreBox');
        } else {
          show('#deleteBox');
        }
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    /* 元に戻す */
    EM.$('#restoreBtn').addEventListener('click', function () {
      var btn = this; btn.setAttribute('aria-busy', 'true');
      sb.rpc('restore_withdrawal').then(function (r) {
        btn.removeAttribute('aria-busy');
        if (r.error) throw r.error;
        EM.toast('元に戻しました');
        location.replace('/mypage/');
      }).catch(function (e) { btn.removeAttribute('aria-busy'); EM.notice(msg, EM.errorText(e), 'error'); });
    });
    EM.$('#signOutBtn').addEventListener('click', function () {
      sb.auth.signOut().then(function () { location.replace('/'); });
    });

    /* データを保存する（自分の分だけ。読み取りの決まりで他人の分は取れない） */
    EM.$('#exportBtn').addEventListener('click', function () {
      var btn = this; btn.setAttribute('aria-busy', 'true');
      var out = { exported_at: new Date().toISOString(), email: user.email };
      sb.from('creators').select('*').eq('user_id', user.id).then(function (r) {
        out.creator = r.data || [];
        var ids = (r.data || []).map(function (c) { return c.id; });
        return Promise.all([
          ids.length ? sb.from('portfolios').select('title,description,provider,video_url,visibility,role,client_name,work_year,created_at').in('creator_id', ids) : { data: [] },
          sb.from('schedule_events').select('kind,title,note,location,starts_on,ends_on,start_time,end_time').eq('owner_user_id', user.id),
          sb.from('message_templates').select('*').eq('owner_user_id', user.id),
          sb.from('clients').select('display_name,company,area_pref').eq('user_id', user.id)
        ]);
      }).then(function (a) {
        out.works = a[0].data || [];
        out.schedule = a[1].data || [];
        out.templates = a[2].data || [];
        out.client = a[3].data || [];
        var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url; link.download = 'eizo-maps-data.json';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        btn.removeAttribute('aria-busy');
        EM.toast('保存しました');
      }).catch(function (e) { btn.removeAttribute('aria-busy'); EM.notice(msg, EM.errorText(e), 'error'); });
    });

    /* 退会する */
    var confirmInput = EM.$('#confirmText');
    confirmInput.addEventListener('input', function () {
      EM.$('#deleteBtn').disabled = confirmInput.value.trim() !== '退会する';
    });
    EM.$('#deleteForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (confirmInput.value.trim() !== '退会する') return;
      var btn = EM.$('#deleteBtn'); btn.setAttribute('aria-busy', 'true');
      // Google カレンダーとのつながりを先に外す（つないでいない人はそのまま進む）
      sb.functions.invoke('google-calendar', { body: { action: 'disconnect' } }).catch(function () {})
        .then(function () {
          return sb.rpc('request_withdrawal', { p_confirm: '退会する', p_keep_reviews: false });
        }).then(function (r) {
          if (r.error) throw r.error;
          EM.$('#doneDate').textContent = dateText(r.data.purge_after);
          show('#doneBox');
          return sb.auth.signOut();
        }).catch(function (err) {
          btn.removeAttribute('aria-busy');
          EM.notice(msg, EM.errorText(err), 'error');
        });
    });
  });
})(window.EM);
