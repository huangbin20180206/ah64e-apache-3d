# fbx2glb.py — 3D 产物 → 归一化 GLB（Blender 无头模式）
# 用法: blender -b -P fbx2glb.py -- <src.fbx|src.glb> <dst.glb> <目标长度单位u>
import bpy, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, length = argv[0], argv[1], float(argv[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith(('.glb', '.gltf')):
    bpy.ops.import_scene.gltf(filepath=src)
else:
    bpy.ops.import_scene.fbx(filepath=src)

# 贴图降采样（4K 内嵌贴图是体积大头）
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, max(1, int(1024 * img.size[1] / img.size[0])))

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tris = sum(len(m.data.polygons) for m in meshes)
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
size = mx - mn

# 归一化：最长水平维度 → length 单位；包围盒中心落在原点、底部贴地
# 关键：挂【顶层对象】（任意类型）——GLB 导入常带空物体层级，只挂无父级
# 网格会让带父级的子树漏掉缩放（T-80U 曾整树原尺寸 10.67u 直接进页面）
s = length / max(size.x, size.y, 1e-6)
root = bpy.data.objects.new('ROOT', None)
bpy.context.scene.collection.objects.link(root)
for o in bpy.context.scene.objects:
    if o is not root and o.parent is None:
        o.parent = root
root.scale = (s, s, s)
c = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z)
root.location = (-c[0] * s, -c[1] * s, -c[2] * s)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
print('FBX2GLB', os.path.basename(dst), 'objs', len(meshes), 'tris', tris,
      'src_size', tuple(round(v, 2) for v in size), 'scale', round(s, 4),
      'KB', round(os.path.getsize(dst) / 1024))
