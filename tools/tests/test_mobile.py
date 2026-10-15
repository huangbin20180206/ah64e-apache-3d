# 移动端触控验证（390×844 竖屏 + hasTouch + is_mobile）：
# 面板开关点按 / 环境芯片点按 / 导览按钮避让视角条 / 无 JS 错误
# 不用 guarded_main（需要移动设备仿真上下文），自管浏览器生命周期，
# 但补齐同等可靠性保护：看门狗硬超时 / 结果落盘 last_result.json / 错误收集
import sys, os, json, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

errors = []
from playwright.sync_api import sync_playwright

# 看门狗：180s 硬超时（与 guarded_main 等价）
def _watchdog():
    H._write_result('FAIL', 'mobile watchdog timeout (180s)', skipped=True)
    print('RESULT FAIL reason=mobile watchdog timeout', flush=True)
    os._exit(3)
_wd = threading.Timer(180, _watchdog)
_wd.start()
from playwright.sync_api import sync_playwright

try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=H.HEADLESS, args=H.browser_args())
        pg = b.new_page(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
        pg.on('console', lambda m: errors.append('console.error: %s' % m.text) if m.type == 'error' else None)
        try:
            pg.goto(H.BASE + '/?nocine=1', wait_until='domcontentloaded')
            pg.wait_for_function("() => !!(window.__dbg && __dbg.apache)", timeout=60000)
            pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
            pg.wait_for_timeout(600)

            assert pg.evaluate("matchMedia('(max-width:820px)').matches"), 'mobile media'
            # 导览按钮已并入右上角图标排（不再有底部重叠问题）
            btn = pg.evaluate("(()=>{const b=document.getElementById('btn-tour');const r=b.getBoundingClientRect();"
                              "return {top:+r.top.toFixed(0),inHost:!!b.closest('#top-right')}})()")
            assert btn['inHost'] and btn['top'] < 80, ('tour btn not in top icon row', btn)
            # 面板默认关闭——先 tap 打开，断言它确实进视口（真触控链路）
            open0 = pg.evaluate("(()=>{const p=document.getElementById('panel');"
                                "const r=p.getBoundingClientRect();return {visible:r.width>0&&r.left>=0&&r.left<innerWidth}})()")
            if not open0['visible']:
                pg.tap('#btn-panel'); pg.wait_for_timeout(600)
            open1 = pg.evaluate("(()=>{const p=document.getElementById('panel');"
                                "const r=p.getBoundingClientRect();return {left:+r.left.toFixed(0),w:+r.width.toFixed(0)}})()")
            assert 0 <= open1['left'] < 390, ('panel not in viewport after tap', open1)
            # 芯片点按（触控）
            pg.tap('#env-row [data-env="night"]'); pg.wait_for_timeout(900)
            assert pg.evaluate("__dbg.S.env") == 'night', 'env chip tap'
            # —— P2-B1：双指捏合缩放——CDP 真实触控事件走完整 pointer 链 ——
            # 前置：清掉首访三步引导（新 profile 必显示）+ 关闭面板——
            # 用直接赋值而非合成事件（既有教训：合成 pointerdown 会触发
            # setPointerCapture 异常）；390px 窄视口下面板开着会拦截 canvas
            # 触点，elementFromPoint 自守卫确保触点真正落在 canvas 上。
            pg.evaluate("__dbg.S._guide = 0")
            pg.evaluate("document.getElementById('btn-panel').click()")
            pg.wait_for_timeout(400)
            hit = pg.evaluate("document.elementFromPoint(100, 500).id")
            assert hit == 'gl', ('pinch 触点被面板/UI 拦截', hit)
            cdp = pg.context.new_cdp_session(pg)
            d0 = pg.evaluate("({dist: __dbg.orbit.dist, tDist: __dbg.orbit.tDist})")
            # 双指按下（间距 70px）→ Orbit 双指 pointerdown 后 _pinch=70
            cdp.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[
                {'x': 100, 'y': 500, 'id': 1}, {'x': 170, 'y': 500, 'id': 2}]))
            pg.wait_for_timeout(120)
            # 两指捏拢（间距 20px）→ zoom(70/20=3.5)，tDist 拉远（clamp 90 内）
            cdp.send('Input.dispatchTouchEvent', dict(type='touchMove', touchPoints=[
                {'x': 125, 'y': 500, 'id': 1}, {'x': 145, 'y': 500, 'id': 2}]))
            pg.wait_for_timeout(120)
            cdp.send('Input.dispatchTouchEvent', dict(type='touchEnd', touchPoints=[]))
            # B6+：orbit.dist 由 50-controls.js:133/141 updater 每帧以 damping 逼近 tDist
            # ——等两个量各自达标再断言，替代固定睡 900ms（分类器真候选 L70→L72/L73）
            pg.wait_for_function("(t0) => __dbg.orbit.tDist > t0 * 1.4", arg=d0['tDist'], timeout=15000)
            pg.wait_for_function("(d0) => __dbg.orbit.dist > d0 * 1.15", arg=d0['dist'], timeout=15000)
            d1 = pg.evaluate("({dist: __dbg.orbit.dist, tDist: __dbg.orbit.tDist})")
            assert d1['tDist'] > d0['tDist'] * 1.4, ('pinch tDist not zoomed', d0, d1)
            assert d1['dist'] > d0['dist'] * 1.15, ('pinch dist not zoomed', d0, d1)
            print('pinch zoom OK: dist %.1f -> %.1f (tDist %.1f -> %.1f)'
                  % (d0['dist'], d1['dist'], d0['tDist'], d1['tDist']))
            pg.screenshot(path=H.output_path('shot_mobile.jpg'), type='jpeg', quality=88)
            print('mobile OK: btn bottom=%s, env=night via tap' % btn)
        finally:
            b.close()
except Exception as e:
    errors.append('fatal: %s: %s' % (type(e).__name__, e))
    _wd.cancel()
    H._write_result('FAIL', str(errors[-1]) if errors else str(e))
    raise SystemExit('RESULT FAIL reason=%s' % errors[-1])
_wd.cancel()
if errors:
    H._write_result('FAIL', str(errors[:2]))
    raise SystemExit('RESULT FAIL reason=%s' % errors[:2])
H._write_result('PASS', 'mobile taps OK')
print('RESULT PASS')
