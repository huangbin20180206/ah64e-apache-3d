#!/usr/bin/env bash
# asset1（2026-10-21）：目标模型 meshopt 压缩（体积约减半）
# 用法：bash tools/compress_glb.sh assets/targets/new_model.glb [...]
# 位置/UV/法线保持浮点（-vpf -vtf -vnf）：位置浮点不改节点变换；法线浮点避免软渲染丢上下文。
# -kn -km -ke 保留节点名/材质/extras（代码按节点名找炮塔、旋翼等）。
# gltfpack 会丢掉网格名（村落楼按网格名挑选），压完用 tools/restore_mesh_names.py 补回。
#
# 2026-11-08 修复（Windows / gltfpack 0.21）：
#   旧版把输入复制成 "$f.orig"，而 gltfpack 按**扩展名**识别输入格式，
#   遇到 .orig 直接报 `unknown extension (expected .gltf or .glb or .obj)`。
#   中转文件改为保留 .glb 后缀（去掉后再补回），并在失败路径用 trap 清理。
#   python3 在 Windows 常叫 py -3，这里按可用性依次回退。
set -e
GP=${GLTFPACK:-npx -y gltfpack@0.21}

if [ -n "$PYTHON" ]; then
  PY=$PYTHON
elif command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
elif command -v py >/dev/null 2>&1; then
  PY="py -3"
else
  echo "[compress_glb] 找不到 python3 / python / py，无法恢复网格名" >&2
  exit 1
fi

for f in "$@"; do
  case "$f" in
    *.glb) ;;
    *) echo "[compress_glb] 跳过非 .glb 输入: $f" >&2; continue ;;
  esac
  if [ ! -f "$f" ]; then echo "[compress_glb] 文件不存在: $f" >&2; exit 1; fi
  # 中转文件必须仍是 .glb：gltfpack 靠扩展名判格式
  src="${f%.glb}.__compress_src.glb"
  cleanup() { rm -f "$src"; }
  trap cleanup EXIT INT TERM
  cp "$f" "$src"
  $GP -i "$src" -o "$f" -cc -kn -km -ke -vpf -vtf -vnf
  $PY "$(dirname "$0")/restore_mesh_names.py" "$src" "$f"
  cleanup
  trap - EXIT INT TERM
  echo "[compress_glb] 完成: $f"
done
