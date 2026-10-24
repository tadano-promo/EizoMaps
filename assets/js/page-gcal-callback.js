/* Google アカウントの追加から戻ってきたときの中継ページ。
   Google から届いた「許可の番号」をこのタブの中だけに一時的に預けて、すぐスケジュールの画面へ移る。
   （アドレス欄に番号を残さない・ほかのページに送らない） */
(function () {
  var q = new URLSearchParams(location.search);
  var back = {
    code: q.get('code') || '',
    state: q.get('state') || '',
    error: q.get('error') || ''
  };
  try { sessionStorage.setItem('em_gadd_back', JSON.stringify(back)); } catch (e) { /* 預けられないときは、スケジュール側で知らせる */ }
  location.replace('/schedule/?gcal=added');
})();
