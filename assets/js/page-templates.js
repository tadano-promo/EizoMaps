/* Eizo Maps — 定型文のひな形
   ・本文の中の {案件名} のような { } の部分が「差し替え項目」になる
   ・差し替え項目を入れると、右の完成文にその場で反映。まだ入っていない項目を数える
   ・送る前のチェック（例：集合場所・連絡先）を押して確かめてからコピーできる
   ・ひな形は本人だけが読める（データベースの決まり）。入れた中身（日時や名前）は保存しない */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    // はじめから用意しているおすすめのひな形（「これを使う」で自分のひな形にコピーされる）
    var STARTERS = [
      { name: '撮影の集合案内', category: '案内',
        body: '{相手の名前}さん\n\nお疲れさまです。{自分の名前}です。\n{案件名}の撮影について、集合のご案内です。\n\n■日にち：{撮影日}\n■集合時間：{集合時間}\n■集合場所：{集合場所}\n■終了予定：{終了予定}\n■持ち物：{持ち物}\n\n当日の連絡先：{連絡先}\n雨の場合は、前日の{雨の判断時間}までにご連絡します。\nどうぞよろしくお願いいたします。',
        checks: ['集合場所の地図リンク', '当日の連絡先', '持ち物', '雨の場合の連絡方法'] },
      { name: '香盤表を送ります', category: '連絡',
        body: '{相手の名前}さん\n\nお疲れさまです。{自分の名前}です。\n{案件名}（{撮影日}撮影）の香盤表をお送りします。\n\n{共有リンクのURL}\n\nパスワードは別のメッセージでお送りします。\n変更があれば、この連絡にご返信ください。\nよろしくお願いいたします。',
        checks: ['リンクを自分で開いて確認', 'パスワードは別で送る', '見られる期限'] },
      { name: '納品のご連絡', category: '連絡',
        body: '{相手の名前}様\n\nいつもお世話になっております。{自分の名前}です。\n{案件名}の納品データをお送りします。\n\n■納品物：{納品物}\n■データの場所：{データのURL}\n■ダウンロード期限：{ダウンロード期限}\n\nご確認のうえ、修正点があれば{修正の締め切り}までにお知らせください。\n引き続きよろしくお願いいたします。',
        checks: ['書き出しの設定（尺・サイズ）', 'ファイル名', 'リンクの共有設定', 'ダウンロード期限'] },
      { name: '撮影のお礼', category: 'お礼',
        body: '{相手の名前}さん\n\n{撮影日}の{案件名}の撮影、お疲れさまでした。{自分の名前}です。\nおかげさまで無事に撮り終えることができました。ありがとうございました。\n\nこのあとは{このあとの流れ}の予定です。\n引き続きよろしくお願いいたします。',
        checks: ['このあとの流れ'] },
      { name: 'ご請求のご連絡', category: '請求',
        body: '{相手の名前}様\n\nいつもお世話になっております。{自分の名前}です。\n{案件名}のご請求書をお送りします。\n\n■ご請求金額：{金額}（税込）\n■お支払い期限：{支払い期限}\n■請求書：{請求書のURL}\n\nご確認のほど、よろしくお願いいたします。',
        checks: ['金額が見積もりと合っているか', '振込先', 'お支払い期限'] }
    ];
    var CATS = ['案内', '連絡', 'お礼', '請求', 'その他'];
    var COMMON_FIELDS = ['相手の名前', '自分の名前', '案件名', '撮影日', '集合時間', '集合場所', '連絡先', 'URL'];

    var me = null, myName = '', list = [], current = null, catFilter = '', editing = false;
    var values = {};       // 差し替え項目に入れた中身（ひな形ごと・この画面の中だけ）
    var checked = {};      // 送る前のチェック（ひな形ごと・この画面の中だけ）
    var upcoming = [], spNames = {};
    var bar = null;

    EM.requireUser().then(function (u) {
      if (!u) return;
      me = u;
      EM.$('#tplBody').hidden = false;
      EM.$('#tplNewBtn').addEventListener('click', createBlank);
      var t = EM.today();
      return Promise.all([
        sb.from('message_templates').select('id,name,category,body,checks,updated_at').order('updated_at', { ascending: false }).limit(200),
        sb.from('creators').select('display_name').eq('user_id', u.id).maybeSingle(),
        sb.from('schedule_events').select('id,kind,title,starts_on,ends_on,start_time,end_time,location,sched_project_id')
          .eq('owner_user_id', u.id).gte('ends_on', EM.addDays(t, -14)).lte('starts_on', EM.addDays(t, 90)).order('starts_on').limit(60),
        sb.from('schedule_projects').select('id,name').limit(500)
      ]).then(function (r) {
        if (r[0].error) throw r[0].error;
        list = r[0].data || [];
        myName = (r[1].data && r[1].data.display_name) || '';
        upcoming = r[2].data || [];
        (r[3].data || []).forEach(function (p) { spNames[p.id] = p.name; });
        var want = EM.param('id');
        current = list.filter(function (x) { return x.id === want; })[0] || list[0] || null;
        renderSide();
        if (EM.param('new') === '1') createBlank();
        else renderMain();
      });
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    /* ---------------- 差し替え項目 ---------------- */
    function fieldsOf(body) {
      var out = [], seen = {}, re = /\{([^{}\n]{1,20})\}/g, m;
      while ((m = re.exec(String(body || '')))) { var k = m[1].trim(); if (k && !seen[k]) { seen[k] = 1; out.push(k); } }
      return out;
    }
    function fieldType(name) {
      if (/URL|ＵＲＬ|リンク/i.test(name)) return 'url';
      if (/時間|時刻/.test(name)) return 'time';
      if (/日$|日にち|日付|期限|締め切り|締切/.test(name)) return 'date';
      if (/持ち物|メモ|内容|流れ/.test(name)) return 'multi';
      return 'text';
    }
    function fmtValue(name, v) {
      if (!v) return '';
      var t = fieldType(name);
      if (t === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return EM.mdw(v);
      if (t === 'time' && /^\d{2}:\d{2}/.test(v)) return String(+v.slice(0, 2)) + ':' + v.slice(3, 5);
      return v;
    }
    function compose(tpl) {
      var vals = values[tpl.id] || {};
      return String(tpl.body || '').replace(/\{([^{}\n]{1,20})\}/g, function (all, k) {
        var f = fmtValue(k.trim(), vals[k.trim()]);
        return f ? f : all;
      });
    }
    function missing(tpl) {
      var vals = values[tpl.id] || {};
      return fieldsOf(tpl.body).filter(function (k) { return !vals[k]; });
    }

    /* ---------------- 左：一覧 ---------------- */
    function renderSide() {
      var cats = EM.$('#tplCats');
      EM.clear(cats);
      var used = {};
      list.forEach(function (x) { used[x.category] = (used[x.category] || 0) + 1; });
      EM.$('#tplListTitle').textContent = 'ひな形の一覧（' + list.length + '）';
      if (list.length) {
        [''].concat(Object.keys(used)).forEach(function (c) {
          var b = el('button', { type: 'button', class: 'chip', 'aria-pressed': catFilter === c ? 'true' : 'false', text: c || 'すべて' });
          b.addEventListener('click', function () { catFilter = c; renderSide(); });
          cats.appendChild(b);
        });
      }
      var ul = EM.$('#tplList');
      EM.clear(ul);
      list.filter(function (x) { return !catFilter || x.category === catFilter; }).forEach(function (x) {
        var n = fieldsOf(x.body).length;
        var a = el('button', { type: 'button', class: 'tpl__item' + (current && current.id === x.id ? ' is-active' : '') }, [
          el('span', { class: 'tpl__iname', text: x.name }),
          el('span', { class: 'tpl__imeta small muted', text: x.category + '・差し替え ' + n + '項目' })
        ]);
        a.addEventListener('click', function () { select(x); });
        ul.appendChild(el('li', null, a));
      });
      if (!list.length) ul.appendChild(el('li', { class: 'small muted tpl__empty', text: 'まだひな形がありません。下のおすすめから選ぶか、「＋ ひな形を追加」で作れます。' }));

      // おすすめ（まだ同じ名前のひな形を持っていないものだけ）
      var st = EM.$('#tplStarters');
      EM.clear(st);
      var names = {};
      list.forEach(function (x) { names[x.name] = 1; });
      var rest = STARTERS.filter(function (s) { return !names[s.name]; });
      if (!rest.length) return;
      st.appendChild(el('p', { class: 'tpl__sttitle', text: 'おすすめのひな形' }));
      rest.forEach(function (s) {
        var b = el('button', { type: 'button', class: 'btn btn--sm', text: 'これを使う' });
        b.addEventListener('click', function () { b.setAttribute('aria-busy', 'true'); insert(s).then(function () { b.removeAttribute('aria-busy'); }); });
        st.appendChild(el('div', { class: 'tpl__st' }, [
          el('div', { class: 'tpl__stinfo' }, [el('span', { class: 'tpl__iname', text: s.name }), el('span', { class: 'small muted', text: s.category + '・差し替え ' + fieldsOf(s.body).length + '項目' })]),
          b
        ]));
      });
    }

    function select(x) {
      if (editing && bar && bar.isDirty() && !confirm('保存していない変更があります。保存せずにほかのひな形を開きますか？')) return;
      current = x; editing = false;
      hideBar();
      try { history.replaceState(null, '', '/templates/?id=' + encodeURIComponent(x.id)); } catch (e) { /* なし */ }
      renderSide(); renderMain();
      if (window.innerWidth < 900) EM.$('#tplMain').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function insert(s) {
      return sb.from('message_templates').insert({ name: s.name, category: s.category, body: s.body, checks: s.checks || [] })
        .select('id,name,category,body,checks,updated_at').single().then(function (r) {
          if (r.error) throw r.error;
          list.unshift(r.data);
          current = r.data;
          renderSide(); renderMain();
          EM.toast('「' + r.data.name + '」を追加しました。');
          return r.data;
        }).catch(function (e) { EM.toast(EM.errorText(e)); });
    }
    function createBlank() {
      insert({ name: '新しいひな形', category: 'その他', body: '{相手の名前}さん\n\nお疲れさまです。{自分の名前}です。\n\n', checks: [] }).then(function (x) {
        if (x) { editing = true; renderMain(); }
      });
    }

    /* ---------------- 右：使う画面 ---------------- */
    function renderMain() {
      var box = EM.$('#tplMain');
      EM.clear(box);
      if (!current) {
        box.appendChild(el('div', { class: 'tpl__placeholder' }, [
          EM.icon('doc', 'tpl__bigico'),
          el('p', { class: 'muted', text: '左の一覧からひな形を選ぶと、ここで中身を入れて完成文を作れます。' })
        ]));
        return;
      }
      if (editing) { renderEdit(box); return; }
      var tpl = current;
      values[tpl.id] = values[tpl.id] || {};
      checked[tpl.id] = checked[tpl.id] || {};
      var vals = values[tpl.id];
      if (myName && !vals['自分の名前'] && fieldsOf(tpl.body).indexOf('自分の名前') !== -1) vals['自分の名前'] = myName;

      var editBtn = el('button', { type: 'button', class: 'btn btn--sm' }, [EM.icon('edit'), el('span', { text: ' 編集' })]);
      editBtn.addEventListener('click', function () { editing = true; renderMain(); });
      box.appendChild(el('div', { class: 'tpl__head' }, [
        el('div', null, [el('h2', { class: 'tpl__name', text: tpl.name }), el('p', { class: 'small muted', text: tpl.category + (tpl.updated_at ? '・最終保存 ' + EM.datetime(tpl.updated_at) : '') })]),
        editBtn
      ]));

      var fields = fieldsOf(tpl.body);
      var cols = el('div', { class: 'tpl__cols' });
      var left = el('div', { class: 'tpl__fields' });
      var right = el('div', { class: 'tpl__preview' });
      cols.appendChild(left); cols.appendChild(right);
      box.appendChild(cols);

      // 予定から入れる
      if (upcoming.length && fields.length) {
        var pick = el('select', { 'aria-label': '予定から入れる' }, [el('option', { value: '', text: '予定から入れる…' })].concat(upcoming.map(function (e, i) {
          return el('option', { value: String(i), text: EM.mdw(e.starts_on) + ' ' + e.title + (e.sched_project_id && spNames[e.sched_project_id] ? '（' + spNames[e.sched_project_id] + '）' : '') });
        })));
        pick.addEventListener('change', function () {
          var e = upcoming[+pick.value];
          if (!e) return;
          fields.forEach(function (k) {
            if (/案件/.test(k)) vals[k] = (e.sched_project_id && spNames[e.sched_project_id]) || e.title;
            else if (/撮影日|日にち|日付|^日$/.test(k)) vals[k] = e.starts_on;
            else if (/集合時間|開始/.test(k) && e.start_time) vals[k] = e.start_time.slice(0, 5);
            else if (/終了/.test(k) && e.end_time) vals[k] = fieldType(k) === 'time' ? e.end_time.slice(0, 5) : String(+e.end_time.slice(0, 2)) + ':' + e.end_time.slice(3, 5);
            else if (/場所/.test(k) && e.location) vals[k] = e.location;
          });
          renderMain();
        });
        left.appendChild(el('label', { class: 'field tpl__pick' }, [el('span', { class: 'label', text: '予定から入れる' }), pick, el('span', { class: 'hint', text: '案件名・日にち・時間・場所が分かるところだけ入ります。' })]));
      }

      left.appendChild(el('p', { class: 'tpl__sub' }, [el('b', { text: '差し替え内容' }), el('span', { class: 'small muted', text: fields.length + '項目' })]));
      if (!fields.length) left.appendChild(el('p', { class: 'small muted', text: '差し替え項目はありません。「編集」で本文に {案件名} のように { } で囲んだ言葉を入れると、ここに入力欄が出ます。' }));
      var preview = el('textarea', { class: 'tpl__text', rows: '16', 'aria-label': '完成文' });
      var counter = el('span', { class: 'tpl__count small mono' });
      var miss = el('span', { class: 'tpl__miss small' });
      function refresh() {
        preview.value = compose(tpl);
        counter.textContent = preview.value.length + '文字';
        var m = missing(tpl).length;
        miss.textContent = m ? '未入力 ' + m + '件' : 'すべて入力済み';
        miss.classList.toggle('is-warn', m > 0);
      }
      fields.forEach(function (k) {
        var t = fieldType(k);
        var input = t === 'multi' ? el('textarea', { rows: '2', maxlength: '400' }) :
          el('input', { type: t === 'date' ? 'date' : t === 'time' ? 'time' : t === 'url' ? 'url' : 'text', maxlength: '400' });
        input.value = vals[k] || '';
        input.addEventListener('input', function () { vals[k] = input.value; refresh(); });
        left.appendChild(el('label', { class: 'field tpl__field' }, [el('span', { class: 'label', text: k }), input]));
      });

      right.appendChild(el('p', { class: 'tpl__sub' }, [el('b', { text: '完成文' }), el('span', { class: 'tpl__stat' }, [counter, miss])]));
      right.appendChild(preview);
      right.appendChild(el('p', { class: 'hint small muted', text: 'ここで直接書き直してからコピーもできます（差し替え内容を変えると作り直されます）。' }));

      // 送る前のチェック
      var cks = tpl.checks || [];
      var ckState = checked[tpl.id];
      var ckCount = el('span', { class: 'small muted mono' });
      function paintCk() { var n = cks.filter(function (c) { return ckState[c]; }).length; ckCount.textContent = n + ' / ' + cks.length; }
      if (cks.length) {
        right.appendChild(el('p', { class: 'tpl__sub' }, [el('b', { text: '送る前のチェック' }), ckCount]));
        right.appendChild(el('div', { class: 'chips' }, cks.map(function (c) {
          var b = el('button', { type: 'button', class: 'chip tpl__ck', 'aria-pressed': ckState[c] ? 'true' : 'false' }, [el('span', { class: 'tpl__ckmark', text: ckState[c] ? '✓' : '' }), el('span', { text: c })]);
          b.addEventListener('click', function () { ckState[c] = !ckState[c]; b.setAttribute('aria-pressed', ckState[c] ? 'true' : 'false'); b.firstChild.textContent = ckState[c] ? '✓' : ''; paintCk(); });
          return b;
        })));
        paintCk();
      }

      var copy = el('button', { type: 'button', class: 'btn btn--primary tpl__copy' }, [EM.icon('copy'), el('span', { text: ' 完成文をコピー' })]);
      var clear = el('button', { type: 'button', class: 'btn btn--sm', text: '入れた中身を消す' });
      clear.addEventListener('click', function () { values[tpl.id] = {}; checked[tpl.id] = {}; renderMain(); });
      copy.addEventListener('click', function () {
        var text = preview.value;
        var m = missing(tpl).length, rest = cks.filter(function (c) { return !ckState[c]; }).length;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
          var warn = [];
          if (m) warn.push('未入力が' + m + '件');
          if (rest) warn.push('チェックが' + rest + '件');
          EM.toast(warn.length ? 'コピーしました（' + warn.join('・') + '残っています）' : 'コピーしました。');
        }).catch(function () { preview.focus(); preview.select(); EM.toast('自動でコピーできませんでした。選んだ状態にしたので、そのままコピーしてください。'); });
      });
      box.appendChild(el('div', { class: 'tpl__actions' }, [clear, copy]));
      refresh();
    }

    /* ---------------- 右：編集する画面（下の「保存する」1つでまとめて保存） ---------------- */
    function renderEdit(box) {
      var tpl = current;
      var name = el('input', { type: 'text', maxlength: '40', required: true });
      name.value = tpl.name;
      var cat = el('input', { type: 'text', maxlength: '20', list: 'tplCatList' });
      cat.value = tpl.category;
      var dl = el('datalist', { id: 'tplCatList' }, CATS.map(function (c) { return el('option', { value: c }); }));
      var body = el('textarea', { rows: '14', maxlength: '4000', class: 'tpl__src' });
      body.value = tpl.body;
      var found = el('p', { class: 'small muted tpl__found' });
      function paintFound() { var f = fieldsOf(body.value); found.textContent = f.length ? '差し替え項目：' + f.join('・') : '差し替え項目はまだありません。'; }
      body.addEventListener('input', paintFound);
      var ins = el('div', { class: 'chips tpl__ins' }, COMMON_FIELDS.map(function (k) {
        var b = el('button', { type: 'button', class: 'chip', text: '{' + k + '}' });
        b.addEventListener('click', function () {
          var s = body.selectionStart || body.value.length, e2 = body.selectionEnd || s, tag = '{' + k + '}';
          body.value = body.value.slice(0, s) + tag + body.value.slice(e2);
          body.focus(); body.selectionStart = body.selectionEnd = s + tag.length;
          paintFound(); if (bar) bar.markDirty();
        });
        return b;
      }));

      var ckBox = el('div', { class: 'tpl__cklist' });
      var ckInputs = [];
      function addCk(v) {
        if (ckInputs.length >= 12) { EM.toast('チェックは12個までです。'); return; }
        var i = el('input', { type: 'text', maxlength: '30', placeholder: '例：集合場所の地図リンク' });
        i.value = v || '';
        var del = el('button', { type: 'button', class: 'todo__del', 'aria-label': 'このチェックを消す', text: '✕' });
        var row = el('div', { class: 'tpl__ckrow' }, [i, del]);
        del.addEventListener('click', function () { ckInputs.splice(ckInputs.indexOf(i), 1); row.remove(); if (bar) bar.markDirty(); });
        i.addEventListener('input', function () { if (bar) bar.markDirty(); });
        ckInputs.push(i); ckBox.appendChild(row);
        return i;
      }
      (tpl.checks || []).forEach(addCk);
      var addCkBtn = el('button', { type: 'button', class: 'btn btn--sm', text: '＋ チェックを足す' });
      addCkBtn.addEventListener('click', function () { var i = addCk(''); if (i) { i.focus(); if (bar) bar.markDirty(); } });

      var back = el('button', { type: 'button', class: 'btn btn--sm', text: '← 使う画面に戻る' });
      back.addEventListener('click', function () {
        if (bar && bar.isDirty() && !confirm('保存していない変更があります。保存せずに戻りますか？')) return;
        editing = false; hideBar(); renderMain();
      });
      var del = el('button', { type: 'button', class: 'btn btn--sm btn--danger', text: 'このひな形を消す' });
      del.addEventListener('click', function () {
        if (!confirm('「' + tpl.name + '」を消します。元に戻せません。よろしいですか？')) return;
        sb.from('message_templates').delete().eq('id', tpl.id).then(function (r) {
          if (r.error) throw r.error;
          list = list.filter(function (x) { return x.id !== tpl.id; });
          current = list[0] || null; editing = false;
          if (bar) bar.reset(); hideBar();
          renderSide(); renderMain();
          EM.toast('消しました。');
        }).catch(function (e) { EM.toast(EM.errorText(e)); });
      });

      box.appendChild(el('div', { class: 'tpl__head' }, [el('h2', { class: 'tpl__name', text: 'ひな形を編集' }), back]));
      box.appendChild(el('div', { class: 'row' }, [
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '名前（40文字まで）' }), name]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '分類（例：案内・連絡・お礼・請求）' }), cat, dl])
      ]));
      box.appendChild(el('label', { class: 'field' }, [
        el('span', { class: 'label', text: '本文（4,000文字まで）' }),
        body,
        el('span', { class: 'hint', text: '差し替えたいところを {案件名} のように { } で囲みます。名前に「日」「期限」が入ると日付の欄、「時間」が入ると時刻の欄になります。' })
      ]));
      box.appendChild(el('p', { class: 'small muted', text: 'よく使う差し替え項目（押すと本文に入ります）' }));
      box.appendChild(ins);
      box.appendChild(found);
      box.appendChild(el('p', { class: 'tpl__sub' }, [el('b', { text: '送る前のチェック' }), el('span', { class: 'small muted', text: '12個まで・1つ30文字まで' })]));
      box.appendChild(ckBox);
      box.appendChild(addCkBtn);
      box.appendChild(el('div', { class: 'tpl__danger' }, del));
      paintFound();

      showBar({
        watch: [name, cat, body],
        savedAt: tpl.updated_at,
        onSave: function () {
          var nv = name.value.trim(), cv = cat.value.trim() || 'その他';
          if (!nv) { EM.toast('名前を入れてください。'); name.focus(); return Promise.resolve(false); }
          var checks = ckInputs.map(function (i) { return i.value.trim(); }).filter(Boolean);
          return sb.from('message_templates').update({ name: nv, category: cv, body: body.value, checks: checks })
            .eq('id', tpl.id).select('id,name,category,body,checks,updated_at').single().then(function (r) {
              if (r.error) throw r.error;
              for (var i = 0; i < list.length; i++) if (list[i].id === tpl.id) list[i] = r.data;
              current = r.data;
              renderSide();
              return r.data.updated_at;
            });
        }
      });
    }

    // 保存バーは編集しているときだけ出す
    var barOpts = null;
    function showBar(opts) {
      barOpts = opts;
      if (!bar) {
        bar = EM.saveBar({ watch: [], savedAt: opts.savedAt, onSave: function () { return barOpts.onSave(); } });
      }
      var node = EM.$('.savebar');
      if (node) node.hidden = false;
      document.body.classList.add('has-savebar');
      bar.reset(opts.savedAt);
      opts.watch.forEach(function (n) { n.addEventListener('input', bar.markDirty); n.addEventListener('change', bar.markDirty); });
    }
    function hideBar() {
      if (!bar) return;
      bar.reset();
      var node = EM.$('.savebar');
      if (node) node.hidden = true;
      document.body.classList.remove('has-savebar');
    }
  });
})(window.EM);
