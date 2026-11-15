-- 出走社活動接龍：第一階段資料表
-- 三張表：members（社員）、activities（活動）、signups（接龍紀錄）
-- 原則：公開頁面只看得到暱稱；LINE 的內部 ID 只有後端（Edge Function）讀得到。

-- ---------- 社員 ----------
create table public.members (
  id                 uuid primary key default gen_random_uuid(),
  line_user_id       text not null unique,          -- LINE 登入給的內部 ID（不公開，不是加好友用的 LINE ID）
  line_display_name  text,                          -- LINE 顯示名稱（不公開，管理員辨識用）
  nickname           text not null check (char_length(nickname) between 1 and 12),  -- 社群暱稱（公開）
  is_admin           boolean not null default false,
  created_at         timestamptz not null default now()
);

-- ---------- 活動 ----------
create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  category     text not null check (category in ('host','select','member','social')),
               -- host=出走社主辦 select=出走社嚴選 member=社員自揪 social=社交活動
  title        text not null,
  host_name    text not null,                       -- 帶領 / 揪團人
  event_date   date not null,
  time_text    text,                                -- 例如「14:00–16:30」
  place        text,
  price        integer not null default 0 check (price >= 0),   -- 0 = 免費
  price_note   text,                                -- 含材料 / 含服務費
  capacity     integer not null check (capacity > 0),           -- 名額上限
  threshold    integer not null check (threshold > 0),          -- 開班門檻
  description  text,
  status       text not null default 'open' check (status in ('open','cancelled')),
  created_by   uuid references public.members(id),
  created_at   timestamptz not null default now(),
  check (threshold <= capacity)
);

-- ---------- 接龍紀錄 ----------
create table public.signups (
  id            uuid primary key default gen_random_uuid(),
  activity_id   uuid not null references public.activities(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz                          -- 有值 = 已取消（保留紀錄方便統計）
);
-- 同一個人在同一場活動只能有一筆「有效」接龍
create unique index signups_one_active_per_member
  on public.signups (activity_id, member_id) where cancelled_at is null;
create index signups_activity_idx on public.signups (activity_id) where cancelled_at is null;

-- ---------- 權限：預設全部鎖住 ----------
alter table public.members    enable row level security;
alter table public.activities enable row level security;
alter table public.signups    enable row level security;

-- 任何人都能讀「開放中」的活動
grant select on public.activities to anon, authenticated;
create policy "public can read open activities"
  on public.activities for select
  to anon, authenticated
  using (status = 'open');

-- members / signups 不開放直接讀寫；寫入一律透過 Edge Function（先驗證 LINE 身分）

-- ---------- 公開名單：只露出暱稱 ----------
create view public.public_signups as
  select s.activity_id, m.nickname, s.created_at
  from public.signups s
  join public.members m on m.id = s.member_id
  where s.cancelled_at is null;
revoke all on public.public_signups from anon, authenticated;
grant select on public.public_signups to anon, authenticated;

-- ---------- 接龍：鎖住活動那一列再檢查名額，避免兩人同時搶到最後一位 ----------
create or replace function public.join_activity(p_activity uuid, p_member uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_count    integer;
begin
  select capacity into v_capacity
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
  return 'ok';
end;
$$;
-- 只有後端（service role）能呼叫
revoke all on function public.join_activity(uuid, uuid) from public, anon, authenticated;
