# 悬停平移/侧飞验证：环绕方向键平移（机头系方向）+ FPV Z/X 侧飞 + 姿态倾斜
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    # 强制悬停（既定模式），yaw=0、位置归零
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; "
                "__dbg.S.running=true")
    pg.wait_for_timeout(500)

    # ① 环绕模式 ArrowUp 前平移：yaw=0 → 前方 = +Z
    # B6+：改为"按到达标才松键"（B1/B9 同款，帧率无关）——固定按住 1000ms 在低帧
    # 环境跑不了几帧 update，平移量累积不达标（分类器真候选 L13→L16/L17）
    pg.keyboard.down('ArrowUp')
    try:
        # 等待必须与断言**同值域**：断言读的是 +FLY.z.toFixed(1)，若等原始值 >4，
        # z=4.04 时等待通过而四舍五入后 4.0 不满足 >4（GATE-76D 实测踩到；
        # CODely B1 方法论早写明"toFixed 取整口径"）
        pg.wait_for_function("() => +__dbg.FLY.z.toFixed(1) > 4", timeout=15000)
    finally:
        pg.keyboard.up('ArrowUp')
    st = pg.evaluate("({x:+__dbg.FLY.x.toFixed(1), z:+__dbg.FLY.z.toFixed(1), lp:+(__dbg.S._leanP||0).toFixed(3)})")
    print('after ArrowUp:', st)
    assert st['z'] > 4, ('ArrowUp should move +Z (forward)', st)
    assert abs(st['x']) < 1.5, ('ArrowUp should not strafe', st)

    # ② ArrowRight 右平移：yaw=0 → 机体右 = -X
    pg.keyboard.down('ArrowRight')
    try:
        pg.wait_for_function("(x0) => __dbg.FLY.x < x0 - 2", arg=st['x'], timeout=15000)
    finally:
        pg.keyboard.up('ArrowRight')
    st2 = pg.evaluate("({x:+__dbg.FLY.x.toFixed(1), lr:+(__dbg.S._leanR||0).toFixed(3)})")
    print('after ArrowRight:', st2)
    assert st2['x'] < st['x'] - 2, ('ArrowRight should strafe toward -X', st2)

    # ③ FPV Z/X 侧飞：进 FPV，X 右侧飞 → -X（yaw=0 机体右）
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(900)
    act = pg.evaluate("!!__dbg.fp.active")
    assert act, 'FPV not entered'
    x0 = pg.evaluate("+__dbg.FLY.x.toFixed(1)")
    pg.keyboard.down('KeyX')
    try:
        pg.wait_for_function("(x0) => __dbg.FLY.x < x0 - 2", arg=x0, timeout=15000)
    finally:
        pg.keyboard.up('KeyX')
    pg.wait_for_timeout(300)
    x1 = pg.evaluate("+__dbg.FLY.x.toFixed(1)")
    assert x1 < x0 - 2, ('FPV KeyX should strafe right (-X at yaw 0)', x0, x1)
    print('FPV strafe X: %s -> %s' % (x0, x1))
    # ④ FPV Z 左侧飞 → +X 回移
    pg.keyboard.down('KeyZ')
    try:
        pg.wait_for_function("(x1) => __dbg.FLY.x > x1 + 2", arg=x1, timeout=15000)
    finally:
        pg.keyboard.up('KeyZ')
    pg.wait_for_timeout(300)
    x2 = pg.evaluate("+__dbg.FLY.x.toFixed(1)")
    assert x2 > x1 + 2, ('FPV KeyZ should strafe left (+X)', x1, x2)
    print('FPV strafe Z: %s -> %s' % (x1, x2))
    # 退出 FPV
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(600)
    act2 = pg.evaluate("!!__dbg.fp.active")
    assert not act2, 'FPV should be exited'

import pw_harness as H
H.guarded_main(run, hard_timeout=180)
print('PASS')
