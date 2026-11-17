/* Eizo Maps — 管理画面「お問い合わせ・改善案」（2026-11-17 翠くん） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var box = EM.$('#adminInquiries');
    if (!sb || !box) return;
    var msg = EM.$('#adminInqMsg');
    var KIND = { question: '質問', idea: '改善案', bug: '不具合', other: 'その他' };
    EM.requireUser().then(function (u) {
      if (!u) return;
      return EM.roles();
    }).then(function (roles) {
      if (!roles || !roles.admin) return;
      return load();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function load() {
      return sb.from('inquiries').select('id,user_id,kind,name,email,body,page,files,status,done_at,files_deleted_at,created_at')
        .order('created_at', { ascending: false }).limit(100).then(function (r) {
          if (r.error) throw r.error;
          render(r.data || []);
        });
    }
    function render(rows) {
      EM.clear(box);
      if (!rows.length) { box.appendChild(el('div', { class: 'empty', text: 'まだ届いていません。' })); return; }
      rows.forEach(function (q) {
        var files = el('div', { class: 'row' });
        (q.files || []).forEach(function (path, i) {
          var a = el('a', { class: 'btn btn--sm', href: '#', text: (/\.(mp4|mov|webm)$/i.test(path) ? '動画' : '画像') + (i + 1) + ' を開く' });
          a.addEventListener('click', function (e) {
            e.preventDefault();
            sb.storage.from('inquiry-files').createSignedUrl(path, 3600).then(function (r) {
              if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
              window.open(r.data.signedUrl, '_blank', 'noopener');
            });
          });
          files.appendChild(a);
        });
        var done = q.status === 'done';
        box.appendChild(el('div', { class: 'card stack' + (done ? ' muted' : '') }, [
          el('p', { class: 'small' }, [
            el('span', { class: 'tag' + (done ? '' : ' tag--accent'), text: KIND[q.kind] || q.kind }), ' ',
            el('span', { class: 'muted', text: EM.datetime(q.created_at) + '　' + (q.user_id ? '会員' : '会員ではない人') + (q.name ? '・' + q.name : '') + (q.email ? '・' + q.email : '') + (q.page ? '・来たページ ' + q.page : '') })
          ]),
          el('p', { class: 'sfb__comment', text: q.body }),
          (q.files || []).length ? files : null,
          (done && q.done_at && (q.files || []).length) ? el('p', { class: 'small muted', text: '画像・動画は ' + EM.datetime(new Date(new Date(q.done_at).getTime() + 30 * 86400000).toISOString()) + ' ごろに自動で消えます。' }) : null,
          q.files_deleted_at ? el('p', { class: 'small muted', text: '画像・動画は ' + EM.datetime(q.files_deleted_at) + ' に消しました（対応済みから30日）。' }) : null,
          el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn--sm', text: done ? '対応済み（戻す）' : '対応済みにする', onclick: function () {
            sb.from('inquiries').update({ status: done ? 'new' : 'done' }).eq('id', q.id).then(function (r) {
              if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
              load();
            });
          } }))
        ]));
      });
    }
  });
})(window.EM);
