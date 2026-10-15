# -*- coding: utf-8 -*-
# probe_perf.py — PERF-AUDIT 各项"改之前 vs 改之后"统一验证探针（playwright）
# 用法： uv run --with playwright python tools/probe_perf.py http://localhost:9410 out.json
# baseline（基线构建）与本批构建各跑一遍，对比 JSON 即闭环。
# 四段：draws（四场地每帧 draw 数 + water 逐模块归因）/ alloc（构造器分配计数）/
# dom（样式写计数，labels 开启）/ paint（长任务 + 加载关键节点）。
# 口径：draws 用 autoReset=false 跨 400ms 累积 ÷ rAF 帧数 = 每帧 draw
#（bench_perf 既有方法）；悬停一律 FLY.fp=true 让位（沉浮 sin 相位不污染）。
import json
import sys

from playwright.sync_api import sync_playwright

TERMS = [('pad', 'day'), ('grass', 'day'), ('desert', 'day'), ('water', 'day')]
SETUP_HOVER = """(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
  F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; F.fp=true;
  __dbg.S._alt=0; __dbg.S.running=true; __dbg.S._guide=0;
  const o=__dbg.orbit; o.tTheta=0.9; o.tPhi=1.25; o.tDist=64; o.auto=false; })()"""


def measure_frames(pg, ms=400):
    """autoReset=false 累积 ms 毫秒，返回 (每帧 draw 数, 每帧三角面)。"""
    return pg.evaluate("""(ms) => new Promise(res => {
      const r = __dbg.renderer, S = __dbg.S;
      let frames = 0;
      const tick = () => { frames++; if (frames < 1e9) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      r.info.autoReset = false; r.info.reset();
      setTimeout(() => {
        const calls = r.info.render.calls / Math.max(1, frames);
        const tris = r.info.render.triangles / Math.max(1, frames);
        cancelAnimationFrame && 0; r.info.autoReset = true;
        res({ calls: +calls.toFixed(1), tris: Math.round(tris), frames });
      }, ms); })()""", ms)


def run(url, out_path):
    result = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=[
            '--use-angle=d3d11',
            '--disable-backgrounding-occluded-windows',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion'])
        pg = browser.new_page(viewport={'width': 1280, 'height': 800})
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(url + '/?nocine=1&nocut=1', wait_until='domcontentloaded')
        pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.samwar)", timeout=60000)
        pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")

        # ---- ① draws：四场地同机位每帧 draw ----
        result['draws'] = {}
        for terrain, env in TERMS:
            pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"%s\"]').click()" % terrain)
            pg.evaluate(SETUP_HOVER)
            pg.wait_for_timeout(1500)   # 场地切换稳定（贴图/倒影/介质）
            result['draws'][terrain] = measure_frames(pg)

        # ---- ①b water 归因：逐模块 layers.disable 差分（自然渲染累积）----
        pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
        pg.evaluate(SETUP_HOVER)
        pg.wait_for_timeout(1200)
        result['draw_breakdown'] = pg.evaluate("""() => {
          const mods = {};
          const probe = (name, objs) => new Promise(res => {
            let frames = 0;
            const tick = () => { frames++; requestAnimationFrame(tick); };
            const r = __dbg.renderer;
            requestAnimationFrame(tick);
            r.info.autoReset = false; r.info.reset();
            objs.forEach(o => o.layers.disable(0));
            setTimeout(() => {
              const calls = r.info.render.calls / Math.max(1, frames);
              objs.forEach(o => o.layers.enable(0));
              r.info.autoReset = true;
              res({ calls: +calls.toFixed(1), frames });
            }, 400);
          });
          return (async () => {
            mods.baseline = await probe('baseline', []);
            const tg = __dbg.targets.targets.map(t => t.group);
            mods.targets_off = await probe('targets', tg);
            mods.mirror_off = await probe('mirror', [__dbg.refl.group]);
            mods.narrative_off = __dbg.narrative ? await probe('narrative', [__dbg.narrative.root || __dbg.narrative.g]) : null;
            return mods;
          })(); })()""")

        # ---- ② alloc：构造器分配计数（悬停 8s / 连发 3s / 拖拽 150 事件）----
        pg.evaluate("""(() => {
          window.__vc = { V3: 0, Q: 0, C: 0 };
          const wrap = (cls, key) => { const o = THREE[cls]; const f = function (...a) {
            window.__vc[key]++; return new o(...a); };
            Object.setPrototypeOf(f, o); f.prototype = o.prototype; THREE[cls] = f; };
          wrap('Vector3', 'V3'); wrap('Quaternion', 'Q'); wrap('Color', 'C'); })()""")
        pg.wait_for_timeout(8000)
        hover = pg.evaluate("window.__vc")
        pg.evaluate("window.__vc = { V3: 0, Q: 0, C: 0 }; __dbg.rig.gunOn = true; __dbg.rig.rocketOn = true;")
        pg.wait_for_timeout(3000)
        pg.evaluate("__dbg.rig.gunOn = false; __dbg.rig.rocketOn = false;")
        burst = pg.evaluate("window.__vc")
        pg.evaluate("window.__vc = { V3: 0, Q: 0, C: 0 }")
        pg.evaluate("""(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
          for (let i = 0; i < 150; i++) {
            c.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse',
              clientX: r.left + 200 + Math.sin(i * 0.3) * 120, clientY: r.top + 200 + Math.cos(i * 0.3) * 90 }));
          } })()""")
        drag = pg.evaluate("window.__vc")
        result['alloc'] = {'hover_8s': hover, 'burst_3s': burst, 'drag_150moves': drag}

        # ---- ③ dom：#labels / #hud 子树样式写计数（labels 开启 + 静止相机 6s）----
        result['dom'] = pg.evaluate("""(() => new Promise(res => {
          const cnt = { labels: 0, hud: 0, frames: 0 };
          const el = document.querySelector('#labels');
          el.style.display = 'block'; __dbg.S.labels = true;
          const tick = () => { cnt.frames++; requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          for (const [sel, key] of [['#labels', 'labels'], ['#hud', 'hud']]) {
            const t = document.querySelector(sel); if (!t) continue;
            new MutationObserver(ms => { cnt[key] += ms.length; })
              .observe(t, { subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
          }
          setTimeout(() => { __dbg.S.labels = false; el.style.display = 'none';
            res(JSON.parse(JSON.stringify(cnt))); }, 6000); })()""")

        # ---- ④ paint：长任务 + 加载关键节点 ----
        result['paint'] = pg.evaluate("""(() => {
          const lt = [];
          new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); })
            .observe({ entryTypes: ['longtask'] });
          const nav = performance.getEntriesByType('navigation')[0] || {};
          return new Promise(res => setTimeout(() =>
            res({ longtasks: lt, domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
                  load: Math.round(nav.loadEventEnd || 0) }), 3000)); })()""")

        result['pageerrors'] = errors
        browser.close()
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print('probe_perf ->', out_path)
    print(json.dumps(result['draws'], ensure_ascii=False))


if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:9410',
        sys.argv[2] if len(sys.argv) > 2 else 'probe_out.json')
