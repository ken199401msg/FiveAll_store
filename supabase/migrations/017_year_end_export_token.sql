-- 給另一個專案背景核對：唯讀、需私鑰、整年、兩店合併、排除五測（私鑰只存雜湊，不放在版本庫）
create table if not exists public.external_read_tokens (
  name text primary key, token_hash text not null, created_at timestamptz not null default now());
alter table public.external_read_tokens enable row level security;
revoke all on public.external_read_tokens from anon, authenticated;

create or replace function public.year_end_export(p_year int, p_token text)
returns table(year int, month int, name text, sales int, bonus int, work_days int)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_token is null or not exists (select 1 from external_read_tokens t where t.name = 'year_end_export' and t.token_hash = encode(sha256(convert_to(p_token,'utf8')),'hex')) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return query
  with m as (
    select trim(i.name) as nm, extract(month from d.report_date)::int as mo,
           sum(round(coalesce(i.amount,0)))::int as s, count(distinct d.report_date)::int as wd
    from daily_reports d join daily_report_items i on i.report_id = d.id
    where i.status = 'work' and d.store::text <> '五測' and coalesce(trim(i.name),'') <> ''
      and d.report_date >= make_date(p_year,1,1) and d.report_date <= make_date(p_year,12,31)
    group by 1,2)
  select p_year, m.mo, m.nm::text, m.s, (case when m.s < 90000 then 0 else 500 + ((m.s - 90000) / 10000) * 500 end)::int, m.wd
  from m order by m.mo, m.nm;
end $$;
revoke all on function public.year_end_export(int,text) from public;
grant execute on function public.year_end_export(int,text) to anon, authenticated;
