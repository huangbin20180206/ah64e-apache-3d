# 第一人称驾驶+瞄准 功能验证：C 进出、指针锁定、HUD、WASD 位移、R/Q 升降、
# A/D 转向、三武器发射（机炮/火箭/地狱火）、退出恢复。走 pw_harness 护具。
# 用法: uv run --with playwright --with pillow python test_fpv.py
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#btn-panel') && document.querySelector('#btn-panel').click()")

    # 强制悬停（跳过 9s 起旋/爬升；FP.enter 要求 state==='hover'）
    pg.evaluate("__dbg.FLY.state = 'hover'; __dbg.FLY.alt = 14; __dbg.FLY.pitch = 0; __dbg.FLY.comp = 0")

    # 1) C 进出：active/指针锁定/HUD/座舱隐藏/环绕禁用
    pg.keyboard.press('c')
    pg.wait_for_timeout(600)
    st = pg.evaluate("""() => ({
        active: __dbg.fp.active, locked: !!document.pointerLockElement,
        hud: document.querySelector('#fp-hud').style.display,
        cockpit: __dbg.apache.get('Cube001_2').visible,
        orbitOff: !__dbg.orbit.enabled })""")
    assert st['active'] and st['locked'], ('fp enter', st)
    assert st['hud'] == 'block', ('fp hud shown', st)
    assert st['cockpit'] is False, ('cockpit hidden', st)
    assert st['orbitOff'], ('orbit disabled', st)

    # 相机贴眼位：与 root·eye 的世界坐标一致
    cam_err = pg.evaluate("""() => {
        const nl = __dbg, e = nl.fp.eye.clone();
        __dbg.apache.root.localToWorld(e);
        return __dbg.W.camera.position.distanceTo(e);
    }""")
    assert cam_err < 0.15, ('camera at eye', cam_err)

    # 2) W 前进 1.5s：FLY.x/z 位移 > 2u（本轮修复的回归断言）
    x0, z0 = pg.evaluate("[__dbg.FLY.x, __dbg.FLY.z]")
    # B6+：改为"按到达标才松键"（沿用 B1 flight_tactics 实证的模式）——
    # 固定按住在低帧环境跑不了几帧 update，位移/姿态累积不达标，松键即衰减，
    # 断言永远等不到。改条件保持后与帧率无关（分类器真候选 L40）。
    pg.keyboard.down('w')
    try:
        pg.wait_for_function("([x0, z0]) => Math.abs(__dbg.FLY.x - x0) + Math.abs(__dbg.FLY.z - z0) > 2",
                             arg=[x0, z0], timeout=15000)
    finally:
        pg.keyboard.up('w')
    pg.wait_for_timeout(200)
    mv = pg.evaluate("() => { const F = __dbg.FLY; return { dx: F.x - (%s), dz: F.z - (%s), spd: __dbg.fp.spd } }" % (x0, z0))
    moved = abs(mv['dx']) + abs(mv['dz'])
    assert moved > 2, ('FP forward movement', mv)
    print('forward moved %.2fu, spd=%.1f' % (moved, mv['spd']))

    # 3) A 转向：yaw 变化
    yaw0 = pg.evaluate("__dbg.FLY.yaw")
    # B6+：改为"按到达标才松键"（沿用 B1 flight_tactics 实证的模式）——
    # 固定按住在低帧环境跑不了几帧 update，位移/姿态累积不达标，松键即衰减，
    # 断言永远等不到。改条件保持后与帧率无关（分类器真候选 L51）。
    pg.keyboard.down('a')
    try:
        pg.wait_for_function("(y0) => Math.abs(__dbg.FLY.yaw - y0) > 0.3", arg=yaw0, timeout=15000)
    finally:
        pg.keyboard.up('a')
    pg.wait_for_timeout(300)
    yaw1 = pg.evaluate("__dbg.FLY.yaw")
    assert abs(yaw1 - yaw0) > 0.3, ('A yaw', yaw0, yaw1)
    print('yaw turned %.2f rad' % (yaw1 - yaw0))

    # 4) R 升 / Q 降
    alt0 = pg.evaluate("__dbg.FLY.alt")
    # B6+：改为"按到达标才松键"（沿用 B1 flight_tactics 实证的模式）——
    # 固定按住在低帧环境跑不了几帧 update，位移/姿态累积不达标，松键即衰减，
    # 断言永远等不到。改条件保持后与帧率无关（分类器真候选 L59）。
    pg.keyboard.down('r')
    try:
        pg.wait_for_function("(a0) => __dbg.FLY.alt - a0 > 0.8", arg=alt0, timeout=15000)
    finally:
        pg.keyboard.up('r')
    alt1 = pg.evaluate("__dbg.FLY.alt")
    assert alt1 - alt0 > 0.8, ('R climb', alt0, alt1)
    # B6+：改为"按到达标才松键"（沿用 B1 flight_tactics 实证的模式）——
    # 固定按住在低帧环境跑不了几帧 update，位移/姿态累积不达标，松键即衰减，
    # 断言永远等不到。改条件保持后与帧率无关（分类器真候选 L64）。
    pg.keyboard.down('q')
    try:
        pg.wait_for_function("(a1) => __dbg.FLY.alt < a1 - 0.3", arg=alt1, timeout=15000)
    finally:
        pg.keyboard.up('q')
    alt2 = pg.evaluate("__dbg.FLY.alt")
    assert alt2 < alt1 - 0.3, ('Q descend', alt1, alt2)
    print('alt %.1f -> %.1f -> %.1f' % (alt0, alt1, alt2))
    pg.screenshot(path=H.output_path('shot_fpv_cockpit.jpg'), type='jpeg', quality=90)

    # 5) 机炮：左键按住 → gunOn + 弹药消耗
    pg.mouse.move(640, 400)
    # B6+：改为"按到达标才松键"（沿用 B1 flight_tactics 实证的模式）——
    # 固定按住在低帧环境跑不了几帧 update，位移/姿态累积不达标，松键即衰减，
    # 断言永远等不到。改条件保持后与帧率无关（分类器真候选 L74）。
    pg.mouse.down(button='left')
    try:
        pg.wait_for_function("() => __dbg.rig.gunOn === true && __dbg.rig.gunAmmo < 1200", timeout=15000)
        # 读取必须在**松键之前**——原语义是"按住时 gunOn=true 且弹药已消耗"；
        # 放进 finally 之后读会拿到松键后的 False（首改实测踩到：on=False/ammo=1199）
        gun = pg.evaluate("() => ({ on: __dbg.rig.gunOn, ammo: __dbg.rig.gunAmmo })")
    finally:
        pg.mouse.up(button='left')
    assert gun['on'] is True and gun['ammo'] < 1200, ('gun fired', gun)
    print('gun fired, ammo=%d' % gun['ammo'])
    pg.wait_for_timeout(300)

    # 6) 火箭：右键单发（Phase 27 flaky 治理：条件等待弹药下降，替代固定墙钟——
    #    负载下 200+300ms 固定睡曾使开火未在窗口内注册而假失败 rk 38==38）
    rk0 = pg.evaluate("__dbg.rig.rocketAmmo")
    pg.mouse.down(button='right')
    pg.wait_for_function("(r0) => __dbg.rig.rocketAmmo < r0", arg=rk0, timeout=10000)
    pg.mouse.up(button='right')
    rk1 = pg.evaluate("__dbg.rig.rocketAmmo")
    assert rk1 < rk0, ('rocket fired', rk0, rk1)
    print('rocket fired %d -> %d' % (rk0, rk1))

    # 7) 地狱火：F 键（同上——条件等待弹药 -1，替代固定 400ms 睡）
    hf0 = pg.evaluate("__dbg.rig.hfAmmo")
    pg.keyboard.press('f')
    pg.wait_for_function("(h0) => __dbg.rig.hfAmmo === h0 - 1", arg=hf0, timeout=10000)
    hf1 = pg.evaluate("__dbg.rig.hfAmmo")
    assert hf1 == hf0 - 1, ('hellfire launched', hf0, hf1)
    print('hellfire %d -> %d' % (hf0, hf1))
    pg.screenshot(path=H.output_path('shot_fpv_fire.jpg'), type='jpeg', quality=90)

    # 8) C 退出：恢复环绕/座舱/HUD
    pg.keyboard.press('c')
    pg.wait_for_timeout(600)
    st2 = pg.evaluate("""() => ({
        active: __dbg.fp.active, orbitOn: __dbg.orbit.enabled,
        cockpit: __dbg.apache.get('Cube001_2').visible,
        hud: document.querySelector('#fp-hud').style.display })""")
    assert st2['active'] is False and st2['orbitOn'] and st2['cockpit'], ('fp exit', st2)
    assert st2['hud'] == 'none', ('fp hud hidden', st2)

H.guarded_main(run, hard_timeout=300)
print('PASS')
