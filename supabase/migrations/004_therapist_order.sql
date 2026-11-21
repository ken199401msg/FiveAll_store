-- 師傅排序：依店別＋月份儲存（網頁可寫入的例外之一，只能透過下列函式）
create table public.therapist_order (
  store text not null,
  ym text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  aliases text[] not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (store, ym)
);
alter table public.therapist_order enable row level security;
create policy web_read_therapist_order on public.therapist_order for select to authenticated
  using (public.can_see_store(store));
create trigger audit_therapist_order after insert or update or delete on public.therapist_order
  for each row execute function public.audit_row_change();

create or replace function public.set_therapist_order(p_store text, p_ym text, p_order text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text := public.app_role();
begin
  if v_role is null or v_role = 'pending' then raise exception 'forbidden'; end if;
  if v_role = 'manager' and not (p_store = any(public.app_stores())) then raise exception 'forbidden'; end if;
  insert into public.therapist_order(store, ym, aliases, updated_by)
  values (p_store, p_ym, p_order, auth.uid())
  on conflict (store, ym) do update set aliases = excluded.aliases, updated_by = auth.uid(), updated_at = now();
end $$;

create or replace function public.reset_therapist_order(p_store text, p_ym text) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text := public.app_role();
begin
  if v_role is null or v_role = 'pending' then raise exception 'forbidden'; end if;
  if v_role = 'manager' and not (p_store = any(public.app_stores())) then raise exception 'forbidden'; end if;
  delete from public.therapist_order where store = p_store and ym = p_ym;
end $$;

revoke all on public.therapist_order from anon;
revoke insert, update, delete, truncate on public.therapist_order from authenticated;
revoke execute on function public.set_therapist_order(text,text,text[]), public.reset_therapist_order(text,text) from public, anon;
grant execute on function public.set_therapist_order(text,text,text[]), public.reset_therapist_order(text,text) to authenticated;
