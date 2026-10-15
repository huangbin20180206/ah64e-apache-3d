# -*- coding: utf-8 -*-
# 87-enemyair.js 纯逻辑回归（纯 pytest，无浏览器——Phase 20-A A2A 状态机）
# 断言纪律：期望值全部写死（边界精确、布尔硬断言、确定性数值直录实测）；
# 不 mock 被测对象本身（只注入 rng 固定概率分支——0.01 必中 / 0.99 必不中 /
# 0.12 落在两个命中概率之间做"稳定度开关"，属构造参数）。
import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
NODE = "node"
DRIVER = HERE / "enemyair_drive.js"


def drive(case: str) -> dict:
    # encoding='utf-8'：驱动器 JSON 输出含中文（label 等），Windows 默认 GBK
    # 解码会炸 UnicodeDecodeError（读管道线程抛错 → stdout=None → TypeError）
    r = subprocess.run(
        [NODE, str(DRIVER), case],
        capture_output=True, text=True, timeout=60, cwd=str(HERE),
        encoding="utf-8", errors="replace",
    )
    assert r.returncode == 0, f"{case} 驱动失败: {r.stderr}"
    return json.loads(r.stdout)


def test_chain_patrol_search_attack():
    """状态链：spawn 后双机巡逻 → 玩家入视距视锥 → search → attack 依序。"""
    out = drive("chain")
    assert out["spawnLive"] is True
    assert out["spawnPhase"] is True           # 全员 patrol
    assert out["patrolOk"] is True
    assert out["sawSearch"] is True
    assert out["sawAttack"] is True
    # search 在 0~N 步内、attack 在其后（SEARCH_T=0.8s=16 步）
    assert out["searchStep"] == 0
    assert out["attackStep"] >= 15


def test_attack_hits_player():
    """攻击命中链：rng=0.01 必中 → hitPending dmg=1（GUN_DMG×aaDmg=1）。"""
    out = drive("attack_hit")
    assert out["hit"] is True
    assert out["dmg"] == 1
    assert out["near"] < 3      # 爆点在玩家 3u 内（_hitPlayer 扰动 ±1.5）


def test_stability_reduces_incoming_fire():
    """机动规避收益（确定性开关）：rng=0.12 恰落在悬停命中概率（≈0.16）
    与机动（stab=0.25 → ≈0.10）之间——悬停 44 发全中、机动 0 命中。"""
    out = drive("stability")
    assert out["hoverHits"] == 44
    assert out["maneuverHits"] == 0


def test_evade_on_locked():
    """被持续瞄准（跟踪瞄准）>LOCKED_T(1.2s) → evade。"""
    out = drive("evade_locked")
    assert out["sawEvade"] is True


def test_evade_on_damage():
    """受损规避：3 点注入（=EVADE_DMG）→ 下帧 evade；hp 8-3=5。"""
    out = drive("evade_dmg")
    assert out["hitUnit"] is True
    assert out["phase"] == "evade"
    assert out["dmg"] == 3
    assert out["hp"] == 5


def test_withdraw_on_heavy_damage():
    """重损撤出：6 点（≥WITHDRAW_DMG）→ withdraw → 驱动到 EXIT_R 退场。"""
    out = drive("withdraw_dmg")
    assert out["withdrew"] is True
    assert out["exited"] is True


def test_withdraw_on_ammo_dry():
    """弹药耗尽撤出：真实驱动打空 40 机炮 + 4 火箭 → withdraw。"""
    out = drive("withdraw_ammo")
    assert out["sawWithdraw"] is True
    assert out["gunN"] == 0
    assert out["rkN"] == 0


def test_kill_event():
    """击落链：8 点一发击落 → killEvent{type:'enemy'}、off、界外 miss=null。"""
    out = drive("kill")
    assert out["hitUnit"] is True
    assert out["killed"] is True
    assert out["label"] == "敌方武装直升机"
    assert out["off"] is True
    assert out["missNull"] is True
    assert out["live"] == 1          # 僚机仍在场


def test_res_difficulty():
    """难度抗打击：veteran res=1.4 下 8 点不致死（hp=8-8/1.4=2.29）；standard 致死。"""
    out = drive("res")
    assert out["vetHp"] == 2.29
    assert out["vetAlive"] is True
    assert out["stdDead"] is True


def test_wing_formation():
    """编队协同：巡逻位差（19.5u 含高度差 2.5）+ 攻击态侧翼分散（>8u）。"""
    out = drive("wing")
    assert out["patrolDist"] == 19.5
    assert out["dh"] == 2.5
    assert out["atkDist"] >= 8


def test_reset_clears_all():
    """复位语义：交战中 reset → active=false、live=0、事件清空、相位归 patrol。"""
    out = drive("reset")
    assert out["active"] is False
    assert out["live"] == 0
    assert out["hitNull"] is True
    assert out["killNull"] is True
    assert out["phases"] == ["patrol", "patrol"]


def test_search_to_patrol_no_teleport():
    """search→patrol 位置连续性：search 期单元 _advance 偏离巡逻圆后，玩家脱离
    视距回 patrol，位置跳变必须有界（<2u），不得沿用冻结旧 ang 瞬移弹回旧相位点。
    修复前此跳变 ~7.3u（粗暴闪现）；修复后 ~1.37u（仅半径回归残差）。
    审核方 revert 87-enemyair 那行 reangle 即可复现 FAIL。"""
    out = drive("search_teleport")
    assert out["midPhase"] == "patrol"
    assert out["afterPhase"] == "patrol"
    assert out["bounded"] is True     # 跳变 <2u，无粗暴瞬移


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
