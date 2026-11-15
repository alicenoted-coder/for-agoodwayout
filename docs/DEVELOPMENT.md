# 出走社活動接龍網站：開發紀錄

給之後接手的人（新的 Claude 對話或工程師）：先讀這份，再動手。

## 目標（第一階段）

先讓社員**看到人潮**：用 LINE 登入後接龍，公開名單只顯示暱稱，資料存在資料庫。
需求來源：`女子出走社` Obsidian 資料夾裡的〈需求重點〉與〈功能結構表〉。

## 已決定的事

| 項目 | 決定 | 原因 |
|---|---|---|
| 身分 | LINE 登入（LIFF）＋社員自填社群暱稱 | 只填暱稱無法辨識本人；LINE 社群沒有對外 API，暱稱只能自填 |
| 資料庫 | Supabase（免費方案，東京區） | 名額搶位不出錯、權限控管完整、即時更新 |
| 統計 | 之後每天匯出到 Google 試算表 | 管理員習慣用試算表；兼作備份 |
| 測試主機 | GitHub Pages | repo 為公開，免費、有 HTTPS |
| 正式主機 | 上線前再決定（Cloudflare Pages 候選） | GitHub Pages / Vercel 免費版都不適合商業用途 |
| 工程 | 第一階段由 Claude 擔任，沒有真人工程師 | — |

## 架構

```
社員手機（LINE 內開啟）
  └─ 網頁（GitHub Pages，靜態檔）
       ├─ 讀：活動、公開名單 ──────────→ Supabase（anon key，只讀得到公開資料）
       └─ 寫：設定暱稱、接龍、取消 ───→ Supabase Edge Function
                                         ├─ 用 LINE 驗證 ID token（確認是本人）
                                         └─ 用 service role 寫入資料庫
```

- **不需要 LINE Channel secret**：驗證 ID token 只要 Channel ID。
- 網頁上會出現的 LIFF ID、Supabase URL、anon key 都是**公開值**，可以放在程式碼裡。
- service role key 只存在 Supabase Edge Function 的環境設定，**絕對不放進 repo**。

## 資料表（`supabase/migrations/`）

| 表 | 內容 | 公開？ |
|---|---|---|
| `members` | LINE 內部 ID、LINE 顯示名稱、社群暱稱、是否為管理員 | 否（只有後端讀得到） |
| `activities` | 類別、名稱、日期、地點、費用、名額、開班門檻 | 開放中的活動公開 |
| `signups` | 哪個社員、哪場活動、接龍時間、取消時間 | 否；公開名單透過 `public_signups` 只露出暱稱 |

- `join_activity()`：鎖住活動那一列再檢查名額，避免兩人同時搶到最後一位。只有後端能呼叫。
- 2026-11-15 已在本機 PostgreSQL 16 模擬 Supabase 預設權限測過：重複接龍、額滿、訪客讀不到 LINE ID、訪客無法直接寫入，皆正確。

## 目錄

| 路徑 | 內容 |
|---|---|
| `prototype/` | 介面原型（純前端、資料存瀏覽器）。`stage1_v2.html` 是目前定稿的版面（左側日曆） |
| `supabase/migrations/` | 資料表定義 |
| `docs/` | 本文件 |

## 進度

- [x] 介面原型（完整版、第一階段、第一階段＋日曆）
- [x] 資料表設計與本機測試
- [ ] 建立 Supabase 專案 `agoodwayout`（東京）並套用資料表
- [ ] 開啟 GitHub Pages
- [ ] 建立 LINE Login channel＋LIFF app（需確認官方帳號所屬的 Provider）
- [ ] Edge Function：驗證 LINE 身分、設定暱稱、接龍、取消
- [ ] 把原型接上資料庫與 LINE 登入
- [ ] 管理員後台接上資料庫
- [ ] 每日匯出到 Google 試算表

## 需要管理員本人處理的事

- 各服務的帳號登入、核准、付款
- 保管密碼與金鑰（Channel secret、service role key 不要貼到對話裡）
- LINE Developers 裡把測試者加入 channel（開發中狀態只有測試者能登入）
