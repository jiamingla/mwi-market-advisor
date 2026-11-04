import urllib.request
import json

url = "https://www.milkywayidle.com/game_data/marketplace.json"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode("utf-8"))

market = data.get("marketData", {})
for k in sorted(market.keys()):
    if any(w in k for w in ["log", "lumber"]):
        info = market[k].get("0", {})
        print(f"{k:25}: ask={info.get('a')}, bid={info.get('b')}, vol={info.get('v')}")
