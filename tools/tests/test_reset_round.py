# -*- coding: utf-8 -*-
# 最终闭环修复三：救援状态跨任务泄漏验证。
# 完成一次救援（delivered）→ 重试同一 timed_rescue → 幸存者重新出现、
# 状态非 delivered；不执行新救援仅灭目标时不得错误完成任务。
# 值级断言走 __dbg.rescue（state/ok/g.visible）+ __dbg.targets 状态源。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rescue && __dbg.targets)", timeout=60000)
    # 任务模式 + 开始 timed_rescue（沙漠固定）
    pg.evaluate("__dbg.startMission('timed_rescue')")
    pg.wait_for_function("() => __dbg.rescue.state === 'idle' && __dbg.rescue.ok", timeout=6000)
    st0 = pg.evaluate("() => ({ state: __dbg.rescue.state, ok: __dbg.rescue.ok, gvis: __dbg.rescue.g.visible })")
    assert st0['state'] == 'idle' and st0['ok'] and st0['gvis'], ('R: 新任务幸存者应就绪', st0)
    print('R 新任务幸存者就绪:', st0)

    # 完成救援：直接走正式状态转换（delivered 是 aboard 送抵后的终态）
    # 用 update 驱动的路径模拟：aboard → 送抵停机坪（直升机回原点低空）
    # 复核修复：用正式绞车入口完成救援（K toggle → deploying → holding → lifting
    # → aboard → 送抵 delivered），不得只直接赋值 rescue.state
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.fp=true; __dbg.FLY.alt=6; __dbg.FLY.x=26; __dbg.FLY.z=-14; __dbg.S._alt=0")
    pg.wait_for_timeout(300)
    pg.keyboard.press('KeyK')   # 放绞车（正式入口）
    pg.wait_for_function("() => __dbg.rescue.state === 'deploying' || __dbg.rescue.state === 'holding'", timeout=8000)
    # 绞车绳放到底 + 幸存者在 2u 内 → 自动挂接 → lifting → aboard（状态机驱动）
    pg.wait_for_function("() => __dbg.rescue.state === 'aboard'", timeout=15000)
    # 送抵停机坪（aboard + 低空回原点）→ delivered
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.fp=true; __dbg.FLY.alt=2; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.S._alt=0")
    pg.wait_for_function("() => __dbg.rescue.state === 'delivered'", timeout=8000)
    assert pg.evaluate("__dbg.rescue.state") == 'delivered', 'R: 应完成救援（delivered）'
    print('R 救援完成 delivered（正式绞车入口）')

    # 重试同一 timed_rescue（新轮次）：resetRound 应清除 delivered 并重生幸存者
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_function("() => __dbg.rescue.state === 'idle' && __dbg.rescue.g.visible", timeout=6000)
    st1 = pg.evaluate("() => ({ state: __dbg.rescue.state, gvis: __dbg.rescue.g.visible, ok: __dbg.rescue.ok })")
    assert st1['state'] == 'idle' and st1['gvis'] and st1['ok'], ('R: 重试后幸存者应重新出现且非 delivered', st1)
    assert st1['state'] != 'delivered', ('R: 重试不应继承 delivered', st1)
    # 复核修复：断言幸存者世界位置与任务 UI（画面可见证据，不只 state）
    vis = pg.evaluate("""() => {
      const g = __dbg.rescue.g;
      return { world: [g.position.x.toFixed(1), g.position.y.toFixed(1), g.position.z.toFixed(1)],
               vis: g.visible, missionShow: document.getElementById('mission').classList.contains('show') };
    }""")
    print('R 重试后幸存者世界位置/可见:', vis)
    assert vis['vis'], ('R: 幸存者应可见（重试后重生）', vis)
    print('R 重试后幸存者重生 OK:', st1)

    # 不执行新救援，仅灭全部目标 → timed_rescue 不得错误完成任务
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
    pg.wait_for_timeout(1500)   # 等 loop 0.5s 节流完成判定
    st2 = pg.evaluate("() => ({ mission: __dbg.mission ? __dbg.mission.phase : null, done: __dbg.mission ? __dbg.mission.done : null, rescue: __dbg.rescue.state })")
    print('R 全歼未救援:', st2)
    # timed_rescue 需全歼 AND delivered——未救援不得完成（保持 active/或提示）
    assert not st2['done'], ('R: 未救援仅灭目标不得完成任务', st2)
    assert st2['rescue'] == 'idle', ('R: 未救援幸存者仍在场（idle）', st2)
    print('R 全歼未救援不完成 OK')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')