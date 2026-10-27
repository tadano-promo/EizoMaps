const {chromium}=require('playwright');const fs=require('fs');
const css=`*{box-sizing:border-box;margin:0;padding:0}
body{width:1200px;height:675px;background:#0a0a0f;color:#f0f0f5;font-family:'Noto Sans CJK JP','Noto Sans JP',sans-serif;overflow:hidden;position:relative}
body:before{content:'';position:absolute;right:-180px;top:-220px;width:760px;height:760px;background:radial-gradient(circle,rgba(232,255,71,.13),transparent 62%)}
.wrap{position:absolute;inset:0;padding:64px 64px 56px;display:grid;grid-template-columns:1.12fr .88fr;gap:40px;align-items:center}
.eyebrow{font-family:'DejaVu Sans Mono',monospace;font-size:17px;letter-spacing:.14em;color:#e8ff47;margin-bottom:22px}
h1{font-size:46px;line-height:1.32;font-weight:900;letter-spacing:.01em;white-space:nowrap}
h1 em{font-style:normal;color:#e8ff47}
.sub{margin-top:24px;font-size:20px;line-height:1.7;color:#b8b8c8}
.foot{position:absolute;left:64px;right:64px;bottom:40px;display:flex;justify-content:space-between;align-items:center;font-size:18px;color:#8a8aa0}
.logo{font-weight:900;font-size:26px;color:#f0f0f5}.logo b{color:#e8ff47}
.url{font-family:'DejaVu Sans Mono',monospace;color:#e8ff47}
.card{background:#14141c;border:1px solid #2a2a35;border-radius:18px;padding:24px;box-shadow:0 30px 60px rgba(0,0,0,.5)}
.small{font-size:15px;color:#8a8aa0}
.row{display:flex;align-items:center;gap:12px;background:#1b1b24;border:1px solid #2a2a35;border-radius:10px;padding:12px 14px;margin-top:10px}
.row b{font-size:17px}.row small{display:block;font-size:13px;color:#8a8aa0;margin-top:3px}
.th{width:26px;height:34px;border-radius:5px;flex:none}
.g1{background:linear-gradient(135deg,#5a4a7a,#24203a)}.g2{background:linear-gradient(135deg,#2f6b7a,#142a33)}.g3{background:linear-gradient(135deg,#7a4a3a,#331c16)}.g4{background:linear-gradient(135deg,#4a7a4f,#1a2e1c)}.g5{background:linear-gradient(135deg,#7a6a3a,#2e2714)}.g6{background:linear-gradient(135deg,#3a4f7a,#161e33)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.grid span{height:74px;border-radius:8px;position:relative;border:1px solid rgba(255,255,255,.1)}
.grid span:after{content:'';position:absolute;left:50%;top:50%;transform:translate(-40%,-50%);border-left:14px solid rgba(255,255,255,.85);border-top:9px solid transparent;border-bottom:9px solid transparent}
.av{width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#3a3f55,#6b7090);margin:0 auto 10px}
.center{text-align:center}.btn{display:inline-block;background:#e8ff47;color:#111;font-weight:900;border-radius:8px;padding:10px 22px;font-size:17px}
.inp{font-family:'DejaVu Sans Mono',monospace;letter-spacing:.3em;background:#1b1b24;border:1px solid #2a2a35;border-radius:8px;padding:11px;margin:14px 0 10px;font-size:18px}
.pill{display:inline-block;font-size:13px;padding:4px 10px;border-radius:99px;border:1px solid #3a3a48;color:#b8b8c8;margin:3px}
.pill.on{border-color:#e8ff47;color:#e8ff47}
.lbl{font-size:13px;color:#8a8aa0;margin-bottom:6px}
.tag{font-size:12px;padding:3px 9px;border-radius:99px;margin-left:auto;white-space:nowrap}
.warn{border:1px solid #ff8b6b;color:#ff8b6b}.ok{border:1px solid #e8ff47;color:#e8ff47}`;
const foot=`<div class="foot"><span class="logo">Eizo <b>Maps</b></span><span>登録は無料　<span class="url">eizo-maps.com</span></span></div>`;
const T=[
{id:'01_stock',eye:'EIZO MAPS ／ パスワード付きの作品集',h:'作品リールに、<br><em>カギをかけて渡す。</em>',s:'表に出せない案件も、発表前の作品も。<br>URLを貼るだけで、パスワード付きの作品集に。',m:`<div class="card center"><div class="av"></div><div class="small">Eizo｜作品集 2026</div><div class="inp">••••••••</div><span class="btn">開く</span><div class="small" style="margin-top:12px">開く前に見えるのは、名前とタイトルだけ</div></div>`},
{id:'02_share',eye:'EIZO MAPS ／ 営業先ごとの共有リンク',h:'営業先ごとに、<br><em>見せる作品を変える。</em>',s:'相手に合わせて作品を選んで、リンクを分けて送るだけ。<br>相手は登録なしで開けます。',m:`<div class="card"><div class="small">営業用の共有リンク</div>
<div class="row"><span class="th g1"></span><span class="th g2"></span><span class="th g3"></span><span><b>食品メーカーさま向け</b><small>3作品 ／ 閲覧 4回</small></span></div>
<div class="row"><span class="th g4"></span><span class="th g5"></span><span><b>制作会社さま向け</b><small>5作品 ／ 閲覧 1回</small></span></div>
<div class="row" style="opacity:.45"><span class="th g6"></span><span><b>アパレルさま向け</b><small>2作品 ／ 停止中</small></span></div></div>`},
{id:'03_works',eye:'EIZO MAPS ／ 作品を1か所に',h:'あちこちにある作品を、<br><em>1か所に。</em>',s:'YouTube・Vimeo・TikTok・SNS・クライアントのサイト。<br>動画は置いてある場所のまま、URLを貼るだけ。',m:`<div class="card"><div style="display:flex;gap:14px;align-items:center"><div class="av" style="margin:0"></div><div><b style="font-size:19px">Eizo</b><div class="small">映像ディレクター</div></div></div>
<div style="margin-top:12px"><span class="pill">YouTube</span><span class="pill">Vimeo</span><span class="pill">TikTok</span><span class="pill">Instagram</span><span class="pill">クライアントのサイト</span></div>
<div class="grid"><span class="g1"></span><span class="g2"></span><span class="g3"></span><span class="g4"></span><span class="g5"></span><span class="g6"></span></div></div>`},
{id:'04_handle',eye:'EIZO MAPS ／ @ハンドル',h:'「実績を見せて」には、<br><em>URLを1本。</em>',s:'プロフィールは「eizo-maps.com/@名前」の<br>覚えやすいURLで渡せます。',m:`<div class="card center"><div class="av"></div><b style="font-size:22px">Eizo</b><div class="small">映像ディレクター</div>
<div class="inp" style="letter-spacing:0;color:#e8ff47;font-size:22px;margin-top:18px">eizo-maps.com/@eizo</div><span class="btn">URL をコピー</span></div>`},
{id:'05_day',eye:'EIZO MAPS ／ 1日の時間割',h:'撮影の裏の動きまで、<br><em>1枚の時間割に。</em>',s:'予定の中に、担当ごとのタイムテーブル。<br>同じ時間に別々に動く班も、横に並べて見られます。',m:`<div class="card"><div class="small">春の新商品 Web CM ／ 撮影 6:00〜22:00</div>
<div style="display:grid;grid-template-columns:52px 1fr 1fr 1fr;gap:6px;margin-top:12px;font-size:13px">
<div></div><div class="lbl">撮影チーム</div><div class="lbl">車両</div><div class="lbl">キャスト対応</div>
<div class="small">7:00</div><div></div><div class="row" style="margin:0;padding:8px;background:#1f2a1a">弁当ピックアップ</div><div class="row" style="margin:0;padding:8px;background:#2a1f2e">キャスト迎え</div>
<div class="small">9:00</div><div class="row" style="margin:0;padding:8px;background:#2e2a12">撮影開始</div><div></div><div class="row" style="margin:0;padding:8px;background:#2a1f2e">メイク</div>
<div class="small">13:00</div><div class="row" style="margin:0;padding:8px;background:#2e2a12">屋外カット</div><div class="row" style="margin:0;padding:8px;background:#1f2a1a">移動</div><div></div>
<div class="small">25:00</div><div class="row" style="margin:0;padding:8px;background:#2e2a12">撤収</div><div></div><div></div></div></div>`},
{id:'06_schedule_share',eye:'EIZO MAPS ／ 予定の共有リンク',h:'予定を見せる範囲は、<br><em>相手ごとに。</em>',s:'相手ごとにリンクとパスワード。相手は登録不要で、見るだけ。<br>クライアントには撮影チームの流れだけ、もできます。',m:`<div class="card"><div class="small">案件：春の新商品 Web CM</div>
<div class="row"><b>スタッフ全員</b><span class="tag ok">予定＋全部の担当</span></div>
<div class="row"><b>クライアントさま</b><span class="tag ok">撮影チームだけ</span></div>
<div class="row"><b>代理店さま</b><span class="tag ok">予定だけ</span></div>
<div class="small" style="margin-top:12px">期限：案件の最後の日から30日後に自動で止まる</div></div>`},
{id:'07_gantt',eye:'EIZO MAPS ／ ガントチャート',h:'案件の全体を、<br><em>1本の棒で見渡す。</em>',s:'案件ごとの最初の予定から最後の予定、納品や納期まで。<br>4週間・8週間・3か月・半年で切り替え。',m:`<div class="card"><div style="display:grid;grid-template-columns:120px 1fr;gap:10px 12px;align-items:center;font-size:14px">
<div>Web CM 15秒</div><div style="position:relative;height:16px"><div style="position:absolute;left:5%;width:55%;height:10px;top:3px;border-radius:5px;background:#e8ff47"></div><div style="position:absolute;left:62%;top:-1px;color:#7ad97a">◆</div></div>
<div>ブランドムービー</div><div style="position:relative;height:16px"><div style="position:absolute;left:25%;width:60%;height:10px;top:3px;border-radius:5px;background:#6aa8ff"></div><div style="position:absolute;left:87%;top:-1px;color:#7ad97a">◆</div></div>
<div>縦型ショート</div><div style="position:relative;height:16px"><div style="position:absolute;left:45%;width:30%;height:10px;top:3px;border-radius:5px;border:2px dashed #ffa24a"></div></div>
<div>採用動画</div><div style="position:relative;height:16px"><div style="position:absolute;left:12%;width:30%;height:10px;top:3px;border-radius:5px;background:#b48aff"></div><div style="position:absolute;left:44%;top:-1px;color:#7ad97a">◆</div></div></div>
<div class="small" style="margin-top:16px">◆ 納品・納期　┆ 点線は仮押さえ</div></div>`},
{id:'08_templates',eye:'EIZO MAPS ／ 定型文のひな形',h:'集合案内も納品連絡も、<br><em>埋めるだけで完成。</em>',s:'{案件名} {日にち} のような差し替え欄に入れるだけ。<br>予定から案件名・日にち・場所も入れられます。',m:`<div class="card"><div class="lbl">ひな形：撮影の集合案内</div>
<div style="font-size:16px;line-height:1.9;background:#1b1b24;border:1px solid #2a2a35;border-radius:10px;padding:14px">お疲れさまです。<br><span style="color:#e8ff47">春の新商品 Web CM</span> の撮影は<br><span style="color:#e8ff47">11月12日（水）</span> <span style="color:#e8ff47">6:00</span> 集合です。<br>場所：<span style="color:#ff8b6b">｛場所｝</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><span class="small">未入力 1件</span><span class="btn" style="font-size:15px;padding:8px 16px">完成文をコピー</span></div></div>`},
{id:'09_reviews',eye:'EIZO MAPS ／ 評価',h:'評価は、<br><em>取引した人だけが書ける。</em>',s:'お金を払った人を上に出すことは、しません。<br>納得できない評価には、異議申し立てもできます。',m:`<div class="card"><div style="font-size:26px;color:#e8ff47;letter-spacing:.1em">★★★★★</div>
<div style="font-size:16px;line-height:1.8;margin-top:8px">段取りの説明が丁寧で、撮影当日も迷わず進みました。</div>
<div class="small" style="margin-top:6px">Eizo Maps 外の取引（運営が確認して公開）</div>
<div class="row"><b style="font-size:15px">書いた人の名前は表示されません</b></div>
<div class="row"><b style="font-size:15px">異議申し立て中も、印を付けて表示</b></div></div>`},
{id:'10_safety',eye:'EIZO MAPS ／ 作品を載せる前に',h:'載せてよい作品だけを、<br><em>載せてよい日から。</em>',s:'登録のときに「載せる許可」を確認。<br>発表前の作品は、解禁日まで表に出しません。<br>勝手に載せられた作品は、削除の申し立てができます。',m:`<div class="card"><div class="row"><span class="th g2"></span><span><b>春の新商品 Web CM 15秒</b><small>載せる許可：確認済み（10/20）</small></span><span class="tag ok">公開中</span></div>
<div class="row"><span class="th g3"></span><span><b>ブランドムービー 90秒</b><small>解禁日：11/1 から表示</small></span><span class="tag warn">解禁前</span></div>
<div class="row"><span class="th g5"></span><span><b>縦型ショート 3本セット</b><small>パスワードページだけ</small></span><span class="tag ok">限定</span></div></div>`}
];
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1200,height:675},deviceScaleFactor:1});
for(const t of T){const html=`<!doctype html><meta charset="utf-8"><style>${css}</style><div class="wrap"><div><p class="eyebrow">${t.eye}</p><h1>${t.h}</h1><p class="sub">${t.s}</p></div><div>${t.m}<p class="small" style="text-align:right;margin-top:10px;font-size:12px">※画面はイメージです（名前・作品は見本）</p></div></div>${foot}`;
await p.setContent(html);await p.waitForTimeout(200);await p.screenshot({path:`eizomaps_${t.id}.png`});}
await b.close();console.log(T.length);})();
