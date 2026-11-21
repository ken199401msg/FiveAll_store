-- 帳務人員預設唯讀，需超級管理員授權（can_edit）才能新增／修改
alter table public.profiles add column if not exists can_edit boolean not null default false;

create or replace function public.app_can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_active and (p.role in ('admin','manager') or (p.role = 'accountant' and p.can_edit))
                   from public.profiles p where p.id = auth.uid()), false)
$$;
revoke execute on function public.app_can_edit() from public, anon;
grant execute on function public.app_can_edit() to authenticated;

-- 在所有寫入 RPC 開頭加上授權檢查
do $$
declare f text; def text;
begin
  foreach f in array array['note_add','note_delete','set_therapist_order','reset_therapist_order',
    'schedule_save_settings','schedule_apply','schedule_clear_month','calendar_token_get','calendar_token_reset'] loop
    select pg_get_functiondef(p.oid) into def from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=f;
    if def !~* 'app_can_edit' then
      execute regexp_replace(def, '\mbegin\M', E'begin\n  if not public.app_can_edit() then raise exception ''forbidden''; end if;', 'i');
    end if;
  end loop;
  select pg_get_functiondef(p.oid) into def from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='set_therapist_rate';
  if def !~* 'is distinct from ''admin''' then
    execute regexp_replace(def, '\mbegin\M', E'begin\n  if public.app_role() is distinct from ''admin'' then raise exception ''forbidden''; end if;', 'i');
  end if;
end $$;

-- 抽成比例只有超級管理員可讀
drop policy if exists therapist_rates_select on public.therapist_rates;
do $$ declare pol text; begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='therapist_rates' and cmd='SELECT' loop
    execute format('drop policy %I on public.therapist_rates', pol);
  end loop;
end $$;
create policy therapist_rates_select on public.therapist_rates for select to authenticated using (public.app_role() = 'admin');

-- 帳號管理：列出與設定 can_edit
drop function if exists public.admin_list_users();
create function public.admin_list_users() returns table (
  id uuid, email text, display_name text, role text, is_active boolean,
  created_at timestamptz, last_sign_in_at timestamptz, stores text[], can_edit boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'admin' then raise exception 'forbidden'; end if;
  return query
    select p.id, u.email::text, p.display_name, p.role, p.is_active, p.created_at, u.last_sign_in_at,
           coalesce((select array_agg(s.store_name order by s.store_name) from public.user_stores s where s.user_id = p.id), '{}'),
           p.can_edit
    from public.profiles p join auth.users u on u.id = p.id
    order by p.created_at;
end $$;

create or replace function public.admin_set_can_edit(p_user uuid, p_can boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'admin' then raise exception 'forbidden'; end if;
  update public.profiles set can_edit = p_can where id = p_user;
end $$;
revoke execute on function public.admin_list_users(), public.admin_set_can_edit(uuid,boolean) from public, anon;
grant execute on function public.admin_list_users(), public.admin_set_can_edit(uuid,boolean) to authenticated;
