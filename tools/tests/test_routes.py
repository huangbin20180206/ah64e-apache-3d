# -*- coding: utf-8 -*-
# P4b 飞行展示航线（浏览器，状态级，手动步进）
#   R1 草原：空中开场 → 自动驾驶贴航线；相机目标跟机
#   R2 任意键接管：route 关、FLY.auto 关、userAlt 钉住当前高度
#   R3 城镇/峡谷：场景随航线出现，退出后撤场；峡谷全程无碰撞计伤
#   R4 晨间出勤：地面启旋 → 起飞 → 17s 后自动驾驶接管
#   R5 面板：#route-list 7 张卡（6 航线 + 精选 60 秒）
import pw_harness as H

RUN = """(a) => { const R = __dbg.HOST; R.routeState.manual = true;
  for (let i = 0; i < a.n; i++) { R.routeStep(1/30); __dbg.step(1/30, 1/30); } return 1; }"""


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.HOST.routeStart)", timeout=60000)
    n = pg.evaluate("document.querySelectorAll('#route-list .rcard').length")
    assert n == 7, ('R5', n)
    pg.evaluate("__dbg.HOST.routeStart('grass')")
    pg.evaluate(RUN, {'n': 300})   # 10s
    a = pg.evaluate("""(() => { const F = __dbg.FLY, o = __dbg.orbit, r = __dbg.HOST.routeState;
      return { on: r.on, auto: F.auto, st: F.state, x: F.x, z: F.z, alt: F.alt, t: r.t,
               tx: o.tTarget.x, tz: o.tTarget.z, terr: __dbg.W.terrainKey }; })()""")
    assert a['on'] and a['auto'] and a['st'] == 'hover' and a['terr'] == 'grass', ('R1', a)
    assert abs(a['x'] - (-28)) < 3 and abs(a['z'] - (-18)) < 3 and a['alt'] < 4, ('R1 pos', a)
    assert abs(a['tx'] - a['x']) < 1 and abs(a['tz'] - a['z']) < 1, ('R1 cam', a)
    print('R1 ok', a)
    pg.keyboard.press('KeyW')
    b = pg.evaluate("[__dbg.HOST.routeState.on, __dbg.FLY.auto, __dbg.FLY.userAlt, __dbg.FLY.alt]")
    assert b[0] is False and b[1] is False and abs(b[2] - b[3]) < 0.2, ('R2', b)
    print('R2 ok', b)
    for sc, rid in (('town', 'town'), ('canyon', 'canyon')):
        pg.evaluate("__dbg.HOST.routeStart('%s')" % rid)
        hp0 = pg.evaluate("__dbg.targets._heliDmg || 0")
        pg.evaluate(RUN, {'n': 600})   # 20s
        c = pg.evaluate("[__dbg.targets.%s.active, __dbg.HOST.routeState.on, __dbg.targets._heliDmg || 0]" % sc)
        assert c[0] and c[1] and c[2] <= hp0, ('R3 ' + sc, c, hp0)
        pg.evaluate("__dbg.HOST.routeStop(true, true)")
        pg.evaluate(RUN, {'n': 3})
        d = pg.evaluate("__dbg.targets.%s.active" % sc)
        assert d is False, ('R3 ' + sc + ' 撤场', d)
        print('R3 ok', sc, c)
    pg.evaluate("__dbg.HOST.routeStart('dawn')")
    pg.evaluate(RUN, {'n': 60})
    e0 = pg.evaluate("[__dbg.FLY.state, __dbg.S.running]")
    pg.evaluate(RUN, {'n': 570})   # 21s
    e1 = pg.evaluate("[__dbg.FLY.state, __dbg.FLY.auto, __dbg.FLY.alt, __dbg.S.running]")
    pg.evaluate("__dbg.HOST.routeStop(true)")
    assert e0[0] == 'ground' and e0[1] and e1[0] == 'hover' and e1[1] and e1[2] > 9, ('R4', e0, e1)
    print('R4 ok', e0, e1)


H.guarded_main(run, hard_timeout=220)
print('PASS')
