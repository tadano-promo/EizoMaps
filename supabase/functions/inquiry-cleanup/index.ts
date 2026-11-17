// =====================================================================
//  Eizo Maps / Edge Function: inquiry-cleanup（2026-11-17 翠くん）
//  対応済みにしてから30日たったお問い合わせの、画像・動画のファイルだけを消す（文章は残す）
//  終わってから90日たった案件の、やり取りの画像・PDFを消す（83日目に2人へお知らせ）（2026-11-17 追加）
//  毎日の予約実行から呼ばれる（x-cron-key = app_internal 'inquiry_cleanup_cron'）
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const given = req.headers.get('x-cron-key') ?? '';
  const { data: row } = await db.from('app_internal').select('value').eq('key', 'inquiry_cleanup_cron').maybeSingle();
  if (!row?.value || given !== row.value) return new Response('forbidden', { status: 403 });

  const { data: due, error } = await db.rpc('inquiry_files_due');
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  let removed = 0, done = 0;
  for (const r of (due ?? []) as { id: string; files: string[] }[]) {
    const paths = (r.files ?? []).filter((p) => typeof p === 'string' && p.length > 0);
    if (paths.length) {
      const rm = await db.storage.from('inquiry-files').remove(paths);
      if (rm.error) { console.error('inquiry-cleanup: 消せなかった', r.id, rm.error.message); continue; }
      removed += paths.length;
    }
    const mk = await db.rpc('inquiry_files_mark_deleted', { p_id: r.id });
    if (mk.error) { console.error('inquiry-cleanup: 記録できなかった', r.id, mk.error.message); continue; }
    done++;
  }
  // 案件のやり取りのファイル
  const nt = await db.rpc('project_files_notice');
  if (nt.error) console.error('inquiry-cleanup: 案件のお知らせに失敗', nt.error.message);
  let pDone = 0, pRemoved = 0;
  const pd = await db.rpc('project_files_due');
  if (pd.error) console.error('inquiry-cleanup: 案件の一覧に失敗', pd.error.message);
  for (const r of (pd.data ?? []) as { id: string; files: string[] }[]) {
    const paths = (r.files ?? []).filter((p) => typeof p === 'string' && p.length > 0);
    // 一覧に出ていない置き忘れ（送らずに終わったファイル）も、その案件のフォルダごと消す
    const ls = await db.storage.from('project-files').list(r.id, { limit: 1000 });
    for (const o of ls.data ?? []) { const full = r.id + '/' + o.name; if (!paths.includes(full)) paths.push(full); }
    if (paths.length) {
      const rm = await db.storage.from('project-files').remove(paths);
      if (rm.error) { console.error('inquiry-cleanup: 案件のファイルを消せなかった', r.id, rm.error.message); continue; }
      pRemoved += paths.length;
    }
    const mk = await db.rpc('project_files_mark_deleted', { p_id: r.id });
    if (mk.error) { console.error('inquiry-cleanup: 案件の記録に失敗', r.id, mk.error.message); continue; }
    pDone++;
  }
  return new Response(JSON.stringify({ ok: true, inquiries: done, files: removed, project_notices: nt.data ?? 0, projects: pDone, project_files: pRemoved }), { headers: { 'Content-Type': 'application/json' } });
});
