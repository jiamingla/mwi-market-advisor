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
    formatTime,
    calculateTradeDecision
};
