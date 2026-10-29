-- 032: 営業で見せるプロフィール（2026-10-30 翠くん決定：商談モード／作品の担当・目的・業種／料金の目安／機材・エリア・インボイス／受付状況の自動表示）
--
-- ・作品ごとに「担当」「目的」「業種」「尺」と、取引先名の出し方（社名あり／業種だけ／出さない）
--   社名は「社名あり」を選んだときだけ保存できる（隠したい社名が裏側に残らないように）
-- ・クリエイターに「対応エリア」「出張」「主な機材」「個人か法人か」「インボイス対応か」
--   インボイスは「登録あり／なし」だけ。登録番号は持たない・出さない（番号から本名が調べられるため）
-- ・料金の目安（パッケージ）を1人6つまで。金額は税込の円
-- 受付状況は、今ある空き状況（share_availability と予定）から画面で計算するので、ここでは何も足さない。

-- ---------- 作品 ----------
alter table public.portfolios
  add column if not exists role text,
  add column if not exists purpose text,
  add column if not exists industry text,
  add column if not exists length_label text,
  add column if not exists client_display text not null default 'hidden',
  add column if not exists client_name text;

alter table public.portfolios
  add constraint portfolios_role_len check (role is null or char_length(role) between 1 and 100),
  add constraint portfolios_purpose_check check (purpose is null or purpose in
    ('広告・CM','会社・ブランド紹介','採用','商品・サービス紹介','SNS用','イベント','研修・マニュアル','MV・エンタメ','ドキュメンタリー','その他')),
  add constraint portfolios_industry_check check (industry is null or industry in
    ('食品・飲料','化粧品・美容','自動車','保険・金融','テーマパーク・レジャー','飲食','IT・通信','不動産・住宅','医療・介護','教育','人材','小売・EC','行政・自治体','エンタメ・音楽','ファッション','製造・BtoB','その他')),
  add constraint portfolios_length_len check (length_label is null or char_length(length_label) between 1 and 30),
  add constraint portfolios_client_display_check check (client_display in ('named','industry','hidden')),
  add constraint portfolios_client_name_shape check (
    (client_display = 'named' and client_name is not null and char_length(client_name) between 1 and 60)
    or (client_display <> 'named' and client_name is null));

-- ---------- クリエイター ----------
alter table public.creators
  add column if not exists service_area text,
  add column if not exists travel_ok boolean,
  add column if not exists equipment text,
  add column if not exists business_type text,
  add column if not exists invoice_registered boolean;

alter table public.creators
  add constraint creators_service_area_len check (service_area is null or char_length(service_area) between 1 and 100),
  add constraint creators_equipment_len check (equipment is null or char_length(equipment) between 1 and 400),
  add constraint creators_business_type_check check (business_type is null or business_type in ('individual','corporation'));

-- ---------- 料金の目安 ----------
create table if not exists public.creator_packages (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 40),
  description text check (description is null or char_length(description) <= 300),
  price_yen integer not null check (price_yen between 0 and 100000000),
  price_from boolean not null default true,          -- true なら「〜」（ここから）
  delivery_days integer check (delivery_days is null or delivery_days between 1 and 365),
  revisions integer check (revisions is null or revisions between 0 and 20),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creator_packages_creator_idx on public.creator_packages(creator_id, sort_order);

alter table public.creator_packages enable row level security;

create or replace function public.is_my_creator(p_creator_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.creators c where c.id = p_creator_id and c.user_id = auth.uid());
$$;
grant execute on function public.is_my_creator(uuid) to anon, authenticated;

create policy creator_packages_select on public.creator_packages
  for select using (public.creator_is_published(creator_id) or public.is_my_creator(creator_id) or public.is_admin());
create policy creator_packages_insert on public.creator_packages
  for insert to authenticated with check (public.is_my_creator(creator_id));
create policy creator_packages_update on public.creator_packages
  for update to authenticated using (public.is_my_creator(creator_id)) with check (public.is_my_creator(creator_id));
create policy creator_packages_delete on public.creator_packages
  for delete to authenticated using (public.is_my_creator(creator_id));

grant select on public.creator_packages to anon, authenticated;
grant insert, update, delete on public.creator_packages to authenticated;

-- 1人6つまで
create or replace function public.creator_packages_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.creator_packages where creator_id = new.creator_id) >= 6 then
    raise exception '料金の目安は6つまでです';
  end if;
  return new;
end;
$$;
create trigger trg_creator_packages_limit before insert on public.creator_packages
  for each row execute function public.creator_packages_limit();

create or replace function public.creator_packages_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger trg_creator_packages_touch before update on public.creator_packages
  for each row execute function public.creator_packages_touch();

-- ---------- 列ごとの権限（creators・portfolios は列ごとに許可している） ----------
grant select (role, purpose, industry, length_label, client_display, client_name) on public.portfolios to anon, authenticated;
grant insert (role, purpose, industry, length_label, client_display, client_name),
      update (role, purpose, industry, length_label, client_display, client_name) on public.portfolios to authenticated;
grant select (service_area, travel_ok, equipment, business_type, invoice_registered) on public.creators to anon, authenticated;
grant insert (service_area, travel_ok, equipment, business_type, invoice_registered),
      update (service_area, travel_ok, equipment, business_type, invoice_registered) on public.creators to authenticated;
