# -*- coding: utf-8 -*-
# Phase 19：机务损伤与特情处置——值级浏览器断言（playwright）
# 【写好入库、浏览器验证等门禁空窗跑】——全部 __dbg 数值断言、条件等待
# 无固定墙钟。rng 在运行时经 damageSys.rng 注入（构造参数语义，非 mock
# 被测对象）保证概率分支确定性。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rig && __dbg.damageSys)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    H.step(pg, 0.3)

    # ---- D1: 初始全绿（四系统 0、无卡壳、HUD OK） ----
    s1 = pg.evaluate("(() => { const s = __dbg.damageSys.state();"
                    " return { r: s.sys.rotor, e: s.sys.engine, w: s.sys.weapons, a: s.sys.avionics,"
                    " jam: s.jammed, bonus: s.bonusMul,"
                    " mx: document.getElementById('hud-mx').textContent }; })()")
    assert s1['r'] == 0 and s1['e'] == 0 and s1['w'] == 0 and s1['a'] == 0, ('D1: 初始应全 0', s1)
    assert s1['jam'] is False and s1['bonus'] == 1, ('D1: 无卡壳/系数 1', s1)
    assert s1['mx'] == 'OK', ('D1: 机务 HUD 应 OK', s1)
    print('D1 PASS: 初始全零 + 机务 HUD=OK')

    # ---- D2: 命中方位分配（顶击 → 旋翼主伤）+ 散布追加走 onHeliHit ----
    # 注意：本段及后续 D3-D8 全程**不得**把机体悬停在敌方反击区（距基地 42u
    # + 离地即交战）——AA/SAM 命中会持续注入 _heliDmg/四系统损伤，破坏一切
    # 精确值断言（D4 的 av===40 曾因此数学不可达：avionics 被命中推到 65
    # 后重启 -20=45，探针轨迹实证）。地面停放（离地 0）不交战，链路干净；
    # onHeliHit 是直接调用，顶击方位由 hitPos=root+5y 决定，与悬停无关。
    # rng 注入 0.5 → 扰动乘数恒 1.0，四键分配确定：rotor 7 / engine 1 /
    # weapons 1 / avionics 1（权重表 top=0.70/0.10/0.10/0.10 和为 1，探针实证
    # 总和恰 10——无"权重缺口"；曾误读为只分配出 8，实为断言只读了两键）。
    # pen = min(0.5, 10*0.06) + spreadAdd：spreadAdd 是等级驱动（wL*0.06），
    # weapons 分到 1 点远不足 lvl1（25）→ spreadAdd=0 → pen=0.5（旧断言误把
    # spreadAdd 当 0.1 期望 0.6——等级 0 时必为 0.5）。
    pg.evaluate("__dbg.damageSys.rng = () => 0.5")   # rng 注入：扰动恒 1.0
    pg.evaluate("__dbg.targets.onHeliHit(10, { x: __dbg.apache.root.position.x, y: __dbg.apache.root.position.y + 5, z: __dbg.apache.root.position.z })")
    H.step(pg, 0.2)
    d2 = pg.evaluate("(() => ({ rotor: __dbg.damageSys.sys.rotor, engine: __dbg.damageSys.sys.engine,"
                    " weapons: __dbg.damageSys.sys.weapons, avionics: __dbg.damageSys.sys.avionics,"
                    " pen: __dbg.rig._dmgPenalty, levels: __dbg.damageSys.state().levels }))()")
    assert 6.9 < d2['rotor'] < 7.1, ('D2: 顶击应 70% 进旋翼（≈7）', d2)
    assert abs(d2['engine'] - 1) < 1e-6 and abs(d2['weapons'] - 1) < 1e-6 and abs(d2['avionics'] - 1) < 1e-6, \
        ('D2: 顶击其余三键应各 10%（权重表和为 1，总分配=10）', d2)
    assert abs(d2['rotor'] + d2['engine'] + d2['weapons'] + d2['avionics'] - 10) < 1e-6, ('D2: 分配总和应=10（无缺口）', d2)
    assert d2['levels']['rotor'] == 0, ('D2: 7 < 25 应仍完好', d2)   # 级从 25 起
    assert abs(d2['pen'] - 0.5) < 1e-9, ('D2: 散布=min(0.5,10*0.06)+spreadAdd(weapons lvl0→0)', d2)
    print('D2 PASS: 方位分配 top→rotor≈7（确定性）+ 散布惩罚事件驱动')

    # ---- D3: 卡壳 + N 上膛（rng 注入必成功）+ 冷却 + 期间 jam 锁 ----
    pg.evaluate("(() => { const d = __dbg.damageSys; d.jammed = true; d.rng = () => 0.1; })()")
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('n')
    H.step(pg, 0.2)
    assert pg.evaluate("__dbg.damageSys.state().jamBusy") is True, 'D3: N 应启动上膛'
    # 上膛期武器不可用：gunOn 被按住也不发射（弹药不减）
    pg.evaluate("__dbg.rig.gunOn = true; window.__g0 = __dbg.rig.gunAmmo")
    H.step(pg, 0.6)
    assert pg.evaluate("__dbg.rig.gunAmmo") == pg.evaluate("window.__g0"), 'D3: 上膛期机炮应被 _jam 守卫拦截'
    pg.evaluate("__dbg.rig.gunOn = false")
    H.step_until(pg, "() => !__dbg.damageSys.state().jamBusy && !__dbg.damageSys.jammed", 5)
    d3 = pg.evaluate("(() => ({ cool: __dbg.damageSys.state().jamCool, pen: __dbg.rig._dmgPenalty }))()")
    assert d3['cool'] > 0, ('D3: 成功后应有冷却', d3)
    print('D3 PASS: N 上膛（3s 期 _jam 拦截射击）成功解卡 + 冷却')

    # ---- D4: 航电失效窗口 + I 重启（全黑 → 恢复修复） ----
    pg.evaluate("(() => { const d = __dbg.damageSys; d.sys.avionics = 60; d.recompute(); })()")
    H.step_until(pg, "() => __dbg.damageSys.state().hudFail", 10)
    # 状态源 hudFail 与 DOM 显示之间有 0.5s 节流滞后（窗口 1.2s > 节流——'---'
    # 必然显示，但 wait 过 hudFail 的瞬间可能还没写入）——断言必须条件等待
    # DOM 真值，帧率无关；若恰好错过本次窗口，8s 周期（12-lvl*2）内再来。
    H.step_until(pg, "() => document.getElementById('hud-alt').textContent === '---'", 10)
    H.step_until(pg, "() => document.getElementById('hud-mx').textContent === '---'", 10)
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('i')
    H.step_until(pg, "() => __dbg.damageSys.state().hudDead", 3)
    H.step_until(pg, "() => !__dbg.damageSys.state().rebootBusy && __dbg.damageSys.sys.avionics === 40", 6)
    print('D4 PASS: avionics 60→hudFail 窗口(HUD ---)→I 重启→修复 40')

    # ---- D5: U 引擎降功率开关（S._dmgFx.powerCap×0.85 生效） ----
    pg.evaluate("(() => { const d = __dbg.damageSys; d.sys.engine = 30; d.overheat = 0.6; d.recompute(); })()")
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('u')
    H.step_until(pg, "() => __dbg.damageSys.mitigate", 2)
    # S._dmgFx 是 loop 每帧刷新的引用（mitigate 同步置位但派生量要等下一帧
    # 刷新）——条件等待真值，与 D6 同族读法（全量门禁首轮实锤：紧跟 wait 的
    # 同步断言读到旧对象 powerCap=1）
    H.step_until(pg, "() => Math.abs(__dbg.S._dmgFx.powerCap - 0.84 * 0.85) < 0.01", 5)
    pc = pg.evaluate("__dbg.S._dmgFx.powerCap")
    assert abs(pc - 0.84 * 0.85) < 0.01, ('D5: 降功率 powerCap 应 (1-0.16)*0.85', pc)
    H.step_until(pg, "() => __dbg.damageSys.state().overheat < 0.6", 4)
    print('D5 PASS: U 降功率（powerCap 0.714）+ overheat 持续下降')

    # ---- D6: 振动放大（rotor 损伤后 _dmgFx.vibMul > 1，loop 已接入） ----
    pg.evaluate("(() => { const d = __dbg.damageSys; d.sys.rotor = 60; d.recompute(); })()")
    # recompute() 每次新建 _fxCache 对象，而 S._dmgFx 是 loop 每帧刷新的引用——
    # 紧跟 recompute 的同步断言可能读到旧对象（vibMul 仍旧值 1.0）。条件等待
    # loop 刷新后的真值（帧率无关）；恰 60 → lvl2 → 1+2*0.45=1.9。
    H.step_until(pg, "() => __dbg.S._dmgFx.vibMul === 1.9", 5)
    # 操控惩罚合成：S._pen.speedMul = samwar 表 × respMul（同帧读两侧，关系恒成立）
    sp = pg.evaluate("(() => ({ pen: __dbg.S._pen.speedMul, fx: __dbg.S._dmgFx.respMul }))()")
    assert abs(sp['pen'] - 1.0 * sp['fx']) < 1e-9, ('D6: S._pen 应为 SAM 表×respMul', sp)
    print('D6 PASS: vibMul 1.9 + S._pen 合成 = 表×respMul')

    # ---- D7: resetRange 全清（系统/卡壳/过热/处置/HUD 回 OK） ----
    pg.evaluate("__dbg.resetRange()")
    H.step_until(pg, "() => __dbg.damageSys.state().sys.rotor === 0 && !__dbg.damageSys.mitigate", 5)
    # hud-mx 是 0.5s 节流写入的 DOM（状态源已清但显示可能滞后一拍）——条件等待
    H.step_until(pg, "() => document.getElementById('hud-mx').textContent === 'OK'", 5)
    d7 = pg.evaluate("(() => { const s = __dbg.damageSys.state();"
                    " return { mx: document.getElementById('hud-mx').textContent, bonus: s.bonusMul, oh: s.overheat }; })()")
    assert d7['mx'] == 'OK' and d7['bonus'] == 1 and d7['oh'] == 0, ('D7: resetRange 应清机务', d7)
    print('D7 PASS: resetRange 清机务（HUD OK/系数 1/过热 0）')

    # ---- D8: 战损得分系数边界（结算通道 damageMul） ----
    d8 = pg.evaluate("(() => { const d = __dbg.damageSys; d.sys.rotor = 50;"
                    " const m1 = d.bonusMul(); d.sys.rotor = 100; const m2 = d.bonusMul();"
                    " d.sys.rotor = 0; return { m1, m2 }; })()")
    assert abs(d8['m1'] - 1.0625) < 1e-9 and abs(d8['m2'] - 1.125) < 1e-9, ('D8: 系数 50→1.0625/100→1.125', d8)
    print('D8 PASS: 战损得分系数边界（单系统 50/100）')

    # ---- D9: 操控惩罚不随帧复利（回归断言）----
    # 历史缺陷（2026-09-18 主树侧**代码审查**发现，**全套 76 项测试均未覆盖**）：
    # 70-app 曾写 `S._pen = samwar.penaltyFor(...)`——该函数返回 SAM_PENALTY_TABLE 的
    # **共享条目引用**，随后 damageSys 段的 `S._pen.speedMul = _swp.speedMul * fx.respMul`
    # 便写回表里；而 respMul 恒 < 1（旋翼任一等级受伤即 (1-rL*0.08)），
    # 于是**每帧自乘、惩罚复利**。
    # 实测修复前：注入 rotor=30 后 speedMul 每 120ms 由 0.659 衰到 0.022——
    # 0.7 秒内玩家前进/侧飞/转向全部归零、直升机不可操控。
    # 修法：复制值而非替换引用。本断言把"惩罚系数必须稳定"钉死。
    pg.evaluate("(() => { const d = __dbg.damageSys; d.sys.rotor = 30; d.recompute(); })()")
    H.step(pg, 0.3)
    p1 = pg.evaluate("+__dbg.S._pen.speedMul.toFixed(6)")
    H.step(pg, 0.4)
    p2 = pg.evaluate("+__dbg.S._pen.speedMul.toFixed(6)")
    assert p1 == p2, ('D9: 操控惩罚随帧漂移（共享表被写回的复利回归）', p1, p2)
    assert p1 > 0.5, ('D9: 惩罚系数不应塌陷', p1)
    pg.evaluate("(() => { const d = __dbg.damageSys; d.sys.rotor = 0; d.recompute(); })()")
    print('D9 PASS: 操控惩罚稳定不漂移（speedMul=%.3f 恒定）' % p1)

    pg.screenshot(path=H.output_path('shot_damage.jpg'), type='jpeg', quality=88)
    print('Phase 19 damage OK: D1-D9 全过')


import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
