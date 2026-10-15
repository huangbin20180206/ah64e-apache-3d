# -*- coding: utf-8 -*-
# mergeGeos 纯单元测试（C1 镜像合并 / C2 靶标合批的承重件）。
# 期望值写死：index 偏移拼接、顶点拼接、保底路径全部精确断言。
import json
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
DRIVER = HERE / "mergegeos_drive.js"


def drive(case: str) -> dict:
    r = subprocess.run(["node", str(DRIVER), case],
                       capture_output=True, text=True, timeout=30, cwd=str(HERE))
    assert r.returncode == 0, f"{case} 驱动失败: {r.stderr}"
    return json.loads(r.stdout)


def test_merge2_index_offset():
    """两块拼接：6 顶点；index 第二段加基址 3；位置按块序拼接。"""
    out = drive("merge2")
    assert out["ok"] is True
    assert out["vCount"] == 6
    assert out["nCount"] == 6
    assert out["pos3x"] == 100            # 第 4 顶点 = 第二块首顶点
    assert out["idx"] == [0, 1, 2, 3, 5, 4]   # 第二段 0,2,1 + 基址 3
    assert out["idxType"] == "Uint32Array"


def test_single_passthrough_and_guards():
    """单元素直通原引用；空数组/null 返回 null。"""
    out = drive("single")
    assert out["same"] is True
    assert out["empty"] is True
    assert out["nul"] is True


def test_mismatch_fallbacks():
    """保底路径：attribute 集不一致 / index 有无不一致 → null；同构对可合。"""
    out = drive("mismatch")
    assert out["attrMismatch"] is True
    assert out["indexMismatch"] is True
    assert out["okPair"] is True


def test_merge4_multi_base_accumulation():
    """四块拼接：基址逐块累加；跨块顶点位置正确。"""
    out = drive("merge4")
    assert out["ok"] is True
    assert out["vCount"] == 8
    # 基址 0,2,4（第三块）：idx [0,1, 2,3, 4,6,5, 7]
    assert out["idx"] == [0, 1, 2, 3, 4, 6, 5, 7]
    assert out["x2"] == 20                 # 第三块首顶点
    assert out["x3"] == 30                 # 第四块首顶点
