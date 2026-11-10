// ==UserScript==
// @name         MWI 交易決策顧問 (Market Trade Advisor)
// @namespace    https://milkywayidle.com/
// @version      1.3.10
// @description  銀河奶牛放置 (Milky Way Idle) 市場掛單時間預估與智能交易顧問。精簡高密度看板設計，一鍵收合，百萬級大數轉換為 M/B 單位且百萬以內嚴格保留真實整數防止 2.2K 混淆，全場景自動化 E2E 瀏覽器測試驗證。
// @author       Antigravity
// @homepage     https://github.com/jiamingla/mwi-market-advisor
// @updateURL    https://raw.githubusercontent.com/jiamingla/mwi-market-advisor/master/mwi_market_advisor.user.js
// @downloadURL  https://raw.githubusercontent.com/jiamingla/mwi-market-advisor/master/mwi_market_advisor.user.js
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    console.log("[MWI-Advisor] 交易決策顧問 v1.3.10 (百萬級 M 單位與百萬以內真實整數修正版) 啟動中...");

    // ── 1. 遊戲核心規則配置 (對齊 2026-09-28 最新改版) ─────
    const CONFIG = {
        MARKET_API_URL: window.location.origin.includes("milkywayidlecn.com")
            ? "https://www.milkywayidlecn.com/game_data/marketplace.json"
            : "https://www.milkywayidle.com/game_data/marketplace.json",
        HISTORY_BASE_URL: "https://raw.githubusercontent.com/azhu949/mwi-market-history/master/data/items/",
        CACHE_KEY: "mwi_market_advisor_cache_v1",
        CACHE_TTL_MS: 3 * 60 * 1000,
        BASE_TAX_RATE: 0.04,          // 2026-09-28 官方調降：基準交易稅 4% (賣方承擔)
        COWBELL_TAX_RATE: 0.18,       // 牛鈴/牛鈴袋專屬稅率 18%
        UNDERCUT_PENALTY_RATE: 0.35,  // 非首檔掛單的流速衰減懲罰
    };

    // 官方價格檔位增量單元階梯 (BinGapUnitTiers)
    const BIN_GAP_TIERS = [
        [12, 4],
        [15, 5],
        [18, 6],
        [24, 8],
        [30, 10],
        [36, 12],
        [48, 16],
        [60, 20],
        [75, 25],
        [90, 30]
    ];

    // ── 2. 官方價格檔位 (BinGap) 算法 ─────────────────────
    function tightBinGapUnit(val) {
        for (const [tier, step] of BIN_GAP_TIERS) {
            if (val < tier) return step;
        }
        return 40;
    }

    function binGap(price, enhancementLevel = 0) {
        const s = String(price);
        const len = s.length;
        if (len <= 2) return 1;
        if (len === 3) {
            const firstDigit = s[0];
            if (enhancementLevel > 0) {
                if (firstDigit === "1") return 2;
                if (firstDigit <= "3") return 5;
                if (firstDigit <= "7") return 10;
                return 20;
            } else {
                if (firstDigit <= "3") return 1;
                if (firstDigit <= "7") return 2;
                return 4;
            }
        }
        const step = tightBinGapUnit(parseInt(s.slice(0, 2), 10)) * Math.pow(10, len - 4);
        return enhancementLevel > 0 ? 5 * step : step;
    }

    function getBinnedPrice(price, roundUp = false, enhancementLevel = 0) {
        let p = parseInt(price, 10);
        if (isNaN(p) || p <= 1) return 2;
        const gap = binGap(p, enhancementLevel);
        const rem = p % gap;
        p -= rem;
        if (roundUp && rem >= 1) {
            p += gap;
        }
        return p;
    }

    function getNextBinnedPrice(price, enhancementLevel = 0) {
        return getBinnedPrice(price + 1, true, enhancementLevel);
    }

    function getPrevBinnedPrice(price, enhancementLevel = 0) {
        return getBinnedPrice(price - 1, false, enhancementLevel);
    }

    // ── 3. 官方交易稅率計算 ────────────────────────────────
    function getItemTaxRate(itemHrid) {
        if (!itemHrid) return CONFIG.BASE_TAX_RATE;
        const clean = String(itemHrid).toLowerCase();
        if (clean.includes("bag_of_10_cowbells") || clean.includes("cowbell")) {
            return CONFIG.COWBELL_TAX_RATE;
        }
        if (clean.includes("chest") || clean.includes("coin")) {
            return 0;
        }
        return CONFIG.BASE_TAX_RATE;
    }

    function computeSellerNetPerItem(price, taxRate) {
        return Math.floor(price * (1 - taxRate));
    }

    // ── 4. 輔助與格式化工具 ───────────────────────────────
    function parseQty(text) {
        if (!text) return 0;
        const clean = String(text).trim().toUpperCase().replace(/,/g, "");
        if (clean.endsWith("K")) return Math.round(parseFloat(clean.slice(0, -1)) * 1000);
        if (clean.endsWith("M")) return Math.round(parseFloat(clean.slice(0, -1)) * 1000000);
        if (clean.endsWith("B")) return Math.round(parseFloat(clean.slice(0, -1)) * 1000000000);
        const val = parseFloat(clean);
        return isNaN(val) ? 0 : Math.round(val);
    }

    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return "0";
        if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(2) + "B";
        if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(2) + "M";
        if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(1) + "K";
        if (num > 0 && num < 10) return num.toFixed(1);
        return Math.round(num).toLocaleString();
    }

    // 格式化金幣價格為簡明單位 (>=1M 採用 M/B 縮寫，<1M 嚴格保留精確整數與千分位，禁止 K 縮寫防止 2152 與 2200 混淆)
    function formatPrice(val, withGForSmall = true) {
        if (val === null || val === undefined || isNaN(val)) return "--";
        const num = Number(val);
        const abs = Math.abs(num);
        if (abs >= 1e9) return parseFloat((num / 1e9).toFixed(2)) + "B";
        if (abs >= 1e6) return parseFloat((num / 1e6).toFixed(2)) + "M";
        return Math.round(num).toLocaleString() + (withGForSmall ? "G" : "");
    }

    function formatTime(hours) {
        if (!isFinite(hours) || hours > 24 * 365) return "> 1 年 ⚠️";
        if (hours <= 0) return "⚡ 立即成交 (0 秒)";
        if (hours <= 0.03) return "< 2 分鐘";
        if (hours < 1) return `~${Math.round(hours * 60)} 分鐘`;
        if (hours < 24) return `~${hours.toFixed(1)} 小時`;
        const days = hours / 24;
        if (days < 30) return `~${days.toFixed(1)} 天`;
        return `~${Math.round(days)} 天 ⚠️`;
    }

    // ── 5. 全局狀態管理 ────────────────────────────────────
    const STATE = {
        marketPrices: null,
        marketPricesFetchedAt: 0,
        historyCache: new Map(), // key: `${cleanId}__${enhancementLevel}`
        currentItemId: "",
        currentEnhancementLevel: 0,
        orderBook: {
            asks: [],
            bids: [],
            bestAsk: null,
            bestBid: null
        }
    };

    // ── 6. 市場數據與強化分級歷史流速 ──────────────────────
    async function fetchMarketPrices() {
        const now = Date.now();
        if (STATE.marketPrices && (now - STATE.marketPricesFetchedAt < CONFIG.CACHE_TTL_MS)) {
            return STATE.marketPrices;
        }

        try {
            const resp = await fetch(CONFIG.MARKET_API_URL);
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            const data = await resp.json();
            STATE.marketPrices = data.marketData || {};
            STATE.marketPricesFetchedAt = now;
            return STATE.marketPrices;
        } catch (err) {
            return STATE.marketPrices || {};
        }
    }

    async function fetchItemHistory(cleanId, enhancementLevel = 0) {
        if (!cleanId) {
            return { dailyAvg: 2000, maxBurst: 0, burstDays: null, isBurstItem: false, isLowLiquidityGear: false };
        }

        const cacheKey = `${cleanId}__${enhancementLevel}`;
        if (STATE.historyCache.has(cacheKey)) {
            return STATE.historyCache.get(cacheKey);
        }

        const shardUrl = `${CONFIG.HISTORY_BASE_URL}items_${cleanId}__${enhancementLevel}.json`;
        try {
            const resp = await fetch(shardUrl);
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            const data = await resp.json();
            const rows = data.rows || [];

            const volumes = rows.map(r => r.v).filter(v => v !== null && v > 0);
            let dailyAvg = 0;
            const tSpanDays = rows.length >= 2 ? (rows[rows.length - 1].time - rows[0].time) / 86400 : 1;

            if (volumes.length > 0 && tSpanDays > 0) {
                const totalVol = volumes.reduce((a, b) => a + b, 0);
                dailyAvg = Math.round(totalVol / Math.max(1, tSpanDays));
            } else {
                if (enhancementLevel >= 8) dailyAvg = 0.15;
                else if (enhancementLevel >= 7) dailyAvg = 0.5;
                else if (enhancementLevel >= 5) dailyAvg = 1.2;
                else if (enhancementLevel >= 1) dailyAvg = 3.0;
                else dailyAvg = 50.0;
            }

            const maxBurst = volumes.length > 0 ? Math.max(...volumes) : 0;
            const burstThreshold = Math.max(30000, dailyAvg * 0.5);
            const bursts = rows.filter(r => r.v && r.v >= burstThreshold);
            let burstDays = null;
            if (bursts.length > 1) {
                const times = bursts.map(b => b.time);
                const intervals = times.slice(1).map((t, i) => t - times[i]);
                burstDays = (intervals.reduce((a, b) => a + b, 0) / intervals.length / 86400).toFixed(1);
            }

            const isBurstItem = Boolean(bursts.length >= 3 && maxBurst >= 50000 && enhancementLevel === 0);
            const isLowLiquidityGear = Boolean(enhancementLevel > 0 || (dailyAvg < 10 && !isBurstItem));

            const result = { dailyAvg, maxBurst, burstDays, isBurstItem, isLowLiquidityGear };
            STATE.historyCache.set(cacheKey, result);
            return result;
        } catch (e) {
            // 嘗試檢查 snapshot 實時流速
            const snapshotInfo = getItemMarketInfo(cleanId, enhancementLevel);
            let dailyAvg = snapshotInfo?.volume ? (snapshotInfo.volume * 24) : 0;
            if (!dailyAvg) {
                if (enhancementLevel >= 8) dailyAvg = 0.15;
                else if (enhancementLevel >= 7) dailyAvg = 0.5;
                else if (enhancementLevel >= 5) dailyAvg = 1.2;
                else if (enhancementLevel >= 1) dailyAvg = 3.0;
                else dailyAvg = 1000.0; // 消耗品兜底
            }

            const fallback = {
                dailyAvg,
                maxBurst: 0,
                burstDays: null,
                isBurstItem: false,
                isLowLiquidityGear: (enhancementLevel > 0)
            };
            STATE.historyCache.set(cacheKey, fallback);
            return fallback;
        }
    }

    function getItemMarketInfo(itemId, enhancementLevel = 0) {
        if (!STATE.marketPrices) return null;
        const hrid = itemId.startsWith("/items/") ? itemId : `/items/${itemId}`;
        const itemInfo = STATE.marketPrices[hrid];
        if (!itemInfo) return null;
        const entry = itemInfo[String(enhancementLevel)] || itemInfo["0"] || Object.values(itemInfo)[0];
        if (!entry) return null;
        return {
            ask: entry.a > 0 ? entry.a : null,
            bid: entry.b > 0 ? entry.b : null,
            lastPrice: entry.p > 0 ? entry.p : null,
            volume: entry.v > 0 ? entry.v : (enhancementLevel > 0 ? 0.05 : 10)
        };
    }

    // ── 7. WebSocket 盤口攔截 ──────────────────────────────
    function setupWSInterceptor() {
        const prevGetter = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data")?.get;
        if (!prevGetter) return;

        Object.defineProperty(MessageEvent.prototype, "data", {
            configurable: true,
            enumerable: true,
            get: function () {
                const message = prevGetter.call(this);
                const socket = this.currentTarget;
                const isGameWS = (socket instanceof WebSocket) && (
                    socket.url.includes("milkywayidle.com/ws") ||
                    socket.url.includes("milkywayidlecn.com/ws")
                );

                if (isGameWS && !this.__mwiAdvProcessed) {
                    this.__mwiAdvProcessed = true;
                    try {
                        const obj = JSON.parse(message);
                        if (obj && obj.type === "market_item_order_books_updated") {
                            const { itemHrid, orderBooks } = obj.marketItemOrderBooks || {};
                            if (itemHrid && orderBooks) {
                                const level = STATE.currentEnhancementLevel || 0;
                                const book = orderBooks[level] || orderBooks[0] || Object.values(orderBooks)[0];
                                if (book) {
                                    handleWSOrderBookUpdate(itemHrid, book, level);
                                }
                            }
                        }
                    } catch (e) { }
                }
                return message;
            }
        });
    }

    function handleWSOrderBookUpdate(itemHrid, book, enhancementLevel) {
        const bareId = itemHrid.replace("/items/", "");
        STATE.currentItemId = bareId;
        STATE.currentEnhancementLevel = enhancementLevel;

        STATE.orderBook.asks = (book.asks || []).map(a => ({
            price: a.price,
            count: a.count,
            isMine: Boolean(a.isMyOrder)
        }));
        STATE.orderBook.bids = (book.bids || []).map(b => ({
            price: b.price,
            count: b.count,
            isMine: Boolean(b.isMyOrder)
        }));

        STATE.orderBook.bestAsk = STATE.orderBook.asks.length ? STATE.orderBook.asks[0].price : null;
        STATE.orderBook.bestBid = STATE.orderBook.bids.length ? STATE.orderBook.bids[0].price : null;

        fetchItemHistory(bareId, enhancementLevel).then(() => {
            setTimeout(renderAdvisorOverlay, 50);
        });
    }

    // ── 7.5 判斷是否為市場掛單彈窗 (嚴格隔離工藝/製作/裝備/技能等非市場彈窗) ─
    function isMarketplaceOrderModal(modal) {
        if (!modal || !(modal instanceof Element)) return false;

        // 1. 必須具備 Marketplace 掛單彈窗標識或身處市場面板內
        const isMarketModalClass = modal.matches?.('[class*="MarketplacePanel_modalContent"]') ||
                                   modal.querySelector?.('[class*="MarketplacePanel_modalContent"]') !== null;
        const isInsideMarketPanel = modal.closest?.('[class*="MarketplacePanel_marketplacePanel"]') !== null;

        // 2. 必須含有價格或數量輸入容器 (掛單彈窗必有 priceInputs / quantityInputs)
        const hasPriceInputs = modal.querySelector('[class*="MarketplacePanel_priceInputs"], [class*="priceInputs"]') !== null;
        const hasQtyInputs = modal.querySelector('[class*="MarketplacePanel_quantityInputs"], [class*="quantityInputs"]') !== null;

        // 3. 檢查標題或內容是否包含掛單關鍵字 (避免誤判 製作/工藝/技能 等無關彈窗，同時兼容即時吃單/Buy Now)
        const headerEl = modal.querySelector('[class*="MarketplacePanel_header"], [class*="Modal_header"], h2, h3');
        const headerText = (headerEl?.textContent || "").trim();
        const isOrderHeader = /(?:购买|買入|buy|出售|賣出|sell)/i.test(headerText) ||
                              /(?:挂牌|掛單|listing|order)/i.test(headerText) ||
                              /(?:可交易区间|可交易區間|Tradable Range)/i.test(modal.textContent || "");

        return (isMarketModalClass || isInsideMarketPanel) && (hasPriceInputs || hasQtyInputs) && isOrderHeader;
    }

    function isElementVisible(el) {
        if (!el) return false;

        // 1. 檢查 class 是否含有 hidden 或 hide (MWI 官方類別如 MarketplacePanel_hidden__eOmUA)
        const className = el.className || (typeof el.getAttribute === 'function' ? el.getAttribute('class') : '');
        if (typeof className === 'string' && /(?:^|\s|\b|_)(?:hidden|hide)(?:$|\s|\b|_)/i.test(className)) {
            return false;
        }

        // 2. 檢查內聯 style (display: none / visibility: hidden)
        if (el.style) {
            if (el.style.display === 'none' || el.style.visibility === 'hidden') return false;
        }

        // 3. 檢查 getComputedStyle (支援真實瀏覽器 DOM 計算樣式)
        try {
            if (typeof window !== 'undefined' && window.getComputedStyle) {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return false;
                }
                if (parseFloat(style.height) === 0 && parseFloat(style.width) === 0 && style.overflow === 'hidden') {
                    return false;
                }
            }
        } catch (e) {}

        // 4. offsetParent 檢測 (若 offsetParent 為 null 且非固定定位，則必為不可見)
        if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null) {
            return false;
        }

        return true;
    }

    // ── 7.6 判斷是否處於物品「訂單簿視圖 (OrderBook)」 ─────────────
    // 嚴格隔離「我的掛單 (myListings)」、「物資選擇 (itemSelection)」與「強化等級總覽 (itemSummary)」
    function isOrderBookView(marketPanel) {
        if (!marketPanel || !isElementVisible(marketPanel)) return false;

        // 策略 1: 優先從 React Fiber state 取得 (正式機 100% 權威準確)
        try {
            const fiberKey = Object.keys(marketPanel).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (fiberKey) {
                let curr = marketPanel[fiberKey];
                while (curr) {
                    if (curr.stateNode && curr.stateNode.state) {
                        const { marketTabKey, marketListingsView } = curr.stateNode.state;
                        if (marketTabKey && marketListingsView) {
                            return marketTabKey === "MarketListings" && marketListingsView === "OrderBook";
                        }
                    }
                    curr = curr.return;
                }
            }
        } catch (e) {}

        // 策略 2: DOM 元素狀態判斷 (單元測試與無 Fiber 環境 fallback)
        const orderBooks = marketPanel.querySelector ? marketPanel.querySelector('[class*="MarketplacePanel_orderBooksContainer"], [class*="MarketplacePanel_orderBook"]') : null;
        const hasOrderBooks = (orderBooks && isElementVisible(orderBooks)) || Boolean(marketPanel.hasOrderBooks);

        const myListings = marketPanel.querySelector ? marketPanel.querySelector('[class*="MarketplacePanel_myListings"]') : null;
        const isMyListings = (myListings && isElementVisible(myListings)) || Boolean(marketPanel.isMyListings);

        const itemSelection = marketPanel.querySelector ? marketPanel.querySelector('[class*="MarketplacePanel_itemSelection"]') : null;
        const isItemSelection = (itemSelection && isElementVisible(itemSelection)) || Boolean(marketPanel.isItemSelection);

        const itemSummary = marketPanel.querySelector ? marketPanel.querySelector('[class*="MarketplacePanel_itemSummaryTableContainer"]') : null;
        const isItemSummary = (itemSummary && isElementVisible(itemSummary)) || Boolean(marketPanel.isItemSummary);

        return hasOrderBooks && !isMyListings && !isItemSelection && !isItemSummary;
    }

    // ── 7.7 清除一切顧問覆蓋元件 (速查卡、跨度條、行徽章) ─────────
    function cleanupAdvisorOverlay(scope = document) {
        if (!scope || !scope.querySelectorAll) return;
        scope.querySelectorAll(".mwi-advisor-top-banner").forEach(el => el.remove());
        scope.querySelectorAll(".mwi-adv-spread-bridge-bar").forEach(el => el.remove());
        scope.querySelectorAll(".mwi-adv-row-badge").forEach(el => el.remove());
        scope.querySelectorAll(".mwi-adv-snip-tag").forEach(el => el.remove());
        scope.querySelectorAll(".mwi-adv-my-tag").forEach(el => el.remove());
        scope.querySelectorAll(".mwi-adv-my-order-highlight").forEach(el => el.classList.remove("mwi-adv-my-order-highlight"));
    }

    // ── 8. 精準識別當前市場面板物品與強化等級 (嚴格隔離側邊欄與製作彈窗) ─
    function detectCurrentItemInfo() {
        const marketPanel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        let itemId = "";
        let enhancementLevel = 0;

        // 1. 最高優先級：直接從 MarketplacePanel 的 React Fiber 取得 (100% 精準無誤)
        if (marketPanel) {
            const fiberKey = Object.keys(marketPanel).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
            if (fiberKey) {
                let curr = marketPanel[fiberKey];
                while (curr) {
                    if (curr.stateNode && curr.stateNode.state && curr.stateNode.state.itemHrid) {
                        itemId = curr.stateNode.state.itemHrid.replace("/items/", "");
                        enhancementLevel = typeof curr.stateNode.state.enhancementLevel === 'number'
                            ? curr.stateNode.state.enhancementLevel
                            : 0;
                        break;
                    }
                    curr = curr.return;
                }
            }
        }

        // 2. 次優先級：若處於市場掛單彈窗中，從彈窗內的物品圖標與強化輸入框取得 (嚴格排除製作/非市場彈窗)
        const modal = document.querySelector('[class*="MarketplacePanel_modalContent"]');
        if (modal && isMarketplaceOrderModal(modal)) {
            if (!itemId) {
                const useEl = modal.querySelector('[class*="itemContainer"] svg use, [class*="Item_item"] svg use');
                if (useEl) {
                    const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "";
                    if (href.includes("#") && !href.includes("coin")) {
                        itemId = href.split("#").pop().replace(/^items_sprite-/, "").replace(/^\/items\//, "");
                    }
                }
            }
            const enhanceInput = modal.querySelector('[class*="inputContainer"] input[type="number"]');
            if (enhanceInput && enhanceInput.value !== "") {
                const val = parseInt(enhanceInput.value, 10);
                if (!isNaN(val)) enhancementLevel = val;
            }
        }

        // 3. 第三優先級：從 MarketplacePanel 的 currentItem (中央大圖標) 提取
        if (!itemId && marketPanel) {
            const currentItem = marketPanel.querySelector('[class*="MarketplacePanel_currentItem"]');
            if (currentItem) {
                const useEl = currentItem.querySelector('svg use');
                if (useEl) {
                    const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "";
                    if (href.includes("#") && !href.includes("coin")) {
                        itemId = href.split("#").pop().replace(/^items_sprite-/, "").replace(/^\/items\//, "");
                    }
                }
                const levelEl = currentItem.querySelector('[class*="Item_enhancementLevel"]');
                if (levelEl && levelEl.textContent) {
                    const match = levelEl.textContent.match(/\+?(\d+)/);
                    if (match) enhancementLevel = parseInt(match[1], 10) || 0;
                }
            }
        }

        // 4. 第四優先級：WebSocket 攔截到的最新狀態
        if (!itemId && STATE.currentItemId) {
            itemId = STATE.currentItemId;
        }

        // 5. 確保非可強化物品 (如咖啡、茶、礦石、藥水、食材等) 之強化等級強制歸 0
        if (itemId) {
            const nonEnhanceableKeywords = [
                "coffee", "tea", "ore", "bar", "ingot", "log", "lumber", "essence",
                "gummy", "yogurt", "donut", "cake", "potion", "seed", "leaf",
                "milk", "egg", "meat", "hide", "thread", "fabric", "fiber", "feather",
                "scale", "tooth", "claw", "bone", "chest", "key", "scroll", "tome"
            ];
            if (nonEnhanceableKeywords.some(kw => itemId.includes(kw))) {
                enhancementLevel = 0;
            }
        }

        STATE.currentItemId = itemId;
        STATE.currentEnhancementLevel = enhancementLevel;
        return { itemId, enhancementLevel };
    }

    function extractCleanCellText(td) {
        if (!td) return "";
        const clone = td.cloneNode(true);
        clone.querySelectorAll?.('.mwi-adv-row-badge, .mwi-adv-snip-tag, .mwi-adv-my-tag').forEach(e => e.remove());
        return clone.textContent.trim();
    }

    function parseOrderBookFromDOM() {
        const marketPanel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        if (!marketPanel || !isOrderBookView(marketPanel)) return null;

        const orderBooksContainer = marketPanel.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
        if (!orderBooksContainer) return null;

        const tables = orderBooksContainer.querySelectorAll("table");
        if (tables.length < 2) return null;

        const askTable = tables[0]; // 左側出售列表 (Asks)
        const bidTable = tables[1]; // 右側收購列表 (Bids)

        const asks = [];
        const bids = [];

        askTable.querySelectorAll("tbody tr").forEach(tr => {
            const tds = tr.querySelectorAll("td");
            if (tds.length >= 2) {
                const count = parseQty(extractCleanCellText(tds[0]));
                const price = parseQty(extractCleanCellText(tds[1]));
                const isMine = tr.textContent.includes("取消") || tr.querySelector('button[class*="Button_danger"]') !== null;
                if (price > 0 && count > 0) {
                    asks.push({ price, count, isMine, trElement: tr });
                }
            }
        });

        bidTable.querySelectorAll("tbody tr").forEach(tr => {
            const tds = tr.querySelectorAll("td");
            if (tds.length >= 2) {
                const count = parseQty(extractCleanCellText(tds[0]));
                const price = parseQty(extractCleanCellText(tds[1]));
                const isMine = tr.textContent.includes("取消") || tr.querySelector('button[class*="Button_danger"]') !== null;
                if (price > 0 && count > 0) {
                    bids.push({ price, count, isMine, trElement: tr });
                }
            }
        });

        asks.sort((a, b) => a.price - b.price);
        bids.sort((a, b) => b.price - a.price);

        return { asks, bids };
    }

    // ── 9. 精準取得掛單彈窗狀態與輸入值 ─────────────────────
    function getModalState(modal) {
        const headerEl = modal.querySelector('[class*="MarketplacePanel_header"], [class*="Modal_header"], h2, h3');
        const headerText = (headerEl?.textContent || "").trim();
        const isBuy = /购买|買入|buy/i.test(headerText);
        const modalType = isBuy ? "BUY" : "SELL";

        const { enhancementLevel } = detectCurrentItemInfo();

        let currentPrice = 0;
        const priceInputsContainer = modal.querySelector('[class*="MarketplacePanel_priceInputs"], [class*="priceInputs"]');
        if (priceInputsContainer) {
            const input = priceInputsContainer.querySelector('input');
            if (input && input.value !== "") {
                currentPrice = parseQty(input.value);
            } else {
                const display = priceInputsContainer.querySelector('[class*="priceDisplay"]');
                if (display && display.textContent) {
                    currentPrice = parseQty(display.textContent);
                }
            }
        }

        let currentQty = 1;
        const qtyInputsContainer = modal.querySelector('[class*="MarketplacePanel_quantityInputs"], [class*="quantityInputs"]');
        if (qtyInputsContainer) {
            const input = qtyInputsContainer.querySelector('input');
            if (input && input.value !== "") {
                currentQty = parseQty(input.value) || 1;
            }
        }

        let bandMin = 0;
        let bandMax = Infinity;
        const bandText = modal.textContent || "";
        const bandMatch = bandText.match(/(?:可交易区间|可交易區間|Tradable Range)[：:]\s*([0-9,]+)\s*[-–—]\s*([0-9,]+)/i);
        if (bandMatch) {
            bandMin = parseQty(bandMatch[1]);
            bandMax = parseQty(bandMatch[2]);
        }

        return {
            modalType,
            isBuy,
            enhancementLevel,
            currentPrice,
            currentQty,
            bandMin,
            bandMax,
            priceInputsContainer
        };
    }

    // ── 10. React 18 原生價格設定引擎 (穿透虛擬 DOM) ───────
    function setModalPrice(modal, targetPrice) {
        if (!targetPrice || isNaN(targetPrice)) return false;
        const cleanPrice = parseInt(targetPrice, 10);

        // 策略 1: 穿透 React Fiber
        const rootEl = modal.closest('[class*="MarketplacePanel_marketplacePanel"]') || modal;
        const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
        if (fiberKey) {
            let curr = rootEl[fiberKey];
            while (curr) {
                if (curr.stateNode && typeof curr.stateNode.handleSetPriceInput === 'function') {
                    try {
                        curr.stateNode.handleSetPriceInput(cleanPrice);
                        return true;
                    } catch (e) {
                        console.warn("[MWI-Advisor] Fiber handleSetPriceInput error:", e);
                    }
                }
                curr = curr.return;
            }
        }

        // 策略 2: DOM 擬真連動
        const priceInputsContainer = modal.querySelector('[class*="MarketplacePanel_priceInputs"], [class*="priceInputs"]');
        if (!priceInputsContainer) return false;

        const display = priceInputsContainer.querySelector('[class*="priceDisplay"]');
        if (display) {
            display.click();
        }

        setTimeout(() => {
            const input = priceInputsContainer.querySelector('input');
            if (input) {
                input.focus();
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                if (nativeSetter) {
                    nativeSetter.call(input, String(cleanPrice));
                } else {
                    input.value = String(cleanPrice);
                }
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
                input.blur();
            }
        }, 50);

        return true;
    }

    // ── 11. 核心決策演算法 (流速依商品屬性精準計算) ─────────
    function calculateTradeDecision(modalState, asks, bids, historyInfo, itemHrid) {
        const { modalType, isBuy, enhancementLevel, currentPrice, currentQty, bandMin, bandMax } = modalState;

        const dailyAvg = (historyInfo && historyInfo.dailyAvg > 0) ? historyInfo.dailyAvg : (enhancementLevel > 0 ? 1.0 : 2000.0);
        const histHourly = dailyAvg / 24;
        const blendedVol = enhancementLevel > 0 ? Math.max(0.005, histHourly) : Math.max(1, histHourly);
        const taxRate = getItemTaxRate(itemHrid);

        const bestAsk = asks.length > 0 ? asks[0].price : null;
        const bestBid = bids.length > 0 ? bids[0].price : null;

        const qty = Math.max(1, currentQty);
        const price = Math.max(0, currentPrice);

        const currentTick = binGap(Math.max(1, price), enhancementLevel);

        let instantPrice = isBuy ? bestAsk : bestBid;
        let topMakerPrice = null;

        if (isBuy) {
            if (bestBid) {
                topMakerPrice = getNextBinnedPrice(bestBid, enhancementLevel);
            } else if (bandMin > 0) {
                topMakerPrice = bandMin;
            } else if (bestAsk) {
                topMakerPrice = getPrevBinnedPrice(bestAsk, enhancementLevel);
            }
        } else {
            if (bestAsk) {
                topMakerPrice = getPrevBinnedPrice(bestAsk, enhancementLevel);
            } else if (bandMax < Infinity) {
                topMakerPrice = bandMax;
            } else if (bestBid) {
                topMakerPrice = getNextBinnedPrice(bestBid, enhancementLevel);
            }
        }

        if (topMakerPrice && bandMin > 0 && bandMax < Infinity) {
            topMakerPrice = Math.min(Math.max(topMakerPrice, bandMin), bandMax);
        }
        if (instantPrice && bandMin > 0 && bandMax < Infinity) {
            instantPrice = Math.min(Math.max(instantPrice, bandMin), bandMax);
        }

        if (price <= 0) {
            return {
                status: "INVALID",
                tierText: "請輸入價格",
                aheadCount: 0,
                etaHours: 0,
                diffTotal: 0,
                wagePerHour: 0,
                advice: "💡 請在上方點擊價格欄位設定出價",
                instantPrice,
                topMakerPrice,
                taxRate,
                currentTick
            };
        }

        // ────── 購買掛牌 (BUY) 試算 ──────
        if (isBuy) {
            if (bestAsk && price >= bestAsk) {
                return {
                    status: "INSTANT_FILL",
                    tierText: "⚡ 即時吃單 (無需排隊)",
                    aheadCount: 0,
                    etaHours: 0,
                    diffTotal: 0,
                    wagePerHour: 0,
                    advice: `🟢 出價已達最低賣價 (${formatPrice(bestAsk)})，送出後將「立刻成交」，耗時 0 秒！`,
                    instantPrice,
                    topMakerPrice,
                    taxRate,
                    currentTick
                };
            }

            if (bestBid && price > bestBid) {
                const diffVsInstant = (bestAsk ? (bestAsk - price) : 0) * qty;
                const estHours = qty / blendedVol;
                const wage = diffVsInstant / Math.max(0.1, estHours);

                return {
                    status: "TOP_MAKER",
                    tierText: "🎯 第 1 檔 (全場最高買價)",
                    aheadCount: 0,
                    etaHours: estHours,
                    diffTotal: diffVsInstant,
                    wagePerHour: wage,
                    advice: `🟡 成功搶佔買單第 1 順位 (出價 ${formatPrice(price)})！比直接以 ${bestAsk ? formatPrice(bestAsk) : '--'} 吃單共省下 ${formatPrice(diffVsInstant)}。`,
                    instantPrice,
                    topMakerPrice,
                    taxRate,
                    currentTick
                };
            }

            let aheadCount = 0;
            const higherPrices = new Set();
            for (const b of bids) {
                if (b.price > price) {
                    aheadCount += b.count;
                    higherPrices.add(b.price);
                } else if (b.price === price) {
                    aheadCount += b.count;
                }
            }
            const tierIndex = higherPrices.size + 1;
            const effectiveVol = blendedVol * CONFIG.UNDERCUT_PENALTY_RATE;
            const etaHours = (aheadCount + qty) / Math.max(0.001, effectiveVol);
            const diffVsInstant = (bestAsk ? (bestAsk - price) : 0) * qty;
            const wage = diffVsInstant / Math.max(0.1, etaHours);

            return {
                status: "QUEUE",
                tierText: `第 ${tierIndex} 檔 (前方有更優買價)`,
                aheadCount,
                etaHours,
                diffTotal: diffVsInstant,
                wagePerHour: wage,
                advice: `🔴 前方有 ${formatNumber(aheadCount)} 件出價更高的買單排隊！建議提價至 ${formatPrice(topMakerPrice)} 搶排首檔。`,
                instantPrice,
                topMakerPrice,
                taxRate,
                currentTick
            };
        }

        // ────── 出售掛牌 (SELL) 試算 ──────
        const netAtUserPrice = computeSellerNetPerItem(price, taxRate);
        const netAtInstant = bestBid ? computeSellerNetPerItem(bestBid, taxRate) : 0;
        const diffTotal = (netAtUserPrice - netAtInstant) * qty;

        if (bestBid && price <= bestBid) {
            return {
                status: "INSTANT_FILL",
                tierText: "⚡ 即時吃單 (無需排隊)",
                aheadCount: 0,
                etaHours: 0,
                diffTotal: 0,
                wagePerHour: 0,
                advice: `🟢 賣價已達最高收購價 (${formatPrice(bestBid)})，送出後將「立刻成交」換得金幣！`,
                instantPrice,
                topMakerPrice,
                taxRate,
                currentTick
            };
        }

        if (bestAsk && price < bestAsk) {
            const estHours = qty / blendedVol;
            const wage = diffTotal / Math.max(0.1, estHours);

            return {
                status: "TOP_MAKER",
                tierText: "🎯 第 1 檔 (全場最低賣價)",
                aheadCount: 0,
                etaHours: estHours,
                diffTotal,
                wagePerHour: wage,
                advice: `🟡 成功搶佔賣單第 1 順位 (定價 ${formatPrice(price)}，稅後實得 ${formatPrice(netAtUserPrice)}/件)！比直接吃單每件多賺 ${formatPrice(netAtUserPrice - netAtInstant)}。`,
                instantPrice,
                topMakerPrice,
                taxRate,
                currentTick
            };
        }

        let aheadCount = 0;
        const lowerPrices = new Set();
        for (const a of asks) {
            if (a.price < price) {
                aheadCount += a.count;
                lowerPrices.add(a.price);
            } else if (a.price === price) {
                aheadCount += a.count;
            }
        }
        const tierIndex = lowerPrices.size + 1;
        const effectiveVol = blendedVol * CONFIG.UNDERCUT_PENALTY_RATE;
        const etaHours = (aheadCount + qty) / Math.max(0.001, effectiveVol);
        const wage = diffTotal / Math.max(0.1, etaHours);

        return {
            status: "QUEUE",
            tierText: `第 ${tierIndex} 檔 (前方有更低賣單)`,
            aheadCount,
            etaHours,
            diffTotal,
            wagePerHour: wage,
            advice: `🔴 前方有 ${formatNumber(aheadCount)} 件更低價的賣單排隊！建議降價至 ${formatPrice(topMakerPrice)} 搶排首檔，避免滯銷。`,
            instantPrice,
            topMakerPrice,
            taxRate,
            currentTick
        };
    }

    // ── 11.5 盤口價差真空度與斷檔檔位試算 (Spread & Gap Engine) ───
    function calculateSpreadGap(bestAsk, bestBid, enhancementLevel = 0, itemId = "") {
        if (!bestAsk || !bestBid || bestAsk <= bestBid) {
            return null;
        }
        const spreadGold = bestAsk - bestBid;
        const spreadPct = (spreadGold / bestAsk) * 100;

        // 逐檔步進計算中間有多少合法 Tick 檔位
        const gapTicks = [];
        let curr = getNextBinnedPrice(bestBid, enhancementLevel);
        while (curr < bestAsk && gapTicks.length < 50) {
            gapTicks.push(curr);
            const next = getNextBinnedPrice(curr, enhancementLevel);
            if (next <= curr) break; // 防禦死循環
            curr = next;
        }

        const nextBid = getNextBinnedPrice(bestBid, enhancementLevel);
        const prevAsk = getPrevBinnedPrice(bestAsk, enhancementLevel);

        const topMakerBid = nextBid < bestAsk ? nextBid : bestBid;
        const topMakerAsk = prevAsk > bestBid ? prevAsk : bestAsk;

        const taxRate = getItemTaxRate(itemId);
        const makerNetRevenue = computeSellerNetPerItem(topMakerAsk, taxRate);
        const dumpNet = computeSellerNetPerItem(bestBid, taxRate);

        const marketMakingProfit = makerNetRevenue - topMakerBid;
        const buySaving = bestAsk - topMakerBid;
        const sellNetGain = makerNetRevenue - dumpNet;

        return {
            bestAsk,
            bestBid,
            spreadGold,
            spreadPct,
            gapCount: gapTicks.length,
            gapTicks,
            topMakerBid,
            topMakerAsk,
            buySaving: Math.max(0, buySaving),
            sellNetGain: Math.max(0, sellNetGain),
            marketMakingProfit,
            taxRate
        };
    }

    // ── 12. 頂部決策看板與深度行標籤 ───────────────────────
    async function renderAdvisorOverlay() {
        const marketPanel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        if (!marketPanel || !isOrderBookView(marketPanel)) {
            if (marketPanel) cleanupAdvisorOverlay(marketPanel);
            return;
        }

        const { itemId, enhancementLevel } = detectCurrentItemInfo();
        if (!itemId) {
            cleanupAdvisorOverlay(marketPanel);
            return;
        }

        const historyInfo = await fetchItemHistory(itemId, enhancementLevel);

        const domBook = parseOrderBookFromDOM();
        const asks = (domBook?.asks && domBook.asks.length > 0) ? domBook.asks : STATE.orderBook.asks;
        const bids = (domBook?.bids && domBook.bids.length > 0) ? domBook.bids : STATE.orderBook.bids;

        const bestAsk = asks.length ? asks[0].price : null;
        const bestBid = bids.length ? bids[0].price : null;

        const gapInfo = calculateSpreadGap(bestAsk, bestBid, enhancementLevel, itemId);

        injectTopAdvisorBanner(marketPanel, itemId, enhancementLevel, bestAsk, bestBid, historyInfo, gapInfo);
        injectSpreadBridgeBar(marketPanel, gapInfo);
        decorateOrderRows(asks, bids, historyInfo, enhancementLevel, gapInfo);
    }

    function injectTopAdvisorBanner(panel, itemId, enhancementLevel, bestAsk, bestBid, historyInfo, gapInfo) {
        if (!isOrderBookView(panel)) {
            cleanupAdvisorOverlay(panel);
            return;
        }

        const orderBooksContainer = panel.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
        if (!orderBooksContainer) {
            cleanupAdvisorOverlay(panel);
            return;
        }

        let banner = panel.querySelector(".mwi-advisor-top-banner");
        if (!banner) {
            banner = document.createElement("div");
            banner.className = "mwi-advisor-top-banner";
            orderBooksContainer.parentElement.insertBefore(banner, orderBooksContainer);
        }

        const spreadGold = (bestAsk && bestBid) ? (bestAsk - bestBid) : 0;
        const spreadPct = (bestAsk && bestBid && bestAsk > 0) ? ((spreadGold / bestAsk) * 100).toFixed(1) : 0;
        const taxRate = getItemTaxRate(itemId);
        const dailyAvg = (historyInfo && typeof historyInfo.dailyAvg === 'number') ? historyInfo.dailyAvg : 0;

        // 讀取速查卡收合狀態 (預設為 false 關閉，避免擠佔下方訂單簿高度)
        let showQuickCards = false;
        try {
            showQuickCards = localStorage.getItem("mwi_adv_show_quick_cards") === "true";
        } catch (e) {}

        const signature = `${itemId}_${enhancementLevel}_${bestAsk}_${bestBid}_${showQuickCards}_${gapInfo?.gapCount}`;
        if (banner.dataset.signature === signature) {
            return;
        }
        banner.dataset.signature = signature;

        let burstCardHtml = "";
        if (showQuickCards && historyInfo?.isBurstItem) {
            burstCardHtml = `
                <div class="mwi-adv-burst-pill">
                    <span>🐋 大單週期特性</span>: 
                    <b>平均每 ${historyInfo.burstDays || '3~4'} 天一次集中掃貨 (歷史單筆最高 ${formatNumber(historyInfo.maxBurst)} 件)</b>
                </div>
            `;
        } else if (showQuickCards && historyInfo?.isLowLiquidityGear) {
            burstCardHtml = `
                <div class="mwi-adv-gear-pill">
                    <span>⏳ 低流速裝備特性</span>: 
                    <b>+${enhancementLevel} 級裝備全服日均成交僅約 ${dailyAvg.toFixed(1)} 件，掛單週期偏長，請謹慎評估排隊時薪！</b>
                </div>
            `;
        }

        // 買家 vs 賣家 雙向速查決策卡 (僅在使用者展開時渲染)
        let decisionGridHtml = "";
        if (showQuickCards && gapInfo) {
            const dumpNet = computeSellerNetPerItem(bestBid, gapInfo.taxRate);
            const makerNet = computeSellerNetPerItem(gapInfo.topMakerAsk, gapInfo.taxRate);
            const mmProfitText = gapInfo.marketMakingProfit > 0
                ? `<span style="color: #34d399; font-weight: 600;">💰 做市利潤: ${formatPrice(gapInfo.topMakerBid)} 買入 ➔ ${formatPrice(gapInfo.topMakerAsk)} 賣出，稅後每件淨賺 +${formatPrice(gapInfo.marketMakingProfit)}</span>`
                : `<span style="color: #64748b;">⛔ 扣除 ${(gapInfo.taxRate * 100).toFixed(0)}% 交易稅後無做市搬磚空間</span>`;

            decisionGridHtml = `
                <div class="mwi-adv-decision-grid">
                    <!-- 買家決策卡 -->
                    <div class="mwi-adv-side-card buyer">
                        <div class="mwi-adv-side-title">
                            <span class="buy">🛒 【買家】順利低價買入</span>
                            <span class="mwi-adv-side-badge buy">搶第 1 順位</span>
                        </div>
                        <div class="mwi-adv-side-body">
                            <div class="mwi-adv-rec-price-row">
                                <span class="mwi-adv-label">🎯 推薦買價:</span>
                                <span class="mwi-adv-price buy" title="${gapInfo.topMakerBid.toLocaleString()} G">${formatPrice(gapInfo.topMakerBid)}</span>
                                <span class="mwi-adv-saving">+1檔 (每件省 ${formatPrice(gapInfo.buySaving)})</span>
                            </div>
                            <div class="mwi-adv-desc-row">
                                ⚡ 速度：前排 <b>0</b> 件排隊，最優先被賣家撮合
                            </div>
                            <div class="mwi-adv-alt-row">
                                💨 急需立刻拿到？直接吃單: <b title="${bestAsk ? bestAsk.toLocaleString() + ' G' : ''}">${formatPrice(bestAsk)}</b> (多付 ${formatPrice(gapInfo.buySaving)})
                            </div>
                        </div>
                    </div>

                    <!-- 賣家決策卡 -->
                    <div class="mwi-adv-side-card seller">
                        <div class="mwi-adv-side-title">
                            <span class="sell">💰 【賣家】順利高價賣掉</span>
                            <span class="mwi-adv-side-badge sell">搶第 1 順位</span>
                        </div>
                        <div class="mwi-adv-side-body">
                            <div class="mwi-adv-rec-price-row">
                                <span class="mwi-adv-label">🎯 推薦賣價:</span>
                                <span class="mwi-adv-price sell" title="${gapInfo.topMakerAsk.toLocaleString()} G">${formatPrice(gapInfo.topMakerAsk)}</span>
                                <span class="mwi-adv-saving">-1檔 (每件多賺 ${formatPrice(gapInfo.sellNetGain)})</span>
                            </div>
                            <div class="mwi-adv-desc-row">
                                ⚡ 速度：前排 <b>0</b> 件排隊，最優先被買家買走 (稅後實得 <b title="${makerNet.toLocaleString()} G">${formatPrice(makerNet)}</b>)
                            </div>
                            <div class="mwi-adv-alt-row">
                                💨 急需立刻變現？直接賣出: <b title="${bestBid ? bestBid.toLocaleString() + ' G' : ''}">${formatPrice(bestBid)}</b> (實得 <b title="${dumpNet.toLocaleString()} G">${formatPrice(dumpNet)}</b>)
                            </div>
                        </div>
                    </div>
                </div>
                <div class="mwi-adv-mm-bar">
                    ${mmProfitText}
                </div>
            `;
        }

        banner.innerHTML = `
            <div class="mwi-adv-header" style="${showQuickCards ? 'margin-bottom: 6px;' : 'margin-bottom: 0;'}">
                <div class="mwi-adv-title">
                    <span class="mwi-adv-logo">📊</span> 智慧交易顧問
                    ${enhancementLevel > 0 ? `<span class="mwi-adv-level-badge">+${enhancementLevel} 級</span>` : ''}
                    <span class="mwi-adv-tax-badge">交易稅 ${(taxRate * 100).toFixed(0)}%</span>
                </div>
                <div class="mwi-adv-metrics">
                    <span class="mwi-adv-tag">
                        盤口價差: <b title="${bestBid ? bestBid.toLocaleString() + ' G' : ''}">${formatPrice(bestBid, false)}</b> ↔ <b title="${bestAsk ? bestAsk.toLocaleString() + ' G' : ''}">${formatPrice(bestAsk, false)}</b> (差 <b title="${spreadGold.toLocaleString()} G">${formatPrice(spreadGold)}</b>, <b>${spreadPct}%</b>)
                    </span>
                    <span class="mwi-adv-tag" style="color: #38bdf8; border-color: #0284c7;">
                        全服日均: <b>${dailyAvg >= 10 ? formatNumber(dailyAvg) : dailyAvg.toFixed(1)}/天</b>
                    </span>
                    <button type="button" id="mwi-adv-toggle-cards" class="mwi-adv-toggle-btn" title="切換顯示買賣決策速查卡">
                        ${showQuickCards ? '✕ 關閉速查卡' : '💡 展開速查卡'}
                    </button>
                </div>
            </div>
            ${burstCardHtml}
            ${decisionGridHtml}
        `;

        // 綁定收合/展開事件
        const toggleBtn = banner.querySelector("#mwi-adv-toggle-cards");
        if (toggleBtn) {
            toggleBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const current = localStorage.getItem("mwi_adv_show_quick_cards") === "true";
                    localStorage.setItem("mwi_adv_show_quick_cards", String(!current));
                } catch (err) {}
                banner.dataset.signature = "";
                renderAdvisorOverlay();
            };
        }
    }

    // ── 12.5 表格第一行斷檔跨度指示條 (Spread Gap Bridge Bar) ───────
    function injectSpreadBridgeBar(panel, gapInfo) {
        let bar = panel.querySelector(".mwi-adv-spread-bridge-bar");
        if (!gapInfo || !isOrderBookView(panel)) {
            if (bar) bar.remove();
            return;
        }

        const orderBooksContainer = panel.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
        if (!orderBooksContainer) {
            if (bar) bar.remove();
            return;
        }

        if (!bar) {
            bar = document.createElement("div");
            bar.className = "mwi-adv-spread-bridge-bar";
            orderBooksContainer.parentElement.insertBefore(bar, orderBooksContainer);
        }

        const bridgeSignature = `${gapInfo.bestAsk}_${gapInfo.bestBid}_${gapInfo.gapCount}`;
        if (bar.dataset.signature === bridgeSignature) {
            return;
        }
        bar.dataset.signature = bridgeSignature;

        let ticksHtml = "";
        if (gapInfo.gapCount === 0) {
            ticksHtml = `<div class="mwi-adv-ruler-tight">⚡ 連續相鄰檔位（無中間插隊空間）</div>`;
        } else if (gapInfo.gapCount <= 6) {
            ticksHtml = gapInfo.gapTicks.map(t => {
                const tFormatted = formatPrice(t);
                const tRaw = t.toLocaleString() + " G";
                if (t === gapInfo.topMakerBid && t === gapInfo.topMakerAsk) {
                    return `<span class="mwi-adv-tick-node dual-snip" title="買賣雙方搶先價: ${tRaw}">⭐${tFormatted} (買/賣首位)</span>`;
                } else if (t === gapInfo.topMakerBid) {
                    return `<span class="mwi-adv-tick-node buy-snip" title="買方搶先價: ${tRaw}">⭐${tFormatted} (買)</span>`;
                } else if (t === gapInfo.topMakerAsk) {
                    return `<span class="mwi-adv-tick-node sell-snip" title="賣方搶先價: ${tRaw}">⭐${tFormatted} (賣)</span>`;
                } else {
                    return `<span class="mwi-adv-tick-node empty" title="空檔位: ${tRaw}">${formatPrice(t, false)}</span>`;
                }
            }).join('<span class="mwi-adv-tick-line"></span>');
        } else {
            const bidFormatted = formatPrice(gapInfo.topMakerBid);
            const askFormatted = formatPrice(gapInfo.topMakerAsk);
            ticksHtml = `
                <span class="mwi-adv-tick-node buy-snip" title="買方搶先價: ${gapInfo.topMakerBid.toLocaleString()} G">⭐${bidFormatted} (買)</span>
                <span class="mwi-adv-tick-line"></span>
                <span class="mwi-adv-tick-node empty" style="padding: 2px 8px;">... 中間 ${gapInfo.gapCount - 2} 檔真空 ...</span>
                <span class="mwi-adv-tick-line"></span>
                <span class="mwi-adv-tick-node sell-snip" title="賣方搶先價: ${gapInfo.topMakerAsk.toLocaleString()} G">⭐${askFormatted} (賣)</span>
            `;
        }

        const statusClass = gapInfo.gapCount >= 3 ? "wide" : (gapInfo.gapCount > 0 ? "medium" : "tight");
        const statusText = gapInfo.gapCount >= 3
            ? `⚠️ 盤口斷檔真空 (${gapInfo.gapCount} 檔真空，價差 ${gapInfo.spreadPct.toFixed(1)}%)`
            : (gapInfo.gapCount > 0 ? `💡 輕微斷檔 (${gapInfo.gapCount} 檔空白)` : `⚡ 緊湊連續盤口 (無斷檔)`);

        bar.innerHTML = `
            <div class="mwi-adv-bridge-header">
                <span class="mwi-adv-bridge-status ${statusClass}">${statusText}</span>
                <span class="mwi-adv-bridge-gap-info">
                    盤口價差: <b title="${gapInfo.bestBid.toLocaleString()} G">${formatPrice(gapInfo.bestBid)}</b> ↔ <b title="${gapInfo.bestAsk.toLocaleString()} G">${formatPrice(gapInfo.bestAsk)}</b> (差距 <b title="${gapInfo.spreadGold.toLocaleString()} G">${formatPrice(gapInfo.spreadGold)}</b>)
                </span>
            </div>
            <div class="mwi-adv-bridge-ruler">
                <div class="mwi-adv-ruler-anchor bid">
                    <span class="mwi-adv-ruler-name">最高買價</span>
                    <span class="mwi-adv-ruler-val" title="${gapInfo.bestBid.toLocaleString()} G">${formatPrice(gapInfo.bestBid)}</span>
                </div>
                <div class="mwi-adv-ruler-track">
                    ${ticksHtml}
                </div>
                <div class="mwi-adv-ruler-anchor ask">
                    <span class="mwi-adv-ruler-name">最低賣價</span>
                    <span class="mwi-adv-ruler-val" title="${gapInfo.bestAsk.toLocaleString()} G">${formatPrice(gapInfo.bestAsk)}</span>
                </div>
            </div>
        `;
    }

    function decorateOrderRows(asks, bids, historyInfo, enhancementLevel, gapInfo) {
        const itemInfo = getItemMarketInfo(STATE.currentItemId, enhancementLevel);
        const snapshotHourly = itemInfo?.volume || 0;
        const histDaily = (historyInfo && typeof historyInfo.dailyAvg === 'number' && historyInfo.dailyAvg > 0)
            ? historyInfo.dailyAvg
            : (enhancementLevel > 0 ? 1.0 : (snapshotHourly > 0 ? snapshotHourly * 24 : 2000.0));
        
        const histHourly = histDaily / 24;
        const blendedVol = enhancementLevel > 0
            ? Math.max(0.005, histHourly)
            : Math.max(1, (histHourly * 0.75 + (snapshotHourly || histHourly) * 0.25));

        let aheadAsk = 0;
        asks.forEach((order, idx) => {
            if (!order.trElement) return;
            const effectiveVol = idx === 0 ? blendedVol : (blendedVol * CONFIG.UNDERCUT_PENALTY_RATE);
            const etaHours = (aheadAsk + order.count) / Math.max(0.001, effectiveVol);
            const snipTag = (idx === 0 && gapInfo && gapInfo.topMakerAsk < order.price)
                ? `[💡可插 ${formatPrice(gapInfo.topMakerAsk, false)} 搶首位]`
                : null;
            applyBadgeToRow(order.trElement, aheadAsk, etaHours, order.isMine, snipTag);
            aheadAsk += order.count;
        });

        let aheadBid = 0;
        bids.forEach((order, idx) => {
            if (!order.trElement) return;
            const effectiveVol = idx === 0 ? blendedVol : (blendedVol * CONFIG.UNDERCUT_PENALTY_RATE);
            const etaHours = (aheadBid + order.count) / Math.max(0.001, effectiveVol);
            const snipTag = (idx === 0 && gapInfo && gapInfo.topMakerBid > order.price)
                ? `[💡可插 ${formatPrice(gapInfo.topMakerBid, false)} 搶首位]`
                : null;
            applyBadgeToRow(order.trElement, aheadBid, etaHours, order.isMine, snipTag);
            aheadBid += order.count;
        });
    }

    function applyBadgeToRow(tr, aheadCount, etaHours, isMine, snipTag = null) {
        let badge = tr.querySelector(".mwi-adv-row-badge");
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "mwi-adv-row-badge";
            const targetCell = tr.children[1] || tr.children[0];
            if (targetCell) targetCell.appendChild(badge);
        }

        let etaColor = "#94a3b8";
        if (etaHours > 48) etaColor = "#ef4444";
        else if (etaHours > 12) etaColor = "#f59e0b";
        else if (etaHours < 2) etaColor = "#10b981";

        badge.style.color = etaColor;
        const etaText = `[前排: ${formatNumber(aheadCount)} | ${formatTime(etaHours)}]`;
        badge.innerHTML = `<span class="mwi-adv-eta-text">${etaText}</span>${snipTag ? ` <span class="mwi-adv-snip-tag">${snipTag}</span>` : ''}`;

        if (isMine) {
            tr.classList.add("mwi-adv-my-order-highlight");
            if (!tr.querySelector(".mwi-adv-my-tag")) {
                const tag = document.createElement("span");
                tag.className = "mwi-adv-my-tag";
                tag.textContent = "★我的單";
                tr.children[0].prepend(tag);
            }
        }
    }

    // ── 13. 掛單彈窗實時試算器 (精準監控與一鍵填入) ─────────
    function setupModalObserver() {
        const observer = new MutationObserver(mutations => {
            // 視圖切換即時守衛：若當前市場面板不處於 OrderBook 視圖 (例如切換至「我的掛單」或「全部物資」)，立即徹底清除顧問覆蓋元件
            const marketPanel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
            if (marketPanel && !isOrderBookView(marketPanel)) {
                cleanupAdvisorOverlay(marketPanel);
            }

            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node instanceof Element) {
                        // 嚴格僅對真正的市場掛單彈窗進行掛載，絕不捕獲工藝/製作/裝備等其他彈窗
                        const modal = node.matches?.('[class*="MarketplacePanel_modalContent"], [class*="Modal_modal"]')
                            ? node
                            : node.querySelector?.('[class*="MarketplacePanel_modalContent"], [class*="Modal_modal"]');
                        if (modal) {
                            if (isMarketplaceOrderModal(modal)) {
                                setTimeout(() => attachModalCalculator(modal), 60);
                            } else {
                                // 若是非市場彈窗 (如製作木板、背包裝備等)，清除任何誤注入的試算器
                                const leaked = modal.querySelector(".mwi-adv-modal-calc") ||
                                               modal.parentElement?.querySelector(".mwi-adv-modal-calc");
                                if (leaked) leaked.remove();
                            }
                        }
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    async function attachModalCalculator(modal) {
        // 嚴格校驗：非市場掛單彈窗絕不掛載
        if (!isMarketplaceOrderModal(modal)) {
            const leaked = modal.querySelector(".mwi-adv-modal-calc") ||
                           modal.parentElement?.querySelector(".mwi-adv-modal-calc");
            if (leaked) leaked.remove();
            return;
        }

        if (modal.querySelector(".mwi-adv-modal-calc")) return;

        const priceInputsContainer = modal.querySelector('[class*="MarketplacePanel_priceInputs"], [class*="priceInputs"]');
        if (!priceInputsContainer) return; // 嚴格守衛：非掛單彈窗缺少價格輸入容器時直接退出

        const calcContainer = document.createElement("div");
        calcContainer.className = "mwi-adv-modal-calc";

        const targetParent = priceInputsContainer.closest('[class*="inputContainer"]') ||
                             priceInputsContainer.parentElement ||
                             priceInputsContainer;
        targetParent.after(calcContainer);

        const { itemId, enhancementLevel } = detectCurrentItemInfo();
        const historyInfo = await fetchItemHistory(itemId, enhancementLevel);

        const updateCalc = async () => {
            if (!document.body.contains(modal) || !isMarketplaceOrderModal(modal)) {
                calcContainer.remove();
                return;
            }
            const modalState = getModalState(modal);
            const freshHistory = await fetchItemHistory(itemId, modalState.enhancementLevel);
            renderModalSimulation(calcContainer, modalState, freshHistory, itemId, modal);
        };

        modal.addEventListener("input", updateCalc);
        modal.addEventListener("change", updateCalc);
        modal.addEventListener("click", () => setTimeout(updateCalc, 60));

        const timer = setInterval(() => {
            if (!document.body.contains(calcContainer)) {
                clearInterval(timer);
                return;
            }
            if (!isMarketplaceOrderModal(modal)) {
                calcContainer.remove();
                clearInterval(timer);
                return;
            }
            updateCalc();
        }, 300);

        updateCalc();
    }

    function renderModalSimulation(container, modalState, historyInfo, itemId, modal) {
        const domBook = parseOrderBookFromDOM();
        const asks = (domBook?.asks && domBook.asks.length > 0) ? domBook.asks : STATE.orderBook.asks;
        const bids = (domBook?.bids && domBook.bids.length > 0) ? domBook.bids : STATE.orderBook.bids;

        const decision = calculateTradeDecision(modalState, asks, bids, historyInfo, itemId);

        let statusColor = "#60a5fa";
        if (decision.status === "INSTANT_FILL") statusColor = "#10b981";
        else if (decision.status === "TOP_MAKER") statusColor = "#f59e0b";
        else if (decision.etaHours > 24) statusColor = "#ef4444";

        const isBuy = modalState.isBuy;
        const instantBtnLabel = isBuy ? "⚡ 填入吃單價 (直接買入)" : "⚡ 填入吃單價 (直接賣出)";
        const makerBtnLabel = isBuy ? "🎯 填入首檔搶先價 (買單第1檔)" : "🎯 填入首檔搶先價 (賣單第1檔)";

        container.innerHTML = `
            <div class="mwi-adv-calc-box">
                <div class="mwi-adv-calc-head">
                    <span>📊 掛單時間與收益實時試算 (${isBuy ? '購買掛單' : '出售掛單'})</span>
                    <span class="mwi-adv-tax-pill">${isBuy ? '買方免稅 (0%)' : `賣方交易稅 ${(decision.taxRate * 100).toFixed(0)}%`}</span>
                </div>
                <div class="mwi-adv-calc-grid">
                    <div>隊列位置: <b style="color: ${statusColor}">${decision.tierText}</b></div>
                    <div>排隊深度: <b>${formatNumber(decision.aheadCount)}</b> 件</div>
                    <div>預計耗時: <b style="color: ${statusColor}">${formatTime(decision.etaHours)}</b></div>
                    <div>${isBuy ? '比吃單省下' : '比吃單多賺'}: <b title="${decision.diffTotal.toLocaleString()} G">${decision.diffTotal > 0 ? '+' : ''}${formatPrice(decision.diffTotal)}</b></div>
                </div>
                <div class="mwi-adv-tick-info">
                    <span>當前檔位增量 (Tick): <b title="${decision.currentTick.toLocaleString()} G">${formatPrice(decision.currentTick)}</b></span>
                    <span>全服日均: <b>${historyInfo?.dailyAvg >= 10 ? formatNumber(historyInfo.dailyAvg) : historyInfo?.dailyAvg.toFixed(1)}/天</b></span>
                </div>
                ${decision.status === "QUEUE" ? `
                    <div class="mwi-adv-wage-line">
                        折合等待時薪: <b style="color: ${decision.wagePerHour < 50000 ? '#ef4444' : '#10b981'}" title="${Math.round(decision.wagePerHour).toLocaleString()} G/hr">${formatPrice(decision.wagePerHour)}/hr</b>
                        ${decision.wagePerHour < 50000 && decision.etaHours > 3 ? '<span class="mwi-adv-warn-text">(時薪過低，排隊不划算)</span>' : ''}
                    </div>
                ` : ''}
                <div class="mwi-adv-rec-line">
                    ${decision.advice}
                </div>
                <div class="mwi-adv-quick-actions">
                    ${decision.instantPrice ? `
                        <button type="button" class="mwi-adv-quick-btn instant" data-price="${decision.instantPrice}">
                            ${instantBtnLabel} (${formatPrice(decision.instantPrice)})
                        </button>
                    ` : ''}
                    ${decision.topMakerPrice ? `
                        <button type="button" class="mwi-adv-quick-btn maker" data-price="${decision.topMakerPrice}">
                            ${makerBtnLabel} (${formatPrice(decision.topMakerPrice)})
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        container.querySelectorAll(".mwi-adv-quick-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetPrice = btn.getAttribute("data-price");
                if (targetPrice) {
                    setModalPrice(modal, targetPrice);
                }
            });
        });
    }

    // ── 14. 注入 UI 樣式 ──────────────────────────────────
    function injectStyles() {
        const style = document.createElement("style");
        style.textContent = `
            .mwi-advisor-top-banner {
                margin: 4px 0 6px 0;
                padding: 5px 10px;
                background: #0f111a;
                border: 1px solid #1e2235;
                border-radius: 6px;
                font-size: 11px;
                color: #e2e8f0;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            }
            .mwi-adv-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            .mwi-adv-title {
                font-weight: 700;
                font-size: 12px;
                color: #f8fafc;
                display: flex;
                align-items: center;
                gap: 6px;
                white-space: nowrap;
            }
            .mwi-adv-level-badge {
                padding: 1px 5px;
                background: #8b5cf6;
                color: #ffffff;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 700;
            }
            .mwi-adv-tax-badge {
                padding: 1px 5px;
                background: #3b82f6;
                color: #ffffff;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 600;
            }
            .mwi-adv-metrics {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
            }
            .mwi-adv-tag {
                padding: 2px 7px;
                background: #1a1d2e;
                border: 1px solid #2d3748;
                border-radius: 4px;
                font-size: 11px;
                white-space: nowrap;
            }
            .mwi-adv-toggle-btn {
                padding: 2px 8px;
                background: #1e293b;
                border: 1px solid #3b82f6;
                border-radius: 4px;
                color: #60a5fa;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                white-space: nowrap;
            }
            .mwi-adv-toggle-btn:hover {
                background: #2563eb;
                color: #ffffff;
                border-color: #60a5fa;
            }
            .mwi-adv-burst-pill {
                padding: 3px 8px;
                background: rgba(14, 165, 233, 0.12);
                border: 1px solid rgba(14, 165, 233, 0.3);
                border-radius: 4px;
                font-size: 11px;
                color: #38bdf8;
                margin-top: 6px;
            }
            .mwi-adv-gear-pill {
                padding: 3px 8px;
                background: rgba(245, 158, 11, 0.12);
                border: 1px solid rgba(245, 158, 11, 0.3);
                border-radius: 4px;
                font-size: 11px;
                color: #fcd34d;
                margin-top: 6px;
            }
            .mwi-adv-rec-box {
                padding: 6px 10px;
                border-radius: 6px;
                border: 1px solid;
                font-weight: 500;
                line-height: 1.3;
            }
            .mwi-adv-row-badge {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                margin-left: 4px;
                font-size: 10px;
                font-weight: 600;
                opacity: 0.9;
                white-space: nowrap;
                line-height: 1.1;
            }
            .mwi-adv-eta-text {
                display: inline-block;
            }
            .mwi-adv-my-order-highlight {
                background: rgba(245, 158, 11, 0.12) !important;
                border-left: 3px solid #f59e0b !important;
            }
            .mwi-adv-my-tag {
                display: inline-block;
                padding: 1px 4px;
                margin-right: 4px;
                background: #f59e0b;
                color: #000;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 700;
            }
            .mwi-adv-modal-calc {
                margin-top: 8px;
                margin-bottom: 8px;
            }
            .mwi-adv-calc-box {
                padding: 8px 10px;
                background: #0f111a;
                border: 1px solid #2d3748;
                border-radius: 6px;
                font-size: 12px;
            }
            .mwi-adv-calc-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: 700;
                color: #cbd5e1;
                margin-bottom: 6px;
                border-bottom: 1px solid #1e2235;
                padding-bottom: 4px;
            }
            .mwi-adv-tax-pill {
                font-size: 10px;
                font-weight: 600;
                padding: 2px 6px;
                border-radius: 4px;
                background: rgba(59, 130, 246, 0.2);
                border: 1px solid #3b82f6;
                color: #93c5fd;
            }
            .mwi-adv-calc-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 4px 10px;
                color: #94a3b8;
            }
            .mwi-adv-calc-grid b {
                color: #f1f5f9;
            }
            .mwi-adv-tick-info {
                display: flex;
                justify-content: space-between;
                margin-top: 5px;
                font-size: 11px;
                color: #64748b;
            }
            .mwi-adv-tick-info b {
                color: #cbd5e1;
            }
            .mwi-adv-wage-line {
                margin-top: 6px;
                padding-top: 5px;
                border-top: 1px dashed #1e2235;
                font-size: 11px;
                color: #94a3b8;
            }
            .mwi-adv-warn-text {
                color: #ef4444;
                margin-left: 6px;
                font-weight: 600;
            }
            .mwi-adv-rec-line {
                margin-top: 6px;
                font-size: 11px;
                line-height: 1.35;
                padding: 4px 8px;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.04);
            }
            .mwi-adv-quick-actions {
                display: flex;
                gap: 8px;
                margin-top: 8px;
            }
            .mwi-adv-quick-btn {
                flex: 1;
                padding: 6px 10px;
                border: none;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }
            .mwi-adv-quick-btn:hover {
                filter: brightness(1.15);
                transform: translateY(-1px);
            }
            .mwi-adv-quick-btn:active {
                transform: translateY(0);
            }
            .mwi-adv-quick-btn.instant {
                background: #10b981;
                color: #ffffff;
            }
            .mwi-adv-quick-btn.maker {
                background: #3b82f6;
                color: #ffffff;
            }

            /* 買賣家雙向速查決策卡 */
            .mwi-adv-decision-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin-top: 8px;
            }
            .mwi-adv-side-card {
                padding: 8px 10px;
                border-radius: 6px;
                background: #141824;
                border: 1px solid #23293d;
            }
            .mwi-adv-side-card.buyer {
                border-left: 3px solid #10b981;
            }
            .mwi-adv-side-card.seller {
                border-left: 3px solid #f59e0b;
            }
            .mwi-adv-side-title {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: 700;
                font-size: 11px;
                margin-bottom: 4px;
            }
            .mwi-adv-side-title .buy { color: #34d399; }
            .mwi-adv-side-title .sell { color: #fbbf24; }
            .mwi-adv-side-badge {
                font-size: 10px;
                padding: 1px 4px;
                border-radius: 3px;
                font-weight: 700;
            }
            .mwi-adv-side-badge.buy {
                background: rgba(16, 185, 129, 0.2);
                color: #34d399;
                border: 1px solid #10b981;
            }
            .mwi-adv-side-badge.sell {
                background: rgba(245, 158, 11, 0.2);
                color: #fbbf24;
                border: 1px solid #f59e0b;
            }
            .mwi-adv-rec-price-row {
                display: flex;
                align-items: baseline;
                gap: 6px;
                margin-bottom: 3px;
            }
            .mwi-adv-price.buy { color: #10b981; font-weight: 800; font-size: 13px; }
            .mwi-adv-price.sell { color: #f59e0b; font-weight: 800; font-size: 13px; }
            .mwi-adv-saving {
                font-size: 10px;
                color: #94a3b8;
            }
            .mwi-adv-desc-row {
                font-size: 10px;
                color: #cbd5e1;
                margin-bottom: 2px;
            }
            .mwi-adv-alt-row {
                font-size: 10px;
                color: #64748b;
                border-top: 1px dashed #23293d;
                padding-top: 3px;
                margin-top: 3px;
            }
            .mwi-adv-mm-bar {
                margin-top: 6px;
                padding: 3px 6px;
                background: rgba(255, 255, 255, 0.03);
                border-radius: 4px;
                font-size: 10px;
                text-align: center;
            }

            /* 斷檔幅度指示條 (Spread Gap Bridge Bar) */
            .mwi-adv-spread-bridge-bar {
                margin: 3px 0 5px 0;
                padding: 4px 8px;
                background: #111420;
                border: 1px solid #1f2538;
                border-radius: 5px;
                font-size: 11px;
            }
            .mwi-adv-bridge-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 3px;
            }
            .mwi-adv-bridge-status {
                padding: 1px 5px;
                border-radius: 3px;
                font-weight: 700;
                font-size: 10px;
            }
            .mwi-adv-bridge-status.wide {
                background: rgba(245, 158, 11, 0.2);
                color: #fcd34d;
                border: 1px solid rgba(245, 158, 11, 0.4);
            }
            .mwi-adv-bridge-status.medium {
                background: rgba(59, 130, 246, 0.2);
                color: #93c5fd;
                border: 1px solid rgba(59, 130, 246, 0.4);
            }
            .mwi-adv-bridge-status.tight {
                background: rgba(16, 185, 129, 0.15);
                color: #6ee7b7;
                border: 1px solid rgba(16, 185, 129, 0.3);
            }
            .mwi-adv-bridge-gap-info {
                font-size: 10px;
            }
            .mwi-adv-bridge-ruler {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 6px;
                background: #090b12;
                padding: 3px 6px;
                border-radius: 4px;
                border: 1px solid #1a1e2d;
            }
            .mwi-adv-ruler-anchor {
                display: flex;
                flex-direction: column;
                font-weight: 700;
                font-size: 10px;
            }
            .mwi-adv-ruler-anchor.bid { align-items: flex-start; color: #34d399; }
            .mwi-adv-ruler-anchor.ask { align-items: flex-end; color: #f87171; }
            .mwi-adv-ruler-track {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                overflow-x: auto;
            }
            .mwi-adv-tick-node {
                padding: 2px 5px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 600;
            }
            .mwi-adv-tick-node.buy-snip {
                background: rgba(16, 185, 129, 0.25);
                color: #34d399;
                border: 1px solid #10b981;
            }
            .mwi-adv-tick-node.sell-snip {
                background: rgba(245, 158, 11, 0.25);
                color: #fbbf24;
                border: 1px solid #f59e0b;
            }
            .mwi-adv-tick-node.dual-snip {
                background: linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(59, 130, 246, 0.3) 100%);
                color: #38bdf8;
                border: 1px solid #38bdf8;
                font-weight: 700;
            }
            .mwi-adv-tick-node.empty {
                background: rgba(255, 255, 255, 0.04);
                color: #64748b;
                border: 1px dashed #334155;
            }
            .mwi-adv-tick-line {
                width: 8px;
                height: 1px;
                background: #334155;
            }
            .mwi-adv-ruler-tight {
                color: #64748b;
                font-size: 10px;
            }
            .mwi-adv-snip-tag {
                color: #38bdf8;
                font-size: 10px;
                font-weight: 700;
                background: rgba(56, 189, 248, 0.15);
                border: 1px solid rgba(56, 189, 248, 0.4);
                padding: 1px 4px;
                border-radius: 3px;
                margin-left: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    // ── 15. 初始化啟動 ────────────────────────────────────
    function init() {
        injectStyles();
        setupWSInterceptor();
        setupModalObserver();
        fetchMarketPrices();

        setInterval(() => {
            const marketPanel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
            if (marketPanel && marketPanel.offsetParent !== null) {
                if (isOrderBookView(marketPanel)) {
                    renderAdvisorOverlay();
                } else {
                    cleanupAdvisorOverlay(marketPanel);
                }
            } else {
                cleanupAdvisorOverlay(document);
            }
        }, 800);

        setInterval(fetchMarketPrices, CONFIG.CACHE_TTL_MS);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
