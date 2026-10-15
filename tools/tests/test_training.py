# -*- coding: utf-8 -*-
# test_training.py — P3 第一批（2026-10-13）：训练营 1-1～1-4
#   T1 1-1 首飞：航线激活、靶场全部下场且不还击、无敌机；穿 3 圈 → 悬停区 10s（出圈清零）→ 降落 → 完成+星级
#   T2 1-2 机炮与火箭：6 个静止靶（4 卡车 + 2 油桶），全部 mov=null；passive；全歼 → 完成
#   T3 1-3 地狱火：只留 3 辆坦克且都在移动；只用地狱火 → 附加目标达成
#   T4 1-4 绞车救援：无目标；救援送达 → 完成；首飞航线不出现
import pw_harness as H

READY = "() => !!(window.__dbg && __dbg.apache && __dbg.step && __dbg.targets && __dbg.rig && __dbg.progress)"


def fly_to(pg, x, z, alt=14, secs=0.3):
    pg.evaluate(f"(() => {{ const F = __dbg.FLY; F.state = 'hover'; F.alt = {alt}; F.x = {x}; F.z = {z}; __dbg.S.running = true; }})()")
    H.step(pg, secs)


def result(pg):
    return pg.evaluate("""[__dbg.S._mission.phase, document.getElementById('mission-title').textContent,
        document.querySelector('#mission-body .mstars') ? +document.querySelector('#mission-body .mstars').dataset.stars : -1,
        document.getElementById('mission-body').innerText]""")


def run(pg):
    pg.wait_for_function(READY, timeout=90000)
    pg.evaluate("localStorage.removeItem('ah64_progress'); localStorage.removeItem('ah64_campaign')")
    pg.goto(H.BASE + '/?launch=1&nocine=1&nocut=1#play', wait_until='domcontentloaded')
    pg.wait_for_function(READY, timeout=90000)
    H.step(pg, 0.5)

    # ---- T1 ----
    assert pg.evaluate("__dbg.startLevel('1-1')") is True
    H.step(pg, 0.3)
    s = pg.evaluate("""[__dbg.S._mission.variant, __dbg.course.active, __dbg.course.stage, __dbg.targets.passive,
        __dbg.targets.totalCount, __dbg.enemyAir.units.filter(u => u.on).length, __dbg.S._mission.phase]""")
    assert s == ['train_flight', True, 0, True, 0, 0, 'briefing'], s
    rings = pg.evaluate("__dbg.course.rings.map(r => [r.x, r.y, r.z])")
    # 起飞 → active
    fly_to(pg, 0, 2, secs=0.6)
    assert pg.evaluate("__dbg.S._mission.phase") == 'active'
    # 跳过第 1 圈直接飞第 2 圈：不应计数（必须按顺序）
    fly_to(pg, rings[1][0], rings[1][2], rings[1][1])
    assert pg.evaluate("__dbg.course.stage") == 0
    for i, (x, y, z) in enumerate(rings):
        fly_to(pg, x, z, y)
        assert pg.evaluate("__dbg.course.stage") == i + 1, i
    # 悬停区：6s 后出圈 → 清零
    hz = pg.evaluate("[__dbg.course.zone.position.x, __dbg.course.zone.position.z]")
    fly_to(pg, hz[0], hz[1], 14, secs=6)
    t6 = pg.evaluate("__dbg.course.hoverT")
    assert 5 < t6 < 7, t6
    fly_to(pg, hz[0] + 12, hz[1], 14, secs=0.3)
    assert pg.evaluate("__dbg.course.hoverT") == 0
    fly_to(pg, hz[0], hz[1], 14, secs=10.6)
    assert pg.evaluate("__dbg.course.stage") == 4
    # 降落停机坪
    pg.evaluate("(() => { const F = __dbg.FLY; F.state = 'ground'; F.alt = 0; F.x = 1; F.z = 1; })()")
    H.step_until(pg, "() => __dbg.S._mission.phase === 'done'", 10)
    r = result(pg)
    assert r[0] == 'done' and r[1] == '1-1 · 首飞 — 完成' and r[2] >= 1, r
    assert pg.evaluate("__dbg.progress.rec('1-1').stars") == r[2]
    print('T1 ok', r[:3])

    # ---- T2 ----
    assert pg.evaluate("__dbg.startLevel('1-2')") is True
    H.step(pg, 0.3)
    s = pg.evaluate("""(() => { const T = __dbg.targets; const on = T.targets.filter(t => !t.benched);
        return [__dbg.S._mission.variant, T.totalCount, T.aliveCount, on.map(t => t.type).sort().join(','),
          on.every(t => !t.mov), T.passive, __dbg.course.active]; })()""")
    assert s == ['train_weapons', 6, 6, 'barrel,barrel,truck,truck,truck,truck', True, True, False], s
    fly_to(pg, 0, 20, secs=0.5)
    assert pg.evaluate("__dbg.S._mission.phase") == 'active'
    H.step(pg, 4)
    assert pg.evaluate("__dbg.targets._heliDmg") == 0   # 靶场不还击
    pg.evaluate("""(() => { const m = __dbg.S._mission, rig = __dbg.rig; m.hits = 12; rig.gunAmmo = m.gun0 - 30;
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); }); })()""")
    H.step_until(pg, "() => __dbg.S._mission.phase === 'done'", 15)
    r = result(pg)
    assert r[1] == '1-2 · 机炮与火箭 — 完成' and '命中率不低于 35%' in r[3], r
    print('T2 ok', r[:3])

    # ---- T3 ----
    assert pg.evaluate("__dbg.startLevel('1-3')") is True
    H.step(pg, 0.3)
    p0 = pg.evaluate("__dbg.targets.targets.filter(t => !t.benched).map(t => [t.type, t.pos.x, t.pos.z])")
    assert [p[0] for p in p0] == ['tank', 'tank', 'tank'], p0
    H.step(pg, 1.5)
    p1 = pg.evaluate("__dbg.targets.targets.filter(t => !t.benched).map(t => [t.pos.x, t.pos.z])")
    moved = sum(1 for a, b in zip(p0, p1) if abs(a[1] - b[0]) + abs(a[2] - b[1]) > 0.3)
    assert moved == 3, (p0, p1)
    fly_to(pg, 0, 20, secs=0.5)
    pg.evaluate("""(() => { const m = __dbg.S._mission, rig = __dbg.rig; m.hits = 3; rig.hfAmmo = m.hf0 - 3;
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); }); })()""")
    H.step_until(pg, "() => __dbg.S._mission.phase === 'done'", 15)
    r = result(pg)
    assert r[1] == '1-3 · 地狱火 — 完成', r
    assert pg.evaluate("document.querySelector('#mission-body .mobj i.ok') && document.querySelector('#mission-body .mobj i.ok').textContent.includes('只用地狱火')"), r
    print('T3 ok', r[:3])

    # ---- T4 ----
    assert pg.evaluate("__dbg.startLevel('1-4')") is True
    H.step(pg, 0.3)
    s = pg.evaluate("[__dbg.S._mission.variant, __dbg.targets.totalCount, __dbg.course.active, __dbg.rescue.state]")
    assert s[0] == 'train_rescue' and s[1] == 0 and s[2] is False and s[3] != 'delivered', s
    fly_to(pg, 0, 10, secs=0.5)
    H.step(pg, 2)
    assert pg.evaluate("__dbg.S._mission.phase") == 'active'   # aliveCount=0 不得误判完成
    pg.evaluate("__dbg.rescue.state = 'delivered'")
    H.step_until(pg, "() => __dbg.S._mission.phase === 'done'", 10)
    r = result(pg)
    assert r[1] == '1-4 · 绞车救援 — 完成' and r[2] >= 1, r
    tot = pg.evaluate("__dbg.progress.totals()")
    assert tot['cleared'] == 4, tot
    pg.evaluate("localStorage.removeItem('ah64_progress')")
    print('T4 ok', r[:3], tot)


H.guarded_main(run, hard_timeout=300)
