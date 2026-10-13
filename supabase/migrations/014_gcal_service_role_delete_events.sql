-- 014 Google で消された予定を Eizo Maps からも消すため、裏の係（service_role）に予定の削除を許可（2026-10-13）
grant delete on public.schedule_events to service_role;
