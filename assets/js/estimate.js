/* Eizo Maps — 実行表（見積もり・実行予算）の土台（2026-11-15 翠くん）
   ・12の費目（翠くんの見積もりの型）
   ・ことばから表にする「決まった言葉で読む」しくみ（AI が使えないとき・上限を超えたときもこれで動く）
   ・抜けやすいものを聞き返す（「キャストは要りませんか？」「お弁当は何人分？」など）
   単価は「目安」。翠くんが直しやすいよう、このファイルの ITEMS にまとめてある。 */
(function (EM) {
  'use strict';

  var CATS = [
    ['01', '企画・構成費'], ['02', '制作準備費'], ['03', '進行管理費'], ['04', 'スタッフ費'],
    ['05', 'キャスト費'], ['06', '撮影・照明機材費'], ['07', 'スタジオ・ロケ・美術費'], ['08', '編集・CG費'],
    ['09', '音楽・効果音費'], ['10', '録音・MA費'], ['11', '交通・食事費'], ['12', 'その他・予備費']
  ];

  // [費目, 項目名, 単位, 見積単価, 実行単価, 読み取る言葉..., 撮影日数に合わせるか]
  // 単価は小〜中規模の Web 向け案件の目安（実在の案件の数字ではない）。案件ごとに直して使う
  var ITEMS = [
    ['01', '企画・構成', '式', 100000, 0, ['企画', '構成案'], false],
    ['01', '絵コンテ', '式', 50000, 30000, ['絵コンテ', 'コンテ'], false],
    ['01', '台本', '式', 50000, 0, ['台本', '脚本'], false],
    ['02', 'ロケハン（下見）', '日', 30000, 15000, ['ロケハン', '下見'], false],
    ['02', 'オーディション・キャスティング', '式', 50000, 30000, ['オーディション', 'キャスティング'], false],
    ['03', 'プロデューサー', '式', 100000, 0, ['プロデューサー', 'プロデュース'], false],
    ['03', '制作進行', '日', 25000, 20000, ['制作進行', 'PM', '進行'], true],
    ['04', '監督・ディレクター', '日', 80000, 60000, ['監督', 'ディレクター', '演出'], true],
    ['04', 'カメラマン', '日', 60000, 50000, ['カメラマン', '撮影技師', 'カメラ'], true],
    ['04', '撮影助手', '日', 25000, 20000, ['撮影助手', 'カメアシ'], true],
    ['04', '照明', '日', 50000, 40000, ['照明', 'ライトマン'], true],
    ['04', '照明助手', '日', 25000, 20000, ['照明助手'], true],
    ['04', '録音（音声）', '日', 40000, 35000, ['音声', '録音', 'マイク'], true],
    ['04', 'ヘアメイク', '日', 40000, 30000, ['ヘアメイク', 'メイク'], true],
    ['04', 'スタイリスト', '日', 40000, 30000, ['スタイリスト'], true],
    ['04', '美術スタッフ', '日', 50000, 40000, ['美術スタッフ', '美術さん'], true],
    ['04', 'ドローン撮影', '日', 80000, 60000, ['ドローン'], true],
    ['04', 'スチール（写真）', '日', 50000, 40000, ['スチール', 'カメラマン（写真）'], true],
    ['05', '出演者（キャスト）', '人', 100000, 70000, ['出演', 'キャスト', 'モデル', 'タレント', '役者', '俳優'], false],
    ['05', 'エキストラ', '人', 10000, 7000, ['エキストラ'], false],
    ['05', 'ナレーター', '式', 50000, 35000, ['ナレーター', 'ナレーション'], false],
    ['06', 'カメラ機材', '日', 50000, 35000, ['カメラ機材', '撮影機材', '機材'], true],
    ['06', '照明機材', '日', 40000, 30000, ['照明機材'], true],
    ['06', '録音機材', '日', 15000, 10000, ['録音機材'], true],
    ['06', '消耗品', '式', 10000, 8000, ['消耗品'], false],
    ['07', 'スタジオ', '日', 150000, 120000, ['スタジオ'], true],
    ['07', 'ロケ地の使用料', '日', 50000, 40000, ['ロケ地', 'ロケ'], true],
    ['07', '美術・小道具', '式', 50000, 35000, ['美術', '小道具', 'セット'], false],
    ['07', '衣装', '式', 30000, 20000, ['衣装'], false],
    ['08', '編集', '日', 40000, 30000, ['編集', 'オフライン'], false],
    ['08', 'テロップ・字幕', '式', 20000, 15000, ['テロップ', '字幕'], false],
    ['08', '色の調整（カラー）', '日', 60000, 45000, ['カラー', 'グレーディング', '色調整', '色の調整'], false],
    ['08', 'CG・モーション', '式', 100000, 80000, ['CG', 'モーション', 'アニメーション', '合成'], false],
    ['08', 'オンライン編集', '日', 80000, 60000, ['オンライン編集'], false],
    ['09', 'オリジナル曲', '曲', 150000, 100000, ['作曲', 'オリジナル曲', 'オリジナル音楽'], false],
    ['09', 'BGM（音源）', '曲', 20000, 10000, ['BGM', '音源', '音楽'], false],
    ['09', '効果音', '式', 10000, 5000, ['効果音', 'SE'], false],
    ['10', 'ナレーション収録', '式', 30000, 20000, ['ナレ収録', 'ナレーション収録', '収録'], false],
    ['10', 'MA（音の仕上げ）', '式', 80000, 60000, ['MA', '音の仕上げ'], false],
    ['11', '車両（ロケバス）', '日', 40000, 30000, ['車両', 'ロケバス', 'ハイエース', '機材車'], true],
    ['11', '交通費', '式', 20000, 20000, ['交通費', '新幹線', '移動'], false],
    ['11', 'お弁当', '食', 1200, 1000, ['弁当', 'お弁当', 'ロケ弁', '食事'], false],
    ['11', '駐車場', '日', 3000, 3000, ['駐車場'], true],
    ['12', '撮影保険', '式', 10000, 8000, ['保険'], false],
    ['12', '雑費', '式', 10000, 10000, ['雑費'], false],
    ['12', '予備費', '式', 0, 0, ['予備費', '予備'], false]
  ];

  function itemByName(name) { for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i][1] === name) return ITEMS[i]; return null; }
  function line(it, qty) {
    return { cat: it[0], name: it[1], unit: it[2], price: it[3], qty: qty, cost: it[4], costQty: qty, note: '' };
  }
  function num(s) { var z = String(s).replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); return Number(z); }

  // ことば → 行（決まった言葉で読む）
  //   例：「CM撮影1日、カメラマン・照明・音声、編集5日、出演2名、エキストラ10人、東京」
  function parse(text) {
    var t = String(text || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    var days = 0, m;
    if (/撮影\s*半日|半日\s*撮影/.test(t)) days = 0.5;
    if ((m = t.match(/撮影\s*(\d+(?:\.\d+)?)\s*日/)) || (m = t.match(/(\d+(?:\.\d+)?)\s*日\s*撮影/))) days = num(m[1]);
    var found = [], used = {};
    // 長い言葉から先に見る（「照明助手」を「照明」より先に、など）
    var keys = [];
    ITEMS.forEach(function (it) { it[5].forEach(function (k) { keys.push([k, it]); }); });
    keys.sort(function (a, b) { return b[0].length - a[0].length; });
    var rest = t;
    keys.forEach(function (pair) {
      var k = pair[0], it = pair[1];
      var idx = rest.indexOf(k);
      if (idx === -1 || used[it[1]]) return;
      if (it[1] === 'ロケ地の使用料' && /ロケハン|ロケ弁|ロケバス/.test(rest.slice(idx, idx + 4))) return;
      used[it[1]] = 1;
      var after = rest.slice(idx + k.length, idx + k.length + 8);
      var q = null, mm;
      if ((mm = after.match(/^\s*[×x]?\s*(\d+(?:\.\d+)?)\s*(日|人|名|食|個|曲|本|式|回)?/))) q = num(mm[1]);
      if (q === null && /^\s*半日/.test(after)) q = 0.5;
      if (q === null) q = it[6] ? (days || 1) : 1;
      found.push(line(it, q));
      rest = rest.slice(0, idx) + '　'.repeat(k.length) + rest.slice(idx + k.length);   // 同じ言葉を2回読まない
    });
    return { lines: sortLines(found), shootDays: days };
  }

  function sortLines(ls) { return ls.slice().sort(function (a, b) { return a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : 0; }); }
  function has(lines, re) { return lines.some(function (l) { return re.test(l.name); }); }
  function sumQty(lines, re) { return lines.filter(function (l) { return re.test(l.name); }).reduce(function (s, l) { return s + (Number(l.qty) || 0); }, 0); }

  // 抜けやすいものを聞き返す（翠くん：「キャスト要りませんか」「エキストラ」「お弁当忘れてませんか」）
  //   返すのは [質問, 足すときの行（なければ null）]
  function checks(lines, shootDays) {
    var q = [];
    var shoot = shootDays > 0 || has(lines, /カメラマン|監督|撮影/);
    var days = shootDays || (shoot ? 1 : 0);
    var staff = lines.filter(function (l) { return l.cat === '04'; }).length + (has(lines, /制作進行/) ? 1 : 0) + 1;
    var cast = sumQty(lines, /出演者|エキストラ/);
    if (shoot && !has(lines, /監督/)) q.push(['監督・ディレクターは誰がしますか？　自分でするなら、行は入れて単価を0円にしておくと確認になります。', line(itemByName('監督・ディレクター'), days || 1)]);
    if (has(lines, /カメラマン/) && !has(lines, /カメラ機材/)) q.push(['カメラ機材は入っていますか？　カメラマンの持ち込みでも、機材費として分けておくと値引きの相談がしやすくなります。', line(itemByName('カメラ機材'), days || 1)]);
    if (has(lines, /^照明$/) && !has(lines, /照明機材/)) q.push(['照明機材は入っていますか？', line(itemByName('照明機材'), days || 1)]);
    if (shoot && !has(lines, /出演者/)) q.push(['出演者（キャスト）は要りませんか？　社員さんやお店の方が出るなら0円でも、行は入れておくと確認になります。', line(itemByName('出演者（キャスト）'), 1)]);
    if (shoot && has(lines, /出演者/) && !has(lines, /エキストラ/)) q.push(['エキストラは要りませんか？　店内・街なかのシーンは、人がいないと寂しく見えます。', line(itemByName('エキストラ'), 5)]);
    if (shoot && !has(lines, /お弁当/)) {
      var heads = Math.max(3, staff + cast);
      q.push(['お弁当を忘れていませんか？　スタッフと出演者で ' + heads + '人くらい × ' + days + '日 = ' + Math.ceil(heads * days) + '食 の目安です。', line(itemByName('お弁当'), Math.ceil(heads * days))]);
    }
    if (shoot && has(lines, /出演者/) && !has(lines, /ヘアメイク/)) q.push(['出演者のヘアメイク・衣装はどうしますか？', line(itemByName('ヘアメイク'), days || 1)]);
    if (shoot && !has(lines, /車両/)) q.push(['機材の運搬や移動の車両は要りませんか？', line(itemByName('車両（ロケバス）'), days || 1)]);
    if (has(lines, /ロケ地/) && !has(lines, /ロケハン/)) q.push(['ロケハン（下見）はしますか？', line(itemByName('ロケハン（下見）'), 1)]);
    if (!has(lines, /プロデューサー|制作進行/)) q.push(['進行管理費（打ち合わせ・調整・やりとり）は入っていますか？　0円にすると、やりとりが多い案件ほど赤字になります。', line(itemByName('プロデューサー'), 1)]);
    if (has(lines, /編集/) && !has(lines, /BGM|オリジナル曲/)) q.push(['音楽（BGM）はどうしますか？　使う場所や期間で使用料が変わります。', line(itemByName('BGM（音源）'), 1)]);
    if (has(lines, /ナレーター/) && !has(lines, /ナレーション収録|MA/)) q.push(['ナレーションの収録と、音の仕上げ（MA）は入っていますか？', line(itemByName('ナレーション収録'), 1)]);
    if (shoot && !has(lines, /撮影保険/)) q.push(['撮影保険は入れますか？　機材の破損や、けがに備えます。', line(itemByName('撮影保険'), 1)]);
    if (!has(lines, /予備費/)) q.push(['予備費（全体の5〜10%）は入れますか？　天気や追加の対応で慌てずにすみます。', null]);
    return q;
  }

  function amount(l) { return Math.round((Number(l.price) || 0) * (Number(l.qty) || 0)); }
  function costAmount(l) { return Math.round((Number(l.cost) || 0) * (Number(l.costQty === undefined ? l.qty : l.costQty) || 0)); }
  function totals(lines) {
    var byCat = {}, sell = 0, cost = 0;
    lines.forEach(function (l) {
      var a = amount(l), c = costAmount(l);
      sell += a; cost += c;
      var b = byCat[l.cat] = byCat[l.cat] || { sell: 0, cost: 0 };
      b.sell += a; b.cost += c;
    });
    var profit = sell - cost;
    return { sell: sell, cost: cost, profit: profit, rate: sell ? profit / sell : 0, byCat: byCat };
  }
  function yen(n) { return Math.round(Number(n) || 0).toLocaleString('ja-JP') + '円'; }

  EM.est = { CATS: CATS, ITEMS: ITEMS, parse: parse, checks: checks, totals: totals, amount: amount, costAmount: costAmount,
             line: line, itemByName: itemByName, sortLines: sortLines, yen: yen };
})(window.EM);
