-- 關閉師傅名單與店別的未登入公開讀取（登入且已開通者仍可讀，見 web_read_therapists / web_read_stores）
-- 若有其他工具依賴公開讀取而失效，可還原：
--   create policy "Allow public read access for therapists" on public.therapists for select to public using (true);
--   create policy "Allow public read access for stores" on public.stores for select to public using (true);
--   grant select on public.therapists, public.stores to anon;
drop policy "Allow public read access for therapists" on public.therapists;
drop policy "Allow public read access for stores" on public.stores;
revoke select on public.therapists, public.stores from anon;
