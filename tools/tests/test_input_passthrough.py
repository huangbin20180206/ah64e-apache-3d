# -*- coding: utf-8 -*-
# 最终闭环修复一：过场输入穿透验证。
# 过场激活时，跳过事件必须被消费（preventDefault+stopImmediatePropagation），
# 同一事件不得继续触发全局输入：空格启停旋翼 / C 切换 FPV / T 起降 / F 地狱火
# / G 机炮 / pointerdown 被 Orbit 接收取消返回镜头。
# 流程：启动任务过场（无 ?nocut）→ 分别用空格/C/T/F/pointerdown 跳过 →
#   验证过场结束 + 旋翼/视角/起落/武器/任务状态未被同一事件修改；
#   pointerdown 后验证返回镜头未被取消（orbit 未被拖拽改变）。
# 状态捕获与断言原子化（同一 evaluate 记录基线 + 事件 + 读结果）。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=0', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    pg.wait_for_function("() => __dbg.apache && __dbg.rig && __dbg.fp", timeout=60000)

    # 基线：旋翼停、地面、满弹药、无任务、未进 FPV
    def base():
        return pg.evaluate("""() => ({
          running: __dbg.S.running, spin: +__dbg.S.spin.toFixed(3),
          fly: __dbg.FLY.state, fp: __dbg.fp.active,
          gun: __dbg.rig.gunAmmo, rk: __dbg.rig.rocketAmmo, hf: __dbg.rig.hfAmmo,
          mission: __dbg.mission ? __dbg.mission.phase : null,
          orbit: { t: [__dbg.orbit.tTarget.x.toFixed(1), __dbg.orbit.tTarget.y.toFixed(1), __dbg.orbit.tTarget.z.toFixed(1)],
                   theta: +__dbg.orbit.tTheta.toFixed(2), phi: +__dbg.orbit.tPhi.toFixed(2), dist: +__dbg.orbit.tDist.toFixed(1) }
        })""")

    # 启动任务 → mission cutscene（round 1）
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState && __dbg.cutsceneState.on && __dbg.cutsceneState.preset === 'mission'", timeout=6000)

    # 1) 空格跳过：旋翼不得被同一事件启停
    pg.evaluate("""() => { window.__p13base = __dbg.S.running; }""")
    pg.keyboard.press(' ')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    st = pg.evaluate("() => ({ on: __dbg.cutsceneState.on, running: __dbg.S.running, base: window.__p13base })")
    assert not st['on'], '空格应结束过场'
    assert st['running'] == st['base'], ('空格跳过不应改变旋翼状态', st)
    print('输入穿透 空格 OK: running 未变')
    pg.wait_for_timeout(600)

    # 2) C 跳过：FPV 不得被切换（需重启过场——新轮次）
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState.on", timeout=6000)
    pg.evaluate("() => { window.__p13fp = __dbg.fp.active; }")
    pg.keyboard.press('KeyC')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    st = pg.evaluate("() => ({ on: __dbg.cutsceneState.on, fp: __dbg.fp.active, base: window.__p13fp })")
    assert not st['on'] and st['fp'] == st['base'], ('C 跳过不应切换 FPV', st)
    print('输入穿透 C OK: FPV 未切换')
    pg.wait_for_timeout(600)

    # 3) T 跳过：起落状态不得被改（地面保持 ground）
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState.on", timeout=6000)
    pg.evaluate("() => { window.__p13fly = __dbg.FLY.state; }")
    pg.keyboard.press('KeyT')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    st = pg.evaluate("() => ({ on: __dbg.cutsceneState.on, fly: __dbg.FLY.state, base: window.__p13fly })")
    assert not st['on'] and st['fly'] == st['base'], ('T 跳过不应改起落状态', st)
    print('输入穿透 T OK: 起落状态未变')
    pg.wait_for_timeout(600)

    # 4) F 跳过：武器不得发射
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState.on", timeout=6000)
    hf0 = pg.evaluate("__dbg.rig.hfAmmo")
    pg.keyboard.press('KeyF')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    hf1 = pg.evaluate("__dbg.rig.hfAmmo")
    assert hf0 == hf1, ('F 跳过不应发射地狱火', hf0, hf1)
    print('输入穿透 F OK: 地狱火未发射')
    pg.wait_for_timeout(600)

    # 4b) G 跳过：机炮不得连发（有效前置：记录 gunAmmo/gunOn）
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState.on", timeout=6000)
    g0 = pg.evaluate("() => ({ ammo: __dbg.rig.gunAmmo, on: __dbg.rig.gunOn })")
    pg.keyboard.down('KeyG')
    pg.wait_for_timeout(150)
    pg.keyboard.up('KeyG')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    g1 = pg.evaluate("() => ({ ammo: __dbg.rig.gunAmmo, on: __dbg.rig.gunOn })")
    assert g0['ammo'] == g1['ammo'] and g0['on'] == g1['on'], ('G 跳过不应连发机炮', g0, g1)
    print('输入穿透 G OK: 机炮未连发')
    pg.wait_for_timeout(600)

    # 4c) X 跳过：火箭不得连发
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState.on", timeout=6000)
    x0 = pg.evaluate("() => ({ ammo: __dbg.rig.rocketAmmo, on: __dbg.rig.rocketOn })")
    pg.keyboard.down('KeyX')
    pg.wait_for_timeout(150)
    pg.keyboard.up('KeyX')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    x1 = pg.evaluate("() => ({ ammo: __dbg.rig.rocketAmmo, on: __dbg.rig.rocketOn })")
    assert x0['ammo'] == x1['ammo'] and x0['on'] == x1['on'], ('X 跳过不应连发火箭', x0, x1)
    print('输入穿透 X OK: 火箭未连发')
    pg.wait_for_timeout(600)

    # 4d) B 跳过：不得重置靶场/任务（有效前置：记录 targets 计数与任务 phase）
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState.on", timeout=6000)
    b0 = pg.evaluate("() => ({ alive: __dbg.targets.aliveCount, phase: __dbg.mission ? __dbg.mission.phase : null })")
    pg.keyboard.press('KeyB')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    b1 = pg.evaluate("() => ({ alive: __dbg.targets.aliveCount, phase: __dbg.mission ? __dbg.mission.phase : null })")
    assert b0['alive'] == b1['alive'] and b0['phase'] == b1['phase'], ('B 跳过不应重置靶场/任务', b0, b1)
    print('输入穿透 B OK: 靶场/任务未重置')
    pg.wait_for_timeout(600)

    # 5) pointerdown 跳过：过场结束 + 返回镜头未被同一事件取消——
    #    验证返回镜头在后续帧仍活动（orbit 可用 + 相机 matrixWorld 可响应拖动）
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState.on", timeout=6000)
    o0 = pg.evaluate("({theta: __dbg.orbit.tTheta, phi: __dbg.orbit.tPhi, dist: __dbg.orbit.tDist})")
    pg.mouse.down()
    pg.mouse.up()
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    # B6+：setView 的缓动目标由 loop 逐帧逼近——等 tDist 到位再断言（分类器真候选 L122→L126）
    pg.wait_for_function("() => Math.abs(__dbg.orbit.tDist - 12.6) < 3", timeout=15000)
    o1 = pg.evaluate("({theta: __dbg.orbit.tTheta, phi: __dbg.orbit.tPhi, dist: __dbg.orbit.tDist})")
    print('pointerdown 后 orbit:', o0, '->', o1)
    # 跳过会 setView(0)（英雄机位），orbit 应处于受控收敛状态而非被拖拽取消
    assert abs(o1['dist'] - 12.6) < 3, ('pointerdown 跳过不应把返回镜头取消（dist 漂移）', o1)
    # 后续帧仍活动：orbit 启用 + 相机 matrixWorld 能响应一次拖动（指针未被同事件吞死）
    orbOn = pg.evaluate("__dbg.orbit.enabled")
    cam0 = pg.evaluate("__dbg.W.camera.matrixWorld.elements[12]")   # 相机 x
    pg.mouse.move(300, 300)
    pg.mouse.down()
    pg.mouse.move(340, 300, steps=5)   # 拖 40px
    pg.mouse.up()
    pg.wait_for_timeout(500)
    cam1 = pg.evaluate("__dbg.W.camera.matrixWorld.elements[12]")
    print('返回镜头后续帧: orbit.enabled=%s cam x %.2f -> %.2f' % (orbOn, cam0, cam1))
    assert orbOn, ('pointerdown 跳过不应禁用 orbit', orbOn)
    assert abs(cam1 - cam0) > 0.05, ('返回镜头应能响应后续拖动（未被同一事件吞死）', cam0, cam1)
    print('输入穿透 pointerdown OK: 返回镜头后续帧仍活动')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')