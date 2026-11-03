# MWI 交易決策顧問 (Market Trade Advisor)

專為《銀河奶牛放置》(Milky Way Idle) 設計的智能市場掛單時間預估與交易決策顧問油猴腳本 (Userscript)。

* 📦 **GitHub 專案倉庫**：[https://github.com/jiamingla/mwi-market-advisor](https://github.com/jiamingla/mwi-market-advisor)
* 🚀 **正式版直接安裝連結**：[mwi_market_advisor.user.js (Raw)](https://raw.githubusercontent.com/jiamingla/mwi-market-advisor/master/mwi_market_advisor.user.js)

---

## 🌟 核心特色 (v1.3.1)

1. **強化裝備 (+5 / +7) 真實低流通度模型**：
   - 修正了舊版未分級強化歷史、誤用通用兜底流速導致裝備全部顯示「< 2 分鐘」的 Bug。
   - 串接各強化等級專屬數據片（`items_${cleanId}__${enhancementLevel}.json`），精確還原 +5（日均 ~1.2 件）、+7（日均 ~0.5 件）甚至更高階裝備的真實排隊耗時（半天至數天）。
   - 盤口深度標籤如實反映真實排隊週期（例如 `~16 小時`、`~2 天`），不再給出虛假樂觀預估。
2. **2026 最新官方市場規則對齊**：
   - 實裝最新 **4% 交易稅率**（`TAX_RATE = 0.04`，僅賣方承擔）。
   - 支援 **牛鈴專屬 18% 交易稅**（`COWBELL_TAX_RATE = 0.18`）與寶箱/金幣 **0% 免稅**。
   - 內建官方 **BinGap 離散檔位算法**，精準計算最小合法跳檔，裝備強化自動套用 **x5 檔位乘數**。
   - 支援官方 **可交易區間（Trade Band）** 限制與吸附。
3. **即時結帳 vs 掛單時薪決策**：
   - 即時計算「比吃單多賺 / 比吃單省下」之淨金額。
   - 折算「等待時薪 (G/hr)」，引導玩家快速判斷該直接結帳還是排隊掛單。
4. **一鍵填入與 React 18 原生連動**：
   - 提供「⚡ 填入吃單價」與「🎯 填入首檔搶先價」快捷按鈕。
   - 透過 React 18 Fiber 實例穿透注入與 DOM 擬真連動，確保輸入框與按鈕精準響應。

---

## 🚀 遠端開發安裝指南（二選一）

因您處於遠端開發環境（代碼在遠端機器，遊戲在您自己的本地瀏覽器）：

### 方案 A：遠端即時熱重載 Loader（🔥 強烈推薦，修改即刻生效）
在本地瀏覽器的 Tampermonkey 新增一個腳本，貼入以下 25 行代碼：

```javascript
// ==UserScript==
// @name         MWI 交易決策顧問 [遠端即時熱重載 Loader]
// @namespace    https://milkywayidle.com/
// @version      1.3.1
// @description  遠端開發專用 Loader：在本地瀏覽器安裝一次，每次在遊戲按 F5 即可即時同步 GitHub 最新代碼！
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";
    const scriptUrl = "https://raw.githubusercontent.com/jiamingla/mwi-market-advisor/master/mwi_market_advisor.user.js?t=" + Date.now();
    GM_xmlhttpRequest({
        method: "GET",
        url: scriptUrl,
        onload: function (resp) {
            if (resp.status === 200 && resp.responseText) {
                const script = document.createElement("script");
                script.textContent = resp.responseText;
                (document.head || document.documentElement).appendChild(script);
                console.log("[MWI-Advisor-Loader] 成功自 GitHub 載入最新版交易顧問！");
            }
        }
    });
})();
```
* **效果**：每次遠端推送到 GitHub 後，您只要在本地瀏覽器的遊戲分頁 **按一下 `F5`（重新整理）**，就會自動繞過 CDN 緩存抓取最新版代碼執行，完全不用手動更新！

---

### 方案 B：正式版直接安裝（Tampermonkey 自動更新）
點擊以下連結直接在 Tampermonkey 安裝：
👉 **[點此安裝 MWI 交易決策顧問 正式版](https://raw.githubusercontent.com/jiamingla/mwi-market-advisor/master/mwi_market_advisor.user.js)**

* 腳本內建 `@updateURL` 與 `@downloadURL`，Tampermonkey 會自動定期檢查 GitHub 版本更新，或隨時在 Tampermonkey 圖示點擊「檢查更新」即可。

---

## 📦 版本控制紀錄 (Changelog)

* **`v1.3.1` (2026-11-04)**:
  - 修正 +5 / +7 裝備流通速度過度樂觀（原誤判為 < 2 分鐘）的重大 Bug。
  - 支援按強化等級分層請求歷史數據（`items_${cleanId}__${lvl}.json`）。
  - 重構低流通度流速模型，允許小時流速 < 1，真實呈現裝備掛單需半天至數天的週期。
  - 上線 GitHub 倉庫託管，提供遠端即時熱重載 Loader 與自動更新機制。
* **`v1.3.0` (2026-11-04)**:
  - 對齊 2026-09-28 官方交易稅改動（基準稅率降至 4%，牛鈴 18%，寶箱/金幣 0%）。
  - 實裝官方 `binGap` 價格階梯增量算法與強化裝備 x5 乘數。
  - 修復彈窗價格在未編輯狀態下為 `<div>` 導致出價被誤判為 1G / 第 21 檔的 Bug。
  - 修復一鍵填入按鈕無法觸發 React 狀態更新問題。
* **`v1.2.0` (2026-11-03)**:
  - 修復輸入框選擇器與 React 18 原生 Setter 注入。
  - 新增跨盤口即時吃單檢測（Taker 耗時 0 秒）。
* **`v1.1.0` (2026-11-02)**:
  - 串接 Azhu 85 天歷史數據庫，新增大單集中採購週期檢測。
* **`v1.0.0` (2026-10-31)**:
  - 初始版本：基礎盤口深度解析、耗時預估與等待時薪試算。
