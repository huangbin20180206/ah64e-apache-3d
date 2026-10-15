# -*- coding: utf-8 -*-
# 91-levels（关卡表/星级/附加目标/目标清单）+ 92-progress（存档 v2/解锁/v1 迁移）纯逻辑回归
import json
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


@pytest.fixture(scope="module")
def d():
    r = subprocess.run(["node", str(HERE / "levels_drive.js")], capture_output=True, text=True,
                       timeout=60, cwd=str(HERE), encoding="utf-8", errors="replace")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_table_shape(d):
    ids = [t["id"] for t in d["table"]]
    assert ids == ["1-1", "1-2", "1-3", "1-4", "2-1", "2-2", "2-3", "3-1", "3-2", "3-3", "4-1", "4-2", "4-3"]
    assert [t["ch"] for t in d["table"]] == [1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]
    for t in d["table"]:
        assert t["okVariant"], t
        if t["ready"]:
            assert t["nObj"] >= 1 and t["nBonus"] >= 1, t


def test_all_existing_variants_reachable_from_table(d):
    # P2 验收：现有 7 种玩法都能从关卡表启动
    assert d["coveredVariants"] == sorted(d["variants"])


def test_stars(d):
    # 2-1: two=B three=A；4-1: two=A three=S；无评级=0
    assert d["stars"] == [1, 2, 2, 3, 3, 2, 3, 0]


def test_bonus_and_objectives(d):
    assert d["bonus"] == [True, False, True, False, False, True]
    assert d["obj"] == [False, True, "6/6"]
    assert d["bonus2"] == [True, False]
    assert d["fin"][0] == [[False, ""], [False, "未开始"], [False, "未开始"]]
    assert d["fin"][1] == [[True, ""], [False, "地面 7 · 敌机 2"], [False, "未开始"]]
    assert d["fin"][3] == [[True, ""], [True, ""], [True, ""]]
    assert d["course"] == [[True, "3/3"], [False, "4/10s"], [False, ""], [True, "3/3"], [True, ""], [True, ""]]


def test_unlock_chain(d):
    # 新档：只有第一个可玩关（2-1）解锁；制作中的关永远锁
    assert d["fresh"] == [True] + [False] * 12
    assert d["afterC"] == {"stars": 1, "unlockedNext": True, "next": "2-2", "open22": True, "open23": False}
    assert d["afterA"]["stars"] == 3 and d["afterA"]["unlockedNext"] is False
    assert d["afterA"]["best"] == {"stars": 3, "bestGrade": "A", "bestScore": 100, "clears": 2, "diff": "veteran"}
    assert d["persisted"] == d["afterA"]["best"] and d["reload"] == 3
    assert d["totals"] == {"stars": 3, "maxStars": 39, "cleared": 1, "ready": 13, "total": 13}
    # 2-1 unlockAfter=1-1：首飞通过即开放实战，训练关 1-2 起照常串行
    assert d["before11"] == [False, False]
    assert d["after11"] == [True, True, False]
    assert d["next42"] == "4-3" and d["next43"] is None


def test_v1_migration(d):
    m = d["mig"]
    # 旧 0(A)/3(S) 都映射到 2-1 → 取最优 S；旧档无 bonus → 最多 2 星
    assert m["l21"] == {"stars": 2, "bestGrade": "S", "bestScore": 1200, "clears": 1, "diff": ""}
    assert m["l22"]["stars"] == 2 and m["l22"]["bestGrade"] == "B"
    # 旧 unlocked=3 覆盖的 2-3 保持解锁（只增不减），3-1 未覆盖仍锁
    assert m["l23"]["stars"] == 0 and m["open23"] is True and m["open31"] is False
    assert m["written"] and m["v1kept"] and m["from"] == 1


def test_corrupt_and_degraded(d):
    assert d["corrupt"] == 0 and d["future"] == 0
    assert d["throwing"] == 2   # storage 抛异常 → 内存降级，记档照常
