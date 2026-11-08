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


def test_dispose_ownership_contract():
    """P1-5：单输入原样返回时绝不释放入参；合并成功/失败时入参全部释放。"""
    out = drive("dispose_ownership")
    assert out["singleKept"] is True          # mergeGeos 返回 list[0]，仍在渲染
    assert out["pairDisposed"] is True        # 合并成功 → 全新 out，入参无人接手
    assert out["failDisposed"] is True        # 合并失败 null → 入参没人接手
    assert out["okIsNew"] is True
    assert out["failIsNull"] is True
    assert out["guardsNoThrow"] is True       # null / 空数组不抛错


def test_merge_bucket_meshes_contract():
    """P2-2 收口：成功桶建 mesh/摘节点/释放临时几何；单输入不释放；失败桶零丢失。"""
    out = drive("merge_buckets")
    assert out["count"] == 2                 # ok + single；bad 桶跳过
    assert out["badSkipped"] is True
    assert out["badNodesKept"] is True       # 合并失败时原 mesh 必须留在场景
    assert out["okNodesRemoved"] is True
    assert out["singleNotDisposed"] is True  # 单输入 = 原几何，仍在渲染
    assert out["pairDisposed"] is True
    assert out["materialByKey"] is True
    assert out["onMeshApplied"] is True
    assert out["parentAdded"] is True


def test_merge4_multi_base_accumulation():
    """四块拼接：基址逐块累加；跨块顶点位置正确。"""
    out = drive("merge4")
    assert out["ok"] is True
    assert out["vCount"] == 8
    # 基址 0,2,4（第三块）：idx [0,1, 2,3, 4,6,5, 7]
    assert out["idx"] == [0, 1, 2, 3, 4, 6, 5, 7]
    assert out["x2"] == 20                 # 第三块首顶点
    assert out["x3"] == 30                 # 第四块首顶点
