"""起降全链路功能验证（通过 tools/tests/pw_harness 统一托管）。
关注点：下洗强度随起飞/降落的升降、brownout 雾在往复起降后是否漂移。
用法：uv run --with playwright python tools/verify_flow.py
"""
import sys
from pathlib import Path

TEST_DIR = Path(__file__).resolve().parent / 'tests'
sys.path.insert(0, str(TEST_DIR))
import pw_harness as H


def run(page):
    page.wait_for_function("() => !!window.__dbg && !!window.__dbg.washfx", timeout=60000)

    def snap():
        return page.evaluate("""() => {
          const d = __dbg;
          return {
            state: d.FLY.state,
            alt: +d.FLY.alt.toFixed(2),
            spin: +d.S.spin.toFixed(3),
            wash: +d.washfx.strength.toFixed(3),
            fogNow: +d.W.scene.fog.density.toFixed(6),
            fogBase: +d.W.fogBase.d.toFixed(6),
            running: d.S.running,
          };
        }""")

    page.evaluate("document.querySelector('#hint-close')?.click()")
    # 注意：这里【不能】收起面板。本脚本用 page.click() 走真实鼠标路径（比
    # evaluate 里的 .click() 更接近用户操作，能验证命中区域与指针事件），而
    # #panel.hide 会把面板 translateX 移出视口并 pointer-events:none，
    # Playwright 会以 "element is outside of the viewport" 一直重试到超时。
    # 其余截图型测试收面板是为了画面干净，它们走的是 DOM 层 .click()，不受影响。
    page.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]')?.click()")
    print("boot:", page.evaluate("({terrain: __dbg.W.terrainKey, medium: __dbg.washfx.medium})"))

    # 停转状态下不许起飞
    page.click("#btn-fly")
    page.wait_for_timeout(300)
    assert snap()['state'] == 'ground'
    print("reject takeoff (engine off):", snap()['state'])

    # 启动旋翼，等转速到 92%
    page.click("#btn-start")
    page.wait_for_function("() => window.__dbg.S.spin >= 0.92", timeout=30000)
    print("ground idle:", snap())

    # 起飞
    page.click("#btn-fly")
    page.wait_for_function("() => window.__dbg.FLY.state === 'up'", timeout=5000)
    page.wait_for_timeout(900)
    print("just airborne:", snap())

    # 空中禁止关停发动机
    page.click("#btn-start")
    page.wait_for_timeout(200)
    assert snap()['running'] is True
    print("in-flight shutdown blocked:", snap()['running'])

    page.wait_for_function("() => window.__dbg.FLY.state === 'hover'", timeout=30000)
    page.wait_for_timeout(1500)
    print("hover (wash should be ~0):", snap())

    # 降落
    page.click("#btn-fly")
    page.wait_for_function("() => window.__dbg.FLY.state === 'ground'", timeout=40000)
    page.wait_for_timeout(2500)
    print("touchdown:", snap())

    # 再来一轮，检查雾密度是否累积漂移
    page.click("#btn-fly")
    page.wait_for_function("() => window.__dbg.FLY.state === 'hover'", timeout=30000)
    page.click("#btn-fly")
    page.wait_for_function("() => window.__dbg.FLY.state === 'ground'", timeout=40000)
    page.wait_for_timeout(1500)
    print("round2 touchdown:", snap())

    # 关停旋翼：下洗归零后，雾必须完全回到基准
    page.click("#btn-start")
    page.wait_for_function("() => window.__dbg.washfx.strength < 0.002", timeout=40000)
    page.wait_for_timeout(1200)
    fin = snap()
    drift = abs(fin['fogNow'] - fin['fogBase'])
    print("rotor off:", fin)
    print("fog drift = %.6f (%s)" % (drift, 'OK' if drift < 3e-5 else 'DRIFT!'))
    assert drift < 3e-5


H.guarded_main(run, hard_timeout=300)
