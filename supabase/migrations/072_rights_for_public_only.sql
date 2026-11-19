-- 072: 載せる許可は「誰でも見られる（プロフィールに表示）」の作品にだけ必要にする（2026-11-19 翠くん）
--   「企業に許可は取れていなくても限定公開リンクだけでは公開したい場合もある。許可が取れているものしか表には出せない、
--    限定公開リンクはそうじゃなくても掲載できるようにして」
--   ・限定リンクのみ（link_only）・パスワードページだけ（stock_only）は、許可の確認がなくても載せられる
--   ・誰でも見られる（public）にするには、許可の確認（rights_confirmed_at）が要る
--   ・前から公開中で確認がまだの作品は、確認するまでプロフィールに出ない（本人には見える）

-- 許可の確認がない作品を「誰でも見られる」にさせない（026 の trg_portfolios_rights_guard のあとに動く）
create or replace function public.portfolios_public_needs_rights()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.visibility = 'public' and new.rights_confirmed_at is null
     and (tg_op = 'INSERT' or old.visibility is distinct from 'public') then
    raise exception '「公開（プロフィールに表示）」にするには、載せる許可の確認が必要です。許可がまだの作品は「限定リンクのみ」か「パスワードページだけ」にしてください';
  end if;
  return new;
end $$;
revoke execute on function public.portfolios_public_needs_rights() from public, anon, authenticated;
drop trigger if exists trg_portfolios_rights_public on public.portfolios;
create trigger trg_portfolios_rights_public before insert or update on public.portfolios
  for each row execute function public.portfolios_public_needs_rights();

-- プロフィール・検索に出すのは、許可の確認がある作品だけ
alter policy portfolios_select on public.portfolios
  using (((visibility = 'public') and rights_confirmed_at is not null and public.creator_is_published(creator_id)
          and public.portfolio_released(release_on, takedown_hold))
         or public.owns_creator(creator_id) or public.is_admin());

create or replace function public.portfolio_is_public(p_portfolio_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.portfolios p
    join public.creators c on c.id = p.creator_id
    where p.id = p_portfolio_id and p.visibility = 'public' and p.rights_confirmed_at is not null
      and c.is_published and c.approved and not c.suspended
      and public.portfolio_released(p.release_on, p.takedown_hold)
  );
$$;
