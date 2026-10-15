# -*- coding: utf-8 -*-
# test_gameplay_b.py — 玩法批 B（2026-10-09）：连锁殉爆 / 基地警报疏散 / 多杀播报
# 帧率无关：所有时间推进走 targets.update(dt) 手动步进（SwiftShader 也能确定性复现）。
# 断言：
#   B1 油桶中弹 → 殉爆队列逐个引爆 → 油料区三桶全部连锁击毁，播报带"连锁殉爆"
#   B1 溅射不计命中率（mission.hits 只随直接命中增长）
#   B2 任务进行中首次受创 1.6s 后警报；静止卡车上疏散环路且确实在移动
#   B2 疏散车辆两两中心距 ≥2.8u（不追尾）；车辆全程留在基地平地走廊
#   B2 展示模式（无任务）受创不触发警报（既有用例零变化）
#   B2 reset 解除警报、疏散车辆归位、原巡逻目标保留巡逻
#   B3 多杀横幅 #streak 在 2.2s 内连续击毁时出现
def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.startCampaign)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")

    # ---- 展示模式：受创不报警 ----
    demo = pg.evaluate("""(() => {
      const T = __dbg.targets; T.reset();
      const hp = __dbg.apache.root.position.clone().set(0, 14, 0);
      const tk = T.targets.find(t => t.type === 'tank' && !t.mov);
      T.hitTest({ x: tk.pos.x, y: 1, z: tk.pos.z }, 1);
      for (let i = 0; i < 80; i++) T.update(0.05, hp, null);
      const r = { alert: T.alerted, paths: T.targets.filter(t => t.mov && t.mov.kind === 'path').length };
      T.reset(); return r; })()""")
    print('demo', demo)
    assert demo['alert'] is False and demo['paths'] == 0, ('展示模式不应报警', demo)

    # ---- 任务局 ----
    pg.evaluate("(() => { try { localStorage.removeItem('ah64_campaign'); } catch (e) {} })()")
    pg.evaluate("__dbg.S.mode = 'mission'; __dbg.startCampaign(0)")
    pg.wait_for_timeout(300)
    pg.evaluate("(() => { const m = __dbg.S._mission; m.phase='active'; if (m.t0 == null) m.t0 = __dbg.S.time; const r=__dbg.rig; m.gun0=r.gunAmmo; m.rk0=r.rocketAmmo; m.hf0=r.hfAmmo; __dbg.beginMission(); })()")
    pg.wait_for_timeout(300)
    r = pg.evaluate("""(() => {
      const T = __dbg.targets, m = __dbg.S._mission;
      const hp = __dbg.apache.root.position.clone().set(0, 14, 0);
      const step = (n) => { for (let i = 0; i < n; i++) T.update(0.05, hp, m); };
      const out = { phase: m.phase };
      const hits0 = m.hits;
      const barrels = T.targets.filter(t => t.type === 'barrel');
      T.hitTest({ x: barrels[0].pos.x, y: 1, z: barrels[0].pos.z }, 2);   // 直接命中 1 桶
      out.hitsDelta = m.hits - hits0;
      out.alertEarly = T.alerted;
      step(60);                                                      // 3s：殉爆链 + 警报
      out.hitsDeltaAfter = m.hits - hits0;
      out.barrelsAlive = barrels.filter(t => t.alive).length;
      out.alert = T.alerted;
      out.feed = [...document.querySelectorAll('#killfeed .kf')].map(e => e.textContent);
      out.streakShown = document.getElementById('streak').classList.contains('show');
      const evac = T.targets.filter(t => t.alive && t.mov && t.mov.kind === 'path');
      out.evacN = evac.length;
      const p0 = evac.map(t => [t.pos.x, t.pos.z]);
      step(100);
      out.evacMoved = evac.filter((t, k) => Math.hypot(t.pos.x - p0[k][0], t.pos.z - p0[k][1]) > 1).length;
      // 60s 绕行：车距与走廊约束
      let minD = 1e9, maxAz = 0, synced = true;
      for (let i = 0; i < 1200; i++) {
        step(1);
        for (let a = 0; a < evac.length; a++) {
          const A = evac[a];
          maxAz = Math.max(maxAz, Math.abs(Math.atan2(A.pos.x, A.pos.z)));
          if (Math.abs(A.pos.x - A.group.position.x) > 1e-6) synced = false;
          for (let c = a + 1; c < evac.length; c++) {
            const C = evac[c];
            minD = Math.min(minD, Math.hypot(A.pos.x - C.pos.x, A.pos.z - C.pos.z));
          }
        }
      }
      out.minD = minD; out.maxAz = maxAz; out.synced = synced;
      T.reset();
      out.resetAlert = T.alerted;
      out.resetHome = T.targets.every(t => t.mov ? t.mov.kind !== 'path'
        : Math.hypot(t.pos.x - t.home.x, t.pos.z - t.home.z) < 1e-6);
      out.patrolKept = T.targets.filter(t => t.mov).map(t => t.mov.kind).sort().join(',');
      out.queue = T._fuelBooms.length;
      return out; })()""")
    print('mission', r)
    assert r['phase'] == 'active', r
    assert r['hitsDelta'] == 1 and r['hitsDeltaAfter'] == 1, ('溅射不应计入命中率', r)
    assert r['alertEarly'] is False, ('警报应有 1.6s 延迟', r)
    assert r['barrelsAlive'] == 0, ('油料区应整片连锁殉爆', r)
    assert any('连锁殉爆' in f for f in r['feed']), ('播报缺连锁殉爆', r['feed'])
    assert r['streakShown'], ('多杀横幅未出现', r)
    assert r['alert'] is True, ('任务局受创后应报警', r)
    assert r['evacN'] >= 2 and r['evacMoved'] == r['evacN'], ('疏散车辆未移动', r)
    assert r['minD'] >= 2.8, ('疏散车辆追尾', r)
    assert r['maxAz'] < 0.62, ('疏散车辆驶出平地走廊（会陷进远景沙丘）', r)
    assert r['synced'], ('pos 快照与 group 不同步', r)
    assert r['resetAlert'] is False and r['resetHome'], ('reset 未复位', r)
    assert r['patrolKept'] == 'circle,line', ('原巡逻目标被破坏', r)
    assert r['queue'] == 0, r


import pw_harness as H
H.guarded_main(run, hard_timeout=180)
print('PASS')
