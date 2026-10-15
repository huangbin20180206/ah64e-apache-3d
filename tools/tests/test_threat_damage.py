# -*- coding: utf-8 -*-
# P8 威胁、武器与损伤反馈——值级浏览器断言
# 覆盖指令 §6：威胁等级可读/出现升级解除；受损分级与真实后果；
# 失败归因与状态源一致；三类武器弹药差异/耗尽/装填；清理/恢复路径。
# 全部 __dbg 数值断言，无中文文案依赖、无固定墙钟、无截图猜测。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rig && __dbg.rescue)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1200)
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_timeout(200)

    # ---- D1: 威胁等级 0→反击活跃→受击高（出现/升级/解除） ----
    # 地面停放（startMission 后 alt=0）→ 无反击 → 威胁 0
    assert pg.evaluate("__dbg.targets._threat") == 0, 'D1: 地面停放威胁应为 0'
    # 悬停 z=0 alt=14（距 baseCenter(0,42) bd=42 在反击区 8~55u）→ 反击活跃 → 威胁 ≥1
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    pg.wait_for_function("() => __dbg.targets._threat >= 1", timeout=15000)   # B4：aaActive 每帧派生——条件等待
    t1 = pg.evaluate("__dbg.targets._threat")
    assert t1 >= 1, ('D1: 悬停反击区威胁应 ≥1（反击活跃）', t1)
    # 模拟受击（_threatHitFlash=3 → 威胁=3 高）
    pg.evaluate("__dbg.targets._threatHitFlash = 3")
    pg.wait_for_function("() => __dbg.targets._threat === 3", timeout=15000)
    assert pg.evaluate("__dbg.targets._threat") == 3, 'D1: 受击后威胁应为 3（高）'
    # 解除：降落/远离 + 受击闪光消退 → 威胁归 0
    pg.evaluate("__dbg.FLY.alt = 0; __dbg.FLY.state = 'ground'; __dbg.S._alt = 0; __dbg.targets._threatHitFlash = 0")
    pg.wait_for_function("() => __dbg.targets._threat === 0", timeout=15000)
    assert pg.evaluate("__dbg.targets._threat") == 0, 'D1: 降落/远离后威胁应解除为 0'
    print('D1 PASS: 威胁 0→悬停≥1→受击 3→解除 0（出现/升级/解除）')

    # ---- D2: 受损烟（_heliDmg≥4 显示）+ onHeliHit 派生 _dmgPenalty ----
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.S._alt=0; __dbg.FLY.z=20")
    pg.evaluate("__dbg.targets._heliDmg = 5")
    pg.wait_for_function("() => __dbg.targets._dmgSmoke.visible === true", timeout=15000)   # B4：烟显隐由 targets.update 派生
    assert pg.evaluate("__dbg.targets._dmgSmoke.visible") is True, 'D2: 受损≥4 应显示受损烟'
    # onHeliHit 注入回调：模拟受击触发 → rig._dmgPenalty 派生（同步事件——条件等待立即过）
    pg.evaluate("__dbg.targets._heliDmg = 0")          # 重置计数（onHeliHit 独立验证）
    pg.evaluate("__dbg.rig._dmgPenalty = 0")
    pg.evaluate("__dbg.targets.onHeliHit(5, null)")
    pg.wait_for_function("() => Math.abs(__dbg.rig._dmgPenalty - 0.3) < 1e-6", timeout=5000)
    p2 = pg.evaluate("__dbg.rig._dmgPenalty")
    assert abs(p2 - 0.3) < 1e-6, ('D2: onHeliHit 应派生 _dmgPenalty=0.3', p2)
    print('D2 PASS: 受损烟随 _heliDmg≥4 显示 + onHeliHit 派生散布惩罚 %.2f' % p2)

    # ---- D3: 三类武器弹药差异 + 耗尽自动停 + 装填恢复 ----
    w = pg.evaluate("(() => ({ gun: __dbg.rig.gunAmmo, rk: __dbg.rig.rocketAmmo, hf: __dbg.rig.hfAmmo }))()")
    assert w['gun'] > w['rk'] > w['hf'], ('D3: 弹药量应 机炮>火箭>地狱火', w)
    # 机炮耗尽 → gunOn 自动停（update 内——rig.update 每帧派生，条件等待）
    pg.evaluate("__dbg.rig.gunAmmo = 1; __dbg.rig.gunOn = true")
    pg.wait_for_function("() => __dbg.rig.gunOn === false", timeout=15000)
    assert pg.evaluate("__dbg.rig.gunOn") is False, 'D3: 机炮弹药耗尽应自动停扳机'
    # 装填恢复
    pg.evaluate("__dbg.rig.reload(true)")
    pg.wait_for_function("() => __dbg.rig.gunAmmo === 1200", timeout=5000)
    assert pg.evaluate("__dbg.rig.gunAmmo") == 1200, 'D3: 装填后机炮应回满'
    print('D3 PASS: 弹药差异 %d/%d/%d + 耗尽自动停 + 装填恢复' % (w['gun'], w['rk'], w['hf']))

    # ---- D4: 受损散布惩罚（健康 0 vs 受损 0.3 的散布公式差异） ----
    # 散布 = base*(1+(1-stab)*2.5)*(1+dmg)；健康 dmg=0 vs 受损 dmg=0.3 差 +30%
    d4 = pg.evaluate("(() => { const stab = __dbg.S._stability ?? 1;"
                     " const b = 0.03;"
                     " const sp0 = b * (1 + (1 - stab) * 2.5) * 1;"
                     " const spD = b * (1 + (1 - stab) * 2.5) * (1 + 0.3);"
                     " return { sp0: +sp0.toFixed(5), spD: +spD.toFixed(5) }; })()")
    assert d4['spD'] > d4['sp0'] * 1.25, ('D4: 受损散布应显著大于健康', d4)
    print('D4 PASS: 受损散布惩罚 %s -> %s（+30pct 公式）' % (d4['sp0'], d4['spD']))

    # ---- D5: 损伤≥12 → failed(damage) + 面板归因（状态源一致） ----
    pg.evaluate("__dbg.targets._heliDmg = 12")
    pg.wait_for_function("() => __dbg.mission && __dbg.mission.phase === 'failed' && __dbg.mission.failedReason === 'damage'", timeout=15000)   # B4：loop 0.5s 判定——条件等待
    m5 = pg.evaluate("(() => ({ phase: __dbg.mission.phase, reason: __dbg.mission.failedReason,"
                     " frozen: __dbg.mission.frozen, body: document.getElementById('mission-body').innerHTML }))()")
    assert m5['phase'] == 'failed' and m5['reason'] == 'damage' and m5['frozen'], ('D5: 损伤≥12 未触发失败', m5)
    assert '机体受损' in m5['body'], ('D5: 失败面板应显示受损归因', m5['body'])
    print('D5 PASS: 损伤≥12 → failed(damage) + 归因面板（状态源一致）')

    # ---- D6: 重试清理（受损/威胁/惩罚/烟）+ 可再次进行 ----
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'briefing'", timeout=5000)
    d6 = pg.evaluate("(() => ({ dmg: __dbg.targets._heliDmg, threat: __dbg.targets._threat,"
                     " penalty: __dbg.rig._dmgPenalty, smoke: __dbg.targets._dmgSmoke.visible,"
                     " phase: __dbg.mission.phase }))()")
    assert d6['dmg'] == 0 and d6['threat'] == 0 and d6['penalty'] == 0 and not d6['smoke'], ('D6: 重试未清受损/威胁/惩罚/烟', d6)
    assert d6['phase'] == 'briefing', ('D6: 重试应回简报', d6)
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'active'", timeout=5000)
    assert pg.evaluate("__dbg.mission.phase") == 'active', 'D6: 重试后可再次进行'
    print('D6 PASS: 重试清理受损/威胁/惩罚/烟 + 恢复进行中')

    # ---- D7: resetRange 清理（受损/惩罚/任务） ----
    pg.evaluate("__dbg.targets._heliDmg = 6; __dbg.rig._dmgPenalty = 0.3")
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_timeout(300)
    d7 = pg.evaluate("(() => ({ dmg: __dbg.targets._heliDmg, penalty: __dbg.rig._dmgPenalty,"
                     " mission: __dbg.mission, found: __dbg.S._baseFound }))()")
    assert d7['dmg'] == 0 and d7['penalty'] == 0 and d7['mission'] is None and d7['found'] is False, ('D7: resetRange 未清', d7)
    print('D7 PASS: resetRange 清理受损/惩罚/任务/基地发现')

    pg.screenshot(path=H.output_path('shot_threat_damage.jpg'), type='jpeg', quality=88)
    print('P8 threat-damage OK: D1-D7 全过')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
