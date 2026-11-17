// =====================================================================
//  Eizo Maps / Edge Function: inquiry-cleanup（2026-11-17 翠くん）
//  対応済みにしてから30日たったお問い合わせの、画像・動画のファイルだけを消す（文章は残す）
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
    await db.from('inquiries').update({ files: [], files_deleted_at: new Date().toISOString() }).eq('id', r.id);
    done++;
  }
  return new Response(JSON.stringify({ ok: true, inquiries: done, files: removed }), { headers: { 'Content-Type': 'application/json' } });
});
