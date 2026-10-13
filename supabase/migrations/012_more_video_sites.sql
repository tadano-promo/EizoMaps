-- =====================================================================
-- 012 作品に載せられるサイトを増やす（2026-10-13）
--   ・X / Instagram / Facebook：ページの中で再生する
--   ・それ以外のサイト（クライアントのホームページなど）：「リンク」として載せる
-- 既存のデータはそのまま有効（決まりをゆるめるだけ）。
-- =====================================================================

-- ---------- portfolios（作品棚） ----------
alter table public.portfolios alter column video_id drop not null;

alter table public.portfolios drop constraint if exists portfolios_provider_check;
alter table public.portfolios
  add constraint portfolios_provider_check
  check (provider in ('youtube','vimeo','tiktok','x','instagram','facebook','link'));

alter table public.portfolios drop constraint if exists portfolios_video_id_check;
alter table public.portfolios
  add constraint portfolios_video_id_check
  check (
    case when provider = 'link' then video_id is null
         else video_id is not null and video_id ~ '^[A-Za-z0-9_-]{1,32}$'
    end
  );

alter table public.portfolios drop constraint if exists portfolios_video_url_check;
alter table public.portfolios
  add constraint portfolios_video_url_check
  check (
    char_length(video_url) <= 500
    and video_url ~ '^https://'
    and (
      provider = 'link'
      or video_url ~ '^https://(www\.|m\.)?(youtube\.com/|youtu\.be/|vimeo\.com/|player\.vimeo\.com/|tiktok\.com/|x\.com/|twitter\.com/|instagram\.com/|facebook\.com/)'
    )
  );

-- ---------- stock_items（ストックページに直接貼った動画） ----------
alter table public.stock_items drop constraint if exists stock_items_provider_check;
alter table public.stock_items
  add constraint stock_items_provider_check
  check (provider is null or provider in ('youtube','vimeo','tiktok','x','instagram','facebook','link'));

alter table public.stock_items drop constraint if exists stock_items_shape;
alter table public.stock_items
  add constraint stock_items_shape check (
    case kind
      when 'video'   then portfolio_id is not null
                          or (provider is not null and url is not null
                              and (provider = 'link' or video_id is not null))
      when 'doc'     then portfolio_id is null and url is not null
      when 'link'    then portfolio_id is null and url is not null
      when 'note'    then portfolio_id is null and description is not null
      when 'heading' then portfolio_id is null and title is not null
      else false
    end
  );
