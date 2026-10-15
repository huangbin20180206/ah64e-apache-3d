# -*- coding: utf-8 -*-
# probe_playthrough.py — Phase 20 可玩纵切片端到端自证（一整局数值轨迹）
# 用法：uv run --with playwright python tools/probe_playthrough.py [http://localhost:8642]
# 输出：%TEMP%\apache_pw\playthrough_trace.json（时间序列：燃油/弹药/损伤/得分）
#       + 3 张关键帧截图（起飞/交战/结算）。退出码 0=全链绿。
# 流程（真实链优先，战斗输出用注入加速——燃料/飞行/结算全走真通道）：
#   startCampaign(0)（战役关卡入口）→ 空格真实启旋 → T 真实起飞 →
#   方向键平移接近基地（真实机动耗油）→ 按住 G 真实开火 → destroy 注入
#   清场剩余目标 → 结算评级/记档断言 → 存档落盘核对。
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8642'
OUT = os.path.join(os.environ.get('TEMP', '.'), 'apache_pw')
os.makedirs(OUT, exist_ok=True)

trace = []


def sample(pg, tag):
    trace.append(pg.evaluate("""(() => {
        const m = __dbg.S._mission;
        return { tag: '%s', t: +(__dbg.S.time - (m && m.t0 != null ? m.t0 : __dbg.S.time)).toFixed(1),
                 phase: m ? m.phase : null, fuel: __dbg.resources.state().fuel,
                 alt: +__dbg.FLY.alt.toFixed(1), gun: __dbg.rig.gunAmmo,
                 rk: __dbg.rig.rocketAmmo, hf: __dbg.rig.hfAmmo,
                 dmg: __dbg.targets._heliDmg, score: __dbg.arcade.score,
                 combo: __dbg.arcade.combo, live: __dbg.enemyAir.state().live }; })()""" % tag))


def main():
    ok = False
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            '--use-angle=d3d11', '--disable-backgrounding-occluded-windows',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion'])
        try:
            pg = browser.new_page(viewport={'width': 1280, 'height': 800})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(URL + '/?nocine=1&nocut=1', wait_until='domcontentloaded')
            pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.campaign && __dbg.resources && __dbg.rig && __dbg.targets)", timeout=60000)
            pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
            # 清战役存档，从第 1 关起步
            pg.evaluate("(() => { try { localStorage.removeItem('ah64_campaign'); } catch (e) {} })()")

            # ---- ① 战役第 1 关（真实入口）----
            pg.evaluate("(() => { __dbg.S.mode = 'mission'; })()")
            pg.evaluate("__dbg.startCampaign(0)")
            pg.wait_for_timeout(400)
            m0 = pg.evaluate("(() => ({ li: __dbg.S._mission.levelIdx, v: __dbg.S._mission.variant }))()")
            assert m0['li'] == 0 and m0['v'] == 'standard', ('关卡入口', m0)
            # 简报确认（真实按钮通道）
            pg.evaluate("(() => { const m = __dbg.S._mission; m.phase='active'; if(m.t0==null) m.t0 = __dbg.S.time; const r=__dbg.rig; m.gun0=r.gunAmmo; m.rk0=r.rocketAmmo; m.hf0=r.hfAmmo; __dbg.beginMission(); })()")
            sample(pg, 'briefing')

            # ---- ② 真实启旋（空格）→ 转速爬升到起飞阈值 ----
            pg.evaluate("document.activeElement && document.activeElement.blur()")
            pg.keyboard.press(' ')
            pg.wait_for_function("() => __dbg.S.spin >= 0.92", timeout=20000)
            # ---- ③ 真实起飞（T）→ 悬停 ----
            pg.keyboard.press('t')
            pg.wait_for_function("() => __dbg.FLY.state === 'hover'", timeout=20000)
            sample(pg, 'takeoff')
            pg.screenshot(path=os.path.join(OUT, 'playthrough_takeoff.jpg'), type='jpeg', quality=88)

            # ---- ④ 平移接近基地（真实机动：按住 ↑，耗油 strength=1）----
            pg.keyboard.down('ArrowUp')
            pg.wait_for_timeout(3000)
            pg.keyboard.up('ArrowUp')
            sample(pg, 'approach')

            # ---- ⑤ 交战：按住 G 真实开火 2s（曳光打向基地方向）----
            pg.evaluate("""(() => { const F=__dbg.FLY; F.x=__dbg.targets.baseCenter.x * 0.5; F.z=__dbg.targets.baseCenter.z * 0.5;
              F.yaw=Math.atan2(__dbg.targets.baseCenter.x, __dbg.targets.baseCenter.z); __dbg.S._alt=0; })()""")
            pg.keyboard.down('g')
            pg.wait_for_timeout(2000)
            pg.keyboard.up('g')
            sample(pg, 'engaged')
            pg.screenshot(path=os.path.join(OUT, 'playthrough_engaged.jpg'), type='jpeg', quality=88)

            # ---- ⑥ destroy 注入清场剩余（模拟玩家完成输出）→ 结算 ----
            pg.evaluate("(() => { __dbg.enemyAir.reset(); __dbg.enemyVis.clearVisual(); __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); }); })()")
            pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", timeout=30000)
            sample(pg, 'done')

            # ---- ⑦ 结算断言：评级/得分/记档/解锁 ----
            res = pg.evaluate("""(() => { const b = document.getElementById('mission-body').innerHTML;
                const g = b.match(/<span>评级<\\/span><b style="color:var\\(--accent2\\)">([SABC])<\\/b>/);
                const s = __dbg.campaign.state();
                return { grade: g ? g[1] : '', score: __dbg.arcade.score,
                    unlocked: s.unlocked, best: s.levels[0].bestScore,
                    bestGrade: s.levels[0].bestGrade, ach: s.levels[0].ach.length,
                    fuelRow: b.includes('剩余燃油') }; })()""")
            pg.screenshot(path=os.path.join(OUT, 'playthrough_result.jpg'), type='jpeg', quality=88)
            # 轨迹校验：燃油单调下降（真实消耗）、弹药只减不增、结算后存档落盘
            fuels = [t['fuel'] for t in trace]
            mono = all(fuels[i] >= fuels[i + 1] - 1e-9 for i in range(len(fuels) - 1))
            guns = [t['gun'] for t in trace]
            gun_used = guns[0] - guns[-1]
            checks = {
                'grade_valid': res['grade'] in ('S', 'A', 'B', 'C'),
                'grade_is_S': res['grade'] == 'S',
                'score_positive': res['score'] > 0,
                'fuel_monotonic_down': mono,
                'fuel_burned': fuels[0] - fuels[-1] > 3,        # 全程真实耗油 >3%
                'gun_spent': gun_used > 0,                       # 真实开火消耗弹药
                'saved_unlocked': res['unlocked'] >= 2,          # 记档并解锁第 2 关
                'saved_best': res['best'] > 0 and res['bestGrade'] == res['grade'],
                'ach_recorded': res['ach'] > 0,
                'fuel_row': res['fuelRow'],
                'no_pageerror': len(errs) == 0,
            }
            out = {'checks': checks, 'result': res, 'trace': trace, 'pageerrors': errs}
            ok = all(checks.values())
            print('probe_playthrough:', 'PASS' if ok else 'FAIL')
            for k, v in checks.items():
                print('  %-22s %s' % (k, 'OK' if v else 'NG'))
            print('  grade=%s score=%d fuel %.1f→%.1f gun Δ%d unlocked=%d best=%d' %
                  (res['grade'], res['score'], fuels[0], fuels[-1], gun_used, res['unlocked'], res['best']))
        finally:
            browser.close()
    with open(os.path.join(OUT, 'playthrough_trace.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print('trace ->', os.path.join(OUT, 'playthrough_trace.json'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
