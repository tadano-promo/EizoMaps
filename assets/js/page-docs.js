/* ============================================================
   Eizo Maps / 案件の書類（見積書・発注書・納品書・請求書）（2026-11-18 翠くん）
   ・金額はデータベースの記録から作る（doc_issue）。出した時点の中身で固定され、2人とも見られる
   ・PDF は「PDFをダウンロード」でそのまま保存（html2canvas + jsPDF を自前で置いて、押したときだけ読む）
   ・源泉徴収は、支払う側のクライアントが選ぶ（する／しない／分からない）。率と欄の名前はデータベースの tax_rules から
   ・書類に載せる自分の情報（屋号・住所・登録番号・ハンコ）は doc_profiles（本人だけが見られる）
   page-projects.js から EMDocs.card(p, role, ctx) で呼ぶ
   ============================================================ */
(function () {
  'use strict';
  var el = EM.el;
  var TYPES = { quote: '御見積書', order: '発注書', delivery: '納品書', invoice: '請求書' };
  function yen(n) { return n == null ? '—' : '¥' + Number(n).toLocaleString('ja-JP'); }
  function ymdJa(s) { if (!s) return '—'; var d = String(s).slice(0, 10).split('-'); return d[0] + '年' + Number(d[1]) + '月' + Number(d[2]) + '日'; }

  /* ---------- PDF ---------- */
  var libsP = null;
  function loadLibs() {
    if (libsP) return libsP;
    function add(src) { return new Promise(function (ok, ng) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ng(new Error('PDFの部品を読み込めませんでした。通信を確かめて、もう一度押してください。')); }; document.head.appendChild(s); }); }
    libsP = add('/assets/vendor/html2canvas-1.4.1.min.js').then(function () { return add('/assets/vendor/jspdf-2.5.2.umd.min.js'); });
    libsP.catch(function () { libsP = null; });
    return libsP;
  }
  // A4（794×1123px）の書類を作る
  function docNode(d) {
    var isInv = d.type === 'invoice';
    var iss = d.issuer || {}, rec = d.recipient || {}, wh = d.withholding || null;
    var rows = (d.items || []).map(function (it) {
      return el('tr', null, [el('td', { text: it.name }), el('td', { class: 'num', text: String(it.qty || 1) }), el('td', { class: 'num', text: yen(it.amount) })]);
    });
    var sum = [
      ['小計（税抜）', yen(d.total_excl)],
      ['消費税（' + (d.tax_rate || 10) + '%）', yen(d.tax)],
      ['合計（税込）', yen(d.total_incl)]
    ];
    if (isInv && wh && wh.choice === 'yes') {
      sum.push([wh.label || '源泉徴収税額', '−' + yen(wh.amount)]);
      sum.push(['お振込み額', yen(d.payable)]);
    }
    var big = isInv ? (wh && wh.choice === 'yes' ? d.payable : d.total_incl) : d.total_incl;
    var bigLabel = { quote: 'お見積り金額', order: 'ご発注金額', delivery: '合計金額', invoice: 'ご請求金額' }[d.type] || '金額';
    var payout = d.payout;
    return el('div', { class: 'docsheet' }, [
      el('div', { class: 'docsheet__head' }, [
        el('h1', { text: d.title }),
        el('div', { class: 'docsheet__meta' }, [
          el('p', { text: '番号：' + d.number }),
          el('p', { text: '発行日：' + ymdJa(d.issued_on) })
        ])
      ]),
      d.subtitle ? el('p', { class: 'docsheet__sub', text: d.subtitle }) : null,
      el('div', { class: 'docsheet__parties' }, [
        el('div', { class: 'docsheet__to' }, [
          el('p', { class: 'docsheet__toname', text: (rec.name || '') + ' ' + (rec.honorific || '様') }),
          el('p', { class: 'docsheet__lead', text: { quote: '下記のとおり、お見積り申し上げます。', order: '下記のとおり、発注いたします。', delivery: '下記のとおり、納品いたしました。', invoice: '下記のとおり、ご請求申し上げます。' }[d.type] }),
          el('div', { class: 'docsheet__big' }, [el('span', { text: bigLabel }), el('strong', { text: yen(big) + (isInv && wh && wh.choice === 'yes' ? '' : '（税込）') })])
        ]),
        el('div', { class: 'docsheet__from' }, [
          el('p', { class: 'docsheet__fromname', text: iss.name || '' }),
          iss.address ? el('p', { text: iss.address }) : null,
          iss.phone ? el('p', { text: 'TEL ' + iss.phone }) : null,
          iss.email ? el('p', { text: iss.email }) : null,
          iss.invoice_no ? el('p', { text: '登録番号：' + iss.invoice_no }) : null,
          iss.stamp ? el('img', { class: 'docsheet__stamp', src: iss.stamp, alt: '' }) : null
        ])
      ]),
      el('table', { class: 'docsheet__items' }, [
        el('thead', null, el('tr', null, [el('th', { text: '内容' }), el('th', { class: 'num', text: '数量' }), el('th', { class: 'num', text: '金額（税込）' })])),
        el('tbody', null, rows)
      ]),
      el('table', { class: 'docsheet__sum' }, el('tbody', null, sum.map(function (r, i) {
        return el('tr', { class: i === sum.length - 1 ? 'is-total' : '' }, [el('th', { text: r[0] }), el('td', { class: 'num', text: r[1] })]);
      }))),
      el('div', { class: 'docsheet__info' }, [
        el('p', { text: '案件：' + (d.project_title || '') }),
        d.due_on ? el('p', { text: (d.type === 'delivery' ? '納期：' : '納期：') + ymdJa(d.due_on) }) : null,
        d.delivered_on ? el('p', { text: '納品日：' + ymdJa(d.delivered_on) }) : null,
        el('p', { text: '10%対象：' + yen(d.total_incl) + '（うち消費税 ' + yen(d.tax) + '）' }),
        isInv && wh && wh.choice === 'yes' ? el('p', { class: 'docsheet__small', text: '源泉徴収税額は、税抜の金額 ' + yen(d.total_excl) + ' に ' + wh.rate_low + '%（' + Number(wh.threshold).toLocaleString('ja-JP') + '円を超える部分は ' + wh.rate_high + '%）をかけて計算しています。' }) : null,
        isInv && payout ? el('div', { class: 'docsheet__payout' }, [
          el('p', { class: 'docsheet__label', text: 'お振込先' }),
          el('p', { text: payout.bank + '　' + payout.branch + '　' + payout.type + '　' + payout.number }),
          el('p', { text: '口座名義：' + payout.holder })
        ]) : null,
        isInv && d.payout_wiped ? el('p', { class: 'docsheet__small', text: 'お振込先は、入金済みのため消しています。' }) : null,
        d.note ? el('div', { class: 'docsheet__note' }, [el('p', { class: 'docsheet__label', text: '備考' }), el('p', { text: d.note })]) : null
      ]),
      el('p', { class: 'docsheet__foot', text: 'この書類は Eizo Maps（eizo-maps.com）の案件の記録から作られています。' + (d.rules_version ? '「この案件の決まり（' + d.rules_version + '版）」に同意して始まった案件です。' : '') })
    ]);
  }
  function downloadPdf(doc, btn) {
    var label = btn.textContent; btn.disabled = true; btn.textContent = 'PDFを作っています…';
    var stage = el('div', { class: 'docstage' }, docNode(doc.data));
    document.body.appendChild(stage);
    return loadLibs().then(function () {
      return window.html2canvas(stage.firstChild, { scale: 2, backgroundColor: '#ffffff', useCORS: false, logging: false });
    }).then(function (canvas) {
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      var w = 210, h = canvas.height * w / canvas.width;
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, Math.min(h, 297));
      pdf.setProperties({ title: doc.data.title + ' ' + doc.number, creator: 'Eizo Maps' });
      // 名前つきで保存（jsPDF の save だと、端末によって名前が「download」になるため自分で保存する）
      var blob = pdf.output('blob'); var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = doc.number + '.pdf';   // 番号だけ（Q=見積書・PO=発注書・D=納品書・INV=請求書）。日本語の名前はうまく付かない端末があるため
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      EM.track('doc_download', { content_type: doc.doc_type });
    }).catch(function (e) { EM.toast(e.message || 'PDFを作れませんでした'); })
      .then(function () { stage.remove(); btn.disabled = false; btn.textContent = label; });
  }

  /* ---------- 書類に載せる自分の情報 ---------- */
  function profileForm(ctx, prof, onSaved) {
    prof = prof || {};
    var name = el('input', { type: 'text', maxlength: '60', value: prof.name || '', placeholder: '例：〇〇映像 山田太郎／株式会社〇〇' });
    var addr = el('input', { type: 'text', maxlength: '200', value: prof.address || '', placeholder: '例：東京都渋谷区〇〇 1-2-3（任意）' });
    var inv = el('input', { type: 'text', maxlength: '14', value: prof.invoice_no || '', placeholder: '例：T1234567890123（任意）' });
    var tel = el('input', { type: 'tel', maxlength: '30', value: prof.phone || '', placeholder: '任意' });
    var mail = el('input', { type: 'email', maxlength: '100', value: prof.email || '', placeholder: '任意' });
    var stamp = prof.stamp_data || null;
    var stampImg = el('img', { class: 'doc-stamp-preview', alt: 'ハンコ', src: stamp || '', hidden: !stamp });
    var stampIn = el('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'attach__input' });
    stampIn.addEventListener('change', function () {
      var f = stampIn.files && stampIn.files[0]; if (!f) return;
      if (f.size > 3 * 1024 * 1024) { EM.toast('3MBまでの画像にしてください'); return; }
      var img = new Image(); var url = URL.createObjectURL(f);
      img.onload = function () {
        var max = 240, r = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        stamp = c.toDataURL('image/png'); stampImg.src = stamp; stampImg.hidden = false; URL.revokeObjectURL(url);
      };
      img.src = url;
    });
    var f = el('form', { class: 'stack flow-form doc-profile', novalidate: true }, [
      el('p', { class: 'small', text: '書類の右上に載る、あなたの情報です。見られるのはあなただけで、書類を出したときに、その時点の内容が書類に写ります。' }),
      el('label', { class: 'field' }, [el('span', { class: 'label', text: '屋号・お名前（会社名）' }), name]),
      el('label', { class: 'field' }, [el('span', { class: 'label', text: '住所（任意）' }), addr]),
      el('label', { class: 'field' }, [el('span', { class: 'label', text: 'インボイスの登録番号（任意）' }), inv,
        el('span', { class: 'hint', text: '登録している人だけ入れてください。Tと13けたの数字です。入れない場合、書類は「適格請求書（インボイス）」にはなりません。' })]),
      el('div', { class: 'row' }, [el('label', { class: 'field' }, [el('span', { class: 'label', text: '電話（任意）' }), tel]), el('label', { class: 'field' }, [el('span', { class: 'label', text: 'メール（任意）' }), mail])]),
      el('div', { class: 'field' }, [el('span', { class: 'label', text: 'ハンコの画像（任意）' }), stampImg,
        el('div', { class: 'form-actions' }, [
          el('label', { class: 'btn btn--sm attach__pick' }, [stampIn, document.createTextNode('＋ 画像を選ぶ')]),
          el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: '外す', onclick: function () { stamp = null; stampImg.hidden = true; } })
        ]),
        el('span', { class: 'hint', text: '白い背景を抜いたPNGがきれいに出ます。' })]),
      el('div', { class: 'form-actions' }, el('button', { type: 'submit', class: 'btn btn--primary', text: '保存する' }))
    ]);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var invv = inv.value.replace(/\s/g, '').toUpperCase();
      if (!name.value.trim()) { EM.notice(ctx.msg, '屋号・お名前を入れてください。', 'error'); return; }
      if (invv && !/^T[0-9]{13}$/.test(invv)) { EM.notice(ctx.msg, '登録番号は「T」と13けたの数字で入れてください。', 'error'); return; }
      ctx.sb.from('doc_profiles').upsert({ user_id: ctx.user.id, name: name.value.trim(), address: addr.value.trim() || null, invoice_no: invv || null,
        phone: tel.value.trim() || null, email: mail.value.trim() || null, stamp_data: stamp, updated_at: new Date().toISOString() }).then(function (r) {
        if (r.error) { EM.notice(ctx.msg, EM.errorText(r.error), 'error'); return; }
        EM.toast('保存しました'); onSaved();
      });
    });
    return f;
  }

  /* ---------- 案件ページの「書類」 ---------- */
  function card(p, role, ctx) {
    var c = role === 'client';
    var box = el('div', { class: 'card flow-terms doc-card' }, [el('p', { class: 'flow-terms__title', text: '書類（見積書・発注書・納品書・請求書）' })]);
    var body = el('div', { class: 'stack' }); box.appendChild(body);
    body.appendChild(el('p', { class: 'small muted', text: '読み込んでいます…' }));
    Promise.all([
      ctx.sb.from('project_documents').select('id,doc_type,number,issued_by,issued_at,data').eq('project_id', p.id).order('issued_at', { ascending: false }),
      ctx.sb.from('doc_profiles').select('name,address,invoice_no,phone,email,stamp_data').eq('user_id', ctx.user.id).maybeSingle(),
      ctx.sb.from('tax_rules').select('effective_from,rate_low,rate_high,threshold,label').eq('kind', 'withholding').order('effective_from', { ascending: false })
    ]).then(function (res) {
      EM.clear(body);
      var docs = (res[0].data || []), prof = res[1].data || null;
      var started = ['in_progress', 'delivered', 'paid', 'closed'].indexOf(p.status) !== -1;
      var settled = !ctx.pendingQuote() && !ctx.openPause();

      // 源泉徴収（クライアントが選ぶ）
      var whText = { yes: 'する', no: 'しない', unknown: 'まだ決めていない（確認中）' }[p.withholding || 'unknown'];
      var whBox = el('div', { class: 'doc-wh' }, [el('p', { class: 'small' }, [el('strong', { text: '源泉徴収：' }), document.createTextNode(whText)])]);
      if (c && started) {
        whBox.appendChild(el('p', { class: 'small muted', text: '支払う側が会社、または従業員のいる個人事業主で、撮影・編集・演出などの報酬を払うときは、源泉徴収が必要になることがあります（国税庁「源泉徴収のあらまし」より）。分からないときは、税理士さんや税務署に確かめてください。' }));
        whBox.appendChild(el('div', { class: 'form-actions' }, ['yes', 'no', 'unknown'].map(function (v) {
          return el('button', { type: 'button', class: 'btn btn--sm' + (p.withholding === v ? ' btn--primary' : ''), text: { yes: 'する', no: 'しない', unknown: '分からない' }[v], onclick: function () {
            ctx.sb.rpc('withholding_set', { p_project: p.id, p_value: v }).then(function (r) { if (r.error) { EM.notice(ctx.msg, EM.errorText(r.error), 'error'); return; } EM.toast('源泉徴収を「' + this.textContent + '」にしました'); ctx.reload(); }.bind(this));
          } });
        })));
      } else if (!c && started && p.withholding === 'unknown') {
        whBox.appendChild(el('p', { class: 'small muted', text: '請求書は、クライアントさんが「源泉徴収をするか」を選んでから作れます。' }));
        whBox.appendChild(el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn--sm', text: '源泉徴収するか、選んでもらうようお願いする', onclick: function () {
          var t = EM.$('#messageBody'); t.value = '請求書を作る前に、案件のページの「書類」で「源泉徴収をするか（する／しない）」を選んでいただけますか？\n'; t.scrollIntoView({ block: 'center' }); t.focus();
        } })));
      }
      if (started || docs.length) body.appendChild(whBox);

      // 作る
      var make = el('div', { class: 'form-actions doc-make' });
      function issueBtn(type, label, opts) {
        opts = opts || {};
        return el('button', { type: 'button', class: 'btn btn--sm', text: label, disabled: !!opts.disabled, title: opts.why || '', onclick: function () {
          if (!confirm(label + 'を作りますか？\n作った書類は、その時点の内容で記録され、相手にも届きます。')) return;
          var note = window.prompt('備考（書類の下に載ります。なければ空のままOK）', '') || null;
          ctx.sb.rpc('doc_issue', { p_project: p.id, p_type: type, p_quote: opts.quote || null, p_note: note, p_include_payout: true }).then(function (r) {
            if (r.error) { EM.notice(ctx.msg, EM.errorText(r.error), 'error'); return; }
            EM.toast(label + 'を作りました'); EM.track('doc_issue', { content_type: type }); ctx.reload();
          });
        } });
      }
      if (!c) {
        var qs = ctx.quotes();
        if (p.terms_amount != null) make.appendChild(issueBtn('quote', '見積書（1回目）'));
        qs.forEach(function (q) { make.appendChild(issueBtn('quote', '見積書（' + q.version + '回目）', { quote: q.id })); });
        if (started) {
          make.appendChild(issueBtn('delivery', '納品書', { disabled: ['delivered', 'paid', 'closed'].indexOf(p.status) === -1 || !settled }));
          make.appendChild(issueBtn('invoice', '請求書', { disabled: !settled || p.withholding === 'unknown' }));
        }
      } else if (started) {
        make.appendChild(issueBtn('order', '発注書', { disabled: !settled }));
      }
      if (make.childNodes.length) {
        body.appendChild(el('p', { class: 'small', text: c ? '作れる書類' : '作れる書類（金額は、確定した記録から自動で入ります）' }));
        body.appendChild(make);
        if (!settled) body.appendChild(el('p', { class: 'small muted', text: '確定待ちの見積もりや一時停止があるあいだは、発注書・納品書・請求書は作れません。' }));
        if (!c && ['delivered', 'paid', 'closed'].indexOf(p.status) === -1 && started) body.appendChild(el('p', { class: 'small muted', text: '納品書は「納品済み」にしてから作れます。' }));
      }

      // 自分の情報
      var pf = profileForm(ctx, prof, ctx.reload); pf.hidden = true;
      body.appendChild(el('div', { class: 'form-actions' }, [
        el('span', { class: 'small ' + (prof ? 'muted' : ''), text: prof ? '書類に載せる自分の情報：' + prof.name + (prof.invoice_no ? '（登録番号あり）' : '') : '書類に載せる自分の情報がまだありません（いまは表示名で載ります）' }),
        el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: prof ? '直す' : '入れる', onclick: function () { pf.hidden = !pf.hidden; } })
      ]));
      body.appendChild(pf);

      // 出した書類
      if (docs.length) {
        body.appendChild(el('p', { class: 'small', text: '出した書類（' + docs.length + '）' }));
        body.appendChild(el('ul', { class: 'doc-list' }, docs.map(function (d) {
          var mine = d.issued_by === ctx.user.id;
          var btn = el('button', { type: 'button', class: 'btn btn--sm', text: 'PDFをダウンロード' });
          btn.addEventListener('click', function () { downloadPdf(d, btn); });
          return el('li', null, [
            el('div', null, [
              el('strong', { text: (d.data && d.data.title) || TYPES[d.doc_type] }),
              d.data && d.data.subtitle ? el('span', { class: 'small muted', text: '　' + d.data.subtitle }) : null,
              el('p', { class: 'small muted', text: d.number + '・' + EM.date(d.issued_at) + '・' + (mine ? 'あなたが作成' : '相手が作成') + '・' + yen(d.data && (d.doc_type === 'invoice' && d.data.payable != null ? d.data.payable : d.data.total_incl)) })
            ]),
            btn
          ]);
        })));
      } else {
        body.appendChild(el('p', { class: 'small muted', text: 'まだ書類はありません。よそで作った請求書などは、下の「やり取り」にPDFで付けて送れます。' }));
      }
    });
    return box;
  }
  window.EMDocs = { card: card, docNode: docNode };
})();
