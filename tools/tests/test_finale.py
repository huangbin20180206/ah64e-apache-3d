# -*- coding: utf-8 -*-
# test_finale.py — P3（2026-10-13）：终关 4-3 三阶段
#   F1 开局：variant=finale、阶段 1、无敌机、救援目标隐藏不可作业；地面全歼也不跳阶段（必须先致盲）
#   F2 雷达+防空车摧毁 → 阶段 2，敌机升空
#   F3 地面全歼但敌机仍在 → 留在阶段 2；敌机全部退场/击落 → 阶段 3，飞行员出现在基地西侧
#   F4 送抵 → 完成，星级入档；用时按 par 折算
import pw_harness as H

READY = "() => !!(window.__dbg && __dbg.apache && __dbg.step && __dbg.targets && __dbg.progress && __dbg.narrative)"


def fin(pg):
    return pg.evaluate("__dbg.S._mission._fin || 1")


def run(pg):
    pg.wait_for_function(READY, timeout=90000)
    pg.evaluate("localStorage.removeItem('ah64_progress')")
    pg.goto(H.BASE + '/?launch=1&nocine=1&nocut=1#play', wait_until='domcontentloaded')
    pg.wait_for_function(READY, timeout=90000)
    H.step(pg, 0.5)
    pg.evaluate("""(() => { const P = __dbg.progress; ['1-1','1-2','1-3','1-4','2-1','2-2','2-3','3-1','3-2','3-3','4-1','4-2']
        .forEach(id => P.record(id, 'B', 0, {}, 'standard')); })()""")
    assert pg.evaluate("__dbg.startLevel('4-3')") is True
    H.step(pg, 0.3)
    pg.evaluate("(() => { const F = __dbg.FLY; F.state = 'hover'; F.alt = 14; F.x = 0; F.z = 15; __dbg.S.running = true; })()")
    H.step(pg, 0.5)
    pg.evaluate("__dbg.beginMission && __dbg.S._mission.phase !== 'active' && __dbg.beginMission()")
    H.step(pg, 1.0)
    s = pg.evaluate("""[__dbg.S._mission.variant, __dbg.S._mission.phase, __dbg.enemyAir.units.filter(u => u.on).length,
        __dbg.rescue.ok, __dbg.rescue.g.visible]""")
    assert s == ['finale', 'active', 0, False, False], s
    assert fin(pg) == 1
    # 地面先清光：不跳阶段
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); })")
    H.step(pg, 1.2)
    assert fin(pg) == 1, fin(pg)
    print('F1 ok')
    # F2 致盲
    pg.evaluate("(() => { const N = __dbg.narrative; N.strikes.filter(k => k.alive && (k.key === 'radar' || k.key === 'sam')).forEach(k => N._destroy(k, 3)); })()")
    H.step(pg, 1.2)
    assert fin(pg) == 2, fin(pg)
    on = pg.evaluate("__dbg.enemyAir.units.filter(u => u.on).length")
    assert on >= 1, on
    print('F2 ok, bandits', on)
    # F3 地面已全歼，敌机在 → 阶段 2；击落/退场 → 阶段 3
    H.step(pg, 1.2)
    assert fin(pg) == 2
    pg.evaluate("__dbg.enemyAir.units.forEach(u => { u.on = false; u.phase = 'down'; })")
    H.step(pg, 1.2)
    assert fin(pg) == 3, fin(pg)
    r = pg.evaluate("[__dbg.rescue.ok, __dbg.rescue.g.visible, __dbg.rescue.g.position.x, __dbg.rescue.g.position.z, __dbg.rescue.state]")
    assert r == [True, True, -14, 50, 'idle'], r
    print('F3 ok')
    pg.evaluate("__dbg.rescue.state = 'delivered'")
    H.step_until(pg, "() => __dbg.S._mission.phase === 'done'", 10)
    t = pg.evaluate("""[document.getElementById('mission-title').textContent,
        document.querySelector('#mission-body .mstars') ? +document.querySelector('#mission-body .mstars').dataset.stars : -1,
        __dbg.progress.rec('4-3').stars, __dbg.progress.totals().cleared]""")
    assert t[0] == '4-3 · 终关 · 斩首 — 完成' and t[1] >= 1 and t[2] == t[1] and t[3] == 13, t
    pg.evaluate("localStorage.removeItem('ah64_progress')")
    print('F4 ok', t)


H.guarded_main(run, hard_timeout=240)
