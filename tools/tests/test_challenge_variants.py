# -*- coding: utf-8 -*-
# Phase 11 C1-C3 任务挑战变体值级测试：
#   C1  简报面板 3 个变体 chip（radiogroup 语义 + 默认标准）；选变体即标记
#       S._mission.variant 并刷新简报文案；受限弹药弹药即时减半、切回恢复满弹
#   C2  限时救援完成条件 = 全歼 + rescue delivered（全歼未救援不结算且面板提示）；
#       变体时限（限时 240s）；受限弹药超时失败
#   C3  结算面板显示变体名称 + 变体特有数据；重试保留同一变体；评级复用 missionRating
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rescue && __dbg.rig)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S._guide = 0")
    H.step(pg, 0.4)

    # ---- C1：进 mission + 开始任务 → 简报 3 变体 chip ----
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    H.step(pg, 0.3)
    pg.evaluate("__dbg.startMission()")                 # 默认标准
    # B6+：等简报真正渲染完再断言，而非固定睡 400ms——#mission-body 由 loop-reachable
    # 路径写（70-app.js:1049/1068），负载下固定睡会读到旧面板（分类器真候选 L24→L30）
    H.step_until(pg, """() => document.querySelectorAll('#mission-variants .chip').length === 7
        && document.getElementById('mission-body').innerHTML.indexOf('完成条件') >= 0""", 15)
    chips = pg.evaluate("() => [...document.querySelectorAll('#mission-variants .chip')].map(c => ({k:c.dataset.variant, on:c.classList.contains('on'), role:c.getAttribute('role'), checked:c.getAttribute('aria-checked')}))")
    assert len(chips) == 7, ('C1: 简报应有 7 个变体 chip（Phase 24 增 sead_strike；C005 增 air_superiority；玩法批 C 增 urban_strike；玩法批 D 增 canyon_run）', chips)
    assert chips[0]['k'] == 'standard' and chips[0]['on'] and chips[0]['checked'] == 'true', ('C1: 默认选中标准', chips)
    assert chips[0]['role'] == 'radio', ('C1: 变体 chip 应 role=radio', chips)
    b0 = pg.evaluate("document.getElementById('mission-body').innerHTML")
    assert '标准任务' in b0 and '完成条件' in b0 and '失败条件' in b0, ('C1: 标准简报文案', b0)
    pe = pg.evaluate("getComputedStyle(document.getElementById('mission')).pointerEvents")
    assert pe == 'auto', ('C1: 简报阶段应可交互（变体选择；其余阶段保持 none）', pe)

    # ---- C1：选限时救援 → variant + 文案变化 ----
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"timed_rescue\"]').click()")
    H.step_until(pg, """() => __dbg.mission.variant === 'timed_rescue'
        && document.getElementById('mission-body').innerHTML.indexOf('限时救援') >= 0""", 15)
    st = pg.evaluate("({variant:__dbg.mission.variant, body:document.getElementById('mission-body').innerHTML, on:document.querySelector('#mission-variants [data-variant=\"timed_rescue\"]').classList.contains('on')})")
    assert st['variant'] == 'timed_rescue', ('C1: 限时救援选中未生效', st)
    assert '救援' in st['body'] and '限时救援' in st['body'] and st['on'], ('C1: 限时救援简报文案/选中态', st)

    # ---- C1：受限弹药 → 弹药即时减半（机炮/火箭），地狱火不变 ----
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"limited_ammo\"]').click()")
    H.step(pg, 0.3)
    am = pg.evaluate("({gun:__dbg.rig.gunAmmo, rk:__dbg.rig.rocketAmmo, hf:__dbg.rig.hfAmmo, variant:__dbg.mission.variant})")
    assert am['variant'] == 'limited_ammo' and am['gun'] == 600 and am['rk'] == 19 and am['hf'] == 8, ('C2: 受限弹药未减半（1200/2=600, 38/2=19, hf 不变）', am)

    # ---- C1：切回标准 → 弹药恢复满（重试/切回不累积） ----
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"standard\"]').click()")
    H.step(pg, 0.3)
    am2 = pg.evaluate("({gun:__dbg.rig.gunAmmo, rk:__dbg.rig.rocketAmmo, variant:__dbg.mission.variant})")
    assert am2['gun'] == 1200 and am2['rk'] == 38, ('C1: 切回标准应恢复满弹', am2)

    # ---- C2/C3：限时救援完成链 ----
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"timed_rescue\"]').click()")
    H.step(pg, 0.2)
    pg.evaluate("__dbg.beginMission()")
    H.step(pg, 0.3)
    assert pg.evaluate("__dbg.mission.phase") == 'active', 'C2: beginMission 后应 active'
    # ① 全歼但未救援 → 不结算（等待救援），面板给出指引
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
    H.step_until(pg, "() => document.getElementById('mission-body').innerHTML.indexOf('还需完成救援') >= 0", 15)
    st1 = pg.evaluate("({phase:__dbg.mission.phase, done:__dbg.mission.done, body:document.getElementById('mission-body').innerHTML})")
    assert st1['phase'] == 'active' and not st1['done'], ('C2: 全歼未救援不应结算', st1)
    assert '还需完成救援' in st1['body'], ('C2: 未救援提示缺失', st1['body'])
    # ② 完成救援：K 放绞车进入 deploying（真实入口）→ 注入 delivered 终态
    #    （测试不依赖 10s 绞车动画；判定逻辑不变——delivered 是救援终态）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=8; __dbg.FLY.x=26; __dbg.FLY.z=-14; __dbg.S._alt=0")
    H.step(pg, 0.4)
    pg.keyboard.press('KeyK')
    H.step_until(pg, "() => __dbg.rescue.state === 'deploying'", 10)
    pg.evaluate("__dbg.rescue.state='delivered'; __dbg.rescue.g.visible=false; __dbg.rescue.smoke.visible=false; __dbg.rescue.beacon.visible=false")
    H.step_until(pg, "() => __dbg.mission.phase === 'done'", 15)
    st2 = pg.evaluate("({phase:__dbg.mission.phase, done:__dbg.mission.done, body:document.getElementById('mission-body').innerHTML})")
    assert st2['done'] and st2['phase'] == 'done', ('C2: 全歼+delivered 未完成', st2)
    assert '限时救援' in st2['body'] and '救援完成' in st2['body'] and '是' in st2['body'], ('C3: 结算缺变体名/救援完成数据', st2['body'])

    # ---- C3：重试保留同一变体 ----
    pg.evaluate("__dbg.retryMission()")
    H.step(pg, 0.3)
    assert pg.evaluate("__dbg.mission.phase") == 'briefing', 'C3: retryMission 后应 briefing'
    assert pg.evaluate("__dbg.mission.variant") == 'timed_rescue', ('C3: 重试应保留同一变体', pg.evaluate("__dbg.mission.variant"))

    # ---- C2/C3：受限弹药超时失败 + 结算含变体名 ----
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"limited_ammo\"]').click()")
    H.step(pg, 0.2)
    pg.evaluate("__dbg.beginMission()")
    H.step(pg, 0.3)
    # 有效时限 = 变体时限 × 难度系数（P18：limited_ammo 360×1.2=432）——读真源不硬编码：
    # Phase 18 前本测试按旧 360s 基础时限篡改 "S.time-400"，够不着 432s 有效时限，
    # 超时失败永不触发（step_until 15 游戏秒内 elapsed 仅到 415<432，实测 TimeoutError）。
    to = pg.evaluate("__dbg.missionTimeout()")
    assert to > 0, ('C2: missionTimeout 真源读口异常', to)
    pg.evaluate("__dbg.mission.t0 = __dbg.S.time - (%s + 5)" % to)     # > 有效时限 → 超时失败
    H.step_until(pg, "() => __dbg.mission.phase === 'failed'", 15)
    st3 = pg.evaluate("({phase:__dbg.mission.phase, reason:__dbg.mission.failedReason, body:document.getElementById('mission-body').innerHTML})")
    assert st3['phase'] == 'failed' and st3['reason'] == 'timeout', ('C2: 受限弹药超时未失败', st3)
    assert '受限弹药' in st3['body'] and '失败' in st3['body'], ('C3: 失败结算缺变体名', st3['body'])

    # ---- C4 (Phase 24)：SEAD 变体「压制防空」完成链——地面全歼 + 雷达/防空车摧毁 ----
    # 切沙漠确保 narrative 打击层启用（radar/sam 可摧毁）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    H.step_until(pg, "() => __dbg.targets.enabled && __dbg.narrative.state().enabled && __dbg.narrative.state().radarAlive", 8)
    pg.evaluate("__dbg.retryMission()")
    H.step(pg, 0.2)
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"sead_strike\"]').click()")
    H.step_until(pg, "() => __dbg.mission.variant === 'sead_strike'", 8)
    pg.evaluate("__dbg.beginMission()")
    H.step_until(pg, "() => __dbg.mission.phase === 'active'", 8)
    # ① 地面全歼但雷达/防空车未毁 → 不结算，面板给 SEAD 指引
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
    H.step_until(pg, "() => document.getElementById('mission-body').innerHTML.indexOf('完成 SEAD') >= 0", 15)
    s4a = pg.evaluate("({phase:__dbg.mission.phase, done:__dbg.mission.done})")
    assert s4a['phase'] == 'active' and not s4a['done'], ('C4: 地面全歼但雷达/防空车未毁不应结算', s4a)
    # ② 摧毁雷达(hp2)+防空车(hp3) → SEAD 达成 → 结算，结算面板含变体名
    pg.evaluate("""(() => {
        __dbg.narrative.hitTest({ x: -16, y: 0.8, z: 79 }, 3);   // 雷达
        __dbg.narrative.hitTest({ x: 12, y: 0.8, z: 69 }, 3);    // 防空车
    })()""")
    H.step_until(pg, "() => __dbg.mission.phase === 'done'", 15)
    s4b = pg.evaluate("({phase:__dbg.mission.phase, done:__dbg.mission.done, body:document.getElementById('mission-body').innerHTML})")
    assert s4b['done'] and s4b['phase'] == 'done', ('C4: 地面全歼+SEAD 达成应结算', s4b)
    assert '压制防空' in s4b['body'], ('C4: 结算应含变体名 压制防空', s4b['body'])
    print('C4 PASS: SEAD 变体完成链（地面全歼 + 雷达/防空车摧毁）')

    print('challenge-variants OK: 5 变体简报/弹药/判定/结算/重试保留 + SEAD 完成链')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')
