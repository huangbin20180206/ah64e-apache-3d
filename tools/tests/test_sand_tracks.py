# P3-9 沙漠痕迹验证：累积（合成步进盖章）→ 缓慢衰减（destination-out）→
# 离开清零 → 重复进入不继承 → 风向下风偏置（单章 alpha 加权质心）→
# 痕迹平面贴合 duneH 高度场（顶点位移结构）。零报错由护具判定。
# 用法: uv run --with playwright python test_sand_tracks.py
import math

import pw_harness as H

ALPHA_SUM = """(() => { const t = __dbg.washfx.tracks;
  const d = t.cx.getImageData(0, 0, t.N, t.N).data;
  let s = 0; for (let i = 3; i < d.length; i += 32) s += d[i];
  return s; })()"""


def alpha(pg):
    return pg.evaluate(ALPHA_SUM)


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.washfx)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#btn-panel') && document.querySelector('#btn-panel').click()")

    # 0) 贴合 duneH 结构：88 段网格、中心清空区/场外顶点 z=0、沙丘带内被抬高
    dune = pg.evaluate("""(() => { const p = __dbg.washfx.tracks.mesh.geometry.attributes.position;
      let maxZ = -1e9, raised = 0, centerZ = null, cornerZ = null;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        if (z > maxZ) maxZ = z;
        if (z > 0.2) raised++;
        if (p.getX(i) === 0 && p.getY(i) === 0) centerZ = z;
        if (p.getX(i) === -21 && p.getY(i) === -21) cornerZ = z;
      }
      return { count: p.count, maxZ, raised, centerZ, cornerZ }; })()""")
    assert dune['count'] == 89 * 89, ('痕迹平面应为 88 段网格（贴 duneH）', dune)
    assert dune['raised'] > 50, ('沙丘带内应有被抬高的顶点', dune)
    assert 0 <= dune['maxZ'] <= 0.62, ('顶点抬高应在 duneH 脊高 0.58u 范围内', dune)
    assert dune['centerZ'] == 0 and dune['cornerZ'] == 0, ('清空区/场外顶点应为 0', dune)

    # 1) 切沙漠：同一 evaluate 内同步读（click 处理器同步跑 clear，帧前必为 0）
    t0 = pg.evaluate("(() => { document.querySelector('#terrain-row [data-terrain=\"desert\"]').click(); "
                     "return __dbg.washfx.tracks.stamps; })()")
    assert t0 == 0, ('进入沙漠应从干净状态开始', t0)
    # B6+：等两帧真正渲染（帧等待与帧率无关），替代固定睡
    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")

    # 2) 累积：合成步进（spin=1/alt=2，引擎关着也能驱动；s 门限 s>0.1 && lowAlt>0.02）
    for _ in range(30):
        pg.evaluate("__dbg.washfx.update(0.2, 1, 2, 0, 0, __dbg.S.time)")
    # B6+：等盖章数达标再断言（tracks 由 28-washfx.js:160 updater 每帧写；分类器真候选 L44→L50）
    pg.wait_for_function("() => __dbg.washfx.tracks.stamps >= 10", timeout=15000)
    s1 = pg.evaluate("__dbg.washfx.tracks.stamps")
    assert s1 >= 10, ('合成步进应累积盖章', s1)
    # 取证截图：痕迹铺在直升机四周的沙地上（期间真实帧还会续章，a1 在其后读）
    pg.evaluate("__dbg.orbit.tTheta=0.72; __dbg.orbit.tPhi=0.95; __dbg.orbit.tDist=26")
    # B6+：截图/像素读取前必须等相机阻尼收敛（分类器真候选 L53→L56：固定睡会取到过渡中途的视角——
    # 同 GATE-R7 hover 光池 16554 vs 307144 的实证）
    pg.wait_for_function("""() => { const o = __dbg.orbit;
        return Math.abs(o.dist - o.tDist) < 0.05 && Math.abs(o.phi - o.tPhi) < 0.005
            && Math.abs(o.theta - o.tTheta) < 0.005; }""", timeout=15000)
    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    pg.screenshot(path=H.output_path('shot_sand_tracks.jpg'), type='jpeg', quality=90)
    a1 = alpha(pg)
    assert a1 > 50, ('画布应有非零痕迹', a1)

    # 3) 衰减：封住累积门（_acc=2.0，真实帧走同门）后连打慢消退——
    #    每档 destination-out 0.02，20 档期望 ~0.67×；必须明显消退但绝非清空。
    #    随后把 strength 归零，终止真实帧续章（下文质心/重入断言需要干净场）
    pg.evaluate("__dbg.washfx.tracks._acc = 2.0")
    for _ in range(20):
        pg.evaluate("__dbg.washfx.tracks.update(3.05)")
    a2 = alpha(pg)
    assert a1 * 0.45 < a2 < a1 * 0.85, ('痕迹应缓慢消退（0.98^20≈0.67）', a1, a2)
    assert pg.evaluate("__dbg.washfx.tracks.stamps") == s1, ('消退不改写计数', s1)
    pg.evaluate("__dbg.washfx.strength = 0")

    # 4) 风向下风偏置：清空后单枚确定性盖章，alpha 加权质心应向下风偏移
    #    （画布 y 随世界 z 同向——见 WashTracks._px 换算注释）
    pg.evaluate("__dbg.washfx.tracks.clear()")
    pg.evaluate("(() => { const w = __dbg.washfx; w.tracks.stamp(0, 0, 4, 0.6, w.windX, w.windZ); })()")
    cen = pg.evaluate("""(() => { const t = __dbg.washfx.tracks;
      const d = t.cx.getImageData(0, 0, t.N, t.N).data;
      let sx = 0, sy = 0, sa = 0;
      for (let y = 0; y < t.N; y += 2) for (let x = 0; x < t.N; x += 2) {
        const a = d[(y * t.N + x) * 4 + 3];
        if (a > 0) { sx += x * a; sy += y * a; sa += a; } }
      return sa ? { cx: sx / sa, cy: sy / sa } : null; })()""")
    assert cen, ('单章后画布应有内容', cen)
    wnow = pg.evaluate("(() => ({ x: __dbg.washfx.windX, z: __dbg.washfx.windZ }))()")
    wl = math.hypot(wnow['x'], wnow['z'])
    off = ((cen['cx'] - 512) * wnow['x'] + (cen['cy'] - 512) * wnow['z']) / wl
    assert off > 10, ('痕迹质心应向下风偏移（stamp 中心 skew + 下风弧段加权）', off, wnow)

    # 5) 离开清零：切 grass 同帧读——可见性、计数、画布三归零
    g = pg.evaluate("(() => { document.querySelector('#terrain-row [data-terrain=\"grass\"]').click(); "
                    "const t = __dbg.washfx.tracks; "
                    "return { s: t.stamps, v: t.mesh.visible, a: t._acc }; })()")
    assert g['s'] == 0 and g['v'] is False and g['a'] == 0, ('离开沙漠应清零并隐藏', g)
    assert alpha(pg) == 0, ('画布应被完全清空', )

    # 6) 重复进入不继承：切回 desert 同帧读为 0，再累积则从零增长
    t6 = pg.evaluate("(() => { document.querySelector('#terrain-row [data-terrain=\"desert\"]').click(); "
                     "const t = __dbg.washfx.tracks; return { s: t.stamps, v: t.mesh.visible }; })()")
    assert t6['s'] == 0 and t6['v'] is True, ('重复进入应不继承上次痕迹', t6)
    # B6+：改为等两帧——原意是"引擎未启动，即使过了若干帧也不该有新章"，
    # 帧等待比固定睡 300ms 更贴语义且与帧率无关（分类器真候选 L97→L99）
    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    s6 = pg.evaluate("__dbg.washfx.tracks.stamps")
    assert s6 == 0, ('干净进入后（引擎未启动）不应有新章', s6)
    for _ in range(12):
        pg.evaluate("__dbg.washfx.update(0.2, 1, 2, 0, 0, __dbg.S.time)")
    pg.wait_for_function("() => __dbg.washfx.tracks.stamps >= 3", timeout=15000)
    s7 = pg.evaluate("__dbg.washfx.tracks.stamps")
    assert s7 >= 3, ('重新进入后应能重新累积', s7)

    # 收尾：切回 pad
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")


H.guarded_main(run, hard_timeout=300)
