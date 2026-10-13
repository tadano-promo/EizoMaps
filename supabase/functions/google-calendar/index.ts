// =====================================================================
//  Eizo Maps / Edge Function: google-calendar
//  ---------------------------------------------------------------
//  Google カレンダー連携の実処理。ブラウザからは絶対に Google を直接叩かない。
//
//  ★ セキュリティ方針
//    1. 呼び出し元は必ず Supabase の JWT で本人確認する。
//       他人の user_id を指定して操作させない（body で受け取らない）。
//    2. リフレッシュトークンは AES-GCM で暗号化してから DB に入れる。
//       復号の鍵（TOKEN_ENC_KEY）はこの関数の環境変数にしか無い。
//       DB を丸ごと抜かれてもトークンは使えない。
//    3. Google のクライアントシークレットもここの環境変数だけに置く。
//    4. 取り込むのは「埋まっている時間帯」だけ。件名も場所も取り込まない。
//
//  ★ 必要な環境変数（Supabase ダッシュボード > Edge Functions > Secrets）
//      GOOGLE_CLIENT_ID      Google Cloud の OAuth クライアント ID
//      GOOGLE_CLIENT_SECRET  同シークレット
//      TOKEN_ENC_KEY         32バイトの鍵を base64 にしたもの
//      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は Supabase が自動で入れる
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLIENT_ID    = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const ENC_KEY_B64  = Deno.env.get('TOKEN_ENC_KEY') ?? '';

// 呼び出しを許可する画面の置き場所
const ALLOWED_ORIGINS = [
  'https://eizo-maps.com',
  'https://www.eizo-maps.com',
  'http://127.0.0.1:8123',
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

/* ---------------- 暗号化（AES-GCM） ---------------- */
async function encKey(): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(ENC_KEY_B64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('TOKEN_ENC_KEY は32バイトを base64 にしたものを設定してください');
  return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(plain: string): Promise<string> {
  const key = await encKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const out = new Uint8Array(iv.length + buf.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(buf), iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decrypt(b64: string): Promise<string> {
  const key = await encKey();
  const all = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = all.slice(0, 12);
  const data = all.slice(12);
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(buf);
}

/* ---------------- Google ---------------- */
async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) {
    throw new Error('Google の認証が切れています。連携をやり直してください');
  }
  return j.access_token as string;
}

type Cal = { id: string; name: string; primary: boolean; writable: boolean; color: string | null };

// 自分の Google カレンダーの一覧。予定の中身は取らない
async function listCalendars(ghead: Record<string, string>): Promise<Cal[]> {
  const out: Cal[] = [];
  let pageToken = '';
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ maxResults: '250', minAccessRole: 'freeBusyReader' });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${q}`, { headers: ghead });
    if (!res.ok) throw new Error(`カレンダーの一覧を取れませんでした（${res.status}）`);
    const j = await res.json();
    for (const c of j.items ?? []) {
      if (c.deleted) continue;
      out.push({
        id: String(c.id),
        name: String(c.summaryOverride ?? c.summary ?? c.id).slice(0, 100),
        primary: !!c.primary,
        writable: c.accessRole === 'owner' || c.accessRole === 'writer',
        color: c.backgroundColor ? String(c.backgroundColor) : null,
      });
    }
    pageToken = j.nextPageToken ?? '';
    if (!pageToken) break;
  }
  out.sort((a, b) => Number(b.primary) - Number(a.primary));
  return out;
}

const KIND_LABEL: Record<string, string> = {
  shoot: '撮影', edit: '編集', meeting: '打合せ', delivery: '納品',
  hold: '仮押さえ', other: '予定', private: '予定',
};

// Eizo Maps の予定を Google の形に変換する
function toGoogleEvent(e: Record<string, unknown>) {
  const kind = String(e.kind ?? 'other');
  const summary = `[${KIND_LABEL[kind] ?? '予定'}] ${String(e.title ?? '')}`.slice(0, 200);
  const body: Record<string, unknown> = {
    summary,
    description: [e.note, 'Eizo Maps から同期'].filter(Boolean).join('\n\n').slice(0, 4000),
    source: { title: 'Eizo Maps', url: 'https://eizo-maps.com/schedule/' },
  };
  if (e.location) body.location = String(e.location).slice(0, 200);

  if (e.start_time) {
    const st = String(e.start_time).slice(0, 8);
    const et = e.end_time ? String(e.end_time).slice(0, 8) : null;
    body.start = { dateTime: `${e.starts_on}T${st}+09:00`, timeZone: 'Asia/Tokyo' };
    body.end = et
      ? { dateTime: `${e.ends_on}T${et}+09:00`, timeZone: 'Asia/Tokyo' }
      : { dateTime: `${e.starts_on}T${st}+09:00`, timeZone: 'Asia/Tokyo' };
  } else {
    // 終日予定。Google の終了日は「翌日」を指定する決まり
    const end = new Date(`${e.ends_on}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    body.start = { date: String(e.starts_on) };
    body.end = { date: end.toISOString().slice(0, 10) };
  }
  return body;
}

/* ---------------- 本体 ---------------- */
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405, origin);

  try {
    // 1. 呼び出し元の本人確認。ここを通らない限り何もしない。
    const auth = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json({ error: 'ログインが必要です' }, 401, origin);

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action ?? '');

    /* ---- 連携する ---- */
    if (action === 'connect') {
      const rt = String(payload.refresh_token ?? '');
      if (!rt) {
        return json({
          error: 'Google からの許可が取得できませんでした。一度 Google 側でこのアプリの許可を外してから、もう一度お試しください',
        }, 400, origin);
      }
      const enc = await encrypt(rt);
      const { error } = await db.from('calendar_links').upsert({
        user_id: user.id,
        provider: 'google',
        google_email: payload.google_email ? String(payload.google_email).slice(0, 200) : null,
        google_sub: payload.google_sub ? String(payload.google_sub).slice(0, 100) : null,
        scope: payload.scope ? String(payload.scope).slice(0, 500) : null,
        refresh_token_enc: enc,
        last_sync_error: null,
      }, { onConflict: 'user_id' });
      if (error) throw new Error(error.message);
      return json({ ok: true }, 200, origin);
    }

    // ここから先は連携済みであることが前提
    const { data: link } = await db.from('calendar_links').select('*').eq('user_id', user.id).maybeSingle();
    if (!link || !link.refresh_token_enc) {
      return json({ error: 'Google カレンダーと連携していません' }, 400, origin);
    }

    /* ---- 連携を解除する ---- */
    if (action === 'disconnect') {
      try {
        const rt = await decrypt(link.refresh_token_enc);
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: rt }),
        });
      } catch (_) { /* Google 側で既に失効していても、こちらの削除は続ける */ }
      await db.from('google_busy').delete().eq('user_id', user.id);
      await db.from('google_delete_queue').delete().eq('user_id', user.id);
      await db.from('calendar_links').delete().eq('user_id', user.id);
      return json({ ok: true }, 200, origin);
    }

    if (!['sync', 'list_calendars', 'set_calendars'].includes(action)) {
      return json({ error: '不明な操作です' }, 400, origin);
    }

    const token = await accessToken(await decrypt(link.refresh_token_enc));
    const ghead = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    /* ---- 自分の Google カレンダーの一覧（名前と、書き込めるかどうかだけ） ---- */
    if (action === 'list_calendars' || action === 'set_calendars') {
      const cals = await listCalendars(ghead);

      if (action === 'list_calendars') {
        return json({
          ok: true,
          calendars: cals,
          calendar_id: link.calendar_id ?? 'primary',
          busy_calendar_ids: link.busy_calendar_ids ?? [link.calendar_id ?? 'primary'],
        }, 200, origin);
      }

      /* ---- 使うカレンダーを保存する ---- */
      // 一覧に無い ID は受け付けない（他人のカレンダーを指定させない）
      const byId = new Map(cals.map((c) => [c.id, c]));
      const primaryId = cals.find((c) => c.primary)?.id ?? 'primary';
      const norm = (id: string) => (id === 'primary' ? primaryId : id);
      const writeId = norm(String(payload.calendar_id ?? 'primary'));
      const w = byId.get(writeId);
      if (!w) return json({ error: '書き込み先のカレンダーが見つかりません' }, 400, origin);
      if (!w.writable) return json({ error: 'そのカレンダーには書き込みできません。別のカレンダーを選んでください' }, 400, origin);

      const raw = Array.isArray(payload.busy_ids) ? payload.busy_ids : [];
      const busy = [...new Set(raw.map((x: unknown) => norm(String(x))))].filter((id) => byId.has(id));
      if (busy.length > 20) return json({ error: '空き判定に使えるカレンダーは20個までです' }, 400, origin);

      const { error } = await db.from('calendar_links').update({
        calendar_id: w.primary ? 'primary' : writeId,
        busy_calendar_ids: busy.map((id) => (byId.get(id)?.primary ? 'primary' : id)),
      }).eq('user_id', user.id);
      if (error) throw new Error(error.message);
      return json({ ok: true }, 200, origin);
    }

    /* ---- 同期する ---- */
    const writeCal = link.calendar_id ?? 'primary';
    const calId = encodeURIComponent(writeCal);
    const result = { pushed: 0, updated: 0, deleted: 0, removed_from_eizo: 0, busy_days: 0, errors: [] as string[] };

    // (a) Eizo Maps で消した予定を Google でも消す
    const { data: dels } = await db.from('google_delete_queue')
      .select('id,google_event_id,calendar_id').eq('user_id', user.id).limit(200);
    for (const d of dels ?? []) {
      const c = encodeURIComponent(d.calendar_id ?? 'primary');
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${c}/events/${encodeURIComponent(d.google_event_id)}`,
        { method: 'DELETE', headers: ghead },
      );
      // 410/404 は「Google 側に既に無い」なので成功と同じ扱い
      if (res.ok || res.status === 410 || res.status === 404) {
        await db.from('google_delete_queue').delete().eq('id', d.id);
        result.deleted++;
      } else {
        result.errors.push(`削除に失敗: ${res.status}`);
      }
    }

    // (a2) Google 側で消された予定を、Eizo Maps からも消す
    //      対象は「同期済みで、そのあと Eizo Maps 側で変えていない」予定だけ。
    //      Eizo Maps 側で直したばかりの予定は、下の (b) で Google に書き戻す。
    {
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const { data: synced } = await db.from('schedule_events')
        .select('id,google_event_id,google_calendar_id')
        .eq('owner_user_id', user.id)
        .not('google_event_id', 'is', null)
        .not('google_synced_at', 'is', null)
        .gte('ends_on', since.toISOString().slice(0, 10))
        .limit(200);
      for (const e of synced ?? []) {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(e.google_calendar_id ?? writeCal)}/events/${encodeURIComponent(e.google_event_id)}`,
          { headers: ghead },
        );
        let gone = res.status === 404 || res.status === 410;
        if (res.ok) {
          const g = await res.json().catch(() => ({}));
          gone = g?.status === 'cancelled';
        } else if (!gone) {
          result.errors.push(`確認に失敗: ${res.status}`);
          continue;
        }
        if (gone) {
          await db.from('schedule_events').delete().eq('id', e.id).eq('owner_user_id', user.id);
          // 消したときに「Google でも消す」控えが自動で作られるので、それは片づける（Google 側はもう無い）
          await db.from('google_delete_queue').delete().eq('user_id', user.id).eq('google_event_id', e.google_event_id);
          result.removed_from_eizo++;
        }
      }
    }

    // (b) 未同期の予定を Google へ書き出す
    if (link.sync_push) {
      const since = new Date();
      since.setDate(since.getDate() - 1);
      const { data: evs } = await db.from('schedule_events')
        .select('id,kind,title,note,location,starts_on,ends_on,start_time,end_time,google_event_id,google_calendar_id')
        .eq('owner_user_id', user.id)
        .is('google_synced_at', null)
        .gte('ends_on', since.toISOString().slice(0, 10))
        .order('starts_on')
        .limit(200);

      for (const e of evs ?? []) {
        const body = toGoogleEvent(e as Record<string, unknown>);
        let res: Response;
        // 書いた先のカレンダー（前に書いた予定は、そのカレンダーの中で直す）
        let target = writeCal;
        if (e.google_event_id) {
          target = e.google_calendar_id ?? writeCal;
          res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target)}/events/${encodeURIComponent(e.google_event_id)}`,
            { method: 'PATCH', headers: ghead, body: JSON.stringify(body) },
          );
          // Google 側で消されていたら、作り直す
          if (res.status === 404 || res.status === 410) {
            target = writeCal;
            res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
              { method: 'POST', headers: ghead, body: JSON.stringify(body) });
          } else if (res.ok) {
            result.updated++;
          }
        } else {
          res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
            { method: 'POST', headers: ghead, body: JSON.stringify(body) });
          if (res.ok) result.pushed++;
        }
        if (res.ok) {
          const g = await res.json();
          await db.from('schedule_events')
            .update({ google_event_id: g.id, google_calendar_id: target, google_synced_at: new Date().toISOString() })
            .eq('id', e.id);
        } else {
          result.errors.push(`書き出しに失敗: ${res.status}`);
        }
      }
    }

    // (c) Google 側で埋まっている日を取り込む（中身は取らない）
    //     Google は一度に問い合わせられる期間に上限があるので、60日ずつに分けて聞く
    if (link.sync_pull) {
      const busyIds: string[] = (link.busy_calendar_ids && link.busy_calendar_ids.length)
        ? link.busy_calendar_ids.slice(0, 20)
        : [writeCal];
      const days = new Set<string>();
      let pullOk = true;
      const start = new Date();
      for (let i = 0; i < 3 && pullOk; i++) {
        const from = new Date(start.getTime() + i * 60 * 86400000);
        const to = new Date(start.getTime() + (i + 1) * 60 * 86400000);
        const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
          method: 'POST',
          headers: ghead,
          body: JSON.stringify({
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            timeZone: 'Asia/Tokyo',
            items: busyIds.map((id) => ({ id })),
          }),
        });
        if (!res.ok) {
          pullOk = false;
          let why = '';
          try { const ej = await res.json(); why = String(ej?.error?.errors?.[0]?.reason ?? ej?.error?.message ?? ''); } catch (_) { /* 中身が読めなくても続ける */ }
          result.errors.push(`取り込みに失敗: ${res.status}${why ? ' ' + why.slice(0, 80) : ''}`);
          break;
        }
        const j = await res.json();
        const allBusy = Object.values(j.calendars ?? {})
          .flatMap((c) => ((c as { busy?: { start: string; end: string }[] }).busy ?? []));
        for (const b of allBusy) {
          // 日本時間の日付に落とす（開始日の0時から、終了の直前の日まで）
          const s = new Date(new Date(b.start).getTime() + 9 * 3600 * 1000);
          s.setUTCHours(0, 0, 0, 0);
          const e = new Date(new Date(b.end).getTime() + 9 * 3600 * 1000 - 1);
          for (let d = new Date(s); d <= e && days.size <= 400; d.setUTCDate(d.getUTCDate() + 1)) {
            days.add(d.toISOString().slice(0, 10));
          }
        }
      }
      if (pullOk) {
        await db.from('google_busy').delete().eq('user_id', user.id);
        if (days.size) {
          await db.from('google_busy').insert(
            [...days].map((day) => ({ user_id: user.id, day })),
          );
        }
        result.busy_days = days.size;
      }
    }

    await db.from('calendar_links').update({
      last_sync_at: new Date().toISOString(),
      last_sync_error: result.errors.length ? result.errors.slice(0, 3).join(' / ').slice(0, 500) : null,
    }).eq('user_id', user.id);

    return json({ ok: true, ...result }, 200, origin);
  } catch (err) {
    return json({ error: (err as Error).message ?? '処理に失敗しました' }, 400, origin);
  }
});
