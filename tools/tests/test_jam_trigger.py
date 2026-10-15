# -*- coding: utf-8 -*-
# Phase 19-补二：卡壳自然触发——值级浏览器断言（playwright）
# 链路：注入武器 Lv2 + rng=()=>0（必卡档）→ 持续开火（gunOn）→ 自然卡壳 +
# jamStart toast「按 N」→ N 上膛修复 + 免疫窗 10s → 窗口内再开火不卡
#（负断言窗）→ 清零免疫（直写等价窗口走完）→ 再开火可再卡。
# 全程条件等待；固定窗只用于 J3 负断言（既有纪律）。
# 干扰源隔离：关靶场（持续开火击毁靶标会产生击毁 toast 抢单槽）+ 关自动降档。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rig && __dbg.damageSys)", timeout=60000)
    pg.evaluate("document.getElementById('chk-targets').checked = false; document.getElementById('chk-targets').dispatchEvent(new Event('change'))")
    pg.evaluate("document.getElementById('chk-qauto').checked = false; document.getElementById('chk-qauto').dispatchEvent(new Event('change'))")
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)

    # ---- J1: 武器 Lv2 + 必卡档 rng → 持续开火 → 自然卡壳 + toast「按 N」 ----
    pg.evaluate("(() => { const d = __dbg.damageSys; d.rng = () => 0; d.sys.weapons = 60; d.recompute(); })()")
    pg.evaluate("__dbg.rig.gunOn = true")
    pg.wait_for_function("() => __dbg.damageSys.state().jammed", timeout=8000)
    pg.wait_for_function("() => document.getElementById('toast').textContent.indexOf('按 N') >= 0"
                         " && document.getElementById('toast').classList.contains('show')", timeout=8000)
    pg.evaluate("__dbg.rig.gunOn = false")
    print('J1 PASS: 武器 Lv2 持续开火 → 自然卡壳 + jamStart toast「按 N」')

    # ---- J2: N 上膛修复 + 免疫窗开启 ----
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('n')
    pg.wait_for_function("() => __dbg.damageSys.state().jamBusy", timeout=3000)
    pg.wait_for_function("() => !__dbg.damageSys.jammed && !__dbg.damageSys.state().jamBusy", timeout=8000)
    j2 = pg.evaluate("(() => ({ immune: __dbg.damageSys.state().jamImmune,"
                    " w: __dbg.damageSys.sys.weapons }))()")
    assert j2['immune'] >= 9, ('J2: 上膛成功后应有 ~10s 免卡壳窗', j2)
    assert abs(j2['w'] - 50) < 1e-6, ('J2: 成功修 10（60→50，仍 Lv2）', j2)
    print('J2 PASS: N 上膛修复（weapons 60→50）+ 免疫窗 %.1fs' % j2['immune'])

    # ---- J3: 免疫窗内持续开火不卡（负断言——rng 仍为必卡档 0） ----
    pg.evaluate("__dbg.rig.gunOn = true")
    pg.wait_for_timeout(1500)
    assert pg.evaluate("!__dbg.damageSys.state().jammed"), 'J3: 免疫窗内持续开火不应卡壳'
    pg.evaluate("__dbg.rig.gunOn = false")
    print('J3 PASS: 免疫窗内持续开火 1.5s 未卡壳（必卡档 rng 下免疫保护实证）')

    # ---- J4: 免疫清零（直写等价窗口走完——update 只递减不会复活）→ 再开火再卡 ----
    pg.evaluate("(() => { const d = __dbg.damageSys; d.jamImmune = 0; })()")
    pg.evaluate("__dbg.rig.gunOn = true")
    pg.wait_for_function("() => __dbg.damageSys.state().jammed", timeout=8000)
    pg.wait_for_function("() => document.getElementById('toast').textContent.indexOf('按 N') >= 0"
                         " && document.getElementById('toast').classList.contains('show')", timeout=8000)
    pg.evaluate("__dbg.rig.gunOn = false")
    print('J4 PASS: 窗口过后（等效清零）再开火 → 再次自然卡壳 + 提示')

    # ---- 收尾 ----
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => !__dbg.damageSys.jammed && __dbg.damageSys.sys.weapons === 0"
                         " && __dbg.damageSys.state().jamImmune === 0", timeout=5000)
    pg.screenshot(path=H.output_path('shot_jam_trigger.jpg'), type='jpeg', quality=88)
    print('Phase 19 jam-trigger OK: J1-J4 全过')


import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
