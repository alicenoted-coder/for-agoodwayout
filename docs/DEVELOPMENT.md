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
| `members` | LINE 內部 ID、LINE 顯示名稱、社群暱稱、是否為管理員 | 只開放 `id`、`nickname` 兩欄（欄位權限＋RLS）；其他欄只有後端讀得到 |
| `activities` | 類別、名稱、日期、地點、費用、名額、開班門檻 | 開放中的活動公開 |
| `signups` | 哪個社員、哪場活動、接龍時間、取消時間 | 只讀得到有效接龍；公開名單用 `public_signups` 只露出暱稱 |

- `join_activity()`：鎖住活動那一列再檢查名額，避免兩人同時搶到最後一位。只有後端能呼叫。
- 2026-11-15 已在本機 PostgreSQL 16 模擬 Supabase 預設權限測過：重複接龍、額滿、取消後遞補、訪客讀不到 LINE ID、訪客無法直接寫入，皆正確。
- 已套用到 Supabase 專案；Supabase 安全檢查（Security Advisor）無警告。

## 服務與公開設定值

| 服務 | 值 |
|---|---|
| Supabase 專案 | `agoodwayout`，URL `https://qceomzxgeqromtbdxinf.supabase.co`（組織 `alicenoted-job`，東京） |
| GitHub Pages | 從 `claude/dazzling-bell-q1quxi` 分支根目錄發布：`https://alicenoted-coder.github.io/for-agoodwayout/` |
| LINE Login channel（測試） | Provider `出走社測試`，Channel ID `2012620335`（開發中狀態，只有管理員／測試者能登入） |
| LIFF app（測試） | LIFF ID `2012620335-Hk2HkkYY`，網址 `https://liff.line.me/2012620335-Hk2HkkYY`，Endpoint `https://alicenoted-coder.github.io/for-agoodwayout/app/` |
| Edge Function | `api`（`verify_jwt` 關閉，改由函式自己向 LINE 驗證 ID token） |
| 官方帳號（測試） | `出走社測試`，Messaging API 屬於 Provider `出走社測試`；金鑰存在 Supabase Edge Function Secrets 的 `LINE_MESSAGING_TOKEN`（不在 repo） |

> 正式上線時：在**出走社官方帳號所屬的 Provider** 底下另建 LINE Login channel＋LIFF，替換 `app/index.html` 的 `CONFIG.liffId` 與 Edge Function 的 `LINE_CHANNEL_ID`，並清除測試資料。

## 目錄

| 路徑 | 內容 |
|---|---|
| `app/index.html` | **正式網頁**：LINE 登入（LIFF）＋讀寫 Supabase。版面沿用 `prototype/stage1_v2.html` |
| `supabase/functions/api/` | 後端 API：驗證 LINE 身分後處理暱稱、接龍、管理員操作 |
| `prototype/` | 介面原型（純前端、資料存瀏覽器）。`stage1_v2.html` 是目前定稿的版面（左側日曆） |
| `supabase/migrations/` | 資料表定義 |
| `docs/` | 本文件 |

## 進度

- [x] 介面原型（完整版、第一階段、第一階段＋日曆）
- [x] 資料表設計與本機測試
- [x] 建立 Supabase 專案 `agoodwayout`（東京，ref `qceomzxgeqromtbdxinf`）並套用資料表
- [x] 建立 LINE Login channel＋LIFF app（測試用 Provider）
- [x] Edge Function：驗證 LINE 身分、設定暱稱、接龍、管理員（新增／編輯／刪除活動、看名單、移除接龍）
- [x] 把原型接上資料庫與 LINE 登入（`app/`，以模擬的 LINE／Supabase 回應跑過完整流程）
- [x] 管理員後台接上資料庫
- [x] 開啟 GitHub Pages
- [x] 實機測試：LINE 登入、設定暱稱（2026-11-15，管理員本人）
- [x] 管理員帳號設為 `is_admin`（暱稱「設計師愛麗絲」）
- [ ] 實機測試：接龍、管理員後台
- [x] 成團時用官方帳號通知管理員（管理員需先加官方帳號好友）
- [x] 實機測試：成團通知（2026-11-15，管理員收到官方帳號訊息）
- [ ] 每日匯出到 Google 試算表

## API 一覽（`POST /functions/v1/api`，body 帶 `action` 與 `idToken`）

| action | 誰能用 | 說明 |
|---|---|---|
| `me` | 登入者 | 回傳暱稱、是否管理員、自己接龍的活動 |
| `set_nickname` | 登入者 | 第一次建立社員資料或修改暱稱；重複回 `409 nickname_taken` |
| `join` | 有暱稱者 | 呼叫 `join_activity()`，回 `ok` / `reached`（這位剛好讓活動成團）/ `full` / `already_joined` / `not_found`；`reached` 時用官方帳號通知所有管理員 |
| `admin_save_activity` / `admin_delete_activity` | 管理員 | 新增、編輯、刪除活動 |
| `admin_roster` / `admin_remove_signup` | 管理員 | 看名單（含 LINE 名稱）、移除接龍 |

## 需要管理員本人處理的事

- 各服務的帳號登入、核准、付款
- 保管密碼與金鑰（Channel secret、service role key 不要貼到對話裡）
- LINE Developers 裡把測試者加入 channel（開發中狀態只有測試者能登入）
