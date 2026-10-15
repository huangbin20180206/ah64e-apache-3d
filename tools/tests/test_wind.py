# P3-8 统一风向验证：风状态可从 __dbg 读取且连续缓变（无每帧跳变）；
# 下洗粒子 / 地面贴花 / 草场 / 湖面涟漪共用同一风向（贴花含盘面局部
# 坐标换算符号约定）；涟漪风漂精确等于 windVec×t×0.25；离水即清。
# 用法: uv run --with playwright python test_wind.py
import math

import pw_harness as H

WGET = "(() => ({ x: __dbg.washfx.windX, z: __dbg.washfx.windZ }))()"


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.washfx)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#btn-panel') && document.querySelector('#btn-panel').click()")

    # 1) 风状态存在 + 幅值域（speed 1.15 × [0.44, 1.0] 阵风波动 → [0.51, 1.15]）
    w0 = pg.evaluate(WGET)
    assert isinstance(w0['x'], (int, float)) and isinstance(w0['z'], (int, float)), ('风状态未暴露', w0)

    # 2) 连续缓变：9 采样 × 400ms——相邻步长有界（跳变=每帧随机风），
    #    全程总位移 > 0（活着在动，不是冻住的常量）
    samples = [w0]
    for _ in range(8):
        pg.wait_for_timeout(400)
        samples.append(pg.evaluate(WGET))
    for s in samples:
        m = math.hypot(s['x'], s['z'])
        assert 0.45 < m <= 1.16, ('风速应在配置波幅内', m)
    max_step = 0.0
    total = 0.0
    for a, b in zip(samples, samples[1:]):
        d = math.hypot(b['x'] - a['x'], b['z'] - a['z'])
        max_step = max(max_step, d)
        total += d
    assert max_step < 0.16, ('相邻采样跳变过大——风向应缓变', max_step)
    assert total > 0.01, ('全程无变化——风未随时间刷新', total)

    # 3) 方向共享：下洗粒子 + 地面贴花（pad 上每帧无条件更新，同帧读取比对）
    u = pg.evaluate("""(() => { const w = __dbg.washfx;
      return { wx: w.windX, wz: w.windZ,
               px: w.parts.uniforms.uWind.value.x, pz: w.parts.uniforms.uWind.value.y,
               dx: w.decal.uniforms.uWind.value.x, dz: w.decal.uniforms.uWind.value.y }; })()""")
    assert abs(u['px'] - u['wx']) < 1e-6 and abs(u['pz'] - u['wz']) < 1e-6, ('下洗粒子 uWind 应等于风向量', u)
    # 贴花盘面局部坐标：局部 y = -世界 z（22-washdecal.js 换算约定）
    assert abs(u['dx'] - u['wx']) < 1e-6 and abs(u['dz'] + u['wz']) < 1e-6, ('贴花 uWind 应为盘面局部风向量', u)

    # 4) 草场接线：grass.mesh.visible 才会 update，切 grass 后等一帧再读
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"grass\"]').click()")
    pg.wait_for_timeout(400)
    g = pg.evaluate("""(() => { const w = __dbg.washfx, u = w.grass.uniforms.uWindDir.value;
      const wl = Math.hypot(w.windX, w.windZ);
      return { wx: w.windX, wz: w.windZ, ux: u.x, uy: u.y,
               i: w.grass.uniforms.uWindI.value, wl }; })()""")
    assert abs(g['ux'] - g['wx'] / g['wl']) < 1e-5, ('草场 uWindDir 应为单位风向', g)
    assert abs(g['uy'] - g['wz'] / g['wl']) < 1e-5, ('草场 uWindDir 应为单位风向', g)
    assert abs(g['i'] - min(1, g['wl'] / 0.9)) < 1e-5, ('草场 uWindI 应为归一化风强', g)

    # 5) 湖面涟漪风漂：合成步进刷活环（真实引擎关着也能驱动 update，
    #    spin=1/alt=2 满足涟漪出生门 s>0.12 && alt<9），断言环位移精确
    #    等于 windVec × t × 0.25（23-washmedia 波环随风漂公式）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(400)
    for _ in range(30):
        pg.evaluate("__dbg.washfx.update(0.2, 1, 2, 0, 0, __dbg.S.time)")
    pg.wait_for_timeout(150)
    ring = pg.evaluate("""(() => { const p = __dbg.washfx.ripples.pool;
      for (const r of p) if (r.life > 0) return { x: r.x, z: r.z, mx: r.m.position.x, mz: r.m.position.z, t: r.t };
      return null; })()""")
    assert ring, ('合成步进应刷出活环', ring)
    wnow = pg.evaluate(WGET)
    ex_x = wnow['x'] * ring['t'] * 0.25
    ex_z = wnow['z'] * ring['t'] * 0.25
    assert abs(ring['mx'] - ring['x'] - ex_x) < 0.02, ('涟漪风漂 X 应等于 windVec×t×0.25', ring, wnow)
    assert abs(ring['mz'] - ring['z'] - ex_z) < 0.02, ('涟漪风漂 Z 应等于 windVec×t×0.25', ring, wnow)

    # 6) 切回 pad：涟漪必须清空（离开所属场地的成对清理）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    pg.wait_for_timeout(400)
    st = pg.evaluate("({ alive: __dbg.washfx.ripples.alive })")
    assert st['alive'] == 0, ('切离水面涟漪应清空', st)


H.guarded_main(run, hard_timeout=300)
