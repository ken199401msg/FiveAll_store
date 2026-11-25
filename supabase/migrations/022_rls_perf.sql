-- 效能：日報與師傅日帳的讀取政策，身分判斷只算一次（initplan），分析頁查詢 2.6 秒 → 65 毫秒
drop policy if exists web_read_daily_reports on public.daily_reports;
create policy web_read_daily_reports on public.daily_reports for select to authenticated
  using (((select public.app_role()) = 'admin' or store::text = any ((select public.app_stores())::text[]))
         and (select public.app_role()) in ('admin','manager','accountant')
         and report_date >= (select public.app_data_from()));
drop policy if exists web_read_daily_report_items on public.daily_report_items;
create policy web_read_daily_report_items on public.daily_report_items for select to authenticated
  using (exists (select 1 from public.daily_reports d where d.id = daily_report_items.report_id));
create index if not exists daily_report_items_report_id_idx on public.daily_report_items(report_id);
create index if not exists daily_reports_store_date_idx on public.daily_reports(store, report_date);
