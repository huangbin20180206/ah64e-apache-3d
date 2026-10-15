# -*- coding: utf-8 -*-
# test_layouts.py — P3c（2026-10-13）：关卡独立布场
#   Y1 2-1 前哨：上场 8 个目标、位置按布场、不出敌机；全歼即通关
#   Y2 2-2 搜捕：上场 6 个、幸存者在 (22,8)、卡车绕他转圈
#   Y3 3-1 防空阵地：上场 10 个、雷达活着 aaRateMul=1.45，打掉雷达 → 0.6
#   Y4 再进 3-3（无布场）：回到基地默认布阵、aaRateMul=1
#   Y5 2-3 加油点一发打连锁  Y6 3-2 敌机锚点移出基地  Y7 4-2 坦克纵队沿环线机动
import pw_harness as H

READY = "() => !!(window.__dbg && __dbg.apache && __dbg.step && __dbg.targets && __dbg.progress)"


def enter(pg, lid):
    assert pg.evaluate("__dbg.startLevel('%s')" % lid) is True, lid
    H.step(pg, 0.3)
    pg.evaluate("(() => { const F = __dbg.FLY; F.state = 'hover'; F.alt = 14; F.x = 0; F.z = 0; __dbg.S.running = true; })()")
    pg.evaluate("__dbg.S._mission.phase !== 'active' && __dbg.beginMission && __dbg.beginMission()")
    H.step(pg, 0.6)


def run(pg):
    pg.wait_for_function(READY, timeout=90000)
    pg.evaluate("localStorage.removeItem('ah64_progress')")
    pg.goto(H.BASE + '/?launch=1&nocine=1&nocut=1#play', wait_until='domcontentloaded')
    pg.wait_for_function(READY, timeout=90000)
    H.step(pg, 0.5)
    pg.evaluate("""(() => { const P = __dbg.progress; ['1-1','2-1','2-2','2-3','3-1','3-2','3-3','4-1','4-2']
        .forEach(id => P.record(id, 'B', 0, {}, 'standard')); })()""")
    enter(pg, '2-1')
    s = pg.evaluate("""(() => { const T = __dbg.targets;
        const tk = T.targets.find(t => t.type === 'tank' && t.alive);
        return [T.totalCount, T.aliveCount, Math.round(tk.pos.x), Math.round(tk.pos.z), T._layout,
                __dbg.enemyAir.units.filter(u => u.on).length, __dbg.S._mission.phase]; })()""")
    assert s == [8, 8, -24, 10, True, 0, 'active'], s
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); })")
    H.step_until(pg, "() => __dbg.S._mission.phase === 'done'", 12)
    print('Y1 ok', s)
    enter(pg, '2-2')
    a = pg.evaluate("""(() => { const T = __dbg.targets; const R = __dbg.rescue;
        const tr = T.targets.filter(t => t.type === 'truck' && t.alive).map(t => Math.hypot(t.pos.x - 22, t.pos.z - 8));
        return [T.totalCount, Math.round(R.g.position.x), Math.round(R.g.position.z), R.g.visible,
                tr.length, tr.every(d => Math.abs(d - 7) < 0.6), __dbg.enemyAir.units.filter(u => u.on).length]; })()""")
    assert a == [6, 22, 8, True, 3, True, 0], a
    H.step(pg, 3.0)
    b = pg.evaluate("""__dbg.targets.targets.filter(t => t.type === 'truck' && t.alive).every(t => Math.abs(Math.hypot(t.pos.x - 22, t.pos.z - 8) - 7) < 0.6)""")
    assert b is True
    print('Y2 ok', a)
    enter(pg, '3-1')
    c = pg.evaluate("[__dbg.targets.totalCount, __dbg.targets.aaRateMul]")
    assert c == [10, 1.45], c
    pg.evaluate("(() => { const N = __dbg.narrative; N._destroy(N.strikes.find(k => k.key === 'radar'), 3); })()")
    H.step(pg, 0.5)
    d = pg.evaluate("__dbg.targets.aaRateMul")
    assert d == 0.6, d
    print('Y3 ok', c, d)
    enter(pg, '3-3')
    e = pg.evaluate("""(() => { const T = __dbg.targets; const tk = T.targets.filter(t => t.type === 'tank');
        return [T.totalCount, T._layout, T.aaRateMul, tk.every(t => Math.hypot(t.home.x - t.pos.x, t.home.z - t.pos.z) < 3)]; })()""")
    assert e[1:] == [False, 1, True], e
    print('Y4 ok', e)
    enter(pg, '2-3')
    # Y5 2-3 效率关：10 个；一发强力命中加油点中心 → 溅射+殉爆至少清掉 3 个
    f0 = pg.evaluate("[__dbg.targets.totalCount, __dbg.targets.aliveCount]")
    pg.evaluate("__dbg.targets.hitTest && __dbg.targets.hitTest(__dbg.targets.baseCenter.clone().set(17.9, 0.6, 18.2), 3)")
    H.step(pg, 2.5)
    f1 = pg.evaluate("__dbg.targets.aliveCount")
    assert f0 == [10, 10] and f1 <= 7, (f0, f1)
    print('Y5 ok', f0, f1)
    # Y6 3-2 空战关：地面 2 辆防空车；敌机锚点在 (-16,22)
    enter(pg, '3-2')
    g = pg.evaluate("[__dbg.targets.totalCount, __dbg.S._mission._airAnchor, __dbg.enemyAir.units.filter(u => u.on).length]")
    assert g[0] == 2 and g[1] == {'x': -16, 'z': 22} and g[2] >= 1, g
    print('Y6 ok', g)
    # Y7 4-2 夜战：坦克纵队在环线上动起来，彼此不重叠
    enter(pg, '4-2')
    p0 = pg.evaluate("__dbg.targets.targets.filter(t => t.type === 'tank' && t.alive).map(t => [t.pos.x, t.pos.z])")
    H.step(pg, 3.0)
    p1 = pg.evaluate("__dbg.targets.targets.filter(t => t.type === 'tank' && t.alive).map(t => [t.pos.x, t.pos.z])")
    moved = all(abs(a[0] - b[0]) + abs(a[1] - b[1]) > 1.5 for a, b in zip(p0, p1))
    sep = min(((p1[i][0] - p1[j][0]) ** 2 + (p1[i][1] - p1[j][1]) ** 2) ** 0.5 for i in range(3) for j in range(i + 1, 3))
    assert len(p1) == 3 and moved and sep > 5 and pg.evaluate("__dbg.targets.totalCount") == 10, (p0, p1, sep)
    pg.evaluate("localStorage.removeItem('ah64_progress')")
    print('Y7 ok', round(sep, 1))


H.guarded_main(run, hard_timeout=240)
