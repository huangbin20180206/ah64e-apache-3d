# -*- coding: utf-8 -*-
# Phase 19：SAM/RWR/干扰弹/战损操控——值级浏览器断言（playwright）
# 【写好入库、本轮不运行】——分支内留待浏览器测试解禁后随门禁跑。
# 覆盖：RWR 相位链与交战门控 / 干扰弹投放与渲染镜像 / SAM 命中走既有
# 损伤链（_heliDmg/onHeliHit/_dmgPenalty/受损烟）/ 战损操控惩罚表 /
# resetRange 与 startMission 清理 / __dbg 遥测出口。
# 全部 __dbg 数值断言；无固定墙钟（一律 wait_for_function 条件等待）。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rig && __dbg.samwar && __dbg.samvis)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    H.step(pg, 0.3)

    # ---- S1: RWR 相位链：地面停放不交战 → 悬停反击区 → 依序 track/lock → 发射 ----
    s0 = pg.evaluate("(() => ({ phase: __dbg.samwar.state().phase, flares: __dbg.samwar.state().flares }))()")
    assert s0['phase'] == 'idle', ('S1: 地面停放 RWR 应为 idle', s0)
    assert s0['flares'] == 6, ('S1: 干扰弹初始应为 6 发', s0)
    # 悬停 z=33 alt=14（距基地 BASE_C z=75 为 42u 在反击区 8~55u 内）
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=33;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; F.fp=false; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    H.step_until(pg, "() => __dbg.samwar.state().phase !== 'idle'", 20)
    p1 = pg.evaluate("__dbg.samwar.state().phase")
    assert p1 in ('track', 'lock', 'launch'), ('S1: 进入交战区后应开始建锁', p1)
    # 发射（track 2.2s + lock 2.6s + 首扫 ≤9s；20s 宽窗条件等待）
    H.step_until(pg, "() => __dbg.samwar.launchN >= 1", 30)
    assert pg.evaluate("__dbg.samwar.state().missiles") >= 1, 'S1: 发射后应有在场导弹'
    assert pg.evaluate("__dbg.samvis.state().missiles") >= 1, 'S1: 渲染层应镜像出导弹'
    print('S1 PASS: RWR idle→交战→发射（相位 %s，launchN≥1，视觉镜像）' % p1)

    # ---- S2: 干扰弹：J 键投放（与 72-uibind 同通道）→ 数量递减 + 渲染镜像 ----
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    f0 = pg.evaluate("__dbg.samwar.state().flares")
    pg.keyboard.press('j')
    f1 = pg.evaluate("(() => __dbg.samwar.state())()")
    assert f1['flares'] == f0 - 1, ('S2: J 应消耗 1 发干扰弹', (f0, f1['flares']))
    H.step_until(pg, "() => __dbg.samwar.state().flareOn || __dbg.samwar.state().missiles === 0", 5)
    assert pg.evaluate("__dbg.samwar.state().flareOn") is True, 'S2: 干扰弹应在空中（flareOn）'
    assert pg.evaluate("__dbg.samvis.state().flare") is True, 'S2: 渲染层应镜像干扰弹'
    # 诱骗或导弹终结（概率 0.8/帧在 28u 窗内，条件等待收敛）
    H.step_until(pg, "() => (__dbg.samwar.state().decoyed || __dbg.samwar.state().missiles === 0)", 10)
    d2 = pg.evaluate("(() => ({ decoyed: __dbg.samwar.state().decoyed, msl: __dbg.samwar.state().missiles }))()")
    assert d2['decoyed'] or d2['msl'] == 0, ('S2: 诱骗/终结至少其一', d2)
    print('S2 PASS: J 投放（%d→%d）+ 视觉镜像 + 诱骗收敛' % (f0, f1['flares']))

    # ---- S3: 直飞悬停必被命中 → 走既有损伤链（_heliDmg/onHeliHit/惩罚/受损烟） ----
    # 等待条件是 >=4 而非 >0：S1 的交战区（距基地 42u+离地）同时激活 16-targets
    # 的 AA 曳光（单发 1 伤），AA 抢先命中 1~2 发会使 _heliDmg>0 提前成立但
    # 不足以触发受损烟（阈值 ≥4）与操控惩罚（SAM_PENALTY_TABLE 从 4 起档）——
    # 旧条件 >0 曾在 AA 两发（dmg=2/pen=0.12/smoke=False）时误判断言失败。
    # >=4 是 smoke/penMul 的设计阈值：SAM 一发 4 伤（首扫≤9s+飞行~2s 必达），
    # AA 累积 4 发同样使断言语义成立（损伤链生效，不区分威胁来源）。
    dmg0 = pg.evaluate("__dbg.targets._heliDmg")
    H.step_until(pg, "() => __dbg.targets._heliDmg - %d >= 4" % dmg0, 40)   # 累计≥4（SAM/AA 任一来源）
    # Phase 27 flaky 治理：SAM 伤害在 70-app 循环里于 targets.update 之后才加到 _heliDmg，
    # 受损烟在下一帧的 targets.update 才置真——读 smoke 前先条件等它置起，替代"dmg≥4
    # 瞬间即读"的 1 帧抢跑（探针实证：loop 每帧 update 后 smoke 稳定 true，仅阈值跨越
    # 那 1~2 帧窗口会读到 false）
    H.step_until(pg, "() => __dbg.targets._dmgSmoke.visible === true", 8)
    d3 = pg.evaluate("(() => ({ dmg: __dbg.targets._heliDmg, pen: __dbg.rig._dmgPenalty,"
                     " smoke: __dbg.targets._dmgSmoke.visible, penMul: (__dbg.S._pen && __dbg.S._pen.speedMul) }))()")
    assert d3['dmg'] > dmg0, ('S3: SAM 命中应累加 _heliDmg', d3)
    assert d3['pen'] > 0, ('S3: onHeliHit 应派生散布惩罚', d3)
    assert d3['smoke'] is True, ('S3: 损伤≥4 应显示受损烟', d3)
    assert d3['penMul'] < 1, ('S3: 战损应写入操控惩罚（速度系数 <1）', d3)
    print('S3 PASS: 命中→_heliDmg=%d→惩罚/烟/操控系数全链生效' % d3['dmg'])

    # ---- S4: HUD 只读出口（RWR 状态条 + 干扰弹计数；dataset 缓存值与状态源一致） ----
    d4 = pg.evaluate("(() => ({ rwr: document.getElementById('hud-rwr') && document.getElementById('hud-rwr').textContent,"
                    " flares: document.getElementById('hud-flare') && document.getElementById('hud-flare').textContent }))()")
    assert d4['rwr'] in ('安全', '扫描', '锁定', '来袭'), ('S4: RWR HUD 应在状态枚举内', d4)
    assert int(d4['flares']) == pg.evaluate("__dbg.samwar.state().flares"), ('S4: 干扰弹 HUD 应与状态源一致', d4)
    print('S4 PASS: HUD RWR=%s 干扰弹=%s（与状态源一致）' % (d4['rwr'], d4['flares']))

    # ---- S5: resetRange 清理（相位/弹药/导弹/视觉全清） ----
    pg.evaluate("__dbg.resetRange()")
    H.step_until(pg, "() => __dbg.samwar.state().phase === 'idle'", 5)
    d5 = pg.evaluate("(() => ({ flares: __dbg.samwar.state().flares, msl: __dbg.samwar.state().missiles,"
                    " vis: __dbg.samvis.state().missiles, dmg: __dbg.targets._heliDmg }))()")
    assert d5['flares'] == 6 and d5['msl'] == 0 and d5['vis'] == 0 and d5['dmg'] == 0, ('S5: resetRange 未清 SAM 状态', d5)
    print('S5 PASS: resetRange 清相位/弹药/导弹/视觉/损伤')

    pg.screenshot(path=H.output_path('shot_samwar.jpg'), type='jpeg', quality=88)
    print('Phase 19 samwar OK: S1-S5 全过')


import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
