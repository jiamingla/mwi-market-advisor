# MWI 交易決策顧問 (Market Trade Advisor)

專為《銀河奶牛放置》(Milky Way Idle) 設計的智能市場掛單時間預估與交易決策顧問油猴腳本 (Userscript)。

## 🌟 核心特色

1. **2026 最新官方市場規則對齊**：
   - 實裝最新 **4% 交易稅率**（`TAX_RATE = 0.04`，僅賣方承擔）。
   - 支援 **牛鈴專屬 18% 交易稅**（`COWBELL_TAX_RATE = 0.18`）與寶箱/金幣 **0% 免稅**。
   - 內建官方 **BinGap 離散檔位算法**，精準計算最小合法跳檔，裝備強化自動套用 **x5 檔位乘數**。
   - 支援官方 **可交易區間（Trade Band）** 限制與吸附。
2. **深度排隊與耗時預估**：
   - 結合即時盤口深度、1 小時即時流速與 85 天歷史週期數據（Azhu 歷史數據集）。
   - 自動識別「週期性集中大單採購」商品（如各階咖啡、耗材等）。
3. **即時結帳 vs 掛單時薪決策**：
   - 即時計算「比吃單多賺 / 比吃單省下」之淨金額。
   - 折算「等待時薪 (G/hr)」，引導玩家快速判斷該直接結帳還是排隊掛單。
4. **一鍵填入與 React 18 原生連動**：
   - 提供「⚡ 填入吃單價」與「🎯 填入首檔搶先價」快捷按鈕。
   - 透過 React 18 Fiber 實例穿透注入與 DOM 擬真連動，確保輸入框與按鈕精準響應。

---

## 🚀 瀏覽器安裝與「零複製貼上」即時熱重載指南

為了讓未來的每次更新、代碼修改或 Bug 修復都能**直接在您的瀏覽器生效，無需每次手動複製貼上代碼**，推薦使用 **本地即時熱重載 (Dev Loader)** 機制：

### 步驟 1：開啟擴充功能檔案存取權限
1. 打開瀏覽器網址列，輸入：`chrome://extensions/`（或 Edge 的 `edge://extensions/`）。
2. 找到 **Tampermonkey**（或 Violentmonkey / ScriptCat），點擊 **「詳細資訊」 (Details)**。
3. 向下捲動，開啟 **「允許存取檔案網址」 (Allow access to file URLs)**。

### 步驟 2：在 Tampermonkey 安裝極簡 Loader（僅需操作這一次）
在 Tampermonkey 新增一個腳本，將以下 15 行的 `mwi_market_advisor.dev.user.js` 貼入並儲存：

```javascript
// ==UserScript==
// @name         MWI 交易決策顧問 [本地即時熱重載 Loader]
// @namespace    https://milkywayidle.com/
// @version      1.3.0
// @description  本載入器僅需安裝一次，日後所有代碼修改與更新只需按 F5 即可直接在瀏覽器即時生效！
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @require      file:///C:/Users/user1/orca/workspaces/mwi-market-advisor/mwi_market_advisor.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
```

### 步驟 3：享受即時同步！
- 未來無論是修正計算公式、優化界面或增加新功能，AI 在本機倉庫修改並 Commit 後：
- **您只需在遊戲頁面按下 `F5`（重新整理）**，瀏覽器便會直接載入本機最新的腳本，**完全不需要重新複製貼上**！

---

## 📦 版本控制紀錄 (Changelog)

* **`v1.3.0` (2026-11-04)**:
  - 對齊 2026-09-28 官方交易稅改動（基準稅率降至 4%，牛鈴 18%，寶箱/金幣 0%）。
  - 實裝官方 `binGap` 價格階梯增量算法與強化裝備 x5 乘數。
  - 修復彈窗價格在未編輯狀態下為 `<div>` 導致出價被誤判為 1G / 第 21 檔的 Bug。
  - 修復一鍵填入按鈕無法觸發 React 狀態更新問題（整合 Fiber 呼叫與 DOM 擬真連動）。
  - 新增可交易區間（Trade Band）自動吸附機制。
* **`v1.2.0` (2026-11-03)**:
  - 修復輸入框選擇器與 React 18 原生 Setter 注入。
  - 新增跨盤口即時吃單檢測（Taker 耗時 0 秒）。
* **`v1.1.0` (2026-11-02)**:
  - 串接 Azhu 85 天歷史數據庫，新增大單集中採購週期檢測。
* **`v1.0.0` (2026-10-31)**:
  - 初始版本：基礎盤口深度解析、耗時預估與等待時薪試算。
