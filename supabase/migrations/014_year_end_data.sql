-- 年終核對：整年師傅月業績（security definer，不受資料起始日截斷；依 can_see_store 限制店別）
create or replace function public.year_end_data(p_year int, p_store text default null)
returns table(alias text, ym text, amount numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.app_role() not in ('admin','manager','accountant') then raise exception '無權限'; end if;
  if p_store is not null and not public.can_see_store(p_store) then raise exception '無權限查看此店'; end if;
  return query
    select i.name::text, to_char(d.report_date,'YYYY-MM')::text, sum(coalesce(i.amount,0))::numeric
    from daily_reports d join daily_report_items i on i.report_id = d.id
    where i.status = 'work'
      and d.report_date >= make_date(p_year,1,1) and d.report_date <= make_date(p_year,12,31)
      and (case when p_store is null then public.can_see_store(d.store::text) else d.store::text = p_store end)
    group by 1,2;
end $$;
revoke all on function public.year_end_data(int,text) from public, anon;
grant execute on function public.year_end_data(int,text) to authenticated;
