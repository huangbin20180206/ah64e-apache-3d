# FPV 退出后机位锚定验证：飞远+转向 → 退出 → 切机位 → 目标必须跟着直升机
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    # 强制悬停（同 test_fpv 模式：跳过 9s 起旋/爬升；FP.enter 要求 state==='hover'）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0")
    pg.wait_for_timeout(600)
    st = pg.evaluate("__dbg.FLY.state")
    print('fly state:', st)
    assert st == 'hover', ('not hovering', st)
    # 进 FPV，前飞 + 左转，飞离原点
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(1500)
    act = pg.evaluate("!!__dbg.fp.active")
    assert act, 'FPV not entered'
    pg.keyboard.down('KeyW'); pg.wait_for_timeout(2200); pg.keyboard.up('KeyW')
    pg.keyboard.down('KeyA'); pg.wait_for_timeout(900); pg.keyboard.up('KeyA')
    # B6+：最后一段改按到达标才松键（前两段保留以维持既有飞行路径）——FLY.x/z 由
    # 46-fpview.js:359 updater 每帧写（分类器真候选 L20→L23）
    pg.keyboard.down('KeyW')
    try:
        # 同值域：断言读 +FLY.x/z.toFixed(1)
        pg.wait_for_function("() => Math.abs(+__dbg.FLY.x.toFixed(1)) + Math.abs(+__dbg.FLY.z.toFixed(1)) > 8", timeout=20000)
    finally:
        pg.keyboard.up('KeyW')
    pos = pg.evaluate("({x:+__dbg.FLY.x.toFixed(1), z:+__dbg.FLY.z.toFixed(1), yaw:+__dbg.apache.root.rotation.y.toFixed(2)})")
    print('after FPV fly:', pos)
    assert abs(pos['x']) + abs(pos['z']) > 8, ('heli did not fly away', pos)
    # 退出 FPV → 切"正侧"机位
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(1500)
    pg.keyboard.press('Digit2')
    pg.wait_for_timeout(1800)
    t = pg.evaluate("({x:+__dbg.orbit.tTarget.x.toFixed(1), y:+__dbg.orbit.tTarget.y.toFixed(1), z:+__dbg.orbit.tTarget.z.toFixed(1)})")
    print('view target after exit+setView:', t)
    d = abs(t['x'] - pos['x']) + abs(t['z'] - pos['z'])
    assert d < 4, ('view target not anchored to heli', t, pos)
    pg.screenshot(path=H.output_path('shot_fpv_exit_views.jpg'), type='jpeg', quality=90)

import pw_harness as H
H.guarded_main(run, hard_timeout=180)
print('PASS')
