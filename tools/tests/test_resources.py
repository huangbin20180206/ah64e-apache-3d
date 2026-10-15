# -*- coding: utf-8 -*-
# Phase 20-B：资源与压力（燃油/补给窗口）——值级浏览器断言（playwright）
# 全部 __dbg 数值断言、条件等待无固定墙钟。耗油的确定性速率已由纯 pytest
# 覆盖（悬停 0.22%/s 恰值），此处验证接线链（HUD/事件消费/失败路径/补给）。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.resources && __dbg.rig && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    H.step(pg, 0.3)

    # ---- R1: 非任务局——满油 + HUD 燃油行隐藏 ----
    r1 = pg.evaluate("(() => ({ fuel: __dbg.resources.state().fuel, hud: document.getElementById('hud-fuel-wrap').style.display }))()")
    assert r1['fuel'] == 100 and r1['hud'] == 'none', ('R1: 非任务局应满油且 HUD 隐藏', r1)
    print('R1 PASS: 非任务局满油 + HUD 燃油行隐藏')

    # ---- R2: 任务局 beginMission 后——HUD 显示 + 悬停耗油可感知 ----
    pg.evaluate("(() => { __dbg.S.mode = 'mission'; __dbg.startMission('standard'); })()")
    pg.evaluate("(() => { const m=__dbg.S._mission; m.phase='active'; if(m.t0==null) m.t0=__dbg.S.time; __dbg.beginMission(); })()")
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; F.fp=false; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    H.step_until(pg, "() => document.getElementById('hud-fuel-wrap').style.display === ''", 8)
    f0 = pg.evaluate("(() => ({ fuel: __dbg.resources.state().fuel, hud: document.getElementById('hud-fuel').textContent }))()")
    H.step_until(pg, "() => __dbg.resources.state().fuel < 99.5", 15)
    f1 = pg.evaluate("(() => ({ fuel: __dbg.resources.state().fuel, txt: document.getElementById('hud-fuel').textContent }))()")
    assert f1['fuel'] < f0['fuel'] and f1['fuel'] > 97, ('R2: 悬停耗油应在 0.22%/s 量级（5s 约 1%）', (f0, f1))
    assert f1['txt'] != '', ('R2: HUD 燃油读数应非空', f1)
    print('R2 PASS: 任务局 HUD 显示 + 悬停耗油（%.1f→%.1f）' % (f0['fuel'], f1['fuel']))

    # ---- R3: 燃油耗尽 → 迫降失败（failMission('fuel') 接线） ----
    # 同步驱动 update 加速耗油（喂 env 是设计接口——70-app 每帧同款）；
    # fuelOut 事件由页面 loop 消费（异步等 mission failed 归因 fuel）。
    pg.evaluate("(() => { const r = __dbg.resources; const env = { dt: 0.05, active: true, strength: 1, homeDist: 50, alt: 14, stability: 1, variant: 'standard' }; for (let i = 0; i < 2500; i++) r.update(env); })()")
    H.step_until(pg, "() => __dbg.resources.state().fuel === 0 && __dbg.resources.state().out === true", 5)
    H.step_until(pg, "() => __dbg.S._mission && __dbg.S._mission.phase === 'failed' && __dbg.S._mission.failedReason === 'fuel'", 10)
    r3 = pg.evaluate("(() => ({ reason: __dbg.S._mission.failedReason, txt: document.getElementById('mission-body').innerText.includes('燃油耗尽') }))()")
    assert r3['reason'] == 'fuel' and r3['txt'], ('R3: 油尽应 failMission(fuel)+归因文案', r3)
    print('R3 PASS: 燃油耗尽→迫降失败（归因文案在结算面板）')

    # ---- R4: 重开任务 → RTB 补给窗口全链（低空悬停停机坪 3s → 满油满弹） ----
    pg.evaluate("(() => { __dbg.startMission('standard'); })()")
    pg.evaluate("(() => { const m=__dbg.S._mission; m.phase='active'; if(m.t0==null) m.t0=__dbg.S.time; __dbg.beginMission(); })()")
    # 先耗掉一部分油+弹药（制造"需要补给"的状态）
    pg.evaluate("(() => { const r = __dbg.resources; const env = { dt: 0.05, active: true, strength: 1, homeDist: 50, alt: 14, stability: 1, variant: 'standard' }; for (let i = 0; i < 800; i++) r.update(env); })()")
    pg.evaluate("(() => { __dbg.rig.gunAmmo -= 300; __dbg.S._ga = -1; })()")   # 打掉 300 发（HUD 缓存失效）
    H.step(pg, 0.2)
    pre = pg.evaluate("(() => ({ fuel: __dbg.resources.state().fuel, gun: __dbg.rig.gunAmmo }))()")
    assert pre['fuel'] < 100 and pre['gun'] < 1200, ('R4: 补给前应有损耗', pre)
    # 停机坪低空稳定悬停（0,0 8u 内、alt 2、无机动）。fp=true 让 hover 沉浮
    # 让位——否则 flyUpdate 每帧把 alt 钉回 HOVER=14，补给窗（alt<4）随即断裂
    # （首轮实测 rtbOn 闪断后 rtbT 清零永不 resupplied 的根因；probe_perf
    # SETUP_HOVER 同款惯用法）。
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=2; F.x=1.5; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; F.fp=true; __dbg.S._alt=0; })()""")
    H.step_until(pg, "() => __dbg.resources.state().rtbOn === true", 8)
    H.step_until(pg, "() => __dbg.resources.state().resupplied === true", 10)
    r4 = pg.evaluate("(() => ({ fuel: __dbg.resources.state().fuel, gun: __dbg.rig.gunAmmo }))()")
    assert r4['fuel'] == 100 and r4['gun'] == 1200, ('R4: 补给应满油满弹', (pre, r4))
    print('R4 PASS: RTB 补给（油 %.0f→100 · 机炮 %d→1200）' % (pre['fuel'], pre['gun']))

    # ---- R5: limited_ammo 变体禁补给窗（frugal 成就保护） ----
    pg.evaluate("(() => { __dbg.startMission('limited_ammo'); })()")
    pg.evaluate("(() => { const m=__dbg.S._mission; m.phase='active'; if(m.t0==null) m.t0=__dbg.S.time; __dbg.beginMission(); })()")
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=2; F.x=1.5; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; F.fp=true; __dbg.S._alt=0; })()""")
    H.step(pg, 1.2)   # 负断言：等 1.2s 后窗口仍不开
    r5 = pg.evaluate("(() => ({ rtbOn: __dbg.resources.state().rtbOn, gun: __dbg.rig.gunAmmo }))()")
    assert r5['rtbOn'] is False, ('R5: limited_ammo 应禁补给窗', r5)
    assert r5['gun'] == 600, ('R5: 受限弹药应减半（1200/2）', r5)
    print('R5 PASS: limited_ammo 禁补给窗 + 弹药减半')

    # ---- R6: 弹药耗尽失败（三类全空 + 目标未全歼 → failMission('ammo')） ----
    pg.evaluate("(() => { __dbg.rig.gunAmmo = 0; __dbg.rig.rocketAmmo = 0; __dbg.rig.hfAmmo = 0; __dbg.S._ga = -1; })()")
    H.step_until(pg, "() => __dbg.S._mission && __dbg.S._mission.phase === 'failed' && __dbg.S._mission.failedReason === 'ammo'", 10)
    r6 = pg.evaluate("(() => ({ reason: __dbg.S._mission.failedReason, remain: __dbg.targets.aliveCount }))()")
    assert r6['reason'] == 'ammo' and r6['remain'] > 0, ('R6: 弹尽应 failMission(ammo)', r6)
    print('R6 PASS: 弹药耗尽+目标未清→失败（归因 ammo）')

    pg.screenshot(path=H.output_path('shot_resources.jpg'), type='jpeg', quality=88)
    print('Phase 20 resources OK: R1-R6 全过')


import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
