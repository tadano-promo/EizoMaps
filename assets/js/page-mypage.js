/* Eizo Maps — マイページ（プロフィール編集） */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var user = null, creator = null, genres = [], selected = [];

    EM.PREFS.forEach(function (p) { EM.$('#areaPref').appendChild(el('option', { value: p, text: p })); });

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return Promise.all([
        sb.from('genres').select('id,name_ja,sort_order').order('sort_order'),
        sb.from('creators').select('*,creator_genres(genre_id)').eq('user_id', u.id).maybeSingle(),
        sb.from('users').select('account_type').eq('id', u.id).maybeSingle()
      ]);
    }).then(function (res) {
      if (!res) return;
      genres = res[0].data || [];
      creator = res[1].data || null;
      if (res[2].data) EM.$('#accountType').value = res[2].data.account_type;

      if (creator) {
        EM.$('#displayName').value   = creator.display_name || '';
        EM.$('#headline').value      = creator.headline || '';
        EM.$('#bio').value           = creator.bio || '';
        EM.$('#areaPref').value      = creator.area_pref || '';
        EM.$('#areaCity').value      = creator.area_city || '';
        EM.$('#years').value         = creator.years_of_experience != null ? creator.years_of_experience : '';
        EM.$('#responseHours').value = creator.response_time_hours != null ? creator.response_time_hours : '';
        EM.$('#websiteUrl').value    = creator.website_url || '';
        EM.$('#isPublished').checked = !!creator.is_published;
        selected = (creator.creator_genres || []).map(function (x) { return x.genre_id; });
        var link = EM.$('#viewPublicLink');
        link.href = '/creators/detail.html?id=' + encodeURIComponent(creator.id);
        link.hidden = !creator.is_published;
      } else {
        EM.notice(msg, 'プロフィールがまだありません。表示名を入れて保存すると作成されます。');
      }
      renderAvatar();
      renderGenres();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function renderAvatar() {
      var box = EM.$('#avatarPreview');
      EM.clear(box);
      box.appendChild(EM.avatar(creator && creator.avatar_url, EM.$('#displayName').value || 'E', true));
    }

    function renderGenres() {
      var box = EM.$('#genreChips');
      EM.clear(box);
      genres.forEach(function (g) {
        var on = selected.indexOf(g.id) !== -1;
        var b = el('button', {
          class: 'chip', type: 'button', 'aria-pressed': on ? 'true' : 'false', text: g.name_ja,
          onclick: function () {
            var i = selected.indexOf(g.id);
            if (i !== -1) { selected.splice(i, 1); }
            else {
              if (selected.length >= 6) { EM.toast('職種は最大6件までです'); return; }
              selected.push(g.id);
            }
            b.setAttribute('aria-pressed', selected.indexOf(g.id) !== -1 ? 'true' : 'false');
          }
        });
        box.appendChild(b);
      });
    }

    /* ---- アバター画像のアップロード ---- */
    EM.$('#avatarFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(f.type) === -1) { EM.toast('JPEG / PNG / WebP のみ対応しています'); return; }
      if (f.size > 2 * 1024 * 1024) { EM.toast('2MB 以下の画像を選んでください'); return; }
      var ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
      var path = user.id + '/avatar.' + ext;
      EM.notice(msg, 'アップロード中です…');
      sb.storage.from('avatars').upload(path, f, { upsert: true, contentType: f.type })
        .then(function (r) {
          if (r.error) throw r.error;
          var pub = sb.storage.from('avatars').getPublicUrl(path);
          var url = pub.data.publicUrl + '?v=' + Date.now();
          if (!creator) { creator = { avatar_url: url }; EM.notice(msg, '画像を読み込みました。「保存する」を押すと反映されます。', 'ok'); }
          else { creator.avatar_url = url; EM.notice(msg, '画像を読み込みました。「保存する」を押すと反映されます。', 'ok'); }
          renderAvatar();
        })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    });

    /* ---- 保存 ---- */
    EM.$('#profileForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = EM.$('#displayName').value.trim();
      if (!name) { EM.notice(msg, '表示名を入力してください。', 'error'); return; }

      var site = EM.$('#websiteUrl').value.trim();
      if (site && !EM.safeUrl(site)) { EM.notice(msg, 'ウェブサイトは https:// から始まる URL を入力してください。', 'error'); return; }

      var payload = {
        display_name: name,
        headline: EM.$('#headline').value.trim() || null,
        bio: EM.$('#bio').value.trim() || null,
        area_pref: EM.$('#areaPref').value || null,
        area_city: EM.$('#areaCity').value.trim() || null,
        years_of_experience: EM.$('#years').value === '' ? null : Number(EM.$('#years').value),
        response_time_hours: EM.$('#responseHours').value === '' ? null : Number(EM.$('#responseHours').value),
        website_url: site || null,
        avatar_url: (creator && creator.avatar_url) || null,
        is_published: EM.$('#isPublished').checked
      };

      var btn = EM.$('#saveBtn');
      btn.setAttribute('aria-busy', 'true');
      EM.notice(msg, '保存しています…');

      var p = (creator && creator.id)
        ? sb.from('creators').update(payload).eq('id', creator.id).select('*').single()
        : sb.from('creators').insert(Object.assign({ user_id: user.id }, payload)).select('*').single();

      p.then(function (r) {
        if (r.error) throw r.error;
        creator = Object.assign({}, r.data);
        return syncGenres(creator.id);
      }).then(function () {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, '保存しました。', 'ok');
        var link = EM.$('#viewPublicLink');
        link.href = '/creators/detail.html?id=' + encodeURIComponent(creator.id);
        link.hidden = !creator.is_published;
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    });

    function syncGenres(creatorId) {
      return sb.from('creator_genres').delete().eq('creator_id', creatorId).then(function () {
        if (!selected.length) return null;
        return sb.from('creator_genres').insert(selected.map(function (g) {
          return { creator_id: creatorId, genre_id: g };
        }));
      });
    }

    EM.$('#saveAccountBtn').addEventListener('click', function () {
      sb.from('users').update({ account_type: EM.$('#accountType').value, onboarded: true })
        .eq('id', user.id).then(function (r) {
          if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
          else EM.toast('利用種別を保存しました');
        });
    });

    EM.$('#logoutBtn').addEventListener('click', function () { EM.signOut(); });
  });
})(window.EM);
