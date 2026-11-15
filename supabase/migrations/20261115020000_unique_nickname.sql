-- 暱稱不可重複（不分大小寫），避免名單上出現兩個一樣的名字分不清楚
create unique index members_nickname_unique on public.members (lower(nickname));
