# -*- coding: utf-8 -*-
# P4a 知识库 10 卡：数据完整性（无浏览器）
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load():
    r = subprocess.run(["node", str(HERE / "knowcards_drive.js")], capture_output=True, text=True,
                       timeout=60, encoding="utf-8", errors="replace")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_ten_cards_complete():
    d = _load()
    cards, nodes = d["cards"], d["nodes"]
    assert len(cards) == 10
    assert len({c["id"] for c in cards}) == 10
    assert "APG-78" in cards[0]["title"]          # test_appmode M3 依赖第 0 卡是雷达
    for c in cards:
        assert c["node"] in nodes, c["id"]          # 节点必须是已知部件，镜头才能飞过去
        assert 3 <= len(c["params"]) <= 5, c["id"]
        assert all(len(p) == 2 and p[0] and p[1] for p in c["params"]), c["id"]
        assert len(c["body"]) >= 60 and c["role"], c["id"]
        assert c["src"].startswith("en.wikipedia.org/wiki/"), c["id"]
        assert 0 <= c["explode"] <= 1, c["id"]
