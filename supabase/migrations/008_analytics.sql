-- 分析頁面：依月份彙總（以呼叫者身分執行，仍受店別權限 RLS 限制）
-- 店休日（店業績與來客皆為 0，且有師傅狀態為颱風假／國定假日）不計入工作日與營業天數

create or replace function public.analytics_monthly(p_stores text[], p_from date, p_to date)
returns table (store text, ym text, alias text, work_days int, amount numeric, cnt int, walkin int)
language sql stable security invoker set search_path = public as $$
  with d as (
    select r.id,
           coalesce(sum(i.amount) filter (where i.status = 'work'), 0) amt,
           coalesce(sum(i.total_count) filter (where i.status = 'work'), 0) c,
           coalesce(bool_or(i.status in ('typhoon', 'holiday')), false) hol
    from daily_reports r left join daily_report_items i on i.report_id = r.id
    where r.store = any(p_stores) and r.report_date between p_from and p_to
    group by r.id
  ), ok as (select id from d where not (amt = 0 and c = 0 and hol))
  select r.store::text, to_char(r.report_date, 'YYYY-MM'), i.name::text,
         (count(*) filter (where i.status = 'work'))::int,
         coalesce(sum(i.amount) filter (where i.status = 'work'), 0),
         (coalesce(sum(i.total_count) filter (where i.status = 'work'), 0))::int,
         (coalesce(sum(i.unfulfilled) filter (where i.status = 'work'), 0))::int
  from daily_reports r
  join ok on ok.id = r.id
  join daily_report_items i on i.report_id = r.id
  group by 1, 2, 3
$$;

create or replace function public.analytics_days(p_stores text[], p_from date, p_to date)
returns table (store text, ym text, open_days int)
language sql stable security invoker set search_path = public as $$
  with d as (
    select r.id, r.store, r.report_date,
           coalesce(sum(i.amount) filter (where i.status = 'work'), 0) amt,
           coalesce(sum(i.total_count) filter (where i.status = 'work'), 0) c,
           coalesce(bool_or(i.status in ('typhoon', 'holiday')), false) hol
    from daily_reports r left join daily_report_items i on i.report_id = r.id
    where r.store = any(p_stores) and r.report_date between p_from and p_to
    group by r.id
  )
  select store::text, to_char(report_date, 'YYYY-MM'), (count(*))::int
  from d where not (amt = 0 and c = 0 and hol) group by 1, 2
$$;

revoke execute on function public.analytics_monthly(text[], date, date), public.analytics_days(text[], date, date) from public, anon;
grant execute on function public.analytics_monthly(text[], date, date), public.analytics_days(text[], date, date) to authenticated;

-- 師傅抽成比例（薪資試算用；只有超級管理員與帳務人員可讀寫）
create table public.therapist_rates (
  alias text primary key,
  rate numeric not null check (rate >= 0 and rate <= 1),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.therapist_rates enable row level security;
create policy rates_read on public.therapist_rates for select to authenticated
  using (public.app_role() in ('admin', 'accountant'));
create trigger audit_therapist_rates after insert or update or delete on public.therapist_rates
  for each row execute function public.audit_row_change();

create or replace function public.set_therapist_rate(p_alias text, p_rate numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() not in ('admin', 'accountant') then raise exception 'forbidden'; end if;
  insert into public.therapist_rates(alias, rate, updated_by) values (p_alias, p_rate, auth.uid())
  on conflict (alias) do update set rate = excluded.rate, updated_by = auth.uid(), updated_at = now();
end $$;

revoke all on public.therapist_rates from anon;
revoke insert, update, delete, truncate on public.therapist_rates from authenticated;
revoke execute on function public.set_therapist_rate(text, numeric) from public, anon;
grant execute on function public.set_therapist_rate(text, numeric) to authenticated;
