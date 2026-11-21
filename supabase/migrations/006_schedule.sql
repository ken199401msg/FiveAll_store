-- 排班表與行事曆（網頁可寫入的例外之一，只能透過函式；編輯權限＝可查看該店的已開通帳號）

-- 每家店一筆設定：師傅名單、兼職、固定週休、早班師傅、平日/假日上班人數
create table public.schedule_settings (
  store text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
-- 排班紀錄：leave＝休假、work＝上班（兼職或原本週休但上班）
create table public.schedule_entries (
  store text not null,
  work_date date not null,
  alias text not null,
  kind text not null check (kind in ('leave','work')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (store, work_date, alias)
);
create index on public.schedule_entries (store, work_date);

alter table public.schedule_settings enable row level security;
alter table public.schedule_entries enable row level security;
create policy web_read_schedule_settings on public.schedule_settings for select to authenticated
  using (public.can_see_store(store));
create policy web_read_schedule_entries on public.schedule_entries for select to authenticated
  using (public.can_see_store(store));
create trigger audit_schedule_settings after insert or update or delete on public.schedule_settings
  for each row execute function public.audit_row_change();
create trigger audit_schedule_entries after insert or update or delete on public.schedule_entries
  for each row execute function public.audit_row_change();

create or replace function public.schedule_save_settings(p_store text, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_store(p_store) then raise exception 'forbidden'; end if;
  if length(p_settings::text) > 20000 then raise exception 'too large'; end if;
  insert into public.schedule_settings(store, settings, updated_by) values (p_store, p_settings, auth.uid())
  on conflict (store) do update set settings = excluded.settings, updated_by = auth.uid(), updated_at = now();
end $$;

-- 批次寫入：[{"d":"2026-12-04","a":"奇","k":"leave"|"work"|null}]，k 為空代表清除該格
create or replace function public.schedule_apply(p_store text, p_entries jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  if not public.can_see_store(p_store) then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 500 then raise exception 'invalid'; end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    if nullif(e->>'k','') is null then
      delete from public.schedule_entries where store = p_store and work_date = (e->>'d')::date and alias = e->>'a';
    else
      insert into public.schedule_entries(store, work_date, alias, kind, updated_by)
      values (p_store, (e->>'d')::date, e->>'a', e->>'k', auth.uid())
      on conflict (store, work_date, alias) do update set kind = excluded.kind, updated_by = auth.uid(), updated_at = now();
    end if;
  end loop;
end $$;

create or replace function public.schedule_clear_month(p_store text, p_ym text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_store(p_store) then raise exception 'forbidden'; end if;
  delete from public.schedule_entries where store = p_store and to_char(work_date, 'YYYY-MM') = p_ym;
end $$;

revoke all on public.schedule_settings, public.schedule_entries from anon;
revoke insert, update, delete, truncate on public.schedule_settings, public.schedule_entries from authenticated;
revoke execute on function public.schedule_save_settings(text,jsonb), public.schedule_apply(text,jsonb), public.schedule_clear_month(text,text) from public, anon;
grant execute on function public.schedule_save_settings(text,jsonb), public.schedule_apply(text,jsonb), public.schedule_clear_month(text,text) to authenticated;
