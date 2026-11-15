-- 050 退会して消える3日前に「もうすぐ消えます」のメール（2026-11-15 翠くん）
--   毎日 9:13（日本時間）に、3日以内に消える人のうち、まだ知らせていない人へ1回だけ
alter table public.account_withdrawals add column if not exists reminded_at timestamptz;

create or replace function public.withdraw_remind_due()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0; w record;
begin
  for w in select * from public.account_withdrawals
            where restored_at is null and purged_at is null and reminded_at is null
              and purge_after <= now() + interval '3 days' and purge_after > now()
  loop
    insert into public.notify_queue (user_id, kind, subject, body, link)
    values (w.user_id, 'withdraw_reminder', '【Eizo Maps】あと少しでアカウントの中身が消えます',
      'Eizo Maps の退会の手続きから、もうすぐ30日になります。' || chr(10)
      || to_char(w.purge_after at time zone 'Asia/Tokyo', 'YYYY年MM月DD日') || 'ごろに、作品・スケジュール・メッセージなどが消えます。消えたあとは元に戻せません。' || chr(10) || chr(10)
      || '続けて使いたいときは、それまでにログインして「元に戻す」を押してください。退会のままでよければ、このメールはそのままで大丈夫です。',
      '/account/delete/');
    update public.account_withdrawals set reminded_at = now() where id = w.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.withdraw_remind_due() from public, anon, authenticated;

select cron.schedule('account-withdraw-remind', '13 0 * * *', $$ select public.withdraw_remind_due(); $$);
