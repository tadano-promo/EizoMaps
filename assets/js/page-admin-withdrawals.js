/* Eizo Maps — 管理画面「退会の手続き」（2026-11-15 翠くん）
   見るだけ。中身を消すのは毎日の予約実行（account 関数）がやる */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var box = EM.$('#adminWithdrawals');
    if (!sb || !box) return;
    var msg = EM.$('#adminWithdrawMsg');
    EM.requireUser().then(function (u) {
      if (!u) return;
      return EM.roles();
    }).then(function (roles) {
      if (!roles || !roles.admin) return;
      return sb.rpc('admin_withdrawals').then(function (r) {
        if (r.error) throw r.error;
        render(r.data || []);
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function state(w) {
      if (w.purged_at) return ['消しました', EM.date(w.purged_at)];
      if (w.restored_at) return ['元に戻しました', EM.date(w.restored_at)];
      var n = EM.dayDiff(EM.today(), String(w.purge_after).slice(0, 10));
      return ['手続き中', n <= 0 ? '今日の夜に消えます' : 'あと' + n + '日で消えます'];
    }
    function render(rows) {
      EM.clear(box);
      if (!rows.length) { box.appendChild(el('div', { class: 'empty', text: '退会の申し込みはありません。' })); return; }
      var open = rows.filter(function (w) { return !w.purged_at && !w.restored_at; }).length;
      box.appendChild(el('p', { class: 'small', text: '手続き中 ' + open + '件 ／ ぜんぶで ' + rows.length + '件' }));
      rows.forEach(function (w) {
        var st = state(w);
        box.appendChild(el('div', { class: 'card share-row' }, [
          el('div', null, [
            el('p', { class: 'pf-title', text: w.name || '（名前なし）' }),
            el('p', { class: 'small muted', text: '申し込み ' + EM.datetime(w.requested_at) + (w.relinked_at ? '　／　また登録して評価をつないだ ' + EM.date(w.relinked_at) : '') })
          ]),
          el('div', { class: 'row' }, [
            el('span', { class: 'tag' + (st[0] === '手続き中' ? ' tag--accent' : ''), text: st[0] }),
            el('span', { class: 'small muted', text: st[1] })
          ])
        ]));
      });
    }
  });
})(window.EM);
