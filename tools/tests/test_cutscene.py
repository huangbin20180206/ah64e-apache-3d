# -*- coding: utf-8 -*-
# Phase 13-M6 过场叙事定向测试：
#   1) 无 ?nocut（测试通道关闭）→ startMission() 触发 mission cutscene：
#      on=true、preset='mission'、letterbox 黑边出现、字幕出现
#   2) Esc 跳过 → off、body 无 cut-mode
#   3) 救援成功（rescue.state='delivered'）→ rescue replay 触发（preset='rescue'）
#   4) ?nocut=1（自动化默认通道）→ startMission() 不触发 cutscene
# 值级断言走 __dbg.cutsceneState（HOST.cutsceneState.state()）只读遥测。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    # 1) 无 nocut：任务 cutscene
    pg.goto(H.BASE + '/?nocine=1&nocut=0', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => __dbg.cutsceneState && __dbg.cutsceneState.on && __dbg.cutsceneState.preset === 'mission'", timeout=6000)
    st = pg.evaluate("""() => ({
      on: __dbg.cutsceneState.on, preset: __dbg.cutsceneState.preset,
      barH: document.getElementById('cut-bar-t').getBoundingClientRect().height,
      mode: document.body.classList.contains('cut-mode') })""")
    print('M6 mission cutscene:', st)
    assert st['on'] and st['mode'] and st['barH'] > 40, ('M6: 任务 cutscene 未正确启动', st)
    pg.wait_for_timeout(1400)
    sub = pg.evaluate("(() => ({ show: document.getElementById('cut-sub').classList.contains('show'), txt: document.getElementById('cut-sub').textContent }))()")
    assert sub['show'] and '作战简报' in sub['txt'], ('M6: 简报字幕未出现', sub)
    # 2) Esc 跳过 → 交还控制权
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    pg.wait_for_timeout(1100)
    st2 = pg.evaluate("({on: __dbg.cutsceneState.on, mode: document.body.classList.contains('cut-mode')})")
    assert not st2['on'] and not st2['mode'], ('M6: 跳过后未正确交接', st2)
    print('M6 Esc 跳过 OK')
    # 3) 救援成功 replay：delivered → rescue 过场
    pg.evaluate("__dbg.S._rescueCut = false; __dbg.rescue.state = 'delivered'")
    pg.wait_for_function("() => __dbg.cutsceneState && __dbg.cutsceneState.on && __dbg.cutsceneState.preset === 'rescue'", timeout=6000)
    st3 = pg.evaluate("({on: __dbg.cutsceneState.on, preset: __dbg.cutsceneState.preset})")
    print('M6 rescue replay:', st3)
    assert st3['on'] and st3['preset'] == 'rescue', ('M6: 救援 replay 未触发', st3)
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    print('M6 rescue replay OK')
    # 4) ?nocut=1（自动化默认通道）→ startMission 不触发
    pg.goto(H.BASE + '/?nocine=1&nocut=1', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_timeout(1200)
    nocut = pg.evaluate("__dbg.cutsceneState && __dbg.cutsceneState.on")
    assert not nocut, ('M6: nocut=1 未抑制过场', nocut)
    print('M6 nocut 通道 OK')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')
