/* Eizo Maps — マイページの「評価」
   ・あなたへの評価：公開中のものに異議申し立てができる（できるのはそれだけ）
   ・あなたが書いた評価：確認待ち、または異議申し立てがあったときだけ取り下げられる
   書き込みはすべてサーバー側の関数（object_to_review / withdraw_review）を通す。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var box = EM.$('#myReviews');
    if (!sb || !box) return;
    var msg = EM.$('#reviewMsg');

    var STATUS = {
      pending:   '運営が確認中',
      published: '公開中',
      rejected:  '運営の判断で掲載していません',
      withdrawn: '取り下げ済み',
      removed:   '運営が削除しました'
    };
    var OBJ = {
      open:      '異議申し立て中（運営が確認しています）',
      kept:      '異議申し立てあり・運営の確認により掲載継続',
      removed:   '異議申し立てにより運営が削除',
      withdrawn: '書いた人が取り下げ'
    };

    var me = null;
    EM.getUser().then(function (u) {
      if (!u) return;
      me = u;
      return load();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function load() {
      return Promise.all([
        sb.from('reviews')
          .select('id,score,comment,source,status,published_at,created_at,review_objections(id,status,reason,admin_note)')
          .eq('reviewee_id', me.id).in('status', ['published', 'removed'])
          .order('created_at', { ascending: false }),
        sb.from('reviews')
          .select('id,score,comment,source,status,published_at,created_at,reviewee_id,review_objections(id,status,reason)')
          .eq('reviewer_id', me.id)
          .order('created_at', { ascending: false })
      ]).then(function (res) {
        if (res[0].error) throw res[0].error;
        if (res[1].error) throw res[1].error;
        render(res[0].data || [], res[1].data || []);
      });
    }

    function objOf(r) {
      var o = r.review_objections;
      if (Array.isArray(o)) return o[0] || null;
      return o || null;
    }

    function head(r) {
      return el('div', { class: 'myreview__head' }, [
        el('span', { class: 'rating' }, [
          el('span', { class: 'stars', text: EM.stars(r.score) }),
          el('span', { class: 'count', text: Number(r.score).toFixed(1) })
        ]),
        el('span', { class: 'tags' }, [
          el('span', { class: 'tag', text: r.source === 'external' ? 'Eizo Maps外の取引（自己申告）' : 'Eizo Maps での取引' }),
          el('span', { class: 'tag tag--accent', text: STATUS[r.status] || r.status })
        ])
      ]);
    }

    function render(aboutMe, mine) {
      EM.clear(box);

      box.appendChild(el('h3', { text: 'あなたへの評価' }));
      box.appendChild(el('p', { class: 'small muted',
        text: '書かれた評価を消したり直したりはできません。事実と違う・不適切だと思う評価には、異議申し立てができます。異議申し立て中も評価は表示されたまま、「本人から異議申し立てあり」の印が付きます。' }));
      if (!aboutMe.length) box.appendChild(el('div', { class: 'empty', text: 'まだ評価はありません。' }));
      aboutMe.forEach(function (r) { box.appendChild(aboutMeCard(r)); });

      box.appendChild(el('hr', { class: 'divider' }));
      box.appendChild(el('h3', { text: 'あなたが書いた評価' }));
      box.appendChild(el('p', { class: 'small muted',
        text: '取り下げられるのは、運営が確認中の評価か、相手から異議申し立てがあった評価だけです。' }));
      if (!mine.length) box.appendChild(el('div', { class: 'empty', text: 'まだ評価を書いていません。' }));
      mine.forEach(function (r) { box.appendChild(mineCard(r)); });
    }

    function aboutMeCard(r) {
      var o = objOf(r);
      var card = el('div', { class: 'myreview' }, [
        head(r),
        el('p', { class: 'myreview__body small', text: r.comment }),
        el('p', { class: 'small muted', text: '公開日：' + (EM.date(r.published_at) || '—') })
      ]);
      if (o) {
        card.appendChild(el('p', { class: 'small' }, el('span', { class: 'tag tag--warn', text: OBJ[o.status] || o.status })));
        if (o.admin_note) card.appendChild(el('p', { class: 'small muted', text: '運営からのメモ：' + o.admin_note }));
        return card;
      }
      if (r.status !== 'published') return card;

      var btn = el('button', { class: 'btn btn--sm', type: 'button', text: '異議を申し立てる' });
      var form = el('div', { class: 'stack', hidden: true });
      var reason = el('textarea', { maxlength: '2000', rows: '4', placeholder: 'どこが事実と違うのか、なぜ不適切だと思うのか（10文字以上）' });
      var send = el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '運営に送る' });
      form.appendChild(el('label', { class: 'field' }, [el('span', { class: 'label', text: '異議申し立ての理由（運営と書いた人に届きます）' }), reason]));
      form.appendChild(el('p', { class: 'small muted', text: '運営が確認して、あまりにも不適切と判断した場合は削除します。削除しなかった場合は「運営の確認により掲載継続」の印が付いたまま公開されます。' }));
      form.appendChild(el('div', { class: 'form-actions' }, send));
      btn.addEventListener('click', function () { btn.hidden = true; form.hidden = false; });
      send.addEventListener('click', function () {
        var t = reason.value.trim();
        if (t.length < 10) { EM.notice(msg, '理由は10文字以上で書いてください。', 'error'); return; }
        if (!confirm('異議申し立ては1つの評価につき1回だけです。送ってよろしいですか？')) return;
        send.setAttribute('aria-busy', 'true');
        sb.rpc('object_to_review', { p_review_id: r.id, p_reason: t }).then(function (x) {
          if (x.error) throw x.error;
          EM.toast('異議申し立てを送りました');
          EM.notice(msg, '');
          return load();
        }).catch(function (err) {
          send.removeAttribute('aria-busy');
          EM.notice(msg, EM.errorText(err), 'error');
        });
      });
      card.appendChild(el('div', { class: 'form-actions' }, btn));
      card.appendChild(form);
      return card;
    }

    function mineCard(r) {
      var o = objOf(r);
      var card = el('div', { class: 'myreview' }, [
        head(r),
        el('p', { class: 'myreview__body small', text: r.comment })
      ]);
      if (o) {
        card.appendChild(el('p', { class: 'small' }, el('span', { class: 'tag tag--warn', text: OBJ[o.status] || o.status })));
        if (o.status === 'open') card.appendChild(el('p', { class: 'small muted', text: '相手からの理由：' + o.reason }));
      }
      var canWithdraw = r.status === 'pending' || (r.status === 'published' && o && o.status === 'open');
      if (canWithdraw) {
        var btn = el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: 'この評価を取り下げる' });
        btn.addEventListener('click', function () {
          if (!confirm('この評価を取り下げます。取り下げた評価は元に戻せません。よろしいですか？')) return;
          btn.setAttribute('aria-busy', 'true');
          sb.rpc('withdraw_review', { p_review_id: r.id }).then(function (x) {
            if (x.error) throw x.error;
            EM.toast('取り下げました');
            return load();
          }).catch(function (err) {
            btn.removeAttribute('aria-busy');
            EM.notice(msg, EM.errorText(err), 'error');
          });
        });
        card.appendChild(el('div', { class: 'form-actions' }, btn));
      }
      return card;
    }
  });
})(window.EM);
