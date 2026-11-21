-- 分析頁權限：admin 一定可看；店長預設可看；帳務需勾選 can_analysis（已套用於資料庫）
alter table public.profiles add column if not exists can_analysis boolean not null default false;
-- admin_list_users 回傳加入 can_analysis；新增 admin_set_can_analysis(p_user, p_can)
