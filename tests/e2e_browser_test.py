import os
import sys
import time
sys.stdout.reconfigure(encoding='utf-8')

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

def run_e2e_test():
    print("=" * 60)
    print("🚀 MWI 交易決策顧問 全自動真實瀏覽器 E2E 測試啟動")
    print("=" * 60)

    fixtures_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "fixtures", "mwi_app.html"))
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "mwi_market_advisor.user.js"))
    screenshots_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "screenshots"))

    assert os.path.exists(fixtures_path), f"Fixture not found: {fixtures_path}"
    assert os.path.exists(script_path), f"Userscript not found: {script_path}"

    with open(script_path, "r", encoding="utf-8") as f:
        userscript_code = f.read()

    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--window-size=1400,900')
    options.add_argument('--disable-gpu')
    options.add_argument('--no-sandbox')
    options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
    
    driver = webdriver.Chrome(options=options)
    passed_tests = 0
    total_tests = 6

    try:
        # 1. 載入模擬遊戲 DOM
        fixture_url = "file:///" + fixtures_path.replace(os.sep, "/")
        print(f"\n[E2E-Init] 載入遊戲模擬環境: {fixture_url}")
        driver.get(fixture_url)
        time.sleep(1)

        # 2. 注入 Mock API (避免真實聯網 404 與延遲)
        mock_api_script = """
        window.__mockMarketData = {
            "birch_log": { "ask": 68, "bid": 62 }
        };
        const origFetch = window.fetch;
        window.fetch = async function(url, ...args) {
            if (url.includes('marketplace.json')) {
                return new Response(JSON.stringify(window.__mockMarketData), { status: 200, headers: {'Content-Type': 'application/json'} });
            }
            if (url.includes('items_')) {
                const mockHistory = [
                    { "date": "2026-11-03", "volume": 65000, "price": 4800 },
                    { "date": "2026-11-02", "volume": 72000, "price": 4780 }
                ];
                return new Response(JSON.stringify(mockHistory), { status: 200, headers: {'Content-Type': 'application/json'} });
            }
            return origFetch(url, ...args);
        };
        """
        driver.execute_script(mock_api_script)

        # 3. 注入 MWI 交易決策顧問油猴腳本 (完全同真實瀏覽器運行)
        print("[E2E-Init] 注入 MWI 交易決策顧問 (v1.3.6)...")
        driver.execute_script(userscript_code)
        time.sleep(1)

        # ───────────────────────────────────────────────────────────
        # 測試 1：進入木工製作面板，打開「製作樺木木板」彈窗
        # ───────────────────────────────────────────────────────────
        print("\n🧪 [測試 1/6] 木工技能：點擊「製作樺木木板」打開彈窗")
        btn_craft_birch = driver.find_element(By.ID, "btn-craft-birch")
        btn_craft_birch.click()
        time.sleep(0.5)

        calcs_step1 = driver.find_elements(By.CSS_SELECTOR, ".mwi-adv-modal-calc")
        banners_step1 = driver.find_elements(By.CSS_SELECTOR, ".mwi-advisor-top-banner")
        
        screenshot_step1 = os.path.join(screenshots_dir, "step1_crafting_first_plank.png")
        driver.save_screenshot(screenshot_step1)
        print(f"   📸 截圖保存: {screenshot_step1}")

        assert len(calcs_step1) == 0, f"異常：木工彈窗不應出現交易試算區塊，當前數量: {len(calcs_step1)}"
        assert len(banners_step1) == 0, f"異常：木工面板不應出現市場橫幅，當前數量: {len(banners_step1)}"
        print("   ✅ [PASS] 測試 1 通過：製作木板彈窗完全乾淨，未注入任何交易顧問區塊！")
        passed_tests += 1

        # ───────────────────────────────────────────────────────────
        # 測試 2：在彈窗中選擇「第二次木板（雪松木板）」(精確重現使用者遇到的 Bug 情境)
        # ───────────────────────────────────────────────────────────
        print("\n🧪 [測試 2/6] (核心重現) 在製作彈窗內切換「第二次木板（雪松木板）」")
        btn_select_second = driver.find_element(By.ID, "btn-select-second-plank")
        btn_select_second.click()
        time.sleep(0.5)

        # 驗證彈窗內容確實切換為雪松木板
        crafting_item_name = driver.find_element(By.ID, "crafting-item-name").text
        assert "雪松木板" in crafting_item_name, f"未成功切換至雪松木板: {crafting_item_name}"

        calcs_step2 = driver.find_elements(By.CSS_SELECTOR, ".mwi-adv-modal-calc")
        screenshot_step2 = os.path.join(screenshots_dir, "step2_crafting_second_plank_clean.png")
        driver.save_screenshot(screenshot_step2)
        print(f"   📸 截圖保存: {screenshot_step2}")

        assert len(calcs_step2) == 0, f"❌ 重大回歸：切換第二次木板時，多顯示了不想要的區塊 (.mwi-adv-modal-calc)! 數量: {len(calcs_step2)}"
        print("   ✅ [PASS] 測試 2 通過：切換第二次木板後，依然 100% 乾淨，徹底杜絕誤注入！")
        passed_tests += 1

        # 關閉工藝彈窗
        close_btn = driver.find_element(By.CSS_SELECTOR, ".close-btn")
        close_btn.click()
        time.sleep(0.3)

        # ───────────────────────────────────────────────────────────
        # 測試 3：切換到「市場交易」，驗證市場面板正常獲得增強 (橫幅與深度標籤)
        # ───────────────────────────────────────────────────────────
        print("\n🧪 [測試 3/6] 切換至「市場交易」面板")
        nav_market = driver.find_element(By.ID, "nav-marketplace")
        nav_market.click()
        
        # 輪詢等待定時器 renderAdvisorOverlay 觸發
        banners_step3 = []
        for _ in range(12):
            banners_step3 = driver.find_elements(By.CSS_SELECTOR, ".mwi-advisor-top-banner")
            if len(banners_step3) >= 1:
                break
            time.sleep(0.4)

        screenshot_step3 = os.path.join(screenshots_dir, "step3_marketplace_banner.png")
        driver.save_screenshot(screenshot_step3)
        print(f"   📸 截圖保存: {screenshot_step3}")

        assert len(banners_step3) >= 1, "市場面板頂部顧問橫幅未能正常注入！"
        banner_text = banners_step3[0].text
        assert "交易決策顧問" in banner_text or "智慧交易決策顧問" in banner_text, f"橫幅內容不正確: {banner_text}"

        # 驗證【買家 vs 賣家 雙向速查決策卡】正常渲染
        decision_cards = driver.find_elements(By.CSS_SELECTOR, ".mwi-adv-side-card")
        assert len(decision_cards) == 2, f"雙向速查決策卡數量異常: {len(decision_cards)}"
        buyer_card_text = decision_cards[0].text
        seller_card_text = decision_cards[1].text
        assert "買家" in buyer_card_text and "推薦買價" in buyer_card_text, f"買家決策卡內容缺失: {buyer_card_text}"
        assert "賣家" in seller_card_text and "推薦賣價" in seller_card_text, f"賣家決策卡內容缺失: {seller_card_text}"

        # 驗證【表格第一行斷檔跨度指示條】正常渲染
        bridge_bars = driver.find_elements(By.CSS_SELECTOR, ".mwi-adv-spread-bridge-bar")
        assert len(bridge_bars) >= 1, "盤口斷檔跨度指示條未能注入！"
        bridge_text = bridge_bars[0].text
        assert "斷檔真空" in bridge_text, f"斷檔跨度指示條未正確識別真空: {bridge_text}"

        print("   ✅ [PASS] 測試 3 通過：頂部買賣雙向速查卡與斷檔跨度指示條均精確渲染！")
        passed_tests += 1

        # ───────────────────────────────────────────────────────────
        # 測試 4 (重大回歸)：切換至「我的掛單 (My Listings)」，驗證速查卡與跨度條 100% 徹底清除
        # ───────────────────────────────────────────────────────────
        print("\n🧪 [測試 4/6] 核心回歸：切換至「我的掛單」，驗證絕不出現不該出現的速查卡")
        tab_my_listings = driver.find_element(By.ID, "tab-market-my-listings")
        tab_my_listings.click()
        time.sleep(1) # 等待 MutationObserver 與 setInterval 執行

        banners_my_listings = driver.find_elements(By.CSS_SELECTOR, ".mwi-advisor-top-banner")
        bridges_my_listings = driver.find_elements(By.CSS_SELECTOR, ".mwi-adv-spread-bridge-bar")
        cards_my_listings = driver.find_elements(By.CSS_SELECTOR, ".mwi-adv-side-card")

        screenshot_step4 = os.path.join(screenshots_dir, "step4_my_listings_clean.png")
        driver.save_screenshot(screenshot_step4)
        print(f"   📸 截圖保存: {screenshot_step4}")

        assert len(banners_my_listings) == 0, f"「我的掛單」中誤殘留/注入了速查卡頂部橫幅！數量: {len(banners_my_listings)}"
        assert len(bridges_my_listings) == 0, f"「我的掛單」中誤殘留/注入了斷檔跨度指示條！數量: {len(bridges_my_listings)}"
        assert len(cards_my_listings) == 0, f"「我的掛單」中誤殘留/注入了雙向速查決策卡！數量: {len(cards_my_listings)}"
        print("   ✅ [PASS] 測試 4 通過：「我的掛單」完全無速查卡與跨度條殘留，百分之百乾淨！")
        passed_tests += 1

        # 切回「市場行情」，驗證顧問覆蓋元件重新正常掛載
        tab_orderbook = driver.find_element(By.ID, "tab-market-orderbook")
        tab_orderbook.click()
        time.sleep(1)

        # ───────────────────────────────────────────────────────────
        # 測試 5：在市場點擊「購買掛牌」，驗證掛單彈窗正確注入試算器與一鍵填入功能
        # ───────────────────────────────────────────────────────────
        print("\n🧪 [測試 5/6] 市場操作：點擊「購買掛牌」打開掛單彈窗")
        btn_open_buy = driver.find_element(By.ID, "btn-open-buy-modal")
        btn_open_buy.click()

        calcs_step5 = []
        for _ in range(10):
            calcs_step5 = driver.find_elements(By.CSS_SELECTOR, ".mwi-adv-modal-calc")
            if len(calcs_step5) >= 1:
                break
            time.sleep(0.3)

        screenshot_step5 = os.path.join(screenshots_dir, "step5_marketplace_buy_modal.png")
        driver.save_screenshot(screenshot_step5)
        print(f"   📸 截圖保存: {screenshot_step5}")

        assert len(calcs_step5) == 1, f"市場購買彈窗未正確注入試算器，當前數量: {len(calcs_step5)}"
        calc_text = calcs_step5[0].text
        assert "掛單時間與收益實時試算" in calc_text, f"試算器標題缺失: {calc_text}"
        assert "填入吃單價" in calc_text, "一鍵填入吃單價按鈕缺失"
        assert "填入首檔搶先價" in calc_text, "一鍵填入首檔搶先價按鈕缺失"
        
        # 點擊「🎯 填入首檔搶先價」並驗證價格框聯動
        top_btn = calcs_step5[0].find_element(By.CSS_SELECTOR, ".mwi-adv-quick-btn.maker")
        top_btn.click()
        time.sleep(0.3)
        market_price_val = driver.find_element(By.ID, "market-price-input").get_attribute("value")
        print(f"   點擊填入首檔搶先價後，價格輸入框值為: {market_price_val}")
        assert market_price_val == "63", f"預期首檔搶先價為 63，實際為: {market_price_val}"

        print("   ✅ [PASS] 測試 5 通過：市場掛單彈窗精確注入試算器，且一鍵填入按鈕連動正常！")
        passed_tests += 1

        # 關閉市場彈窗
        close_btn = driver.find_element(By.CSS_SELECTOR, ".close-btn")
        close_btn.click()
        time.sleep(0.3)

        # ───────────────────────────────────────────────────────────
        # 測試 6：切換回木工技能，重複點擊與切換木板，驗證完全無殘留污染
        # ───────────────────────────────────────────────────────────
        print("\n🧪 [測試 6/6] 防禦回歸：從市場切回木工，再次操作第二次木板")
        nav_crafting = driver.find_element(By.ID, "nav-crafting")
        nav_crafting.click()
        time.sleep(0.5)

        driver.find_element(By.ID, "btn-craft-cedar").click()
        time.sleep(0.4)
        driver.find_element(By.ID, "btn-select-second-plank").click()
        time.sleep(0.4)

        # 驗證所有彈窗試算器與橫幅在木工視角下皆為 0 或不可見
        calcs_step5 = driver.find_elements(By.CSS_SELECTOR, ".mwi-adv-modal-calc")
        visible_banners = [b for b in driver.find_elements(By.CSS_SELECTOR, ".mwi-advisor-top-banner") if b.is_displayed()]
        screenshot_step6 = os.path.join(screenshots_dir, "step6_back_to_crafting_clean.png")
        driver.save_screenshot(screenshot_step6)
        print(f"   📸 截圖保存: {screenshot_step6}")

        assert len(calcs_step5) == 0, f"回歸失敗：再次進入木工面板後，發現殘留試算區塊! 數量: {len(calcs_step5)}"
        assert len(visible_banners) == 0, f"回歸失敗：在木工面板時，市場橫幅仍然意外可見! 數量: {len(visible_banners)}"
        print("   ✅ [PASS] 測試 6 通過：跨面板切換完全無污染，狀態隔離百分之百健全！")
        passed_tests += 1

    except Exception as e:
        print(f"\n❌ [E2E 測試失敗] 發生異常: {str(e)}")
        for entry in driver.get_log('browser'):
            print("  [Browser Console]", entry)
        error_screenshot = os.path.join(screenshots_dir, "e2e_error.png")
        try:
            driver.save_screenshot(error_screenshot)
            print(f"📸 失敗截圖保存: {error_screenshot}")
        except Exception:
            pass
        raise e
    finally:
        driver.quit()

    print("\n" + "=" * 60)
    print(f"🎉 E2E 真實瀏覽器端到端測試圓滿完成: 通過 {passed_tests}/{total_tests} 項測試！")
    print("=" * 60)

if __name__ == "__main__":
    run_e2e_test()
