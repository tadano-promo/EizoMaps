/* =====================================================================
   Eizo Maps — 動画URLの解析とサムネイル取得
   動画ファイル自体は保存しない。各サイトの URL を参照するだけ。
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
  //   https://x.com/user/status/123…（twitter.com も可）
  //   https://www.instagram.com/p/CODE/ ・ /reel/CODE/
  //   https://www.facebook.com/watch/?v=123… ・ /user/videos/123… ・ /reel/123…
  //   それ以外のサイト（クライアントのホームページなど）は allowLink のときだけ「リンク」扱い
  //   ※ vm.tiktok.com / tiktok.com/t/ の短縮URLは、ブラウザからは
  //     転送先を辿れない（CORS）ため非対応。元の長いURLを入れてもらう。
  EM.parseVideoUrl = function (input, allowLink) {
    var xUser = null, igKind = 'p';
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
    } else if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com' || host === 'mobile.x.com') {
      provider = 'x';
      var mx = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/);
      if (mx) { id = mx[2]; xUser = mx[1]; }
    } else if (host === 'instagram.com' || host === 'm.instagram.com') {
      provider = 'instagram';
      var mi = u.pathname.match(/^\/(?:[A-Za-z0-9_.]{1,30}\/)?(p|reels?|tv)\/([A-Za-z0-9_-]{5,32})/);
      if (mi) { id = mi[2]; igKind = (mi[1] === 'p' || mi[1] === 'tv') ? 'p' : 'reel'; }
    } else if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'web.facebook.com') {
      provider = 'facebook';
      if (/^\/(watch\/?|video\.php)$/.test(u.pathname)) id = u.searchParams.get('v');
      else {
        var mf = u.pathname.match(/\/(?:videos|reel)\/(?:[^/]+\/)?(\d{6,25})/);
        if (mf) id = mf[1];
      }
      if (id && !/^\d{6,25}$/.test(id)) id = null;
    }

    // どの動画サイトでもない、または動画の場所を読み取れなかったとき：
    // allowLink が true なら「リンク」として受け付ける（押すとそのページが開く）
    if (!provider || !id || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      if (!allowLink) return null;
      if (raw.length > 500) return null;
      return { provider: 'link', video_id: null, video_url: u.href, embed_url: null, host: host };
    }

    var canonical;
    if (provider === 'youtube')        canonical = 'https://www.youtube.com/watch?v=' + id;
    else if (provider === 'vimeo')     canonical = 'https://vimeo.com/' + id;
    else if (provider === 'x')         canonical = 'https://x.com/' + xUser + '/status/' + id;
    else if (provider === 'instagram') canonical = 'https://www.instagram.com/' + igKind + '/' + id + '/';
    else if (provider === 'facebook')  canonical = 'https://www.facebook.com/watch/?v=' + id;
    else                               canonical = (host === 'tiktok.com' && /\/video\//.test(u.pathname))
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
  EM.isVertical = function (provider) { return provider === 'tiktok' || provider === 'x' || provider === 'instagram'; };

  EM.embedUrl = function (provider, id) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(id || ''))) return null;
    if (provider === 'youtube') return 'https://www.youtube.com/embed/' + id;
    if (provider === 'vimeo')   return 'https://player.vimeo.com/video/' + id;
    if (provider === 'tiktok')  return 'https://www.tiktok.com/embed/v2/' + id;
    if (provider === 'x')       return 'https://platform.twitter.com/embed/Tweet.html?dnt=true&lang=ja&id=' + id;
    if (provider === 'instagram') return 'https://www.instagram.com/p/' + id + '/embed/';
    if (provider === 'facebook') return 'https://www.facebook.com/plugins/video.php?show_text=false&href=' +
                                   encodeURIComponent('https://www.facebook.com/watch/?v=' + id);
    return null;
  };

  EM.PROVIDER_LABEL = { youtube: 'YouTube', vimeo: 'Vimeo', tiktok: 'TikTok',
                        x: 'X', instagram: 'Instagram', facebook: 'Facebook', link: 'リンク' };

  // 作品の見せ方をまとめて作る。
  //   再生できるサイト → 埋め込みの再生画面
  //   それ以外（リンク）→ サイト名と「ページを開く」ボタンのカード
  EM.workMedia = function (p) {
    var el = EM.el;
    var embed = EM.embedUrl(p.provider, p.video_id);
    if (embed) {
      var box = el('div', { class: 'embed' + (p.provider === 'x' ? ' embed--x'
                                               : p.provider === 'instagram' ? ' embed--vertical embed--ig'
                                               : EM.isVertical(p.provider) ? ' embed--vertical' : '') });
      var frame = function () {
        return el('iframe', {
          src: embed, title: p.title || '動画', loading: 'lazy',
          allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
          allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin'
        });
      };
      // サムネイルがあるときは、表紙を見せておき、押されてから再生画面を読み込む
      if (EM.safeUrl(p.thumbnail_url)) {
        var cover = el('button', { class: 'embed__cover', type: 'button', 'aria-label': (p.title || '動画') + ' を再生' });
        cover.appendChild(EM.thumbImg(p.thumbnail_url, p.title || ''));
        cover.appendChild(el('span', { class: 'embed__play', text: '▶' }));
        cover.appendChild(el('span', { class: 'badge', text: EM.PROVIDER_LABEL[p.provider] || '動画' }));
        cover.addEventListener('click', function () { EM.clear(box); box.appendChild(frame()); });
        box.appendChild(cover);
      } else {
        box.appendChild(frame());
      }
      return box;
    }
    return EM.linkCover(p.video_url || p.url, p.thumbnail_url);
  };

  // X の投稿は長さがまちまちなので、X から届く「高さ」の知らせに合わせて枠を伸ばす
  window.addEventListener('message', function (e) {
    if (e.origin !== 'https://platform.twitter.com') return;
    var d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
    var m = d && d['twttr.embed'];
    if (!m || m.method !== 'twttr.private.resize' || !m.params || !m.params[0]) return;
    var h = Number(m.params[0].height);
    if (!(h > 50 && h < 5000)) return;
    var frames = document.querySelectorAll('.embed--x iframe');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        frames[i].style.height = Math.ceil(h) + 'px';
        frames[i].parentNode.style.height = Math.ceil(h) + 'px';
      }
    }
  });

  // リンクの作品の表紙（押すと新しいタブでそのページを開く）
  EM.linkCover = function (url, thumb) {
    var el = EM.el, safe = EM.safeUrl(url), host = '';
    try { host = new URL(safe).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
    var a = el('a', { class: 'embed embed--link', href: safe || '#', target: '_blank', rel: 'noopener noreferrer',
                      'aria-label': (host || 'リンク') + ' を開く' });
    if (EM.safeUrl(thumb)) a.appendChild(EM.thumbImg(thumb, ''));
    a.appendChild(el('span', { class: 'embed--link__body' }, [
      el('span', { class: 'embed--link__host', text: host || 'リンク' }),
      el('span', { class: 'btn btn--sm', text: 'ページを開く ↗' })
    ]));
    return a;
  };

  // サムネイル。YouTube は URL 規則で即取得、Vimeo は oEmbed を叩く。
  EM.fetchThumbnail = function (v) {
    if (!v) return Promise.resolve(null);
    if (v.provider === 'youtube') {
      return Promise.resolve('https://img.youtube.com/vi/' + v.video_id + '/hqdefault.jpg');
    }
    // TikTok のサムネイルは配信ドメインが頻繁に変わるため取得しない
    // （CSP の img-src を広げたくないので、代わりに提供元バッジを出す）
    if (v.provider !== 'vimeo') return Promise.resolve(null);
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
