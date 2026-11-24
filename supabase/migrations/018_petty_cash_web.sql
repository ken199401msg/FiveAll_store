-- 零用金：網頁可瀏覽（含收據照片）、新增；只有店長（與超級管理員）可修改、刪除
create policy petty_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'petty-cash' and exists (
    select 1 from public.petty_cash_photos p join public.petty_cash_receipts r on r.batch_id = p.batch_id
    where p.photo_path = storage.objects.name and public.can_see_store(r.store)));
-- petty_add(p_store,p_date,p_item,p_amount,p_note)：admin/manager/accountant（限可看的店）可新增，batch_id 為 'web-<uuid>'
-- petty_update(p_id,p_date,p_item,p_amount,p_note)、petty_delete(p_id)：僅 admin/manager（限可看的店）
-- 函式全文見資料庫（皆 security definer，並寫入 log_action）。
