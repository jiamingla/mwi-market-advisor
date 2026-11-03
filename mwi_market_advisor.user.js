// ==UserScript==
// @name         MWI 交易決策顧問 (Market Trade Advisor)
// @namespace    https://milkywayidle.com/
// @version      1.3.3
// @description  銀河奶牛放置 (Milky Way Idle) 市場掛單時間預估與智能交易顧問。修復物品識別作用域避免誤抓側邊欄裝備，修復日均流速與耗時預估 (>1年異常)，精準支援 4% 交易稅/牛鈴 18% 稅、官方 BinGap 檔位增量、+5/+7 強化裝備低流速模型、全場景自動化測試驗證。
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

    console.log("[MWI-Advisor] 交易決策顧問 v1.3.3 (全場景測試與規則對齊版) 啟動中...");

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

    // ── 8. 精準識別當前市場面板物品與強化等級 (嚴格隔離側邊欄) ─
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

        // 2. 次優先級：若處於彈窗中，從彈窗內的物品圖標與強化輸入框取得
        const modal = document.querySelector('[class*="MarketplacePanel_modalContent"], [class*="Modal_modal"]');
        if (modal) {
            if (!itemId) {
                const useEl = modal.querySelector('[class*="itemContainer"] svg use, [class*="Item_item"] svg use');
                if (useEl) {
                    const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href") || "";
                    if (href.includes("#") && !href.includes("coin")) {
                        itemId = href.split("#").pop();
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
                        itemId = href.split("#").pop();
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

    function parseOrderBookFromDOM() {
        const marketPanel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        if (!marketPanel) return null;

        const tables = marketPanel.querySelectorAll("table");
        if (tables.length < 2) return null;

        const askTable = tables[0]; // 左側出售列表 (Asks)
        const bidTable = tables[1]; // 右側收購列表 (Bids)

        const asks = [];
        const bids = [];

        askTable.querySelectorAll("tbody tr").forEach(tr => {
            const tds = tr.querySelectorAll("td");
            if (tds.length >= 2) {
                const count = parseQty(tds[0].textContent);
                const price = parseQty(tds[1].textContent);
                const isMine = tr.textContent.includes("取消") || tr.querySelector('button[class*="Button_danger"]') !== null;
                if (price > 0 && count > 0) {
                    asks.push({ price, count, isMine, trElement: tr });
                }
            }
        });

        bidTable.querySelectorAll("tbody tr").forEach(tr => {
            const tds = tr.querySelectorAll("td");
            if (tds.length >= 2) {
                const count = parseQty(tds[0].textContent);
                const price = parseQty(tds[1].textContent);
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
                    advice: `🟢 出價已達最低賣價 (${bestAsk}G)，送出後將「立刻成交」，耗時 0 秒！`,
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
                    advice: `🟡 成功搶佔買單第 1 順位 (出價 ${price}G)！比直接以 ${bestAsk || '--'}G 吃單共省下 ${formatNumber(diffVsInstant)}G。`,
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
                advice: `🔴 前方有 ${formatNumber(aheadCount)} 件出價更高的買單排隊！建議提價至 ${topMakerPrice}G 搶排首檔。`,
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
                advice: `🟢 賣價已達最高收購價 (${bestBid}G)，送出後將「立刻成交」換得金幣！`,
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
                advice: `🟡 成功搶佔賣單第 1 順位 (定價 ${price}G，稅後實得 ${netAtUserPrice}G/件)！比直接吃單每件多賺 ${netAtUserPrice - netAtInstant}G。`,
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
            advice: `🔴 前方有 ${formatNumber(aheadCount)} 件更低價的賣單排隊！建議降價至 ${topMakerPrice}G 搶排首檔，避免滯銷。`,
            instantPrice,
            topMakerPrice,
            taxRate,
            currentTick
        };
    }

    // ── 12. 頂部決策看板與深度行標籤 ───────────────────────
    async function renderAdvisorOverlay() {
        const marketPanel = document.querySelector('[class*="MarketplacePanel_marketplacePanel"]');
        if (!marketPanel) return;

        const { itemId, enhancementLevel } = detectCurrentItemInfo();
        if (!itemId) return;

        const historyInfo = await fetchItemHistory(itemId, enhancementLevel);

        const domBook = parseOrderBookFromDOM();
        const asks = (domBook?.asks && domBook.asks.length > 0) ? domBook.asks : STATE.orderBook.asks;
        const bids = (domBook?.bids && domBook.bids.length > 0) ? domBook.bids : STATE.orderBook.bids;

        const bestAsk = asks.length ? asks[0].price : null;
        const bestBid = bids.length ? bids[0].price : null;

        injectTopAdvisorBanner(marketPanel, itemId, enhancementLevel, bestAsk, bestBid, historyInfo);
        decorateOrderRows(asks, bids, historyInfo, enhancementLevel);
    }

    function injectTopAdvisorBanner(panel, itemId, enhancementLevel, bestAsk, bestBid, historyInfo) {
        let banner = panel.querySelector(".mwi-advisor-top-banner");
        if (!banner) {
            banner = document.createElement("div");
            banner.className = "mwi-advisor-top-banner";
            const orderBooksContainer = panel.querySelector('[class*="MarketplacePanel_orderBooksContainer"]') ||
                                        panel.querySelector('[class*="MarketplacePanel_tablesContainer"]') ||
                                        panel.querySelector("table")?.closest("div");
            if (orderBooksContainer) {
                orderBooksContainer.parentElement.insertBefore(banner, orderBooksContainer);
            } else {
                panel.appendChild(banner);
            }
        }

        const spreadGold = (bestAsk && bestBid) ? (bestAsk - bestBid) : 0;
        const spreadPct = (bestAsk && bestBid && bestAsk > 0) ? ((spreadGold / bestAsk) * 100).toFixed(1) : 0;
        const taxRate = getItemTaxRate(itemId);
        const dailyAvg = (historyInfo && typeof historyInfo.dailyAvg === 'number') ? historyInfo.dailyAvg : 0;

        let burstCardHtml = "";
        if (historyInfo?.isBurstItem) {
            burstCardHtml = `
                <div class="mwi-adv-burst-pill">
                    <span>🐋 大單週期特性</span>: 
                    <b>平均每 ${historyInfo.burstDays || '3~4'} 天一次集中掃貨 (歷史單筆最高 ${formatNumber(historyInfo.maxBurst)} 件)</b>
                </div>
            `;
        } else if (historyInfo?.isLowLiquidityGear) {
            burstCardHtml = `
                <div class="mwi-adv-gear-pill">
                    <span>⏳ 低流速裝備特性</span>: 
                    <b>+${enhancementLevel} 級裝備全服日均成交僅約 ${dailyAvg.toFixed(1)} 件，掛單週期偏長，請謹慎評估排隊時薪！</b>
                </div>
            `;
        }

        let recText = "";
        let recStyle = "";
        if (historyInfo?.isLowLiquidityGear) {
            recText = `⚠️ 低流通度裝備：日均成交僅約 ${dailyAvg.toFixed(1)} 件。若排在第二檔之後容易長期滯銷，推薦直接吃單或掛在首檔耐心等待。`;
            recStyle = "background: rgba(245, 158, 11, 0.15); border-color: #f59e0b; color: #fcd34d;";
        } else if (historyInfo?.isBurstItem) {
            recText = "🌊 大單週期型商品：平時零星散買，但每隔數天有集中大掃貨，強烈建議掛在首檔阻力位等待！";
            recStyle = "background: rgba(59, 130, 246, 0.15); border-color: #3b82f6; color: #93c5fd;";
        } else if (spreadGold > 0 && (spreadGold / bestAsk) < 0.015) {
            recText = "🟢 建議直接結帳：買賣價差微薄且排隊冗長，直接吃單變現週轉更划算！";
            recStyle = "background: rgba(16, 185, 129, 0.15); border-color: #10b981; color: #6ee7b7;";
        } else if (spreadGold > 0 && (spreadGold / bestAsk) >= 0.03) {
            recText = "🟡 建議首檔掛單：盤口價差可觀，掛在首檔成交快，性價比高！";
            recStyle = "background: rgba(245, 158, 11, 0.15); border-color: #f59e0b; color: #fcd34d;";
        } else {
            recText = "💡 盤口價差適中。急需資金推薦直接結帳，追求最大利潤推薦掛首檔搶第一順位。";
            recStyle = "background: rgba(96, 165, 250, 0.15); border-color: #3b82f6; color: #93c5fd;";
        }

        banner.innerHTML = `
            <div class="mwi-adv-header">
                <div class="mwi-adv-title">
                    <span class="mwi-adv-logo">📊</span> 智慧交易決策顧問
                    ${enhancementLevel > 0 ? `<span class="mwi-adv-level-badge">+${enhancementLevel} 級</span>` : ''}
                    <span class="mwi-adv-tax-badge">交易稅 ${(taxRate * 100).toFixed(0)}%</span>
                </div>
                <div class="mwi-adv-metrics">
                    <span class="mwi-adv-tag">
                        盤口價差: <b>${bestBid || "--"}</b> ↔ <b>${bestAsk || "--"}</b> (差 <b>${spreadGold}G</b>, <b>${spreadPct}%</b>)
                    </span>
                    <span class="mwi-adv-tag" style="color: #38bdf8; border-color: #0284c7;">
                        全服日均: <b>${dailyAvg >= 10 ? formatNumber(dailyAvg) : dailyAvg.toFixed(1)}/天</b>
                    </span>
                </div>
            </div>
            ${burstCardHtml}
            <div class="mwi-adv-rec-box" style="${recStyle}">
                ${recText}
            </div>
        `;
    }

    function decorateOrderRows(asks, bids, historyInfo, enhancementLevel) {
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
            applyBadgeToRow(order.trElement, aheadAsk, etaHours, order.isMine);
            aheadAsk += order.count;
        });

        let aheadBid = 0;
        bids.forEach((order, idx) => {
            if (!order.trElement) return;
            const effectiveVol = idx === 0 ? blendedVol : (blendedVol * CONFIG.UNDERCUT_PENALTY_RATE);
            const etaHours = (aheadBid + order.count) / Math.max(0.001, effectiveVol);
            applyBadgeToRow(order.trElement, aheadBid, etaHours, order.isMine);
            aheadBid += order.count;
        });
    }

    function applyBadgeToRow(tr, aheadCount, etaHours, isMine) {
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
        badge.innerHTML = `[前排: ${formatNumber(aheadCount)} | ${formatTime(etaHours)}]`;

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
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node instanceof Element) {
                        const modal = node.matches?.('[class*="MarketplacePanel_modalContent"], [class*="Modal_modal"]')
                            ? node
                            : node.querySelector?.('[class*="MarketplacePanel_modalContent"], [class*="Modal_modal"]');
                        if (modal) {
                            setTimeout(() => attachModalCalculator(modal), 80);
                        }
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    async function attachModalCalculator(modal) {
        if (modal.querySelector(".mwi-adv-modal-calc")) return;

        const calcContainer = document.createElement("div");
        calcContainer.className = "mwi-adv-modal-calc";

        const priceInputsContainer = modal.querySelector('[class*="MarketplacePanel_priceInputs"], [class*="priceInputs"]');
        const targetParent = priceInputsContainer?.closest('[class*="inputContainer"]') || priceInputsContainer?.parentElement || modal;
        targetParent.after(calcContainer);

        const { itemId, enhancementLevel } = detectCurrentItemInfo();
        const historyInfo = await fetchItemHistory(itemId, enhancementLevel);

        const updateCalc = async () => {
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
                    <div>${isBuy ? '比吃單省下' : '比吃單多賺'}: <b>${decision.diffTotal > 0 ? '+' : ''}${formatNumber(decision.diffTotal)} G</b></div>
                </div>
                <div class="mwi-adv-tick-info">
                    <span>當前檔位增量 (Tick): <b>${decision.currentTick}G</b></span>
                    <span>全服日均: <b>${historyInfo?.dailyAvg >= 10 ? formatNumber(historyInfo.dailyAvg) : historyInfo?.dailyAvg.toFixed(1)}/天</b></span>
                </div>
                ${decision.status === "QUEUE" ? `
                    <div class="mwi-adv-wage-line">
                        折合等待時薪: <b style="color: ${decision.wagePerHour < 50000 ? '#ef4444' : '#10b981'}">${formatNumber(decision.wagePerHour)} G/hr</b>
                        ${decision.wagePerHour < 50000 && decision.etaHours > 3 ? '<span class="mwi-adv-warn-text">(時薪過低，排隊不划算)</span>' : ''}
                    </div>
                ` : ''}
                <div class="mwi-adv-rec-line">
                    ${decision.advice}
                </div>
                <div class="mwi-adv-quick-actions">
                    ${decision.instantPrice ? `
                        <button type="button" class="mwi-adv-quick-btn instant" data-price="${decision.instantPrice}">
                            ${instantBtnLabel} (${decision.instantPrice}G)
                        </button>
                    ` : ''}
                    ${decision.topMakerPrice ? `
                        <button type="button" class="mwi-adv-quick-btn maker" data-price="${decision.topMakerPrice}">
                            ${makerBtnLabel} (${decision.topMakerPrice}G)
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
                margin: 8px 0 12px 0;
                padding: 10px 14px;
                background: #0f111a;
                border: 1px solid #1e2235;
                border-radius: 8px;
                font-size: 12px;
                color: #e2e8f0;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
            }
            .mwi-adv-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }
            .mwi-adv-title {
                font-weight: 700;
                font-size: 13px;
                color: #f8fafc;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .mwi-adv-level-badge {
                padding: 1px 6px;
                background: #8b5cf6;
                color: #ffffff;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 700;
            }
            .mwi-adv-tax-badge {
                padding: 1px 6px;
                background: #3b82f6;
                color: #ffffff;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 600;
            }
            .mwi-adv-metrics {
                display: flex;
                gap: 8px;
            }
            .mwi-adv-tag {
                padding: 3px 8px;
                background: #1a1d2e;
                border: 1px solid #2d3748;
                border-radius: 4px;
                font-size: 11px;
            }
            .mwi-adv-burst-pill {
                padding: 4px 10px;
                background: rgba(14, 165, 233, 0.12);
                border: 1px solid rgba(14, 165, 233, 0.3);
                border-radius: 5px;
                font-size: 11px;
                color: #38bdf8;
                margin-bottom: 8px;
            }
            .mwi-adv-gear-pill {
                padding: 4px 10px;
                background: rgba(245, 158, 11, 0.12);
                border: 1px solid rgba(245, 158, 11, 0.3);
                border-radius: 5px;
                font-size: 11px;
                color: #fcd34d;
                margin-bottom: 8px;
            }
            .mwi-adv-rec-box {
                padding: 8px 12px;
                border-radius: 6px;
                border: 1px solid;
                font-weight: 500;
                line-height: 1.4;
            }
            .mwi-adv-row-badge {
                display: inline-block;
                margin-left: 8px;
                font-size: 11px;
                font-weight: 600;
                opacity: 0.85;
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
                margin-top: 10px;
                margin-bottom: 10px;
            }
            .mwi-adv-calc-box {
                padding: 10px 12px;
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
                margin-bottom: 8px;
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
                gap: 6px 12px;
                color: #94a3b8;
            }
            .mwi-adv-calc-grid b {
                color: #f1f5f9;
            }
            .mwi-adv-tick-info {
                display: flex;
                justify-content: space-between;
                margin-top: 6px;
                font-size: 11px;
                color: #64748b;
            }
            .mwi-adv-tick-info b {
                color: #cbd5e1;
            }
            .mwi-adv-wage-line {
                margin-top: 8px;
                padding-top: 6px;
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
                margin-top: 8px;
                font-size: 11px;
                line-height: 1.4;
                padding: 4px 8px;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.04);
            }
            .mwi-adv-quick-actions {
                display: flex;
                gap: 8px;
                margin-top: 10px;
            }
            .mwi-adv-quick-btn {
                flex: 1;
                padding: 7px 10px;
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
            if (marketPanel) {
                renderAdvisorOverlay();
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
