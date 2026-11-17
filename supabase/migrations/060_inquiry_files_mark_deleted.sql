-- 060: 自動で消したあと「ファイルは消しました」と記録する（inquiry-cleanup から呼ぶ。service_role だけ）
create or replace function public.inquiry_files_mark_deleted(p_id uuid) returns void
language sql security definer set search_path to '' as $$
  update public.inquiries set files = '{}', files_deleted_at = now()
   where id = p_id and status = 'done' and done_at < now() - interval '30 days';
$$;
revoke all on function public.inquiry_files_mark_deleted(uuid) from public, anon, authenticated;
grant execute on function public.inquiry_files_mark_deleted(uuid) to service_role;
