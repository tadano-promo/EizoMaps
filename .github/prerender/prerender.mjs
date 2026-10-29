// Eizo Maps — クリエイターのページを「最初から中身が入った形」で書き出す
//
// なぜ必要か：
//   ふだんのクリエイターのページは、開いたあとにブラウザがデータを取りに行って表示する。
//   そのままだと、ChatGPT などの AI や一部の検索エンジンが読みに来たとき中身が空に見え、
//   さらに eizo-maps.com/@名前 は裏側で「ページがありません（404）」を返してしまう。
//   そこで公開の前に、公開中のクリエイターごとに
//     ・プロフィール・作品・評価とコメントを書き込んだ HTML（/@ハンドル.html）
//     ・サイトの地図（sitemap.xml）への追加
//   を作る。ページを開いた人のブラウザでは、これまでどおり最新のデータで描き直される。
//
// 使うのは公開用の鍵（publishable）だけ。ログインしていない人が見られるものしか取れない。
// 取得に失敗したときは止める（公開しない）ので、前回の公開がそのまま残る。

import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = process.argv[2] || '.';
const SITE = 'https://eizo-maps.com';

const cfg = readFileSync(`${ROOT}/assets/js/config.js`, 'utf8');
const URL_ = (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1];
const KEY = (cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
if (!URL_ || !KEY || !/^sb_publishable_/.test(KEY)) {
  console.error('公開用の鍵が見つかりません'); process.exit(1);
}

async function get(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${await r.text()}`);
  return r.json();
}
const inList = (a) => `in.(${a.map((x) => `"${x}"`).join(',')})`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const stars = (score) => {
  const s = Math.max(0, Math.min(5, Number(score) || 0));
  const full = Math.floor(s + 0.001), half = (s - full) >= 0.5 ? 1 : 0;
  return '★'.repeat(full) + (half ? '⯨' : '') + '☆'.repeat(Math.max(0, 5 - full - half));
};
// 日本時間の日付（例：2026.10.29）
const jpDate = (iso) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return isNaN(d) ? '' : `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
};
const isoDay = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const safeUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const PLATFORM = { youtube: 'YouTube', vimeo: 'Vimeo', tiktok: 'TikTok', x: 'X', twitter: 'X', instagram: 'Instagram', facebook: 'Facebook', note: 'note', website: 'Website' };

const todayJst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

const creators = await get('creators?select=id,user_id,handle,display_name,headline,bio,area_pref,area_city,years_of_experience,response_time_hours,avatar_url,website_url,updated_at,creator_genres(genre_id)&is_published=eq.true&approved=eq.true&suspended=eq.false&order=created_at');
const genres = await get('genres?select=id,name_ja');
const gmap = Object.fromEntries(genres.map((g) => [g.id, g.name_ja]));

let works = [], reviews = [], stats = [], links = [];
if (creators.length) {
  const ids = creators.map((c) => c.id), uids = creators.map((c) => c.user_id);
  works = await get(`portfolios?select=creator_id,title,description,provider,video_url,release_on,takedown_hold,sort_order,created_at&visibility=eq.public&creator_id=${inList(ids)}&order=sort_order,created_at.desc`);
  reviews = await get(`public_reviews?select=reviewee_id,score,comment,reviewer_role,published_at,source,objected,objection_kept&reviewee_id=${inList(uids)}&order=published_at.desc`);
  stats = await get(`creator_project_stats?select=creator_id,completed_count&creator_id=${inList(ids)}`);
  links = await get(`creator_links?select=creator_id,platform,url,label,sort_order,created_at&creator_id=${inList(ids)}&order=sort_order,created_at`);
}

const template = readFileSync(`${ROOT}/creators/detail.html`, 'utf8');
const sitemapUrls = [];
let written = 0;

// 評価に付ける印（取引の種類・異議申し立て）
const mark = (v) => `<div class="tags review-marks"><span class="tag">${v.source === 'external' ? 'Eizo Maps外の取引（自己申告）' : 'Eizo Maps での取引'}</span>${
  v.objected ? '<span class="tag tag--warn">本人から異議申し立てあり（運営が確認中）</span>'
    : v.objection_kept ? '<span class="tag tag--warn">本人から異議申し立てあり・運営の確認により掲載継続</span>' : ''}</div>`;

for (const c of creators) {
  const myWorks = works.filter((w) => w.creator_id === c.id && !w.takedown_hold && !(w.release_on && w.release_on > todayJst));
  const myReviews = reviews.filter((r) => r.reviewee_id === c.user_id).slice(0, 50);
  const myLinks = links.filter((l) => l.creator_id === c.id).map((l) => ({ ...l, url: safeUrl(l.url) })).filter((l) => l.url);
  const completed = (stats.find((s) => s.creator_id === c.id) || {}).completed_count || 0;
  const tags = (c.creator_genres || []).map((g) => gmap[g.genre_id]).filter(Boolean);
  const area = [c.area_pref, c.area_city].filter(Boolean).join(' ');
  const avg = myReviews.length ? myReviews.reduce((a, b) => a + Number(b.score), 0) / myReviews.length : null;

  const path = c.handle ? `/@${c.handle}` : `/creators/${c.id}`;
  const url = SITE + path;
  const name = c.display_name;
  const ratingText = avg !== null ? `評価 ${avg.toFixed(1)}（${myReviews.length}件）` : '評価はまだありません';
  const desc = clip(`${name}${c.headline ? '（' + c.headline + '）' : ''}のプロフィール。${tags.length ? tags.join('・') + '。' : ''}${area ? area + '。' : ''}${ratingText}。${c.bio || ''}`, 150);
  const title = `${name}${c.headline ? '｜' + clip(c.headline, 30) : ''} — Eizo Maps`;

  // ---- 見た目（ページを開いた人のブラウザでは、最新のデータで描き直される）
  const profile = `
<div class="row profile-head">
  <div class="profile-head__text">
    <h1>${esc(name)}</h1>
    ${c.handle ? `<p class="profile-handle mono">@${esc(c.handle)}</p>` : ''}
    <p class="lead">${esc(c.headline || '')}</p>
    ${area ? `<p class="small muted">${esc(area)}</p>` : ''}
    ${c.updated_at ? `<p class="small muted">プロフィール更新 ${jpDate(c.updated_at)}</p>` : ''}
  </div>
</div>
<div class="row" id="ratingRow">${avg !== null
    ? `<span class="rating"><span class="score">${avg.toFixed(1)}</span><span class="stars">${stars(avg)}</span><span class="count">${myReviews.length}件の評価</span></span>`
    : '<span class="small muted">評価はまだありません</span>'}</div>
${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag tag--accent">${esc(t)}</span>`).join('')}</div>` : ''}
<div class="row profile-stats">
  <div class="stat"><span class="v">${completed}</span><span class="k">Completed</span></div>
  ${c.years_of_experience != null ? `<div class="stat"><span class="v">${esc(c.years_of_experience)}y</span><span class="k">Career</span></div>` : ''}
  ${c.response_time_hours != null ? `<div class="stat"><span class="v">${esc(c.response_time_hours)}h</span><span class="k">Reply</span></div>` : ''}
</div>
${c.bio ? `<p class="profile-bio">${esc(c.bio)}</p>` : ''}
${myLinks.length ? `<div class="chips stock-links">${myLinks.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(l.label || PLATFORM[l.platform] || 'Link')}</a>`).join('')}</div>` : ''}
<div class="form-actions"><a class="btn btn--primary" href="/request/?creator_id=${esc(c.id)}" rel="nofollow">依頼する</a><a class="btn" href="/contact/">お問い合わせ</a></div>`;

  const worksHtml = myWorks.length
    ? myWorks.map((w) => `<article class="card"><div class="body"><h3>${esc(w.title || '作品')}</h3>${w.description ? `<p class="small">${esc(w.description)}</p>` : ''}${safeUrl(w.video_url) ? `<p class="small"><a href="${esc(w.video_url)}" target="_blank" rel="noopener noreferrer nofollow">作品を見る（${esc(PLATFORM[w.provider] || '外部サイト')}）</a></p>` : ''}</div></article>`).join('\n')
    : '<div class="empty">公開されている作品はまだありません。</div>';

  const reviewsHtml = myReviews.length
    ? myReviews.map((v) => `<div class="review-item"><div class="review-head"><span class="rating"><span class="stars">${stars(v.score)}</span><span class="count">${Number(v.score).toFixed(1)}</span></span><span class="small muted">${v.reviewer_role === 'client' ? 'クライアント' : 'クリエイター'} / ${jpDate(v.published_at)}</span></div>${mark(v)}<p class="small">${esc(v.comment)}</p></div>`).join('\n')
    : '<div class="empty">まだ評価はありません。</div>';

  // ---- 検索エンジン・AI 向けの説明（構造化データ）
  const person = {
    '@type': 'Person',
    name,
    ...(c.handle ? { alternateName: '@' + c.handle } : {}),
    url,
    ...(c.headline ? { jobTitle: c.headline } : {}),
    ...(c.bio ? { description: clip(c.bio, 500) } : {}),
    ...(safeUrl(c.avatar_url) ? { image: c.avatar_url } : {}),
    ...(c.area_pref ? { homeLocation: { '@type': 'Place', name: area } } : {}),
    ...(tags.length ? { knowsAbout: tags } : {}),
    ...([safeUrl(c.website_url), ...myLinks.map((l) => l.url)].filter(Boolean).length
      ? { sameAs: [safeUrl(c.website_url), ...myLinks.map((l) => l.url)].filter(Boolean) } : {}),
  };
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    name: title,
    ...(c.updated_at ? { dateModified: c.updated_at } : {}),
    mainEntity: person,
    ...(myReviews.length ? {
      // 評価は Eizo Maps で取引した人（または運営が確認した自己申告の取引）が書いたもの。投稿者名は出さない
      hasPart: myReviews.map((v) => ({
        '@type': 'Comment',
        text: `評価 ${Number(v.score).toFixed(1)}／5（${v.source === 'external' ? 'Eizo Maps外の取引・自己申告' : 'Eizo Maps での取引'}）：${v.comment}`,
        dateCreated: v.published_at,
        author: { '@type': 'Person', name: v.reviewer_role === 'client' ? 'クライアント（匿名）' : 'クリエイター（匿名）' },
      })),
    } : {}),
  };

  let html = template
    .replace(/<meta name="robots"[^>]*>\n?/, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">\n<link rel="canonical" href="${esc(url)}">\n<meta name="em-creator-id" content="${esc(c.id)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">\n<meta property="og:url" content="${esc(url)}">`)
    .replace(/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="profile">')
    .replace('</head>', `<script type="application/ld+json">${jsonLd(ld)}</script>\n</head>`)
    .replace('<div id="profile"></div>', `<div id="profile">${profile}</div>`)
    .replace('<section id="portfolioSection" hidden>', '<section id="portfolioSection">')
    .replace('<div class="grid grid--3" id="portfolioGrid"></div>', `<div class="grid grid--3" id="portfolioGrid">${worksHtml}</div>`)
    .replace('<section id="reviewSection" hidden>', '<section id="reviewSection">')
    .replace('<div id="reviewList"></div>', `<div id="reviewList">${reviewsHtml}</div>`);

  if (!html.includes('em-creator-id') || !html.includes('id="reviewList"><')) throw new Error('detail.html の形が変わっていて書き出せません');

  const file = c.handle ? `${ROOT}/@${c.handle}.html` : `${ROOT}/creators/${c.id}.html`;
  writeFileSync(file, html);
  written++;
  const last = [c.updated_at, myReviews[0]?.published_at].filter(Boolean).sort().pop();
  sitemapUrls.push(`  <url><loc>${url}</loc>${last ? `<lastmod>${isoDay(last)}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.8</priority></url>`);
}

// ---- 依頼した会社の評価（会社名を入れていて、クリエイターからの評価が1件以上ある会社だけ）
const rpc = async (fn, body = {}) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  return r.json();
};
const companies = await rpc('public_companies');
const cTemplate = readFileSync(`${ROOT}/companies/detail.html`, 'utf8');
const cListTemplate = readFileSync(`${ROOT}/companies/index.html`, 'utf8');
let cWritten = 0;
for (const row of companies) {
  const d = await rpc('public_company', { p_client_id: row.id });
  if (!d) continue;
  const rs = d.reviews || [];
  const avg = rs.length ? rs.reduce((a, b) => a + Number(b.score), 0) / rs.length : 0;
  const url = `${SITE}/companies/${d.id}`;
  const title = `${d.company}の評価 — Eizo Maps`;
  const desc = clip(`${d.company}${d.area_pref ? '（' + d.area_pref + '）' : ''}が、Eizo Maps で一緒に仕事をした映像クリエイターから受けた評価：${avg.toFixed(1)}（${rs.length}件）。${rs[0] ? rs[0].comment : ''}`, 150);
  const head = `<p class="eyebrow">Client</p><h1>${esc(d.company)}</h1>${d.area_pref ? `<p class="small muted">${esc(d.area_pref)}</p>` : ''}<div class="row" id="ratingRow"><span class="rating"><span class="score">${avg.toFixed(1)}</span><span class="stars">${stars(avg)}</span><span class="count">${rs.length}件の評価</span></span></div>`;
  const items = rs.map((v) => `<div class="review-item"><div class="review-head"><span class="rating"><span class="stars">${stars(v.score)}</span><span class="count">${Number(v.score).toFixed(1)}</span></span><span class="small muted">クリエイター / ${jpDate(v.published_at)}</span></div>${mark(v)}<p class="small">${esc(v.comment)}</p></div>`).join('\n');
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebPage', url, name: title,
    about: { '@type': 'Organization', name: d.company, ...(d.area_pref ? { address: { '@type': 'PostalAddress', addressRegion: d.area_pref, addressCountry: 'JP' } } : {}) },
    hasPart: rs.map((v) => ({ '@type': 'Comment', text: `評価 ${Number(v.score).toFixed(1)}／5：${v.comment}`, dateCreated: v.published_at, author: { '@type': 'Person', name: 'クリエイター（匿名）' } })),
  };
  const html = cTemplate
    .replace(/<meta name="robots"[^>]*>\n?/, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">\n<link rel="canonical" href="${esc(url)}">\n<meta name="em-company-id" content="${esc(d.id)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">\n<meta property="og:url" content="${esc(url)}">`)
    .replace('</head>', `<script type="application/ld+json">${jsonLd(ld)}</script>\n</head>`)
    .replace('<div id="company"></div>', `<div id="company">${head}</div>`)
    .replace('<section id="reviewSection" hidden>', '<section id="reviewSection">')
    .replace('<div id="reviewList"></div>', `<div id="reviewList">${items}</div>`);
  if (!html.includes('em-company-id') || !html.includes('id="reviewList"><')) throw new Error('companies/detail.html の形が変わっていて書き出せません');
  writeFileSync(`${ROOT}/companies/${d.id}.html`, html);
  cWritten++;
  sitemapUrls.push(`  <url><loc>${url}</loc><lastmod>${isoDay(row.last_review_at)}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`);
}
// 一覧ページにも、最初から会社の名前と評価を書き込んでおく
const cards = companies.length
  ? `<div class="grid grid--3">${companies.map((c) => `<a class="card creator-card" href="/companies/${esc(c.id)}"><div class="body"><p class="name">${esc(c.company)}</p>${c.area_pref ? `<p class="small muted">${esc(c.area_pref)}</p>` : ''}<span class="rating"><span class="stars">${stars(c.avg_score)}</span><span class="count">${Number(c.avg_score).toFixed(1)}（${c.rated_count}件）</span></span></div></a>`).join('')}</div>`
  : '<div class="empty">まだ評価の付いた会社はありません。</div>';
writeFileSync(`${ROOT}/companies/index.html`, cListTemplate.replace('<div id="companyList"></div>', `<div id="companyList">${cards}</div>`));
sitemapUrls.unshift('  <url><loc>https://eizo-maps.com/companies/</loc><changefreq>daily</changefreq><priority>0.6</priority></url>');

// サイトの地図に、クリエイターと会社のページを足す
const smPath = `${ROOT}/sitemap.xml`;
const sm = readFileSync(smPath, 'utf8');
if (sitemapUrls.length) writeFileSync(smPath, sm.replace('</urlset>', sitemapUrls.join('\n') + '\n</urlset>'));

console.log(`書き出したクリエイターのページ：${written}件（評価 ${reviews.length}件）／会社のページ：${cWritten}件`);
