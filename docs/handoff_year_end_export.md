# 交接說明：年終獎金「背景核對」資料來源（五眾店務管理 → 另一專案）

另一個專案可以用唯讀方式，向「五眾店務管理」的 Supabase 取回每人每月業績與達標獎金，拿來核對本機資料庫是否正確。**只讀，不能寫入。**

## 1. 呼叫方式
- 網址：`https://brhofjjxglddqburukml.supabase.co/rest/v1/rpc/year_end_export`
- 方法：POST，JSON 內容
- 標頭：`apikey: <公開的 publishable key>`、`Content-Type: application/json`
- 內容：`{"p_year": 2026, "p_token": "<私鑰，另外提供，不要寫進程式碼或文件>"}`
- 私鑰錯誤或沒給 → 回 HTTP 401/403 錯誤（unauthorized）。
- 私鑰外流時：到資料庫重新產生（舊的立即失效），見第 5 節。

## 2. 回傳欄位（一人一月一列，只回傳有上班業績的月份）
| 欄位 | 型別 | 說明 |
|---|---|---|
| year | int | 西元年 |
| month | int | 1～12 |
| name | text | 帳務名（簡稱），等同 `daily_report_items.name`，已去頭尾空白 |
| sales | int | 當月業績（元）。兩間店合併加總 |
| bonus | int | 當月達標獎金（元），可為 0 |
| work_days | int | 當月出勤天數（有上班業績的日期數，兩間店合併不重複計算） |

## 3. 計算規則（以五眾店務管理為準）
- 只算 `status = 'work'` 的業績；**排除測試店「五測」**；兩間店（五健、五順）合併。
- 金額四捨五入成整數；名字去頭尾空白。
- 達標獎金：`sales < 90,000 → 0`；否則 `500 + floor((sales − 90,000) ÷ 10,000) × 500`，無上限。
  - 例：89,999→0、90,000→500、99,999→500、100,000→1,000、143,500→3,000。
- 整年資料完整回傳，不受網頁的「資料起始日」影響。
- 年度獎金不另外提供：自行把 12 個月的 `bonus` 相加。

## 4. 建議的核對方式
1. 每次取回整年資料，和本機資料庫以 `(year, month, name)` 對照。
2. 比較 `sales` 與 `bonus`；任一不同就標示為不符；一邊有、一邊沒有也要標示。
3. 門檻或級距若改變（目前 90,000／10,000／500），兩邊要一起改。

## 5. 管理（只有資料庫管理員）
- 私鑰以雜湊存放在 `external_read_tokens`（名稱 `year_end_export`），網頁與匿名帳號都讀不到。
- 重新產生私鑰：在 SQL Editor 執行
  `with t as (select replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','') tok) update external_read_tokens set token_hash = (select encode(sha256(convert_to(tok,'utf8')),'hex') from t), created_at = now() where name='year_end_export' returning (select tok from t);`
  （回傳的就是新私鑰，只顯示一次。）
