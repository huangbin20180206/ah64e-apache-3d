# -*- coding: utf-8 -*-
# test_canyon.py — 玩法批 D（2026-10-12）：峡谷突防（canyon_run）
# 帧率无关：时间推进走 targets.update(dt) / canyon.collide(F, dt) 手动步进。
# 断言：
#   D0 简报切到"峡谷突防"→ 峡谷激活，目标 16、雷达站 2、悬停高度压到 4.5；直升机落在峡谷南端谷底；
#      切回标准 → 撤场，目标恢复 10、悬停高度恢复、直升机回原点
#   D1 地形：中线全程谷底 <0.1u；台地 ≥9u；出生点/基地方向（z>-11）恒为 0
#   D2 碰撞：沿中线以 3u 高度飞完全程无擦壁；横向冲向岩壁被挡回并计伤（1s 冷却）；
#      压低到台地里 → 机体被抬到地面以上
#   D3 视线：谷底伏兵从相邻弯道后看不见 → nearestAhead 不返回、occluded=true；
#      弹丸打进岩体 → 返回 rock，不计命中率
#   D4 雷达：崖顶以下暴露度不涨；高于崖顶 2.5s 满格、再 1.2s 产生锁定命中；
#      机炮打掉 2 座雷达站 → 暴露度清零且不再上涨
#   D5 reset：伏兵/雷达站复原、擦碰计数清零
#   D6 离开任务模式 → 峡谷撤场
def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.startMission && __dbg.targets.canyon)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S._guide = 0")
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => document.querySelectorAll('#mission-variants .chip').length === 7", timeout=15000)
    n0 = pg.evaluate("({ n: __dbg.targets.totalCount, hover: __dbg.FLY.HOVER })")
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"canyon_run\"]').click()")
    pg.wait_for_function("() => __dbg.targets.canyon.active === true && Math.abs(__dbg.FLY.z - __dbg.targets.canyon.spawn.z) < 1e-6", timeout=20000)
    b = pg.evaluate("document.getElementById('mission-body').innerHTML")
    c0 = pg.evaluate("""(() => { const T = __dbg.targets, C = T.canyon, F = __dbg.FLY;
      return { n: T.totalCount, alive: T.aliveCount, radars: C.radars.length, hover: F.HOVER,
        fx: F.x, fz: F.z, h: C.heightAt(F.x, F.z), hud: document.getElementById('canyon-hud').classList.contains('show'),
        mesh: !!(C.mesh && C.mesh.visible), dune: __dbg.W.duneFar.visible }; })()""")
    print('D0', n0, c0)
    assert n0['n'] == 10, ('标准局目标应为 10', n0)
    assert c0['n'] == 16 and c0['alive'] == 16 and c0['radars'] == 2, ('峡谷局目标应为 16、雷达站 2', c0)
    assert abs(c0['hover'] - 4.5) < 1e-9 and c0['h'] < 0.1 and c0['fz'] < -50, ('应落在峡谷南端谷底、悬停 4.5', c0)
    assert c0['hud'] and c0['mesh'] and not c0['dune'], ('暴露条/地形应显示，远景沙丘让位', c0)
    assert '峡谷突防' in b and '×16' in b, ('简报应含峡谷突防文案', b)
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"standard\"]').click()")
    pg.wait_for_function("() => __dbg.targets.canyon.active === false", timeout=20000)
    back = pg.evaluate("({ n: __dbg.targets.totalCount, hover: __dbg.FLY.HOVER, x: __dbg.FLY.x, z: __dbg.FLY.z, hud: document.getElementById('canyon-hud').classList.contains('show') })")
    assert back['n'] == 10 and back['hover'] == n0['hover'] and back['x'] == 0 and back['z'] == 0 and not back['hud'], ('切回标准应复原', back)
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"canyon_run\"]').click()")
    pg.wait_for_function("() => __dbg.targets.canyon.active === true", timeout=20000)
    pg.evaluate("(() => { const m = __dbg.S._mission; m.phase='active'; if (m.t0 == null) m.t0 = __dbg.S.time; const r=__dbg.rig; m.gun0=r.gunAmmo; m.rk0=r.rocketAmmo; m.hf0=r.hfAmmo; __dbg.beginMission(); })()")

    r = pg.evaluate("""(() => {
      const T = __dbg.targets, C = T.canyon, m = __dbg.S._mission;
      const V = __dbg.apache.root.position.constructor;
      const out = {};
      // D1 地形
      let maxFloor = 0;
      for (let f = 0; f <= 1.0001; f += 0.005) { const p = C.pointAt(f); maxFloor = Math.max(maxFloor, C.heightAt(p.x, p.z)); }
      out.maxFloor = maxFloor;
      out.plateau = Math.min(C.heightAt(50, -30), C.heightAt(-50, -55), C.heightAt(10, -56));
      let north = 0;
      for (let x = -58; x <= 58; x += 2) for (let z = -10.9; z <= 58; z += 3) north = Math.max(north, C.heightAt(x, z));
      out.north = north;
      // D2 碰撞：沿中线以 3u 高度飞完全程
      C._px = null; C._hitCd = 0; C.strikes = 0;
      const hd0 = T._heliDmg;
      const F = { x: 0, z: 0, alt: 3, state: 'hover' };
      let strikes = 0;
      for (let f = 0; f <= 1.0001; f += 0.002) { const p = C.pointAt(f); F.x = p.x; F.z = p.z; F.alt = 3; if (C.collide(F, 0.016)) strikes++; }
      out.pathStrikes = strikes;
      // 横冲：从 0.5 处中线沿法向一步步往外推
      const p = C.pointAt(0.5);
      F.x = p.x; F.z = p.z; F.alt = 3; C._px = null; C._hitCd = 0;
      C.collide(F, 0.016);
      let blocked = false, maxOff = 0;
      for (let i = 0; i < 60; i++) {
        F.x -= p.dirz * 0.3; F.z += p.dirx * 0.3; F.alt = 3;
        const ev = C.collide(F, 0.016);
        if (ev) blocked = true;
        maxOff = Math.max(maxOff, Math.hypot(F.x - p.x, F.z - p.z));
      }
      out.blocked = blocked; out.maxOff = maxOff;
      out.wallDmg = T._heliDmg - hd0; out.strikes = C.strikes;
      // 压进台地
      const G = { x: 50, z: -30, alt: 2, state: 'hover' }; C._px = null;
      C.collide(G, 0.016);
      out.liftAlt = G.alt; out.liftH = C.heightAt(50, -30);
      // D3 视线：从 0.30 处谷底看 0.60 处伏兵（中间隔着弯道岩壁）
      const u = C.units[3], a = C.pointAt(0.30);
      const hp = new V(a.x, 3, a.z);
      const nose = new V(u.pos.x - hp.x, 0.9 - hp.y, u.pos.z - hp.z).normalize();
      out.occ = C.occluded(hp.x, hp.y, hp.z, u.pos.x, 0.9, u.pos.z);
      out.lockHidden = T.nearestAhead(hp, nose, 4, ['tank']) === u;
      // 同一辆，从它所在段的中线正上方高处看：可见
      const hpTop = new V(u.pos.x, 9, u.pos.z - 1);
      out.occTop = C.occluded(hpTop.x, hpTop.y, hpTop.z, u.pos.x, 0.9, u.pos.z);
      const hits0 = m.hits;
      const rk = T.hitTest({ x: 50, y: 4, z: -30 }, 1);
      out.rockType = rk && rk.type; out.rockHits = m.hits - hits0;
      // D4 雷达暴露
      T._heliDmg = 0; C.exposure = 0; C.hitPending = null;
      const low = new V(a.x, 3, a.z);
      for (let i = 0; i < 60; i++) T.update(0.05, low, m);
      out.expLow = C.exposure;
      const high = new V(a.x, 12, a.z);
      for (let i = 0; i < 90; i++) T.update(0.05, high, m);   // 2.5s 满格 + 1.2s 锁定
      out.expHigh = C.exposure; out.lockHit = !!C.hitPending;
      const hits1 = m.hits;
      for (const rd of C.radars) for (let k = 0; k < 12 && rd.alive; k++) T.hitTest({ x: rd.x, y: rd.y + 1, z: rd.z }, 1);
      out.radarsAlive = C.radarsAlive; out.radarHits = m.hits - hits1;
      out.expAfter = C.exposure;
      C.hitPending = null;
      for (let i = 0; i < 40; i++) T.update(0.05, high, m);
      out.expAfter2 = C.exposure;
      // D5 reset
      T.reset();
      out.resetU = C.units.every(t => t.alive && t.hp === t.hp0);
      out.resetR = C.radars.every(rd => rd.alive && rd.hp === rd.hp0) && C.strikes === 0 && C.exposure === 0;
      out.total = T.totalCount;
      return out; })()""")
    print('D1-5', r)
    assert r['maxFloor'] < 0.1, ('D1 中线谷底应为平地', r)
    assert r['plateau'] > 9, ('D1 台地应 ≥9u', r)
    assert r['north'] == 0, ('D1 出生点/基地方向必须保持平地', r)
    assert r['pathStrikes'] == 0, ('D2 沿中线 3u 高飞全程不应擦壁', r)
    assert r['blocked'] and r['maxOff'] < 7, ('D2 横冲岩壁应被挡住', r)
    assert r['strikes'] >= 1 and 0.5 < r['wallDmg'] < 2.5, ('D2 擦壁应计伤且有冷却', r)
    assert r['liftAlt'] >= r['liftH'] - 1e-6, ('D2 机体不能进台地', r)
    assert r['occ'] is True and r['lockHidden'] is False, ('D3 弯道后伏兵应被岩壁遮挡且锁不上', r)
    assert r['occTop'] is False, ('D3 头顶上方应能看见', r)
    assert r['rockType'] == 'rock' and r['rockHits'] == 0, ('D3 打岩壁应被吃掉且不计命中', r)
    assert r['expLow'] == 0, ('D4 崖顶以下不应暴露', r)
    assert r['expHigh'] >= 1 and r['lockHit'], ('D4 高于崖顶 4.5s 应满格并锁定命中', r)
    assert r['radarsAlive'] == 0, ('D4 机炮应能打掉雷达站', r)
    assert r['expAfter'] == 0 and r['expAfter2'] == 0, ('D4 雷达全毁后暴露应清零', r)
    assert r['resetU'] and r['resetR'] and r['total'] == 16, ('D5 reset 未复原', r)

    # D6：离开任务模式 → 撤场
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_function("() => __dbg.targets.canyon.active === false", timeout=20000)
    assert pg.evaluate("__dbg.targets.totalCount") == 10, 'D6 离开任务模式后目标应恢复 10'


import pw_harness as H
H.guarded_main(run, hard_timeout=180)
print('PASS')
