#!/usr/bin/env bash
# asset1（2026-10-21）：目标模型 meshopt 压缩（体积约减半）
# 用法：bash tools/compress_glb.sh assets/targets/new_model.glb [...]
# 位置/UV/法线保持浮点（-vpf -vtf -vnf）：位置浮点不改节点变换；法线浮点避免软渲染丢上下文。
# -kn -km -ke 保留节点名/材质/extras（代码按节点名找炮塔、旋翼等）。
# gltfpack 会丢掉网格名（村落楼按网格名挑选），压完用 tools/restore_mesh_names.py 补回。
set -e
GP=${GLTFPACK:-npx -y gltfpack@0.21}
for f in "$@"; do
  cp "$f" "$f.orig"
  $GP -i "$f.orig" -o "$f" -cc -kn -km -ke -vpf -vtf -vnf
  python3 "$(dirname "$0")/restore_mesh_names.py" "$f.orig" "$f"
  rm "$f.orig"
done
