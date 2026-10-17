# -*- coding: utf-8 -*-
# 装备图鉴（35-armorydata / 71-armory）：数据完整性 + 轮盘数学（无浏览器）
import json
import math
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load():
    r = subprocess.run(["node", str(HERE / "armory_drive.js")], capture_output=True, text=True,
                       timeout=60, encoding="utf-8", errors="replace")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_items_complete():
    d = _load()
    items, cats = d["items"], d["cats"]
    assert d["n"] == 13
    assert len({it["id"] for it in items}) == 13
    assert sum(it["cat"] == "s" for it in items) == 8
    assert sum(it["cat"] == "w" for it in items) == 5
    # 同类连续：轮盘上结构一段、武器一段
    cs = [it["cat"] for it in items]
    assert cs == sorted(cs, key=lambda c: 0 if c == "s" else 1)
    for it in items:
        assert it["cat"] in cats, it["id"]
        assert it["img"] + ".webp" in d["imgs"], it["id"]   # 照片文件必须存在
        assert it["title"] and it["en"], it["id"]
        assert 3 <= len(it["params"]) <= 4, it["id"]       # 横屏一行 4 格
        assert all(len(p) == 2 and p[0] and p[1] for p in it["params"]), it["id"]
        assert 80 <= len(it["body"]) <= 220, it["id"]      # 打字机 ~30 字/秒，控制在 3–7 秒
        assert it["credit"], it["id"]
    assert "hero.webp" in d["imgs"] and "LICENSE.txt" in d["imgs"]


def test_wheel_math():
    m = _load()["math"]
    assert m["rel"] == [0, 1, -1, 1, 6, -6, 0.3999999999999999] or abs(m["rel"][6] - 0.4) < 1e-9
    assert m["rel"][:6] == [0, 1, -1, 1, 6, -6]
    assert m["nearest"] == [0, 0, 1, 12, 0, 0, 12, 12]
    # 最短路径：12→0 只走一格，不反转一整圈
    assert m["target"][0] == 13 and m["target"][1] == -1
    assert abs(m["target"][2] - 5) < 1e-9 and m["target"][3] == 26
    assert abs(m["step"] - 2 * math.pi / 13) < 1e-12
