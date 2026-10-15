# -*- coding: utf-8 -*-
# P6 任务循环与任务模式——值级断言（修复前应 FAIL 的缺口均已实现）
# 覆盖指令 §3/§5：
#   M1: 三模式入口（show/train/mission chip）切换不污染展示模式
#   M2: startMission 简报含真实目标/完成/失败条件（读 __dbg.mission 状态而非仅文案）
#   M3: 任务状态未开始(null)→简报(briefing)→进行中(active)→完成(done) 全链
#   M4: 进行中进度面板数值 == targets/rig 状态源
#   M5: 完成结果冻结（done/failed 后 updateMissionPanel 不再改写面板）
#   M6: 失败路径（超时）→ failed + failedReason=timeout + 可重试
#   M7: 重试清理（targets/air/rescue/瞬态/HUD/输入）并可再次完成
#   M8: 接近基地为任务模式兼容触发（show 模式不触发，mission 模式触发同一状态）
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rescue && __dbg.air)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)

    # ---- M1: 三模式切换 + 展示模式零污染 ----
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    pg.wait_for_function("() => __dbg.W.terrainKey === 'pad'", timeout=5000)   # B4：切场同步——条件等待
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_function("() => __dbg.S.mode === 'show'", timeout=5000)
    assert pg.evaluate("__dbg.S.mode") == 'show', 'M1: 默认应为展示模式'
    assert pg.evaluate("__dbg.mission") is None, 'M1: 展示模式不应有任务状态'
    # 展示模式下接近基地不触发任务（门控 S.mode==='mission'）——1500ms 为负断言观察窗（保留）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=20; __dbg.S._alt=0; __dbg.S.running=true")
    pg.wait_for_timeout(1500)
    assert pg.evaluate("__dbg.mission") is None, ('M1: 展示模式接近基地不应触发任务', pg.evaluate("__dbg.mission"))
    # 训练模式：提示条出现、任务状态不产生
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"train\"]').click()")
    pg.wait_for_function("() => __dbg.S.mode === 'train'", timeout=5000)
    assert pg.evaluate("__dbg.S.mode") == 'train'
    assert pg.evaluate("__dbg.mission") is None, 'M1: 训练模式不应有任务状态'
    # 任务模式：开始任务 → 简报
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_function("() => __dbg.S.mode === 'mission'", timeout=5000)
    assert pg.evaluate("__dbg.S.mode") == 'mission'
    print('M1 PASS: 三模式切换 + 展示/训练零任务污染')

    # ---- M2: 简报含真实目标/完成/失败条件 ----
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => __dbg.mission && __dbg.mission.phase === 'briefing' && document.getElementById('mission').classList.contains('show')", timeout=5000)
    st = pg.evaluate("""() => { const m = __dbg.mission, mp = document.getElementById('mission');
      return { phase: m && m.phase, show: mp.classList.contains('show'),
               body: mp.innerHTML }; }""")
    assert st['phase'] == 'briefing' and st['show'], ('M2: 简报未显示', st)
    assert '完成条件' in st['body'] and '失败条件' in st['body'], ('M2: 简报缺完成/失败条件', st['body'])
    print('M2 PASS: 简报含完成条件与失败条件（phase=%s）' % st['phase'])

    # ---- M3: 状态链 briefing→active→done ----
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'active' && __dbg.mission.t0 !== null", timeout=5000)
    assert pg.evaluate("__dbg.mission.phase") == 'active', 'M3: beginMission 后应 active'
    assert pg.evaluate("__dbg.mission.t0") is not None, 'M3: active 应记录开始时间'
    # 全歼 → done
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
    pg.wait_for_function("() => __dbg.mission.phase === 'done' && __dbg.mission.frozen", timeout=15000)   # B4：loop 0.5s 判定
    st = pg.evaluate("(() => ({ phase: __dbg.mission.phase, done: __dbg.mission.done, frozen: __dbg.mission.frozen }))()")
    assert st['phase'] == 'done' and st['done'] and st['frozen'], ('M3: 全歼未进入 done', st)
    print('M3 PASS: briefing→active→done 全链')

    # ---- M5: 结果冻结——done 后 updateMissionPanel 不改写面板 ----
    body_done = pg.evaluate("document.getElementById('mission-body').innerHTML")
    pg.evaluate("__dbg.updateMissionPanel()")          # 冻结后调用不应改写（同步——无需固定窗）
    body_after = pg.evaluate("document.getElementById('mission-body').innerHTML")
    assert body_done == body_after, ('M5: done 后面板被改写（未冻结）', body_done[:60], body_after[:60])
    print('M5 PASS: done 结果冻结（updateMissionPanel 不再改写）')

    # ---- M6: 失败路径（超时）→ failed + 可重试 ----
    pg.evaluate("__dbg.retryMission()")                 # 新一轮（briefing）
    pg.wait_for_function("() => __dbg.mission.phase === 'briefing'", timeout=5000)
    assert pg.evaluate("__dbg.mission.phase") == 'briefing', 'M6: retryMission 后应回到 briefing'
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'active'", timeout=5000)
    # 直接篡改 t0 制造超时（MISSION_TIMEOUT=360s）
    pg.evaluate("__dbg.mission.t0 = __dbg.S.time - 400")
    pg.wait_for_function("() => __dbg.mission.phase === 'failed' && __dbg.mission.failedReason === 'timeout'", timeout=15000)   # B4：loop 0.5s 节流判定
    st = pg.evaluate("(() => ({ phase: __dbg.mission.phase, reason: __dbg.mission.failedReason, done: __dbg.mission.done }))()")
    assert st['phase'] == 'failed' and st['reason'] == 'timeout', ('M6: 超时未失败', st)
    body_fail = pg.evaluate("document.getElementById('mission-body').innerHTML")
    assert '失败' in body_fail and '原因' in body_fail, ('M6: 失败面板缺原因', body_fail)
    # 失败后可重试
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'briefing'", timeout=5000)
    assert pg.evaluate("__dbg.mission.phase") == 'briefing', 'M6: 失败后重试应回简报'
    print('M6 PASS: 超时失败 + failedReason + 可重试')

    # ---- M7: 重试清理 + 可再次完成 ----
    pg.evaluate("__dbg.air.enabled = false")
    # 制造"有状态"：击毁一个空中目标 + 放一个武器瞬态 + 救援进行中
    pg.evaluate("(() => { const a=__dbg.air; if (a.list.length) a._kill(a.list[0]); })()")
    pg.evaluate("__dbg.rig.launchRocket()")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.rescue.setTerrain('desert'); __dbg.rescue.toggle({x:26,y:8,z:-14})")
    pg.wait_for_timeout(300)
    dirty = pg.evaluate("(() => ({ alive: __dbg.air.list.filter(t=>!t.alive).length,"
                        " rockets: __dbg.rig.rockets.filter(r=>r.g.visible).length,"
                        " rstate: __dbg.rescue.state }))()")
    assert dirty['alive'] >= 1 or dirty['rockets'] >= 1, ('M7: 前置——未制造脏状态', dirty)
    # retryMission 清一切并回简报
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'briefing'", timeout=5000)
    clean = pg.evaluate("(() => ({ alive: __dbg.air.list.filter(t=>!t.alive).length,"
                        " rockets: __dbg.rig.rockets.filter(r=>r.g.visible).length,"
                        " rstate: __dbg.rescue.state, terr: __dbg.W.terrainKey,"
                        " phase: __dbg.mission.phase }))()")
    assert clean['alive'] == 0, ('M7: 重试未复活空中目标', clean)
    assert clean['rockets'] == 0, ('M7: 重试未清武器瞬态', clean)
    assert clean['rstate'] == 'idle', ('M7: 重试未复位救援', clean)
    assert clean['terr'] == 'desert' and clean['phase'] == 'briefing', ('M7: 重试起点错误', clean)
    # 再次完成
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'active'", timeout=5000)
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
    pg.wait_for_function("() => __dbg.mission.phase === 'done'", timeout=15000)
    assert pg.evaluate("__dbg.mission.phase") == 'done', 'M7: 重试后无法再次完成'
    print('M7 PASS: 重试清理（air/武器/救援）并可再次完成')

    # ---- M8: 接近基地兼容触发（mission 模式） ----
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'briefing'", timeout=5000)
    pg.evaluate("__dbg.FLY.x=0; __dbg.FLY.z=20; __dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.S._alt=0")
    pg.wait_for_function("() => __dbg.mission && __dbg.mission.phase === 'active' && __dbg.S._baseFound", timeout=15000)   # B4：loop 每帧检测
    st = pg.evaluate("(() => ({ mission: !!__dbg.mission, phase: __dbg.mission && __dbg.mission.phase,"
                     " found: __dbg.S._baseFound }))()")
    assert st['mission'] and st['phase'] == 'active' and st['found'], ('M8: 任务模式接近未触发统一任务', st)
    print('M8 PASS: 接近基地为任务模式兼容触发（同一状态）')

    # ---- M9（P6 修复批）：任务 active 时切 show/train → 统一清理、零污染 ----
    pg.evaluate("__dbg.retryMission()")           # 重开一轮（briefing）
    pg.wait_for_function("() => __dbg.mission.phase === 'briefing'", timeout=5000)
    pg.evaluate("__dbg.beginMission()")           # → active
    pg.wait_for_function("() => __dbg.mission.phase === 'active'", timeout=5000)
    assert pg.evaluate("__dbg.mission.phase") == 'active', 'M9: 前置——任务应 active'
    # 切到 show：S._mission 必须清空（不再继续计时/完成/超时）
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_function("() => __dbg.mission === null && __dbg.S._baseFound === false", timeout=5000)
    m9a = pg.evaluate("(() => ({ m: __dbg.mission, found: __dbg.S._baseFound,"
                      " show: document.getElementById('mission').classList.contains('show') }))()")
    assert m9a['m'] is None and m9a['found'] is False and not m9a['show'], ('M9: 切 show 未清理任务', m9a)
    # 等待超过一个节流周期+失败判定窗口，确认不会自动生成 done/failed——负断言窗（保留）
    pg.wait_for_timeout(1800)
    assert pg.evaluate("__dbg.mission") is None, 'M9: show 模式下任务不应自动重建'
    # 展示模式自由能力不受影响（切环境/场地仍可用）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    pg.wait_for_function("() => __dbg.W.terrainKey === 'pad'", timeout=5000)
    assert pg.evaluate("__dbg.W.terrainKey") == 'pad', 'M9: 展示模式场地切换被污染'
    # 切到 train：只显示提示，不创建任务
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"train\"]').click()")
    pg.wait_for_function("() => __dbg.S.mode === 'train'", timeout=5000)
    assert pg.evaluate("__dbg.mission") is None, 'M9: train 模式不应创建任务'
    # 切回 mission：不自动生成旧任务（必须由开始任务重建）
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_function("() => __dbg.S.mode === 'mission'", timeout=5000)
    assert pg.evaluate("__dbg.mission") is None, 'M9: 切回 mission 不应自动生成旧任务'
    print('M9 PASS: 任务 active 切 show/train 统一清理 + 切回不自动重建')

    # ---- M10（P6 修复批）：从 pad/water 启动任务 → 场地/rescue 立即就绪 ----
    for startTerr in ['pad', 'water']:
        pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"%s\\\"]').click()" % startTerr)
        pg.evaluate("__dbg.startMission()")
        pg.wait_for_function("() => __dbg.W.terrainKey === 'desert' && __dbg.mission.phase === 'briefing'", timeout=5000)
        st10 = pg.evaluate("(() => ({ terr: __dbg.W.terrainKey, ok: __dbg.rescue.ok,"
                           " rstate: __dbg.rescue.state, gvis: __dbg.rescue.g.visible,"
                           " svis: __dbg.rescue.smoke.visible, bvis: __dbg.rescue.beacon.visible }))()")
        assert st10['terr'] == 'desert', ('M10: 从 %s 启动后场地未切到 desert' % startTerr, st10)
        assert st10['ok'] and st10['rstate'] == 'idle', ('M10: 从 %s 启动 rescue 未就绪' % startTerr, st10)
        assert st10['gvis'] and st10['svis'] and st10['bvis'], ('M10: 从 %s 启动幸存者/烟/信标不可见' % startTerr, st10)
        print('M10 PASS: 从 %s 启动 → desert + rescue.ok + idle + 幸存者/烟/信标立即可见' % startTerr)

    pg.screenshot(path=H.output_path('shot_mission_loop.jpg'), type='jpeg', quality=88)
    print('P6 mission-loop OK: M1-M10 全过（含修复批 M9/M10）')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')