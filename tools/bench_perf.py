# 性能基准：场地×画质 的实测帧率 + 渲染统计，输出 docs/perf.json
# 用于参赛技术文档的性能章节；也当回归——任何一档跌破 30fps 即告警
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tests'))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
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
    # 输出路径：tools/ 的上一级才是仓库根（此前多写了一层 '..'，文件一直
    # 落到仓库外的 Kyle_Projects\docs\perf.json——"从未产出 docs/perf.json"的根因）
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'perf.json'), 'w', encoding='utf-8') as f:
        json.dump({'measured': H.time.strftime('%Y-%m-%d %H:%M'), 'device': 'win32 1280x800 有头 Chromium', 'rows': rows},
                  f, ensure_ascii=False, indent=1)
    if low:
        print('WARN low fps rows:', low)

H.guarded_main(run, hard_timeout=180)
print('PASS')
