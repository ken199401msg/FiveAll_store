-- 自助註冊 + 超級管理員開通權限

-- 1. 新增「待開通」角色
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending','manager','accountant','admin'));

-- 2. 註冊時自動建立 profile（超級管理員 Email 自動成為 admin，其餘為待開通）
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name, role)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
          case when lower(new.email) = 'ken199401@gmail.com' then 'admin' else 'pending' end);
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. 待開通帳號不可讀任何資料
drop policy web_read_therapists on public.therapists;
create policy web_read_therapists on public.therapists for select to authenticated
  using (public.app_role() in ('admin','manager','accountant'));
drop policy web_read_stores on public.stores;
create policy web_read_stores on public.stores for select to authenticated
  using (public.app_role() in ('admin','manager','accountant'));

create or replace function public.log_action(
  p_action text, p_table text default null, p_record text default null,
  p_store text default null, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is null then return; end if;
  insert into public.audit_logs(user_id, email, source, action, table_name, record_id, store, detail)
  values (auth.uid(), auth.jwt()->>'email', 'web', p_action, p_table, p_record, p_store, p_detail);
end $$;

-- 4. 紀錄來源判斷：有登入身分=web；帳號相關表無身分=system；其餘=line
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs(user_id, email, source, action, table_name, record_id, store, old_data, new_data)
  values (auth.uid(), auth.jwt()->>'email',
          case when auth.uid() is not null then 'web'
               when tg_table_name in ('profiles','user_stores') then 'system'
               else 'line' end,
          tg_op, tg_table_name, r->>'id', r->>'store',
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return null;
end $$;

-- 5. 超級管理員專用功能（網頁端不能直接寫資料表，只能呼叫這些）
create or replace function public.admin_list_users() returns table (
  id uuid, email text, display_name text, role text, is_active boolean,
  created_at timestamptz, last_sign_in_at timestamptz, stores text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'admin' then raise exception 'forbidden'; end if;
  return query
    select p.id, u.email::text, p.display_name, p.role, p.is_active, p.created_at, u.last_sign_in_at,
           coalesce((select array_agg(s.store_name order by s.store_name)
                     from public.user_stores s where s.user_id = p.id), '{}')
    from public.profiles p join auth.users u on u.id = p.id
    order by p.created_at;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'admin' then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot change own role'; end if;
  if p_role not in ('pending','manager','accountant','admin') then raise exception 'invalid role'; end if;
  update public.profiles set role = p_role where id = p_user;
end $$;

create or replace function public.admin_set_stores(p_user uuid, p_stores text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'admin' then raise exception 'forbidden'; end if;
  delete from public.user_stores where user_id = p_user;
  insert into public.user_stores(user_id, store_name)
    select p_user, s from (select distinct trim(x) s from unnest(p_stores) x) q where s <> '';
end $$;

create or replace function public.admin_set_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'admin' then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot change own status'; end if;
  update public.profiles set is_active = p_active where id = p_user;
end $$;

revoke execute on function public.admin_list_users(), public.admin_set_role(uuid,text),
  public.admin_set_stores(uuid,text[]), public.admin_set_active(uuid,boolean) from public, anon;
grant execute on function public.admin_list_users(), public.admin_set_role(uuid,text),
  public.admin_set_stores(uuid,text[]), public.admin_set_active(uuid,boolean) to authenticated;
