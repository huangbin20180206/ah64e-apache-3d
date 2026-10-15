# -*- coding: utf-8 -*-
# 89-resources.js 纯逻辑回归（纯 pytest，无浏览器——Phase 20-B 燃油/补给窗口）
# 断言纪律：期望值全部写死（RESCFG 同源推导 + 实测直录）；cfg 注入验证
# 权重可配置（构造参数，非 mock 被测对象）。
import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NODE = "node"
DRIVER = HERE / "resources_drive.js"


def drive(case: str) -> dict:
    r = subprocess.run(
        [NODE, str(DRIVER), case],
        capture_output=True, text=True, timeout=60, cwd=str(HERE),
    )
    assert r.returncode == 0, f"{case} 驱动失败: {r.stderr}"
    return json.loads(r.stdout)


def test_fuel_hover_rate():
    """悬停消耗：0.22%/s × 100s → fuel=78（悬停省——物理出处）。"""
    out = drive("fuel_hover")
    assert abs(out["fuel"] - 78) < 1e-6
    assert out["events"] == []      # 油充足无事件


def test_fuel_maneuver_rate():
    """满机动消耗：1.0%/s × 60s → fuel=40（大机动费）。"""
    out = drive("fuel_maneuver")
    assert abs(out["fuel"] - 40) < 1e-6


def test_fuel_mixed_rate():
    """半机动混合：rate=0.22+0.78×0.5=0.61 → 100s 耗 61 → fuel=39。"""
    out = drive("fuel_mixed")
    assert abs(out["fuel"] - 39) < 1e-3


def test_fuel_out_event_chain():
    """告警+耗尽链：warn1(30%)/warn2(12%)/fuelOut 各恰一次且有序；终态 fuel=0。"""
    out = drive("fuel_out")
    assert out["types"] == ["warn1", "warn2", "fuelOut"]
    assert out["n1"] == 1 and out["n2"] == 1 and out["nOut"] == 1
    assert out["order"] is True
    assert out["fuel"] == 0
    assert out["outFlag"] is True


def test_inactive_no_burn():
    """非任务局不耗油（show/train 展示模式保护）。"""
    out = drive("inactive")
    assert out["fuel"] == 100
    assert out["events"] == []


def test_rtb_resupply():
    """返场补给全链：窗口 3s → resupplied + fuel 回满。"""
    out = drive("rtb")
    assert abs(out["fuelMid"] - 90) < 1e-6     # 先 10s 满机动耗 10
    assert out["fuelAfter"] == 100
    assert out["resupplied"] is True
    # 播报 tick：名义 3s/0.5s=6，浮点步进下末个 tick 与 resupplied 同帧不独立
    # 计入——实测 5（确定性序列直录）；tick 是播报节流非精确计量
    assert out["ticks"] == 5


def test_rtb_leave_resets_progress():
    """窗口中途离开：进度清零（p2=0），返场必须一次完成。"""
    out = drive("rtb_leave")
    assert abs(out["p1"] - 2.0) < 1e-6
    assert out["p2"] == 0
    assert abs(out["p3"] - 2.0) < 1e-6          # 回来只累计 2s，未达 3s
    assert out["resupplied"] is False


def test_rtb_disabled_for_limited_ammo():
    """limited_ammo 变体禁用补给窗口（挑战语义 + frugal 成就保护）。"""
    out = drive("rtb_limited")
    assert out["rtbOn"] is False
    assert out["rtbT"] == 0
    assert out["events"] == []


def test_rtb_requires_stability():
    """稳定度 0.89 < 0.9 窗口不计时（低空稳定悬停才可补给）。"""
    out = drive("rtb_stab")
    assert out["rtbOn"] is False
    assert out["rtbT"] == 0


def test_ammo_dry_predicate():
    """弹药耗尽谓词边界：全 0 true；任一有余 false；负数按 0 钳。"""
    out = drive("ammo_dry")
    assert out["allZero"] is True
    assert out["gunLeft"] is False
    assert out["hfLeft"] is False
    assert out["negative"] is True


def test_cfg_weight_injection():
    """权重可配置可测：FUEL_HOVER 覆盖 0.5 → 100s 耗 50。"""
    out = drive("cfg_inject")
    assert abs(out["fuel"] - 50) < 1e-3


def test_start_resets_fuel_and_latches():
    """start() 复位：告急后回满油、告警 latch 复位。"""
    out = drive("start_reset")
    assert out["wasOut"] is True
    assert out["fuel"] == 100
    assert out["warnReset"] is True


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
