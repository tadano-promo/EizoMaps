-- 048 退会の手続きを受け付けた／元に戻した、をメールで知らせる（2026-11-15 翠くん）
--   お知らせを止めている人にも送る（手続きの確認なので）
create or replace function public.notify_on_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notify_queue (user_id, kind, subject, body, link)
    values (new.user_id, 'withdraw_requested', '【Eizo Maps】退会の手続きを受け付けました',
      '退会の手続きを受け付けました。プロフィールは、いま見えなくなっています。' || chr(10) || chr(10)
      || to_char(new.purge_after at time zone 'Asia/Tokyo', 'YYYY年MM月DD日') || 'ごろに、作品・スケジュール・メッセージなどが消えます。' || chr(10)
      || 'それまでにログインすると「元に戻す」を選べます。' || chr(10) || chr(10)
      || '心あたりがないときは、すぐにログインして元に戻し、パスワードを変えてください。', '/account/delete/');
  elsif new.restored_at is not null and old.restored_at is null then
    insert into public.notify_queue (user_id, kind, subject, body, link)
    values (new.user_id, 'withdraw_restored', '【Eizo Maps】退会を取りやめました',
      '退会の手続きを取りやめ、アカウントを元に戻しました。' || chr(10)
      || 'プロフィールの公開の設定も、退会の前の状態に戻っています。', '/mypage/');
  end if;
  return null;
end;
$$;
revoke all on function public.notify_on_withdrawal() from public, anon, authenticated;
drop trigger if exists trg_withdrawals_notify on public.account_withdrawals;
create trigger trg_withdrawals_notify after insert or update on public.account_withdrawals
  for each row execute function public.notify_on_withdrawal();
