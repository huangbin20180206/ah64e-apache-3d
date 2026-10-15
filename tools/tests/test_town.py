# -*- coding: utf-8 -*-
# test_town.py — 玩法批 C（2026-10-12）：城镇突击（urban_strike）
# 帧率无关：时间推进走 targets.update(dt) 手动步进；城镇激活由 loop 派生，只等一帧。
# 断言：
#   C0 简报切到"城镇突击"→ 城镇激活，目标 15；切回标准 → 城镇撤场，目标恢复 10（零变化）
#   C1 楼后静止伏兵被遮挡：occluded=true，nearestAhead 不返回它（锁不上）
#   C2 弹丸打进楼体 → 返回 building、楼扣血、不计命中率
#   C3 两发地狱火塌楼：塌方动画结束楼体隐藏、瓦砾出现、楼后伏兵被砸伤并暴露（可锁定）
#   C4 直升机进入 50u：探头伏兵驶出巷子到街口（stay 态），低空时藏身状态被遮挡
#   C5 reset：楼复原、瓦砾移除、伏兵回藏身点满血
#   C6 离开任务模式 → 城镇撤场
#   W  HESCO 警戒墙围住基地（不再被推到 z=74~92），离疏散环路中线 ≥1.2u，南北墙正中留门
def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.startMission && __dbg.targets.town)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S._guide = 0")
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => document.querySelectorAll('#mission-variants .chip').length === 7", timeout=15000)
    n0 = pg.evaluate("__dbg.targets.totalCount")
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"urban_strike\"]').click()")
    pg.wait_for_function("() => __dbg.targets.town.active === true", timeout=20000)
    b = pg.evaluate("document.getElementById('mission-body').innerHTML")
    c0 = pg.evaluate("({ n: __dbg.targets.totalCount, alive: __dbg.targets.aliveCount, bld: __dbg.targets.town.buildings.length })")
    print('C0', n0, c0)
    assert n0 == 10, ('标准局目标应为 10', n0)
    assert c0['n'] == 15 and c0['alive'] == 15 and c0['bld'] == 10, ('城镇局目标应为 15、建筑 10', c0)
    assert '城镇突击' in b and '×15' in b, ('简报应含城镇突击文案', b)
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"standard\"]').click()")
    pg.wait_for_function("() => __dbg.targets.town.active === false", timeout=20000)
    assert pg.evaluate("__dbg.targets.totalCount") == 10, '切回标准后目标应恢复 10'
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"urban_strike\"]').click()")
    pg.wait_for_function("() => __dbg.targets.town.active === true", timeout=20000)
    pg.evaluate("(() => { const m = __dbg.S._mission; m.phase='active'; if (m.t0 == null) m.t0 = __dbg.S.time; const r=__dbg.rig; m.gun0=r.gunAmmo; m.rk0=r.rocketAmmo; m.hf0=r.hfAmmo; __dbg.beginMission(); })()")

    r = pg.evaluate("""(() => {
      const T = __dbg.targets, Z = T.town, m = __dbg.S._mission;
      const V = __dbg.apache.root.position.constructor;
      const out = {};
      const tower = Z.buildings[3];
      const still = Z.ambush.find(t => !t.mov);
      // C1：南侧低空看水塔楼后静止伏兵
      const hp = new V(still.pos.x, 5, still.pos.z - 28);
      const nose = new V(still.pos.x - hp.x, 0.9 - hp.y, still.pos.z - hp.z).normalize();
      out.occ = Z.occluded(hp.x, hp.y, hp.z, still.pos.x, 0.9, still.pos.z);
      const na = T.nearestAhead(hp, nose, 8, ['tank']);
      out.lockHidden = na === still;
      // C2：机炮弹打进楼体
      const hits0 = m.hits;
      const b0 = tower.hp;
      const hb = T.hitTest({ x: tower.x, y: 2, z: tower.z - tower.d / 2 + 0.3 }, 1);
      out.hitType = hb && hb.type;
      out.bDmg = b0 - tower.hp;
      out.hitsDelta = m.hits - hits0;
      // C3：两发地狱火塌楼
      T.hitTest({ x: tower.x, y: 3, z: tower.z - tower.d / 2 + 0.3 }, 3);
      T.hitTest({ x: tower.x, y: 3, z: tower.z - tower.d / 2 + 0.3 }, 3);
      out.towerAlive = tower.alive;
      for (let i = 0; i < 50; i++) T.update(0.05, hp, m);
      out.towerVis = tower.group.visible;
      out.rubble = !!tower.rubble;
      out.stillHurt = still.hp < still.hp0 || !still.alive;
      out.occAfter = still.alive ? Z.occluded(hp.x, hp.y, hp.z, still.pos.x, 0.9, still.pos.z) : false;
      out.lockAfter = still.alive ? T.nearestAhead(hp, nose, 8, ['tank']) === still : true;
      out.hitsAfter = m.hits - hits0;
      // C4：低空进入 50u，伏兵轮番探头
      T.reset();
      const hp2 = new V(0, 5, Z.center.z - 26);
      const peek = Z.ambush.filter(t => t.mov);
      out.hiddenAtStart = peek.filter(t => { T.update(0, hp2, m); return t.hidden; }).length;
      const seen = new Set(); let maxMove = 0;
      for (let i = 0; i < 240; i++) {
        T.update(0.05, hp2, m);
        for (const t of peek) {
          seen.add(t.mov.st);
          maxMove = Math.max(maxMove, Math.hypot(t.pos.x - t.home.x, t.pos.z - t.home.z));
        }
      }
      out.states = [...seen].sort().join(',');
      out.maxMove = maxMove;
      out.synced = peek.every(t => Math.abs(t.pos.x - t.group.position.x) < 1e-6);
      // C5：reset
      T.hitTest({ x: Z.buildings[0].x, y: 1.5, z: Z.buildings[0].z }, 3);
      T.hitTest({ x: Z.buildings[0].x, y: 1.5, z: Z.buildings[0].z }, 3);
      for (let i = 0; i < 40; i++) T.update(0.05, hp2, m);
      out.b0Down = !Z.buildings[0].alive;
      T.reset();
      out.resetB = Z.buildings.every(b => b.alive && b.group.visible && !b.rubble && b.hp === b.hp0 && b.group.position.y === 0);
      out.resetA = Z.ambush.every(t => t.alive && t.hp === t.hp0 && Math.hypot(t.pos.x - t.home.x, t.pos.z - t.home.z) < 1e-6);
      out.total = T.totalCount;
      return out; })()""")
    print('C1-5', r)
    assert r['occ'] is True and r['lockHidden'] is False, ('C1 楼后伏兵应被遮挡且锁不上', r)
    assert r['hitType'] == 'building' and r['bDmg'] > 0 and r['hitsDelta'] == 0, ('C2 打楼应扣楼血且不计命中', r)
    assert r['towerAlive'] is False and r['towerVis'] is False and r['rubble'], ('C3 两发地狱火应塌楼', r)
    assert r['stillHurt'], ('C3 塌方应砸伤楼后伏兵', r)
    assert r['occAfter'] is False and r['lockAfter'] is True, ('C3 楼塌后伏兵应暴露可锁定', r)
    assert r['hitsAfter'] == 0, ('C3 打楼/溅射不计命中率', r)
    assert r['hiddenAtStart'] == 4, ('C4 低空时 4 个探头伏兵在藏身点应被遮挡', r)
    assert 'stay' in r['states'] and r['maxMove'] > 3, ('C4 伏兵应驶出到街口', r)
    assert r['synced'], r
    assert r['b0Down'] and r['resetB'] and r['resetA'] and r['total'] == 15, ('C5 reset 未复原', r)

    # C6：离开任务模式 → 城镇撤场
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_function("() => __dbg.targets.town.active === false", timeout=20000)
    assert pg.evaluate("__dbg.targets.totalCount") == 10, 'C6 离开任务模式后目标应恢复 10'


    # W：HESCO 警戒墙位置（scenery 沙色合批里只有 HESCO 块顶面高过 0.9u）
    w = pg.evaluate("""(() => {
      const T = __dbg.targets, sm = T.scenery.children[0], pa = sm.geometry.attributes.position;
      const pts = new Map();
      for (let i = 0; i < pa.count; i++) {
        if (pa.getY(i) < 0.9) continue;
        const k = Math.round(pa.getX(i) * 2) + ',' + Math.round(pa.getZ(i) * 2);
        pts.set(k, [pa.getX(i), pa.getZ(i)]);
      }
      const P = [...pts.values()];
      const L = T._evacLoop; let minLoop = 1e9;
      for (const [x, z] of P) for (let k = 0; k < L.length; k++) {
        const [ax, az] = L[k], [bx, bz] = L[(k + 1) % L.length];
        const dx = bx - ax, dz = bz - az, u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        minLoop = Math.min(minLoop, Math.hypot(x - ax - u * dx, z - az - u * dz));
      }
      const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
      return { n: P.length, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), minLoop,
        gate: P.filter(([x, z]) => Math.abs(x) < 2.3 && (Math.abs(z - 27.4) < 1 || Math.abs(z - 54) < 1)).length,
        maxAz: Math.max(...P.map(([x, z]) => Math.abs(Math.atan2(x, z)))) };
    })()""")
    print('W', w)
    assert w['n'] > 20, w
    assert w['x0'] > -19.5 and w['x1'] < 19.5 and w['z0'] > 27 and w['z1'] < 54.5, ('HESCO 应围住基地', w)
    assert w['minLoop'] >= 1.2 and w['gate'] == 0 and w['maxAz'] < 0.62, ('HESCO 挡路/无门洞/进沙丘', w)


import pw_harness as H
H.guarded_main(run, hard_timeout=180)
print('PASS')
