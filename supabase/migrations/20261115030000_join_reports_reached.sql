-- 接龍時回報「是否剛好成團」：在鎖住活動那一列的同時判斷，
-- 兩人同時接龍也只會有一位拿到 'reached'，管理員通知不會重複或漏掉。
-- 回傳值：ok / reached / full / already_joined / not_found
create or replace function public.join_activity(p_activity uuid, p_member uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity  integer;
  v_threshold integer;
  v_count     integer;
begin
  select capacity, threshold into v_capacity, v_threshold
  from activities
  where id = p_activity and status = 'open'
  for update;

  if not found then return 'not_found'; end if;

  if exists (select 1 from signups
             where activity_id = p_activity and member_id = p_member and cancelled_at is null) then
    return 'already_joined';
  end if;

  select count(*) into v_count from signups
  where activity_id = p_activity and cancelled_at is null;

  if v_count >= v_capacity then return 'full'; end if;

  insert into signups (activity_id, member_id) values (p_activity, p_member);

  if v_count + 1 = v_threshold then return 'reached'; end if;
  return 'ok';
end;
$$;
revoke all on function public.join_activity(uuid, uuid) from public, anon, authenticated;
