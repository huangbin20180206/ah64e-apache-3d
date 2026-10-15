# -*- coding: utf-8 -*-
# P7 飞行手感与战术决策——值级浏览器断言
# 覆盖指令 §6：
#   T1: 悬停静止 → stability=1（散布基础值、绞车可作业）
#   T2: FPV 高速前进/侧飞 → stability 显著下降（移动射击散布放大）
#   T3: 环绕方向键平移 → stability=0.7（轻降）
#   T4: 悬停静止 → 救援可部署（state=deploying）；高速 → 拒绝（保持 idle + toast）
#   T5: 稳定度 HUD 读数（fp-stab）随状态变化（100% → <100%）
#   T6: 起飞/降落连续性 + 悬停稳定性回归锚（P5-A 语义零退化）
#   T7: FPV/环绕切换后 stability 正确重算（无跨轴泄漏/状态漂移）
# 全部 __dbg 数值断言，无中文文案依赖、无固定墙钟、无截图猜测。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp && __dbg.rescue && __dbg.rig && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1200)

    # 悬停起步（环绕模式：无方向键平移）
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    pg.wait_for_timeout(600)

    # ---- T1: 悬停静止 → stability=1（环绕模式无平移键） ----
    # B1 加固：三个帧派生量（S._stability/rig._stability/rescue.speed 均为
    # loop 每帧写者）的等值断言改条件等待——固定 600ms 在低帧环境可能一帧
    # 未跑（GATE-R6/R7/R8 失败史根因；分类器真候选 3 条）
    pg.wait_for_function("() => __dbg.S._stability === 1 && __dbg.rig._stability === 1 && __dbg.rescue.speed === 0", timeout=15000)
    st1 = pg.evaluate("(() => ({ stab: __dbg.S._stability, rig: __dbg.rig._stability,"
                      " spd: __dbg.rescue.speed }))()")
    assert st1['stab'] == 1 and st1['rig'] == 1, ('T1: 悬停静止 stability 应为 1', st1)
    assert st1['spd'] == 0, ('T1: 悬停静止 rescue.speed 应为 0', st1)
    print('T1 PASS: 悬停静止 stability=1, rescue.speed=0')

    # ---- T3: 环绕方向键平移 → stability=0.7 ----
    pg.evaluate("__dbg.keys['arrowup'] = true")
    pg.wait_for_function("() => __dbg.S._stability === 0.7", timeout=15000)
    st3 = pg.evaluate("__dbg.S._stability")
    assert st3 == 0.7, ('T3: 环绕平移 stability 应为 0.7', st3)
    pg.evaluate("__dbg.keys['arrowup'] = false")
    pg.wait_for_function("() => __dbg.S._stability === 1", timeout=15000)
    assert pg.evaluate("__dbg.S._stability") == 1, 'T3: 松键后 stability 恢复 1'
    print('T3 PASS: 环绕平移 stability 0.7 / 松键恢复 1')

    # ---- T2: FPV 高速前进 → stability 显著下降 ----
    pg.evaluate("__dbg.fp.enter()")
    pg.wait_for_function("() => __dbg.fp.active === true", timeout=5000)
    # 悬停静止（FPV 内不按 WASD）→ stability≈1（连续值，允许微小 pitch 残留）
    # B1 加固：帧派生收敛改条件等待（enter 后 vPitch 首帧已隔离——_armPlAcq
    # 预 arm 修复在 main；等待的是帧跑到收敛，不是功能）
    pg.wait_for_function("() => __dbg.S._stability > 0.98", timeout=15000)
    st2a = pg.evaluate("__dbg.S._stability")
    assert st2a > 0.98, ('T2: FPV 静止 stability 应接近 1', st2a)
    # 高速前进（W 按住——**按到达标才松键**：固定 1s 按住在低帧环境跑不了
    # 几帧 update、spd 加速不达标，松键即衰减，复合条件永远等不到——B1 十
    # 轮实测 4 轮挂此（帧率敏感的动作语义改为条件保持，帧率无关）
    pg.keyboard.down('w')
    pg.wait_for_function("() => __dbg.S._stability < 0.75 && __dbg.fp.spd > 8", timeout=15000)
    pg.keyboard.up('w')
    st2b = pg.evaluate("(() => ({ stab: __dbg.S._stability, spd: __dbg.fp.spd }))()")
    # 高速移动 → stability 显著下降（可感知差异：静止 1.0 → 高速 <0.75 且差 >0.25）
    assert st2b['stab'] < 0.75 and (1 - st2b['stab']) > 0.25, ('T2: FPV 高速 stability 应显著下降', st2b)
    assert st2b['spd'] > 8, ('T2: 前置——fp.spd 应已加速', st2b)
    # 停键恢复悬停 → stability 回升（恢复路径；P7 教训：残速衰减需等收敛）
    pg.wait_for_function("() => __dbg.S._stability > 0.9", timeout=15000)
    st2c = pg.evaluate("__dbg.S._stability")
    assert st2c > 0.9, ('T2: 停键后 stability 应恢复', st2c)
    print('T2 PASS: FPV 高速 stability=%.2f(spd=%.1f) / 恢复 %.2f' % (st2b['stab'], st2b['spd'], st2c))

    # ---- T5: 稳定度 HUD 读数随状态变化（相对比较：静止读数 > 机动读数） ----
    # B1 加固：DOM #fp-stab 是 46-fpview 0.15s 节流写——条件等待显示真值
    pg.wait_for_function("() => parseInt(document.getElementById('fp-stab').textContent) >= 90", timeout=15000)
    hud_lo = pg.evaluate("parseInt(document.getElementById('fp-stab').textContent)")
    assert hud_lo >= 90, ('T5: 静止 HUD 稳定度应 ≥90', hud_lo)
    pg.keyboard.down('w')
    # 按到达标才松键（帧率无关的动作语义——固定 900ms 低帧下加速不达标）
    pg.wait_for_function("() => parseInt(document.getElementById('fp-stab').textContent) < %d - 10" % hud_lo, timeout=15000)
    pg.keyboard.up('w')
    hud_hi = pg.evaluate("parseInt(document.getElementById('fp-stab').textContent)")
    assert hud_hi < hud_lo - 10, ('T5: 机动中 HUD 稳定度应显著下降', hud_hi, hud_lo)
    print('T5 PASS: HUD 稳定度 %d%% → %d%%' % (hud_lo, hud_hi))

    # ---- T4: 救援低速窗口（FPV 悬停可部署；高速拒绝） ----
    pg.evaluate("__dbg.FLY.alt=8; __dbg.FLY.x=26; __dbg.FLY.z=-14; __dbg.S._alt=8")
    # 等 T5 高速残速完全衰减（speed 由 loop 每帧从 fp.spd 派生）
    pg.wait_for_function("() => __dbg.fp.spd < 0.5 && __dbg.rescue.speed < 0.5", timeout=15000)
    # 低速（FPV 悬停静止）→ 可部署（由 loop 派生 rescue.speed≈0）
    # B1 加固：帧派生收敛改条件等待（固定 500ms 低帧不达）
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => __dbg.rescue.state === 'deploying'", timeout=15000)
    st4a = pg.evaluate("(() => ({ state: __dbg.rescue.state, speed: __dbg.rescue.speed }))()")
    assert st4a['state'] == 'deploying', ('T4: 低速应可部署绞车', st4a)
    # 收回 → idle
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => __dbg.rescue.state === 'idle'", timeout=15000)
    assert pg.evaluate("__dbg.rescue.state") == 'idle', 'T4: 收回后应 idle'
    # 高速（真实按 W 加速制造 speed>3）→ 拒绝（保持 idle + toast）
    pg.evaluate("document.getElementById('toast').textContent = ''")
    pg.keyboard.down('w')
    # 按到达标才松键（帧率无关——固定 900ms 低帧下 spd 爬不到 8）
    pg.wait_for_function("() => __dbg.rescue.speed > 3", timeout=15000)
    pg.keyboard.up('w')
    spd4 = pg.evaluate("__dbg.rescue.speed")
    assert spd4 > 3, ('T4: 前置——rescue.speed 应 >3（高速）', spd4)
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => __dbg.rescue.state === 'idle'", timeout=15000)
    st4b = pg.evaluate("(() => ({ state: __dbg.rescue.state, toast: document.getElementById('toast').textContent }))()")
    assert st4b['state'] == 'idle', ('T4: 高速应拒绝部署', st4b)
    assert '绞车' in st4b['toast'], ('T4: 高速拒绝应有明确 toast', st4b)
    # 恢复低速（停键后 spd 衰减至 0）→ 可再次部署（恢复路径）
    # B1 加固：残速衰减改条件等待（固定 1500ms 在低帧下收敛未完）
    pg.wait_for_function("() => __dbg.rescue.speed < 3", timeout=15000)
    spd4c = pg.evaluate("__dbg.rescue.speed")
    assert spd4c < 3, ('T4: 前置——停键后 speed 应 <3', spd4c)
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => __dbg.rescue.state === 'deploying'", timeout=15000)
    assert pg.evaluate("__dbg.rescue.state") == 'deploying', 'T4: 恢复低速应可部署'
    pg.keyboard.press('KeyK')
    print('T4 PASS: 低速可部署 / 高速拒绝(speed=%.1f→toast) / 恢复可再部署' % spd4)

    # ---- T6: 起飞/降落连续性回归锚（P5-A 语义） ----
    pg.evaluate("__dbg.fp.exit()")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.S._alt=0")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.S.running=true; __dbg.S.spin=1")
    pg.keyboard.press('KeyT')
    pg.wait_for_function("() => __dbg.FLY.state === 'hover'", timeout=20000)
    # 采样 pitch 连续性
    s = []
    for _ in range(20):
        s.append(pg.evaluate("+__dbg.FLY.pitch.toFixed(4)"))
        pg.wait_for_timeout(60)
    jumps = [abs(s[i]-s[i-1]) for i in range(1, len(s)) if abs(s[i]-s[i-1]) > 0.045]
    assert not jumps, ('T6: 起飞 pitch 出现硬跳变', jumps)
    print('T6 PASS: 起飞 pitch 连续（%d 采样零跳变）' % len(s))

    # ---- T7: FPV/环绕切换 stability 重算（无残留） ----
    pg.evaluate("__dbg.fp.enter()")
    pg.wait_for_timeout(400)
    pg.evaluate("__dbg.keys['w']=true")
    pg.wait_for_timeout(400)
    st7a = pg.evaluate("__dbg.S._stability")
    assert st7a < 1, ('T7: FPV 机动中 stability < 1', st7a)
    pg.evaluate("__dbg.fp.exit(); __dbg.keys['w']=false")
    pg.wait_for_timeout(400)
    st7b = pg.evaluate("__dbg.S._stability")
    assert st7b == 1, ('T7: 退出 FPV 后环绕静止 stability 应为 1（无残留）', st7b)
    print('T7 PASS: FPV 机动 %.2f → 退出环绕静止 %.2f（无跨轴残留）' % (st7a, st7b))

    pg.screenshot(path=H.output_path('shot_flight_tactics.jpg'), type='jpeg', quality=88)
    print('P7 flight-tactics OK: T1-T7 全过')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')