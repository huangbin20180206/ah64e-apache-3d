# -*- coding: utf-8 -*-
"""P10: 生成重点区域细节件低模 GLB（v3——以主 GLB 为背景参考精确对齐）。
流程：导入 assets/apache_v2.glb 作背景 → 用锚点对象 bbox 精确定位 → 生成细节件 →
按组 join 单 mesh → use_selection 导出（坐标与主 GLB 同 glTF 系）。
- assets/details/gun.glb      30mm 链炮炮口箍（锚 Cylinder.014）
- assets/details/wheels.glb   主轮毂+盘×2（锚 Cylinder.008/009）
（机首光电塔 turret.glb 已于修正批删除，其生成逻辑同步移除——见下方警示）
注意：Blender 导入 GLB 后节点名带点（Cylinder.014）；运行时 three 名无点（Cylinder014）。
主 GLB 文件轴与 three 世界轴存在交换（文件 x=前后 → three z=前后 + MODEL_LIFT y 抬升）。
细节件 GLB 独立加载时坐标=glTF 导出系（与主 GLB 文件一致）——挂到 apache.src 后由
GLTFLoader 统一解析，与主 GLB 处于同一 three 世界坐标 → 挂 src 即对齐（不挂锚点）。

**修正批警示（2026-09-08，总指挥复核）**：
1. `turret` 组**生成逻辑已移除**（assets/details/turret.glb 已删除）——原实现把"前后双环"的偏移
   误加到 Blender z（=世界 y 垂直轴），导致两枚 1 米环垂直叠放：世界包围盒高 2.17 单位（约 4m）、
   最低点低于地面 0.24 单位（约 45cm）。**若日后重做机首细节，偏移必须加在 Blender y（=世界 -z
   前后轴）**，半径须 ≤ 宿主该轴尺寸，且必须通过 62-detailparts 的 D2 世界 bbox 断言
   （包含性 ≤宿主+0.06 / 尺寸 ≤宿主×1.5 / 离地 ≥0.02）。
2. `gun` 组的供弹箱（P10_MetalDark 立方体）**生成逻辑已移除**（悬于机腹下方 0.24 单位无接触面），
   现役 gun.glb 仅含炮口箍（P10_Steel）。
3. 重跑本脚本会覆盖 assets/details/*.glb——若只重做机首件，请改输出到新文件名并单独验证，
   不要连带覆盖已验收的 gun/wheels。
"""
import bpy, sys, hashlib, os
from mathutils import Vector

SRC = r"C:\Users\huang\Kyle_Projects\apache_web\assets\apache_v2.glb"
OUTDIR = r"C:\Users\huang\Kyle_Projects\apache_web\assets\details"
os.makedirs(OUTDIR, exist_ok=True)

MATS = {}
def get_mat(name, color, rough=0.55, metal=0.5):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    MATS[name] = m
    return m

def find(name):
    for o in bpy.data.objects:
        if o.name == name:
            return o
    return None

def bbox_center(o):
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = [min(v[i] for v in bb) for i in range(3)]
    mx = [max(v[i] for v in bb) for i in range(3)]
    return [(mn[i]+mx[i])/2 for i in range(3)], mn, mx

def add_geo(name, bl_loc, bl_rot, prim, mat):
    if prim[0] == 'CYL':
        _, R, h, seg = prim
        bpy.ops.mesh.primitive_cylinder_add(radius=R, depth=h, vertices=seg, location=bl_loc, rotation=bl_rot)
    elif prim[0] == 'TOR':
        _, R, r, seg, ring = prim
        bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=ring, location=bl_loc, rotation=bl_rot)
    elif prim[0] == 'BOX':
        _, sx, sy, sz = prim
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=bl_loc, rotation=bl_rot)
        o = bpy.context.active_object
        o.scale = (sx, sy, sz)
    o = bpy.context.active_object
    o.name = name
    if not o.data.materials:
        o.data.materials.append(mat)
    else:
        o.data.materials[0] = mat
    return o

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    bpy.context.view_layer.update()
    M_DARK = get_mat('P10_MetalDark', (0.16, 0.17, 0.15), 0.6, 0.6)
    M_MET  = get_mat('P10_Metal', (0.20, 0.21, 0.19), 0.55, 0.5)
    M_STL  = get_mat('P10_Steel', (0.30, 0.31, 0.29), 0.4, 0.7)
    groups = {}

    # ---- 1) 链炮：锚 Cylinder.014（Blender 名）----
    gun_anchor = find('Cylinder.014')
    c, mn, mx = bbox_center(gun_anchor)
    ax = (mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2])
    print('GUN anchor bbox center=%s size=%s' % ([round(v,3) for v in c], [round(v,3) for v in ax]))
    # 炮管方向由 bbox 最长轴决定；Blender 场景轴 = 主 GLB 文件轴
    gun = []
    # 炮口箍两枚：沿炮管方向（Blender y = 世界 -z 前后轴）
    gun.append(add_geo('P10_Gun_Collar_A', (c[0], c[1]+0.30, c[2]), (1.5708,0,0),
                       ('TOR', 0.075, 0.022, 22, 8), M_STL))
    gun.append(add_geo('P10_Gun_Collar_B', (c[0], c[1]+0.45, c[2]), (1.5708,0,0),
                       ('TOR', 0.055, 0.020, 22, 8), M_STL))
    # 俯仰轴肘架：横向
    gun.append(add_geo('P10_Gun_Trunnion', (c[0], c[1]-0.05, c[2]-0.10), (0,1.5708,0),
                       ('CYL', 0.05, 0.34, 14), M_MET))
    groups['gun'] = ('gun.glb', gun)

    # ---- 2) 光电塔：已移除（修正批 2026-09-08）----
    # 原 turret 组的两枚 0.5 半径环用 tc[2]（Blender z = 世界 y 垂直轴）做 ±0.55 前后偏移，
    # 结果两环垂直叠放 → 世界 bbox 高 2.17 单位（约 4m）、最低点低于地面 0.24 单位；
    # 且环半径 0.50 远大于宿主传感器区域（0.55 高）。该资产已删除，生成逻辑一并移除，
    # 防止重跑脚本复活缺陷。若日后重做：偏移必须用 tc[1]（Blender y = 世界 -z 前后轴），
    # 半径须 ≤ 宿主该轴尺寸，并必须通过 62-detailparts D2 世界 bbox 硬断言。

    # ---- 3) 主轮：锚 Cylinder.008/009（左右轮）----
    wheels = []
    for sgn, nm in [(1,'R'), (-1,'L')]:
        wn = 'Cylinder.008' if sgn > 0 else 'Cylinder.009'
        w_anchor = find(wn)
        if w_anchor:
            wc, wmn, wmx = bbox_center(w_anchor)
        else:
            wc = [sgn*0.53, -2.195, -1.092]
        disc_rot = (0, 1.5708, 0)   # 圆柱沿 Blender x（轮轴）
        wheels.append(add_geo('P10_Wheel_%s_Disc' % nm, (wc[0]+sgn*0.08, wc[1], wc[2]), disc_rot,
                              ('CYL', 0.22, 0.030, 28), M_DARK))
        wheels.append(add_geo('P10_Wheel_%s_Hub' % nm, (wc[0]+sgn*0.11, wc[1], wc[2]), disc_rot,
                              ('CYL', 0.09, 0.050, 20), M_STL))
        wheels.append(add_geo('P10_Wheel_%s_Nub' % nm, (wc[0]+sgn*0.16, wc[1], wc[2]), disc_rot,
                              ('CYL', 0.025, 0.06, 10), M_STL))
        print('WHEEL %s anchor bbox center=%s' % (nm, [round(v,3) for v in wc]))
    groups['wheels'] = ('wheels.glb', wheels)

    # ---- 导出：每组 join 单 mesh ----
    for key, (fname, objs) in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        joined = bpy.context.active_object
        joined.name = 'P10_' + key
        out = os.path.join(OUTDIR, fname)
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        ev = joined.evaluated_get(deps)
        tris = sum(len(f.vertices)-2 for f in ev.data.polygons) if ev.data.polygons else 0
        bb = [joined.matrix_world @ Vector(v) for v in joined.bound_box]
        mn = [min(v[i] for v in bb) for i in range(3)]; mx = [max(v[i] for v in bb) for i in range(3)]
        h = hashlib.sha256(open(out,'rb').read()).hexdigest()
        print('EXPORT %s size=%d tris=%d bbox_bl[min=%s max=%s] sha=%s' %
              (fname, os.path.getsize(out), tris,
               [round(v,3) for v in mn], [round(v,3) for v in mx], h))

main()