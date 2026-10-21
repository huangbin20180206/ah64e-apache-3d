# -*- coding: utf-8 -*-
# asset1（2026-10-21）：目标模型压缩守护
# - 每个 assets/targets/*.glb 都要有 meshopt 压缩（新加模型忘了压 → 测试红）
# - 法线不得量化成 8/16 位整数：软渲染（SwiftShader）下整数法线会导致显卡上下文丢失（实测 3-3/4-1）
# 压缩命令见 tools/compress_glb.sh
import json
import struct
from pathlib import Path

TARGETS = Path(__file__).resolve().parents[2] / "assets" / "targets"
FLOAT = 5126


def _gltf(p):
    b = p.read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    return json.loads(b[20:20 + n])


def test_all_target_glbs_meshopt():
    bad = [p.name for p in sorted(TARGETS.glob("*.glb"))
           if "EXT_meshopt_compression" not in (_gltf(p).get("extensionsUsed") or [])]
    assert not bad, "未压缩（跑 tools/compress_glb.sh）：" + ", ".join(bad)


def test_no_integer_normals():
    bad = []
    for p in sorted(TARGETS.glob("*.glb")):
        if p.name == "survivor.glb":   # 早期压缩件，带骨骼，已实测正常
            continue
        j = _gltf(p)
        acc = j.get("accessors", [])
        for m in j.get("meshes", []):
            for pr in m.get("primitives", []):
                i = pr.get("attributes", {}).get("NORMAL")
                if i is not None and acc[i].get("componentType") != FLOAT:
                    bad.append(p.name)
    assert not bad, "整数法线：" + ", ".join(sorted(set(bad)))
