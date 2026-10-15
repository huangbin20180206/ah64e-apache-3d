# -*- coding: utf-8 -*-
# 90-campaign.js 纯逻辑回归（纯 pytest，无浏览器——Phase 20-C 评级 / D 存档）
# 断言纪律：期望值全部写死（每级阈值上下各一条边界用例；兼容性黄金用例
# 守护 73 项既有断言）；storage 注入桩对象（依赖注入，非 mock 被测对象）。
import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NODE = "node"
DRIVER = HERE / "campaign_drive.js"


def drive(case: str) -> dict:
    # encoding='utf-8'：驱动器 JSON 输出含中文（关卡名/明细 label），Windows
    # 默认 GBK 解码会炸 UnicodeDecodeError（读管道线程抛错 → TypeError）
    r = subprocess.run(
        [NODE, str(DRIVER), case],
        capture_output=True, text=True, timeout=60, cwd=str(HERE),
        encoding="utf-8", errors="replace",
    )
    assert r.returncode == 0, f"{case} 驱动失败: {r.stderr}"
    return json.loads(r.stdout)


# ---------- C：结算评级（每级阈值上下各一条边界） ----------

def test_grade_base_edges():
    """基础曲线边界 8 条（旧 missionRating 同式，写死）：
    S 恰达 149.9s/0.5→S；越时长 150→A；越命中 0.4999→A；命中恰达 0.5→S；
    A 恰达 239.9/0.35→A；越 240→B；B 恰达 419.9/0.2→B；越 420→C。"""
    out = drive("grade_edges")
    assert out["s_in_time"] == "S"
    assert out["s_out_time"] == "A"
    assert out["s_out_acc"] == "A"
    assert out["s_in_acc"] == "S"
    assert out["a_in_time"] == "A"
    assert out["a_out_time"] == "B"
    assert out["b_in_time"] == "B"
    assert out["b_out_time"] == "C"


def test_grade_drop_edges():
    """调整项边界（只降不升）：dmg 4→-1 档 / 8→-2 档；fuel 25 恰不降 /
    24.9 降；ammoDry 降；组合降档 S→B（双）/ S→C（三）。"""
    out = drive("grade_drops")
    assert out["dmg0"] == "S"
    assert out["dmg4"] == "A"
    assert out["dmg8"] == "B"
    assert out["fuel25"] == "S"
    assert out["fuel249"] == "A"
    assert out["ammoDry"] == "A"
    assert out["dmg4_fuel249"] == "B"
    assert out["dmg8_fuel249_ammo"] == "C"


def test_grade_combo_keep():
    """保档：combo≥5 抵一次降档（fuel 10 降档被抵 → S）；combo=4 不抵；
    无降档时保档零影响。"""
    out = drive("grade_combo_keep")
    assert out["keep5"] == "S"
    assert out["keptBy"] == "combo"
    assert out["noKeep4"] == "A"
    assert out["noDropNoKeep"] == "S"
    assert out["kept0"] is True


def test_grade_rookie_cap():
    """难度输入：rookie 封顶 A（全绿也 A）；veteran 不封顶；rookie+重损再降 → B。"""
    out = drive("grade_rookie_cap")
    assert out["rookie"] == "A"
    assert out["veteran"] == "S"
    assert out["rookie_dropped"] == "B"


def test_grade_compat_golden():
    """兼容性黄金用例（73 项既有断言零改动的硬前提）：mobile_mission ③
    短局高命中场景 / arcade A9 全歼场景 / S 级边界（149.9s+轻损+油 67）
    在新公式下与旧 missionRating 输出逐位一致 → 全 S。"""
    out = drive("grade_compat")
    assert out["mobile"] == "S"
    assert out["a9"] == "S"
    assert out["edge_s"] == "S"


def test_grade_detail_items():
    """逐项明细：7 项输入各一条（label 固定）且每条含非空 impact。"""
    out = drive("grade_detail")
    assert out["labels"] == ["用时", "命中率", "剩余燃油", "弹药", "机体损伤", "最高连击", "难度"]
    assert out["n"] == 7
    assert out["hasImpact"] is True


# ---------- D：战役存档 ----------

def test_save_roundtrip_and_unlock():
    """序列化往返：complete → 新实例读同一 storage 逐字段一致；A 级解锁第 2 关。"""
    out = drive("save_roundtrip")
    assert out["score"] == 1200
    assert out["grade"] == "A"
    assert out["ach"] == ["ace", "first_blood"]
    assert out["dmg"] == 3.5
    assert out["unlocked"] == 2
    assert out["schema"] == 1


def test_save_keeps_best():
    """最优保留：二周目低分低评级不覆盖；成就并集；损伤累加 3.5+1.2=4.7。"""
    out = drive("save_best")
    assert out["score"] == 1200
    assert out["grade"] == "A"
    assert out["ach"] == ["ace", "first_blood"]
    assert out["dmg"] == 4.7


def test_unlock_boundary():
    """解锁链边界：B 恰解锁下关 / C 不解锁 / S 解锁（前关达 B 解锁）。"""
    out = drive("unlock_boundary")
    assert out["bUnlocks"] == 2
    assert out["cNot"] == 1
    assert out["sUnlocks"] == 2


def test_migrate_v0():
    """迁移 v0（无版本号）：保留可读字段、按 CAMPAIGN_LEVELS.length 补全默认关。"""
    out = drive("migrate_v0")
    assert out["schema"] == 1
    assert out["unlocked"] == 2
    assert out["expected"] >= 6          # 含终关 sead_strike（Phase 26）
    assert out["n"] == out["expected"]
    assert out["kept"] == {"bestScore": 500, "bestGrade": "A", "ach": ["x"], "totalDmg": 2}
    assert out["def1"] == {"bestScore": 0, "bestGrade": "", "ach": [], "totalDmg": 0}


def test_migrate_tolerates_anything():
    """容错：缺字段/垃圾字符串/null/数组/未来版本号全部回全新档不炸。"""
    out = drive("migrate_bad")
    assert out["emptyOk"] is True
    assert out["garbageOk"] is True
    assert out["nullOk"] is True
    assert out["arrOk"] is True
    assert out["futureOk"] is True


def test_corrupt_json_falls_back():
    """损坏 JSON：构造不炸、回全新档（unlocked=1）。"""
    out = drive("corrupt_json")
    assert out["threw"] is False
    assert out["schema"] == 1
    assert out["unlocked"] == 1


def test_degrade_without_storage():
    """降级：storage 抛异常 → 内存降级，complete 正常工作。"""
    out = drive("degrade")
    assert out["threw"] is False
    assert out["okComplete"] is True
    assert out["memScore"] == 5
    assert out["memUnlocked"] == 2


def test_grade_cfg_weight_injection():
    """评级权重可配置：FUEL_DROP 注入 50 → 49 降档 / 50 不降。"""
    out = drive("cfg_weights")
    assert out["f49"] == "A"
    assert out["f50"] == "S"


def test_level_params_and_gating():
    """关卡参数：levelCount 与 CAMPAIGN_LEVELS 一致；canPlay 门控（unlocked=1 时仅第 1 关可开）。"""
    out = drive("levels")
    assert out["n"] == out["expected"]
    assert out["p0"]["variant"] == "standard"
    assert out["p4"]["difficulty"] == "veteran"
    assert out["pBad"] is None
    assert out["canPlay0"] is True
    assert out["canPlay1"] is False
    assert out["canPlayNeg"] is False


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
