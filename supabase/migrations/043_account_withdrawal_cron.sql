-- 043：退会して30日たった人の後片付けを、毎日1回（日本時間 4:23）自動で動かす
--   呼び先：Edge Function「account」（x-cron-key は app_internal 'withdraw_cron'）
select cron.schedule(
  'account-withdraw-purge',
  '23 19 * * *',
  $cron$
  select net.http_post(
    url     := 'https://buquisjkkwvekoyuuxjx.supabase.co/functions/v1/account',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ1cXVpc2pra3d2ZWtveXV1eGp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTU2NjQsImV4cCI6MjEwNDc5MTY2NH0.jPkr8vQycg3ICajTPVcY8ltfb8evK26fYHvfb-FrU3c',
      'x-cron-key',    (select value from public.app_internal where key = 'withdraw_cron')
    ),
    body    := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);
