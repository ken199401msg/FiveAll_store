-- 帳務人員也只能看被授權的店（原本帳務可看全部店）
create or replace function public.can_see_store(s text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case public.app_role()
    when 'admin' then true
    when 'accountant' then s = any(public.app_stores())
    when 'manager' then s = any(public.app_stores())
    else false end
$$;
