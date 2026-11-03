// ==UserScript==
// @name         MWI 交易決策顧問 [遠端即時熱重載 Loader]
// @namespace    https://milkywayidle.com/
// @version      1.3.3
// @description  遠端開發專用 Loader：在本地瀏覽器安裝一次，每次在遊戲按 F5 即可即時同步 GitHub 最新代碼！
// @author       Antigravity
// @homepage     https://github.com/jiamingla/mwi-market-advisor
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";
    // 加上 timestamp query 參數破除 GitHub CDN 緩存，確保每次 F5 都抓取遠端最新代碼
    const scriptUrl = "https://raw.githubusercontent.com/jiamingla/mwi-market-advisor/master/mwi_market_advisor.user.js?t=" + Date.now();

    GM_xmlhttpRequest({
        method: "GET",
        url: scriptUrl,
        onload: function (resp) {
            if (resp.status === 200 && resp.responseText) {
                const script = document.createElement("script");
                script.textContent = resp.responseText;
                (document.head || document.documentElement).appendChild(script);
                console.log("[MWI-Advisor-Loader] 已成功自 GitHub 載入最新版交易顧問！");
            } else {
                console.error("[MWI-Advisor-Loader] 載入遠端腳本失敗，狀態碼:", resp.status);
            }
        },
        onerror: function (err) {
            console.error("[MWI-Advisor-Loader] 網路連線錯誤:", err);
        }
    });
})();
