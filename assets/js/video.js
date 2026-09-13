/* =====================================================================
   Eizo Maps — 動画URLの解析とサムネイル取得
   動画ファイル自体は保存しない。YouTube / Vimeo の URL 参照のみ。
   ===================================================================== */
(function (EM) {
  'use strict';

  // 対応する形式:
  //   https://www.youtube.com/watch?v=XXXXXXXXXXX
  //   https://youtu.be/XXXXXXXXXXX
  //   https://www.youtube.com/shorts/XXXXXXXXXXX
  //   https://www.youtube.com/embed/XXXXXXXXXXX
  //   https://vimeo.com/123456789
  //   https://player.vimeo.com/video/123456789
  EM.parseVideoUrl = function (input) {
    var raw = String(input || '').trim();
    if (!raw) return null;
    var u;
    try { u = new URL(raw); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;

    var host = u.hostname.replace(/^www\./, '');
    var id = null, provider = null;

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      provider = 'youtube';
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        var m = u.pathname.match(/^\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{5,20})/);
        if (m) id = m[1];
      }
    } else if (host === 'youtu.be') {
      provider = 'youtube';
      id = u.pathname.slice(1).split('/')[0];
    } else if (host === 'vimeo.com') {
      provider = 'vimeo';
      var mv = u.pathname.match(/^\/(\d{6,12})/);
      if (mv) id = mv[1];
    } else if (host === 'player.vimeo.com') {
      provider = 'vimeo';
      var mp = u.pathname.match(/^\/video\/(\d{6,12})/);
      if (mp) id = mp[1];
    }

    if (!provider || !id || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) return null;

    return {
      provider: provider,
      video_id: id,
      video_url: provider === 'youtube'
        ? 'https://www.youtube.com/watch?v=' + id
        : 'https://vimeo.com/' + id,
      embed_url: provider === 'youtube'
        ? 'https://www.youtube.com/embed/' + id
        : 'https://player.vimeo.com/video/' + id
    };
  };

  EM.embedUrl = function (provider, id) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(id || ''))) return null;
    if (provider === 'youtube') return 'https://www.youtube.com/embed/' + id;
    if (provider === 'vimeo')   return 'https://player.vimeo.com/video/' + id;
    return null;
  };

  // サムネイル。YouTube は URL 規則で即取得、Vimeo は oEmbed を叩く。
  EM.fetchThumbnail = function (v) {
    if (!v) return Promise.resolve(null);
    if (v.provider === 'youtube') {
      return Promise.resolve('https://img.youtube.com/vi/' + v.video_id + '/hqdefault.jpg');
    }
    return fetch('https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/' + v.video_id))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && EM.safeUrl(j.thumbnail_url)) || null; })
      .catch(function () { return null; });
  };

  // maxres が無い動画では画像が壊れるため、読み込み失敗時に hqdefault へ落とす
  EM.thumbImg = function (url, alt) {
    var safe = EM.safeUrl(url);
    var img = EM.el('img', {
      src: safe || '', alt: alt || '', loading: 'lazy', referrerpolicy: 'no-referrer'
    });
    img.addEventListener('error', function () {
      if (img.src.indexOf('maxresdefault') !== -1) img.src = img.src.replace('maxresdefault', 'hqdefault');
      else img.style.display = 'none';
    });
    return img;
  };
})(window.EM);
