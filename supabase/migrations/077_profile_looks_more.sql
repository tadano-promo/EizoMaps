-- 077: プロフィールの見た目を増やす（カチンコ・映画ポスター・エンドロール）2026-11-22 翠くん「いろいろそんな感じで作っていこうか」
alter table public.creators drop constraint if exists creators_profile_layout_check;
alter table public.creators add constraint creators_profile_layout_check check (profile_layout in ('standard','staffpass','clapper','poster','endroll'));
