# 悬停蹬舵转向验证：A/D 转向生效、方向正确、转向后武器可锁尾部扇区目标
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    # 强制悬停（既定测试模式）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; "
                "__dbg.S.running=true")
    pg.wait_for_timeout(600)
    y0 = pg.evaluate("+__dbg.FLY.yaw.toFixed(3)")
    # 按住 A 1.2s → yaw 应增加（左转）
    # B6+：按到达标才松键（B1/B9/B10 同款，帧率无关）——FLY.yaw 由 46-fpview.js:348
    # updater / 70-app loop 每帧写，固定按住 1.2s 在低帧下转不够（分类器真候选 L14→L16）
    pg.keyboard.down('KeyA')
    try:
        # 同值域：断言读 +yaw.toFixed(3)
        pg.wait_for_function("(y0) => +__dbg.FLY.yaw.toFixed(3) > y0 + 0.5", arg=y0, timeout=15000)
    finally:
        pg.keyboard.up('KeyA')
    pg.wait_for_timeout(300)
    y1 = pg.evaluate("+__dbg.FLY.yaw.toFixed(3)")
    assert y1 > y0 + 0.5, ('A key did not yaw left', y0, y1)
    print('A: yaw %s -> %s (+%.2f)' % (y0, y1, y1 - y0))
    # 按住 D 1.2s → yaw 应减少（右转）
    pg.keyboard.down('KeyD')
    try:
        pg.wait_for_function("(y1) => +__dbg.FLY.yaw.toFixed(3) < y1 - 0.5", arg=y1, timeout=15000)
    finally:
        pg.keyboard.up('KeyD')
    pg.wait_for_timeout(300)
    y2 = pg.evaluate("+__dbg.FLY.yaw.toFixed(3)")
    assert y2 < y1 - 0.5, ('D key did not yaw right', y1, y2)
    print('D: yaw %s -> %s (%.2f)' % (y1, y2, y2 - y1))
    # 转向后武器可锁基地目标：基地在机头 +Z 正前方（中心 42u），yaw 归零正对
    # 暂时关掉空中目标（角偏移竞争下靶机可能恰在锥内贴轴，关掉保证确定性）
    pg.evaluate("__dbg.FLY.yaw = 0; __dbg.apache.root.rotation.y = 0")
    pg.evaluate("__dbg.air.enabled = false")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.rig.hfAmmo = Math.max(__dbg.rig.hfAmmo, 1)")
    n0 = pg.evaluate("__dbg.rig.flying.length")
    ok = pg.evaluate("__dbg.rig.launchHf()")
    lock = pg.evaluate("""(()=>{
      const f=__dbg.rig.flying[__dbg.rig.flying.length-1];
      return f&&f.tgt?{label:f.tgt.label,air:!!f.air,type:f.tgt.type||''}:null;
    })()""")
    print('hellfire after turn:', ok, lock)
    assert ok, ('launchHf failed after turn', lock)
    assert lock and not lock['air'] and ('装甲' in lock['label'] or lock['type'] == 'tank'), (
        'turn did not bring tank into lock cone', lock)
    pg.evaluate("__dbg.air.enabled = true")   # 恢复
    print('PASS: yaw works + tank sector reachable after turn')

import pw_harness as H
H.guarded_main(run, hard_timeout=120)
print('PASS')
