-- 年終核對：獎金依兩店合併（排除五測）的當月業績計算；業績欄只回傳呼叫者可看的範圍
drop function if exists public.year_end_data(int,text);
create or replace function public.year_end_data(p_year int, p_store text default null)
returns table(alias text, ym text, amount numeric, bonus numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.app_role() not in ('admin','manager','accountant') then raise exception '無權限'; end if;
  if p_store is not null and not public.can_see_store(p_store) then raise exception '無權限查看此店'; end if;
  return query
  with allm as (
    select trim(i.name) as nm, to_char(d.report_date,'YYYY-MM') as ym, sum(round(coalesce(i.amount,0))) as tot
    from daily_reports d join daily_report_items i on i.report_id = d.id
    where i.status='work' and d.store::text <> '五測'
      and d.report_date >= make_date(p_year,1,1) and d.report_date <= make_date(p_year,12,31)
    group by 1,2),
  scoped as (
    select trim(i.name) as nm, to_char(d.report_date,'YYYY-MM') as ym, sum(round(coalesce(i.amount,0))) as amt
    from daily_reports d join daily_report_items i on i.report_id = d.id
    where i.status='work' and d.store::text <> '五測'
      and d.report_date >= make_date(p_year,1,1) and d.report_date <= make_date(p_year,12,31)
      and (case when p_store is null then public.can_see_store(d.store::text) else d.store::text = p_store end)
    group by 1,2)
  select s.nm::text, s.ym::text, s.amt::numeric,
         (case when a.tot < 90000 then 0 else (floor((a.tot - 90000) / 10000) + 1) * 500 end)::numeric
  from scoped s join allm a on a.nm = s.nm and a.ym = s.ym;
end $$;
revoke all on function public.year_end_data(int,text) from public, anon;
grant execute on function public.year_end_data(int,text) to authenticated;
