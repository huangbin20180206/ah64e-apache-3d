# -*- coding: utf-8 -*-
# 84-samwar.js 纯逻辑回归（纯 pytest，无浏览器——不受门禁/浏览器禁令影响）
# 断言纪律：期望值全部写死（边界精确、布尔硬断言），不使用"约等于"；
# 不 mock 被测对象本身（只注入 rng 以固定概率分支，属构造参数）。
import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NODE = "node"
DRIVER = HERE / "samwar_drive.js"


def drive(case: str) -> dict:
    r = subprocess.run(
        [NODE, str(DRIVER), case],
        capture_output=True, text=True, timeout=60, cwd=str(HERE),
    )
    assert r.returncode == 0, f"{case} 驱动失败: {r.stderr}"
    return json.loads(r.stdout)


def test_rwr_chain_order():
    """RWR 状态机依序 idle→track→lock→launch，发射计数=1、导弹在场=1。"""
    out = drive("chain")
    assert out["launched"] is True
    assert out["passedTrack"] is True
    assert out["passedLock"] is True
    # 依序出现：track 必须先于 lock
    assert out["order"].index("track") < out["order"].index("lock")
    assert out["launchN"] == 1
    assert out["missiles"] == 1


def test_missile_hits_stationary_heli():
    """直飞悬停（无机动无干扰弹）必被命中：损伤=4，爆点在机体 1.4u 内。"""
    out = drive("hit")
    assert out["hit"] is True
    assert out["dmg"] == 4
    assert out["withinRadius"] < 1.4
    assert out["missiles"] == 0


def test_evasion_breaks_missile_lock():
    """机动规避机制：发射后持续环形机动 → 首枚导弹被甩出导引头视场（lost）
    且未命中。多枚连射的部分命中属合理威胁性，不在此断言（见 REPORT）。"""
    out = drive("evade")
    assert out["launched"] is True
    assert out["lost"] is True
    assert out["hit"] is False


def test_flare_decoys_missile():
    """干扰弹诱骗：注入 rng=0.1（<0.8 恒真）→ 投放成功、被拐走、不命中。"""
    out = drive("flare")
    assert out["dispensed"] is True
    assert out["flaresLeft"] == 5
    assert out["decoyed"] is True
    assert out["hit"] is False
    assert out["missiles"] == 0


def test_penalty_table_exact():
    """战损→操控惩罚：分级边界精确映射（无感/轻/重/濒坠）。"""
    out = drive("penalty")
    full = '{"speedMul":1,"yawMul":1}'
    assert out["d0"] == full and out["d3"] == full
    assert out["d4"] == '{"speedMul":0.85,"yawMul":0.85}'
    assert out["d7"] == '{"speedMul":0.85,"yawMul":0.85}'
    assert out["d8"] == '{"speedMul":0.7,"yawMul":0.7}'
    assert out["d11"] == '{"speedMul":0.7,"yawMul":0.7}'
    assert out["d12"] == '{"speedMul":0.55,"yawMul":0.6}'
    assert out["d20"] == '{"speedMul":0.55,"yawMul":0.6}'


def test_flare_ammo_and_cooldown():
    """干扰弹：隔冷却连投 6 发全成功、第 7 发耗尽拒绝；冷却内拒绝、过后可用。"""
    out = drive("ammo")
    assert out["six"] == [True] * 6
    assert out["seventh"] is False
    assert out["a1"] is True
    assert out["a2"] is False
    assert out["a3"] is True
    assert out["flares"] == 4  # reset 回满 6 后投 a1 + a3 两发


def test_reset_semantics():
    """复位：交战中 reset → 相位/弹药/导弹/事件全清，launchN 单调保留。"""
    out = drive("reset")
    assert out["wasLaunched"] is True
    assert out["launchNKept"] is True
    assert out["phaseIdle"] is True
    assert out["flaresFull"] is True
    assert out["missilesZero"] is True
    assert out["hitCleared"] is True
    assert out["flareFxCleared"] is True


def test_relaunch_clears_lost_flag():
    """导弹池 slot 复用：失锁退场的导弹占住的 slot 被 _fireFrom 复用时，
    新导弹必须清除 lost 标志（否则新导弹带残留 lost→导引全跳过→发射即哑弹）。
    对照 decoyed/hasLos 已被清，证明 lost 曾是唯一漏清项。"""
    out = drive("relaunch_lost")
    assert out["fired"] is True
    assert out["lostCleared"] is True       # 修复点
    assert out["decoyedCleared"] is True
    assert out["hasLosCleared"] is True


def test_no_engagement_gate():
    """非交战门控：aaOn=false 永不建锁；已发射导弹继续飞完不悬空。"""
    out = drive("noengage")
    assert out["neverEngaged"] is True
    assert out["missileResolved"] is True
    assert out["hitOrGone"] is True


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
