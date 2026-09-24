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
  //   https://www.tiktok.com/@user/video/7123456789012345678
  //   https://www.tiktok.com/embed/v2/7123456789012345678
  //   ※ vm.tiktok.com / tiktok.com/t/ の短縮URLは、ブラウザからは
  //     転送先を辿れない（CORS）ため非対応。元の長いURLを入れてもらう。
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
    } else if (host === 'tiktok.com' || host === 'm.tiktok.com') {
      provider = 'tiktok';
      var mt = u.pathname.match(/\/video\/(\d{9,25})/)
            || u.pathname.match(/^\/embed(?:\/v2)?\/(\d{9,25})/)
            || u.pathname.match(/^\/v\/(\d{9,25})/);
      if (mt) id = mt[1];
    }

    if (!provider || !id || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) return null;

    var canonical;
    if (provider === 'youtube')      canonical = 'https://www.youtube.com/watch?v=' + id;
    else if (provider === 'vimeo')   canonical = 'https://vimeo.com/' + id;
    else                             canonical = (host === 'tiktok.com' && /\/video\//.test(u.pathname))
                                       ? 'https://www.tiktok.com' + u.pathname
                                       : 'https://www.tiktok.com/embed/v2/' + id;

    return {
      provider: provider,
      video_id: id,
      video_url: canonical,
      embed_url: EM.embedUrl(provider, id)
    };
  };

  // 縦長で表示すべき提供元
  EM.isVertical = function (provider) { return provider === 'tiktok'; };

  EM.embedUrl = function (provider, id) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(id || ''))) return null;
    if (provider === 'youtube') return 'https://www.youtube.com/embed/' + id;
    if (provider === 'vimeo')   return 'https://player.vimeo.com/video/' + id;
    if (provider === 'tiktok')  return 'https://www.tiktok.com/embed/v2/' + id;
    return null;
  };

  EM.PROVIDER_LABEL = { youtube: 'YouTube', vimeo: 'Vimeo', tiktok: 'TikTok' };

  // サムネイル。YouTube は URL 規則で即取得、Vimeo は oEmbed を叩く。
  EM.fetchThumbnail = function (v) {
    if (!v) return Promise.resolve(null);
    if (v.provider === 'youtube') {
      return Promise.resolve('https://img.youtube.com/vi/' + v.video_id + '/hqdefault.jpg');
    }
    // TikTok のサムネイルは配信ドメインが頻繁に変わるため取得しない
    // （CSP の img-src を広げたくないので、代わりに提供元バッジを出す）
    if (v.provider === 'tiktok') return Promise.resolve(null);
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
