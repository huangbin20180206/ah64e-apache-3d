# -*- coding: utf-8 -*-
# P5-A 视觉与动画连续性行为测试：
# A) FLY.pitch 起降全程连续（真实 T 键起降链采样，相邻步 |Δpitch| 有界——旧硬切换一步跳 0.14）
# D) 非 pad 场地雾色×环境预设协调（9 组合页面同色彩空间复算全等）+ 密度恒场地值 + fogBase 防漂移
#    + desert duneFar 色随预设 + 双切换路径一致 + pad 既有行为不变
# C) 机体 envMapIntensity 随预设（公式复算全等）+ 重复切换不累积 + 涂装共存
import sys, os, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

errors = []
from playwright.sync_api import sync_playwright

def _watchdog():
    H._write_result('FAIL', 'visual-continuity watchdog timeout (360s)', skipped=True)
    print('RESULT FAIL reason=visual-continuity watchdog timeout', flush=True)
    os._exit(3)
_wd = threading.Timer(360, _watchdog)
_wd.start()

TERRAIN_FOG = {'grass': [0x9db7a0, 0.0050], 'desert': [0xd8c4a0, 0.0034], 'water': [0x8fb2bc, 0.0060]}
PRESET_FOG = {'day': 0xa9bfd2, 'dusk': 0xc07a4c, 'night': 0x0a141f}
HEMI = {'day': 0.55, 'dusk': 0.32, 'night': 0.12, 'studio': 0.85}
def exp_envI(env):
    return max(0.15, min(1.0, 0.12 + HEMI[env] * 1.6))   # P5-B(C)：dusk 0.632 / night 0.312

# 页面内同色彩空间复算（借 THREE.Color 实例 clone，避免 Python 端色彩空间偏差）
# P5-B(A)：雾环境混合权重 0.35→0.6 同步
JS_FOG_EXP = """(a2) => { const c = __dbg.W.scene.fog.color;
  const a = c.clone().setHex(a2[0]), b = c.clone().setHex(a2[1]);
  return a.lerp(b, 0.6).getHex(); }"""
# P5-B(B)：duneFar 色基=沙漠 farTint×环境明度×0.78（不再用停机坪 padTint×0.78）
JS_DUNE_EXP = """(hemi) => { const c = __dbg.W.duneFar.material.color;
  const dim = Math.min(1.0, Math.max(0.2, 0.35 + hemi * 1.2));
  return +c.clone().setHex(0xcbb287).multiplyScalar(dim * 0.78).r.toFixed(4); }"""

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rescue && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(400)

    # ---------- A：真实起降链 pitch 连续性 ----------
    # 起飞（running+spin 就绪后按 T）；游戏时间锚定等状态翻转（dt 钳制下不用固定墙钟）
    pg.evaluate("__dbg.S.running = true; __dbg.S.spin = 1")
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('KeyT')
    pg.wait_for_function("() => __dbg.FLY.state === 'hover'", timeout=30000)
    s_up = []
    for _ in range(40):   # 4s 采样悬停前段（含 up→hover 边界已过，但保留悬停连续性）
        s_up.append(pg.evaluate("({st: __dbg.FLY.state, p: +__dbg.FLY.pitch.toFixed(4)})"))
        pg.wait_for_timeout(100)
    # 降落（再按 T）→ ground
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('KeyT')
    pg.wait_for_function("() => __dbg.FLY.state === 'ground'", timeout=40000)
    s_dn = []
    for _ in range(40):   # 4s 采样触地后收敛段
        s_dn.append(pg.evaluate("({st: __dbg.FLY.state, p: +__dbg.FLY.pitch.toFixed(4)})"))
        pg.wait_for_timeout(100)
    # 连续性：相邻 100ms 采样步 |Δpitch| ≤ 0.045（平滑收敛首步上限 ≈0.14×2.2×0.1≈0.031；
    # 旧硬切换一步跳 ~0.11-0.14，判据分离清晰）
    for name, smp in (('up->hover', s_up), ('down->ground', s_dn)):
        jumps = [(i, round(abs(smp[i]['p'] - smp[i-1]['p']), 4)) for i in range(1, len(smp))
                 if abs(smp[i]['p'] - smp[i-1]['p']) > 0.045]
        assert not jumps, ('A: pitch discontinuity in %s' % name, jumps[:5])
    print('A: pitch continuous through takeoff/landing (samples=%d+%d, no jump>0.045)' % (len(s_up), len(s_dn)))
    # 触地收敛最终值 == GROUND_PITCH（等 2.5s 后 <0.005）+ comp 派生关系
    # B6+：等 pitch 真正收敛到 GROUND_PITCH（FLY.pitch 由 46-fpview.js:350 updater /
    # 70-app loop 每帧写），替代固定睡 2500ms（分类器真候选 L68→L70/L71）
    pg.wait_for_function("() => Math.abs(__dbg.FLY.pitch - (-0.1107)) < 0.005", timeout=20000)
    fin = pg.evaluate("({p: +__dbg.FLY.pitch.toFixed(4), comp: +__dbg.FLY.comp.toFixed(4)})")
    assert abs(fin['p'] - (-0.1107)) < 0.005, ('A: ground pitch not converged', fin)
    assert abs(fin['comp'] - (-0.2444)) < 0.005, ('A: comp should reach GROUND_PITCH_COMP', fin)
    # comp 逐点关系（收敛途中）：多步采样复核 comp == pitch/GROUND_PITCH*COMP
    rel = pg.evaluate("(() => { let ok = true; for (let i = 0; i < 30; i++) { __dbg.flyUpdate(0.05);"
                      " const e = Math.abs(__dbg.FLY.comp - (__dbg.FLY.pitch / -0.1107) * -0.2444);"
                      " if (e > 0.002) { ok = false; break; } } return ok; })()")
    assert rel, 'A: comp no longer derived from pitch'
    print('A: ground converged to GROUND_PITCH; comp==pitch-derived relation OK')

    # ---------- D：三场地 × 三预设 fog 协调 ----------
    for terr in ['grass', 'desert', 'water']:
        pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"%s\\\"]').click()" % terr)
        pg.wait_for_timeout(300)
        for env in ['day', 'dusk', 'night']:
            pg.evaluate("document.querySelector('#env-row [data-env=\\\"%s\\\"]').click()" % env)
            pg.wait_for_timeout(350)
            expC = pg.evaluate(JS_FOG_EXP, [TERRAIN_FOG[terr][0], PRESET_FOG[env]])
            st = pg.evaluate("(() => { const W = __dbg.W; return { fogC: W.scene.fog.color.getHex(),"
                             " fogD: +W.scene.fog.density.toFixed(5), baseC: W.fogBase.c, baseD: +W.fogBase.d.toFixed(5) }; })()")
            assert st['fogC'] == expC, ('D: fog color mismatch', terr, env, st, hex(expC))
            # 密度真源是 fogBase.d（brownout 在 scene.fog.density 上合法叠加——
            # 本测试 A 段真实起降后引擎仍在转，沙漠停放下洗会让 fogD > baseD）
            assert abs(st['baseD'] - TERRAIN_FOG[terr][1]) < 1e-6, ('D: terrain fog density changed', terr, st)
            assert st['fogD'] >= st['baseD'] - 1e-9, ('D: fogD below base is impossible', terr, st)
            assert st['baseC'] == st['fogC'], ('D: fogBase drift', terr, env, st)
    print('D: fog color blended per preset on all 3 terrains; density preserved; fogBase synced (9 combos)')
    # desert duneFar 随预设（day vs night r 分量显著不同 + 页面复算全等）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"desert\\\"]').click()")
    pg.wait_for_timeout(300)
    dunes = {}
    for env in ['day', 'night']:
        pg.evaluate("document.querySelector('#env-row [data-env=\\\"%s\\\"]').click()" % env)
        pg.wait_for_timeout(350)
        expR = pg.evaluate(JS_DUNE_EXP, HEMI[env])
        d = pg.evaluate("(() => ({ r: +__dbg.W.duneFar.material.color.r.toFixed(4), vis: __dbg.W.duneFar.visible }))()")
        dunes[env] = d
        assert abs(d['r'] - expR) < 0.005, ('D: dune color mismatch', env, d, expR)
        assert d['vis'], ('D: duneFar invisible on desert', env)
    assert abs(dunes['day']['r'] - dunes['night']['r']) > 0.15, ('D: dune day/night identical', dunes)
    # 双切换路径一致：night 下经 grass 切回 desert（setTerrain 路径）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"grass\\\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"desert\\\"]').click()")
    pg.wait_for_timeout(400)
    expC = pg.evaluate(JS_FOG_EXP, [TERRAIN_FOG['desert'][0], PRESET_FOG['night']])
    st2 = pg.evaluate("(() => { const W = __dbg.W; return { fogC: W.scene.fog.color.getHex(),"
                      " baseD: +W.fogBase.d.toFixed(5), duneR: +W.duneFar.material.color.r.toFixed(4) }; })()")
    expR = pg.evaluate(JS_DUNE_EXP, HEMI['night'])
    assert st2['fogC'] == expC and abs(st2['baseD'] - TERRAIN_FOG['desert'][1]) < 1e-6, ('D: setTerrain path mismatch', st2)
    assert abs(st2['duneR'] - expR) < 0.005, ('D: dune tint lost via terrain switch', st2, expR)
    # pad 既有行为不变：环境雾完全来自预设
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"pad\\\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#env-row [data-env=\\\"night\\\"]').click()")
    pg.wait_for_timeout(350)
    stp = pg.evaluate("(() => ({ fogC: __dbg.W.scene.fog.color.getHex(), baseD: +__dbg.W.fogBase.d.toFixed(5) }))()")
    assert stp['fogC'] == 0x0a141f and abs(stp['baseD'] - 0.0090) < 1e-6, ('D: pad env fog changed', stp)
    print('D: duneFar follows presets; both switch paths consistent; pad behavior unchanged')

    # ---------- C：机体 envMapIntensity 随预设 ----------
    for env in ['day', 'dusk', 'night', 'studio']:
        pg.evaluate("document.querySelector('#env-row [data-env=\\\"%s\\\"]').click()" % env)
        pg.wait_for_timeout(350)
        st = pg.evaluate("(() => { const g = (n) => { const l = __dbg.apache.mats.get(n);"
                         " return l ? +l[0].envMapIntensity.toFixed(4) : null; };"
                         " return { body: g('USMC_LowVis_Body'), metal: g('USMC_LowVis_Metal') }; })()")
        ev = round(exp_envI(env), 4)
        assert abs(st['body'] - ev) < 1e-6 and abs(st['metal'] - ev) < 1e-6, ('C: envI mismatch', env, st, ev)
    print('C: body envMapIntensity follows preset hemi (day 1.0 / dusk 0.632 / night 0.312 / studio 1.0)')
    # 重复切换不累积
    for env in ['night', 'day', 'night', 'day']:
        pg.evaluate("document.querySelector('#env-row [data-env=\\\"%s\\\"]').click()" % env)
        pg.wait_for_timeout(300)
    s3 = pg.evaluate("+__dbg.apache.mats.get('USMC_LowVis_Body')[0].envMapIntensity.toFixed(6)")
    assert abs(s3 - 1.0) < 1e-6, ('C: accumulated drift', s3)
    # 涂装共存：army 后 night 联动生效且涂装色不被改
    pg.evaluate("document.querySelector('#scheme-row [data-scheme=\\\"army\\\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#env-row [data-env=\\\"night\\\"]').click()")
    pg.wait_for_timeout(350)
    s4 = pg.evaluate("(() => { const l = __dbg.apache.mats.get('USMC_LowVis_Body');"
                     " return { envI: +l[0].envMapIntensity.toFixed(4), r: +l[0].color.r.toFixed(3) }; })()")
    assert abs(s4['envI'] - exp_envI('night')) < 1e-6, ('C: army scheme breaks envI', s4)
    assert abs(s4['r'] - 0.300) < 0.01, ('C: army color altered', s4)
    pg.evaluate("document.querySelector('#scheme-row [data-scheme=\\\"lowvis\\\"]').click()")
    pg.wait_for_timeout(300)
    print('C: no accumulation over repeated switches; coexists with army scheme')

    pg.screenshot(path=H.output_path('shot_visual_continuity.jpg'), type='jpeg', quality=88)
    print('visual-continuity OK: A pitch continuity / D fog+dune coordination / C envIntensity linkage all pass')

import pw_harness as H2
# 本测试走 pw_harness 护具（看门狗已在上方自建；guarded_main 提供服务管理与结果落盘）
_wd.cancel()
H2.guarded_main(run, hard_timeout=360)
print('PASS')