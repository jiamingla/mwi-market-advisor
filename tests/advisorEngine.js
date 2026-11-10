// 提取自 mwi_market_advisor.user.js 的核心計算與決策引擎 (用於單元測試與自動化驗證)

const CONFIG = {
    BASE_TAX_RATE: 0.04,          // 2026-09-28 官方調降：基準交易稅 4% (賣方承擔)
    COWBELL_TAX_RATE: 0.18,       // 牛鈴/牛鈴袋專屬稅率 18%
    UNDERCUT_PENALTY_RATE: 0.35,  // 非首檔掛單的流速衰減懲罰
};

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

function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return "0";
    if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(2) + "M";
    if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(1) + "K";
    if (num > 0 && num < 10) return num.toFixed(1);
    return Math.round(num).toLocaleString();
}

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

    // ── 購買掛牌 (BUY) ──
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

    // ── 出售掛牌 (SELL) ──
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

function isMarketplaceOrderModal(modal) {
    if (!modal) return false;
    const isMarketModalClass = (modal.matches && modal.matches('[class*="MarketplacePanel_modalContent"]')) ||
                               (modal.querySelector && modal.querySelector('[class*="MarketplacePanel_modalContent"]') !== null);
    const isInsideMarketPanel = (modal.closest && modal.closest('[class*="MarketplacePanel_marketplacePanel"]') !== null);
    const hasPriceInputs = modal.querySelector && modal.querySelector('[class*="MarketplacePanel_priceInputs"], [class*="priceInputs"]') !== null;
    const hasQtyInputs = modal.querySelector && modal.querySelector('[class*="MarketplacePanel_quantityInputs"], [class*="quantityInputs"]') !== null;
    const headerEl = modal.querySelector ? modal.querySelector('[class*="MarketplacePanel_header"], [class*="Modal_header"], h2, h3') : null;
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

// ── 判斷是否處於物品訂單簿視圖 (OrderBook View) ────────────────
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

// ── 清除一切殘留的顧問覆蓋元件 (速查卡、跨度條、行徽章) ───────
function cleanupAdvisorOverlay(scope = (typeof document !== 'undefined' ? document : null)) {
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll(".mwi-advisor-top-banner").forEach(el => el.remove());
    scope.querySelectorAll(".mwi-adv-spread-bridge-bar").forEach(el => el.remove());
    scope.querySelectorAll(".mwi-adv-row-badge").forEach(el => el.remove());
    scope.querySelectorAll(".mwi-adv-snip-tag").forEach(el => el.remove());
    scope.querySelectorAll(".mwi-adv-my-tag").forEach(el => el.remove());
    scope.querySelectorAll(".mwi-adv-my-order-highlight").forEach(el => el.classList?.remove("mwi-adv-my-order-highlight"));
}

// ── 盤口價差真空度與斷檔檔位試算 (Spread & Gap Engine) ───────
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

module.exports = {
    CONFIG,
    tightBinGapUnit,
    binGap,
    getBinnedPrice,
    getNextBinnedPrice,
    getPrevBinnedPrice,
    getItemTaxRate,
    computeSellerNetPerItem,
    formatNumber,
    formatPrice,
    formatTime,
    calculateTradeDecision,
    isMarketplaceOrderModal,
    isOrderBookView,
    cleanupAdvisorOverlay,
    calculateSpreadGap
};
