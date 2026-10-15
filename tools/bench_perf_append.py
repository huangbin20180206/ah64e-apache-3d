# -*- coding: utf-8 -*-
# P5-B 性能采样（第 8 批 append）——不覆写 docs/perf.json 历史批次！
# bench_perf.py 是扁平结构整体覆写，交付物 perf.json 是 {'batches':[...]} 多批
# 结构（P1-D..Phase 5-A 共 7 批）——加批必须自己采样后 append（2026-09-06 教训）。
# 采样逻辑与 bench_perf.py 一致（fps=3s rAF 计数、tri/draws=400ms 累计均摊）。
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tests'))
import pw_harness as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERF = os.path.join(ROOT, 'docs', 'perf.json')

DEV = {}   # 采样时填：真实显示模式 + WebGL 后端。device 字段此前写死"有头
           # Chromium"，2026-09-17 门禁切默认无头后该字段会撒谎——而 fps 强依赖
           # 渲染后端（无头裸跑 SwiftShader 只 1.7fps，加 --use-angle=d3d11 才 58fps），
           # 跨批次比 fps 必须知道这一栏，所以改成实测写入。


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache)", timeout=60000)
    DEV['renderer'] = pg.evaluate("""() => { try { const gl = __dbg.renderer.getContext();
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; } catch (e) { return 'n/a'; } }""")
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    # 预热一轮（2026-09-17）：首个被采样的行（pad q=1）**系统性偏低约 8fps**——
    # 批 30/31 实测 pad q=1 = 51.3/52.3，而同批次紧随其后的 pad q=0.75 就是 60.3；
    # 批 26（机器空闲时）首行 60.3。原因是首轮地形渲染要付着色器编译 + 纹理上传的
    # 一次性成本，1.4s 静置窗口吸收不完。预热把这份一次性成本移出测量窗口，
    # 不改产品、也不改采样公式（仍是 3s rAF 计数）。注意：批 30/31 是**未预热**
    # 样本，与预热后的批次比首行会偏低。
    for terr in ['pad', 'grass', 'desert', 'water']:
        pg.evaluate(f"document.querySelector('#terrain-row [data-terrain=\"{terr}\"]').click()")
        pg.wait_for_timeout(700)
    rows = []
    for terr in ['pad', 'grass', 'desert', 'water']:
        for q in ['1', '0.75']:
            pg.evaluate(f"document.querySelector('#terrain-row [data-terrain=\"{terr}\"]').click()")
            pg.evaluate(f"""(()=>{{const s=document.getElementById('sel-quality');
              if(s){{s.value='{q}'; s.dispatchEvent(new Event('change',{{bubbles:true}}));}}}})()""")
            pg.wait_for_timeout(1400)
            fps = pg.evaluate("new Promise(r=>{let n=0;const t0=performance.now();"
                              "function f(){n++;if(performance.now()-t0<3000)requestAnimationFrame(f);"
                              "else r(+(n/3).toFixed(1))}requestAnimationFrame(f)})")
            info = pg.evaluate("""new Promise(res=>{
              const r=__dbg.renderer; r.info.autoReset=false; r.info.reset();
              let n=0; const t0=performance.now();
              function f(){n++; if(performance.now()-t0<400) requestAnimationFrame(f);
                else { const ir=r.info.render; r.info.autoReset=true;
                       res({tri:Math.round(ir.triangles/n), draws:Math.round(ir.calls/n)}); }}
              requestAnimationFrame(f);
            })""")
            rows.append({'terrain': terr, 'quality': q, 'fps': fps, **info})
            print('%-7s q=%-4s fps=%6.1f tri=%d draws=%d' % (terr, q, fps, info['tri'], info['draws']))
    low = [r for r in rows if r['fps'] < 30]
    with open(PERF, 'r', encoding='utf-8') as f:
        data = json.load(f)
    # P5-D+：phase/notes 允许经环境变量覆盖（历史批次写死 P5-B 文案；
    # 加批时传 APACHE_PERF_PHASE/APACHE_PERF_NOTES，避免采样后手动改 JSON）
    phase = os.environ.get('APACHE_PERF_PHASE') or 'Phase 5-B（观感收口）'
    notes = (os.environ.get('APACHE_PERF_NOTES')
             or 'P5-B 观感参数收口后采样：TERRAIN_FOG_ENV_MIX 0.35→0.6（地形雾色混合，切换事件）/ duneFar 色基=沙漠 farTint×环境明度（切换事件一次性）/ setEnvIntensity 公式 0.12+hemi×1.6（切换事件一次性）——预期 tri/draws 与 Phase 4-B/5-A 完全一致，fps 无渲染负载变化')
    batch = {
        'phase': phase,
        'measured': H.time.strftime('%Y-%m-%d %H:%M'),
        'device': 'win32 1280x800 %s Chromium / %s' % (
            '无头' if H.HEADLESS else '有头', DEV.get('renderer', 'n/a')),
        'rows': rows,
        'notes': notes,
    }
    data.setdefault('batches', []).append(batch)
    with open(PERF, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('APPENDED batch %d -> %s' % (len(data['batches']), PERF))
    if low:
        print('WARN low fps rows:', low)

H.guarded_main(run, hard_timeout=180)
print('PASS')