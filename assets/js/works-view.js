/* Eizo Maps — 作品の表紙と全画面の再生（プロフィール・商談モードで使う）
   ・EM.workCover(p, onOpen) … 16:9 にそろえた表紙。写真は白黒×黄色の2色で、マウスを乗せた1枚（スマホは画面の真ん中の1枚）だけ元の色
     X や Instagram の投稿も、ここでは表紙だけにする（埋め込みのままだと長さがばらばらで、左右がそろわないため）
   ・EM.openPlayer(list, index, opts) … 全画面で再生。右に作品の情報の表、前後の作品、ほかの作品 */
(function (EM) {
  'use strict';
  var el = EM.el;

  // 作品の媒体（040）。大きな分け方 → 媒体
  EM.MEDIA = [["広告", ["TVCM", "WebCM", "ブランデッドムービー", "屋外・サイネージ", "グラフィック撮影"]], ["映画", ["劇場映画", "短編・自主映画", "ドキュメンタリー映画"]], ["ドラマ", ["地上波ドラマ", "配信ドラマ", "縦型ショートドラマ"]], ["テレビ番組", ["バラエティ", "情報番組", "報道・ニュース", "ドキュメンタリー番組", "歌番組", "スポーツ中継"]], ["音楽", ["MV", "ライブ映像", "ライブ配信"]], ["配信・SNS", ["YouTube番組", "生配信", "SNS縦型ショート"]], ["企業", ["企業VP", "採用動画", "研修・マニュアル", "イベント・セミナー収録", "店舗紹介"]], ["アニメ", ["TVアニメ", "劇場アニメ", "配信アニメ", "OVA", "アニメCM・PR"]], ["ゲーム・VTuber", ["ゲーム映像", "VTuber"]], ["そのほか", ["舞台・演劇", "プロジェクションマッピング", "ウェディング・記念映像", "メイキング", "その他"]]];
  EM.mediaGroup = function (v) { for (var i = 0; i < EM.MEDIA.length; i++) if (EM.MEDIA[i][1].indexOf(v) !== -1) return EM.MEDIA[i][0]; return null; };

  function coverImage(p) {
    if (EM.safeUrl(p.thumbnail_url)) return p.thumbnail_url;
    if (p.provider === 'youtube' && /^[A-Za-z0-9_-]{6,20}$/.test(String(p.video_id || ''))) return 'https://i.ytimg.com/vi/' + p.video_id + '/hqdefault.jpg';
    return null;
  }
  function hostOf(url) { try { return new URL(EM.safeUrl(url)).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  EM.workCover = function (p, onOpen) {
    var img = coverImage(p);
    var label = p.provider === 'link' ? (hostOf(p.video_url) || 'リンク') : (EM.PROVIDER_LABEL[p.provider] || '動画');
    var btn = el('button', { type: 'button', class: 'work-cover' + (img ? ' has-img' : ' no-img'), 'aria-label': (p.title || '作品') + ' を大きく見る' });
    if (img) btn.appendChild(EM.thumbImg(img, ''));
    else btn.appendChild(el('span', { class: 'work-cover__ph' }, [el('span', { class: 'work-cover__ph-label', text: label }), el('span', { class: 'work-cover__ph-title', text: p.title || '' })]));
    btn.appendChild(el('span', { class: 'work-cover__play', 'aria-hidden': 'true', text: p.provider === 'link' ? '↗' : '▶' }));
    btn.appendChild(el('span', { class: 'badge', text: label }));
    btn.addEventListener('click', function () { if (onOpen) onOpen(); });
    watchLive(btn);
    return btn;
  };

  // スマホ（マウスがない画面）では、画面の真ん中にある表紙だけ元の色にする
  var io = null;
  function watchLive(node) {
    if (!('IntersectionObserver' in window) || !window.matchMedia || !window.matchMedia('(hover: none)').matches) return;
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle('is-live', e.isIntersecting); });
    }, { rootMargin: '-40% 0px -40% 0px' });
    io.observe(node);
  }

  // 作品の情報（TYOさんの「項目名 → 中身」の表）
  EM.workFacts = function (p) {
    var rows = [];
    if (p.work_year) rows.push(['年', String(p.work_year)]);
    if (p.media) rows.push(['媒体', p.media]);
    if (p.purpose) rows.push(['目的', p.purpose]);
    if (p.industry) rows.push(['業種', p.industry]);
    if (p.length_label) rows.push(['尺・本数', p.length_label]);
    if (p.client_display === 'named' && p.client_name) rows.push(['取引先', p.client_name]);
    else if (p.client_display === 'industry' && p.industry) rows.push(['取引先', p.industry + 'の企業（社名は非公開）']);
    if (p.role) rows.push(['本人の担当', p.role]);
    if (p.credits) rows.push(['ほかのスタッフ', p.credits]);
    return rows;
  };

  function playerMedia(p) {
    var url = EM.embedUrl(p.provider, p.video_id);
    if (!url) {
      var img = coverImage(p);
      var a = el('a', { class: 'player__link', href: EM.safeUrl(p.video_url) || '#', target: '_blank', rel: 'noopener noreferrer' }, [
        img ? EM.thumbImg(img, '') : null,
        el('span', { class: 'btn btn--primary', text: (hostOf(p.video_url) || 'ページ') + ' で見る ↗' })
      ]);
      return el('div', { class: 'player__frame' }, a);
    }
    if (p.provider === 'youtube') url += '?autoplay=1&rel=0';
    else if (p.provider === 'vimeo') url += '?autoplay=1';
    var vertical = EM.isVertical(p.provider);
    return el('div', { class: 'player__frame' + (vertical ? ' is-vertical' : '') + (p.provider === 'x' ? ' is-x' : '') }, el('iframe', {
      src: url, title: p.title || '作品', allow: 'autoplay; accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin'
    }));
  }

  var state = null;
  EM.openPlayer = function (list, index, opts) {
    opts = opts || {};
    state = { list: list, index: index, opts: opts };
    render();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('is-player');
  };
  EM.closePlayer = function () {
    var w = document.getElementById('player');
    if (w) w.parentNode.removeChild(w);
    document.body.classList.remove('is-player');
    document.removeEventListener('keydown', onKey);
    if (state && state.opts.onClose) state.opts.onClose();
    state = null;
  };
  function onKey(e) {
    if (!state) return;
    if (e.key === 'Escape') { e.stopPropagation(); EM.closePlayer(); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  }
  function go(d) {
    var n = state.list.length;
    if (n < 2) return;
    state.index = (state.index + d + n) % n;
    render();
  }

  function render() {
    var old = document.getElementById('player');
    if (old) old.parentNode.removeChild(old);
    var list = state.list, i = state.index, p = list[i], o = state.opts;
    if (o.onShow) o.onShow(p);

    var facts = EM.workFacts(p);
    var table = facts.length ? el('dl', { class: 'player__facts' }) : null;
    facts.forEach(function (r) { table.appendChild(el('dt', { text: r[0] })); table.appendChild(el('dd', { class: 'pre', text: r[1] })); });

    function navBtn(d, label) {
      var q = list[(i + d + list.length) % list.length];
      var img = coverImage(q);
      return el('button', { type: 'button', class: 'player__nav', onclick: function () { go(d); } }, [
        el('span', { class: 'small muted', text: label }),
        img ? EM.thumbImg(img, '') : null,
        el('span', { class: 'player__nav-title', text: q.title || '作品' })
      ]);
    }

    var others = [];
    for (var k = 1; k <= Math.min(3, list.length - 1); k++) others.push((i + k) % list.length);

    var info = el('aside', { class: 'player__info' }, [
      el('h2', { class: 'player__title', text: p.title || '作品' }),
      o.creatorName ? el('p', { class: 'small muted', text: o.creatorName }) : null,
      table,
      p.description ? el('p', { class: 'small pre player__desc', text: p.description }) : null,
      o.askHref ? el('a', { class: 'btn btn--primary', href: o.askHref, text: (o.creatorName ? o.creatorName + ' さんに' : '') + '相談する' }) : null,
      list.length > 1 ? el('div', { class: 'player__navs' }, [navBtn(-1, '← 前の作品'), navBtn(1, '次の作品 →')]) : null,
      others.length ? el('div', { class: 'player__others' }, [el('p', { class: 'small muted', text: 'ほかの作品' }),
        el('div', { class: 'player__others-grid' }, others.map(function (j) {
          var q = list[j], img = coverImage(q);
          return el('button', { type: 'button', class: 'player__other', title: q.title || '', onclick: function () { state.index = j; render(); } }, [
            img ? EM.thumbImg(img, '') : el('span', { class: 'player__other-ph', text: EM.PROVIDER_LABEL[q.provider] || '' }),
            el('span', { class: 'player__other-title', text: q.title || '' })
          ]);
        }))]) : null
    ]);

    var wrap = el('div', { id: 'player', class: 'player', role: 'dialog', 'aria-modal': 'true', 'aria-label': (p.title || '作品') + '（' + (i + 1) + ' / ' + list.length + '）' }, [
      el('button', { type: 'button', class: 'player__close', 'aria-label': '閉じる（Esc）', text: '×', onclick: EM.closePlayer }),
      el('div', { class: 'player__body' }, [el('div', { class: 'player__main' }, [playerMedia(p),
        el('p', { class: 'small muted player__count', text: (i + 1) + ' / ' + list.length + '　← → キーで前後の作品' })]), info])
    ]);
    document.body.appendChild(wrap);
    wrap.querySelector('.player__close').focus();
  }
})(window.EM);
