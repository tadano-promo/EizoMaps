/* Eizo Maps — ZAPPING（いろんなクリエイターの作品を、テレビのチャンネルを変えるように次々見る）
   2026-11-20 翠くんの設計
   ・ボタンは上のリモコンに5個（前・次・音量−・音量＋・消音）。昔のテレビのリモコンのように上に置く
   ・音は消した状態で始める（テレビをつけたときに音が出ていないのと同じ）
   ・順番は毎回ばらばら
   ・スマホを縦で持つと、テレビの枠（上と下）の中に映す。横向きのときは枠なし
   ・全画面にすると飾りがふっと消え、画面をさわるとボタンが出る。真ん中で再生／停止
   ・流すのは YouTube・Vimeo の作品だけ（どちらも Eizo Maps のボタンで音量・消音・再生／停止を同じように動かせるため）
*/
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var el = EM.el, $ = EM.$;
    var sb = EM.sb();

    /* ---------- アイコン（絵文字は機種によって四角になるため、線の絵で描く） ---------- */
    var NS = 'http://www.w3.org/2000/svg';
    var ICONS = {
      prev: 'M15 5 L7 12 L15 19 Z',
      next: 'M9 5 L17 12 L9 19 Z',
      voldown: 'M4 9 H8 L13 5 V19 L8 15 H4 Z M16 12 H21',
      volup: 'M4 9 H8 L13 5 V19 L8 15 H4 Z M15 12 H21 M18 9 V15',
      mute: 'M4 9 H8 L13 5 V19 L8 15 H4 Z M16 9 L21 15 M21 9 L16 15',
      sound: 'M4 9 H8 L13 5 V19 L8 15 H4 Z M16 9 Q18 12 16 15 M18.5 7 Q22 12 18.5 17',
      pause: 'M7 5 H10 V19 H7 Z M14 5 H17 V19 H14 Z',
      play: 'M8 5 L19 12 L8 19 Z',
      full: 'M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15',
      exit: 'M6 6 L18 18 M18 6 L6 18'
    };
    function icon(name) {
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', ICONS[name] || '');
      var filled = name === 'prev' || name === 'next' || name === 'pause' || name === 'play';
      path.setAttribute('fill', filled ? 'currentColor' : 'none');
      path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', filled ? '0' : '2');
      path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
      if (name === 'voldown' || name === 'volup' || name === 'mute' || name === 'sound') {
        // スピーカーの部分だけ塗る
        var spk = document.createElementNS(NS, 'path');
        spk.setAttribute('d', 'M4 9 H8 L13 5 V19 L8 15 H4 Z'); spk.setAttribute('fill', 'currentColor');
        svg.appendChild(spk);
      }
      svg.appendChild(path);
      return svg;
    }
    function setIcon(span, name) { EM.clear(span); span.setAttribute('data-ic', name); span.appendChild(icon(name)); }
    EM.$$('[data-ic]').forEach(function (s) { setIcon(s, s.getAttribute('data-ic')); });

    /* ---------- 状態 ---------- */
    var list = [], idx = -1, played = 0;
    var muted = true, vol = 50, paused = false;
    var frame = $('#zFrame'), screenEl = $('#zScreen'), tv = $('#zTv');
    var cur = null;   // { it, iframe, kind }

    /* ---------- 作品を取ってくる ---------- */
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
    function fetchBatch() {
      if (!sb) return Promise.resolve([]);
      return sb.rpc('zapping_works', { p_limit: 200 }).then(function (r) {
        if (r.error) throw r.error;
        return shuffle((r.data || []).filter(function (w) { return /^[A-Za-z0-9_-]{1,32}$/.test(String(w.video_id || '')) && (w.provider === 'youtube' || w.provider === 'vimeo'); }));
      });
    }

    /* ---------- 映す ---------- */
    function isVertical(it) { return it.provider === 'youtube' && /\/shorts\//.test(String(it.video_url || '')); }
    function embedSrc(it) {
      var origin = encodeURIComponent(location.origin);
      if (it.provider === 'youtube') {
        return 'https://www.youtube.com/embed/' + it.video_id + '?autoplay=1&mute=1&playsinline=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&enablejsapi=1&origin=' + origin;
      }
      return 'https://player.vimeo.com/video/' + it.video_id + '?autoplay=1&muted=1&playsinline=1&controls=0&title=0&byline=0&portrait=0&dnt=1';
    }

    function show(i, dir) {
      if (!list.length) return;
      idx = (i + list.length) % list.length;
      var it = list[idx];
      played++;
      noise();
      EM.clear(frame);
      paused = false; syncPlayBtn();
      var vertical = isVertical(it);
      tv.classList.toggle('is-vertical', vertical);
      var iframe = el('iframe', {
        src: embedSrc(it), title: it.title || '作品',
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        referrerpolicy: 'strict-origin-when-cross-origin'
      });
      iframe.addEventListener('load', function () {
        // 動きの知らせを受け取る準備をして、今の音の状態をそろえる
        if (it.provider === 'youtube') post(iframe, it, { event: 'listening', id: 'zap', channel: 'widget' });
        else post(iframe, it, { method: 'addEventListener', value: 'ended' });
        setTimeout(applyAudio, 300);
      });
      frame.appendChild(el('div', { class: 'zap-frame__box' + (vertical ? ' is-vertical' : '') }, iframe));
      cur = { it: it, iframe: iframe };
      var ch = 'CH ' + String(idx + 1).padStart(3, '0');
      $('#zLed').textContent = ch;
      osd(ch + '　' + (it.media || it.industry || ''));
      renderInfo(it);
      EM.track && EM.track('zapping_view', { provider: it.provider, dir: dir || 'start' });
    }

    function post(iframe, it, msg) {
      if (!iframe || !iframe.contentWindow) return;
      var target = it.provider === 'youtube' ? 'https://www.youtube.com' : 'https://player.vimeo.com';
      try { iframe.contentWindow.postMessage(JSON.stringify(msg), target); } catch (e) {}
    }
    function cmd(name, arg) {
      if (!cur) return;
      var it = cur.it, f = cur.iframe;
      if (it.provider === 'youtube') post(f, it, { event: 'command', func: name, args: arg === undefined ? [] : [arg] });
      else {
        var map = { mute: ['setVolume', 0], unMute: null, setVolume: ['setVolume', (arg || 0) / 100], playVideo: ['play'], pauseVideo: ['pause'] };
        var m = map[name]; if (!m) return;
        post(f, it, m.length > 1 ? { method: m[0], value: m[1] } : { method: m[0] });
      }
    }
    function applyAudio() {
      if (muted) cmd('mute');
      else { cmd('unMute'); cmd('setVolume', vol); }
      var mb = $('#zMute');
      mb.classList.toggle('is-on', muted); mb.setAttribute('aria-pressed', muted ? 'true' : 'false');
      mb.querySelector('.zap-btn__lb').textContent = muted ? '消音' : '音あり';
      setIcon(mb.querySelector('.zap-btn__ic'), muted ? 'mute' : 'sound');
      EM.$$('[data-z="mute"] .zap-btn__ic').forEach(function (s) { setIcon(s, muted ? 'mute' : 'sound'); });
    }

    // 動画のサイトから届く知らせ（終わったら次へ）
    window.addEventListener('message', function (e) {
      if (!cur || (e.origin !== 'https://www.youtube.com' && e.origin !== 'https://player.vimeo.com')) return;
      if (e.source !== cur.iframe.contentWindow) return;
      var d = e.data;
      try { if (typeof d === 'string') d = JSON.parse(d); } catch (x) { return; }
      if (!d) return;
      var ended = (d.event === 'onStateChange' && d.info === 0) || (d.event === 'infoDelivery' && d.info && d.info.playerState === 0) || d.event === 'ended';
      if (ended) next('auto');
    });

    /* ---------- テレビっぽさ：チャンネルを変えた一瞬の砂嵐・画面の表示 ---------- */
    var noiseTimer = null;
    function noise() {
      var c = $('#zNoise'); if (!c.getContext) return;
      var ctx = c.getContext('2d'), w = c.width, h = c.height, img = ctx.createImageData(w, h), n = 0;
      c.classList.add('is-on');
      clearInterval(noiseTimer);
      noiseTimer = setInterval(function () {
        for (var i = 0; i < img.data.length; i += 4) { var v = Math.random() * 255 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
        ctx.putImageData(img, 0, 0);
        if (++n > 8) { clearInterval(noiseTimer); c.classList.remove('is-on'); }
      }, 45);
    }
    var osdTimer = null;
    function osd(text) {
      var o = $('#zOsd'); o.textContent = text; o.classList.add('is-on');
      clearTimeout(osdTimer); osdTimer = setTimeout(function () { o.classList.remove('is-on'); }, 1600);
    }
    var volTimer = null;
    function volBar() {
      var v = $('#zVol'); EM.clear(v);
      v.appendChild(el('span', { class: 'zap-vol__lb', text: muted ? '消音' : '音量' }));
      var bars = el('span', { class: 'zap-vol__bars' });
      for (var i = 1; i <= 10; i++) bars.appendChild(el('i', { class: (!muted && vol >= i * 10) ? 'on' : '' }));
      v.appendChild(bars);
      v.classList.add('is-on');
      clearTimeout(volTimer); volTimer = setTimeout(function () { v.classList.remove('is-on'); }, 1600);
    }

    /* ---------- いま映っている作品 ---------- */
    function renderInfo(it) {
      var box = $('#zInfo'); EM.clear(box);
      var page = it.handle ? '/@' + encodeURIComponent(it.handle) : '/creators/detail.html?id=' + encodeURIComponent(it.creator_id);
      var meta = [it.media, it.industry, it.work_year ? String(it.work_year) : null].filter(Boolean).join('・');
      box.appendChild(el('div', { class: 'zap-info__main' }, [
        it.avatar_url && EM.safeUrl(it.avatar_url) ? el('img', { class: 'zap-info__av', src: it.avatar_url, alt: '' }) : el('span', { class: 'zap-info__av zap-info__av--ph', text: (it.display_name || '?').slice(0, 1) }),
        el('div', { class: 'zap-info__text' }, [
          el('p', { class: 'zap-info__title', text: it.title || '' }),
          el('p', { class: 'small' }, [el('a', { href: page, text: it.display_name || 'クリエイター' }), meta ? el('span', { class: 'muted', text: '　' + meta }) : null]),
          it.role ? el('p', { class: 'small muted', text: '担当：' + it.role }) : null
        ])
      ]));
      box.appendChild(el('div', { class: 'zap-info__actions' }, [
        el('a', { class: 'btn btn--sm', href: page, text: 'この人のページを見る' }),
        el('a', { class: 'btn btn--sm btn--primary', href: '/request/?creator_id=' + encodeURIComponent(it.creator_id), text: 'この人に依頼する' })
      ]));
    }

    /* ---------- 操作 ---------- */
    function next(why) {
      if (!list.length) return;
      // 最後まで見たら、新しくまぜ直して足す（同じ順番にならないように）
      if (idx >= list.length - 1 && list.length > 2) {
        var last = list[idx];
        var more = shuffle(list.slice());
        if (more[0] && more[0].id === last.id) more.push(more.shift());
        list = list.concat(more);
      }
      show(idx + 1, why || 'next');
    }
    function prev() { if (list.length) show(idx - 1, 'prev'); }
    function volUp() { if (muted) muted = false; else vol = Math.min(100, vol + 10); applyAudio(); volBar(); }
    function volDown() { if (muted) { volBar(); return; } vol = Math.max(0, vol - 10); if (vol === 0) { muted = true; vol = 10; } applyAudio(); volBar(); }
    function toggleMute() { muted = !muted; if (!muted && vol === 0) vol = 30; applyAudio(); volBar(); }
    function togglePlay() { paused = !paused; cmd(paused ? 'pauseVideo' : 'playVideo'); syncPlayBtn(); showControls(); }
    function syncPlayBtn() { var s = $('#zPlay .zap-btn__ic'); if (s) setIcon(s, paused ? 'play' : 'pause'); }

    $('#zPrev').addEventListener('click', prev);
    $('#zNext').addEventListener('click', function () { next(); });
    $('#zVolUp').addEventListener('click', volUp);
    $('#zVolDown').addEventListener('click', volDown);
    $('#zMute').addEventListener('click', toggleMute);
    $('#zPlay').addEventListener('click', function (e) { e.stopPropagation(); togglePlay(); });
    EM.$$('#zFsBar [data-z]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var z = b.getAttribute('data-z');
        if (z === 'prev') prev(); else if (z === 'next') next(); else if (z === 'volup') volUp(); else if (z === 'voldown') volDown(); else if (z === 'mute') toggleMute(); else if (z === 'exit') exitFull();
        showControls();
      });
    });

    // 画面をさわる：ボタン（再生／停止・全画面のときは上の操作）を3秒出す。左右にすべらせると前・次
    var ctrlTimer = null;
    function showControls() {
      $('#zPlay').hidden = false;
      if (isFull) $('#zFsBar').hidden = false;
      screenEl.classList.add('show-ctrl');
      clearTimeout(ctrlTimer);
      ctrlTimer = setTimeout(function () {
        if (paused) return;   // 止めているあいだは出したまま
        $('#zPlay').hidden = true; $('#zFsBar').hidden = true; screenEl.classList.remove('show-ctrl');
      }, 3000);
    }
    var touchX = null, touchY = null, swiped = false;
    var touch = $('#zTouch');
    touch.addEventListener('touchstart', function (e) { var t = e.touches[0]; touchX = t.clientX; touchY = t.clientY; swiped = false; }, { passive: true });
    touch.addEventListener('touchend', function (e) {
      if (touchX == null) return;
      var t = e.changedTouches[0], dx = t.clientX - touchX, dy = t.clientY - touchY;
      touchX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { swiped = true; if (dx < 0) next(); else prev(); }
    }, { passive: true });
    touch.addEventListener('click', function () { if (swiped) { swiped = false; return; } showControls(); });

    // キーボード（パソコン）：← → 前後、↑ ↓ 音量、M 消音、スペース 再生／停止、F 全画面
    document.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      var k = e.key;
      if (k === 'ArrowRight') { next(); e.preventDefault(); }
      else if (k === 'ArrowLeft') { prev(); e.preventDefault(); }
      else if (k === 'ArrowUp') { volUp(); e.preventDefault(); }
      else if (k === 'ArrowDown') { volDown(); e.preventDefault(); }
      else if (k === 'm' || k === 'M') toggleMute();
      else if (k === ' ') { togglePlay(); e.preventDefault(); }
      else if (k === 'f' || k === 'F') { isFull ? exitFull() : enterFull(); }
      else if (k === 'Escape' && isFull) exitFull();
    });

    /* ---------- 全画面 ---------- */
    // iPhone では動画以外の全画面ができないため、画面いっぱいに広げる形で代わりにする
    var isFull = false;
    function enterFull() {
      isFull = true;
      document.body.classList.add('zap-is-full');
      var req = screenEl.requestFullscreen || screenEl.webkitRequestFullscreen;
      if (req) {
        try {
          var pr = req.call(screenEl);
          if (pr && pr.then) pr.then(lockLandscape).catch(function () {});
          else lockLandscape();
        } catch (e) {}
      }
      showControls();
    }
    function lockLandscape() {
      // 横の作品は、全画面にしたら横向きで見られるように（できる機種だけ）
      if (cur && !isVertical(cur.it) && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
    }
    function exitFull() {
      isFull = false;
      document.body.classList.remove('zap-is-full');
      $('#zFsBar').hidden = true;
      var fe = document.fullscreenElement || document.webkitFullscreenElement;
      if (fe) { var ex = document.exitFullscreen || document.webkitExitFullscreen; try { ex.call(document); } catch (e) {} }
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
    }
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && isFull) exitFull(); });
    $('#zFull').addEventListener('click', enterFull);

    /* ---------- はじめる ---------- */
    fetchBatch().then(function (rows) {
      list = rows;
      if (!list.length) {
        var em = $('#zEmpty');
        em.hidden = false;
        em.appendChild(el('p', { text: 'まだ流せる作品がありません。' }));
        em.appendChild(el('p', { class: 'small', text: 'クリエイターが公開していて、載せる許可を確認した YouTube・Vimeo の作品がここに流れます。' }));
        $('#zLed').textContent = 'CH ---';
        noise();
        return;
      }
      show(0, 'start');
    }).catch(function (e) {
      var em = $('#zEmpty'); em.hidden = false;
      em.appendChild(el('p', { text: '作品を読み込めませんでした。少し時間をおいて、ページを読み込み直してください。' }));
      em.appendChild(el('p', { class: 'small muted', text: EM.errorText(e) }));
    });
  });
})(window.EM);
