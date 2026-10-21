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
            # 2026-10-21：平均帧率会掩盖卡顿长尾 → 同一段 3 秒里记录每帧间隔，
            # 输出 p50/p95/p99/最长单帧（毫秒）与 JS 堆峰值（MB，仅 Chromium 有）
            ft = pg.evaluate("""new Promise(r=>{const d=[];let last=performance.now(),heap=0;const t0=last;
              function f(now){d.push(now-last);last=now;
                if(performance.memory) heap=Math.max(heap,performance.memory.usedJSHeapSize);
                if(now-t0<3000) requestAnimationFrame(f);
                else { d.shift(); const s=d.slice().sort((a,b)=>a-b);
                  const q=p=>+s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(1);
                  r({fps:+(d.length/((now-t0)/1000)).toFixed(1), p50:q(0.5), p95:q(0.95), p99:q(0.99),
                     maxMs:+s[s.length-1].toFixed(1), heapMB:+(heap/1048576).toFixed(0)}); } }
              requestAnimationFrame(f)})""")
            fps = ft.pop('fps')
            info = pg.evaluate("""new Promise(res=>{
              const r=__dbg.renderer; r.info.autoReset=false; r.info.reset();
              let n=0; const t0=performance.now();
              function f(){n++; if(performance.now()-t0<400) requestAnimationFrame(f);
                else { const ir=r.info.render; r.info.autoReset=true;
                       res({tri:Math.round(ir.triangles/n), draws:Math.round(ir.calls/n)}); }}
              requestAnimationFrame(f);
            })""")
            rows.append({'terrain': terr, 'quality': q, 'fps': fps, **ft, **info})
            print('%-7s q=%-4s fps=%6.1f p95=%5.1fms p99=%5.1fms max=%5.1fms tri=%d draws=%d' % (terr, q, fps, ft['p95'], ft['p99'], ft['maxMs'], info['tri'], info['draws']))
    low = [r for r in rows if r['fps'] < 30]
    # 输出路径：tools/ 的上一级才是仓库根（此前多写了一层 '..'，文件一直
    # 落到仓库外的 Kyle_Projects\docs\perf.json——"从未产出 docs/perf.json"的根因）
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, 'perf.json')
    # 保留历史批次（最近 20 次），方便对比"这次改动有没有让卡顿变多"
    hist = []
    try:
        with open(path, encoding='utf-8') as f:
            old = json.load(f)
        hist = old.get('history', [])
        if old.get('rows'):
            hist.append({'measured': old.get('measured'), 'rows': old['rows']})
    except Exception:
        pass
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'measured': H.time.strftime('%Y-%m-%d %H:%M'), 'device': 'win32 1280x800 有头 Chromium',
                   'rows': rows, 'history': hist[-20:]}, f, ensure_ascii=False, indent=1)
    # 卡顿告警：p95 帧时长超过 33ms（=低于 30fps 的那 5% 帧）或单帧超过 100ms
    jank = [r for r in rows if r.get('p95', 0) > 33.4 or r.get('maxMs', 0) > 100]
    if jank:
        print('WARN jank rows:', [(r['terrain'], r['quality'], r['p95'], r['maxMs']) for r in jank])
    if low:
        print('WARN low fps rows:', low)

H.guarded_main(run, hard_timeout=180)
print('PASS')
