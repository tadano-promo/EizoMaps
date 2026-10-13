-- =====================================================================
-- 013 Googleカレンダー連携の裏の係（Edge Function）に、必要な表だけ触れる権限を付ける（2026-10-13）
-- 裏の係は service_role で動く。画面（anon / authenticated）の権限は一切変えない。
-- =====================================================================
grant select, insert, update, delete on public.calendar_links      to service_role;
grant select, insert, delete         on public.google_busy         to service_role;
grant select, delete                 on public.google_delete_queue to service_role;
grant select, update                 on public.schedule_events     to service_role;
