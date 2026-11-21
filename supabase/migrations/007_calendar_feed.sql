-- 日曆訂閱連結：每家店一組專屬密碼（token），只能透過函式取得；不開放任何直接讀寫
create table public.calendar_tokens (
  store text primary key,
  token text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
revoke all on public.calendar_tokens from anon, authenticated;

create or replace function public.calendar_token_get(p_store text) returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.can_see_store(p_store) then raise exception 'forbidden'; end if;
  insert into public.calendar_tokens(store, token, created_by)
  values (p_store, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), auth.uid())
  on conflict (store) do nothing;
  select token into v from public.calendar_tokens where store = p_store;
  return v;
end $$;

-- 重新產生：舊連結立即失效
create or replace function public.calendar_token_reset(p_store text) returns text
language plpgsql security definer set search_path = public as $$
declare v text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.can_see_store(p_store) then raise exception 'forbidden'; end if;
  insert into public.calendar_tokens(store, token, created_by) values (p_store, v, auth.uid())
  on conflict (store) do update set token = excluded.token, created_by = auth.uid(), created_at = now();
  return v;
end $$;

revoke execute on function public.calendar_token_get(text), public.calendar_token_reset(text) from public, anon;
grant execute on function public.calendar_token_get(text), public.calendar_token_reset(text) to authenticated;
