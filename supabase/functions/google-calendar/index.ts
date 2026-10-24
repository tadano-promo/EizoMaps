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
//
//  ★ 複数の Google アカウント（2026-10-25）
//    1つ目は calendar_links、2つ目以降は calendar_accounts（1人5つまで）。
//    2つ目以降は、この関数が Google の「許可の番号」を直接引き換える（action: 'add_account'）。
//    戻り先 https://eizo-maps.com/schedule/google-callback.html を Google Cloud の OAuth クライアントに登録しておくこと。
//
//  ★ 自動同期
//    データベースの予約実行（pg_cron）が15分ごとに action: 'cron' で呼ぶ。
//    そのときは x-cron-key をデータベース内の合言葉（app_internal）と照らし合わせる。
//    合言葉はデータベースの外に出ない。
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

/* ---------------- Google 側で埋まっている日 ---------------- */
const DAY = 86400000;
const PULL_DAYS = 180;

// 日本時間の日付（YYYY-MM-DD）
function jstDay(ms: number) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

type Range = { day: string; s: number; e: number };

// 開始〜終了（終了は含まない）にかかる日付をすべて足す。
// ranges を渡したときは、日ごとの「何分から何分まで」も記録する（中身は記録しない）
function addRange(days: Set<string>, startMs: number, endMs: number, ranges?: Range[]) {
  if (!(endMs > startMs)) endMs = startMs + 1;
  if (ranges && ranges.length < 3000) {
    let cur = startMs;
    for (let i = 0; i < 400 && cur < endMs; i++) {
      const day = jstDay(cur);
      const dayStart = Date.parse(day + 'T00:00:00+09:00');
      const dayEnd = dayStart + DAY;
      const segEnd = Math.min(endMs, dayEnd);
      const s0 = Math.max(0, Math.round((cur - dayStart) / 60000));
      const e0 = Math.min(1440, Math.round((segEnd - dayStart) / 60000));
      if (e0 > s0) ranges.push({ day, s: s0, e: e0 });
      cur = dayEnd;
    }
  }
  let d = new Date(jstDay(startMs) + 'T00:00:00Z');
  const last = jstDay(endMs - 1);
  for (let i = 0; i < 400 && days.size <= 400; i++) {
    const k = d.toISOString().slice(0, 10);
    days.add(k);
    if (k >= last) break;
    d = new Date(d.getTime() + DAY);
  }
}

// 1つのカレンダーの「埋まっている日」を集める。
// 中身は見ない。Eizo Maps から書き出した予定と「予定なし（空き）」にしてある予定は数えない。
async function busyOfCalendar(ghead: Record<string, string>, calId: string, days: Set<string>, ranges: Range[]): Promise<string | null> {
  const now = Date.now();
  const timeMin = new Date(now - DAY).toISOString();
  const timeMax = new Date(now + PULL_DAYS * DAY).toISOString();

  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({
      timeMin, timeMax, singleEvents: 'true', maxResults: '2500',
      fields: 'items(status,transparency,start,end,source/url),nextPageToken',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${q}`, { headers: ghead });
    if (res.status === 403 || res.status === 404) {
      // 予定の一覧は見られないカレンダー（空き時間だけ共有されている等）は、空き時間の問い合わせで代わりに調べる
      return await freeBusyOfCalendar(ghead, calId, days, ranges);
    }
    if (!res.ok) return `取り込みに失敗: ${res.status}`;
    const j = await res.json();
    for (const ev of j.items ?? []) {
      if (ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
      if (String(ev.source?.url ?? '').includes('eizo-maps.com')) continue;
      if (ev.start?.date) {
        // 終日予定。終了日は「翌日」が入っているので、そのまま「含まない終わり」として使う
        addRange(days, Date.parse(ev.start.date + 'T00:00:00+09:00'), Date.parse((ev.end?.date ?? ev.start.date) + 'T00:00:00+09:00'), ranges);
      } else if (ev.start?.dateTime) {
        addRange(days, Date.parse(ev.start.dateTime), Date.parse(ev.end?.dateTime ?? ev.start.dateTime), ranges);
      }
    }
    pageToken = j.nextPageToken ?? '';
    if (!pageToken) break;
  }
  return null;
}

async function freeBusyOfCalendar(ghead: Record<string, string>, calId: string, days: Set<string>, ranges: Range[]): Promise<string | null> {
  const start = Date.now();
  // Google は一度に問い合わせられる期間に上限があるので、60日ずつに分けて聞く
  for (let i = 0; i < PULL_DAYS / 60; i++) {
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: ghead,
      body: JSON.stringify({
        timeMin: new Date(start + i * 60 * DAY).toISOString(),
        timeMax: new Date(start + (i + 1) * 60 * DAY).toISOString(),
        timeZone: 'Asia/Tokyo',
        items: [{ id: calId }],
      }),
    });
    if (!res.ok) return `取り込みに失敗: ${res.status}`;
    const j = await res.json();
    const cal = j.calendars?.[calId];
    for (const b of cal?.busy ?? []) addRange(days, Date.parse(b.start), Date.parse(b.end), ranges);
  }
  return null;
}

/* ---------------- つないでいる Google アカウント ----------------
   1つ目のアカウント：calendar_links（id は null として扱う）
   2つ目以降：calendar_accounts（2026-10-25 追加・1人5つまで）
------------------------------------------------------------------ */
const MAX_EXTRA_ACCOUNTS = 5;

// 「Googleアカウントを追加」で戻ってくる場所（Google Cloud の OAuth クライアントにも同じものを登録する）
const ALLOWED_REDIRECTS = [
  'https://eizo-maps.com/schedule/google-callback.html',
  'https://www.eizo-maps.com/schedule/google-callback.html',
  'http://127.0.0.1:8123/schedule/google-callback.html',
];

type Acct = {
  id: string | null;            // null＝1つ目のアカウント
  email: string | null;
  sub: string | null;
  refresh_token_enc: string;
  busy_calendar_ids: string[] | null;
};

// deno-lint-ignore no-explicit-any
function mainAcct(link: any): Acct {
  return {
    id: null, email: link.google_email ?? null, sub: link.google_sub ?? null,
    refresh_token_enc: link.refresh_token_enc, busy_calendar_ids: link.busy_calendar_ids ?? null,
  };
}

// deno-lint-ignore no-explicit-any
async function extraAccts(db: any, userId: string): Promise<Acct[]> {
  const { data } = await db.from('calendar_accounts')
    .select('id,google_email,google_sub,refresh_token_enc,busy_calendar_ids')
    .eq('user_id', userId).order('connected_at').limit(MAX_EXTRA_ACCOUNTS);
  return (data ?? []).map((a: Record<string, unknown>) => ({
    id: String(a.id), email: (a.google_email as string) ?? null, sub: (a.google_sub as string) ?? null,
    refresh_token_enc: String(a.refresh_token_enc), busy_calendar_ids: (a.busy_calendar_ids as string[]) ?? null,
  }));
}

// アカウントごとの Google への合言葉（1回の処理の中で使い回す）
class Heads {
  private cache = new Map<string, Promise<Record<string, string>>>();
  constructor(private accts: Acct[]) {}
  key(id: string | null) { return id ?? 'main'; }
  find(id: string | null): Acct | undefined { return this.accts.find((a) => a.id === id); }
  get(id: string | null): Promise<Record<string, string>> {
    const k = this.key(id);
    if (!this.cache.has(k)) {
      const a = this.find(id);
      if (!a) return Promise.reject(new Error('そのGoogleアカウントはもうつながっていません'));
      this.cache.set(k, decrypt(a.refresh_token_enc).then(accessToken)
        .then((t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })));
    }
    return this.cache.get(k)!;
  }
}

/* ---------------- 1人分の同期 ---------------- */
type SyncResult = {
  pushed: number; updated: number; deleted: number; removed_from_eizo: number; busy_days: number; errors: string[];
};

// deno-lint-ignore no-explicit-any
async function syncUser(db: any, link: any, userId: string): Promise<SyncResult> {
  const extras = await extraAccts(db, userId);
  const heads = new Heads([mainAcct(link), ...extras]);
  // 1つ目のアカウントの許可が切れていたら、ここで止まる（今までと同じ）
  await heads.get(null);

  const pushAcct: string | null = link.push_account_id && heads.find(link.push_account_id) ? link.push_account_id : null;
  const writeCal = link.calendar_id ?? 'primary';
  const result: SyncResult = { pushed: 0, updated: 0, deleted: 0, removed_from_eizo: 0, busy_days: 0, errors: [] };
  const since = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  const acctErr = new Map<string, string>();   // 2つ目以降のアカウントの問題（アカウントごとに記録）
  const headOf = async (id: string | null) => {
    try { return await heads.get(id); } catch (e) {
      if (id) acctErr.set(id, String((e as Error).message).slice(0, 300));
      return null;
    }
  };

  // (a) Eizo Maps で消した予定を Google でも消す
  const { data: dels } = await db.from('google_delete_queue')
    .select('id,google_event_id,calendar_id,account_id').eq('user_id', userId).limit(200);
  for (const d of dels ?? []) {
    const gh = await headOf(d.account_id ?? null);
    if (!gh) continue;
    const c = encodeURIComponent(d.calendar_id ?? 'primary');
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${c}/events/${encodeURIComponent(d.google_event_id)}`,
      { method: 'DELETE', headers: gh },
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
  {
    const { data: synced } = await db.from('schedule_events')
      .select('id,google_event_id,google_calendar_id,google_account_id')
      .eq('owner_user_id', userId)
      .not('google_event_id', 'is', null)
      .not('google_synced_at', 'is', null)
      .gte('ends_on', since)
      .limit(200);
    for (const e of synced ?? []) {
      const gh = await headOf(e.google_account_id ?? null);
      if (!gh) continue;
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(e.google_calendar_id ?? writeCal)}/events/${encodeURIComponent(e.google_event_id)}?fields=status`,
        { headers: gh },
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
        await db.from('schedule_events').delete().eq('id', e.id).eq('owner_user_id', userId);
        // 消したときに「Google でも消す」控えが自動で作られるので、それは片づける（Google 側はもう無い）
        await db.from('google_delete_queue').delete().eq('user_id', userId).eq('google_event_id', e.google_event_id);
        result.removed_from_eizo++;
      }
    }
  }

  // (b) 未同期の予定を Google へ書き出す（書き出し先は、選んだアカウントのカレンダー）
  if (link.sync_push) {
    const pushHead = await headOf(pushAcct);
    if (!pushHead) {
      result.errors.push('書き出し先のGoogleアカウントの許可が切れています。アカウントをつなぎ直してください');
    } else {
      const { data: evs } = await db.from('schedule_events')
        .select('id,kind,title,note,location,starts_on,ends_on,start_time,end_time,google_event_id,google_calendar_id,google_account_id')
        .eq('owner_user_id', userId)
        .is('google_synced_at', null)
        .gte('ends_on', since)
        .order('starts_on')
        .limit(200);

      for (const e of evs ?? []) {
        const body = toGoogleEvent(e as Record<string, unknown>);
        let res: Response | null = null;
        let targetAcct: string | null = pushAcct;
        let target = writeCal;
        const create = async () => {
          targetAcct = pushAcct; target = writeCal;
          const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(writeCal)}/events`,
            { method: 'POST', headers: pushHead, body: JSON.stringify(body) });
          if (r.ok) result.pushed++;
          return r;
        };
        if (e.google_event_id) {
          // 前に書いた予定は、書いたアカウント・カレンダーの中で直す
          const oldAcct: string | null = e.google_account_id ?? null;
          const gh = await headOf(oldAcct);
          if (gh) {
            targetAcct = oldAcct;
            target = e.google_calendar_id ?? writeCal;
            res = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target)}/events/${encodeURIComponent(e.google_event_id)}`,
              { method: 'PATCH', headers: gh, body: JSON.stringify(body) },
            );
            if (res.status === 404 || res.status === 410) res = await create();   // Google 側で消されていたら作り直す
            else if (res.ok) result.updated++;
          } else {
            res = await create();   // 書いたアカウントが外れていたら、今の書き出し先に作り直す
          }
        } else {
          res = await create();
        }
        if (res && res.ok) {
          const g = await res.json();
          await db.from('schedule_events')
            .update({ google_event_id: g.id, google_calendar_id: target, google_account_id: targetAcct, google_synced_at: new Date().toISOString() })
            .eq('id', e.id);
        } else if (res) {
          result.errors.push(`書き出しに失敗: ${res.status}`);
        }
      }
    }
  }

  // (c) Google 側で埋まっている時間を取り込む（件名・場所は取らない）。つないだ全部のアカウントから
  if (link.sync_pull) {
    const days = new Set<string>();
    const ranges: Range[] = [];
    let pullOk = true;
    // 1つ目のアカウント（今までどおり。失敗したら取り込み全体を見送って、前の分を残す）
    const mainIds: string[] = (link.busy_calendar_ids && link.busy_calendar_ids.length)
      ? link.busy_calendar_ids.slice(0, 20)
      : (pushAcct === null ? [writeCal] : ['primary']);
    const mh = await heads.get(null);
    for (const id of mainIds) {
      const err = await busyOfCalendar(mh, id, days, ranges);
      if (err) { pullOk = false; result.errors.push(err); break; }
    }
    // 2つ目以降のアカウント（1つが失敗しても、ほかのアカウントの分は取り込む）
    if (pullOk) {
      for (const a of extras) {
        const ids = (a.busy_calendar_ids ?? []).slice(0, 20);
        if (!ids.length) continue;
        const gh = await headOf(a.id);
        if (!gh) continue;
        for (const id of ids) {
          const err = await busyOfCalendar(gh, id, days, ranges);
          if (err) { acctErr.set(a.id!, err); break; }
        }
      }
    }
    if (pullOk) {
      await db.from('google_busy').delete().eq('user_id', userId);
      if (days.size) {
        await db.from('google_busy').insert([...days].map((day) => ({ user_id: userId, day })));
      }
      result.busy_days = days.size;
      // 時間の幅（ほかの人に「予定あり」の時間だけを見せるため）
      await db.from('google_busy_ranges').delete().eq('user_id', userId);
      if (ranges.length) {
        await db.from('google_busy_ranges').insert(
          ranges.slice(0, 3000).map((r) => ({ user_id: userId, day: r.day, start_min: r.s, end_min: r.e })),
        );
      }
    }
  } else {
    await db.from('google_busy').delete().eq('user_id', userId);
    await db.from('google_busy_ranges').delete().eq('user_id', userId);
  }

  // 2つ目以降のアカウントの状態を、アカウントごとに記録する
  for (const a of extras) {
    await db.from('calendar_accounts').update({ last_sync_error: acctErr.get(a.id!) ?? null }).eq('id', a.id);
  }
  for (const [id, msg] of acctErr) {
    const a = heads.find(id);
    result.errors.push(`${a?.email ?? '追加したアカウント'}：${msg}`);
  }

  await db.from('calendar_links').update({
    last_sync_at: new Date().toISOString(),
    last_sync_error: result.errors.length ? result.errors.slice(0, 3).join(' / ').slice(0, 500) : null,
  }).eq('user_id', userId);

  return result;
}

/* ---------------- 自動同期（15分ごと） ---------------- */
// deno-lint-ignore no-explicit-any
async function syncEveryone(db: any) {
  const startedAt = Date.now();
  const { data: links } = await db.from('calendar_links')
    .select('*')
    .not('refresh_token_enc', 'is', null)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(100);
  for (const link of links ?? []) {
    if (Date.now() - startedAt > 120000) break; // 残りは次の回に回す
    try {
      await syncUser(db, link, link.user_id);
    } catch (err) {
      await db.from('calendar_links').update({
        last_sync_at: new Date().toISOString(),
        last_sync_error: String((err as Error).message ?? '自動同期に失敗しました').slice(0, 500),
      }).eq('user_id', link.user_id);
    }
  }
}

async function revoke(enc: string) {
  try {
    const rt = await decrypt(enc);
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: rt }),
    });
  } catch (_) { /* Google 側で既に失効していても、こちらの削除は続ける */ }
}

// Google の ID トークン（Google から直接受け取ったもの）の中身を読む。メールアドレスと番号だけ使う
function idTokenClaims(idToken: string): { sub?: string; email?: string } {
  try {
    const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = part + '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(pad), (c) => c.charCodeAt(0))));
  } catch (_) {
    return {};
  }
}

/* ---------------- 本体 ---------------- */
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'POST のみ受け付けます' }, 405, origin);

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action ?? '');

    /* ---- 自動同期（データベースの予約実行からだけ呼ばれる） ---- */
    if (action === 'cron') {
      const given = req.headers.get('x-cron-key') ?? '';
      const { data: row } = await db.from('app_internal').select('value').eq('key', 'gcal_cron').maybeSingle();
      if (!row?.value || given.length < 32 || given !== row.value) {
        return json({ error: '許可されていません' }, 403, origin);
      }
      // 返事はすぐ返し、同期は裏で続ける
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil(syncEveryone(db));
      return json({ ok: true }, 202, origin);
    }

    // 1. 呼び出し元の本人確認。ここを通らない限り何もしない。
    const auth = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json({ error: 'ログインが必要です' }, 401, origin);

    /* ---- 連携する（1つ目のアカウント・Supabase の Google ログイン経由） ---- */
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

    /* ---- Google アカウントを追加する：Google の許可画面の入口を作る（クライアントIDはここにだけ置く） ---- */
    if (action === 'add_account_url') {
      const redirect = String(payload.redirect_uri ?? '');
      const challenge = String(payload.code_challenge ?? '');
      const state = String(payload.state ?? '');
      if (!ALLOWED_REDIRECTS.includes(redirect)) return json({ error: '戻り先が正しくありません' }, 400, origin);
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || !/^[A-Za-z0-9_-]{16,128}$/.test(state)) {
        return json({ error: '準備に失敗しました。もう一度お試しください' }, 400, origin);
      }
      const q = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
        access_type: 'offline',
        prompt: 'select_account consent',   // 毎回アカウントを選べるように・裏で同期し続ける許可をもらうため
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      return json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` }, 200, origin);
    }

    /* ---- Google アカウントを追加する（2つ目以降。Google から戻ってきた「許可の番号」を、ここで許可に引き換える） ---- */
    if (action === 'add_account') {
      const code = String(payload.code ?? '');
      const verifier = String(payload.code_verifier ?? '');
      const redirect = String(payload.redirect_uri ?? '');
      if (!code || verifier.length < 43 || verifier.length > 128) return json({ error: 'Google からの戻りが正しくありません。もう一度お試しください' }, 400, origin);
      if (!ALLOWED_REDIRECTS.includes(redirect)) return json({ error: '戻り先が正しくありません' }, 400, origin);

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, code_verifier: verifier,
          grant_type: 'authorization_code', redirect_uri: redirect,
        }),
      });
      const tj = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Google との引き換えに失敗しました（${tj.error ?? res.status}）。もう一度お試しください` }, 400, origin);
      const scope = String(tj.scope ?? '');
      if (!scope.includes('calendar')) {
        return json({ error: 'カレンダーへの許可にチェックが入っていませんでした。もう一度、すべてにチェックを入れて許可してください' }, 400, origin);
      }
      const claims = idTokenClaims(String(tj.id_token ?? ''));
      if (!claims.sub) return json({ error: 'Google アカウントを確認できませんでした。もう一度お試しください' }, 400, origin);
      const rt = String(tj.refresh_token ?? '');
      const email = claims.email ? String(claims.email).slice(0, 200) : null;

      const { data: link } = await db.from('calendar_links').select('user_id,google_sub,refresh_token_enc').eq('user_id', user.id).maybeSingle();

      // まだ1つもつないでいない人は、このアカウントを1つ目にする
      if (!link || !link.refresh_token_enc) {
        if (!rt) return json({ error: 'Google からの許可を受け取れませんでした。Google アカウントの「サードパーティ アプリとの連携」で Eizo Maps の許可をいったん削除してから、もう一度お試しください' }, 400, origin);
        const { error } = await db.from('calendar_links').upsert({
          user_id: user.id, provider: 'google', google_email: email, google_sub: String(claims.sub).slice(0, 100),
          scope: scope.slice(0, 500), refresh_token_enc: await encrypt(rt), last_sync_error: null,
        }, { onConflict: 'user_id' });
        if (error) throw new Error(error.message);
        return json({ ok: true, email, main: true }, 200, origin);
      }

      // 1つ目と同じアカウントなら、1つ目の許可を新しくするだけ
      if (link.google_sub && link.google_sub === claims.sub) {
        if (rt) await db.from('calendar_links').update({ refresh_token_enc: await encrypt(rt), google_email: email, last_sync_error: null }).eq('user_id', user.id);
        return json({ ok: true, email, same_as_main: true }, 200, origin);
      }

      const { data: existing } = await db.from('calendar_accounts').select('id').eq('user_id', user.id).eq('google_sub', claims.sub).maybeSingle();
      if (existing) {
        if (rt) await db.from('calendar_accounts').update({ refresh_token_enc: await encrypt(rt), google_email: email, last_sync_error: null }).eq('id', existing.id);
        return json({ ok: true, email, again: true }, 200, origin);
      }
      if (!rt) return json({ error: 'Google からの許可を受け取れませんでした。Google アカウントの「サードパーティ アプリとの連携」で Eizo Maps の許可をいったん削除してから、もう一度お試しください' }, 400, origin);
      const { count } = await db.from('calendar_accounts').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
      if ((count ?? 0) >= MAX_EXTRA_ACCOUNTS) {
        await revoke(await encrypt(rt));
        return json({ error: `追加できる Google アカウントは ${MAX_EXTRA_ACCOUNTS} つまでです（1つ目とあわせて ${MAX_EXTRA_ACCOUNTS + 1} つ）` }, 400, origin);
      }
      const { error } = await db.from('calendar_accounts').insert({
        user_id: user.id, google_email: email, google_sub: String(claims.sub).slice(0, 100), scope: scope.slice(0, 500),
        refresh_token_enc: await encrypt(rt), busy_calendar_ids: ['primary'],
      });
      if (error) throw new Error(error.message);
      return json({ ok: true, email }, 200, origin);
    }

    // ここから先は連携済みであることが前提
    const { data: link } = await db.from('calendar_links').select('*').eq('user_id', user.id).maybeSingle();
    if (!link || !link.refresh_token_enc) {
      return json({ error: 'Google カレンダーと連携していません' }, 400, origin);
    }

    /* ---- 連携を解除する（つないでいる全部のアカウント） ---- */
    if (action === 'disconnect') {
      const extras = await extraAccts(db, user.id);
      for (const a of extras) await revoke(a.refresh_token_enc);
      await revoke(link.refresh_token_enc);
      await db.from('google_busy').delete().eq('user_id', user.id);
      await db.from('google_busy_ranges').delete().eq('user_id', user.id);
      await db.from('google_delete_queue').delete().eq('user_id', user.id);
      await db.from('calendar_accounts').delete().eq('user_id', user.id);
      await db.from('calendar_links').delete().eq('user_id', user.id);
      return json({ ok: true }, 200, origin);
    }

    /* ---- 2つ目以降のアカウントを1つだけ外す ---- */
    if (action === 'remove_account') {
      const id = String(payload.account_id ?? '');
      const { data: acc } = await db.from('calendar_accounts').select('id,refresh_token_enc').eq('id', id).eq('user_id', user.id).maybeSingle();
      if (!acc) return json({ error: 'そのアカウントは見つかりません' }, 400, origin);
      // このアカウントに書き出した予定は、Google 側から消してから外す（Google に置き去りにしない）
      try {
        const t = await accessToken(await decrypt(acc.refresh_token_enc));
        const gh = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
        const { data: evs } = await db.from('schedule_events').select('id,google_event_id,google_calendar_id')
          .eq('owner_user_id', user.id).eq('google_account_id', id).not('google_event_id', 'is', null).limit(300);
        for (const e of evs ?? []) {
          await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(e.google_calendar_id ?? 'primary')}/events/${encodeURIComponent(e.google_event_id)}`,
            { method: 'DELETE', headers: gh });
        }
      } catch (_) { /* 許可が切れていても、こちらの片づけは続ける */ }
      // 予定は Eizo Maps に残し、次の同期で今の書き出し先に書き直す
      await db.from('schedule_events')
        .update({ google_event_id: null, google_calendar_id: null, google_account_id: null, google_synced_at: null })
        .eq('owner_user_id', user.id).eq('google_account_id', id);
      if (link.push_account_id === id) {
        await db.from('calendar_links').update({ push_account_id: null, calendar_id: 'primary' }).eq('user_id', user.id);
      }
      await revoke(acc.refresh_token_enc);
      await db.from('calendar_accounts').delete().eq('id', id).eq('user_id', user.id);
      return json({ ok: true }, 200, origin);
    }

    /* ---- 同期する ---- */
    if (action === 'sync') {
      const result = await syncUser(db, link, user.id);
      return json({ ok: true, ...result }, 200, origin);
    }

    if (action !== 'list_calendars' && action !== 'set_calendars') {
      return json({ error: '不明な操作です' }, 400, origin);
    }

    // つないでいる全部のアカウントのカレンダー一覧（名前と、書き込めるかどうかだけ）
    const extras = await extraAccts(db, user.id);
    const accts = [mainAcct(link), ...extras];
    const heads = new Heads(accts);
    const lists: { acct: Acct; cals: Cal[]; error: string | null }[] = [];
    for (const a of accts) {
      try {
        lists.push({ acct: a, cals: await listCalendars(await heads.get(a.id)), error: null });
      } catch (e) {
        if (a.id === null) throw e;   // 1つ目が読めないときは今までどおりエラー
        lists.push({ acct: a, cals: [], error: String((e as Error).message).slice(0, 200) });
      }
    }
    const pushAcct: string | null = link.push_account_id && heads.find(link.push_account_id) ? link.push_account_id : null;

    if (action === 'list_calendars') {
      return json({
        ok: true,
        // 今までの画面向け（1つ目のアカウント）
        calendars: lists[0].cals,
        calendar_id: link.calendar_id ?? 'primary',
        busy_calendar_ids: link.busy_calendar_ids ?? [link.calendar_id ?? 'primary'],
        // 複数アカウント向け
        push_account_id: pushAcct,
        accounts: lists.map((l) => ({
          id: l.acct.id,
          email: l.acct.email,
          main: l.acct.id === null,
          error: l.error,
          calendars: l.cals,
          busy_calendar_ids: l.acct.id === null
            ? (link.busy_calendar_ids ?? (pushAcct === null ? [link.calendar_id ?? 'primary'] : ['primary']))
            : (l.acct.busy_calendar_ids ?? []),
        })),
      }, 200, origin);
    }

    /* ---- 使うカレンダーを保存する ---- */
    // 一覧に無い ID は受け付けない（他人のカレンダーを指定させない）
    type Norm = { byId: Map<string, Cal>; norm: (id: string) => string; back: (id: string) => string };
    const normOf = (cals: Cal[]): Norm => {
      const byId = new Map(cals.map((c) => [c.id, c]));
      const primaryId = cals.find((c) => c.primary)?.id ?? 'primary';
      return {
        byId,
        norm: (id: string) => (id === 'primary' ? primaryId : id),
        back: (id: string) => (byId.get(id)?.primary ? 'primary' : id),
      };
    };
    const listOf = (id: string | null) => lists.find((l) => l.acct.id === id);

    // 書き出し先：新しい形 {write:{account_id, calendar_id}}、今までの形 {calendar_id}
    const wAcct: string | null = payload.write && payload.write.account_id ? String(payload.write.account_id) : null;
    const wList = listOf(wAcct);
    if (!wList) return json({ error: '書き出し先のアカウントが見つかりません' }, 400, origin);
    const wn = normOf(wList.cals);
    const writeId = wn.norm(String((payload.write ? payload.write.calendar_id : payload.calendar_id) ?? 'primary'));
    const w = wn.byId.get(writeId);
    if (!w) return json({ error: '書き込み先のカレンダーが見つかりません' }, 400, origin);
    if (!w.writable) return json({ error: 'そのカレンダーには書き込みできません。別のカレンダーを選んでください' }, 400, origin);

    // 「埋まっている日」に使うカレンダー：新しい形 {busy:[{account_id, ids}]}、今までの形 {busy_ids}
    const busyByAcct = new Map<string, string[]>();
    const groups: { account_id: string | null; ids: unknown[] }[] = Array.isArray(payload.busy)
      ? payload.busy.map((g: Record<string, unknown>) => ({ account_id: g.account_id ? String(g.account_id) : null, ids: Array.isArray(g.ids) ? g.ids : [] }))
      : [{ account_id: null, ids: Array.isArray(payload.busy_ids) ? payload.busy_ids : [] }];
    let total = 0;
    for (const g of groups) {
      const l = listOf(g.account_id);
      if (!l) continue;
      const n = normOf(l.cals);
      const ids = [...new Set(g.ids.map((x) => n.norm(String(x))))].filter((id) => n.byId.has(id)).map(n.back);
      busyByAcct.set(g.account_id ?? 'main', ids);
      total += ids.length;
    }
    if (total > 40) return json({ error: '「埋まっている日」に使えるカレンダーは、全部で40個までです' }, 400, origin);
    for (const ids of busyByAcct.values()) {
      if (ids.length > 20) return json({ error: '1つのアカウントで「埋まっている日」に使えるカレンダーは20個までです' }, 400, origin);
    }

    const upd: Record<string, unknown> = { calendar_id: wn.back(writeId), push_account_id: wAcct };
    if (busyByAcct.has('main')) upd.busy_calendar_ids = busyByAcct.get('main');
    const { error } = await db.from('calendar_links').update(upd).eq('user_id', user.id);
    if (error) throw new Error(error.message);
    for (const a of extras) {
      if (!busyByAcct.has(a.id!)) continue;
      await db.from('calendar_accounts').update({ busy_calendar_ids: busyByAcct.get(a.id!) }).eq('id', a.id).eq('user_id', user.id);
    }
    return json({ ok: true }, 200, origin);
  } catch (err) {
    return json({ error: (err as Error).message ?? '処理に失敗しました' }, 400, origin);
  }
});
