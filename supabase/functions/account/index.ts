// =====================================================================
//  Eizo Maps / Edge Function: account
//  ---------------------------------------------------------------
//  退会して30日たった人の後片付け（毎日1回、データベースの予約実行から呼ばれる）
//   1. データベースの中身を消す（public.withdraw_purge_user）
//      ※ 評価・案件の記録・アカウントの番号は残す（翠くん決定 2026-11-15）
//   2. アップロードした画像（avatars/<user_id>/...）を消す
//   3. ログイン用のメールを使えない形に書き換え、ログインを止める
//      → 同じメールでまた新しく登録できる。評価は relink_my_reviews でつながる
//
//  ★ 呼べるのは x-cron-key（データベースの app_internal 'withdraw_cron'）を持つ予約実行だけ
//  ★ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で入れる（リポジトリには書かない）
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function removeFolder(db: ReturnType<typeof createClient>, bucket: string, prefix: string) {
  let removed = 0;
  const stack = [prefix];
  while (stack.length) {
    const dir = stack.pop()!;
    const { data, error } = await db.storage.from(bucket).list(dir, { limit: 1000 });
    if (error || !data) continue;
    const files: string[] = [];
    for (const it of data) {
      const path = dir + '/' + it.name;
      // フォルダは id が無い
      if (it.id === null || it.id === undefined) stack.push(path); else files.push(path);
    }
    if (files.length) {
      const { error: e2 } = await db.storage.from(bucket).remove(files);
      if (!e2) removed += files.length;
    }
  }
  return removed;
}

async function purgeOne(db: ReturnType<typeof createClient>, uid: string) {
  const r = await db.rpc('withdraw_purge_user', { p_user: uid });
  if (r.error) throw new Error('db: ' + r.error.message);
  const files = await removeFolder(db, 'avatars', uid);
  const u = await db.auth.admin.updateUserById(uid, {
    email: `withdrawn-${uid}@withdrawn.invalid`,
    email_confirm: true,
    ban_duration: '876000h',
    user_metadata: {},
  });
  if (u.error) throw new Error('auth: ' + u.error.message);
  return { uid, files };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST だけです' }, 405);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const payload = await req.json().catch(() => ({}));
  if (String(payload.action ?? '') !== 'cron') return json({ error: '使えない操作です' }, 400);

  const given = req.headers.get('x-cron-key') ?? '';
  const { data: row } = await db.from('app_internal').select('value').eq('key', 'withdraw_cron').maybeSingle();
  if (!row?.value || given.length < 32 || given !== row.value) return json({ error: '許可されていません' }, 403);

  const due = await db.rpc('withdraw_due');
  if (due.error) return json({ error: due.error.message }, 500);
  const done: unknown[] = [];
  const failed: unknown[] = [];
  for (const uid of (due.data ?? []) as string[]) {
    try { done.push(await purgeOne(db, uid)); }
    catch (e) { failed.push({ uid, error: String((e as Error).message) }); }
  }
  return json({ ok: true, done: done.length, failed });
});
