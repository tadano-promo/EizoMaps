// =====================================================================
//  Eizo Maps / Edge Function: notify（メールのお知らせを送る）
//  ---------------------------------------------------------------
//  5分ごとにデータベースの予約実行から呼ばれる（x-cron-key = app_internal 'notify_cron'）。
//  notify_queue のまだ送っていないものを取り、さくらのメールで「文字だけの版＋HTML」で送る。
//  2026-11-15 翠くん：依頼・返事・提案・メッセージが届いたら、相手にメールで知らせる
//
//  ★ 使う設定（send-email と同じもの。Edge Functions > Secrets）
//      SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM / SMTP_PORT（省略で465）
//      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で入れる
//  ★ 送らない人：退会した人（withdrawn.invalid）・ログインを止めた人・メール未確認の人
//  ★ ログにはメールアドレス・本文を出さない（種類と成否だけ）
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import nodemailer from 'npm:nodemailer@6.9.16';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465');
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'Eizo Maps <info@eizo-maps.com>';
const SITE = 'https://eizo-maps.com';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const FOOT = 'このメールは Eizo Maps からのお知らせです（送信専用のアドレスです）。\n'
  + 'お知らせのメールを止めるときは、マイページの「アカウント」から設定できます：' + SITE + '/mypage/#account';

// このメールへの返信・絵文字の反応は、相手には届かない（運営の受信箱に来るだけ）。2026-11-27 に実際に起きたので、ボタンのすぐ上に1行で知らせる。
// 翠くん「大きく入れすぎないで」→ 本文より小さめの字・色も薄め
const NOREPLY = '※ このメールへの返信や絵文字の反応は、相手には届きません。お返事は、下のボタンから Eizo Maps でお願いします。';

export function render(subject: string, body: string, link: string) {
  const url = SITE + link;
  const text = body + '\n\n' + NOREPLY + '\n\n▼ 開く\n' + url + '\n\n――――\n' + FOOT + '\n';
  const html = '<!doctype html><html lang="ja"><body style="margin:0;padding:24px;background:#f4f4f7;font-family:sans-serif;color:#1a1a22">'
    + '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">'
    + '<p style="margin:0 0 16px;font-weight:700;font-size:18px">Eizo <span style="color:#7a8c00">Maps</span></p>'
    + '<p style="white-space:pre-wrap;line-height:1.8;margin:0 0 24px">' + esc(body) + '</p>'
    + '<p style="font-size:13px;color:#55556a;line-height:1.7;margin:0 0 12px">' + esc(NOREPLY) + '</p>'
    + '<p style="margin:0 0 24px"><a href="' + esc(url) + '" style="display:inline-block;background:#e8ff47;color:#0a0a0f;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Eizo Maps で開く</a></p>'
    + '<p style="font-size:12px;color:#6b6b80;line-height:1.7;white-space:pre-wrap;margin:0">' + esc(FOOT) + '</p>'
    + '</div></body></html>';
  return { subject, text, html };
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method !== 'POST') return json({ error: 'POST だけです' }, 405);
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const payload = await req.json().catch(() => ({}));
    if (String(payload.action ?? '') !== 'cron') return json({ error: '使えない操作です' }, 400);
    const given = req.headers.get('x-cron-key') ?? '';
    const { data: row } = await db.from('app_internal').select('value').eq('key', 'notify_cron').maybeSingle();
    if (!row?.value || given.length < 32 || given !== row.value) return json({ error: '許可されていません' }, 403);
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return json({ error: 'メールの設定が足りません' }, 500);

    const take = await db.rpc('notify_take', { p_limit: 50 });
    if (take.error) return json({ error: take.error.message }, 500);
    const rows = (take.data ?? []) as { id: string; user_id: string; kind: string; subject: string; body: string; link: string }[];
    if (!rows.length) {
      if (new Date().getUTCMinutes() < 5 && new Date().getUTCHours() === 18) await db.rpc('notify_cleanup');
      return json({ ok: true, sent: 0 });
    }

    const tr = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
    const emails: Record<string, string | null> = {};
    let sent = 0, skipped = 0, failed = 0;
    for (const r of rows) {
      try {
        if (!(r.user_id in emails)) {
          const u = await db.auth.admin.getUserById(r.user_id);
          const user = u.data?.user;
          const banned = user?.banned_until && new Date(user.banned_until) > new Date();
          const ok = user && user.email && user.email_confirmed_at && !banned && !/@withdrawn\.invalid$/.test(user.email);
          emails[r.user_id] = ok ? user!.email! : null;
        }
        const to = emails[r.user_id];
        if (!to) { await db.rpc('notify_done', { p_id: r.id }); skipped++; continue;   // 退会・未確認などは送らずに済みにする }
        const m = render(r.subject, r.body, r.link);
        await tr.sendMail({ from: MAIL_FROM, to, subject: m.subject, text: m.text, html: m.html });
        await db.rpc('notify_done', { p_id: r.id });
        sent++;
      } catch (e) {
        failed++;
        const msg = String((e as Error)?.message ?? e).replace(/[\w.+-]+@[\w.-]+/g, '(address)').slice(0, 200);
        console.error('notify: 送信に失敗', r.kind, msg);
        await db.rpc('notify_done', { p_id: r.id, p_error: msg });
      }
    }
    console.log('notify:', JSON.stringify({ sent, skipped, failed }));
    return json({ ok: true, sent, skipped, failed });
  });
}
