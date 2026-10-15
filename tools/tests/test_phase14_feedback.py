# -*- coding: utf-8 -*-
# Phase 14-E：交互状态反馈与可读性 — 状态转换矩阵定向测试
#   F1 展示态基线：chip=展示、fp-capture 隐藏、owner=orbit、conflict=false
#   F2 进 FPV：chip=第一人称、fp-hud 显示、owner=fp、activeOwnerCount=1
#   F3 指针释放：chip 追加"指针未锁定"+warn、fp-capture 显示（与 plLocked 一致）
#   F4 重捕获链：canvas click 真实入口 → plLocked 与 fp-capture 显隐一致
#      （环境 PL 自动成功→capture 隐藏；伪造丢失→capture 显示——双向一致）
#   F5 任务过场接管：FPV 中 startMission → FPV 让位、fp-hud/capture 隐藏、chip=过场影像
#   F6 过场结束：Esc → chip 恢复、fp-capture 隐藏、无幽灵提示
#   F7 过场输入无副作用：cutscene 中空格/F 抽查（复用 P5 语义）
#   F8 元素唯一性：全流程后 mode-chip/fp-capture/fp-hud 各恰 1 个（无重复创建）
import sys, os, math
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def set_u(pg, fn):
    pg.evaluate("(()=>{ %s })()" % fn)


def snap(pg):
    """一次性快照：modeState + chip + fp-capture + fp-hud + 元素计数"""
    return pg.evaluate("""() => {
      const q = id => document.querySelectorAll('#' + id).length;
      const cap = document.getElementById('fp-capture');
      const chip = document.getElementById('mode-chip');
      const hud = document.getElementById('fp-hud');
      const m = __dbg.modeState;
      return { m,
        chipText: chip ? chip.textContent : null,
        chipWarn: chip ? chip.classList.contains('warn') : null,
        capShown: cap ? getComputedStyle(cap).display !== 'none' : null,
        capText: cap ? (cap.querySelector('#fp-status') || {}).textContent || '' : null,
        hudShown: hud ? getComputedStyle(hud).display !== 'none' : null,
        dup: { chip: q('mode-chip'), cap: q('fp-capture'), hud: q('fp-hud') } };
    }""")


def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=0', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg && __dbg.fp && __dbg.apache", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S.running = true; __dbg.S.fpSens = 1;")

    # ---- F1 展示态基线 ----
    pg.wait_for_timeout(700)                     # 等首个 0.5s chip 刷新块
    s = snap(pg)
    assert s['m']['owner'] == 'orbit' and s['m']['conflict'] is False, ('F1: owner/conflict', s)
    assert s['chipText'] == '展示' and not s['chipWarn'], ('F1: chip 应为展示', s)
    assert not s['capShown'] and not s['hudShown'], ('F1: 展示态不得显示 FPV 提示', s)
    assert s['dup'] == {'chip': 1, 'cap': 1, 'hud': 1}, ('F1: 元素唯一性', s['dup'])
    print('F1 展示态 OK: chip=展示、capture/hud 隐藏、conflict=false')

    # ---- F2 进 FPV ----
    set_u(pg, "__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.wait_for_timeout(120)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_function("() => __dbg.modeState.owner === 'fp'", timeout=6000)
    # chip 在渲染循环里每帧派生（70-app loop），headless 下 rAF 会被节流到 1fps 量级，
    # owner 翻转后 chip 未必已更新——必须等 chip 实际离开 F1 状态再快照，否则读到旧值。
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent.indexOf('展示') === -1", timeout=6000)
    s = snap(pg)
    assert s['m']['owner'] == 'fp' and s['m']['activeOwnerCount'] == 1, ('F2: owner=fp 且唯一', s)
    assert s['hudShown'], ('F2: FPV HUD 应显示', s)
    assert s['chipText'] == '第一人称' or '指针未锁定' in s['chipText'], ('F2: chip 应为第一人称（可能带未锁定）', s)
    # capture 显隐必须与 plLocked 一致（fp active 且未锁 → 显示）
    assert s['capShown'] == (not s['m']['plLocked']), ('F2: fp-capture 应与 plLocked 一致', s)
    print('F2 进 FPV OK: owner=fp、HUD 显示、capture 与 plLocked 一致')

    # ---- F3 指针释放（伪造丢失）→ chip warn + capture 显示 ----
    pg.evaluate("""() => {
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
      document.dispatchEvent(new Event('pointerlockchange'));
    }""")
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent.indexOf('指针未锁定') > 0", timeout=6000)
    s = snap(pg)
    assert s['chipWarn'] and '指针未锁定' in s['chipText'], ('F3: 丢失后 chip 应警示', s)
    assert s['capShown'], ('F3: 丢失后 fp-capture 应显示', s)
    assert '指针未锁定' in s['capText'], ('F3: capture 文案应含指针未锁定', s)
    print('F3 指针释放 OK: chip/capture 同步警示')

    # ---- F4 重捕获链（canvas click 真实入口）→ 双向一致 ----
    pg.evaluate("document.getElementById('gl').click()")   # 72-uibind canvas click → requestPointerLock
    pg.wait_for_timeout(500)
    s = snap(pg)
    # 环境可能自动锁定成功（plLocked=true→capture 隐藏）或失败（false→capture 显示）
    assert s['capShown'] == (not s['m']['plLocked']), ('F4: 重捕获后 capture 与 plLocked 不一致', s)
    assert s['m']['owner'] == 'fp', ('F4: 重捕获不得改变 owner', s)
    # 再伪造丢失 → capture 恢复显示（可重复且状态一致）
    pg.evaluate("""() => { document.dispatchEvent(new Event('pointerlockchange')); }""")
    pg.wait_for_timeout(200)
    s2 = snap(pg)
    assert s2['capShown'] == (not s2['m']['plLocked']), ('F4: 二次状态变化后仍一致', s2)
    print('F4 重捕获链 OK: capture 与 plLocked 双向一致、owner 不变')

    # ---- F5 任务过场接管（FPV active 中 startMission） ----
    pg.evaluate("__dbg.resetRange()")
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => __dbg.modeState.owner === 'cutscene'", timeout=8000)
    pg.wait_for_function("() => (document.getElementById('mode-chip')||{}).textContent.indexOf('过场') === 0", timeout=6000)
    s = snap(pg)
    assert not s['hudShown'], ('F5: 过场接管后 FPV HUD 应隐藏', s)
    assert not s['capShown'], ('F5: 过场接管后不得残留重捕获提示', s)
    assert s['m']['activeOwnerCount'] == 1 and not s['m']['conflict'], ('F5: 单 owner', s)
    print('F5 过场接管 OK: FPV HUD/capture 清理、chip=过场影像、单 owner')

# ---- F6 过场结束（Esc）→ 控制权交还、无幽灵提示 ----
    # chip 更新挂在 loop 0.5s HUD 刷新块——Esc 后等 ≥700ms 覆盖一个完整刷新周期
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => __dbg.modeState.owner === 'orbit'", timeout=6000)
    pg.wait_for_timeout(700)
    s = snap(pg)
    assert not s['capShown'] and not s['hudShown'], ('F6: 结束后不得残留 FPV 提示', s)
    assert '过场' not in s['chipText'], ('F6: 结束后不得残留过场提示', s)
    assert s['m']['conflict'] is False, ('F6: conflict=false', s)
    print('F6 过场结束 OK: 控制权交还、无幽灵提示')

    # ---- F7 过场输入无副作用（抽查空格/F，各自独立过场——同一段里空格会先
#      跳过过场，F 键此时已是正常输入，必须分段）----
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")   # 过场 1：空格
    pg.wait_for_function("() => __dbg.modeState.owner === 'cutscene'", timeout=8000)
    base = pg.evaluate("() => ({ running: __dbg.S.running, fp: __dbg.fp.active })")
    pg.keyboard.press(' ')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=6000)
    after = pg.evaluate("() => ({ running: __dbg.S.running, fp: __dbg.fp.active })")
    assert base['running'] == after['running'] and not after['fp'], ('F7-空格: 过场跳过不得触发功能', base, after)
    pg.evaluate("__dbg.resetRange(); __dbg.startMission()")   # 过场 2：F
    pg.wait_for_function("() => __dbg.modeState.owner === 'cutscene'", timeout=8000)
    hf0 = pg.evaluate("__dbg.rig.hfAmmo")
    pg.keyboard.press('KeyF')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=6000)
    hf1 = pg.evaluate("__dbg.rig.hfAmmo")
    assert hf0 == hf1, ('F7-F: 过场跳过不得发射地狱火', hf0, hf1)
    cnt = pg.evaluate("__dbg.modeState.activeOwnerCount")
    assert cnt <= 1, ('F7: 输入后单 owner', cnt)
    pg.evaluate("__dbg.resetRange()")
    print('F7 过场输入无副作用 OK: 空格/F 被消费')

    # ---- F8 元素唯一性（全流程后终检）----
    s = snap(pg)
    assert s['dup'] == {'chip': 1, 'cap': 1, 'hud': 1}, ('F8: 全流程后元素唯一性', s['dup'])
    print('F8 元素唯一性 OK: chip/capture/hud 各恰 1 个')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')