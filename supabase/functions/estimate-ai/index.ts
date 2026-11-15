// =====================================================================
//  Eizo Maps / Edge Function: estimate-ai（ことばから実行表を作る・2026-11-15 翠くん）
//  ---------------------------------------------------------------
//  ・ログインした人だけ使える（verify_jwt）
//  ・月の上限（app_internal 'ai_month_cap_yen' ＝ 3,000円）と、1人1日の回数（30回）を超えたら使わない
//    → 画面は「決まった言葉で読む」に切り替わる
//  ・料金は多めに見積もった単価で数える（実際の請求が上限を超えないように）
//  ・AI は「作らずに聞き返す」：書かれていない人や数は決めつけず、questions で聞き返す
//  ★ 必要な設定（Edge Functions > Secrets）：ANTHROPIC_API_KEY（翠くんが入れる）／AI_MODEL（省略可）
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = Deno.env.get('AI_MODEL') ?? 'claude-haiku-5-5';

const CORS = {
  'Access-Control-Allow-Origin': 'https://eizo-maps.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const CATS = ['01 企画・構成費', '02 制作準備費', '03 進行管理費', '04 スタッフ費', '05 キャスト費', '06 撮影・照明機材費',
  '07 スタジオ・ロケ・美術費', '08 編集・CG費', '09 音楽・効果音費', '10 録音・MA費', '11 交通・食事費', '12 その他・予備費'];

const SYSTEM = `あなたは日本の映像制作のプロデューサーの補佐です。ユーザーが話し言葉で書いた案件の内容を、見積もり・実行予算の表の行に分けます。
費目は次の12個だけを使います：
${CATS.join('\n')}
決まり：
- 書かれていることだけを行にする。書かれていない人・数・日数は決めつけず、questions で聞き返す（例：「出演者は要りませんか？」「お弁当は何人分×何日ですか？」「エキストラは？」）
- 撮影の日数が書かれていれば、スタッフ・機材・車両の数量はその日数にする
- price は見積単価（お客さまに出す単価・税抜・円）、cost は実行単価（外注に払う単価・円）。分からないときは小〜中規模の Web 向け案件の一般的な目安を入れ、note に「目安」と書く
- 自分で手を動かす作業（企画・プロデューサーなど）は cost を 0 にしてよい
- 出力は JSON だけ。説明文は書かない
形：{"lines":[{"cat":"04","name":"カメラマン","unit":"日","qty":1,"price":60000,"cost":50000,"note":""}],"questions":["…"]}`;

function clean(x: unknown) {
  const out: { lines: unknown[]; questions: string[] } = { lines: [], questions: [] };
  const o = (x ?? {}) as { lines?: unknown[]; questions?: unknown[] };
  const okCat = new Set(CATS.map((c) => c.slice(0, 2)));
  for (const l of (Array.isArray(o.lines) ? o.lines : []).slice(0, 80)) {
    const r = l as Record<string, unknown>;
    const cat = String(r.cat ?? '').padStart(2, '0').slice(0, 2);
    if (!okCat.has(cat)) continue;
    const n = (v: unknown, max: number) => { const z = Number(v); return Number.isFinite(z) && z >= 0 ? Math.min(z, max) : 0; };
    out.lines.push({
      cat, name: String(r.name ?? '').slice(0, 40) || '項目', unit: String(r.unit ?? '式').slice(0, 6),
      qty: n(r.qty, 10000), price: Math.round(n(r.price, 100000000)), cost: Math.round(n(r.cost, 100000000)),
      costQty: n(r.qty, 10000), note: String(r.note ?? '').slice(0, 100),
    });
  }
  for (const q of (Array.isArray(o.questions) ? o.questions : []).slice(0, 12)) out.questions.push(String(q).slice(0, 200));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST だけです' }, 405);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = await db.auth.getUser(token);
  const user = u?.user;
  if (!user) return json({ error: 'ログインしてください' }, 401);

  const body = await req.json().catch(() => ({}));
  if (body.action === 'status') {
    const s = (await db.rpc('ai_can_use', { p_user: user.id })).data as Record<string, number> | null;
    const ok = !!API_KEY && !!s && s.month_yen < s.cap_yen && s.user_today < s.user_limit;
    return json({ ok, configured: !!API_KEY, left_today: s ? Math.max(0, s.user_limit - s.user_today) : 0 });
  }
  const text = String(body.text ?? '').trim().slice(0, 2000);
  if (text.length < 4) return json({ error: '内容をもう少し書いてください' }, 400);
  if (!API_KEY) return json({ fallback: true, reason: 'AI の設定がまだです' }, 503);
  const s = (await db.rpc('ai_can_use', { p_user: user.id })).data as Record<string, number> | null;
  if (!s) return json({ fallback: true, reason: '使用量を確かめられませんでした' }, 503);
  if (s.month_yen >= s.cap_yen) return json({ fallback: true, reason: '今月の AI の上限に達しました' }, 429);
  if (s.user_today >= s.user_limit) return json({ fallback: true, reason: '今日の AI の回数（' + s.user_limit + '回）を使い切りました' }, 429);

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: text }] }),
  }).catch(() => null);
  if (!r || !r.ok) {
    console.error('estimate-ai: AI の呼び出しに失敗', r?.status);
    return json({ fallback: true, reason: 'AI につながりませんでした' }, 502);
  }
  const j = await r.json();
  const tin = Number(j?.usage?.input_tokens ?? 0), tout = Number(j?.usage?.output_tokens ?? 0);
  const yen = (tin * Number(s.in_rate) + tout * Number(s.out_rate)) / 1_000_000;
  await db.from('ai_usage').insert({ user_id: user.id, feature: 'estimate', tokens_in: tin, tokens_out: tout, yen: Math.max(0.01, yen) });

  const raw = String((j?.content ?? []).map((c: { text?: string }) => c.text ?? '').join(''));
  const m = raw.match(/\{[\s\S]*\}/);
  let parsed: unknown = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  if (!parsed) return json({ fallback: true, reason: 'AI の答えを読み取れませんでした' }, 502);
  return json({ ok: true, ...clean(parsed) });
});
