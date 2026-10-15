# -*- coding: utf-8 -*-
# P4c 场景视觉：时段 6 档 / 布景与航线避让 / 树线在航线外（无浏览器）
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load():
    r = subprocess.run(["node", str(HERE / "scenery_drive.js")], capture_output=True, text=True,
                       timeout=60, encoding="utf-8", errors="replace")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_six_env_presets_complete():
    d = _load()
    assert d['keys'] == ['dawn', 'day', 'afternoon', 'dusk', 'night', 'studio']
    assert d['labels'] == ['清晨', '正午', '午后', '黄昏', '夜间', '棚拍']
    assert d['missing'] == []
    assert d['chips'] == d['keys']


def test_apron_clear_of_routes():
    d = _load()
    assert d['padRoutes'] >= 1
    assert d['mastClear'] >= 6, d['mastClear']
    assert d['hangarClear'] >= 6, d['hangarClear']
    assert all(r >= 20 for r in d['mastR']), d['mastR']


def test_treeline_outside_flight_area():
    d = _load()
    assert d['treeR'] > d['maxR'] + 20, (d['treeR'], d['maxR'])
    assert d['minHill'] >= 0


def test_combo_presets_valid():
    d = _load()
    assert d['combos'] == 6
    assert d['comboBad'] == []


def test_meadow_flat_in_play_area():
    d = _load()
    assert d['meadowInnerMax'] < 0.1, d['meadowInnerMax']
    assert d['meadowEdge'] < 0.1, d['meadowEdge']
