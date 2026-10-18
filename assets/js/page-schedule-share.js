/* Eizo Maps — 共有されたスケジュール（見るだけ）
   中身はテーブルから直接取らない。open_schedule_share が唯一の入口。
   リンクが無い・止めた・期限切れ・パスワード違いは、すべて同じ「開けません」になる。
   開いた中身はメモリ上だけに置き、保存しない（共有端末での覗き見防止）。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    var KIND = {
      shoot: ['撮影', '#e8ff47'], edit: ['編集', '#7ad1ff'], meeting: ['打合せ', '#b79cff'],
      delivery: ['納品', '#4ade80'], hold: ['仮押さえ', '#ff9d5c'], other: ['その他', '#9aa0b5'], private: ['予定', '#5a6072']
    };
    var WD = ['日', '月', '火', '水', '木', '金', '土'];
    var token = String(EM.param('t') || '');

    function pad(n) { return String(n).padStart(2, '0'); }
    function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
    function fmtMin(m) { return Math.floor(m / 60) + ':' + pad(m % 60); }
    function timeToMin(t) { if (!t) return null; var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); }
    function dayLabel(s) { var d = parseYmd(s); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）'; }

    // 大枠がその日のどこを占めるか（日ごとの表示と同じ決まり）
    function spanText(e, day) {
      if (!e.start_time) return '終日';
      var s = e.starts_on === day ? timeToMin(e.start_time) : 0, t = 24 * 60;
      if (e.starts_on === day && e.end_time && e.ends_on === addDays(day, 1)) t = 24 * 60 + timeToMin(e.end_time);
      else if (e.ends_on === day && e.end_time) { t = timeToMin(e.end_time); if (t <= s) t += 24 * 60; }
      else if (e.ends_on === day && e.starts_on === day && !e.end_time) return fmtMin(s) + '〜';
      return fmtMin(s) + '〜' + fmtMin(t);
    }

    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      EM.notice(msg, 'このリンクは開けません。URL が正しいか、共有してくれた方に確認してください。', 'error');
      return;
    }
    EM.$('#lockBox').hidden = false;
    setTimeout(function () { EM.$('#password').focus(); }, 100);

    EM.$('#lockForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pw = EM.$('#password').value;
      if (!pw) { EM.notice(msg, 'パスワードを入れてください。', 'error'); return; }
      var btn = EM.$('#openBtn'); btn.setAttribute('aria-busy', 'true');
      sb.rpc('open_schedule_share', { p_token: token, p_password: pw }).then(function (r) {
        if (r.error) throw r.error;
        if (!r.data) {
          EM.notice(msg, '開けませんでした。パスワードが違うか、リンクの期限が切れている・止められている可能性があります。', 'error');
          return;
        }
        EM.notice(msg, '');
        EM.$('#password').value = '';
        EM.$('#lockBox').hidden = true;
        render(r.data);
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); })
        .then(function () { btn.removeAttribute('aria-busy'); });
    });

    function render(d) {
      EM.$('#contentBox').hidden = false;
      EM.$('#shProject').textContent = d.project || '共有されたスケジュール';
      EM.$('#shMeta').textContent = [d.label ? d.label + 'のリンク' : null, d.owner ? '作成：' + d.owner : null,
        d.expires_on ? (function (x) { var p = x.split('-'); return +p[1] + '/' + +p[2] + 'まで見られます'; })(d.expires_on) : null]
        .filter(Boolean).join(' ／ ');

      var box = EM.$('#shDays');
      EM.clear(box);
      var evs = d.events || [], its = d.items || [];
      if (!evs.length) { box.appendChild(el('p', { class: 'muted', text: 'まだ予定はありません。' })); return; }

      // 予定のある日を並べる（長い予定でも最大120日分）
      var days = [];
      evs.forEach(function (e) {
        for (var x = e.starts_on, n = 0; x <= e.ends_on && n < 120; x = addDays(x, 1), n++) {
          if (days.indexOf(x) === -1) days.push(x);
        }
      });
      its.forEach(function (i) { if (days.indexOf(i.day) === -1) days.push(i.day); });
      days.sort();

      days.forEach(function (day) {
        // 夜通しの撮影（翌朝まで）は前の日に 26:00 のように続けて見せているので、翌日には重ねて出さない
        var dayEvs = evs.filter(function (e) {
          if (!(e.starts_on <= day && e.ends_on >= day)) return false;
          if (e.start_time && e.end_time && day === e.ends_on && e.ends_on === addDays(e.starts_on, 1)) return false;
          return true;
        });
        if (!dayEvs.length) return;
        var sec = el('section', { class: 'card stack share-day' }, [el('h2', { class: 'share-day__date', text: dayLabel(day) })]);
        dayEvs.forEach(function (e) {
          var k = KIND[e.kind] || KIND.other;
          var blk = el('div', { class: 'share-ev', style: { '--bar': k[1] } }, [
            el('p', { class: 'share-ev__head' }, [
              el('span', { class: 'day-kind', text: k[0] }),
              el('strong', { text: e.title }),
              el('span', { class: 'mono share-ev__time', text: spanText(e, day) })
            ]),
            e.location ? el('p', { class: 'small', text: '場所：' + e.location }) : null,
            e.note ? el('p', { class: 'small muted share-ev__note', text: e.note }) : null
          ]);
          // 班ごとの小枠
          var mine = its.filter(function (i) { return i.event_id === e.id && i.day === day; });
          var lanes = [];
          mine.forEach(function (i) { if (lanes.indexOf(i.lane) === -1) lanes.push(i.lane); });
          lanes.forEach(function (ln) {
            var rows = mine.filter(function (i) { return i.lane === ln; }).sort(function (a, b) { return a.start_min - b.start_min; });
            blk.appendChild(el('div', { class: 'share-lane' }, [
              el('p', { class: 'share-lane__name', text: ln }),
              el('ul', { class: 'share-lane__list' }, rows.map(function (i) {
                return el('li', {}, [
                  el('span', { class: 'mono share-lane__time', text: fmtMin(i.start_min) + '〜' + fmtMin(i.end_min) }),
                  el('span', { text: i.title }),
                  i.note ? el('span', { class: 'small muted share-lane__note', text: '（' + i.note + '）' }) : null
                ]);
              }))
            ]));
          });
          sec.appendChild(blk);
        });
        box.appendChild(sec);
      });
    }
  });
})(window.EM);
