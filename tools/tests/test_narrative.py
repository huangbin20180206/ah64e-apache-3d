# -*- coding: utf-8 -*-
# Phase 13-M5 环境叙事定向测试：
#   1) 底座（pad/靶场开）：narrative 存在、显隐 true
#   2) 切沙漠：雷达盘旋转角随时间推进（旋转动画）、巡逻编队位置沿轨道变化
#   3) 远交火烟柱 opacity 呼吸（>0 且随时间变化）
#   4) 湖面（靶场禁用）：narrative 同步隐藏（syncEnabled 联动）
#   5) 切回可显地形：恢复可见
# 值级断言走 __dbg.narrative.state() 只读遥测。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    # 1) 底座（pad）：narrative 存在且可见（靶场默认开）
    st0 = pg.evaluate("__dbg.narrative.state()")
    print('M5 底座:', st0)
    assert st0['enabled'] and st0['groupVisible'], ('M5: 底座叙事未显示', st0)
    # 2) 切沙漠 + 旋转/编队动画推进
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(600)
    pg.wait_for_function("() => __dbg.narrative.state().enabled", timeout=3000)
    r0 = pg.evaluate("__dbg.narrative.state().radarR")
    p0 = pg.evaluate("__dbg.narrative.state().patrol")
    # 最终闭环加强：烟柱"呼吸变化"不得用固定等待后检查 opacity>0.1 冒充——
    # 在同一个原子 evaluate 记录初值，wait_for_function 等至少一个烟柱 opacity
    # 改变量超过阈值（0.05），避免跨 evaluate 竞态与固定墙钟
    smokeBase = pg.evaluate("__dbg.narrative.state().smokeOpacity")
    print('M5 烟柱初值:', [round(o, 3) for o in smokeBase])
    pg.wait_for_function("""(base) => {
      const s = __dbg.narrative.state().smokeOpacity;
      return s.some((o, i) => Math.abs(o - base[i]) > 0.05);
    }""", arg=smokeBase, timeout=8000)
    pg.wait_for_timeout(2000)
    st1 = pg.evaluate("__dbg.narrative.state()")
    print('M5 沙漠推进后:', st1)
    assert abs(st1['radarR'] - r0) > 0.01, ('M5: 雷达盘未旋转', r0, st1['radarR'])
    # 巡逻编队位置变化（轨道移动）
    moved = any(abs(st1['patrol'][i]['x'] - p0[i]['x']) > 0.01 or abs(st1['patrol'][i]['z'] - p0[i]['z']) > 0.01
                for i in range(len(p0)))
    assert moved, ('M5: 巡逻编队未移动', p0, st1['patrol'])
    # 烟柱 opacity 呼吸变化（初值 vs 终值至少一个变化 >0.05）
    assert any(abs(st1['smokeOpacity'][i] - smokeBase[i]) > 0.05 for i in range(len(smokeBase))), \
        ('M5: 烟柱 opacity 未呼吸变化', smokeBase, st1['smokeOpacity'])
    print('M5 雷达/编队/烟柱呼吸 OK')

    # 6) 最终闭环加强：最坏视角 draw-call 增量验证——把相机移入基地（所有叙事
    #    对象入视锥），比较叙事开/关的 renderer.info.render.calls（增量 ≤8）
    pg.evaluate("""() => {
      const o = __dbg.orbit;
      o.tTarget.set(0, 1, 42); o.target.copy(o.tTarget);   // 基地中心
      o.tPhi = 0.8; o.tDist = 100; o.tTheta = 0.3;          // 远距俯视：水平半宽
                                                             // 100·sin0.8·tan17°≈22u
                                                             // > 基地对象最大偏移 18.8u → 全入镜
    }""")
    pg.wait_for_timeout(1500)
    # 确认待测叙事物件真实入视锥（复核修复：不得负 delta 或对象未入镜却算通过）：
    # 用 NDC 投影验证雷达盘/防空车/巡逻编队在画面内（禁 THREE 构造器——经
    # __dbg.W.camera 的 vectorToNDC 或现有实例）
    inView = pg.evaluate("""() => {
      const W = __dbg.W, narr = __dbg.narrative;
      const cam = W.camera;
      const tmp = cam.position.clone();   // 借现有实例（禁 THREE 构造器）
      const items = [];
      if (narr.radarDish && narr.radarDish.parent) items.push(narr.radarDish.parent);
      if (narr.patrol) for (const p of narr.patrol) items.push(p.g);
      let visible = 0;
      for (const obj of items) {
        obj.updateWorldMatrix(true, false);            // 刷新 matrixWorld（否则旧矩阵）
        const wp = tmp.setFromMatrixPosition(obj.matrixWorld);
        const ndc = wp.project(cam);
        if (ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) < 1.2 && Math.abs(ndc.y) < 1.2) visible++;
      }
      return { total: items.length, visible,
        camPos: [cam.position.x.toFixed(1), cam.position.y.toFixed(1), cam.position.z.toFixed(1)] };
    }""")
    print('M5 叙事物件入镜:', inView)
    assert inView['visible'] >= inView['total'] - 1, ('M5: 叙事物件未全部入视锥（无法验证最坏视角）', inView)
    def draws():
        return pg.evaluate("""new Promise(res => {
          const r = __dbg.renderer; r.info.autoReset = false; r.info.reset();
          let n = 0; const t0 = performance.now();
          function f(){ n++; if (performance.now() - t0 < 400) requestAnimationFrame(f);
            else { const ir = r.info.render; r.info.autoReset = true;
                   res({ calls: Math.round(ir.calls / n), tris: Math.round(ir.triangles / n) }); } }
          requestAnimationFrame(f);
        })""")
    dOn = draws()
    pg.evaluate("__dbg.narrative.group.visible = false")   # 最坏视角对照（隐藏叙事）
    pg.wait_for_timeout(1200)
    dOff = draws()
    pg.evaluate("__dbg.narrative.group.visible = true")
    print('M5 最坏视角 draw-call: 开=', dOn, '关=', dOff)
    delta = dOn['calls'] - dOff['calls']
    # 复核修复：增量必须 0 <= delta <= 8（负 delta=对象未入镜/隐藏其他内容=无效测量）
    assert 0 <= delta <= 8, ('M5: draw-call 增量需在 [0,8]（负=未入镜/超=超标）', dOn, dOff, delta)
    print('M5 最坏视角 draw-call 增量 OK:', delta)
    # 4) 湖面 → 靶场禁用 → 叙事隐藏（syncEnabled）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_function("() => !__dbg.targets.enabled", timeout=3000)
    pg.wait_for_timeout(400)
    stW = pg.evaluate("__dbg.narrative.state()")
    assert not stW['groupVisible'], ('M5: 湖面叙事未隐藏', stW)
    print('M5 湖面隐藏 OK:', stW['groupVisible'])
    # 5) 切回 desert → 恢复可见
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_function("() => __dbg.targets.enabled", timeout=3000)
    pg.wait_for_function("() => __dbg.narrative.state().groupVisible", timeout=3000)
    print('M5 恢复 OK')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')