-- 公開名單改用 Supabase 建議做法：view 以查詢者身分執行（security_invoker），
-- 用「欄位權限＋RLS」只開放暱稱，不再依賴 view 擁有者的權限。

-- 社員：大家只讀得到 id 和暱稱；LINE ID、LINE 名稱、是否管理員都讀不到
revoke all on public.members from anon, authenticated;
grant select (id, nickname) on public.members to anon, authenticated;
create policy "public can read nicknames"
  on public.members for select
  to anon, authenticated
  using (true);

-- 接龍紀錄：大家只讀得到「有效」的接龍；不能寫入
revoke all on public.signups from anon, authenticated;
grant select (activity_id, member_id, created_at, cancelled_at) on public.signups to anon, authenticated;
create policy "public can read active signups"
  on public.signups for select
  to anon, authenticated
  using (cancelled_at is null);

alter view public.public_signups set (security_invoker = true);
