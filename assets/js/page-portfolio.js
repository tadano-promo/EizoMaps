/* Eizo Maps — ポートフォリオ管理と共有リンク */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) { return; }  // 未設定の案内はヘッダー直下に共通表示される

    var creator = null, user = null, items = [], links = [], takedowns = [], parsed = null, pickedTags = [];

    // 作品の見せ方（作品棚）
    var VIS = [
      ['public',     '誰でも見られる（プロフィールに表示）'],
      ['link_only',  '限定リンクのみ'],
      ['stock_only', 'パスワードページだけ']
    ];
    /* ---------- クライアントに見せる情報（担当・目的・業種・尺・取引先） ---------- */
    var PURPOSES = ['広告・CM', '会社・ブランド紹介', '採用', '商品・サービス紹介', 'SNS用', 'イベント', '研修・マニュアル', 'MV・エンタメ', 'ドキュメンタリー', 'その他'];
    // 業種（2026-11-19 翠くん「業種すくなくない？」。電通さん「日本の広告費」の21業種をもとに、映像の仕事で多いものを足してまとめた）
    // 前からある17個の名前は変えない（入れてある作品がそのまま使えるように）。DBの決まりは 071 と同じ
    var INDUSTRIES = [
      ['暮らしの商品', ['食品・飲料', '酒類', '化粧品・美容', '日用品・トイレタリー', '医薬品・ヘルスケア', 'ファッション', '家電・AV機器', '家具・インテリア', '趣味・スポーツ用品・おもちゃ', 'ゲーム・アプリ']],
      ['乗り物・住まい・おでかけ', ['自動車', '交通・旅行・ホテル', 'テーマパーク・レジャー', '不動産・住宅']],
      ['お店・サービス', ['飲食', '小売・EC', '美容室・サロン', 'ブライダル・冠婚葬祭', '保険・金融', 'IT・通信', '人材', '教育', '医療・介護', '士業・コンサル']],
      ['会社・団体', ['製造・BtoB', '建設', 'エネルギー・インフラ', '行政・自治体', '団体・NPO']],
      ['エンタメ・メディア', ['エンタメ・音楽', '映画・アニメ', 'スポーツ（チーム・大会）', '出版・メディア', 'VTuber・配信者']],
      ['', ['その他']]
    ];
    function selectOf(list, value, aria) {
      var s = el('select', { 'aria-label': aria }, [el('option', { value: '', text: '未設定' })]);
      list.forEach(function (v) {
        if (Array.isArray(v)) {  // [まとまりの名前, [項目…]]
          var opts = v[1].map(function (x) { return el('option', { value: x, text: x, selected: x === value }); });
          if (v[0]) s.appendChild(el('optgroup', { label: v[0] }, opts)); else opts.forEach(function (o) { s.appendChild(o); });
        } else s.appendChild(el('option', { value: v, text: v, selected: v === value }));
      });
      return s;
    }
    function detailEditor(p) {
      p = p || {};
      var role = el('input', { type: 'text', maxlength: 100, value: p.role || '', placeholder: '例：撮影・カラー（企画・編集は制作会社さん）' });
      var purpose = selectOf(PURPOSES, p.purpose, '目的');
      var industry = selectOf(INDUSTRIES, p.industry, '業種');
      // 媒体（TVCM・映画・ドラマ・バラエティ・MV・企業VP など）。大きな分け方ごとにまとめて出す
      var media = el('select', { 'aria-label': '媒体' }, [el('option', { value: '', text: '未設定' })]);
      (EM.MEDIA || []).forEach(function (g) {
        media.appendChild(el('optgroup', { label: g[0] }, g[1].map(function (v) { return el('option', { value: v, text: v, selected: v === p.media }); })));
      });
      var len = el('input', { type: 'text', maxlength: 30, value: p.length_label || '', placeholder: '例：90秒＋縦型15秒×3本' });
      var year = el('input', { type: 'number', min: 1950, max: 2100, step: 1, value: p.work_year || '', placeholder: '例：2026' });
      var credits = el('textarea', { rows: 2, maxlength: 500, placeholder: '例：代理店：〇〇／制作会社：〇〇／監督：〇〇／撮影：〇〇' });
      credits.value = p.credits || '';
      var disp = el('select', { 'aria-label': '取引先名の出し方' }, [
        el('option', { value: 'hidden', text: '出さない' }),
        el('option', { value: 'industry', text: '業種だけ出す（例：食品・飲料の企業）' }),
        el('option', { value: 'named', text: '社名を出す（掲載の許可がある場合だけ）' })
      ]);
      disp.value = p.client_display || 'hidden';
      var name = el('input', { type: 'text', maxlength: 60, value: p.client_name || '', placeholder: '例：株式会社〇〇' });
      var nameField = el('label', { class: 'field' }, [el('span', { class: 'label', text: '取引先の社名' }), name,
        el('span', { class: 'hint', text: '社名を出してよいと言われている場合だけ入れてください。「出さない」「業種だけ」にすると、入れた社名は保存されません。' })]);
      function sync() { nameField.hidden = disp.value !== 'named'; }
      disp.addEventListener('change', sync); sync();
      var node = el('div', { class: 'stack' }, [
        el('label', { class: 'field' }, [el('span', { class: 'label', text: 'あなたの担当 ' }, el('span', { class: 'muted', text: '（100文字まで）' })), role]),
        el('div', { class: 'row' }, [
          el('label', { class: 'field' }, [el('span', { class: 'label', text: '媒体' }), media]),
          el('label', { class: 'field' }, [el('span', { class: 'label', text: '目的' }), purpose]),
          el('label', { class: 'field' }, [el('span', { class: 'label', text: '業種' }), industry]),
          el('label', { class: 'field' }, [el('span', { class: 'label', text: '尺・本数' }), len]),
          el('label', { class: 'field' }, [el('span', { class: 'label', text: '年' }), year])
        ]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: 'ほかのスタッフ（クレジット） ' }, el('span', { class: 'muted', text: '（500文字まで）' })), credits,
          el('span', { class: 'hint', text: '作品の全画面の表示で「ほかのスタッフ」として出ます。名前を出してよい人だけ書いてください。' })]),
        el('label', { class: 'field' }, [el('span', { class: 'label', text: '取引先名の出し方' }), disp]),
        nameField
      ]);
      return {
        node: node,
        value: function () {
          var d = disp.value, n = name.value.trim();
          if (d === 'named' && !n) throw new Error('取引先の社名を入れるか、出し方を「出さない」「業種だけ」にしてください。');
          if (d === 'industry' && !industry.value) throw new Error('「業種だけ出す」にするときは、業種を選んでください。');
          return {
            role: role.value.trim() || null,
            media: media.value || null,
            purpose: purpose.value || null,
            industry: industry.value || null,
            length_label: len.value.trim() || null,
            client_display: d,
            client_name: d === 'named' ? n : null,
            work_year: year.value === '' ? null : Number(year.value),
            credits: credits.value.trim() || null
          };
        }
      };
    }
    var addDet = detailEditor({});
    (function () { var box = EM.$('#addDetailFields'); if (box) box.appendChild(addDet.node); })();
    function resetAddDetail() {
      var box = EM.$('#addDetailFields');
      if (!box) return;
      EM.clear(box); addDet = detailEditor({}); box.appendChild(addDet.node);
      EM.$('#addDetail').open = false;
    }
    function detailSummary(p) {
      var parts = [];
      if (p.role) parts.push('担当：' + p.role);
      if (p.media) parts.push(p.media);
      if (p.purpose) parts.push(p.purpose);
      if (p.industry) parts.push(p.industry);
      if (p.length_label) parts.push(p.length_label);
      if (p.client_display === 'named' && p.client_name) parts.push('取引先：' + p.client_name);
      else if (p.client_display === 'industry') parts.push('取引先：業種だけ');
      return parts.join('／');
    }
    function detailBox(p) {
      var ed = detailEditor(p);
      var sum = detailSummary(p);
      return el('details', { class: 'work-detail' }, [
        el('summary', { text: sum ? 'クライアントに見せる情報：' + sum : 'クライアントに見せる情報（担当・媒体・目的・業種など）を入れる' }),
        ed.node,
        el('div', { class: 'form-actions' }, el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '保存する', onclick: function () {
          var v;
          try { v = ed.value(); } catch (e) { EM.notice(msg, e.message, 'error'); return; }
          upd(p.id, v).then(function (r) {
            if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
            else { EM.notice(msg, ''); EM.toast('保存しました'); reload(); }
          });
        } }))
      ]);
    }

    function visLabel(v) {
      for (var i = 0; i < VIS.length; i++) if (VIS[i][0] === v) return VIS[i][1];
      return v;
    }
    var LIMIT = 120;

    // 作品を書き換える共通の入口。書き換えた行が返ってこない（0件）ときも「保存できなかった」として知らせる
    // （前に、ボタンを押しても何も起きないように見えることがあったため。2026-11-19）
    function upd(id, patch) {
      return sb.from('portfolios').update(patch).eq('id', id).select('id').then(function (r) {
        if (!r.error && (!r.data || !r.data.length)) r = { error: new Error('保存できませんでした。ページを読み込み直して、もう一度お試しください。') };
        return r;
      });
    }

    EM.requireUser().then(function (u) {
      if (!u) return;
      user = u;
      return sb.from('creators').select('id,display_name').eq('user_id', u.id).maybeSingle();
    }).then(function (r) {
      if (!r) return;
      if (r.error) throw r.error;
      if (!r.data) {
        EM.notice(msg, 'さきにプロフィールを作成してください。', 'error');
        EM.$('#addForm').hidden = true;
        EM.$('#workAddBtn').hidden = true;
        EM.$('#shareForm').hidden = true;
        EM.$('#shareAddBtn').hidden = true;
        EM.$('#pfList').appendChild(el('div', { class: 'empty' }, el('a', { class: 'btn', href: '/mypage/', text: 'プロフィールを作成する' })));
        return;
      }
      creator = r.data;
      renderTagPresets();
      return reload().then(afterLoad);
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    /* ---------------- 詳しく編集する（2026-11-19 翠くん「登録し終わったものも、新規の画面をもう一回出して詳細をいじれるように」） ---------------- */
    // /mypage/portfolio.html?edit=<作品のID> で開く。追加と同じ入力欄に、今の内容を入れて出す
    var editing = null;
    function afterLoad() {
      try {
        var saved = sessionStorage.getItem('pfSaved');
        if (saved) { sessionStorage.removeItem('pfSaved'); EM.toast('「' + saved + '」を保存しました'); }
      } catch (e) {}
      var id = new URLSearchParams(location.search).get('edit');
      if (!id) {
        if (location.hash && /^#pf-/.test(location.hash)) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView({ block: 'center' }); }
        return;
      }
      var p = items.filter(function (x) { return x.id === id; })[0];
      if (!p) { EM.notice(msg, 'この作品は見つかりませんでした。削除されたか、別のアカウントの作品です。', 'error'); return; }
      enterEdit(p);
    }
    function enterEdit(p) {
      editing = p;
      document.title = '作品を編集する — Eizo Maps';
      EM.$('#pfHeading').textContent = '作品を編集する';
      EM.$('#pfLead').textContent = '「' + p.title + '」の内容を直せます。直したら下の「保存する」を押してください。';
      EM.$('#pfListArea').hidden = true;
      workAdd.hidden = true;
      EM.$('#addCard').hidden = false;
      EM.$('#addBtn').textContent = '保存する';
      EM.$('#editCancel').hidden = false;
      // URL・表紙
      urlInput.value = p.video_url || '';
      parsed = { provider: p.provider, video_id: p.video_id, video_url: p.video_url, thumbnail_url: p.thumbnail_url };
      drawPreview();
      EM.$('#thumbPickBtn').textContent = p.thumbnail_url ? '画像を変える' : '画像を選ぶ';
      // 文字
      EM.$('#title').value = p.title || '';
      EM.$('#description').value = p.description || '';
      // タグ
      pickedTags = (p.portfolio_tags || []).map(function (t) { return t.tag; });
      EM.$$('#tagChips .chip').forEach(function (b) { b.setAttribute('aria-pressed', pickedTags.indexOf(b.textContent) !== -1 ? 'true' : 'false'); });
      // クライアントに見せる情報
      var box = EM.$('#addDetailFields');
      EM.clear(box); addDet = detailEditor(p); box.appendChild(addDet.node);
      EM.$('#addDetail').open = true;
      // 公開範囲・解禁日・許可
      EM.$('#visibility').value = p.visibility;
      EM.$('#releaseOn').value = p.release_on || '';
      var rights = EM.$('#rightsOk');
      if (p.rights_confirmed_at) {
        rights.checked = true; rights.disabled = true;
        rights.parentNode.querySelector('strong').textContent = 'この作品を載せる許可があります（' + EM.date(p.rights_confirmed_at) + ' に確認済み）';
      } else { rights.checked = false; rights.disabled = false; }
      if (p.takedown_hold) EM.notice(msg, 'この作品は削除の申し立てにより一時非公開です。内容は直せますが、運営が確認するまであなた以外には見えません。', 'error');
      window.scrollTo(0, 0);
    }
    function saveEdit() {
      var p = editing;
      if (!parsed) { preview(); if (!parsed) { EM.notice(msg, '作品のURLを入れてください。', 'error'); return; } }
      var title = EM.$('#title').value.trim();
      if (!title) { EM.notice(msg, 'タイトルを入力してください。', 'error'); return; }
      var vis = EM.$('#visibility').value;
      var rightsNew = !p.rights_confirmed_at && EM.$('#rightsOk').checked;
      if (vis === 'public' && !p.rights_confirmed_at && !rightsNew) {
        EM.notice(msg, '「公開（プロフィールに表示）」にするには、「この作品を載せる許可があります」にチェックを入れてください。許可がまだの作品は「限定リンクのみ」か「パスワードページだけ」にすれば載せられます。', 'error'); return;
      }
      if (vis === 'stock_only' && p.visibility !== 'stock_only' && inShareLinks(p) &&
          !confirm('この作品は限定共有リンクに入っています。「パスワードページだけ」にすると、共有リンクには表示されなくなります。よろしいですか？')) return;
      var tf = EM.$('#thumbFile').files && EM.$('#thumbFile').files[0];
      if (tf && checkImage(tf)) { EM.notice(msg, checkImage(tf), 'error'); return; }
      var det;
      try { det = addDet.value(); } catch (err) { EM.notice(msg, err.message, 'error'); return; }
      var urlChanged = parsed.video_url !== p.video_url;
      var patch = {
        title: title,
        description: EM.$('#description').value.trim() || null,
        role: det.role, media: det.media, purpose: det.purpose, industry: det.industry, length_label: det.length_label,
        work_year: det.work_year, credits: det.credits,
        client_display: det.client_display, client_name: det.client_name,
        visibility: vis,
        release_on: EM.$('#releaseOn').value || null
      };
      if (urlChanged) {
        patch.provider = parsed.provider; patch.video_id = parsed.video_id; patch.video_url = parsed.video_url;
        patch.thumbnail_url = parsed.thumbnail_url || null;   // URLを変えたら表紙も新しい動画のものにする（画像を選んだときはそれ）
      }
      if (rightsNew) patch.rights_confirmed_at = new Date().toISOString();   // 実際の日時はサーバーの時計で入る
      var btn = EM.$('#addBtn');
      btn.setAttribute('aria-busy', 'true');
      var oldTags = (p.portfolio_tags || []).map(function (t) { return t.tag; });
      var tagsChanged = oldTags.slice().sort().join('|') !== pickedTags.slice().sort().join('|');
      upd(p.id, patch).then(function (r) {
        if (r.error) throw r.error;
      }).then(function () {
        return tf ? uploadThumb(p.id, tf) : null;
      }).then(function () {
        if (!tagsChanged) return null;
        return sb.from('portfolio_tags').delete().eq('portfolio_id', p.id).then(function (r) {
          if (r.error) throw r.error;
          if (!pickedTags.length) return null;
          return sb.from('portfolio_tags').insert(pickedTags.map(function (t) { return { portfolio_id: p.id, tag: t }; })).then(function (r2) { if (r2.error) throw r2.error; });
        });
      }).then(function () {
        try { sessionStorage.setItem('pfSaved', title); } catch (e) {}
        location.href = '/mypage/portfolio.html#pf-' + p.id;
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    }

    function reload() {
      return Promise.all([
        sb.from('portfolios')
          .select('id,title,description,provider,video_id,video_url,thumbnail_url,visibility,sort_order,created_at,rights_confirmed_at,release_on,takedown_hold,role,media,purpose,industry,length_label,client_display,client_name,pinned,work_year,credits,is_showreel,portfolio_tags(tag),stock_items(id)')
          .eq('creator_id', creator.id).order('sort_order').order('created_at', { ascending: false }),
        sb.rpc('my_takedown_requests'),
        sb.from('share_links')
          .select('id,token,title,is_active,view_count,created_at,share_link_items(portfolio_id)')
          .eq('creator_id', creator.id).order('created_at', { ascending: false })
      ]).then(function (res) {
        if (res[0].error) throw res[0].error;
        items = res[0].data || [];
        takedowns = (!res[1].error && res[1].data) || [];
        links = res[2].data || [];
        renderList();
        renderPicker();
        renderLinks();
      });
    }

    /* ---------------- 作品の追加 ---------------- */
    function renderTagPresets() {
      var box = EM.$('#tagChips');
      EM.clear(box);
      EM.TAG_PRESETS.forEach(function (t) {
        var b = el('button', {
          class: 'chip', type: 'button', 'aria-pressed': 'false', text: t,
          onclick: function () {
            var i = pickedTags.indexOf(t);
            if (i !== -1) pickedTags.splice(i, 1);
            else {
              if (pickedTags.length >= 8) { EM.toast('タグは最大8件までです'); return; }
              pickedTags.push(t);
            }
            b.setAttribute('aria-pressed', pickedTags.indexOf(t) !== -1 ? 'true' : 'false');
          }
        });
        box.appendChild(b);
      });
    }

    /* サムネイル画像の選択（ボタンの文字を日本語にするため、元の部品は隠している） */
    var thumbFile = EM.$('#thumbFile'), pickedThumbData = null;
    EM.$('#thumbPickBtn').addEventListener('click', function () { thumbFile.click(); });
    EM.$('#thumbClearBtn').addEventListener('click', function () { thumbFile.value = ''; onThumbPicked(); });
    thumbFile.addEventListener('change', onThumbPicked);
    function onThumbPicked() {
      var f = thumbFile.files && thumbFile.files[0];
      pickedThumbData = null;
      EM.$('#thumbPickName').textContent = f ? f.name : '選んでいません';
      EM.$('#thumbClearBtn').hidden = !f;
      if (f && checkImage(f)) { EM.notice(msg, checkImage(f), 'error'); thumbFile.value = ''; return onThumbPicked(); }
      if (!f) { drawPreview(); return; }
      var rd = new FileReader();
      rd.onload = function () { pickedThumbData = String(rd.result || ''); drawPreview(); };
      rd.readAsDataURL(f);
    }

    var urlInput = EM.$('#videoUrl');
    urlInput.addEventListener('change', preview);
    urlInput.addEventListener('blur', preview);

    function preview() {
      // 編集中で URL を変えていないときは、今の作品のまま（自分で選んだ表紙を上書きしない）
      if (editing && urlInput.value.trim() === (editing.video_url || '')) {
        parsed = { provider: editing.provider, video_id: editing.video_id, video_url: editing.video_url, thumbnail_url: editing.thumbnail_url };
        EM.notice(msg, ''); drawPreview(); return;
      }
      parsed = EM.parseVideoUrl(urlInput.value, true);
      var box = EM.$('#previewBox'), thumb = EM.$('#previewThumb');
      if (!parsed) {
        box.hidden = true;
        if (urlInput.value.trim()) EM.notice(msg, 'https:// から始まる URL を入力してください。', 'error');
        return;
      }
      EM.notice(msg, '');
      EM.fetchThumbnail(parsed).then(function (url) {
        parsed.thumbnail_url = url;
        drawPreview();
        EM.notice(msg, parsed.provider === 'link'
          ? 'このサイトはページの中で再生できないため、「リンク」として載せます。見る人が押すと、そのページが開きます。'
          : '');
      });
    }

    // 表紙の見本：自分で選んだ画像 → 自動で取れた画像 → サイト名の印だけ、の順
    function drawPreview() {
      var box = EM.$('#previewBox'), thumb = EM.$('#previewThumb');
      if (!parsed) { box.hidden = true; return; }
      EM.clear(thumb);
      if (pickedThumbData && /^data:image\/(png|jpeg|webp);base64,/.test(pickedThumbData)) {
        thumb.appendChild(el('img', { src: pickedThumbData, alt: '' }));
      } else if (parsed.thumbnail_url) {
        thumb.appendChild(EM.thumbImg(parsed.thumbnail_url, ''));
      }
      thumb.appendChild(el('span', { class: 'badge', text: EM.PROVIDER_LABEL[parsed.provider] || parsed.provider }));
      box.hidden = false;
    }

    EM.$('#addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (editing) { saveEdit(); return; }
      if (!parsed) { preview(); if (!parsed) return; }
      var title = EM.$('#title').value.trim();
      if (!title) { EM.notice(msg, 'タイトルを入力してください。', 'error'); return; }
      // 許可が要るのは「公開（プロフィールに表示）」だけ。限定リンク・パスワードページは許可がまだでも載せられる（2026-11-19 翠くん）
      var rightsOk = EM.$('#rightsOk').checked;
      if (EM.$('#visibility').value === 'public' && !rightsOk) { EM.notice(msg, '「公開（プロフィールに表示）」にするには、「この作品を載せる許可があります」にチェックを入れてください。許可がまだの作品は「限定リンクのみ」か「パスワードページだけ」にすれば載せられます。', 'error'); return; }
      var tf = EM.$('#thumbFile').files && EM.$('#thumbFile').files[0];
      if (tf && checkImage(tf)) { EM.notice(msg, checkImage(tf), 'error'); return; }

      var det;
      try { det = addDet.value(); } catch (err) { EM.notice(msg, err.message, 'error'); return; }
      var btn = EM.$('#addBtn');
      btn.setAttribute('aria-busy', 'true');

      sb.from('portfolios').insert({
        creator_id: creator.id,
        role: det.role, media: det.media, purpose: det.purpose, industry: det.industry, length_label: det.length_label,
        work_year: det.work_year, credits: det.credits,
        client_display: det.client_display, client_name: det.client_name,
        title: title,
        description: EM.$('#description').value.trim() || null,
        provider: parsed.provider,
        video_id: parsed.video_id,
        video_url: parsed.video_url,
        thumbnail_url: parsed.thumbnail_url || null,
        visibility: EM.$('#visibility').value,
        release_on: EM.$('#releaseOn').value || null,
        rights_confirmed_at: rightsOk ? new Date().toISOString() : null,   // 実際の日時はサーバーの時計で入る
        sort_order: items.length
      }).select('id').single().then(function (r) {
        if (r.error) throw r.error;
        var newId = r.data.id;
        var file = EM.$('#thumbFile').files && EM.$('#thumbFile').files[0];
        return (file ? uploadThumb(newId, file) : Promise.resolve()).then(function () {
          if (!pickedTags.length) return null;
          return sb.from('portfolio_tags').insert(pickedTags.map(function (t) {
            return { portfolio_id: newId, tag: t };
          }));
        });
      }).then(function () {
        btn.removeAttribute('aria-busy');
        EM.$('#addForm').reset();
        resetAddDetail();
        EM.$('#previewBox').hidden = true;
        EM.$('#thumbFile').value = ''; onThumbPicked();
        parsed = null; pickedTags = [];
        EM.$$('#tagChips .chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        EM.toast('作品を登録しました');
        if (EM.portfolioCloseAdd) EM.portfolioCloseAdd();
        EM.notice(msg, '');
        return reload();
      }).catch(function (err) {
        btn.removeAttribute('aria-busy');
        EM.notice(msg, EM.errorText(err), 'error');
      });
    });

    /* ---------------- サムネイル画像 ---------------- */
    // 画像はプロフィール写真と同じ置き場所の「自分のフォルダ」に入れる（本人しか書き込めない）
    function checkImage(f) {
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(f.type) === -1) return 'JPEG / PNG / WebP の画像を選んでください。';
      if (f.size > 2 * 1024 * 1024) return '2MB 以下の画像を選んでください。';
      return null;
    }
    function uploadThumb(portfolioId, f) {
      var bad = checkImage(f);
      if (bad) return Promise.reject(new Error(bad));
      var ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
      var path = user.id + '/works/' + portfolioId + '-' + Date.now() + '.' + ext;
      return sb.storage.from('avatars').upload(path, f, { upsert: true, contentType: f.type }).then(function (r) {
        if (r.error) throw r.error;
        var url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
        return upd(portfolioId, { thumbnail_url: url });
      }).then(function (r) { if (r && r.error) throw r.error; });
    }
    function thumbButton(p) {
      var input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) return;
        EM.notice(msg, '画像をアップロードしています…');
        uploadThumb(p.id, f).then(function () {
          EM.notice(msg, ''); EM.toast('サムネイルを変えました'); return reload();
        }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
      });
      var btn = el('button', { class: 'btn btn--sm', type: 'button', text: p.thumbnail_url ? 'サムネイルを変える' : 'サムネイルを設定',
        onclick: function () { input.click(); } });
      return el('span', null, [btn, input]);
    }

    /* ---------------- 一覧・並び替え ---------------- */
    function renderList() {
      var box = EM.$('#pfList');
      EM.clear(box);
      EM.$('#pfCount').textContent = '（' + items.length + ' / ' + LIMIT + '件）';
      // ショーリールの説明（2026-11-20 翠くん「ショーリール分かりにくい」）
      var reel = items.filter(function (x) { return x.is_showreel; })[0];
      box.appendChild(el('div', { class: 'notice reel-help' }, [
        el('p', { class: 'small' }, [el('strong', { text: 'ショーリールとは：' }),
          document.createTextNode('あなたの「まずこれを見てほしい」1本です。業界では、作品のいいところをつないだ2分ほどのまとめ動画を使うのが一般的です。選ぶと、プロフィールの名前の下に「▶ ショーリール（まとめ動画）」ボタンが出て、押した人に全画面で流れます。')]),
        el('p', { class: 'small' }, reel
          ? [el('span', { class: 'muted', text: '今のショーリール：' }), document.createTextNode(reel.title + (reel.visibility !== 'public' || !reel.rights_confirmed_at ? '（いまはプロフィールに出ていないので、ボタンも出ません）' : ''))]
          : [el('span', { class: 'muted', text: '今のショーリール：まだ選んでいません。作品の「ショーリールにする」で選べます（公開の作品だけ）。' })])
      ]));
      if (!items.length) { box.appendChild(el('div', { class: 'empty', text: 'まだ作品がありません。右上の「＋ 作品を追加」から登録できます。' })); return; }

      items.forEach(function (p, idx) {
        var thumb = el('div', { class: 'thumb' }, [
          p.thumbnail_url ? EM.thumbImg(p.thumbnail_url, '') : null,
          el('span', { class: 'badge', text: EM.PROVIDER_LABEL[p.provider] || p.provider })
        ]);
        var tags = el('div', { class: 'tags' });
        (p.portfolio_tags || []).forEach(function (t) { tags.appendChild(el('span', { class: 'tag', text: t.tag })); });

        box.appendChild(el('div', { class: 'card pf-item', id: 'pf-' + p.id }, [
          thumb,
          el('div', null, [
            el('h3', { class: 'pf-title', text: p.title }),
            p.pinned ? el('p', { class: 'small' }, el('span', { class: 'tag tag--accent', text: '代表作（プロフィールの先頭と商談モードに出ます）' })) : null,
            p.is_showreel ? el('p', { class: 'small' }, el('span', { class: 'tag tag--accent', text: 'ショーリール（プロフィールの「▶ ショーリール（まとめ動画）」ボタンで流れます）' })) : null,
            el('p', { class: 'small muted', text: visLabel(p.visibility) + ' / ' + EM.date(p.created_at) }),
            statusRow(p),
            inStock(p) ? el('p', { class: 'small' }, el('span', { class: 'tag tag--accent', text: 'ストックページで使用中' })) : null,
            p.description ? el('p', { class: 'small', text: p.description }) : null,
            tags,
            detailBox(p),
            el('div', { class: 'pf-actions' }, [
              el('a', { class: 'btn btn--sm btn--primary', href: '/mypage/portfolio.html?edit=' + encodeURIComponent(p.id), text: '詳しく編集する' }),
              el('button', { class: 'btn btn--sm', type: 'button', text: '↑', 'aria-label': '上へ移動', disabled: idx === 0, onclick: function () { move(idx, -1); } }),
              el('button', { class: 'btn btn--sm', type: 'button', text: '↓', 'aria-label': '下へ移動', disabled: idx === items.length - 1, onclick: function () { move(idx, 1); } }),
              el('button', { class: 'btn btn--sm' + (p.pinned ? ' btn--primary' : ''), type: 'button',
                text: p.pinned ? '代表作の固定を外す' : '代表作に固定',
                title: '代表作は4つまで。プロフィールの作品の先頭と、商談モードの「代表作」に出ます',
                onclick: function () { togglePin(p); } }),
              el('button', { class: 'btn btn--sm' + (p.is_showreel ? ' btn--primary' : ''), type: 'button',
                text: p.is_showreel ? 'ショーリールを外す' : 'ショーリールにする',
                title: 'プロフィールの名前の下の「▶ ショーリール（まとめ動画）」ボタンで、この作品が全画面で流れます（1本だけ）',
                onclick: function () {
                  if (!p.is_showreel && p.visibility !== 'public') { EM.notice(msg, 'ショーリールにできるのは、公開（プロフィールに表示）の作品だけです。', 'error'); return; }
                  upd(p.id, { is_showreel: !p.is_showreel }).then(function (r) {
                    if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
                    EM.notice(msg, ''); EM.toast(p.is_showreel ? 'ショーリールを外しました' : 'ショーリールにしました'); reload();
                  });
                } }),
              visSelect(p),
              releaseButton(p),
              thumbButton(p),
              el('a', { class: 'btn btn--sm btn--ghost', href: EM.safeUrl(p.video_url) || '#', target: '_blank', rel: 'noopener noreferrer', text: p.provider === 'link' ? 'ページを開く' : '動画を開く' }),
              el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '削除', onclick: function () { remove(p); } })
            ])
          ])
        ]));
      });
    }

    // 掲載の許可・解禁日・申し立ての状態
    function todayJst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
    function fmtDay(s) { var p = String(s).split('-'); return (+p[1]) + '/' + (+p[2]); }
    function statusRow(p) {
      var parts = [];
      if (p.takedown_hold) parts.push(el('span', { class: 'tag tag--danger', text: '一時非公開（削除の申し立てあり）' }));
      if (p.release_on && p.release_on > todayJst()) parts.push(el('span', { class: 'tag tag--warn', text: '解禁前：' + fmtDay(p.release_on) + ' から表示' }));
      if (!p.rights_confirmed_at) {
        parts.push(el('span', { class: 'tag tag--warn', text: p.visibility === 'public'
          ? '許可の確認がまだなので、プロフィールには出ていません'
          : '許可の確認まだ（限定リンク・パスワードページだけ）' }));
        parts.push(el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: '載せる許可を確認する',
          onclick: function () { confirmRights(p); } }));
      }
      var box = el('div', { class: 'pf-status' }, parts);
      takedowns.filter(function (t) { return t.portfolio_id === p.id && t.status === 'open'; }).forEach(function (t) {
        box.appendChild(takedownBox(t));
      });
      // 判断の結果（30日以内のもの）。理由と、納得できないときの見直しの頼み方
      takedowns.filter(function (t) {
        return t.portfolio_id === p.id && t.status !== 'open' && t.decided_at && (Date.now() - new Date(t.decided_at).getTime()) < 30 * 86400000;
      }).forEach(function (t) { box.appendChild(takedownResult(t)); });
      return box.childNodes.length ? box : null;
    }

    function confirmRights(p) {
      if (!confirm('「' + p.title + '」について確認します。\n\n自主制作の作品か、クライアント・制作会社さんから「実績として出してよい」と言われている作品ですか？\n守秘義務（NDA）がある場合は、許可された範囲・時期だけ載せていますか？\n\n「OK」を押すと、確認した日時が記録されます。')) return;
      upd(p.id, { rights_confirmed_at: new Date().toISOString() }).then(function (r) {
        if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
        else { EM.toast('確認を記録しました'); reload(); }
      });
    }

    function releaseButton(p) {
      var input = el('input', { type: 'date', class: 'select--sm', 'aria-label': '解禁日', value: p.release_on || '' });
      input.addEventListener('change', function () {
        upd(p.id, { release_on: input.value || null }).then(function (r) {
          if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); input.value = p.release_on || ''; }
          else { EM.toast(input.value ? '解禁日を ' + fmtDay(input.value) + ' にしました' : '解禁日を外しました'); reload(); }
        });
      });
      return el('label', { class: 'pf-release small' }, [el('span', { class: 'muted', text: '解禁日' }), input]);
    }

    var REASON = { confidential: '守秘義務・公開前の作品', copyright: '著作権', portrait: '肖像権（顔・姿）', impersonation: 'なりすまし・実績の偽り', other: 'その他' };
    var RELATION = { client: 'クライアント', agency: '代理店', production: '制作会社', performer: '出演者', creator: '制作に関わった人', other: 'その他' };
    function takedownBox(t) {
      var box = el('div', { class: 'notice notice--warn takedown-box' });
      box.appendChild(el('p', { class: 'small' }, [el('strong', { text: '削除の申し立てが届いています' })]));
      box.appendChild(el('p', { class: 'small', text: '申し立てた人：' + (RELATION[t.relation] || t.relation) + (t.requester_org ? '（' + t.requester_org + '）' : '') + ' ／ 理由：' + (REASON[t.reason] || t.reason) }));
      box.appendChild(el('p', { class: 'small pre', text: t.detail }));
      box.appendChild(el('p', { class: 'small muted', text: '運営が確認するまで、この作品はあなた以外に見えません。許可を得ている・事実と違うなどの場合は、下に言い分を書いてください。運営が両方を人の目で見て判断します。' }));
      if (t.due_on) box.appendChild(el('p', { class: 'small' }, [el('strong', { text: '判断の目安：' + fmtDay(t.due_on) + ' まで' }), document.createTextNode('（届いた日 ' + EM.date(t.created_at) + '）')]));
      if (t.creator_response) {
        box.appendChild(el('p', { class: 'small' }, [el('span', { class: 'muted', text: 'あなたの言い分：' }), document.createTextNode(t.creator_response)]));
      } else {
        var ta = el('textarea', { rows: 3, maxlength: 4000, placeholder: '例：放送後の掲載について、制作会社の担当の方からメールで許可をもらっています（10/1）' });
        var btn = el('button', { class: 'btn btn--sm', type: 'button', text: '言い分を送る', onclick: function () {
          var v = ta.value.trim();
          if (v.length < 5) { EM.notice(msg, '5文字以上で書いてください。', 'error'); return; }
          sb.rpc('respond_takedown', { p_id: t.id, p_text: v }).then(function (r) {
            if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
            else { EM.toast('言い分を送りました'); reload(); }
          });
        } });
        box.appendChild(ta); box.appendChild(btn);
      }
      return box;
    }

    function takedownResult(t) {
      var upheld = t.status === 'upheld';
      var box = el('div', { class: 'notice ' + (upheld ? 'notice--warn' : 'notice--ok') + ' takedown-box' });
      box.appendChild(el('p', { class: 'small' }, [el('strong', { text: upheld
        ? '削除の申し立てを運営が認めました（この作品は非公開のままです）'
        : '削除の申し立ては認められませんでした（作品は公開に戻りました）' })]));
      if (t.decided_note) box.appendChild(el('p', { class: 'small pre', text: '理由：' + t.decided_note }));
      if (upheld) box.appendChild(el('p', { class: 'small muted' }, [
        document.createTextNode('判断に納得できないときは、理由を添えて '),
        el('a', { href: '/contact/', text: 'お問い合わせ' }),
        document.createTextNode(' から見直しを求められます。最初とは別の目で見直します。')
      ]));
      return box;
    }

    function togglePin(p) {
      if (!p.pinned && p.visibility !== 'public') { EM.notice(msg, '代表作に固定できるのは、公開（プロフィールに表示）の作品だけです。', 'error'); return; }
      upd(p.id, { pinned: !p.pinned }).then(function (r) {
        if (r.error) { EM.notice(msg, EM.errorText(r.error), 'error'); return; }
        EM.notice(msg, ''); EM.toast(p.pinned ? '固定を外しました' : '代表作に固定しました'); reload();
      });
    }

    function move(idx, dir) {
      var j = idx + dir;
      if (j < 0 || j >= items.length) return;
      var a = items[idx], b = items[j];
      Promise.all([
        upd(a.id, { sort_order: j }),
        upd(b.id, { sort_order: idx })
      ]).then(function (rs) {
        rs.forEach(function (r) { if (r.error) throw r.error; });
        return reload();
      }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); reload(); });
    }

    function inStock(p) { return (p.stock_items || []).length > 0; }

    function inShareLinks(p) {
      return links.some(function (s) {
        return (s.share_link_items || []).some(function (x) { return x.portfolio_id === p.id; });
      });
    }

    function visSelect(p) {
      var sel = el('select', { class: 'select--sm', 'aria-label': '見せ方' }, VIS.map(function (v) {
        return el('option', { value: v[0], text: v[1] });
      }));
      sel.value = p.visibility;
      sel.addEventListener('change', function () {
        var next = sel.value;
        if (next === 'public' && !p.rights_confirmed_at) {
          sel.value = p.visibility;
          EM.notice(msg, '「' + p.title + '」は、載せる許可の確認がまだです。プロフィールに出すには、先に「載せる許可を確認する」を押してください。', 'error');
          return;
        }
        if (next === 'stock_only' && inShareLinks(p) &&
            !confirm('この作品は限定共有リンクに入っています。「パスワードページだけ」にすると、共有リンクには表示されなくなります。よろしいですか？')) {
          sel.value = p.visibility; return;
        }
        upd(p.id, { visibility: next }).then(function (r) {
          if (r.error) { sel.value = p.visibility; EM.notice(msg, EM.errorText(r.error), 'error'); }
          else { EM.toast('見せ方を変えました'); reload(); }
        });
      });
      return sel;
    }

    function remove(p) {
      var where = [];
      if (inStock(p)) where.push('ストックページ');
      if (inShareLinks(p)) where.push('限定共有リンク');
      var note = where.length ? '\n\nこの作品は' + where.join('と') + 'でも使われています。作品棚から削除すると、そちらからも消えます。' : '';
      if (!confirm('「' + p.title + '」を作品棚から削除します。よろしいですか？' + note)) return;
      sb.from('portfolios').delete().eq('id', p.id).then(function (r) {
        if (r.error) EM.notice(msg, EM.errorText(r.error), 'error');
        else { EM.toast('削除しました'); reload(); }
      });
    }

    /* ---------------- 共有リンク ---------------- */
    function renderPicker() {
      var box = EM.$('#sharePicker');
      EM.clear(box);
      if (!items.length) { box.appendChild(el('p', { class: 'small muted', text: '作品を登録すると選べるようになります。' })); return; }
      var shareable = items.filter(function (p) { return p.visibility !== 'stock_only'; });
      if (!shareable.length) { box.appendChild(el('p', { class: 'small muted', text: '限定リンクで共有できる作品がありません（「パスワードページだけ」の作品は選べません）。' })); return; }
      shareable.forEach(function (p) {
        box.appendChild(el('label', { class: 'checkbox' }, [
          el('input', { type: 'checkbox', value: p.id, dataset: { pf: '1' } }),
          el('span', { text: p.title + (p.visibility === 'link_only' ? '（限定）' : '') })
        ]));
      });
    }

    EM.$('#shareForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var picked = EM.$$('#sharePicker input[data-pf]').filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
      if (!picked.length) { EM.notice(msg, '共有する作品を1つ以上選んでください。', 'error'); return; }

      sb.from('share_links').insert({
        creator_id: creator.id,
        title: EM.$('#shareTitle').value.trim() || null
      }).select('id,token').single().then(function (r) {
        if (r.error) throw r.error;
        return sb.from('share_link_items').insert(picked.map(function (id, i) {
          return { share_link_id: r.data.id, portfolio_id: id, sort_order: i };
        })).then(function () { return r.data; });
      }).then(function (link) {
        EM.$('#shareForm').reset();
        closeShare();
        EM.toast('共有リンクを作りました');
        copy(shareUrl(link.token));
        return reload();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    });

    function shareUrl(token) {
      var origin = (EM.config.SITE_ORIGIN || location.origin).replace(/\/$/, '');
      return origin + '/p/?t=' + token;
    }

    function copy(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { EM.toast('リンクをコピーしました'); },
          function () { EM.toast('コピーできませんでした。手動で選択してください'); });
      } else { EM.toast('コピーできませんでした。手動で選択してください'); }
    }

    function renderLinks() {
      var box = EM.$('#shareList');
      EM.clear(box);
      if (!links.length) { box.appendChild(el('div', { class: 'empty', text: '共有リンクはまだありません。「＋ 共有リンクを作る」から作れます。' })); return; }
      links.forEach(function (s) {
        var url = shareUrl(s.token);
        box.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'share-row' }, [
            el('div', { class: 'share-row__main' }, [
              el('p', { class: 'pf-title', text: s.title || '（名称未設定）' }),
              el('p', { class: 'small muted', text: (s.share_link_items || []).length + '作品 / 閲覧 ' + s.view_count + '回 / ' + EM.date(s.created_at) + (s.is_active ? '' : ' / 停止中') }),
              el('p', { class: 'share-url', text: url })
            ]),
            el('div', { class: 'pf-actions' }, [
              el('button', { class: 'btn btn--sm', type: 'button', text: 'リンクをコピー', onclick: function () { copy(url); } }),
              el('a', { class: 'btn btn--sm btn--ghost', href: '/p/?t=' + encodeURIComponent(s.token), target: '_blank', rel: 'noopener', text: '開く' }),
              el('button', { class: 'btn btn--sm', type: 'button', text: s.is_active ? '停止' : '再開', onclick: function () {
                sb.from('share_links').update({ is_active: !s.is_active }).eq('id', s.id).then(reload);
              } }),
              el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '削除', onclick: function () {
                if (!confirm('この共有リンクを削除します。よろしいですか？')) return;
                sb.from('share_links').delete().eq('id', s.id).then(reload);
              } })
            ])
          ])
        ]));
      });
    }
    // 見出しの「＋ 作品を追加」：入力欄へ移ってすぐ入力できるように
    var workAdd = EM.$('#workAddBtn');
    function openAdd() {
      EM.$('#addCard').hidden = false;
      workAdd.hidden = true;   // 開いている間は右上のボタンを隠す（同じボタンを2つ並べない）
      setTimeout(function () { EM.$('#videoUrl').focus(); }, 50);
    }
    function closeAdd() { EM.$('#addCard').hidden = true; workAdd.hidden = false; }
    EM.portfolioCloseAdd = closeAdd;

    // 「＋ 共有リンクを作る」：押すと入力欄が開き、開いている間はボタンを隠す。作り終わると閉じる
    var shareAdd = EM.$('#shareAddBtn');
    function openShare() {
      EM.$('#shareCard').hidden = false;
      shareAdd.hidden = true;
      shareAdd.setAttribute('aria-expanded', 'true');
      setTimeout(function () { EM.$('#shareTitle').focus(); }, 50);
    }
    function closeShare() {
      EM.$('#shareCard').hidden = true;
      shareAdd.hidden = false;
      shareAdd.setAttribute('aria-expanded', 'false');
    }
    shareAdd.addEventListener('click', openShare);
    workAdd.addEventListener('click', function (e) { e.preventDefault(); openAdd(); });
  });
})(window.EM);
