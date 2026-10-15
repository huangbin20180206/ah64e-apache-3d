# Phase 0 验收证据生成器（本身也是回归测试，已入 test-manifest.json）：
#   01-fpv-mouse-input.png      FPV mouse(dx) 单次累加的驾驶舱现场
#   02-mission-reset-repeat.png 任务重置后第二次简报重新触发现场
#   03-rescue-terrain-switch.png 绞车部署中跨地形切换→取消→重新部署现场
# 输出目录：PHASE0_EVIDENCE_DIR（默认 docs/ai-reviews/phase-0-baseline/evidence/），
# 同时复制一份到 APACHE_TEST_OUT（CI 工件用）。截图在断言通过后落盘。
import os, shutil
import pw_harness as H

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/tests -> 仓库根
_EVID = os.environ.get('PHASE0_EVIDENCE_DIR') or os.path.join(
    _REPO, 'docs', 'ai-reviews', 'phase-0-baseline', 'evidence')

def _snap(pg, name):
    os.makedirs(_EVID, exist_ok=True)
    p = os.path.join(_EVID, name)
    pg.screenshot(path=p, type='png')
    out = H.OUTPUT_DIR
    if os.path.abspath(out) != os.path.abspath(_EVID):
        try:
            os.makedirs(out, exist_ok=True)
            shutil.copyfile(p, os.path.join(out, name))
        except Exception:
            pass
    print('evidence saved:', p)

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp && __dbg.rescue && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S.mode = 'mission'")   # P6：任务测试声明处于任务模式（接近触发是任务模式兼容路径）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1500)

    # ---- 01 FPV mouse 单次累加（悬停于基地附近，沙尘/靶场环境入镜） ----
    # （2026-10-15 P4f：基地 z 42→75，接近点同步 20→53 保持 22u）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=53; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.keyboard.press('KeyC')
    pg.wait_for_function("() => __dbg.fp.active === true", timeout=5000)   # B2：enter 同步置位，条件等待免固定窗
    y0 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    pg.evaluate("__dbg.fp.mouse(10, 0)")
    y1 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    assert abs((y0 - y1) - 0.040) < 0.001, ('fpv mouse single delta', y0, y1)
    print('01 fpv mouse: vYaw %.5f -> %.5f (delta 0.040, single application)' % (y0, y1))
    _snap(pg, '01-fpv-mouse-input.png')
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(600)

    # ---- 02 任务重置后再次触发（UI 按钮路径，第二次简报面板入镜） ----
    # B2：接近触发是 loop 每帧检测——条件等待取代固定 1200ms
    pg.wait_for_function("() => __dbg.S._mission && document.getElementById('mission').classList.contains('show')", timeout=15000)
    st1 = pg.evaluate("({m:__dbg.S._mission, t0:__dbg.S._mission && __dbg.S._mission.t0, "
                      "show:document.getElementById('mission').classList.contains('show')})")
    assert st1['m'] and st1['show'], ('first briefing missing', st1)
    print('02 briefing #1 shown (t0=%.2f)' % st1['t0'])
    pg.evaluate("__dbg.FLY.z = -20")
    pg.wait_for_timeout(400)
    pg.evaluate("document.getElementById('btn-reset-targets').click()")
    pg.wait_for_timeout(800)
    r = pg.evaluate("({m:__dbg.S._mission, f:__dbg.S._baseFound, "
                    "show:document.getElementById('mission').classList.contains('show')})")
    assert r['m'] is None and r['f'] is False and not r['show'], ('ui reset failed', r)
    print('02 ui reset OK: mission=null, _baseFound=false')
    # （2026-10-15 P4f：再次接近点随基地 20→53）
    pg.evaluate("__dbg.FLY.z = 53")
    pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.t0 > %s && document.getElementById('mission').classList.contains('show')" % st1['t0'], timeout=15000)
    st2 = pg.evaluate("({m:__dbg.S._mission, t0:__dbg.S._mission && __dbg.S._mission.t0, "
                      "show:document.getElementById('mission').classList.contains('show')})")
    assert st2['m'] and st2['show'] and st2['t0'] > st1['t0'], ('briefing not re-triggered', st2)
    print('02 briefing #2 re-triggered (t0 %.2f -> %.2f)' % (st1['t0'], st2['t0']))
    _snap(pg, '02-mission-reset-repeat.png')
    # 收尾：飞离并重置，避免影响后续测试环境
    pg.evaluate("__dbg.FLY.z = -20")
    pg.wait_for_timeout(400)
    pg.keyboard.press('KeyB')
    pg.wait_for_timeout(600)

    # ---- 03 救援跨地形：部署中切换→取消→草原重新部署（绳/钩/幸存者同框） ----
    # FLY.fp=true 让位高度控制（环绕悬停每帧把 alt 钉回 HOVER=14，不让位则
    # alt=8 无效——与 navlights/sink 测试同款手法）
    pg.evaluate("__dbg.FLY.fp=true; __dbg.FLY.state='hover'; __dbg.FLY.pitch=0; "
                "__dbg.FLY.alt=8; __dbg.FLY.x=26; __dbg.FLY.z=-14; __dbg.S._alt=0")
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => ['deploying','holding'].includes(__dbg.rescue.state)", timeout=15000)   # 绳放收敛取代固定 700ms
    assert pg.evaluate("__dbg.rescue.state") in ('deploying', 'holding'), 'winch not deployed on desert'
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"grass\"]').click()")
    pg.wait_for_timeout(1200)
    c = pg.evaluate("({state:__dbg.rescue.state, rope:__dbg.rescue.rope.visible, gvis:__dbg.rescue.g.visible})")
    assert c['state'] == 'idle' and not c['rope'] and c['gvis'], ('mid-deploy switch did not cancel cleanly', c)
    print('03 mid-deploy switch to grass: cancelled + respawned')
    # 草原幸存者 (22,-10)：悬停偏移 6u（holding——不触发挂接）→ 取景
    pg.evaluate("__dbg.FLY.x=28; __dbg.FLY.z=-10")
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => ['holding','deploying'].includes(__dbg.rescue.state) && __dbg.rescue.rope.visible", timeout=15000)   # 绳放动画收敛
    h = pg.evaluate("({state:__dbg.rescue.state, rope:__dbg.rescue.rope.visible})")
    assert h['state'] in ('holding', 'deploying') and h['rope'], ('re-deploy failed', h)
    pg.evaluate("__dbg.orbit.tTarget.set(25, 1.2, -10); __dbg.orbit.tPhi=1.12; __dbg.orbit.tDist=12")
    pg.wait_for_timeout(1100)
    print('03 re-deploy on grass, state=%s (rope+hook+survivor in frame)' % h['state'])
    _snap(pg, '03-rescue-terrain-switch.png')
    # 收尾：收回绞车 + 复位飞行状态机（收回动画收敛——条件等待）
    pg.keyboard.press('KeyK')
    pg.wait_for_function("() => __dbg.rescue.state === 'idle'", timeout=15000)
    pg.evaluate("__dbg.FLY.fp=false; __dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.FLY.pitch=0; "
                "__dbg.FLY.comp=0; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.S._alt=0")

import pw_harness as H
H.guarded_main(run, hard_timeout=240)
print('PASS')
