/* Eizo Maps — 案件と共有リンク
   自分で作った案件の一覧と、相手ごとの共有リンク（パスワード・見せる班・場所メモ・期限）を管理する。
   共有リンクの作成・変更・停止は、データベースの専用の処理（RPC）だけで行う。
   パスワードは画面にもデータベースからも読み戻せない（変えるときは新しく入れ直す）。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    var sprojects = [], evByProject = {}, lanesByProject = {};

    function pad(n) { return String(n).padStart(2, '0'); }
    function jpDate(s) { if (!s) return ''; var p = String(s).slice(0, 10).split('-'); return +p[0] + '/' + +p[1] + '/' + +p[2]; }
    function addDays(s, n) { var p = s.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function shareUrl(tok) { return location.origin + '/schedule/share.html?t=' + encodeURIComponent(tok); }

    EM.requireUser().then(function (u) {
      if (!u) return;
      EM.$('#projBody').hidden = false;
      EM.$('#newProjBtn').addEventListener('click', createProject);
      EM.$('#newProjName').addEventListener('keydown', function (e) { if (e.key === 'Enter') createProject(); });
      // ヘッダーの「＋ 追加 → 案件を作る」から来たときは、名前の欄にすぐ書けるようにする
      // 「＋ 案件を追加」で作る欄を開く（案件が1つもないとき・＋メニューから来たときは最初から開く）
      var addBtn = EM.$('#projAddBtn'), card = EM.$('#projNewCard');
      function openNew(focus) {
        card.hidden = false;
        addBtn.setAttribute('aria-expanded', 'true');
        addBtn.hidden = true;   // 開いている間は右上のボタンを隠す（同じボタンを2つ並べない）
        EM.$('#projEmpty').hidden = true;
        if (focus) setTimeout(function () { var n = EM.$('#newProjName'); n.scrollIntoView({ block: 'center' }); n.focus(); }, 50);
      }
      function closeNew() { card.hidden = true; addBtn.setAttribute('aria-expanded', 'false'); addBtn.hidden = false; EM.$('#projEmpty').hidden = !!EM.$('#projList').children.length; }
      addBtn.addEventListener('click', function () { if (card.hidden) openNew(true); else closeNew(); });
      EM.projOpenNew = openNew;
      if (EM.param('new') === '1') openNew(true);
      return load();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function load() {
      return sb.from('schedule_projects').select('id,name,created_at').order('created_at', { ascending: false }).limit(300)
        .then(function (r) {
          if (r.error) throw r.error;
          sprojects = r.data || [];
          if (!sprojects.length) return [{ data: [] }, { data: [] }];
          var ids = sprojects.map(function (p) { return p.id; });
          return sb.from('schedule_events').select('id,sched_project_id,starts_on,ends_on').in('sched_project_id', ids).limit(3000)
            .then(function (re) {
              var evs = re.data || [];
              var evIds = evs.map(function (e) { return e.id; });
              var q = evIds.length
                ? sb.from('schedule_items').select('event_id,lane').in('event_id', evIds.slice(0, 1000)).limit(5000)
                : Promise.resolve({ data: [] });
              return Promise.all([Promise.resolve({ data: evs }), q]);
            });
        })
        .then(function (rs) {
          evByProject = {}; lanesByProject = {};
          var evProj = {};
          (rs[0].data || []).forEach(function (e) {
            (evByProject[e.sched_project_id] = evByProject[e.sched_project_id] || []).push(e);
            evProj[e.id] = e.sched_project_id;
          });
          (rs[1].data || []).forEach(function (i) {
            var pid = evProj[i.event_id]; if (!pid) return;
            var l = (lanesByProject[pid] = lanesByProject[pid] || []);
            if (l.indexOf(i.lane) === -1) l.push(i.lane);
          });
          return render();
        })
        .catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function createProject() {
      var name = EM.$('#newProjName').value.trim();
      if (!name) { EM.notice(msg, '案件の名前を入れてください（例：◯◯CM）。', 'error'); return; }
      sb.from('schedule_projects').insert({ name: name }).then(function (r) {
        if (r.error) throw r.error;
        EM.$('#newProjName').value = '';
        EM.toast('案件を作りました');
        EM.$('#projNewCard').hidden = true;
        EM.$('#projAddBtn').setAttribute('aria-expanded', 'false');
        EM.$('#projAddBtn').hidden = false;
        EM.notice(msg, '');
        return load();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function render() {
      var box = EM.$('#projList');
      EM.clear(box);
      EM.$('#projEmpty').hidden = !!sprojects.length;
      return Promise.all(sprojects.map(function (p) {
        return sb.rpc('my_schedule_shares', { p_project_id: p.id }).then(function (r) {
          return { p: p, shares: (!r.error && r.data) || [] };
        });
      })).then(function (list) {
        list.forEach(function (x) { box.appendChild(projectCard(x.p, x.shares)); });
      });
    }

    function rangeText(pid) {
      var evs = evByProject[pid] || [];
      if (!evs.length) return '予定はまだありません';
      var s = evs.reduce(function (a, e) { return e.starts_on < a ? e.starts_on : a; }, evs[0].starts_on);
      var t = evs.reduce(function (a, e) { return e.ends_on > a ? e.ends_on : a; }, evs[0].ends_on);
      return '予定 ' + evs.length + '件（' + jpDate(s) + (s === t ? '' : '〜' + jpDate(t)) + '）';
    }
    function autoExpiry(pid) {
      var evs = evByProject[pid] || [];
      if (!evs.length) return null;
      var t = evs.reduce(function (a, e) { return e.ends_on > a ? e.ends_on : a; }, evs[0].ends_on);
      return addDays(t, 30);
    }

    function projectCard(p, shares) {
      var card = el('section', { class: 'card stack' });
      var formHost = el('div');

      var nameEl = el('h2', { text: p.name });
      card.appendChild(nameEl);
      card.appendChild(el('p', { class: 'small muted', text: rangeText(p.id) }));

      // 共有リンクの一覧
      if (shares.length) {
        var ul = el('div', { class: 'stack' });
        shares.forEach(function (s) { ul.appendChild(shareRow(p, s, formHost)); });
        card.appendChild(ul);
      } else {
        card.appendChild(el('p', { class: 'small muted', text: 'まだ共有リンクはありません。' }));
      }

      card.appendChild(el('div', { class: 'form-actions' }, [
        el('button', { type: 'button', class: 'btn btn--primary btn--sm', text: '＋ 共有リンクを作る',
          onclick: function () { openShareForm(formHost, p, null); } }),
        el('a', { class: 'btn btn--sm', href: '/schedule/', text: 'この案件に予定を入れる' }),
        el('button', { type: 'button', class: 'btn btn--sm', text: '名前を変える',
          onclick: function () { renameProject(p); } }),
        el('button', { type: 'button', class: 'btn btn--sm btn--danger', text: '案件を削除',
          onclick: function () { deleteProject(p); } })
      ]));
      card.appendChild(formHost);
      return card;
    }

    function statusOf(s) {
      if (s.revoked_at) return ['止めています', 'is-off'];
      if (s.effective_expiry && s.effective_expiry < today()) return ['期限切れ', 'is-off'];
      return ['使えます', 'is-on'];
    }

    function shareRow(p, s, formHost) {
      var st = statusOf(s);
      var scope = s.all_lanes ? '大枠＋全部の班' : (s.lanes.length ? '大枠＋' + s.lanes.join('・') : '大枠だけ');
      var exp = (s.expires_on ? jpDate(s.expires_on) + 'まで' : jpDate(s.effective_expiry) + 'まで（自動）');
      return el('div', { class: 'share-row' }, [
        el('div', { class: 'share-row__main' }, [
          el('p', { class: 'share-row__title' }, [
            el('strong', { text: s.label }),
            el('span', { class: 'tag share-row__st ' + st[1], text: st[0] })
          ]),
          el('p', { class: 'small muted', text: '見せる範囲：' + scope + ' ／ 場所・メモ：' + (s.show_details ? '見せる' : '見せない') }),
          el('p', { class: 'small muted', text: '期限：' + exp + ' ／ 開かれた回数：' + s.view_count + '回' +
            (s.last_viewed_at ? '（最後 ' + jpDate(s.last_viewed_at) + '）' : '') })
        ]),
        el('div', { class: 'form-actions' }, [
          el('button', { type: 'button', class: 'btn btn--sm', text: 'URL をコピー', onclick: function () { copy(shareUrl(s.token)); } }),
          el('button', { type: 'button', class: 'btn btn--sm', text: '設定を変える', onclick: function () { openShareForm(formHost, p, s); } }),
          el('button', { type: 'button', class: 'btn btn--sm' + (s.revoked_at ? '' : ' btn--danger'),
            text: s.revoked_at ? 'また使えるようにする' : '止める',
            onclick: function () { toggleStop(s); } })
        ])
      ]);
    }

    function copy(url) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { EM.toast('URL をコピーしました。パスワードは別に伝えてください'); },
          function () { EM.toast(url); });
      } else { EM.toast(url); }
    }

    function toggleStop(s) {
      var stop = !s.revoked_at;
      if (stop && !confirm('「' + s.label + '」のリンクを止めますか？\n止めると、このリンクからは見られなくなります（あとで戻せます）。')) return;
      sb.rpc('set_schedule_share_stopped', { p_share_id: s.id, p_stopped: stop }).then(function (r) {
        if (r.error) throw r.error;
        EM.toast(stop ? '止めました' : 'また使えるようにしました');
        return load();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function renameProject(p) {
      var name = prompt('新しい案件の名前（60文字まで）', p.name);
      if (name === null) return;
      name = name.trim();
      if (!name) return;
      sb.from('schedule_projects').update({ name: name }).eq('id', p.id).then(function (r) {
        if (r.error) throw r.error;
        return load();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    function deleteProject(p) {
      if (!confirm('案件「' + p.name + '」を削除しますか？\n予定そのものは消えず、「案件なし」になります。この案件の共有リンクはすべて使えなくなります。')) return;
      sb.from('schedule_projects').delete().eq('id', p.id).then(function (r) {
        if (r.error) throw r.error;
        EM.toast('削除しました');
        return load();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });
    }

    /* ---------- 共有リンクの作成・変更フォーム ---------- */
    function openShareForm(host, p, s) {
      EM.clear(host);
      var lanes = (lanesByProject[p.id] || []).slice();
      if (s) s.lanes.forEach(function (l) { if (lanes.indexOf(l) === -1) lanes.push(l); });
      var auto = autoExpiry(p.id);

      var label = el('input', { type: 'text', maxlength: '40', placeholder: '例：クライアント用', value: s ? s.label : '' });
      var pw = el('input', { type: 'password', maxlength: '72', autocomplete: 'new-password',
        placeholder: s ? '変えるときだけ入れてください' : '6文字以上' });
      var allR = el('input', { type: 'radio', name: 'scope', value: 'all' });
      var pickR = el('input', { type: 'radio', name: 'scope', value: 'pick' });
      if (s && s.all_lanes) allR.checked = true; else pickR.checked = true;
      var boxes = lanes.map(function (l) {
        var cb = el('input', { type: 'checkbox', value: l });
        if (s && s.lanes.indexOf(l) !== -1) cb.checked = true;
        return el('label', { class: 'checkbox' }, [cb, el('span', { text: l })]);
      });
      var lanePick = el('div', { class: 'stack share-form__lanes' }, boxes.length ? boxes
        : [el('p', { class: 'small muted', text: 'この案件にはまだ班（小枠の列）がありません。今は大枠だけが見えます。' })]);
      function syncScope() { lanePick.hidden = allR.checked; }
      allR.addEventListener('change', syncScope); pickR.addEventListener('change', syncScope);
      syncScope();

      var details = el('input', { type: 'checkbox' });
      if (s && s.show_details) details.checked = true;

      var autoR = el('input', { type: 'radio', name: 'exp', value: 'auto' });
      var dateR = el('input', { type: 'radio', name: 'exp', value: 'date' });
      var dateIn = el('input', { type: 'date', value: (s && s.expires_on) || '' });
      if (s && s.expires_on) dateR.checked = true; else autoR.checked = true;
      dateIn.addEventListener('focus', function () { dateR.checked = true; });

      var save = el('button', { type: 'button', class: 'btn btn--primary', text: s ? 'この設定で保存' : '共有リンクを作る' });
      var cancel = el('button', { type: 'button', class: 'btn btn--sm', text: '閉じる', onclick: function () { EM.clear(host); } });

      host.appendChild(el('div', { class: 'card stack share-form' }, [
        el('h3', { text: s ? '「' + s.label + '」の設定を変える' : '共有リンクを作る' }),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: 'リンクの名前（相手の呼び名）' }), label]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: 'パスワード' }), pw,
          el('span', { class: 'hint', text: 'パスワードは URL とは別の方法で伝えてください（例：URL はメール、パスワードは電話）。' })]),
        el('div', { class: 'field' }, [
          el('span', { class: 'label', text: '見せる範囲' }),
          el('p', { class: 'small muted', text: '大枠（例：撮影 6:00〜22:00）は、どのリンクでも必ず見えます。' }),
          el('label', { class: 'checkbox' }, [allR, el('span', { text: '全部の班（これから増える班も含む）' })]),
          el('label', { class: 'checkbox' }, [pickR, el('span', { text: '選んだ班だけ' })]),
          lanePick
        ]),
        el('label', { class: 'checkbox' }, [details, el('span', { text: '場所・メモも見せる（例：撮影部には集合場所を見せたいとき）' })]),
        el('div', { class: 'field' }, [
          el('span', { class: 'label', text: '期限' }),
          el('label', { class: 'checkbox' }, [autoR, el('span', { text: '案件の最後の日から30日後に自動で見られなくする' +
            (auto ? '（今だと ' + jpDate(auto) + 'まで）' : '（予定がまだないので、作った日から30日後）') })]),
          el('label', { class: 'checkbox' }, [dateR, el('span', { text: '日付を決める' })]),
          dateIn
        ]),
        el('div', { class: 'form-actions' }, [save, cancel])
      ]));
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });

      save.addEventListener('click', function () {
        var lbl = label.value.trim();
        if (!lbl) { EM.notice(msg, 'リンクの名前を入れてください（例：クライアント用）。', 'error'); return; }
        if (!s && pw.value.length < 6) { EM.notice(msg, 'パスワードは6文字以上で入れてください。', 'error'); return; }
        if (s && pw.value && pw.value.length < 6) { EM.notice(msg, 'パスワードは6文字以上で入れてください。', 'error'); return; }
        if (dateR.checked && !dateIn.value) { EM.notice(msg, '期限の日付を選んでください。', 'error'); return; }
        var picked = boxes.map(function (b) { return b.querySelector('input'); }).filter(function (c) { return c.checked; })
          .map(function (c) { return c.value; });
        var args = {
          p_label: lbl, p_password: pw.value || null,
          p_all_lanes: allR.checked, p_lanes: allR.checked ? [] : picked,
          p_show_details: details.checked, p_expires_on: dateR.checked ? dateIn.value : null
        };
        save.setAttribute('aria-busy', 'true');
        var q = s ? sb.rpc('update_schedule_share', Object.assign({ p_share_id: s.id }, args))
                  : sb.rpc('create_schedule_share', Object.assign({ p_project_id: p.id }, args));
        q.then(function (r) {
          if (r.error) throw r.error;
          EM.notice(msg, '');
          if (!s && r.data && r.data.token) {
            copy(shareUrl(r.data.token));
            EM.notice(msg, '共有リンクを作り、URL をコピーしました。パスワードは別の方法で伝えてください。', 'ok');
          } else {
            EM.toast('保存しました');
          }
          return load();
        }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); })
          .then(function () { save.removeAttribute('aria-busy'); });
      });
    }
  });
})(window.EM);
