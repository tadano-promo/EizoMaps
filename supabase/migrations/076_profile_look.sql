-- 076: プロフィールの見た目を選べるように（2026-11-22 翠くん。まずは STAFF PASS）
--   profile_layout：standard（今まで）／staffpass（撮影現場のスタッフ証）
--   profile_color ：STAFF PASS の色（yellow／blue／green／red／mono）
--   見た目が変わるのは上の名前の部分だけ。作品・評価・依頼ボタンの中身と順番は同じ
alter table public.creators add column if not exists profile_layout text not null default 'standard';
alter table public.creators add column if not exists profile_color text not null default 'yellow';
alter table public.creators drop constraint if exists creators_profile_layout_check;
alter table public.creators add constraint creators_profile_layout_check check (profile_layout in ('standard','staffpass'));
alter table public.creators drop constraint if exists creators_profile_color_check;
alter table public.creators add constraint creators_profile_color_check check (profile_color in ('yellow','blue','green','red','mono'));
grant update (profile_layout, profile_color) on public.creators to authenticated;
