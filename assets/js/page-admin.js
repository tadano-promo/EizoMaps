/* Eizo Maps — 運営用の管理画面
   この画面は「運営にとって使いやすいか」だけを担当する。
   実際に書けるかどうかは、すべてサーバー側（RLS と管理者専用 RPC）が決める。
   仮にこのファイルを書き換えて画面を出しても、書き込みは通らない。 */
(function (EM) {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var sb = EM.sb(), el = EM.el;
    var msg = EM.$('#pageMsg');
    if (!sb) return;

    var anns = [], ads = [], articles = [], writers = [], proposals = [];
    var propFilter = 'stocked';
    var adImageUrl = null;

    var ANN_COLS = 'id,kind,title,body,link_url,link_label,visibility,is_published,pinned,published_at,created_at';
    var AD_COLS  = 'id,slot,title,body,sponsor,image_url,link_url,starts_at,ends_at,is_active,sort_order,created_at';
    var ART_COLS = 'id,slug,title,excerpt,category,visibility,status,source,author_user_id,published_at,updated_at';

    var STATUS_LABEL = { draft: '下書き', review: '確認待ち', published: '公開中' };

    var PROP_AREA = [['schedule','スケジュール'],['creators','クリエイター'],['projects','案件'],
                     ['stock','ストックページ'],['admin','管理'],['email','メール'],
                     ['infra','基盤'],['billing','課金'],['content','記事'],['other','その他']];
    var PROP_ORIGIN = [['user_voice','ユーザーの声'],['usage','使われ方'],['ai','Claudeの提案'],['ops','運営の気づき']];
    var PROP_LEVEL = [['high','大'],['mid','中'],['low','小']];
    var PROP_STATUS = [['stocked','ストック'],['approved','やると決めた'],['building','着手中'],
                       ['done','完了'],['rejected','見送り']];
    function labelOf(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1]; return v; }

    EM.requireUser().then(function (u) {
      if (!u) return;
      return EM.roles();
    }).then(function (roles) {
      if (!roles) return;
      if (!roles.admin) {
        EM.notice(msg, 'この画面は運営用です。閲覧する権限がありません。', 'error');
        return;
      }
      EM.$('#adminBody').hidden = false;
      initForms();
      return reload();
    }).catch(function (e) { EM.notice(msg, EM.errorText(e), 'error'); });

    function reload() {
      return Promise.all([
        sb.rpc('admin_overview'),
        sb.from('announcements').select(ANN_COLS).order('created_at', { ascending: false }).limit(50),
        sb.from('ads').select(AD_COLS).order('slot').order('sort_order').limit(50),
        sb.from('articles').select(ART_COLS).order('updated_at', { ascending: false }).limit(50),
        sb.rpc('admin_list_writers'),
        sb.from('improvement_proposals')
          .select('id,title,detail,area,origin,impact,effort,cost_note,status,decided_note,decided_at,created_at')
          .order('created_at', { ascending: false }).limit(200)
      ]).then(function (r) {
        if (!r[0].error) renderOverview(r[0].data || {});
        anns     = (!r[1].error && r[1].data) || [];
        ads      = (!r[2].error && r[2].data) || [];
        articles = (!r[3].error && r[3].data) || [];
        writers  = (!r[4].error && r[4].data) || [];
        proposals = (!r[5].error && r[5].data) || [];
        renderAnns(); renderAds(); renderArticles(); renderWriters(); renderProposals();
      });
    }

    /* ---------------- 概況 ---------------- */
    function renderOverview(o) {
      var box = EM.$('#overview');
      EM.clear(box);
      [
        ['Creators', o.creators, '登録クリエイター'],
        ['Published', o.creators_published, '公開中'],
        ['Clients', o.clients, 'クライアント'],
        ['Projects', o.projects, '案件'],
        ['Reviews', o.reviews_published, '公開レビュー'],
        ['Stock', o.stock_pages, 'ストックページ'],
        ['News', o.announcements_live, '公開中のお知らせ'],
        ['Ads', o.ads_live, '掲載中の広告'],
        ['Drafts', o.articles_draft, '未公開の記事'],
        ['Reports', o.reports_open, '未対応の報告']
      ].forEach(function (x) {
        box.appendChild(el('div', { class: 'card stat-card' }, [
          el('span', { class: 'v num', text: String(x[1] == null ? '-' : x[1]) }),
          el('span', { class: 'k', text: x[0] }),
          el('span', { class: 'small muted', text: x[2] })
        ]));
      });
    }

    /* ---------------- 共通 ---------------- */
    function multiline(text, cls) {
      var p = el('p', { class: cls || '' });
      String(text).split(/\r?\n/).forEach(function (line, i) {
        if (i) p.appendChild(el('br'));
        p.appendChild(document.createTextNode(line));
      });
      return p;
    }
    // datetime-local ⇔ ISO
    function toLocalInput(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d)) return '';
      var pad = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function fromLocalInput(v) {
      if (!v) return null;
      var d = new Date(v);
      return isNaN(d) ? null : d.toISOString();
    }

    function initForms() {
      var kind = EM.$('#annKind');
      Object.keys(EM.ANNOUNCE_KIND).forEach(function (k) {
        kind.appendChild(el('option', { value: k, text: EM.ANNOUNCE_KIND[k] }));
      });
      fillSelect('#propArea', PROP_AREA);
      fillSelect('#propOrigin', PROP_ORIGIN);
      fillSelect('#propImpact', PROP_LEVEL);
      fillSelect('#propEffort', PROP_LEVEL);
      EM.$('#propImpact').value = 'mid';
      EM.$('#propEffort').value = 'mid';
      EM.$('#propOrigin').value = 'ops';
      var fbox = EM.$('#propFilter');
      [['stocked','ストック']].concat(PROP_STATUS.slice(1)).concat([['all','すべて']]).forEach(function (st) {
        fbox.appendChild(el('button', {
          class: 'chip', type: 'button', text: st[1],
          'aria-pressed': st[0] === propFilter ? 'true' : 'false',
          onclick: function () {
            propFilter = st[0];
            EM.$$('#propFilter .chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
            this.setAttribute('aria-pressed', 'true');
            renderProposals();
          }
        }));
      });
    }
    function fillSelect(sel, list) {
      var node = EM.$(sel);
      EM.clear(node);
      list.forEach(function (x) { node.appendChild(el('option', { value: x[0], text: x[1] })); });
    }

    /* ---------------- お知らせ ---------------- */
    function annReset() {
      EM.$('#annId').value = '';
      EM.$('#annKind').value = 'update';
      EM.$('#annVisibility').value = 'public';
      EM.$('#annTitle').value = '';
      EM.$('#annBody').value = '';
      EM.$('#annLink').value = '';
      EM.$('#annLinkLabel').value = '';
      EM.$('#annPinned').checked = false;
      EM.$('#annPublished').checked = false;
      EM.$('#annSaveBtn').textContent = '保存する';
    }
    EM.$('#annResetBtn').addEventListener('click', annReset);

    EM.$('#annForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = EM.$('#annTitle').value.trim();
      if (!title) { EM.notice(msg, '見出しを入力してください。', 'error'); return; }
      var link = EM.$('#annLink').value.trim();
      if (link && !EM.safeUrl(link)) { EM.notice(msg, 'リンクは https:// から始まる URL にしてください。', 'error'); return; }

      var row = {
        kind: EM.$('#annKind').value,
        visibility: EM.$('#annVisibility').value,
        title: title,
        body: EM.$('#annBody').value.trim() || null,
        link_url: link || null,
        link_label: EM.$('#annLinkLabel').value.trim() || null,
        pinned: EM.$('#annPinned').checked,
        is_published: EM.$('#annPublished').checked
      };
      var id = EM.$('#annId').value;
      var btn = EM.$('#annSaveBtn'); btn.setAttribute('aria-busy', 'true');
      var q = id ? sb.from('announcements').update(row).eq('id', id)
                 : sb.from('announcements').insert(row);
      q.then(function (r) {
        if (r.error) throw r.error;
        annReset();
        EM.notice(msg, '');
        EM.toast('保存しました');
        return reload();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); })
        .then(function () { btn.removeAttribute('aria-busy'); });
    });

    function renderAnns() {
      var box = EM.$('#annList');
      EM.clear(box);
      if (!anns.length) { box.appendChild(el('p', { class: 'small muted', text: 'まだお知らせがありません。' })); return; }
      anns.forEach(function (n) {
        box.appendChild(el('div', { class: 'card stack' }, [
          el('div', { class: 'row-item' }, [
            el('div', { class: 'row-item__main' }, [
              el('span', { class: 'tag tag--accent', text: EM.ANNOUNCE_KIND[n.kind] || n.kind }),
              n.pinned ? el('span', { class: 'tag', text: '固定' }) : null,
              el('span', { class: 'tag', text: n.visibility === 'members' ? '会員限定' : '全員に公開' }),
              el('span', { class: 'tag', text: n.is_published ? '公開中' : '下書き' }),
              el('span', { class: 'row-item__title', text: n.title })
            ]),
            el('div', { class: 'row-item__ops' }, [
              el('button', { class: 'btn btn--sm', type: 'button', text: '編集',
                onclick: function () { annEdit(n); } }),
              el('button', { class: 'btn btn--sm', type: 'button',
                text: n.is_published ? '下書きに戻す' : '公開する',
                onclick: function () { annToggle(n); } }),
              el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '削除',
                onclick: function () { annDelete(n); } })
            ])
          ]),
          n.body ? multiline(n.body, 'small muted') : null,
          el('p', { class: 'small muted mono', text: n.published_at ? EM.date(n.published_at) + ' 公開' : '未公開' })
        ]));
      });
    }

    function annEdit(n) {
      EM.$('#annId').value = n.id;
      EM.$('#annKind').value = n.kind;
      EM.$('#annVisibility').value = n.visibility;
      EM.$('#annTitle').value = n.title;
      EM.$('#annBody').value = n.body || '';
      EM.$('#annLink').value = n.link_url || '';
      EM.$('#annLinkLabel').value = n.link_label || '';
      EM.$('#annPinned').checked = !!n.pinned;
      EM.$('#annPublished').checked = !!n.is_published;
      EM.$('#annSaveBtn').textContent = 'この内容で更新する';
      EM.$('#annForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function annToggle(n) {
      sb.from('announcements').update({ is_published: !n.is_published }).eq('id', n.id)
        .then(function (r) { if (r.error) throw r.error; return reload(); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    function annDelete(n) {
      if (!confirm('このお知らせを削除しますか？')) return;
      sb.from('announcements').delete().eq('id', n.id)
        .then(function (r) { if (r.error) throw r.error; return reload(); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    /* ---------------- 広告 ---------------- */
    function adReset() {
      EM.$('#adId').value = '';
      EM.$('#adSlotSel').value = 'home_top';
      EM.$('#adSponsor').value = '';
      EM.$('#adTitle').value = '';
      EM.$('#adBody').value = '';
      EM.$('#adLink').value = '';
      EM.$('#adStart').value = '';
      EM.$('#adEnd').value = '';
      EM.$('#adOrder').value = '0';
      EM.$('#adActive').checked = false;
      adImageUrl = null;
      renderAdPreview();
      EM.$('#adSaveBtn').textContent = '保存する';
    }
    EM.$('#adResetBtn').addEventListener('click', adReset);
    EM.$('#adImgClear').addEventListener('click', function () { adImageUrl = null; renderAdPreview(); });

    function renderAdPreview() {
      var box = EM.$('#adImgPreview');
      EM.clear(box);
      var safe = EM.safeUrl(adImageUrl);
      if (safe) box.appendChild(el('img', { class: 'ad__img ad__img--preview', src: safe, alt: '' }));
      else box.appendChild(el('p', { class: 'small muted', text: '画像なし' }));
    }

    EM.$('#adImgFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) { EM.notice(msg, '画像は 3MB までです。', 'error'); return; }
      EM.getUser().then(function (u) {
        var ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        var path = u.id + '/ad-' + Date.now() + '.' + ext;
        return sb.storage.from('media').upload(path, f, { upsert: true, contentType: f.type })
          .then(function (r) {
            if (r.error) throw r.error;
            adImageUrl = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
            renderAdPreview();
            EM.notice(msg, '画像を読み込みました。「保存する」で反映されます。', 'ok');
          });
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    });

    EM.$('#adForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = EM.$('#adTitle').value.trim();
      var link = EM.safeUrl(EM.$('#adLink').value.trim());
      if (!title) { EM.notice(msg, '見出しを入力してください。', 'error'); return; }
      if (!link) { EM.notice(msg, 'リンク先は https:// から始まる URL にしてください。', 'error'); return; }
      var starts = fromLocalInput(EM.$('#adStart').value);
      var ends = fromLocalInput(EM.$('#adEnd').value);
      if (starts && ends && new Date(ends) <= new Date(starts)) {
        EM.notice(msg, '掲載終了は掲載開始より後にしてください。', 'error'); return;
      }

      var row = {
        slot: EM.$('#adSlotSel').value,
        title: title,
        body: EM.$('#adBody').value.trim() || null,
        sponsor: EM.$('#adSponsor').value.trim() || null,
        image_url: adImageUrl || null,
        link_url: link,
        starts_at: starts,
        ends_at: ends,
        sort_order: Number(EM.$('#adOrder').value) || 0,
        is_active: EM.$('#adActive').checked
      };
      var id = EM.$('#adId').value;
      var btn = EM.$('#adSaveBtn'); btn.setAttribute('aria-busy', 'true');
      var q = id ? sb.from('ads').update(row).eq('id', id) : sb.from('ads').insert(row);
      q.then(function (r) {
        if (r.error) throw r.error;
        adReset();
        EM.notice(msg, '');
        EM.toast('保存しました');
        return reload();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); })
        .then(function () { btn.removeAttribute('aria-busy'); });
    });

    function renderAds() {
      var box = EM.$('#adList');
      EM.clear(box);
      if (!ads.length) { box.appendChild(el('p', { class: 'small muted', text: 'まだ広告がありません。' })); return; }
      ads.forEach(function (a) {
        var period = [a.starts_at ? EM.date(a.starts_at) : '開始未指定',
                      a.ends_at ? EM.date(a.ends_at) : '終了未指定'].join(' 〜 ');
        box.appendChild(el('div', { class: 'card stack' }, [
          el('div', { class: 'row-item' }, [
            el('div', { class: 'row-item__main' }, [
              el('span', { class: 'tag tag--accent', text: a.slot === 'home_side' ? 'トップ横' : 'トップ上部' }),
              el('span', { class: 'tag', text: a.is_active ? '掲載中' : '停止中' }),
              el('span', { class: 'row-item__title', text: a.title })
            ]),
            el('div', { class: 'row-item__ops' }, [
              el('button', { class: 'btn btn--sm', type: 'button', text: '編集',
                onclick: function () { adEdit(a); } }),
              el('button', { class: 'btn btn--sm', type: 'button',
                text: a.is_active ? '止める' : '掲載する',
                onclick: function () { adToggle(a); } }),
              el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '削除',
                onclick: function () { adDelete(a); } })
            ])
          ]),
          el('p', { class: 'small muted mono', text: period }),
          el('p', { class: 'small muted mono', text: a.link_url })
        ]));
      });
    }

    function adEdit(a) {
      EM.$('#adId').value = a.id;
      EM.$('#adSlotSel').value = a.slot;
      EM.$('#adSponsor').value = a.sponsor || '';
      EM.$('#adTitle').value = a.title;
      EM.$('#adBody').value = a.body || '';
      EM.$('#adLink').value = a.link_url;
      EM.$('#adStart').value = toLocalInput(a.starts_at);
      EM.$('#adEnd').value = toLocalInput(a.ends_at);
      EM.$('#adOrder').value = String(a.sort_order || 0);
      EM.$('#adActive').checked = !!a.is_active;
      adImageUrl = a.image_url || null;
      renderAdPreview();
      EM.$('#adSaveBtn').textContent = 'この内容で更新する';
      EM.$('#adForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function adToggle(a) {
      sb.from('ads').update({ is_active: !a.is_active }).eq('id', a.id)
        .then(function (r) { if (r.error) throw r.error; return reload(); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    function adDelete(a) {
      if (!confirm('この広告を削除しますか？')) return;
      sb.from('ads').delete().eq('id', a.id)
        .then(function (r) { if (r.error) throw r.error; return reload(); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    /* ---------------- 記事 ---------------- */
    function renderArticles() {
      var box = EM.$('#articleList');
      EM.clear(box);
      if (!articles.length) {
        box.appendChild(el('p', { class: 'small muted', text: 'まだ記事がありません。執筆を許可した人が書くとここに並びます。' }));
        return;
      }
      articles.forEach(function (a) {
        var ops = el('div', { class: 'row-item__ops' });
        if (a.status !== 'published') {
          ops.appendChild(el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '公開する',
            onclick: function () { setStatus(a, 'published'); } }));
        }
        if (a.status !== 'draft') {
          ops.appendChild(el('button', { class: 'btn btn--sm', type: 'button', text: '下書きに戻す',
            onclick: function () { setStatus(a, 'draft'); } }));
        }
        box.appendChild(el('div', { class: 'card stack' }, [
          el('div', { class: 'row-item' }, [
            el('div', { class: 'row-item__main' }, [
              el('span', { class: 'tag tag--accent', text: STATUS_LABEL[a.status] || a.status }),
              el('span', { class: 'tag', text: a.category }),
              a.source === 'auto' ? el('span', { class: 'tag', text: '自動下書き' }) : null,
              el('span', { class: 'row-item__title', text: a.title })
            ]),
            ops
          ]),
          a.excerpt ? el('p', { class: 'small muted', text: a.excerpt }) : null,
          el('p', { class: 'small muted mono', text: '/' + a.slug + '  ' + EM.date(a.updated_at) })
        ]));
      });
    }

    function setStatus(a, status) {
      sb.rpc('set_article_status', { p_id: a.id, p_status: status })
        .then(function (r) { if (r.error) throw r.error; EM.toast('変更しました'); return reload(); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    /* ---------------- 改善提案のストック ---------------- */
    function propReset() {
      EM.$('#propId').value = '';
      EM.$('#propTitle').value = '';
      EM.$('#propDetail').value = '';
      EM.$('#propArea').value = 'other';
      EM.$('#propOrigin').value = 'ops';
      EM.$('#propImpact').value = 'mid';
      EM.$('#propEffort').value = 'mid';
      EM.$('#propCost').value = '';
      EM.$('#propSaveBtn').textContent = 'ストックに追加';
    }
    EM.$('#propResetBtn').addEventListener('click', propReset);

    EM.$('#propForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = EM.$('#propTitle').value.trim();
      if (!title) { EM.notice(msg, 'やりたいことを入力してください。', 'error'); return; }
      var row = {
        title: title,
        detail: EM.$('#propDetail').value.trim() || null,
        area: EM.$('#propArea').value,
        origin: EM.$('#propOrigin').value,
        impact: EM.$('#propImpact').value,
        effort: EM.$('#propEffort').value,
        cost_note: EM.$('#propCost').value.trim() || null
      };
      var id = EM.$('#propId').value;
      var btn = EM.$('#propSaveBtn'); btn.setAttribute('aria-busy', 'true');
      var q = id ? sb.from('improvement_proposals').update(row).eq('id', id)
                 : sb.from('improvement_proposals').insert(row);
      q.then(function (r) {
        if (r.error) throw r.error;
        propReset();
        EM.notice(msg, '');
        EM.toast('ストックしました');
        return reload();
      }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); })
        .then(function () { btn.removeAttribute('aria-busy'); });
    });

    function renderProposals() {
      var box = EM.$('#propList');
      EM.clear(box);
      var list = proposals.filter(function (p) {
        return propFilter === 'all' ? true : p.status === propFilter;
      });
      if (!list.length) {
        box.appendChild(el('p', { class: 'small muted', text: 'この状態の提案はありません。' }));
        return;
      }
      list.forEach(function (p) {
        var ops = el('div', { class: 'row-item__ops' });
        if (p.status === 'stocked') {
          ops.appendChild(el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: 'やると決める',
            onclick: function () { decide(p, 'approved'); } }));
          ops.appendChild(el('button', { class: 'btn btn--sm', type: 'button', text: '見送る',
            onclick: function () { decide(p, 'rejected'); } }));
        } else if (p.status === 'approved') {
          ops.appendChild(el('button', { class: 'btn btn--sm', type: 'button', text: '着手中にする',
            onclick: function () { decide(p, 'building'); } }));
          ops.appendChild(el('button', { class: 'btn btn--sm', type: 'button', text: 'ストックに戻す',
            onclick: function () { decide(p, 'stocked'); } }));
        } else if (p.status === 'building') {
          ops.appendChild(el('button', { class: 'btn btn--sm btn--primary', type: 'button', text: '完了にする',
            onclick: function () { decide(p, 'done'); } }));
        } else {
          ops.appendChild(el('button', { class: 'btn btn--sm', type: 'button', text: 'ストックに戻す',
            onclick: function () { decide(p, 'stocked'); } }));
        }
        ops.appendChild(el('button', { class: 'btn btn--sm', type: 'button', text: '編集',
          onclick: function () { propEdit(p); } }));

        box.appendChild(el('div', { class: 'card stack' }, [
          el('div', { class: 'row-item' }, [
            el('div', { class: 'row-item__main' }, [
              el('span', { class: 'tag tag--accent', text: labelOf(PROP_STATUS, p.status) }),
              el('span', { class: 'tag', text: labelOf(PROP_AREA, p.area) }),
              el('span', { class: 'tag', text: labelOf(PROP_ORIGIN, p.origin) }),
              el('span', { class: 'tag', text: '効き目' + labelOf(PROP_LEVEL, p.impact) + '／手間' + labelOf(PROP_LEVEL, p.effort) }),
              el('span', { class: 'row-item__title', text: p.title })
            ]),
            ops
          ]),
          p.detail ? multiline(p.detail, 'small muted') : null,
          p.cost_note ? el('p', { class: 'small muted mono', text: '費用: ' + p.cost_note }) : null,
          p.decided_at ? el('p', { class: 'small muted mono', text: '判断: ' + EM.date(p.decided_at) }) : null
        ]));
      });
    }

    function decide(p, status) {
      var note = null;
      if (status === 'approved' || status === 'rejected') {
        note = prompt(status === 'approved' ? 'やると決めた理由（任意）' : '見送る理由（任意）', p.decided_note || '');
        if (note === null) return;
      }
      var patch = { status: status };
      if (note !== null && note !== undefined) patch.decided_note = note || null;
      sb.from('improvement_proposals').update(patch).eq('id', p.id)
        .then(function (r) { if (r.error) throw r.error; EM.toast('更新しました'); return reload(); })
        .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    }

    function propEdit(p) {
      EM.$('#propId').value = p.id;
      EM.$('#propTitle').value = p.title;
      EM.$('#propDetail').value = p.detail || '';
      EM.$('#propArea').value = p.area;
      EM.$('#propOrigin').value = p.origin;
      EM.$('#propImpact').value = p.impact;
      EM.$('#propEffort').value = p.effort;
      EM.$('#propCost').value = p.cost_note || '';
      EM.$('#propSaveBtn').textContent = 'この内容で更新する';
      EM.$('#propForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /* ---------------- 執筆者 ---------------- */
    EM.$('#writerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = EM.$('#writerEmail').value.trim();
      if (!email) return;
      sb.rpc('admin_add_writer', { p_email: email, p_note: EM.$('#writerNote').value.trim() || null })
        .then(function (r) {
          if (r.error) throw r.error;
          EM.$('#writerEmail').value = '';
          EM.$('#writerNote').value = '';
          EM.notice(msg, '');
          EM.toast('執筆を許可しました');
          return reload();
        }).catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
    });

    function renderWriters() {
      var box = EM.$('#writerList');
      EM.clear(box);
      if (!writers.length) { box.appendChild(el('p', { class: 'small muted', text: 'まだ誰にも許可していません。' })); return; }
      writers.forEach(function (w) {
        box.appendChild(el('div', { class: 'row-item' }, [
          el('div', { class: 'row-item__main' }, [
            el('span', { class: 'row-item__title', text: (w.display_name || '（表示名なし）') + '  ' + w.email }),
            w.note ? el('span', { class: 'tag', text: w.note }) : null
          ]),
          el('div', { class: 'row-item__ops' }, [
            el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: '許可を外す',
              onclick: function () {
                if (!confirm('この人の執筆許可を外しますか？')) return;
                sb.rpc('admin_remove_writer', { p_user_id: w.user_id })
                  .then(function (r) { if (r.error) throw r.error; return reload(); })
                  .catch(function (err) { EM.notice(msg, EM.errorText(err), 'error'); });
              } })
          ])
        ]));
      });
    }
  });
})(window.EM);
