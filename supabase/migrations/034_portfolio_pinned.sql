-- 034: 代表作の固定（2026-10-30 翠くん決定：foriioさんのベンチマークから「代表作を4つまで先頭に固定」）
-- 固定した作品は、プロフィールの作品の先頭と、商談モードの「代表作」に出る。1人4つまで。

alter table public.portfolios add column if not exists pinned boolean not null default false;

grant select (pinned) on public.portfolios to anon, authenticated;
grant insert (pinned), update (pinned) on public.portfolios to authenticated;

create or replace function public.portfolios_pinned_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pinned and (tg_op = 'INSERT' or not old.pinned) then
    if (select count(*) from public.portfolios p where p.creator_id = new.creator_id and p.pinned and p.id <> new.id) >= 4 then
      raise exception '代表作に固定できるのは4つまでです。ほかの作品の固定を外してください';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_portfolios_pinned_limit before insert or update of pinned on public.portfolios
  for each row execute function public.portfolios_pinned_limit();
