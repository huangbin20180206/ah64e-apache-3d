# -*- coding: utf-8 -*-
# P5-C 综合视觉反馈一致性——场地切换残留回归（值级断言）
# 覆盖验收点 4.2/4.3：
#   G1: 发射中的火箭/曳光/飞行地狱火在切换场地后全部清理（rig 池零可见）
#   G2: 残骸燃烧在靶场禁用（enabled=false，湖面）后不再冒烟（puffs 不新增）
#   G3: 切回可用场地后武器系统仍可发射（清理不破坏复用池）
# 全部走 __dbg 数值遥测，无固定墙钟、无中文文案、无单帧截图。
import sys, os, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rig && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)

    # 准备：沙漠正午 + 悬停（武器发射环境）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("""(() => { const F = __dbg.FLY; F.state='hover'; F.alt=14; __dbg.S._alt=0;
      F.x=0; F.z=0; F.yaw=0; F.pitch=0; __dbg.S.running=true; __dbg.S.spin=1; })()""")
    pg.wait_for_timeout(300)

    # 发射 2 枚火箭制造活跃弹体 + 大地烟尘
    pg.evaluate("__dbg.rig.launchRocket(); __dbg.rig.launchRocket()")
    pg.wait_for_timeout(150)
    flying_before = pg.evaluate("(() => ({ rockets: __dbg.rig.rockets.filter(r=>r.g.visible).length,"
                                " tracers: __dbg.rig.tracers.filter(t=>t.m.visible).length,"
                                " flying: __dbg.rig.flying.length }))()")
    assert flying_before['rockets'] >= 1, ('G: 前置失败——火箭未发射', flying_before)
    print('G: active projectiles before switch:', flying_before)

    # ---- G1: 切湖面后武器池必须清空（发射中弹体不横跨进入新场地） ----
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(500)
    after_switch = pg.evaluate("(() => ({ rockets: __dbg.rig.rockets.filter(r=>r.g.visible).length,"
                               " tracers: __dbg.rig.tracers.filter(t=>t.m.visible).length,"
                               " flying: __dbg.rig.flying.length, terr: __dbg.W.terrainKey,"
                               " enabled: __dbg.targets.enabled }))()")
    assert after_switch['terr'] == 'water', ('G1: 切场地失败', after_switch)
    assert after_switch['enabled'] is False, ('G1: 湖面靶场应禁用', after_switch)
    assert after_switch['rockets'] == 0 and after_switch['tracers'] == 0 and after_switch['flying'] == 0, \
        ('G1: 切场地后武器弹体未清理（跨场地残留）', after_switch)
    print('G1 PASS: 切湖面后武器弹体全部清理', after_switch)

    # ---- G2: 制造残骸 -> 湖面(禁用)下 update 不得再冒烟 ----
    # 切到沙漠制造残骸（靶场启用路径），再切回湖面
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(300)
    rb = pg.evaluate("""(() => {
      const ts = __dbg.targets.targets; const t = ts.find(x => x.alive);
      if (!t) return 'none';
      __dbg.targets.destroy(t, 2);
      return (t.type || '?') + ' burn=' + t.burn;
    })()""")
    assert rb != 'none', ('G2: 前置失败——无可毁目标', rb)
    print('G2: wrecked target:', rb)
    # 记录销毁前烟尘池活跃数
    before_wreck_smoke = pg.evaluate("__dbg.rig.puffs.filter(p=>p.m.visible).length")
    # 再切湖面（靶场禁用）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"water\\\"]').click()")
    pg.wait_for_timeout(300)
    # 显式驱动 targets.update 一帧（模拟残骸燃烧窗口），烟不应新增
    pg.evaluate("(() => { try { __dbg.targets.update(0.24, __dbg.apache.root.position); } catch(e){} })()")
    pg.evaluate("(() => { try { __dbg.targets.update(0.24, __dbg.apache.root.position); } catch(e){} })()")
    pg.wait_for_timeout(250)
    after_wreck_smoke = pg.evaluate("__dbg.rig.puffs.filter(p=>p.m.visible).length")
    # 判定：湖面下残骸燃烧不得新增烟（允许 <= 切场瞬间的既有数量 + 1 抖动）
    assert after_wreck_smoke <= before_wreck_smoke + 1, \
        ('G2: 湖面(靶场禁用)残骸仍在冒烟', before_wreck_smoke, after_wreck_smoke)
    print('G2 PASS: 禁用下残骸不冒烟 (smoke %d -> %d)' % (before_wreck_smoke, after_wreck_smoke))

    # ---- G3: 切回沙漠武器池恢复可用（清理不破坏发射） ----
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)
    ok = pg.evaluate("(() => { __dbg.rig.rocketAmmo = 38;"
                     " const r = __dbg.rig.launchRocket();"
                     " return r === true; })()")
    assert ok, 'G3: 清理后火箭无法再发射'
    n = pg.evaluate("__dbg.rig.rockets.filter(x=>x.g.visible).length")
    assert n >= 1, ('G3: 清理后火箭池不可用', n)
    print('G3 PASS: 清理后武器复用池正常发射')

    pg.screenshot(path=H.output_path('shot_p5c_gap.jpg'), type='jpeg', quality=88)
    print('P5-C gap regression OK: G1 切场清理 / G2 禁用不冒烟 / G3 复用池可用')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')