/* Eizo Maps — クリエイターとのメッセージ（DM）
   ・/messages/?to=<クリエイターの番号> … そのクリエイターに送る（はじめてなら新しいやりとりができる）
   ・/messages/?t=<やりとりの番号> … そのやりとりを開く
   書き込みはすべてデータベースの関数（send_dm / reply_dm）を通す。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    if (!sb) return;
    var msg = EM.$('#pageMsg'), listBox = EM.$('#dmList'), threadBox = EM.$('#dmThread');
    var me = null, threads = [], current = null;

    EM.requireUser().then(function (u) {
      if (!u) return;
      me = u;
      return loadThreads().then(function () {
        var to = EM.param('to'), t = EM.param('t');
        if (t) { var hit = find(t); if (hit) return openThread(hit); }
        if (/^[0-9a-f-]{36}$/i.test(String(to || ''))) {
          var mine = threads.filter(function (x) { return x.creator_id === to && x.i_am === 'sender'; })[0];
          if (mine) return openThread(mine);
          return compose(to);
        }
        if (threads.length && window.innerWidth > 760) return openThread(threads[0]);
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function find(id) { return threads.filter(function (x) { return x.id === id; })[0]; }

    function loadThreads() {
      return sb.rpc('my_dm_threads').then(function (r) {
        if (r.error) throw r.error;
        threads = r.data || [];
        renderList();
      });
    }

    function renderList() {
      EM.clear(listBox);
      if (!threads.length) {
        listBox.appendChild(el('div', { class: 'empty', text: 'まだやりとりはありません。クリエイターのプロフィールの「メッセージを送る」から始められます。' }));
        return;
      }
      threads.forEach(function (x) {
        listBox.appendChild(el('button', {
          type: 'button', class: 'dm-item' + (current && current.id === x.id ? ' is-current' : '') + (x.unread ? ' is-unread' : ''),
          onclick: function () { openThread(x); }
        }, [
          el('span', { class: 'dm-item__top' }, [
            el('span', { class: 'dm-item__name', text: x.other_name }),
            el('span', { class: 'small muted', text: EM.date(x.last_message_at) })
          ]),
          el('span', { class: 'small muted dm-item__role', text: x.i_am === 'creator' ? 'あなた宛て（クリエイターとして受け取り）' : 'あなたが送った相手' }),
          el('span', { class: 'small dm-item__last', text: x.last_body || '' }),
          x.unread ? el('span', { class: 'nav-badge', text: '未読' }) : null
        ]));
      });
    }

    // はじめての相手に送る
    function compose(creatorId) {
      current = null;
      EM.clear(threadBox);
      threadBox.appendChild(el('p', { class: 'small muted', text: '読み込んでいます…' }));
      sb.from('creators').select('id,user_id,handle,display_name,headline').eq('id', creatorId).maybeSingle().then(function (r) {
        EM.clear(threadBox);
        var c = r && r.data;
        if (!c) { threadBox.appendChild(el('p', { class: 'small', text: 'このクリエイターには、いまメッセージを送れません。' })); return; }
        if (c.user_id === me.id) { threadBox.appendChild(el('p', { class: 'small', text: '自分にはメッセージを送れません。' })); return; }
        threadBox.appendChild(head(c.display_name, c.handle, c.headline));
        threadBox.appendChild(el('p', { class: 'small muted', text: 'はじめてのメッセージです。どんな映像を、いつごろ、どのくらいの予算で考えているかを書くと、返事がもらいやすくなります。' }));
        var ta = el('textarea', { rows: 7, maxlength: 2000, placeholder: '例：はじめまして。〇〇株式会社の山田です。来年2月に採用動画（90秒）を作りたく、ご相談できればと思いご連絡しました。撮影は都内で1日、予算は30万円前後を考えています。' });
        var btn = el('button', { class: 'btn btn--primary', type: 'button', text: '送る', onclick: function () {
          var v = ta.value.trim();
          if (!v) { EM.notice(msg, 'メッセージを書いてください。', 'error'); return; }
          btn.setAttribute('aria-busy', 'true');
          sb.rpc('send_dm', { p_creator_id: c.id, p_body: v }).then(function (r2) {
            btn.removeAttribute('aria-busy');
            if (r2.error) { EM.notice(msg, EM.errorText(r2.error), 'error'); return; }
            EM.notice(msg, ''); EM.toast('送りました');
            if (history.replaceState) history.replaceState(null, '', '/messages/?t=' + r2.data);
            loadThreads().then(function () { var hit = find(r2.data); if (hit) openThread(hit); });
          });
        } });
        threadBox.appendChild(el('div', { class: 'stack' }, [ta, el('div', { class: 'form-actions' }, btn)]));
      });
    }

    function head(name, handle, sub) {
      return el('div', { class: 'dm-head' }, [
        el('h2', { class: 'dm-head__name', text: name }),
        handle ? el('a', { class: 'small', href: '/@' + handle, text: '@' + handle + ' のプロフィール' }) : null,
        sub ? el('p', { class: 'small muted', text: sub }) : null
      ]);
    }

    function openThread(x) {
      current = x;
      renderList();
      if (history.replaceState) history.replaceState(null, '', '/messages/?t=' + x.id);
      EM.clear(threadBox);
      threadBox.appendChild(head(x.other_name, x.other_handle, x.i_am === 'creator' ? 'あなた（クリエイター）宛てのメッセージです' : null));
      var log = el('div', { class: 'dm-log' });
      threadBox.appendChild(log);
      return sb.from('dm_messages').select('id,sender_id,body,created_at').eq('thread_id', x.id).order('created_at').limit(500).then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        (r.data || []).forEach(function (m) {
          var mine = m.sender_id === me.id;
          log.appendChild(el('div', { class: 'dm-msg' + (mine ? ' is-mine' : '') }, [
            el('p', { class: 'dm-msg__body pre', text: m.body }),
            el('p', { class: 'small muted', text: (mine ? 'あなた' : x.other_name) + '・' + EM.datetime(m.created_at) })
          ]));
        });
        log.scrollTop = log.scrollHeight;
        if (x.unread) sb.rpc('mark_dm_read', { p_thread_id: x.id }).then(function () { x.unread = false; renderList(); });

        var ta = el('textarea', { rows: 4, maxlength: 2000, placeholder: '返事を書く' });
        var btn = el('button', { class: 'btn btn--primary', type: 'button', text: '送る', onclick: function () {
          var v = ta.value.trim();
          if (!v) return;
          btn.setAttribute('aria-busy', 'true');
          sb.rpc('reply_dm', { p_thread_id: x.id, p_body: v }).then(function (r2) {
            btn.removeAttribute('aria-busy');
            if (r2.error) { EM.notice(msg, EM.errorText(r2.error), 'error'); return; }
            EM.notice(msg, '');
            loadThreads().then(function () { var hit = find(x.id); openThread(hit || x); });
          });
        } });
        var tools = [btn];
        if (x.i_am === 'creator') {
          tools.push(el('button', { class: 'btn btn--sm btn--ghost', type: 'button',
            text: x.blocked ? 'この人からまた受け取る' : 'この人から受け取らない',
            onclick: function () {
              if (!x.blocked && !confirm(x.other_name + ' さんからのメッセージを受け取らないようにしますか？\n相手には知らせません。相手は新しいメッセージを送れなくなります。')) return;
              sb.rpc('block_dm', { p_thread_id: x.id, p_blocked: !x.blocked }).then(function (r3) {
                if (r3.error) { EM.notice(msg, EM.errorText(r3.error), 'error'); return; }
                EM.toast(x.blocked ? 'また受け取るようにしました' : '受け取らないようにしました');
                loadThreads().then(function () { var hit = find(x.id); if (hit) openThread(hit); });
              });
            } }));
        }
        if (x.blocked) threadBox.appendChild(el('p', { class: 'notice notice--warn small', text: 'この人からのメッセージは受け取らない設定です。' }));
        threadBox.appendChild(el('div', { class: 'stack dm-reply' }, [ta, el('div', { class: 'form-actions' }, tools)]));
      });
    }
  });
})(window.EM);
