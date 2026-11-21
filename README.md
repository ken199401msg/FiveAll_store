# 五眾店務管理

店務管理網頁（日帳明細、月結表、分析、排班表、行事曆）。前端為純靜態網頁，資料庫使用 Supabase。

- `index.html`、`css/`、`js/`：網頁本體（GitHub Pages 直接發布）
- `js/config.js`：Supabase 網址與 publishable key（遷移到 NAS 時只改這裡）
- `supabase/migrations/`：資料庫腳本（依編號順序套用）

## 權限
超級管理員、店長（限授權店別）、帳務人員。新註冊帳號為「待開通」，由超級管理員設定。
營運資料網頁端唯讀；排班表、行事曆、日帳記事為例外可寫入。
