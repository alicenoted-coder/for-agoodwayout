-- 人員審核：新成員預設「待審核」，管理員通過後才看得到網站內容。
-- 同時把所有讀取收回後端（Edge Function 驗證身分＋審核狀態後才給資料），
-- 不再讓任何人用公開金鑰直接讀活動或暱稱。

alter table public.members
  add column status text not null default 'pending'
    check (status in ('pending', 'approved', 'disabled')),
  add column reviewed_at timestamptz;

-- 現有成員（目前只有管理員本人）直接通過
update public.members set status = 'approved', reviewed_at = now();

drop policy if exists "public can read open activities" on public.activities;
drop policy if exists "public can read nicknames"       on public.members;
drop policy if exists "public can read active signups"  on public.signups;
drop view  if exists public.public_signups;

revoke all on public.activities, public.members, public.signups from anon, authenticated;
