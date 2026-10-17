# -*- coding: utf-8 -*-
# C006 车长测量 yaw 无关性测试（确定性）：
#   缺陷：applyModelToTarget 用**世界 AABB** 量车长，而 group 带场景朝向 yaw
#   （build() 朝向来袭方向；绕圈巡逻卡车每帧还改朝向）⇒ 缩放系数 defLen/curLen 随
#   yaw 浮动 ⇒ 实际车长短于 defLen 且随 yaw/换壳时机漂移。
#   修法：量之前把 group 场景旋转临时归零（保留模型自身 TARGET_MODELS.yaw），
#   并用逐顶点 AABB（precise）⇒ 任意 yaw 量到的都是模型自身长轴。
#
# 断言（同 type 的多个实例各带自己的 build yaw，逐一比对）：
#   A0 样本 yaw 必须真的分散（>5°）——否则"yaw 无关"无从验证（防空洞证明）
#   A1 施加的缩放系数与 yaw 无关（修正前随 yaw 浮动 ⇒ 本断言 FAIL，缺陷留痕）
#   A2 实际车长（group 局部长轴）恒定且收敛到 TARGET_MODELS.len（tank 4.3 / truck 3.1）
#   A3 truck 车宽仍为收窄后 ~1.10u（C004 wNarrow 仍在等比缩放之后生效；
#      未收窄会是 ~1.55u）
#   A4 对照组：barrel 无 len/wNarrow ⇒ 缩放恒 1（证明缩放路径只作用于登记类型）
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

DEF_LEN = {'tank': 4.3, 'truck': 3.1, 'ifv': 2.96}   # 2026-10-18 ifv=BMP-2 变体壳（按 t.mdl 分组）

MEASURE = r"""
() => {
  const out = [];
  for (const t of window.__dbg.targets.targets) {
    t.group.updateMatrixWorld(true);
    const ginv = t.group.matrixWorld.clone().invert();
    const v = t.pos.clone();
    const mn = { x: 1e9, y: 1e9, z: 1e9 }, mx = { x: -1e9, y: -1e9, z: -1e9 };
    t.group.traverse(o => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, a = pos.array;
      const m = ginv.clone().multiply(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        if (v.x < mn.x) mn.x = v.x; if (v.x > mx.x) mx.x = v.x;
        if (v.y < mn.y) mn.y = v.y; if (v.y > mx.y) mx.y = v.y;
        if (v.z < mn.z) mn.z = v.z; if (v.z > mx.z) mx.z = v.z;
      }
    });
    const inst = t.group.children[0];
    const yaw = (t.group.rotation.y % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    out.push({ type: t.mdl || t.type, yawDeg: yaw * 180 / Math.PI,
      scale: inst ? inst.scale.x : null,
      lx: mx.x - mn.x, lz: mx.z - mn.z,
      longAxis: Math.max(mx.x - mn.x, mx.z - mn.z) });
  }
  return out;
}
"""


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.targets)", timeout=60000)
    # 换壳完成判据：group.children[0] 是 gltf.scene 的克隆（Group）；程序化兜底直接塞 Mesh
    pg.wait_for_function(
        "() => { const t = window.__dbg.targets.targets.filter(x => x.type !== 'barrel');"
        " return t.length > 0 && t.every(x => x.group.children[0] && x.group.children[0].type === 'Group'); }",
        timeout=30000)
    pg.wait_for_timeout(300)
    rows = pg.evaluate(MEASURE)

    # 2026-10-18：BMP-2 变体壳只有 1 个基地实例，单独核车长
    ifv = [r for r in rows if r['type'] == 'ifv']
    assert ifv and abs(ifv[0]['longAxis'] - DEF_LEN['ifv']) < 0.02, ('A3: BMP-2 车长不等于 len', ifv)
    for typ in ('tank', 'truck'):
        sub = [r for r in rows if r['type'] == typ]
        assert len(sub) >= 2, ('A0: 该 type 实例不足，无法比对', typ, sub)
        yaws = [round(r['yawDeg'], 1) for r in sub]
        scales = [r['scale'] for r in sub]
        lens = [r['longAxis'] for r in sub]
        # A0：样本 yaw 必须真的分散
        assert max(yaws) - min(yaws) > 5.0, ('A0: 样本 yaw 过于集中，无法验证 yaw 无关性', typ, yaws)
        # A1：缩放系数与 yaw 无关（修正前随 yaw 浮动 ⇒ 此处 FAIL）
        assert max(scales) - min(scales) < 1e-4, \
            ('A1【缺陷判据】: 车长缩放系数随 group yaw 漂移（应恒定）', typ, yaws, scales)
        # A2：实际车长恒定且 = defLen
        assert max(lens) - min(lens) < 1e-4, ('A2: 实际车长随 yaw 漂移', typ, yaws, lens)
        assert all(abs(l - DEF_LEN[typ]) < 2e-3 for l in lens), \
            ('A2: 车长未收敛到 TARGET_MODELS.len', typ, lens, DEF_LEN[typ])
        print('A1/A2 PASS %-6s yaw=%s 缩放=%.5f(恒) 车长=%.4f(恒) defLen=%.1f'
              % (typ, yaws, scales[0], lens[0], DEF_LEN[typ]), flush=True)

    # A3：truck 车宽仍是 C004 收窄后的 ~1.10u（未收窄会是 ~1.55u）
    tr = [r for r in rows if r['type'] == 'truck']
    w = [r['lx'] for r in tr]
    assert all(1.05 < x < 1.16 for x in w), \
        ('A3: truck 车宽应仍为 wNarrow 收窄后的 ~1.10u（未收窄≈1.55u）', w)
    assert max(w) - min(w) < 1e-4, ('A3: truck 车宽也应恒定', w)
    print('A3 PASS truck 车宽=%.4fu(≈%.2fm, 收窄后) 且恒定' % (w[0], w[0] * 2.27), flush=True)

    # A4：对照组 barrel 无 len/wNarrow ⇒ 缩放恒 1
    ba = [r for r in rows if r['type'] == 'barrel']
    if ba:
        assert all(abs(r['scale'] - 1) < 1e-6 for r in ba), \
            ('A4: barrel 未登记 len，缩放应为 1', [r['scale'] for r in ba])
        print('A4 PASS 对照组 barrel 缩放恒 1（%d 个）' % len(ba), flush=True)

    print('target-len-yaw OK: 车长 yaw 无关（缩放恒定 + 车长=defLen + wNarrow 保序）')


H.guarded_main(run, hard_timeout=180)
print('PASS')
