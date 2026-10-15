# 演示视频录制（定稿专用）——【重要约定】只在项目定稿后运行，大改即作废重录
# 开场环绕 → 一键导览全程 → 黄昏湖面收尾 → 草地起飞
# 硬门控（上一版教训：旧模型+报错画面照录不误，全部作废）：
#   ① console/pageerror 任何报错 → 立即中止，退出码 1（绝不带病录制）
#   ② 三个靶标 GLB 未就位 → 拒绝开录（防止录到程序化兜底旧模型）
# 产出 docs/demo/*.webm（有 ffmpeg 时另转 mp4）
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tests'))
import pw_harness as H

H.kill_stale_pw_chromium()
from playwright.sync_api import sync_playwright

OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'demo'))
os.makedirs(OUT, exist_ok=True)

errors = []
_stage = ['init']

with sync_playwright() as p:
    b = p.chromium.launch(headless=False, args=[
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling', '--window-position=60,40', '--window-size=1300,760'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720},
                        record_video_dir=OUT, record_video_size={'width': 1280, 'height': 720})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append('pageerror@%s: %s' % (_stage[0], e)))
    pg.on('console', lambda m: errors.append('console@%s: %s' % (_stage[0], m.text)) if m.type == 'error' else None)

    def gate(stage):
        """每个阶段结束都检查：有报错立即报废本轮录制"""
        _stage[0] = stage
        if errors:
            ctx.close(); b.close()
            raise SystemExit('RECORD ABORTED at %s: %s' % (stage, errors[:3]))

    pg.goto('http://localhost:8642', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && document.getElementById('btn-tour'))", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")

    # 门控②：靶标 GLB 就位检查（truck/tank 贴图网格 + 空中靶机）
    pg.wait_for_timeout(3500)
    ready = pg.evaluate("""(()=>{
      const ok=(g)=>{let t=0;g.traverse(o=>{if(o.isMesh&&o.material&&o.material.map)t++});return t>0;};
      const ts=__dbg.targets.targets;
      const tr=ts.find(t=>t.type==='truck'),tk=ts.find(t=>t.type==='tank');
      const pl=(__dbg.air?__dbg.air.list:[]).find(t=>t.type==='plane');
      return {truck:tr?ok(tr.group):false,tank:tk?ok(tk.group):false,plane:pl?ok(pl.g):false};
    })()""")
    if not all(ready.values()):
        ctx.close(); b.close()
        raise SystemExit('MODELS NOT READY (procedural fallback would be recorded): %s' % ready)
    gate('models-ready')

    pg.wait_for_timeout(6000)                       # 开场环绕
    gate('intro')
    pg.click('#btn-tour')                            # 一键导览（~53s）
    pg.wait_for_timeout(56000)
    gate('tour')
    # 收尾镜头：黄昏湖面 → 草地起飞
    pg.evaluate("document.querySelector('#env-row [data-env=\"dusk\"]').click()")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.evaluate("__dbg.orbit.tPhi=1.25; __dbg.orbit.tDist=18")
    pg.wait_for_timeout(8000)
    gate('dusk-water')
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"grass\"]').click()")
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.keyboard.press('Space')
    pg.wait_for_timeout(4000)
    gate('grass-spinup')
    pg.keyboard.press('KeyT')
    pg.wait_for_timeout(9000)
    gate('takeoff')
    ctx.close()
    b.close()
print('video saved to', OUT)
print('RECORD OK, zero console/page errors')
