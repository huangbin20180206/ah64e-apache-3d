# -*- coding: utf-8 -*-
# 86-damage.js 纯逻辑回归（纯 pytest，无浏览器）——Phase 19 机务损伤与特情处置
# 覆盖任务要求的全部面：损伤分配（方位×伤害量）、级联、阈值边界（每级
# 上下各一条）、四种处置成功/失败/冷却、航电失效对 HUD 的影响、战损得分
# 系数边界、seed 确定性。期望值按公式写死，不 mock 被测对象（rng 注入是
# 构造参数，属概率分支的确定性控制）。
import json
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
DRIVER = HERE / "damage_drive.js"


def drive(case: str) -> dict:
    r = subprocess.run(["node", str(DRIVER), case],
                       capture_output=True, text=True, timeout=60, cwd=str(HERE))
    assert r.returncode == 0, f"{case} 驱动失败: {r.stderr}"
    return json.loads(r.stdout)


# ---------- ① 损伤分配：方位 × 伤害量 → 子系统（确定性） ----------

def test_alloc_top_sector():
    out = drive("alloc")
    assert out["top"] == {"rotor": 7.0, "engine": 1.0, "weapons": 1.0, "avionics": 1.0}


def test_alloc_belly_sector():
    out = drive("alloc")
    # 第二发叠加在 top 之后：belly 各 + 原 top 值
    assert out["belly"] == {"rotor": 8.5, "engine": 2.0, "weapons": 7.5, "avionics": 2.0}


def test_alloc_front_rear_sectors():
    out = drive("alloc")
    assert out["front"] == {"rotor": 3.0, "engine": 4.0, "weapons": 2.0, "avionics": 11.0}
    assert out["rear"] == {"rotor": 4.0, "engine": 11.0, "weapons": 2.0, "avionics": 3.0}


# ---------- ② seed 确定性 ----------

def test_seed_determinism():
    out = drive("alloc_seed")
    assert out["same"] is True, "同 seed 同序列必须逐字段一致"
    assert out["diff"] is True, "异 seed 的扰动分配必须不同"


# ---------- ③ 级函数边界（每级上下各一条） ----------

def test_level_boundaries():
    out = drive("levels")
    assert out["lv"] == [0, 0, 1, 1, 2, 2, 3, 3, 4]


# ---------- ④ 级联：引擎超温 → 旋翼疲劳；降功率降温 ----------

def test_cascade_overheat_to_rotor():
    out = drive("cascade")
    # engine=80(lvl2) overheat=1.0：5s 疲劳 = 2*1.0*0.8*5 = 8.0
    assert out["rotorGain"] == 8.0
    # overheat 演化：lvl2 无处置时 +0.006*2*5=+0.06 → clamp 后 1.0
    assert out["overheat5"] == 1.0
    # 超温持续恶化：engine > 80（2/s）
    assert out["engineWorse"] is True


def test_mitigate_cools_and_costs_power():
    out = drive("mitigate")
    assert out["overheat"] == 0.1          # 0.6 - 0.05*10
    assert out["powerCap"] == 0.714        # (1-0.16)*0.85 = 0.84*0.85
    assert out["offCap"] == 0.84           # 松处置后恢复（无降功率代价）


# ---------- ⑥ 武器上膛：成功 / 失败 / 冷却 ----------

def test_weapons_cycle_success_path():
    out = drive("weapons_ok")
    assert out["c1"] is True
    assert out["duringAllJammed"] is True   # 3s 处置期全程卡壳
    assert out["at3s"] is True
    assert out["after"] is False            # 成功 → 解卡
    assert out["weapons"] == 10             # 成功修 10（20-10）
    assert out["cool"] > 0                  # 冷却启动
    assert out["againDuringCool"] is False  # 冷却内拒绝
    assert out["againAfterCool"] is True    # 冷却后可再触发


def test_weapons_cycle_failure_path():
    out = drive("weapons_fail")
    assert out["jammed"] is True            # 失败保持卡壳
    assert out["cool"] == 8                 # 冷却 8s
    assert out["events"] == 1              # jam_fail 事件恰好一条


# ---------- ⑦ 航电重启：成功修 20 / 失败不减 / 全黑窗口 / 冷却 ----------

def test_avionics_reboot_success():
    out = drive("avionics_ok")
    assert out["r1"] is True
    assert out["darkDuring"] is True       # 1.5s 内全黑
    assert out["av"] == 40                 # 60 - 20
    assert out["againDuringCool"] is False
    assert out["afterCool"] is True


def test_avionics_reboot_failure():
    out = drive("avionics_fail")
    assert out["av"] == 60                 # 失败不修复


# ---------- ⑧ 航电失效 HUD 间歇窗口（lvl2 → 周期 8s、头 1.2s 失效） ----------

def test_hud_fail_windows():
    out = drive("hudfail")
    assert out["w1"] is True      # [0, 1.2s) 失效
    assert out["gap"] is True     # (1.2s, 8.0s) 正常
    assert out["w2start"] is True # 8.0s 起再次失效、9.2s 结束
    assert out["w2"] is True


# ---------- ⑨ 战损得分系数边界 ----------

def test_bonus_mul_boundaries():
    out = drive("bonus")
    assert out["zero"] == 1.0
    assert out["full"] == 1.5
    assert out["halfEngine"] == 1.0625     # 1 + 50/400*0.5


# ---------- ⑩ 旋翼磨损与降载 ----------

def test_rotor_wear_and_load_reduce():
    out = drive("rotor_wear")
    assert out["gain1"] == 0.5             # 1*0.10*5
    assert out["gain2"] == 0.25            # 降载 ×0.5
    assert out["gain3"] == 0               # 地面不磨损


# ---------- ⑪ 阈值告警事件（跨级才发） ----------

def test_threshold_events():
    out = drive("events")
    assert out["events"] == [
        {"sys": "rotor", "level": 1},
        {"sys": "rotor", "level": 2},
    ]


# ---------- ⑫ 复位 ----------

def test_reset():
    out = drive("reset")
    assert out["clean"] is True
    assert out["events"] == 0


# ---------- ⑬-⑮ 卡壳自然触发（Phase 19-补二）：持续开火累积风险 ----------

def test_jam_never_below_lvl2():
    out = drive("jam_nolow")
    assert out["jammed"] is False      # Lv1 + rng=0（必卡档）持续开火 10s 仍不卡——风险恒 0


def test_jam_risk_level_scaling():
    out = drive("jam_levels")
    assert out["lvl2Jam"] is True        # rng=0.003 < lvl2 阈 0.004 → 首帧即卡
    assert out["lvl2NoJam"] is True      # rng=0.005 > 0.004 → lvl2 十秒不卡
    assert out["lvl3Jam"] is True        # 同 rng=0.005 < lvl3 阈 0.009 → 首帧即卡（率随级升）
    assert out["lvl4Jam"] is True        # < lvl4 阈 0.016 同样即卡
    assert out["noFireNoJam"] is True    # rng=0（必卡档）但不开火 → 永不卡（firing 短路）


def test_jam_immunity_window_chain():
    out = drive("jam_immune")
    assert out["jam1"] is True           # 自然卡壳发生
    assert out["c1"] is True             # N 上膛受理
    assert out["cleared"] is True        # 成功解卡 + 免疫窗恰 10s
    assert out["immuneHeld"] is True     # 窗口内持续开火 9.5s 不卡
    assert out["reJam"] is True          # 窗口耗尽后再开火 → 再卡
    assert out["resetClears"] is True    # reset 清免疫窗与卡壳


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
