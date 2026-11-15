// =====================================================================
//  Eizo Maps / Edge Function: send-email（Supabase の「Send Email Hook」）
//  ---------------------------------------------------------------
//  登録・ログイン・パスワード再設定などのメールを、
//  「文字だけの版」と「見た目を整えた版（HTML）」の2つを入れた形で送る。
//  （Supabase の標準の送り方は HTML だけで、文字だけの版を付けられないため。
//    HTML を表示しないメールソフトでも、タグが見えずに読めるようにする）
//
//  2026-11-15 翠くん：改善案「確認メールをテキスト部つきで送れるようにする」を「やると決めた」に。
//                     「作って試し見まで」→ 本番のスイッチは翠くんの OK と作業のあと
//
//  ★ しくみ
//    1. Supabase Auth がメールを送る代わりに、この関数を呼ぶ（Auth Hooks > Send Email）
//    2. 呼んだのが本当に Supabase Auth かを、合言葉（署名）で確かめる。合わなければ何もしない
//    3. さくらのメールサーバーに 465番（SSL）でつないで送る
//       （Supabase の関数は 25番・587番では外に出られないため）
//    4. 送れなかったときはエラーを返す → 画面には「送れませんでした」と出る（黙って消えない）
//
//  ★ 必要な環境変数（Supabase ダッシュボード > Edge Functions > Secrets）
//      SEND_EMAIL_HOOK_SECRET  Auth Hooks の画面で作る合言葉（v1,whsec_... の形）
//      SMTP_HOST               さくらのメールサーバー（今の Supabase の SMTP 設定と同じもの）
//      SMTP_USER               送る人のアカウント（今の Supabase の SMTP 設定と同じもの）
//      SMTP_PASS               そのパスワード
//      MAIL_FROM               差出人（例：Eizo Maps <info@eizo-maps.com>）
//      SMTP_PORT               省略すると 465
//
//  ★ 個人情報
//    メールアドレス・リンク・確認コードは記録（ログ）に出さない。出すのは種類と成否だけ。
//
//  ★ 配置
//    ログインしていない人の登録でも呼ばれるので、JWT の確認は切る（verify_jwt = false）。
//    代わりに 2 の署名で確かめる。
// =====================================================================

import { Webhook } from 'npm:standardwebhooks@1.0.0';
import nodemailer from 'npm:nodemailer@6.9.16';

const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace(/^v1,whsec_/, '');
const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? '';
const SMTP_USER = Deno.env.get('SMTP_USER') ?? '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465');
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? 'Eizo Maps <info@eizo-maps.com>';

const SITE = 'https://eizo-maps.com';

type EmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new: string;
  token_hash_new: string;
};
type HookUser = { email: string; new_email?: string };

export type Mail = { to: string; subject: string; text: string; html: string };

// ---------------------------------------------------------------------
// 文面（文字だけの版と HTML の版を、同じ中身から作る）
// ---------------------------------------------------------------------
type Body = { subject: string; lead: string; button: string; after: string[] };

function bodyFor(type: string, toNew = false): Body {
  switch (type) {
    case 'signup':
      return {
        subject: '【Eizo Maps】メールアドレスの確認',
        lead: 'Eizo Maps にご登録いただき、ありがとうございます。\n下のリンクを開くと、登録が完了します。',
        button: '登録を完了する',
        after: ['作品の削除の申し立てをされた方は、このリンクを開くと申し立ての受付が完了します。'],
      };
    case 'magiclink':
      return {
        subject: '【Eizo Maps】ログイン用のリンク',
        lead: '下のリンクを開くと、Eizo Maps にログインできます。',
        button: 'ログインする',
        after: ['作品の削除の申し立てをされた方は、このリンクを開くと申し立ての受付が完了します。'],
      };
    case 'recovery':
      return {
        subject: '【Eizo Maps】パスワードの再設定',
        lead: 'パスワードの再設定のお申し込みを受け付けました。\n下のリンクを開いて、新しいパスワードを決めてください。',
        button: 'パスワードを再設定する',
        after: [],
      };
    case 'invite':
      return {
        subject: '【Eizo Maps】ご招待',
        lead: 'Eizo Maps にご招待いただいています。\n下のリンクを開くと、登録に進めます。',
        button: '登録に進む',
        after: [],
      };
    case 'email_change':
      return toNew
        ? {
            subject: '【Eizo Maps】新しいメールアドレスの確認',
            lead: 'Eizo Maps のメールアドレスを、このアドレスに変えるお申し込みを受け付けました。\n下のリンクを開くと、変更が完了します。',
            button: 'メールアドレスを変える',
            after: [],
          }
        : {
            subject: '【Eizo Maps】メールアドレスの変更の確認',
            lead: 'Eizo Maps のメールアドレスを変えるお申し込みを受け付けました。\nご本人のお申し込みであれば、下のリンクを開いてください。',
            button: '変更を確認する',
            after: [],
          };
    case 'reauthentication':
      return {
        subject: '【Eizo Maps】確認コード',
        lead: '大事な操作の前に、ご本人かどうかを確かめています。\n画面に下の確認コードを入れてください。',
        button: '',
        after: [],
      };
    default:
      return {
        subject: '【Eizo Maps】お知らせ',
        lead: 'Eizo Maps からのお知らせです。',
        button: '開く',
        after: [],
      };
  }
}

const FOOT_TEXT = [
  'このメールに覚えがない場合は、何もしなくて大丈夫です（リンクを開かなければ、何も起きません）。',
  'お問い合わせは https://eizo-maps.com/contact/ からお願いします。',
  '',
  'Eizo Maps',
  SITE + '/',
];

function verifyUrl(d: EmailData, tokenHash: string, type: string): string {
  // Supabase の確認の入口（今までのメールのリンクと同じ形）
  const base = (d.site_url || '').replace(/\/+$/, '');
  const q = new URLSearchParams({ token: tokenHash, type });
  if (d.redirect_to) q.set('redirect_to', d.redirect_to);
  return base + '/verify?' + q.toString();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function render(to: string, type: string, url: string, code: string, toNew = false): Mail {
  const b = bodyFor(type, toNew);
  const text: string[] = [b.lead, ''];
  if (url && b.button) text.push(b.button + '：', url, '');
  // 確認コードは、リンクのないメール（本人確認のコード）のときだけ載せる
  if (code && !url) text.push('確認コード：' + code, '');
  for (const a of b.after) text.push(a);
  text.push('', '――――――――――――', ...FOOT_TEXT);

  const p = (s: string, style = '') =>
    '<p style="margin:0 0 14px;line-height:1.8;' + style + '">' + esc(s).replace(/\n/g, '<br>') + '</p>';
  const html = [
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
    '<title>' + esc(b.subject) + '</title></head>',
    '<body style="margin:0;padding:0;background:#f4f4f2;">',
    '<div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:\'Hiragino Sans\',\'Noto Sans JP\',sans-serif;color:#1a1a1a;font-size:15px;">',
    '<p style="margin:0 0 20px;font-size:20px;font-weight:700;">Eizo Maps</p>',
    '<div style="background:#ffffff;border-radius:10px;padding:24px 22px;">',
    p(b.lead),
    url && b.button
      ? '<p style="margin:22px 0;"><a href="' + esc(url) + '" style="display:inline-block;background:#e8ff47;color:#0a0a0f;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px;">' + esc(b.button) + '</a></p>' +
        p('ボタンが押せないときは、次のアドレスを開いてください。', 'font-size:13px;color:#555;') +
        '<p style="margin:0 0 14px;font-size:12px;word-break:break-all;"><a href="' + esc(url) + '" style="color:#3355aa;">' + esc(url) + '</a></p>'
      : '',
    code && !url ? p('確認コード：' + code, 'font-size:18px;font-weight:700;letter-spacing:2px;') : '',
    ...b.after.map((a) => p(a, 'font-size:13px;color:#555;')),
    '</div>',
    '<div style="padding:18px 4px 0;font-size:12px;color:#666;">',
    p(FOOT_TEXT[0], 'font-size:12px;color:#666;'),
    p(FOOT_TEXT[1], 'font-size:12px;color:#666;'),
    '</div></div></body></html>',
  ].join('');

  return { to, subject: b.subject, text: text.join('\n'), html };
}

// フックの中身から、送るメール（1通か2通）を作る
export function buildMails(user: HookUser, d: EmailData): Mail[] {
  const type = d.email_action_type;
  if (type === 'email_change') {
    // 名前があべこべなので注意（Supabase の説明どおり）：
    //   今のアドレス → token と token_hash_new ／ 新しいアドレス → token_new と token_hash
    const out: Mail[] = [];
    if (d.token_hash_new && user.email) {
      out.push(render(user.email, type, verifyUrl(d, d.token_hash_new, type), d.token, false));
    }
    if (d.token_hash && user.new_email) {
      out.push(render(user.new_email, type, verifyUrl(d, d.token_hash, type), d.token_new || d.token, true));
    }
    return out;
  }
  if (type === 'reauthentication') return [render(user.email, type, '', d.token)];
  return [render(user.email, type, verifyUrl(d, d.token_hash, type), d.token)];
}

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) {
  Deno.serve(async (req) => {
    // つながるかだけを確かめる入口（ログインもパスワードも使わない。メールのサーバーのあいさつの1行目だけ返す）
    if (req.method === 'GET' && new URL(req.url).searchParams.get('diag') === 'connect') {
      const t0 = Date.now();
      try {
        const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
        const buf = new Uint8Array(256);
        const n = await Promise.race([conn.read(buf), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
        conn.close();
        const banner = n ? new TextDecoder().decode(buf.subarray(0, n)).split('\r\n')[0].slice(0, 80) : '(no banner)';
        return new Response(JSON.stringify({ ok: true, port: SMTP_PORT, ms: Date.now() - t0, banner }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, port: SMTP_PORT, ms: Date.now() - t0, error: String((e as Error)?.name) + ': ' + String((e as Error)?.message).slice(0, 120) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (req.method !== 'POST') return fail(405, 'Method not allowed');
    if (!HOOK_SECRET || !SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.error('send-email: 設定が足りません（SEND_EMAIL_HOOK_SECRET / SMTP_HOST / SMTP_USER / SMTP_PASS）');
      return fail(500, 'メールの送信の設定が終わっていません');
    }
    const payload = await req.text();
    let data: { user: HookUser; email_data: EmailData };
    try {
      data = new Webhook(HOOK_SECRET).verify(payload, Object.fromEntries(req.headers)) as typeof data;
    } catch {
      console.error('send-email: 署名が合いません');
      return fail(401, 'Unauthorized');
    }
    const type = data?.email_data?.email_action_type ?? '';
    const mails = buildMails(data.user, data.email_data);
    if (!mails.length) return fail(400, 'No recipient');

    const tr = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    try {
      for (const m of mails) {
        // text と html の両方を渡すと、multipart/alternative（文字だけの版＋HTML）で送られる
        await tr.sendMail({ from: MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
      }
    } catch (e) {
      // 原因を探すための情報だけを出す（アドレス・本文・パスワードは出さない）
      const er = e as { name?: string; code?: string; responseCode?: number; command?: string; message?: string };
      const msg = String(er?.message ?? '').replace(/[\w.+-]+@[\w.-]+/g, '(address)').slice(0, 200);
      console.error('send-email: 送信に失敗', type, JSON.stringify({ name: er?.name, code: er?.code, responseCode: er?.responseCode, command: er?.command, message: msg }));
      return fail(500, 'メールを送れませんでした。しばらくしてからもう一度お試しください');
    }
    console.log('send-email: 送信', type, mails.length + '通');
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}
