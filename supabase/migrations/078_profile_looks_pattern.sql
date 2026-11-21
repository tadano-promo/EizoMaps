-- 078: プロフィールの見た目：台本・フィルムを足す／柄（無地・ストライプ・ドット・方眼・ざらつき）を選べる（2026-11-22 翠くん「型にして、色や柄を変えれるように」）
alter table public.creators drop constraint if exists creators_profile_layout_check;
alter table public.creators add constraint creators_profile_layout_check check (profile_layout in ('standard','staffpass','clapper','poster','endroll','script','film'));
alter table public.creators add column if not exists profile_pattern text not null default 'plain';
alter table public.creators drop constraint if exists creators_profile_pattern_check;
alter table public.creators add constraint creators_profile_pattern_check check (profile_pattern in ('plain','stripe','dot','grid','grain'));
grant update (profile_pattern) on public.creators to authenticated;
