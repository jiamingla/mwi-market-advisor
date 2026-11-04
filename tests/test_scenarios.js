// MWI 交易決策顧問 (Market Trade Advisor) 全場景自動化測試套件
const assert = require("assert");
const {
    CONFIG,
    binGap,
    getBinnedPrice,
    getNextBinnedPrice,
    getPrevBinnedPrice,
    getItemTaxRate,
    computeSellerNetPerItem,
    formatNumber,
    formatTime,
    calculateTradeDecision,
    isMarketplaceOrderModal,
    calculateSpreadGap
} = require("./advisorEngine");

let passed = 0;
let failed = 0;

function it(name, fn) {
    try {
        fn();
        console.log(`  ✅ [PASS] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
        failed++;
    }
}

function describe(title, fn) {
    console.log(`\n📋 ${title}`);
    fn();
}

console.log("==================================================");
console.log("🚀 MWI 交易決策顧問 全情境自動化單元測試啟動");
console.log("==================================================");

// ────────────────────────────────────────────────────────
describe("情境 1：官方 BinGap 價格階梯與檔位吸附 (Tick Size Engine)", () => {
    it("1.1 價格 <= 99 時，檔位增量固定為 1", () => {
        assert.strictEqual(binGap(1, 0), 1);
        assert.strictEqual(binGap(50, 0), 1);
        assert.strictEqual(binGap(99, 0), 1);
    });

    it("1.2 價格 100~999 (未強化) 依首位數字分別為 1, 2, 4", () => {
        assert.strictEqual(binGap(150, 0), 1); // 首位 <= 3 -> 1
        assert.strictEqual(binGap(350, 0), 1); // 首位 <= 3 -> 1
        assert.strictEqual(binGap(500, 0), 2); // 首位 <= 7 -> 2
        assert.strictEqual(binGap(750, 0), 2); // 首位 <= 7 -> 2
        assert.strictEqual(binGap(850, 0), 4); // 其餘 -> 4
    });

    it("1.3 價格 >= 1000 查表跳檔 (如 4,784 增量為 16, 4,800 增量為 20)", () => {
        assert.strictEqual(binGap(4784, 0), 16);
        assert.strictEqual(binGap(4800, 0), 20);
        assert.strictEqual(binGap(10000, 0), 40);
        assert.strictEqual(binGap(25000, 0), 100);
    });

    it("1.4 強化裝備 (+1 ~ +20) 檔位增量自動套用 x5 乘數", () => {
        // 4800 未強化為 20，強化後為 100
        assert.strictEqual(binGap(4800, 5), 100);
        assert.strictEqual(binGap(4800, 7), 100);
        // 15000 未強化為 60，強化後為 300
        assert.strictEqual(binGap(15000, 7), 300);
    });

    it("1.5 首檔搶先價精準跳檔 (Next / Prev Tick)", () => {
        // 在 4,784 基礎上加 1 檔，應精確跳至 4,800
        assert.strictEqual(getNextBinnedPrice(4784, 0), 4800);
        // 在 4,800 基礎上加 1 檔，應精確跳至 4,820
        assert.strictEqual(getNextBinnedPrice(4800, 0), 4820);
        // 在 4,800 基礎上減 1 檔，應精確退回 4,784
        assert.strictEqual(getPrevBinnedPrice(4800, 0), 4784);
        // 在 5,000 賣價基礎上搶先減 1 檔 (增量 20)，應降至 4,980
        assert.strictEqual(getPrevBinnedPrice(5000, 0), 4980);
    });
});

// ────────────────────────────────────────────────────────
describe("情境 2：2026 官方交易稅結算 (4% 基準 / 牛鈴 18% / 寶箱金幣免稅)", () => {
    it("2.1 一般耗材與裝備套用基準稅率 4% (賣方承擔)", () => {
        assert.strictEqual(getItemTaxRate("/items/ranged_coffee"), 0.04);
        assert.strictEqual(getItemTaxRate("/items/black_tea_leaf"), 0.04);
        assert.strictEqual(getItemTaxRate("/items/centaur_bow"), 0.04);
    });

    it("2.2 牛鈴與牛鈴袋套用專屬 18% 交易稅", () => {
        assert.strictEqual(getItemTaxRate("/items/cowbell"), 0.18);
        assert.strictEqual(getItemTaxRate("/items/bag_of_10_cowbells"), 0.18);
    });

    it("2.3 寶箱與金幣 0% 交易稅免稅", () => {
        assert.strictEqual(getItemTaxRate("/items/small_treasure_chest"), 0);
        assert.strictEqual(getItemTaxRate("/items/large_treasure_chest"), 0);
        assert.strictEqual(getItemTaxRate("/items/coin"), 0);
    });

    it("2.4 賣方實得金幣單件向下取整 (Math.floor)", () => {
        // 4784 * 0.96 = 4592.64 -> Math.floor = 4592
        assert.strictEqual(computeSellerNetPerItem(4784, 0.04), 4592);
        // 4800 * 0.96 = 4608
        assert.strictEqual(computeSellerNetPerItem(4800, 0.04), 4608);
        // 牛鈴袋 500000 * (1 - 0.18) = 410000
        assert.strictEqual(computeSellerNetPerItem(500000, 0.18), 410000);
    });
});

// ────────────────────────────────────────────────────────
describe("情境 3：大宗高頻流通耗材交易 (弓手咖啡 / 空間漿果 / 茶葉)", () => {
    const coffeeHistory = { dailyAvg: 73661, maxBurst: 350000, burstDays: "3.3", isBurstItem: true, isLowLiquidityGear: false };
    const asks = [
        { price: 2232, count: 8800 },
        { price: 2248, count: 7844 }
    ];
    const bids = [
        { price: 2184, count: 93016 },
        { price: 2176, count: 4469 }
    ];

    it("3.1 購買掛牌 - 出價 >= 最低賣價 (2232) -> 即時吃單 (0 秒，0% 買方稅)", () => {
        const modalState = {
            modalType: "BUY",
            isBuy: true,
            enhancementLevel: 0,
            currentPrice: 2232,
            currentQty: 1000,
            bandMin: 1984,
            bandMax: 2480
        };
        const decision = calculateTradeDecision(modalState, asks, bids, coffeeHistory, "/items/ranged_coffee");
        assert.strictEqual(decision.status, "INSTANT_FILL");
        assert.strictEqual(decision.etaHours, 0);
        assert.strictEqual(decision.aheadCount, 0);
        assert.strictEqual(decision.taxRate, 0.04);
    });

    it("3.2 購買掛牌 - 出價 2200 (> 2184 最高買價) -> 成功搶佔第 1 檔買單 (排隊 0 件)", () => {
        const modalState = {
            modalType: "BUY",
            isBuy: true,
            enhancementLevel: 0,
            currentPrice: 2200,
            currentQty: 1000,
            bandMin: 1984,
            bandMax: 2480
        };
        const decision = calculateTradeDecision(modalState, asks, bids, coffeeHistory, "/items/ranged_coffee");
        assert.strictEqual(decision.status, "TOP_MAKER");
        assert.strictEqual(decision.aheadCount, 0);
        // 比吃單 2232 省下: (2232 - 2200) * 1000 = 32,000 G
        assert.strictEqual(decision.diffTotal, 32000);
        // 1000 件以 3069/hr 流速需約 0.32 小時
        assert(decision.etaHours > 0.2 && decision.etaHours < 0.5);
    });

    it("3.3 購買掛牌 - 出價 2176 (同等或低於最高買價) -> FIFO 隊列累積排在 97,485 件之後", () => {
        const modalState = {
            modalType: "BUY",
            isBuy: true,
            enhancementLevel: 0,
            currentPrice: 2176,
            currentQty: 1000,
            bandMin: 1984,
            bandMax: 2480
        };
        const decision = calculateTradeDecision(modalState, asks, bids, coffeeHistory, "/items/ranged_coffee");
        assert.strictEqual(decision.status, "QUEUE");
        assert(decision.tierText.includes("第 2 檔"));
        // FIFO 原則：排在 2184 (93016件) + 現有 2176 (4469件) 之後 = 97485 件
        assert.strictEqual(decision.aheadCount, 97485);
        // 需等待前排 97.5K 件清空，耗時約 90 小時 (~3.8天)
        assert(decision.etaHours > 80);
    });

    it("3.4 出售掛牌 - 賣價 <= 2184 -> 即時吃單賣出 (0 秒，扣除 4% 交易稅)", () => {
        const modalState = {
            modalType: "SELL",
            isBuy: false,
            enhancementLevel: 0,
            currentPrice: 2184,
            currentQty: 500,
            bandMin: 1984,
            bandMax: 2480
        };
        const decision = calculateTradeDecision(modalState, asks, bids, coffeeHistory, "/items/ranged_coffee");
        assert.strictEqual(decision.status, "INSTANT_FILL");
        assert.strictEqual(decision.etaHours, 0);
    });

    it("3.5 出售掛牌 - 賣價 2216 (< 2232 最低賣價) -> 搶排第 1 檔賣單 (排隊 0 件)", () => {
        const modalState = {
            modalType: "SELL",
            isBuy: false,
            enhancementLevel: 0,
            currentPrice: 2216,
            currentQty: 500,
            bandMin: 1984,
            bandMax: 2480
        };
        const decision = calculateTradeDecision(modalState, asks, bids, coffeeHistory, "/items/ranged_coffee");
        assert.strictEqual(decision.status, "TOP_MAKER");
        assert.strictEqual(decision.aheadCount, 0);
        // 2216 稅後每件 2127G vs 吃單 2184 稅後 2096G -> 每件多賺 31G -> 500件多賺 15,500G
        assert(decision.diffTotal > 15000);
    });
});

// ────────────────────────────────────────────────────────
describe("情境 4：低流通度強化裝備真實交易模型 (+5 / +7 / +10 武器防具)", () => {
    const gearAsks = [{ price: 20000000, count: 1 }];
    const gearBids = [{ price: 15000000, count: 1 }];

    it("4.1 +5 裝備全服日均約 1.2 件 -> 1件首檔賣單需約 20 小時，絕非 < 2 分鐘", () => {
        const historyPlus5 = { dailyAvg: 1.2, isLowLiquidityGear: true };
        const modalState = {
            modalType: "SELL",
            isBuy: false,
            enhancementLevel: 5,
            currentPrice: 19000000,
            currentQty: 1,
            bandMin: 10000000,
            bandMax: 30000000
        };
        const decision = calculateTradeDecision(modalState, gearAsks, gearBids, historyPlus5, "/items/arcane_bow");
        assert.strictEqual(decision.status, "TOP_MAKER");
        // 1 / (1.2 / 24) = 20 小時
        assert(decision.etaHours >= 15 && decision.etaHours <= 25);
        assert.strictEqual(formatTime(decision.etaHours), "~20.0 小時");
    });

    it("4.2 +7 裝備全服日均約 0.5 件 -> 1件首檔賣單需約 2 天 (48 小時)", () => {
        const historyPlus7 = { dailyAvg: 0.5, isLowLiquidityGear: true };
        const modalState = {
            modalType: "SELL",
            isBuy: false,
            enhancementLevel: 7,
            currentPrice: 19000000,
            currentQty: 1,
            bandMin: 10000000,
            bandMax: 30000000
        };
        const decision = calculateTradeDecision(modalState, gearAsks, gearBids, historyPlus7, "/items/arcane_bow");
        assert.strictEqual(decision.status, "TOP_MAKER");
        // 1 / (0.5 / 24) = 48 小時 = 2.0 天
        assert.strictEqual(decision.etaHours, 48);
        assert.strictEqual(formatTime(decision.etaHours), "~2.0 天");
    });

    it("4.3 +10 頂級裝備全服日均約 0.15 件 -> 首檔賣單需約 6.7 天", () => {
        const historyPlus10 = { dailyAvg: 0.15, isLowLiquidityGear: true };
        const modalState = {
            modalType: "SELL",
            isBuy: false,
            enhancementLevel: 10,
            currentPrice: 19000000, // 低於 20M，成為 TOP_MAKER
            currentQty: 1,
            bandMin: 10000000,
            bandMax: 900000000
        };
        const decision = calculateTradeDecision(modalState, gearAsks, gearBids, historyPlus10, "/items/arcane_bow");
        assert.strictEqual(decision.status, "TOP_MAKER");
        // 1 / (0.15 / 24) = 160 小時 = 6.67 天
        assert(decision.etaHours > 150 && decision.etaHours < 170);
        assert.strictEqual(formatTime(decision.etaHours), "~6.7 天");
    });

    it("4.4 +10 頂級裝備定價過高落入隊列排隊 -> 受非首檔流速懲罰，需約 38 天並警告滯銷", () => {
        const historyPlus10 = { dailyAvg: 0.15, isLowLiquidityGear: true };
        const modalState = {
            modalType: "SELL",
            isBuy: false,
            enhancementLevel: 10,
            currentPrice: 500000000, // 500M 高於 20M，落入隊列第二檔
            currentQty: 1,
            bandMin: 10000000,
            bandMax: 900000000
        };
        const decision = calculateTradeDecision(modalState, gearAsks, gearBids, historyPlus10, "/items/arcane_bow");
        assert.strictEqual(decision.status, "QUEUE");
        // 2 / ((0.15 / 24) * 0.35) = 914 小時 = 38.1 天
        assert(decision.etaHours > 800);
        assert.strictEqual(formatTime(decision.etaHours), "~38 天 ⚠️");
    });
});

// ────────────────────────────────────────────────────────
describe("情境 5：可交易區間限制 (Trade Band Clamping)", () => {
    it("5.1 推薦搶首檔買價高於區間上限時，自動夾取在 bandMax", () => {
        const modalState = {
            modalType: "BUY",
            isBuy: true,
            enhancementLevel: 0,
            currentPrice: 2400,
            currentQty: 10,
            bandMin: 2000,
            bandMax: 2450 // 上限 2450
        };
        const asks = [{ price: 2500, count: 10 }];
        const bids = [{ price: 2440, count: 10 }];
        const decision = calculateTradeDecision(modalState, asks, bids, { dailyAvg: 5000 }, "/items/test_item");
        assert(decision.topMakerPrice <= 2450);
    });

    it("5.2 推薦搶首檔賣價低於區間下限時，自動夾取在 bandMin", () => {
        const modalState = {
            modalType: "SELL",
            isBuy: false,
            enhancementLevel: 0,
            currentPrice: 2100,
            currentQty: 10,
            bandMin: 2050, // 下限 2050
            bandMax: 2500
        };
        const asks = [{ price: 2060, count: 10 }];
        const bids = [{ price: 1900, count: 10 }];
        const decision = calculateTradeDecision(modalState, asks, bids, { dailyAvg: 5000 }, "/items/test_item");
        assert(decision.topMakerPrice >= 2050);
    });
});

// ────────────────────────────────────────────────────────
describe("情境 6：時間與排隊時薪防禦格式化", () => {
    it("6.1 時間格式化梯度完整驗證", () => {
        assert.strictEqual(formatTime(0), "⚡ 立即成交 (0 秒)");
        assert.strictEqual(formatTime(0.02), "< 2 分鐘");
        assert.strictEqual(formatTime(0.5), "~30 分鐘");
        assert.strictEqual(formatTime(15.5), "~15.5 小時");
        assert.strictEqual(formatTime(48), "~2.0 天");
        assert.strictEqual(formatTime(9000), "> 1 年 ⚠️");
    });

    it("6.2 數字格式化完整驗證 (K, M, B)", () => {
        assert.strictEqual(formatNumber(0), "0");
        assert.strictEqual(formatNumber(1.2), "1.2");
        assert.strictEqual(formatNumber(950), "950");
        assert.strictEqual(formatNumber(8800), "8.8K");
        assert.strictEqual(formatNumber(2170000), "2.17M");
        assert.strictEqual(formatNumber(3500000000), "3.50B");
    });
});

// ────────────────────────────────────────────────────────
describe("情境 7：掛單彈窗嚴格識別與隔離防護 (防止污染木工/製作/非市場彈窗)", () => {
    it("7.1 工藝/製作木板彈窗 (CraftingPanel_modalContent) 應判定為 false", () => {
        const craftingModal = {
            matches: sel => sel.includes("Modal_modal"),
            querySelector: sel => {
                if (sel.includes("Modal_header")) return { textContent: "製作木板" };
                return null;
            },
            closest: () => null,
            textContent: "製作木板 樺木木板 製作次數: 10"
        };
        assert.strictEqual(isMarketplaceOrderModal(craftingModal), false);
    });

    it("7.2 物品詳情/背包彈窗 (ItemDetails) 應判定為 false", () => {
        const itemModal = {
            matches: sel => sel.includes("Modal_modal"),
            querySelector: sel => {
                if (sel.includes("Modal_header")) return { textContent: "雪松木板" };
                return null;
            },
            closest: () => null,
            textContent: "雪松木板 - 高級木材，用於製作工具與裝備。"
        };
        assert.strictEqual(isMarketplaceOrderModal(itemModal), false);
    });

    it("7.3 市場購買掛牌彈窗 (包含價格輸入與購買標題) 應判定為 true", () => {
        const marketBuyModal = {
            matches: sel => sel.includes("MarketplacePanel_modalContent"),
            querySelector: sel => {
                if (sel.includes("MarketplacePanel_header") || sel.includes("Modal_header")) return { textContent: "购买挂牌" };
                if (sel.includes("priceInputs")) return {};
                if (sel.includes("quantityInputs")) return {};
                return null;
            },
            closest: sel => sel.includes("MarketplacePanel_marketplacePanel") ? {} : null,
            textContent: "购买挂牌 可交易区间：4336 – 5300 价格: 4,800"
        };
        assert.strictEqual(isMarketplaceOrderModal(marketBuyModal), true);
    });

    it("7.4 市場出售掛牌彈窗 (包含數量輸入與可交易區間) 應判定為 true", () => {
        const marketSellModal = {
            matches: sel => sel.includes("Modal_modal"),
            querySelector: sel => {
                if (sel.includes("MarketplacePanel_header") || sel.includes("Modal_header")) return { textContent: "出售挂牌" };
                if (sel.includes("priceInputs")) return {};
                return null;
            },
            closest: sel => sel.includes("MarketplacePanel_marketplacePanel") ? {} : null,
            textContent: "出售挂牌 可交易区间：4336 – 5300 价格: 4,800"
        };
        assert.strictEqual(isMarketplaceOrderModal(marketSellModal), true);
    });
});

// ────────────────────────────────────────────────────────
describe("情境 8：盤口斷檔真空與做市插隊試算 (Spread Gap Engine)", () => {
    it("8.1 樺木原木 (62 vs 68): 精準計算 5 個真空檔位與做市空間", () => {
        const gap = calculateSpreadGap(68, 62, 0, "birch_log");
        assert.ok(gap !== null);
        assert.strictEqual(gap.spreadGold, 6);
        assert.strictEqual(gap.gapCount, 5); // 63, 64, 65, 66, 67
        assert.deepStrictEqual(gap.gapTicks, [63, 64, 65, 66, 67]);
        assert.strictEqual(gap.topMakerBid, 63); // 買方推薦插隊 63
        assert.strictEqual(gap.topMakerAsk, 67); // 賣方推薦插隊 67
        assert.strictEqual(gap.buySaving, 5);    // 比吃單 68 省 5G
        assert.strictEqual(gap.sellNetGain, 5);  // 比吃單 62 (稅後59) 多賺 5G (67稅後64)
        assert.strictEqual(gap.marketMakingProfit, 1); // 63 買 67 賣實收 64，淨賺 1G
    });

    it("8.2 普通原木 (24 vs 25): 相鄰檔位無斷檔，正確標示 0 檔真空", () => {
        const gap = calculateSpreadGap(25, 24, 0, "log");
        assert.ok(gap !== null);
        assert.strictEqual(gap.spreadGold, 1);
        assert.strictEqual(gap.gapCount, 0);
        assert.deepStrictEqual(gap.gapTicks, []);
        assert.strictEqual(gap.topMakerBid, 24);
        assert.strictEqual(gap.topMakerAsk, 25);
        assert.strictEqual(gap.buySaving, 1);        // 掛24買比吃單25少付1G
        assert.strictEqual(gap.sellNetGain, 1);       // 賣25實收24G vs 賣24實收23G，多賺1G
        assert.strictEqual(gap.marketMakingProfit, 0); // 24 買 25 賣實收 24，做市利潤 0
    });

    it("8.3 雪松原木 (385 vs 410): 25G 寬幅真空，做市利差可觀", () => {
        const gap = calculateSpreadGap(410, 385, 0, "cedar_log");
        assert.ok(gap !== null);
        assert.strictEqual(gap.spreadGold, 25);
        assert.ok(gap.gapCount >= 10);
        assert.strictEqual(gap.topMakerBid, 386);     // 385 (首位3) 檔位增量為1 -> 386
        assert.strictEqual(gap.topMakerAsk, 408);     // 410 (首位4) 檔位增量為2 -> 408
        assert.strictEqual(gap.buySaving, 410 - 386); // 省 24G
        assert.ok(gap.marketMakingProfit > 0);        // 做市具備充裕利潤
    });

    it("8.4 無效或倒掛盤口 (買價 >= 賣價) 返回 null", () => {
        assert.strictEqual(calculateSpreadGap(60, 60, 0, "birch_log"), null);
        assert.strictEqual(calculateSpreadGap(50, 60, 0, "birch_log"), null);
        assert.strictEqual(calculateSpreadGap(null, 60, 0, "birch_log"), null);
    });
});

console.log("==================================================");
console.log(`📊 測試執行結果: 通過 ${passed} 項，失敗 ${failed} 項`);
console.log("==================================================");

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
