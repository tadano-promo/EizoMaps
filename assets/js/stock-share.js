/* Eizo Maps — 鍵付きページ（ストックページ）の取り寄せと受け渡し
   ・プロフィール：「非公開の作品があります」→ 見たいページにチェック → ひとこと → 送る（ログインが必要）
   ・メッセージ：取り寄せ／受け渡し／見送りのカード。クリエイターは「渡す」でページを選び、パスワードを自分で打つ
   ・パスワードはメッセージの本文には入れない。受け取った人と渡した本人だけが「見る」で確かめられる
   ・渡された人も、開くには毎回パスワードが要る（ログインだけでは開けない）
   2026-10-31 翠くんと決めた形。書き込みはすべてデータベースの関数（request_stock / give_stock / decline_stock）を通す。 */
(function (EM) {
  'use strict';
  var el = EM.el;

  function copyText(v, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(function () { EM.toast(label + 'をコピーしました'); }, function () { EM.toast(v); });
    } else { EM.toast(v); }
  }
  function stockUrl(slug) { return (EM.config.SITE_ORIGIN || location.origin) + '/s/?u=' + encodeURIComponent(slug); }

  /* ---------- 小さな画面（重ねて開く） ---------- */
  function sheet(title) {
    var prevFocus = document.activeElement;
    var body = el('div', { class: 'em-sheet__body' });
    var msg = el('div', { class: 'notice', hidden: true });
    var box = el('div', { class: 'em-sheet__box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'em-sheet__head' }, [
        el('h2', { class: 'em-sheet__title', text: title }),
        el('button', { class: 'em-sheet__close', type: 'button', 'aria-label': '閉じる', text: '×', onclick: function () { close(); } })
      ]),
      msg, body
    ]);
    var wrap = el('div', { class: 'em-sheet', onclick: function (e) { if (e.target === wrap) close(); } }, box);
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
      document.removeEventListener('keydown', onKey);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      document.body.classList.remove('has-sheet');
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    document.body.classList.add('has-sheet');
    return { body: body, msg: msg, close: close, box: box };
  }

  /* ---------- パスワードを「見る」（押すまで隠す・30秒で自動で隠す） ---------- */
  function revealRow(fetcher) {
    var shown = el('span', { class: 'mono pw-reveal', text: '●●●●●●●●' });
    var timer = null, value = '';
    var copyBtn = el('button', { class: 'btn btn--sm', type: 'button', text: 'コピー', hidden: true, onclick: function () { if (value) copyText(value, 'パスワード'); } });
    var note = el('span', { class: 'small muted', hidden: true });
    function hide() { clearTimeout(timer); value = ''; shown.textContent = '●●●●●●●●'; btn.textContent = '見る'; copyBtn.hidden = true; }
    var btn = el('button', { class: 'btn btn--sm', type: 'button', text: '見る', onclick: function () {
      if (value) { hide(); return; }
      btn.setAttribute('aria-busy', 'true');
      fetcher().then(function (res) {
        btn.removeAttribute('aria-busy');
        if (!res || !res.password) { note.hidden = false; note.textContent = (res && res.note) || '表示できません'; return; }
        value = res.password; shown.textContent = value; btn.textContent = '隠す'; copyBtn.hidden = false;
        if (res.note) { note.hidden = false; note.textContent = res.note; } else { note.hidden = true; }
        clearTimeout(timer); timer = setTimeout(hide, 30000);
      }, function (e) { btn.removeAttribute('aria-busy'); note.hidden = false; note.textContent = EM.errorText(e); });
    } });
    return el('span', { class: 'pw-row-inline' }, [shown, btn, copyBtn, note]);
  }

  /* =================================================================
     1. プロフィール：非公開の作品があります
     ================================================================= */
  function profile(c) {
    var sb = EM.sb(), sec = document.getElementById('stockSection');
    if (!sb || !sec || !c || !c.id) return;
    sb.rpc('public_stock_pages', { p_creator_id: c.id }).then(function (r) {
      var list = (r && !r.error && r.data) || [];
      if (!list.length) return;
      EM.clear(sec);
      sec.hidden = false;
      sec.appendChild(el('hr', { class: 'divider' }));
      sec.appendChild(el('p', { class: 'eyebrow', text: 'Private works' }));
      sec.appendChild(el('h2', { text: '非公開の作品があります' }));
      sec.appendChild(el('p', { class: 'small muted', text: '表には出せない作品を、鍵付きのページにまとめています。見たいページを選んで「見せてもらう」を押すと、' + c.display_name + ' さんにメッセージで届きます（ログインが必要です）。' }));
      var grid = el('div', { class: 'stock-cards' });
      list.forEach(function (p) {
        grid.appendChild(el('div', { class: 'stock-card' }, [
          el('span', { class: 'stock-card__lock', 'aria-hidden': 'true', text: '🔒' }),
          el('span', { class: 'stock-card__text' }, [
            el('span', { class: 'stock-card__title', text: p.title }),
            el('span', { class: 'small muted', text: p.item_count ? p.item_count + '作品' : '' })
          ]),
          el('button', { class: 'btn btn--sm', type: 'button', text: '見せてもらう', onclick: function () { openRequest(c, list, p.id); } })
        ]));
      });
      sec.appendChild(grid);
      EM.getUser().then(function (u) {
        if (u && u.id === c.user_id) {
          EM.$$('button', grid).forEach(function (b) { b.hidden = true; });
          sec.appendChild(el('p', { class: 'small muted', text: 'あなたのページです。ほかの人にはこのように見えます。' }));
        }
      });
    });
  }

  function openRequest(c, list, firstId) {
    var sb = EM.sb();
    EM.getUser().then(function (u) {
      if (!u) {
        location.href = '/auth/?next=' + encodeURIComponent(location.pathname + location.search);
        return;
      }
      var s = sheet('鍵付きページを見せてもらう');
      s.body.appendChild(el('p', { class: 'small', text: c.display_name + ' さんに送ります。見たいページを選んでください。' }));
      var checks = list.map(function (p) {
        var cb = el('input', { type: 'checkbox', value: p.id });
        cb.checked = p.id === firstId;
        s.body.appendChild(el('label', { class: 'checkbox stock-check' }, [cb, el('span', { text: '🔒 ' + p.title + (p.item_count ? '（' + p.item_count + '作品）' : '') })]));
        return cb;
      });
      var ta = el('textarea', { rows: 4, maxlength: 2000, placeholder: '例：株式会社○○の山田です。来月のWeb CMの候補として拝見したいです。' });
      s.body.appendChild(el('label', { class: 'field' }, [el('span', { class: 'label', text: 'ひとこと（会社名・お名前・見たい理由など）' }), ta]));
      // 依頼者として登録している人は、会社名とお名前を先に入れておく
      sb.from('clients').select('company,display_name').eq('user_id', u.id).maybeSingle().then(function (r) {
        var cl = r && r.data;
        if (cl && !ta.value) {
          var who = [cl.company, cl.display_name].filter(function (x) { return x && String(x).trim(); }).join('の');
          if (who) ta.value = who + 'です。\n';
        }
      });
      var btn = el('button', { class: 'btn btn--primary', type: 'button', text: '送る', onclick: function () {
        var ids = checks.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        if (!ids.length) { EM.notice(s.msg, '見たいページを選んでください。', 'error'); return; }
        btn.setAttribute('aria-busy', 'true');
        sb.rpc('request_stock', { p_creator_id: c.id, p_page_ids: ids, p_body: ta.value.trim() }).then(function (r2) {
          btn.removeAttribute('aria-busy');
          if (r2.error) { EM.notice(s.msg, EM.errorText(r2.error), 'error'); return; }
          EM.clear(s.body); EM.notice(s.msg, '');
          s.body.appendChild(el('p', { text: '送りました。' + c.display_name + ' さんから届いたら、メッセージでお知らせします。' }));
          s.body.appendChild(el('p', { class: 'small muted', text: '届いたページは、メッセージの画面の「見せてもらった作品」からいつでも開けます。開くには毎回パスワードが要ります。' }));
          s.body.appendChild(el('div', { class: 'form-actions' }, el('a', { class: 'btn', href: '/messages/?t=' + r2.data, text: 'メッセージを開く' })));
        });
      } });
      s.body.appendChild(el('div', { class: 'form-actions' }, [btn]));
      s.body.appendChild(el('p', { class: 'small muted', text: '返事を待っている間は、同じページをもう一度取り寄せることはできません。' }));
    });
  }

  /* =================================================================
     2. メッセージの中のカード
     ================================================================= */
  // ctx = { thread, me, requests: [stock_requests の行], reload: function }
  function card(m, ctx) {
    var pages = (m.meta && m.meta.pages) || [];
    var mine = m.sender_id === ctx.me.id;
    var isCreator = ctx.thread.i_am === 'creator';
    var kids = [];
    if (m.kind === 'stock_request') {
      kids.push(el('p', { class: 'dm-card__title', text: '🔒 鍵付きページの取り寄せ' }));
      var pending = [];
      var ul = el('ul', { class: 'dm-card__pages' });
      pages.forEach(function (p) {
        var rq = (ctx.requests || []).filter(function (x) { return x.message_id === m.id && x.page_id === p.id; })[0];
        var st = rq ? rq.status : '';
        if (st === 'pending') pending.push(p);
        ul.appendChild(el('li', null, [p.title, st ? el('span', { class: 'tag tag--' + (st === 'given' ? 'accent' : st === 'pending' ? 'warn' : 'muted'), text: st === 'given' ? '渡し済み' : st === 'pending' ? '返事待ち' : '見送り' }) : null]));
      });
      kids.push(ul);
      kids.push(el('p', { class: 'dm-msg__body pre', text: m.body }));
      if (isCreator && pending.length) {
        kids.push(el('div', { class: 'page-links' }, [
          el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '渡す', onclick: function () { openGive(ctx, pending.map(function (p) { return p.id; })); } }),
          el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: '渡さない', onclick: function () {
            if (!confirm('「' + pending.map(function (p) { return p.title; }).join('」「') + '」を今回は見送りますか？\n相手には「今回は見送らせてください」とだけ届きます（理由は届きません）。')) return;
            EM.sb().rpc('decline_stock', { p_thread_id: ctx.thread.id, p_page_ids: pending.map(function (p) { return p.id; }) }).then(function (r) {
              if (r.error) { EM.toast(EM.errorText(r.error)); return; }
              ctx.reload();
            });
          } })
        ]));
      }
    } else if (m.kind === 'stock_give') {
      kids.push(el('p', { class: 'dm-card__title', text: mine ? '🔒 鍵付きページを渡しました' : '🔒 鍵付きページが届きました' }));
      kids.push(el('p', { class: 'dm-msg__body pre', text: m.body }));
      pages.forEach(function (p) {
        var url = stockUrl(p.slug);
        var validNote = el('p', { class: 'small', hidden: true });
        kids.push(el('div', { class: 'dm-card__give' }, [
          el('p', { class: 'dm-card__pt', text: p.title }),
          el('p', { class: 'small' }, [
            el('a', { href: url, target: '_blank', rel: 'noopener', class: 'mono', text: url.replace(/^https?:\/\//, '') }),
            ' ',
            el('button', { class: 'btn btn--sm', type: 'button', text: 'URL をコピー', onclick: function () { copyText(url, 'URL'); } })
          ]),
          el('p', { class: 'small' }, ['パスワード：', revealRow(function () {
            return EM.sb().rpc('get_handover_password', { p_handover_id: p.handover_id }).then(function (r) {
              if (r.error) throw r.error;
              var d = r.data || {};
              if (!d.valid) {
                validNote.hidden = false;
                validNote.textContent = mine
                  ? 'このパスワードは、いまは使えません（パスワードを変えたか、ページを非公開にしています）。'
                  : 'クリエイターがパスワードを変えたか、ページを止めたため、このパスワードでは開けません。もう一度見せてもらうときは、メッセージで聞いてください。';
              }
              return { password: d.password };
            });
          })]),
          validNote
        ]));
      });
      if (!mine) kids.push(el('p', { class: 'small muted', text: '開くには毎回パスワードが要ります。ほかの人に見せるときは、作品に守秘義務がないか確かめてからにしてください。' }));
    } else if (m.kind === 'stock_decline') {
      kids.push(el('p', { class: 'dm-card__title', text: '🔒 今回は見送り' }));
      kids.push(el('p', { class: 'small muted', text: pages.map(function (p) { return p.title; }).join('、') }));
      kids.push(el('p', { class: 'dm-msg__body pre', text: m.body }));
    }
    return el('div', { class: 'dm-card' }, kids);
  }

  /* ---------- 渡す（クリエイター側）：ページにチェック → パスワードを自分で打つ → 確認 → 送る ---------- */
  function openGive(ctx, presetIds) {
    var sb = EM.sb();
    var s = sheet('鍵付きページを渡す');
    s.body.appendChild(el('p', { class: 'small muted', text: '読み込んでいます…' }));
    Promise.all([
      sb.from('stock_pages').select('id,title,slug,is_active,password_updated_at').eq('creator_id', ctx.thread.creator_id).order('created_at'),
      sb.rpc('my_stock_pw_viewable')
    ]).then(function (res) {
      if (res[0].error) throw res[0].error;
      var list = res[0].data || [];
      var viewable = {};
      ((res[1] && res[1].data) || []).forEach(function (x) { viewable[x.page_id] = x.viewable; });
      EM.clear(s.body);
      if (!list.length) {
        s.body.appendChild(el('p', null, ['鍵付きページがまだありません。 ', el('a', { href: '/mypage/stock.html', text: 'ページを作る' })]));
        return;
      }
      s.body.appendChild(el('p', { class: 'small', text: ctx.thread.other_name + ' さんに渡すページを選んで、そのページのパスワードを入れてください。' }));
      var rows = list.map(function (p) {
        var ok = p.is_active && p.password_updated_at;
        var cb = el('input', { type: 'checkbox', value: p.id, disabled: !ok });
        cb.checked = ok && (presetIds || []).indexOf(p.id) !== -1;
        var pw = el('input', { type: 'text', maxlength: 72, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'このページのパスワード' });
        var pwBox = el('div', { class: 'stock-give__pw', hidden: !cb.checked }, [
          el('label', { class: 'small label', text: 'パスワード（自分で入れてください）' }), pw,
          el('p', { class: 'small muted' }, ['分からないとき：',
            viewable[p.id]
              ? revealRow(function () { return sb.rpc('reveal_stock_password', { p_page_id: p.id }).then(function (r) { if (r.error) throw r.error; return { password: r.data }; }); })
              : el('span', { text: '前のしくみで保存したため表示できません。ストックページの画面で設定し直すと見られます。' })
          ])
        ]);
        cb.addEventListener('change', function () { pwBox.hidden = !cb.checked; if (cb.checked) pw.focus(); });
        s.body.appendChild(el('div', { class: 'stock-give__row' + (ok ? '' : ' is-off') }, [
          el('label', { class: 'checkbox stock-check' }, [cb, el('span', null, [
            '🔒 ' + p.title,
            ok ? null : el('span', { class: 'small muted', text: p.password_updated_at ? '（非公開のため渡せません）' : '（パスワードが未設定のため渡せません）' })
          ])]),
          pwBox
        ]));
        return { p: p, cb: cb, pw: pw };
      });
      var ta = el('textarea', { rows: 4, maxlength: 2000 });
      ta.value = ctx.thread.other_name + ' さん\nご連絡ありがとうございます。鍵付きページをお送りします。';
      s.body.appendChild(el('label', { class: 'field' }, [el('span', { class: 'label', text: 'メッセージ' }), ta,
        el('span', { class: 'hint', text: 'パスワードはここには書かないでください。URL とパスワードは、相手の画面にカードで表示されます。' })]));
      var next = el('button', { class: 'btn btn--primary', type: 'button', text: '確認へ', onclick: function () {
        var picked = rows.filter(function (x) { return x.cb.checked; });
        if (!picked.length) { EM.notice(s.msg, '渡すページを選んでください。', 'error'); return; }
        for (var i = 0; i < picked.length; i++) {
          if (!picked[i].pw.value.trim()) { EM.notice(s.msg, '「' + picked[i].p.title + '」のパスワードを入れてください。', 'error'); picked[i].pw.focus(); return; }
          if (ta.value.indexOf(picked[i].pw.value.trim()) !== -1) { EM.notice(s.msg, 'パスワードはメッセージには書かず、パスワードの欄に入れてください。', 'error'); return; }
        }
        EM.notice(s.msg, '');
        confirmStep(picked, ta.value.trim());
      } });
      s.body.appendChild(el('div', { class: 'form-actions' }, next));

      function confirmStep(picked, body) {
        var stash = Array.prototype.slice.call(s.body.childNodes);
        stash.forEach(function (n) { n.hidden = true; });
        var box = el('div', { class: 'stock-confirm' }, [
          el('p', { class: 'stock-confirm__to', text: ctx.thread.other_name + ' さんに' }),
          el('ul', { class: 'stock-confirm__list' }, picked.map(function (x) { return el('li', { text: '🔒 ' + x.p.title }); })),
          el('p', { class: 'stock-confirm__to', text: 'のパスワードを送ります。' }),
          el('p', { class: 'small muted', text: '相手は、このページを開くたびにパスワードを入れます。渡したあとに別の会社に見せる中身へ入れ替えるときは、新しいページを作るか、パスワードを変えてください。' })
        ]);
        var back = el('button', { class: 'btn btn--ghost', type: 'button', text: '戻る', onclick: function () {
          s.body.removeChild(box); s.body.removeChild(acts); stash.forEach(function (n) { n.hidden = false; });
        } });
        var send = el('button', { class: 'btn btn--primary', type: 'button', text: '送る', onclick: function () {
          send.setAttribute('aria-busy', 'true');
          sb.rpc('give_stock', {
            p_thread_id: ctx.thread.id,
            p_items: picked.map(function (x) { return { page_id: x.p.id, password: x.pw.value.trim() }; }),
            p_body: body
          }).then(function (r) {
            send.removeAttribute('aria-busy');
            if (r.error) { EM.notice(s.msg, EM.errorText(r.error), 'error'); back.click(); return; }
            s.close(); EM.toast('送りました'); ctx.reload();
          });
        } });
        var acts = el('div', { class: 'form-actions' }, [send, back]);
        s.body.appendChild(box); s.body.appendChild(acts);
      }
    }).catch(function (e) { EM.clear(s.body); EM.notice(s.msg, EM.errorText(e), 'error'); });
  }

  /* ---------- 見せてもらった作品（クライアント側の一覧） ---------- */
  function received(box) {
    var sb = EM.sb();
    if (!sb || !box) return;
    sb.rpc('my_received_stock').then(function (r) {
      var list = (r && !r.error && r.data) || [];
      EM.clear(box);
      box.hidden = !list.length;
      if (!list.length) return;
      var det = el('details', { class: 'stock-received' }, [
        el('summary', { text: '🔒 見せてもらった作品（' + list.length + '）' })
      ]);
      list.forEach(function (x) {
        var url = stockUrl(x.slug);
        det.appendChild(el('div', { class: 'stock-received__row' + (x.valid ? '' : ' is-off') }, [
          el('div', null, [
            el('p', { class: 'stock-received__title', text: x.title }),
            el('p', { class: 'small muted', text: x.creator_name + ' さん・' + EM.date(x.given_at) + (x.valid ? '' : '・いまはこのパスワードでは開けません') })
          ]),
          el('div', { class: 'page-links' }, [
            x.valid ? el('a', { class: 'btn btn--sm', href: url, target: '_blank', rel: 'noopener', text: '開く' }) : null,
            x.valid ? revealRow(function () { return sb.rpc('get_handover_password', { p_handover_id: x.handover_id }).then(function (r2) { if (r2.error) throw r2.error; return { password: (r2.data || {}).password }; }); }) : null,
            el('a', { class: 'btn btn--sm btn--ghost', href: '/messages/?t=' + x.thread_id, text: 'やりとり' })
          ])
        ]));
      });
      det.appendChild(el('p', { class: 'small muted', text: '開くには毎回パスワードが要ります。社内のほかの人に見せるときは、作品に守秘義務がないか確かめてからにしてください。' }));
      box.appendChild(det);
    });
  }

  EM.stockShare = { profile: profile, card: card, openGive: openGive, received: received };
})(window.EM);
