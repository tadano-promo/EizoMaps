/* Eizo Maps — クリエイターをおすすめする（ログインした人だけ） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;
    var picked = [];
    EM.requireUser().then(function (u) {
      if (!u) return;
      return EM.jobs.load().then(function (list) {
        EM.jobs.picker(EM.$('#recGenres'), list, picked, { max: 8 });
      });
    });
    var urls = EM.$('#recUrls');
    function addUrl() {
      if (urls.children.length >= 5) return;
      urls.appendChild(el('div', { class: 'url-row' }, [el('input', { type: 'url', maxlength: 300, placeholder: 'https://', 'aria-label': 'URL' })]));
    }
    addUrl();
    var more = el('button', { class: 'btn btn--sm', type: 'button', text: '＋ URL を足す' });
    more.addEventListener('click', function () { addUrl(); if (urls.children.length >= 5) more.hidden = true; });
    urls.after(more);

    EM.$('#recForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = EM.$('#recName').value.trim();
      var list = EM.$$('#recUrls input').map(function (i) { return i.value.trim(); }).filter(Boolean);
      if (!name) { EM.notice(msg, '活動名を入れてください。', 'error'); return; }
      if (!list.length) { EM.notice(msg, '公開されている SNS か作品のページの URL を1つ以上入れてください。', 'error'); return; }
      if (!EM.$('#recOk').checked) { EM.notice(msg, '確認のチェックを入れてください。', 'error'); return; }
      var btn = EM.$('#recSubmit'); btn.disabled = true;
      sb.rpc('recommend_creator', { p_name: name, p_genre_ids: picked, p_links: list, p_comment: EM.$('#recComment').value })
        .then(function (r) {
          if (r.error) throw r.error;
          location.href = '/creators/rec.html?id=' + encodeURIComponent(r.data);
        }).catch(function (err) { btn.disabled = false; EM.notice(msg, EM.errorText(err), 'error'); });
    });
  });
})(window.EM);
