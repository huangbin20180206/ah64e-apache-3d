# -*- coding: utf-8 -*-
# Phase 14-B 追加：mode-chip 徽标与真实状态绑定（工作包 B 的 UI 状态同步）
# 在 test_mode_transitions 基础上追加 M6/M7；run 入口复用既有逻辑并增量断言。
# 本文件独立可跑（完整 M1-M7），也可作为 test_mode_transitions 的补充。
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def mstate(pg):
    return pg.evaluate("__dbg.modeState")


def chip(pg):
    return pg.evaluate("""() => { const c = document.getElementById('mode-chip');
      return c ? { text: c.textContent, warn: c.classList.contains('warn') } : null; }""")


def set_u(pg, fn):
    pg.evaluate("(()=>{ %s })()" % fn)


def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=0', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg && __dbg.fp && __dbg.apache", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S.running = true; __dbg.S.fpSens = 1;")

    # M6 徽标与模式同步（默认展示）
    # chip 文案由主渲染循环每帧派生（70-app），不是 0.5s HUD 刷新块——高负载下
    # rAF 被节流到 1fps 量级时，固定 sleep 会读到上一帧的旧值甚至空值。
    # 本文件全部 chip 断言改条件等待（timeout 放宽到 15s：等的是"帧跑到"，不是功能）。
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent === '展示'", timeout=15000)
    c0 = chip(pg)
    assert c0 and c0['text'] == '展示', ('M6: 默认应为展示', c0)
    # 进 FPV → 第一人称
    set_u(pg, "__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.wait_for_timeout(100)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent === '第一人称'", timeout=15000)
    c1 = chip(pg)
    assert c1['text'] == '第一人称', ('M6: FPV 应为第一人称', c1)
    print('M6 徽标-模式同步 OK: 展示→第一人称')

    # M5（幂等，集成在 B 流程）：同轮 startMission 不重播
    pg.evaluate("__dbg.fp.toggle()")               # 退 FPV
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)
    pg.evaluate("__dbg.resetRange()")
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => __dbg.modeState.owner === 'cutscene'", timeout=8000)
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent.indexOf('过场') === 0", timeout=15000)
    c2 = chip(pg)
    assert c2['text'].startswith('过场'), ('M6: 过场中徽标应为过场影像', c2)
    print('M6 徽标-过场同步 OK: 过场影像')
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => __dbg.modeState.owner === 'orbit'", timeout=6000)
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent === '任务·简报'", timeout=15000)
    c3 = chip(pg)
    assert c3['text'] == '任务·简报', ('M6: 任务简报徽标', c3)
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent === '展示'", timeout=15000)
    print('M6 徽标-任务/清场同步 OK: 任务·简报→展示')

    # M7 输入不可用原因（PL 未锁定 warning）——浏览器测试环境 PL 可能自动成功，
    # 显式伪造"指针丢失"（实例属性遮蔽原型 getter + pointerlockchange）验证 UI 逻辑
    set_u(pg, "__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.wait_for_timeout(100)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.evaluate("""() => {
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
      document.dispatchEvent(new Event('pointerlockchange'));
    }""")
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent.indexOf('指针未锁定') > 0", timeout=15000)
    c7 = chip(pg)
    assert c7['warn'] and '指针未锁定' in c7['text'], ('M7: PL 未锁定 warning', c7)
    # 还原原型 getter（删除实例遮蔽）→ pointerlockchange 同步锁定态 → warning 消失
    pg.evaluate("""() => { delete document.pointerLockElement;
      document.dispatchEvent(new Event('pointerlockchange')); }""")
    pg.wait_for_function("() => !(document.getElementById('mode-chip')||{}).classList.contains('warn')", timeout=15000)
    assert '指针未锁定' not in chip(pg)['text'], ('M7: 锁定恢复后 warning 消失', chip(pg))
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)
    print('M7 输入不可用原因 OK: PL 丢失 warning→恢复消失→退出')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')