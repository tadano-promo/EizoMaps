-- =====================================================================
--  Eizo Maps / 追加マイグレーション 004
--  改善提案のストック（アップデート候補の置き場）
--  ---------------------------------------------------------------
--  実行方法: Supabase ダッシュボード > SQL Editor に貼り付けて実行
--  何度実行しても同じ結果になります。
--
--  ★ このテーブルの役割
--    「こう直したい／こう足したい」という案を、思いついた時点で必ず溜めておく場所。
--    ユーザーの声・実際の使われ方・こちらからの提案を同じ棚に並べ、
--    運営が「やる」と決めたものだけが status を動かして着手対象になる。
--    つまり、決断するまでは何も始まらないことを、データ側で担保する。
--
--  ★ セキュリティ方針
--    運営以外には1行も見せない。まだ出していない機能の計画が読めてしまうため。
--    status を動かせるのも運営だけ。
-- =====================================================================

create table if not exists public.improvement_proposals (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 120),
  detail       text check (detail is null or char_length(detail) <= 4000),
  area         text not null default 'other'
                 check (area in ('schedule','creators','projects','stock','admin',
                                 'email','infra','billing','content','other')),
  -- どこから出てきた案か
  --   user_voice : ユーザーが言ったこと
  --   usage      : 実際の使われ方から見えたこと
  --   ai         : こちら（Claude）からの提案
  --   ops        : 運営の気づき
  origin       text not null default 'ai'
                 check (origin in ('user_voice','usage','ai','ops')),
  impact       text not null default 'mid' check (impact in ('high','mid','low')),
  effort       text not null default 'mid' check (effort in ('high','mid','low')),
  -- 無料枠で収まるか、有料が絡むか。お金の話を必ず書き残す。
  cost_note    text check (cost_note is null or char_length(cost_note) <= 300),
  status       text not null default 'stocked'
                 check (status in ('stocked','approved','building','done','rejected')),
  decided_note text check (decided_note is null or char_length(decided_note) <= 1000),
  decided_at   timestamptz,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.improvement_proposals enable row level security;
alter table public.improvement_proposals force row level security;
create index if not exists idx_proposals_status
  on public.improvement_proposals (status, impact, created_at desc);

drop trigger if exists trg_proposals_updated_at on public.improvement_proposals;
create trigger trg_proposals_updated_at before update on public.improvement_proposals
  for each row execute function public.set_updated_at();

-- 決めた瞬間に日時を刻む（あとから「いつ決めたか」を辿れるように）
create or replace function public.stamp_proposal_decision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status <> 'stocked' then
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proposal_decision on public.improvement_proposals;
create trigger trg_proposal_decision before update on public.improvement_proposals
  for each row execute function public.stamp_proposal_decision();

-- 運営だけ（まだ出していない計画が読まれないように）
drop policy if exists proposals_admin_select on public.improvement_proposals;
create policy proposals_admin_select on public.improvement_proposals
  for select to authenticated using (public.is_admin());

drop policy if exists proposals_admin_insert on public.improvement_proposals;
create policy proposals_admin_insert on public.improvement_proposals
  for insert to authenticated with check (public.is_admin());

drop policy if exists proposals_admin_update on public.improvement_proposals;
create policy proposals_admin_update on public.improvement_proposals
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists proposals_admin_delete on public.improvement_proposals;
create policy proposals_admin_delete on public.improvement_proposals
  for delete to authenticated using (public.is_admin());

grant select on public.improvement_proposals to authenticated;
grant insert (title, detail, area, origin, impact, effort, cost_note, status, decided_note)
  on public.improvement_proposals to authenticated;
grant update (title, detail, area, origin, impact, effort, cost_note, status, decided_note)
  on public.improvement_proposals to authenticated;
grant delete on public.improvement_proposals to authenticated;

-- ---------------------------------------------------------------------
-- 初期ストック
--   この会話で出た「やりたいこと」を、着手前の候補として置いておく。
--   status はすべて stocked。運営が approved にしたものだけ着手する。
-- ---------------------------------------------------------------------
insert into public.improvement_proposals (title, detail, area, origin, impact, effort, cost_note)
select * from (values
  ('日程調整：空き状況から3候補を自動提示',
   E'依頼側と受け手の双方の空き状況と、予定にかかる想定時間（撮影1日／編集3日など、種別ごとの標準値と実績の平均）を突き合わせ、成立しそうな日時を3案出して提示する。\n提示した案はそのまま仮押さえにでき、相手が選んだ時点で本予定に変わる。\n必要なもの：所要時間の標準値テーブル、双方の空き突合ロジック、候補提示と合意の画面。\n重い処理になるため、同時に有料プランの線引きを決める必要がある。',
   'schedule', 'user_voice', 'high', 'high',
   '計算負荷が読めないため、有料プラン側の機能として設計する前提'),

  ('映像制作の流れに沿って次のアクションを提案する',
   E'企画→構成→香盤→撮影→オフライン→MA→試写→納品→請求、という決まった流れを型として持ち、案件の状態から「次にやること」と「そろそろ押さえるべき日程」を出す。\n提案された項目・詳細はユーザーが自由に書き換えられるようにし、書き換えの差分を裏で溜める。\nその差分を定期的に見て、型そのものを直していく（＝提案の精度が使うほど上がる循環）。\n必要なもの：工程テンプレート、案件ごとの進行状態、提案の生成、修正差分の記録。',
   'projects', 'user_voice', 'high', 'high',
   '差分の蓄積までは無料枠で可能。提案の生成をAIに寄せる場合は有料'),

  ('有料プランの線引きを決める',
   E'日程調整の自動提示や工程提案など、計算量や外部APIを使う機能を有料側に置く。\n無料でどこまで使えて、有料で何が増えるのかを先に決めないと、機能ごとの判断がぶれる。\n決済手段の選定（サイト内決済は当初「やらないこと」に入れていたため、方針の見直しが要る）。',
   'billing', 'user_voice', 'high', 'mid',
   '有料プランそのものの検討。決済手数料が発生する'),

  ('Google カレンダーとのアカウント連携',
   E'いまは予定を Eizo Maps 側に持つところまで。Google カレンダーへ即時に反映するには、Google アカウント連携（calendar スコープ）が要る。\nこのスコープは Google の「機密スコープ」にあたり、審査が必要。審査自体は無料で、通常3〜5営業日。ドメイン所有の確認・プライバシーポリシー・操作のデモ動画の提出が要る。\n審査が通るまでは、登録した100人までしか使えず警告画面が出る。\nまた裏で同期し続けるにはトークンを安全に保管する必要があり、Edge Function が要る。\nGoogle を使っていない人（Apple／Outlook／メール登録のみ）向けに、購読URL方式も併せて用意しておくべき。',
   'schedule', 'user_voice', 'high', 'high',
   '無料。ただし審査に3〜5営業日。Edge Function は無料枠内'),

  ('確認メールをテキスト部つきで送れるようにする',
   E'Supabase の送信はソース上 text/html の1パートのみで、プレーンテキスト版を付けられない（internal/mailer/mailmeclient.go の mail.SetBody("text/html", body)）。\nHTML を表示しないメールソフトではタグが見える。いまは pre タグ1組だけに抑えて実用上は読める状態。\n完全に解消するには Send Email Hook（Edge Function）で multipart/alternative を自前生成する。',
   'email', 'ops', 'mid', 'mid',
   '無料枠内。さくらのSMTPパスワードをシークレットに登録する作業が要る'),

  ('HTTPS の証明書が発行されない件の解消',
   E'DNS は正しく（Aレコード4つ・www の CNAME・CAA なし）、GitHub 側も「DNS check successful」だが、証明書発行が Certificate Request Error のまま止まっている。\n定石はカスタムドメインをいったん外して再登録し、発行をやり直させること。リポジトリ設定の変更にあたるため、運営の判断を待っている。',
   'infra', 'ops', 'high', 'low',
   '無料'),

  ('ノウハウ記事の執筆画面と読む側の画面',
   E'テーブルと権限（下書き・確認待ち・公開、執筆許可）は用意済み。画面がまだない。\n執筆許可を受けたクリエイターが書き、運営が確認して公開する流れ。\n記事本文の描画方式（Markdown を使うなら、HTML を作らない安全な描画に限定する）を決める必要がある。',
   'content', 'user_voice', 'mid', 'mid', '無料枠内'),

  ('映像の最新情報をまとめる定期タスクとの連携',
   E'Claude の定期タスクで集めた情報を、articles に source=auto の下書きとして投入する。\nstatus は必ず draft から始まるため、運営が確認してからでないと公開されない。\n投入経路（service_role を持つ定期タスクから REST で insert）と、重複を避ける仕組みが要る。',
   'content', 'user_voice', 'mid', 'mid', '無料枠内'),

  ('パスワード変更をフォロワーに知らせる',
   E'ストックページのパスワードを変えたとき、フォローしている相手に知らせる。\nフォローと除外のテーブルは用意済み。送信の仕組み（Edge Function）が未了。\n通知に新しいパスワードそのものを載せるかどうかは、運営の判断待ち。',
   'stock', 'user_voice', 'mid', 'mid', '無料枠内')
) as v(title, detail, area, origin, impact, effort, cost_note)
where not exists (
  select 1 from public.improvement_proposals p where p.title = v.title
);
