# -*- coding: utf-8 -*-
# 回归（2026-10-14 用户截图）：第一人称进出后，另一套涂装的贴花不能被一并显示
#   L1 army 涂装 → FP 进出 → USMC 贴花仍隐藏、Army 贴花仍可见
#   L2 lowvis(USMC) 涂装 → FP 进出 → Army 贴花仍隐藏
import pw_harness as H

VIS = """() => ({ army: __dbg.apache.armyDecals.map(o => o.visible),
                 usmc: __dbg.apache.usmcDecals.map(o => o.visible), fp: __dbg.fp.active })"""


def cycle(pg):
    pg.evaluate("__dbg.FLY.state = 'hover'; __dbg.FLY.alt = 14; __dbg.FLY.pitch = 0; __dbg.FLY.comp = 0")
    pg.evaluate("__dbg.fp.enter()"); H.step(pg, 0.3)
    assert pg.evaluate("__dbg.fp.active"), 'fp enter'
    pg.evaluate("__dbg.fp.exit()"); H.step(pg, 0.3)
    return pg.evaluate(VIS)


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("__dbg.apache.setScheme('army', true)")
    v = cycle(pg)
    assert v['army'] and all(v['army']) and not any(v['usmc']), ('L1', v)
    print('L1 ok')
    pg.evaluate("__dbg.apache.setScheme('lowvis', true)")
    v = cycle(pg)
    assert v['usmc'] and all(v['usmc']) and not any(v['army']), ('L2', v)
    print('L2 ok')


H.guarded_main(run, hard_timeout=240)
print('PASS')
