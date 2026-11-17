-- 061: 同じ人が同じ案件に、同じ文を10秒以内に2回送ったら、2回目は入れない（2026-11-17 0.1秒差で同じメッセージが2つ届いた）
create or replace function public.project_message_dedupe() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.project_messages m
              where m.project_id = new.project_id and m.sender_id = new.sender_id
                and m.body = new.body and m.created_at > now() - interval '10 seconds') then
    raise exception '同じメッセージをいま送ったところです（2回押しを止めました）。';
  end if;
  return new;
end $$;
drop trigger if exists trg_project_message_dedupe on public.project_messages;
create trigger trg_project_message_dedupe before insert on public.project_messages for each row execute function public.project_message_dedupe();
