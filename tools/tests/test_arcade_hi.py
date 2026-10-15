# Phase 18 轻街机层：A7 最高分写/读 + fresh reload 二次载入（独立上下文）
# 流程：veteran 打完一局结算 → 本地 hi_veteran 落盘 = 本局总分 →
#       pg.reload() 进全新 JS 上下文 → arcade 二次载入应从存储读回最高分。
# 其余门禁见 test_arcade.py（A1-A5/A9/A10）/ test_arcade_settle.py（A6）/ test_arcade_privacy.py（A8）。

def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.arcade)", timeout=60000)

    # 打完一局 veteran（全歼 → 结算写 hi_veteran）
    pg.evaluate("""(() => {
        __dbg.setMissionDifficulty('veteran');
        __dbg.startMission('standard');
        const m = __dbg.S._mission; m.phase = 'active'; m.t0 = __dbg.S.time;
        const rig = __dbg.rig;
        m.gun0 = rig ? rig.gunAmmo : 0; m.rk0 = rig ? rig.rocketAmmo : 0; m.hf0 = rig ? rig.hfAmmo : 0;
        __dbg.beginMission();
        __dbg.air.enabled = false;
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });
    })()""")
    pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", timeout=30000)

    a7 = pg.evaluate("""(() => {
        const st = __dbg.arcade.state();
        return { score: st.score, hiVet: __dbg.arcade.hi('veteran'),
                 raw: localStorage.getItem('ah64_arcade_hi_veteran') };
    })()""")
    assert a7['raw'] is not None and int(a7['raw']) == a7['score'], ('A7 hi_veteran 落盘=本局总分', a7)
    assert a7['hiVet'] == a7['score'], ("A7 hi('veteran') 读回 = 本局总分", a7)
    print('A7 OK (pre-reload):', a7)

    # fresh reload：全新 JS 上下文（无既有全局），arcade 应读回存储的最高分
    pg.reload()
    pg.wait_for_function("() => !!(window.__dbg && __dbg.arcade)", timeout=60000)
    a7b = pg.evaluate("""(() => {
        return { hiVet: __dbg.arcade.hi('veteran'),
                 persisted: !!localStorage.getItem('ah64_arcade_hi_veteran') };
    })()""")
    assert a7b['persisted'], ('A7 reload 后存储仍在', a7b)
    assert a7b['hiVet'] == a7['score'], ('A7 fresh reload 读回最高分', a7b)
    print('A7 OK (post-reload):', a7b)

    print('ALL A7 PASS')

import pw_harness as H
H.guarded_main(run, hard_timeout=300)
print('PASS')
