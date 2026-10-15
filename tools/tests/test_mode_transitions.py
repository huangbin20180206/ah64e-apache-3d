# -*- coding: utf-8 -*-
# Phase 14-A：统一模式切换与输入所有权 — 模式转换矩阵 / 单 owner 契约
#   M1 单 owner：默认 orbit；进 FPV → fp；startMission → cutscene（FPV 退出）；
#   M2 FPV 飞行中救援 delivered → rescue replay 取得相机（FPV 必须让位，R1）；
#   M3 失焦/隐藏恢复：FPV active + 按住 W + 伪造 document.hidden → keys 清空（R3）；
#   M4 非法转换：cutscene 激活时按 C（FP 切换入口）不得进入 FPV；cinema owner 时
#      cutscene request 被拒（HOST.camSeq 互斥）；
#   M5 幂等：连续 startMission 不重复播 cutscene（round 制）、连续 retry 状态一致。
# 使用 pw_harness；合成事件探针（keystroke / visibilitychange）不依赖真实指针锁。
import sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def mstate(pg):
    return pg.evaluate("__dbg.modeState")


def assert_single_owner(pg, label):
    """单 owner 契约：activeOwnerCount<=1 且 conflict===false（P14 返修 R3）"""
    st = pg.evaluate("""() => { const m = __dbg.modeState;
      return { count: m.activeOwnerCount, conflict: m.conflict, owner: m.owner,
               fp: m.fp, cin: m.cinematic, cut: m.cutscene }; }""")
    assert st['count'] <= 1 and st['conflict'] is False, (label + ': 单 owner 违反', st)
    return st


def set_u(pg, fn):
    pg.evaluate("(()=>{ %s })()" % fn)


def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=0', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg && __dbg.fp && __dbg.apache && __dbg.rescue", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S.running = true; __dbg.S.fpSens = 1;")

    # ---- M1 单 owner 契约 ----
    st = mstate(pg)
    assert st['owner'] in ('orbit',), ('M1: 初始 owner 应为 orbit', st)
    assert_single_owner(pg, 'M1-初始')
    # 进 FPV（需要 hover）
    set_u(pg, "__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; "
                "__dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; "
                "__dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.wait_for_timeout(100)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    st = mstate(pg)
    assert st['owner'] == 'fp' and st['fp'], ('M1: FPV 激活后 owner=fp', st)
    assert_single_owner(pg, 'M1-FPV')
    # startMission → exitNormalized → cutscene 播放
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)
    pg.wait_for_function("() => __dbg.modeState.owner === 'cutscene'", timeout=6000)
    st = mstate(pg)
    assert st['owner'] == 'cutscene' and not st['fp'], ('M1: 任务过场 owner=cutscene 且 FPV 已退出', st)
    assert_single_owner(pg, 'M1-cutscene')
    # Esc 跳过 → owner 回 orbit
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => __dbg.modeState.owner === 'orbit'", timeout=6000)
    pg.evaluate("__dbg.resetRange()")        # 清场（任务结算/重置后才是"新任务轮次"）
    st = mstate(pg)
    assert st['owner'] == 'orbit' and not st['fp'], ('M1: 过场结束 owner=orbit（不自动重进 FPV）', st)
    assert_single_owner(pg, 'M1-orbit')
    print('M1 单 owner 契约 OK: orbit→fp→cutscene→orbit（activeOwnerCount<=1 全程）')

    # ---- M4 非法转换：cutscene 激活时按 C 是"跳过过场"（capture 消费任意键），
    #      不得触发 FPV 切换（P5 输入穿透语义在模式层复验） ----
    set_u(pg, "__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; "
                "__dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; "
                "__dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.evaluate("__dbg.resetRange()")          # 清场：新任务轮次
    pg.wait_for_timeout(50)
    pg.evaluate("__dbg.startMission()")          # 新一轮 cutscene
    pg.wait_for_function("() => __dbg.modeState.owner === 'cutscene'", timeout=6000)
    pg.keyboard.press('KeyC')                     # cutscene 中按 C：跳过过场（不进入 FPV）
    pg.wait_for_function("() => __dbg.modeState.owner === 'orbit'", timeout=6000)
    st = mstate(pg)
    assert st['owner'] == 'orbit' and not st['fp'], ('M4: 跳过过场后 owner=orbit 且不得进 FPV', st)
    assert_single_owner(pg, 'M4-截跳过场')
    print('M4 非法转换 OK: cutscene 中按 C 跳过过场、不触发 FPV')

    # ---- M3 失焦/隐藏恢复：FPV active + 按住 W + hidden → keys 清空 ----
    set_u(pg, "__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; "
                "__dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; "
                "__dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.wait_for_timeout(150)
    pg.evaluate("__dbg.fp.toggle()")
    try:
        pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    except Exception:
        dump = pg.evaluate("""() => ({ fly: __dbg.FLY.state, alt: +__dbg.FLY.alt.toFixed(2),
          fpActive: __dbg.fp.active, owner: __dbg.modeState.owner, guide: __dbg.S._guide,
          train: __dbg.S._train, mode: __dbg.S.mode, running: __dbg.S.running,
          mission: __dbg.modeState.mission, time: +__dbg.S.time.toFixed(1) })""")
        print('M3 FAIL dump:', dump)
        raise
    pg.keyboard.down('KeyW')                      # 真实 keydown 记录 keys.w=true
    pg.keyboard.down('KeyR')
    pg.wait_for_timeout(150)
    held = pg.evaluate("__dbg.fp.keyState()")
    assert held.get('w') and held.get('r'), ('M3: 前置——W/R 应已按下', held)
    # 伪造 visibilitychange hidden（Playwright 不能真实切后台）
    pg.evaluate("""() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }""")
    pg.wait_for_timeout(120)
    st_k = pg.evaluate("__dbg.fp.keyState()")
    residue = {kk for kk, v in st_k.items() if v}
    assert not (residue & {'w', 's', 'a', 'd', 'r', 'q', 'g', 'x'}), (
        'M3: hidden 后 keys 应清空（无 stuck-key）', st_k)
    # 恢复可见（FPV 仍 active；确认 keys 保持清空、无幽灵速度）
    pg.evaluate("""() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }""")
    pg.keyboard.up('KeyW'); pg.keyboard.up('KeyR')
    # 速度衰减需要时间：down 期间积累的 spd 在 hidden 清键后按阻尼衰减，
    # 等 1500ms（约 30 帧）让残速收敛到接近 0 再断言（验证无"幽灵增速"）
    # B6+：fp.spd/FLY.x 由 46-fpview.js:341 updater 每帧写——等残速收敛达标
    # （分类器真候选 L123→L125），替代固定睡 1500ms
    pg.wait_for_function("() => Math.abs(__dbg.fp.spd) < 0.5 && Math.abs(__dbg.FLY.x) < 0.5", timeout=15000)
    beh = pg.evaluate("() => ({ spd: +__dbg.fp.spd.toFixed(3), x: +__dbg.FLY.x.toFixed(2) })")
    assert abs(beh['spd']) < 0.5 and abs(beh['x']) < 0.5, ('M3: 隐藏恢复后 FPV 不应自加速（残速应衰减）', beh)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)
    print('M3 失焦/隐藏恢复 OK: hidden 清 keys、恢复后无幽灵速度')

    # ---- M2 FPV 飞行中救援 delivered → rescue replay 单 owner（R1） ----
    set_u(pg, "__dbg.S.mode='mission'; __dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true;")
    pg.wait_for_timeout(100)
    pg.evaluate("__dbg.fp.toggle()")               # 进 FPV
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    # 触发一次救援交付（终态直接置 delivered 是确定性做法：delivered 分支在
    # update 中自保持，loop 每帧检测 delivered && !_rescueCut → maybe('rescue')）
    set_u(pg, "__dbg.S.mode='mission'; __dbg.rescue.state='delivered'; __dbg.S._rescueCut=false;")
    pg.wait_for_timeout(500)                        # loop 检测 delivered → maybe('rescue')
    st = mstate(pg)
    # rescue replay 应取得 owner，且 FPV 已让位退出
    assert st['owner'] == 'cutscene', ('M2: 救援 replay 应取得相机 owner=cutscene', st)
    assert not st['fp'], ('M2: replay 期间 FPV 必须让位（R1 修复点）', st)
    assert st['cutscene'], ('M2: cutscene 状态应为 on', st)
    assert_single_owner(pg, 'M2-replay单owner')
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => __dbg.modeState.owner === 'orbit'", timeout=8000)
    assert_single_owner(pg, 'M2-replay结束')
    print('M2 救援 replay 单 owner OK: FPV 让位、replay 播放、结束后 orbit')

    # ---- M5 幂等：同轮 startMission 不重复播 cutscene（round 制）；retry 状态一致 ----
    pg.evaluate("__dbg.resetRange()")            # 清场：新任务轮次（prevPhase=null）
    before = pg.evaluate("__dbg.S._missionRound")
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => __dbg.modeState.owner === 'cutscene'", timeout=8000)
    assert_single_owner(pg, 'M5-cutscene')
    r1 = pg.evaluate("__dbg.cutsceneState.playedRound")
    pg.evaluate("__dbg.startMission()")             # 同轮再次 startMission → 幂等
    pg.wait_for_timeout(300)
    r2 = pg.evaluate("__dbg.cutsceneState.playedRound")
    assert r1 == r2 != None, ('M5: 同轮重复 startMission 不应重播 cutscene', r1, r2)
    assert_single_owner(pg, 'M5-幂等')
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => __dbg.modeState.owner === 'orbit'", timeout=6000)
    assert_single_owner(pg, 'M5-结束')
    print('M5 幂等 OK: round 制不重播')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')