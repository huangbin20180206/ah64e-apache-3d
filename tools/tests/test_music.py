# -*- coding: utf-8 -*-
# Phase 13-S4 电影配乐定向测试：
#   1) 手势前 mode=idle；手势后 start()+ambient（pad 循环增益爬升）
#   2) startMission → battle：鼓机调度启动（beat 推进）、pad 压低让位
#   3) 击毁目标（真实链 updateTargetHUD→music.brass）→ brass 铜管计数
#   4) 全歼目标 → 自然完成路径 completeMission → victory 旋律标记，1.6s 后自动回落 ambient
#   5) resetRange（清场）→ ambient
# 值级断言走 __dbg.music.state() 只读遥测。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    # 1) 手势前 idle
    st0 = pg.evaluate("__dbg.music.state()")
    print('S4 初始:', st0)
    assert st0['mode'] == 'idle' and not st0['battleOn'], ('S4: 手势前应 idle', st0)
    pg.mouse.click(640, 400)   # 手势 → audioKick → music.start + ambient
    pg.wait_for_function("() => __dbg.audio && __dbg.audio.state().started", timeout=10000)
    pg.wait_for_function("() => __dbg.music.state().mode === 'ambient'", timeout=8000)
    # pad 样本异步加载 → 循环增益爬升（≤10s）
    pg.wait_for_function("() => __dbg.music.state().padGain > 0.1", timeout=12000)
    st1 = pg.evaluate("__dbg.music.state()")
    print('S4 ambient:', st1)
    assert st1['padGain'] > 0.1, ('S4: 氛围垫乐未生效', st1)
    # 2) startMission → battle
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => __dbg.music.state().mode === 'battle'", timeout=3000)
    pg.wait_for_function("() => __dbg.music.state().beat > 0", timeout=6000)   # 鼓机前瞻调度推进
    # 战斗垫乐压低：setTargetAtTime(0.05, tc=0.8) 需收敛时间，条件等待而非立即断言
    pg.wait_for_function("() => __dbg.music.state().padGain < 0.1", timeout=5000)
    st2 = pg.evaluate("__dbg.music.state()")
    print('S4 battle:', st2)
    assert st2['battleOn'] and st2['scheduled'], ('S4: 鼓机调度未启动', st2)
    # 3) 击毁 → 铜管（真实链：destroy→onHit→updateTargetHUD→music.brass）
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
    pg.wait_for_function("() => __dbg.music.state().brass >= 1", timeout=5000)
    b = pg.evaluate("__dbg.music.state().brass")
    assert b >= 1, ('S4: 击毁铜管未触发', b)
    print('S4 brass OK:', b)
    # 4) 全歼 → 完成 → victory → 回落 ambient（loop 0.5s 节流后判定）
    pg.wait_for_function("() => __dbg.music.state().victory === 1", timeout=8000)
    print('S4 victory 触发 OK')
    pg.wait_for_function("() => __dbg.music.state().mode === 'ambient' && __dbg.music.state().victory === 0",
                         timeout=8000)   # 1.6s 后自动回落
    st3 = pg.evaluate("__dbg.music.state()")
    print('S4 victory→ambient:', st3)
    assert st3['mode'] == 'ambient', ('S4: 胜利后未回落 ambient', st3)
    # 5) 清场 → ambient（从 battle 出发）
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => __dbg.music.state().mode === 'battle'", timeout=3000)
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => __dbg.music.state().mode === 'ambient'", timeout=3000)
    print('S4 resetRange→ambient OK')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')
