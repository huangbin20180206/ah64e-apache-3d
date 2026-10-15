# -*- coding: utf-8 -*-
# P4b 飞行展示航线：数据与轨迹（无浏览器）
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
KINDS = {'chase', 'side', 'front', 'orbit', 'high', 'fixed'}


def _load():
    r = subprocess.run(["node", str(HERE / "routes_drive.js")], capture_output=True, text=True,
                       timeout=60, encoding="utf-8", errors="replace")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_six_routes_40_to_60s():
    d = _load()
    assert [x['id'] for x in d] == ['dawn', 'grass', 'desert', 'lake', 'town', 'canyon']
    for x in d:
        assert 40 <= x['dur'] <= 60, x


def test_route_timeline_sorted():
    for x in _load():
        assert x['mono'] and x['shotsSorted'] and x['capsSorted'], x
        assert set(x['shotKinds']) <= KINDS, x
        assert x['lastShot'] < x['dur'], x


def test_route_flyable():
    for x in _load():
        assert x['minAlt'] >= 1.2, x            # 不贴地穿模
        assert x['maxSp'] < 12, x               # 电影航线：速度可看清
        assert x['maxAbs'] <= 60, x             # 不飞出地图


def test_canyon_follows_centerline():
    c = [x for x in _load() if x['id'] == 'canyon'][0]
    assert c['canyonDev'] < 2.5, c              # 谷底半宽 4~6u，偏离中线 < 2.5u
    assert c['terrain'] == 'desert' and c['env'] == 'dusk'
