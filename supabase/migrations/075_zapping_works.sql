-- 075: ZAPPING（いろんなクリエイターの作品を次々見るページ）に流す作品（2026-11-20 翠くん）
--   流すのは「公開（プロフィールに表示）」かつ「載せる許可の確認済み」で、解禁日を過ぎ、申し立てで止まっていない作品だけ
--   クリエイターは公開中・運営の確認済み・止められていない人だけ
--   動画は YouTube・Vimeo だけ（音量・ミュート・再生／停止を Eizo Maps のボタンでそろえて動かせるのがこの2つだけのため）
--   順番は毎回ばらばら（翠くん「ランダムで、もう本当に規則性がない感じに」）
create or replace function public.zapping_works(p_limit integer default 200)
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select p.id, p.title, p.provider, p.video_id, p.video_url, p.thumbnail_url,
           p.media, p.industry, p.work_year, p.role,
           c.id as creator_id, c.display_name, c.handle, c.avatar_url
      from public.portfolios p
      join public.creators c on c.id = p.creator_id
     where p.visibility = 'public' and p.rights_confirmed_at is not null
       and public.portfolio_released(p.release_on, p.takedown_hold)
       and c.is_published and c.approved and not c.suspended
       and p.provider in ('youtube', 'vimeo')
     order by random()
     limit least(greatest(coalesce(p_limit, 200), 1), 300)
  ) x;
$$;
revoke all on function public.zapping_works(integer) from public;
grant execute on function public.zapping_works(integer) to anon, authenticated;
