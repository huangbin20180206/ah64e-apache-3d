# Phase 0 核心回归：0.1 FPV 鼠标单次累加 / 0.2 任务重置可再触发（B 键 + UI 按钮双路径）
#                   / 0.3 救援跨地形全状态矩阵（真实绞车流程到 delivered，不直接写 state）
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp && __dbg.rescue && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S.mode = 'mission'")   # P6：任务测试声明处于任务模式（接近触发是任务模式兼容路径）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1200)
    pg.evaluate("__dbg.air.enabled = false")   # 空中靶机不干扰全歼判定

    # ---------- 0.1 FPV mouse 单次累加 ----------
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=20; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.keyboard.press('KeyC')
    pg.wait_for_function("() => __dbg.fp.active === true", timeout=5000)   # B2：enter 同步置位，条件等待免固定窗
    y0 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    pg.evaluate("__dbg.fp.mouse(10, 0)")       # 一次 dx=10
    y1 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    delta1 = y0 - y1
    assert abs(delta1 - 0.040) < 0.001, ('mouse dx=10 should yield exactly 0.040 yaw delta', y0, y1, delta1)
    pg.evaluate("__dbg.fp.mouse(10, 0)")
    y2 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    delta2 = y1 - y2
    assert abs(delta2 - 0.040) < 0.001, ('second mouse call should also be exactly 0.040 (no compounding)', y1, y2, delta2)
    # 垂直输入同样只计算一次：dy=10 → vPitch 精确 +0.040，且与水平轴互不串扰。
    # （2026-10-14 起鼠标下移=机头下俯：vPitch 与 dy 同号，故此处为 p1-p0=+0.040；
    #  反转前为 vPitch -= dy*sens，期望式是 p0-p1，那次改动时本测试未同步）
    p0 = pg.evaluate("+__dbg.fp.vPitch.toFixed(5)")
    pg.evaluate("__dbg.fp.mouse(0, 10)")
    y3 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    p1 = pg.evaluate("+__dbg.fp.vPitch.toFixed(5)")
    assert y3 == y2, ('dy must not touch yaw', y2, y3)
    assert abs((p1 - p0) - 0.040) < 0.001, ('mouse dy=10 should add pitch exactly 0.040 once', p0, p1)
    pg.evaluate("__dbg.fp.mouse(0, 10)")
    p2 = pg.evaluate("+__dbg.fp.vPitch.toFixed(5)")
    assert abs((p2 - p1) - 0.040) < 0.001, ('second dy call should also be exactly 0.040 (no compounding)', p1, p2)
    print('0.1 FPV mouse: dx=10 -> deltaYaw=%.4f twice; dy=10 -> deltaPitch=%.4f twice; cross-axis isolated' % (delta1, p1 - p0))
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(600)

    # ---------- 0.2 任务重置后再次触发（B 键路径 + UI 按钮路径） ----------
    # 接近基地（z=53，距基地中心 22u；2026-10-15 P4f 基地 z 42→75，同步 20→53）→ 简报触发
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=53; "
                "__dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    # B2：接近触发是 loop 每帧检测（帧派生）——条件等待取代固定 1800ms
    pg.wait_for_function("() => __dbg.S._baseFound === true && __dbg.S._mission && document.getElementById('mission').classList.contains('show')", timeout=15000)
    st1 = pg.evaluate("({m:__dbg.S._mission, found:__dbg.S._baseFound, t0:__dbg.S._mission && __dbg.S._mission.t0, "
                      "show:document.getElementById('mission').classList.contains('show')})")
    assert st1['m'] and st1['found'] is True and st1['show'], ('first briefing not triggered', st1)
    print('0.2 first briefing OK (t0=%.2f)' % st1['t0'])
    # B 键重置：先飞离基地再按 B（重置时直升机若仍在 30u 内，发现逻辑会合法地
    # 同帧重新触发——先飞离才能断言"清空"）
    pg.evaluate("__dbg.FLY.z = -20")       # 95u > 30u 阈值（2026-10-15 P4f 基地北移后距 95u，原 62u）
    pg.wait_for_timeout(400)
    pg.keyboard.press('KeyB')
    pg.wait_for_timeout(800)
    st2 = pg.evaluate("({m:__dbg.S._mission, found:__dbg.S._baseFound, "
                      "show:document.getElementById('mission').classList.contains('show')})")
    assert st2['m'] is None and st2['found'] is False and not st2['show'], \
        ('B reset did not clear mission/_baseFound', st2)
    print('0.2 B-key reset OK: _mission=null, _baseFound===false, panel closed')
    # 再次接近 → 第二次触发（t0 必须前进，证明是新一轮简报而非旧 DOM 残留）
    # （2026-10-15 P4f：接近点随基地 20→53）
    pg.evaluate("__dbg.FLY.z = 53")
    pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.t0 > %s && document.getElementById('mission').classList.contains('show')" % st1['t0'], timeout=15000)
    st3 = pg.evaluate("({m:__dbg.S._mission, t0:__dbg.S._mission && __dbg.S._mission.t0, "
                      "show:document.getElementById('mission').classList.contains('show')})")
    assert st3['m'] and st3['show'] and st3['t0'] > st1['t0'], ('second briefing not re-triggered', st3)
    print('0.2 second briefing OK (t0 %.2f -> %.2f, new trigger)' % (st1['t0'], st3['t0']))
    # UI 按钮路径：飞离 → 点"重置靶场"按钮 → 同样复位
    pg.evaluate("__dbg.FLY.z = -20")
    pg.wait_for_timeout(400)
    pg.evaluate("document.getElementById('btn-reset-targets').click()")
    pg.wait_for_timeout(800)
    st4 = pg.evaluate("({m:__dbg.S._mission, found:__dbg.S._baseFound, "
                      "show:document.getElementById('mission').classList.contains('show'), "
                      "toast:document.getElementById('toast').textContent})")
    assert st4['m'] is None and st4['found'] is False and not st4['show'], \
        ('UI button reset did not clear mission/_baseFound', st4)
    print('0.2 UI-button reset OK (toast=%s)' % st4['toast'])
    # 再次接近 → 第三次触发（两条路径等价）（2026-10-15 P4f：接近点 20→53）
    pg.evaluate("__dbg.FLY.z = 53")
    pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.t0 > %s && document.getElementById('mission').classList.contains('show')" % st3['t0'], timeout=15000)
    st5 = pg.evaluate("({m:__dbg.S._mission, t0:__dbg.S._mission && __dbg.S._mission.t0, "
                      "show:document.getElementById('mission').classList.contains('show')})")
    assert st5['m'] and st5['show'] and st5['t0'] > st3['t0'], ('third briefing not re-triggered', st5)
    print('0.2 third briefing OK after UI reset (t0 %.2f -> %.2f)' % (st3['t0'], st5['t0']))
    # 全歼 → 结算面板 → 飞离后重置收尾（done 判定在 loop 0.5s 块——条件等待）
    pg.evaluate("__dbg.targets.targets.forEach(t=>{ if(t.alive) __dbg.targets.destroy(t,3); })")
    pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.done === true", timeout=15000)
    res = pg.evaluate("({done:!!__dbg.S._mission.done, hasGrade:document.getElementById('mission-body').innerHTML.includes('评级')})")
    assert res['done'] and res['hasGrade'], ('results panel missing', res)
    print('0.2 mission complete panel OK')
    pg.evaluate("__dbg.FLY.z = -20")
    pg.wait_for_timeout(400)
    pg.keyboard.press('KeyB')
    pg.wait_for_timeout(600)

    # ---------- 0.3 救援跨地形全状态矩阵（真实流程，不直接写 state） ----------
    # 规则（48-rescue.js setTerrain）：idle → 有效地形生成；deploying/holding/
    # lifting/retracting → 任何切换安全取消（有效地形重新生成，无效地形隐藏）；
    # aboard → 任何场地保留（幸存者在机上不在地面，无法被"取消"）；
    # delivered → 终态，任何切换不复活；water/pad → 无地面幸存者。
    # ① 沙漠 → 幸存者生成（26,-14）
    st6 = pg.evaluate("({ok:__dbg.rescue.ok, gvis:__dbg.rescue.g.visible, state:__dbg.rescue.state})")
    assert st6['ok'] and st6['gvis'] and st6['state'] == 'idle', ('desert survivor missing', st6)
    print('0.3 desert spawn OK')
    # ② 悬停幸存者上方 8u → K 放绞车 → deploying
    # （FLY.fp=true 让位高度控制：环绕悬停分支每帧把 alt 钉回 HOVER=14，
    #   不让位则 alt=8 无效、绳放不到底——navlights/sink 测试同款手法）
    pg.evaluate("__dbg.FLY.fp=true; __dbg.FLY.state='hover'; __dbg.FLY.pitch=0; "
                "__dbg.FLY.alt=8; __dbg.FLY.x=26; __dbg.FLY.z=-14; __dbg.S._alt=0")
    pg.keyboard.press('KeyK')
    pg.wait_for_timeout(800)
    st7 = pg.evaluate("({state:__dbg.rescue.state, rope:__dbg.rescue.rope.visible})")
    assert st7['state'] == 'deploying' and st7['rope'], ('winch not deploying', st7)
    print('0.3 deploying OK')
    # ③ 再按 K → retracting → 收回至 idle（绳钩隐藏；收回动画时长收敛——条件等待）
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => __dbg.rescue.state === 'idle' && !__dbg.rescue.rope.visible && !__dbg.rescue.hook.visible", timeout=15000)
    st8 = pg.evaluate("({state:__dbg.rescue.state, rope:__dbg.rescue.rope.visible, hook:__dbg.rescue.hook.visible})")
    assert st8['state'] == 'idle' and not st8['rope'] and not st8['hook'], ('retract did not return to idle', st8)
    print('0.3 retracting -> idle OK')
    # ④ 重新部署 → 部署中切水面 → 安全中止（ok=false、绳钩隐藏、无幸存者）
    pg.keyboard.press('KeyK')
    pg.wait_for_timeout(600)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(1000)
    st9 = pg.evaluate("({ok:__dbg.rescue.ok, state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, "
                      "rope:__dbg.rescue.rope.visible, hook:__dbg.rescue.hook.visible})")
    assert not st9['ok'] and st9['state'] == 'idle' and not st9['gvis'] \
        and not st9['rope'] and not st9['hook'], ('mid-deploy water switch did not abort cleanly', st9)
    print('0.3 mid-deploy water abort OK (rope/hook hidden, no survivor)')
    # ⑤ 水面 → 草原：恢复生成（无状态残留，幸存者在草原初始位 22,-10）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"grass\"]').click()")
    pg.wait_for_timeout(1200)
    st10 = pg.evaluate("({ok:__dbg.rescue.ok, state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, "
                       "gx:+__dbg.rescue.g.position.x.toFixed(1), gz:+__dbg.rescue.g.position.z.toFixed(1)})")
    assert st10['ok'] and st10['state'] == 'idle' and st10['gvis'] and st10['gx'] == 22.0 and st10['gz'] == -10.0, \
        ('grass respawn after water not clean', st10)
    print('0.3 recovery respawn on grass OK at (%s, %s)' % (st10['gx'], st10['gz']))
    # ⑥ 悬停偏离幸存者 6u → K → 绳放到底但距离 >2u → holding（等待对位）
    pg.evaluate("__dbg.FLY.x=28; __dbg.FLY.z=-10")
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => __dbg.rescue.state === 'holding' && __dbg.rescue.rope.visible", timeout=15000)   # 绳放动画收敛
    st11 = pg.evaluate("({state:__dbg.rescue.state, rope:__dbg.rescue.rope.visible})")
    assert st11['state'] == 'holding' and st11['rope'], ('not holding with hook down off-target', st11)
    print('0.3 holding OK (hook down, survivor 6u away)')
    # ⑦ 平移到幸存者正上方 → 自动挂接 → lifting（loop 检测——条件等待）
    pg.evaluate("__dbg.FLY.x=22; __dbg.FLY.z=-10")
    pg.wait_for_function("() => __dbg.rescue.state === 'lifting'", timeout=15000)
    st12 = pg.evaluate("__dbg.rescue.state")
    assert st12 == 'lifting', ('not lifting after alignment', st12)
    print('0.3 lifting OK (attached)')
    # ⑧ 收绞车 → 幸存者进机内 → aboard（地面模型隐藏；提升动画收敛）
    pg.wait_for_function("() => __dbg.rescue.state === 'aboard' && !__dbg.rescue.g.visible", timeout=15000)
    st13 = pg.evaluate("({state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible})")
    assert st13['state'] == 'aboard' and not st13['gvis'], ('not aboard after lift', st13)
    print('0.3 aboard OK (real flow)')
    # ⑨ aboard 中切沙漠 → 保留待送回（不在地面重新生成幸存者/烟/信标）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1200)
    st14 = pg.evaluate("({state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, svis:__dbg.rescue.smoke.visible, "
                       "ok:__dbg.rescue.ok})")
    assert st14['state'] == 'aboard' and not st14['gvis'] and not st14['svis'] and st14['ok'], \
        ('aboard not preserved across valid terrains', st14)
    print('0.3 aboard preserved grass->desert OK')
    # ⑩ aboard 中切停机坪 → 同样保留（幸存者在机上不在地面，无法被取消）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    pg.wait_for_timeout(1000)
    st15 = pg.evaluate("({ok:__dbg.rescue.ok, state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, "
                       "svis:__dbg.rescue.smoke.visible})")
    assert not st15['ok'] and st15['state'] == 'aboard' and not st15['gvis'] and not st15['svis'], \
        ('aboard should persist onto pad (survivor is in the aircraft)', st15)
    print('0.3 aboard preserved onto pad OK')
    # ⑪ 真实送达：停机坪坪心低空悬停（<8u、<4u）→ delivered（全程不写 state；
    # 送达判定在 loop 每帧——条件等待取代固定 1800ms）
    pg.evaluate("__dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.alt=3; __dbg.S._alt=0")
    pg.wait_for_function("() => __dbg.rescue.state === 'delivered' && !__dbg.rescue.g.visible && !__dbg.rescue.smoke.visible", timeout=15000)
    st16 = pg.evaluate("({state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, svis:__dbg.rescue.smoke.visible, "
                       "toast:document.getElementById('toast').textContent})")
    assert st16['state'] == 'delivered' and not st16['gvis'] and not st16['svis'], \
        ('real rescue flow did not deliver on pad', st16)
    print('0.3 delivered via real flow on pad OK (toast=%s)' % st16['toast'])
    # ⑫ delivered 后切草原 → 不复活（终态）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"grass\"]').click()")
    pg.wait_for_timeout(1000)
    st17 = pg.evaluate("({ok:__dbg.rescue.ok, state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, "
                       "svis:__dbg.rescue.smoke.visible})")
    assert st17['ok'] and st17['state'] == 'delivered' and not st17['gvis'] and not st17['svis'], \
        ('delivered survivor resurrected on grass', st17)
    print('0.3 delivered stays hidden on grass OK')
    # ⑬ delivered 后切水面 → 不复活、本场地无幸存者
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(1000)
    st18 = pg.evaluate("({ok:__dbg.rescue.ok, state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, "
                       "rope:__dbg.rescue.rope.visible})")
    assert not st18['ok'] and st18['state'] == 'delivered' and not st18['gvis'] and not st18['rope'], \
        ('delivered resurrected on water', st18)
    print('0.3 delivered stays hidden on water OK')
    # 收尾：退出悬停让位态，复位飞行状态机（不留状态给后续测试）
    pg.evaluate("__dbg.FLY.fp=false; __dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.FLY.pitch=0; "
                "__dbg.FLY.comp=0; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.S._alt=0")
    pg.wait_for_timeout(400)

import pw_harness as H
H.guarded_main(run, hard_timeout=300)
print('PASS')
