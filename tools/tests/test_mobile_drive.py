# P4-A 移动端虚拟驾驶验证（390×844 竖屏 + hasTouch + is_mobile）：
# 摇杆可见性（面板开隐/关显）/ 单指拖动方向与有界幅度 / 松手归中 /
# 两指分控双摇杆不串线 / touchCancel 与 blur 归零 / 触控驱动 FLY 真状态
# （z/x 平移、userAlt 升降、yaw 偏航）/ FPV 模式隐藏与退出同步 /
# 右摇杆键盘降级（↑↓ 升降且不串平移键）/ 零未预期报错。
# 自管浏览器生命周期（移动仿真上下文），带看门狗硬超时与结果落盘。
import sys, os, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

errors = []
from playwright.sync_api import sync_playwright

def _watchdog():
    H._write_result('FAIL', 'mobile-drive watchdog timeout (300s)', skipped=True)
    print('RESULT FAIL reason=mobile-drive watchdog timeout', flush=True)
    os._exit(3)
_wd = threading.Timer(300, _watchdog)
_wd.start()

LX, LY = 70, 684          # 左摇杆中心（390×844：left:14 bottom:104 → y=844-104-56）
RX, RY = 320, 684         # 右摇杆中心

try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=H.HEADLESS, args=H.browser_args())
        pg = b.new_page(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
        pg.on('console', lambda m: errors.append('console.error: %s' % m.text) if m.type == 'error' else None)
        try:
            pg.goto(H.BASE + '/?nocine=1', wait_until='domcontentloaded')
            pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.mobile)", timeout=60000)
            pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
            pg.wait_for_timeout(500)

            # A) 可见性：面板默认开（无 .hide）→ 摇杆隐藏；关面板 → 可见且在视口内
            d0 = pg.evaluate("getComputedStyle(document.getElementById('mstick')).display")
            assert d0 == 'none', ('面板打开时摇杆应隐藏', d0)
            pg.evaluate("document.getElementById('btn-panel').click()")
            pg.wait_for_function("() => getComputedStyle(document.getElementById('mstick')).display === 'block'", timeout=5000)   # B5：显隐经 MutationObserver 异步——条件等待
            v = pg.evaluate("""(() => { const r = document.getElementById('mstick-l').getBoundingClientRect();
              return { disp: getComputedStyle(document.getElementById('mstick')).display,
                       inVp: r.left >= 0 && r.right <= 390 && r.top >= 0 && r.bottom <= 844 && r.width > 100 } })()""")
            assert v['disp'] == 'block' and v['inVp'], ('关面板后摇杆应可见且在视口内', v)

            # 前置：强制悬停（引擎运行、非 FPV、yaw=0、位置归零、userAlt 未接管）
            pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                        "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.FLY.userAlt=null; "
                        "__dbg.S._alt=0; __dbg.S.running=true")
            pg.wait_for_timeout(300)
            cdp = pg.context.new_cdp_session(pg)

            # B) 单指拖左摇杆向上：FLY.z 前进 + 遥测 arrowup + knob 有界（钳到 R=34）
            cdp.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[{'x': LX, 'y': LY, 'id': 1}]))
            cdp.send('Input.dispatchTouchEvent', dict(type='touchMove', touchPoints=[{'x': LX, 'y': LY - 80, 'id': 1}]))
            # B5：触控驱动位移是 loop 每帧派生——保持拖动到位移达标（固定 700ms 低帧下不足）
            pg.wait_for_function("() => __dbg.FLY.z > 3 && __dbg.mobile.state().l.on.includes('arrowup')", timeout=15000)
            s1 = pg.evaluate("(() => ({ z: +__dbg.FLY.z.toFixed(1), x: +__dbg.FLY.x.toFixed(1), "
                             "te: __dbg.mobile.state().l, }))()")
            assert s1['z'] >= 3 and s1['x'] < 1, ('左摇杆上拖应前进 +Z', s1)   # B5：toFixed(1) 口径——wait 过后取整可能恰 3.0
            assert s1['te']['on'] == ['arrowup'], ('遥测应记录 arrowup', s1)
            assert s1['te']['y'] >= -34.01 and s1['te']['y'] <= -11, ('knob 偏移应钳制在半径内', s1)
            # 松手归中 + 平移停止（touchEnd 事件同步归中——条件等待）
            z_held = s1['z']
            cdp.send('Input.dispatchTouchEvent', dict(type='touchEnd', touchPoints=[]))
            pg.wait_for_function("() => { const t = __dbg.mobile.state().l; return t.on.length === 0 && t.x === 0 && t.y === 0; }", timeout=5000)
            s2 = pg.evaluate("(() => ({ z: +__dbg.FLY.z.toFixed(1), te: __dbg.mobile.state().l }))()")
            assert s2['te']['on'] == [] and s2['te']['x'] == 0 and s2['te']['y'] == 0, ('松手应归中', s2)
            assert s2['z'] - z_held < 0.6, ('松手后平移应停止', z_held, s2)
            print('left stick forward OK: z=%.1f knob y=%.0f; release zeroed' % (s1['z'], s1['te']['y']))

            # C) 左摇杆右拖：yaw=0 时机体右 = -X
            pg.evaluate("__dbg.FLY.x=0")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[{'x': LX, 'y': LY, 'id': 1}]))
            cdp.send('Input.dispatchTouchEvent', dict(type='touchMove', touchPoints=[{'x': LX + 60, 'y': LY, 'id': 1}]))
            pg.wait_for_function("() => __dbg.FLY.x < -2 && __dbg.mobile.state().l.on.includes('arrowright')", timeout=15000)
            s3 = pg.evaluate("(() => ({ x: +__dbg.FLY.x.toFixed(1), on: __dbg.mobile.state().l.on }))()")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchEnd', touchPoints=[]))
            assert s3['x'] <= -2, ('左摇杆右拖应向 -X 侧移', s3)   # toFixed(1) 口径
            assert 'arrowright' in s3['on'], ('遥测应记录 arrowright', s3)
            pg.wait_for_function("() => __dbg.mobile.state().l.on.length === 0", timeout=5000)

            # D) 右摇杆下拖：userAlt 接管并下降，FLY.alt 同步跟随；释放后高度保持
            pg.evaluate("__dbg.FLY.yaw=0")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[{'x': RX, 'y': RY, 'id': 1}]))
            cdp.send('Input.dispatchTouchEvent', dict(type='touchMove', touchPoints=[{'x': RX, 'y': RY + 40, 'id': 1}]))
            pg.wait_for_function("() => __dbg.FLY.userAlt !== null && __dbg.FLY.userAlt < 13.5", timeout=15000)   # B5：条件等待接管生效
            s4 = pg.evaluate("(() => ({ ua: __dbg.FLY.userAlt, alt: +__dbg.FLY.alt.toFixed(1) }))()")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchEnd', touchPoints=[]))
            pg.wait_for_function("() => __dbg.FLY.userAlt === %s" % s4['ua'], timeout=5000)   # 释放后保持（同步钉住）
            s5 = pg.evaluate("(() => ({ ua: __dbg.FLY.userAlt, alt: +__dbg.FLY.alt.toFixed(1) }))()")
            assert s4['ua'] is not None and s4['ua'] < 13.5, ('右摇杆下拖应接管并降低高度', s4)
            assert abs(s4['alt'] - s4['ua']) < 0.3, ('FLY.alt 应跟随 userAlt', s4)
            assert abs(s5['ua'] - s4['ua']) < 1e-6, ('释放后 userAlt 应保持（悬停钉住）', s4, s5)
            print('right stick descend OK: userAlt %.2f held' % s5['ua'])

            # E) 右摇杆左拖：keys a → FLY.yaw 左转增大
            pg.evaluate("__dbg.FLY.yaw=0")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[{'x': RX, 'y': RY, 'id': 1}]))
            cdp.send('Input.dispatchTouchEvent', dict(type='touchMove', touchPoints=[{'x': RX - 50, 'y': RY, 'id': 1}]))
            pg.wait_for_function("() => __dbg.FLY.yaw > 0.3 && __dbg.mobile.state().r.on.includes('a')", timeout=15000)
            yaw = pg.evaluate("+__dbg.FLY.yaw.toFixed(2)")
            on = pg.evaluate("__dbg.mobile.state().r.on")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchEnd', touchPoints=[]))
            assert yaw >= 0.3, ('右摇杆左拖应左转（yaw 增）', yaw)   # toFixed(2) 口径
            assert 'a' in on, ('遥测应记录 a', on)
            pg.wait_for_function("() => __dbg.mobile.state().r.on.length === 0", timeout=5000)

            # F) 两指分控双摇杆不串线：指 1 左摇杆上拖 + 指 2 右摇杆下拖同时成立
            pg.evaluate("__dbg.FLY.z=0; __dbg.FLY.userAlt=null")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[
                {'x': LX, 'y': LY, 'id': 1}, {'x': RX, 'y': RY, 'id': 2}]))
            cdp.send('Input.dispatchTouchEvent', dict(type='touchMove', touchPoints=[
                {'x': LX, 'y': LY - 60, 'id': 1}, {'x': RX, 'y': RY + 34, 'id': 2}]))
            pg.wait_for_function("() => __dbg.FLY.z > 2.5 && __dbg.FLY.userAlt !== null && __dbg.FLY.userAlt < 13.8", timeout=15000)   # B5：双通道同时达标
            s6 = pg.evaluate("(() => ({ z: +__dbg.FLY.z.toFixed(1), ua: __dbg.FLY.userAlt, "
                             "lo: __dbg.mobile.state().l.on, ro: __dbg.mobile.state().r.on }))()")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchEnd', touchPoints=[]))
            assert s6['z'] >= 2.5, ('双指时左摇杆应仍驱动前进', s6)   # toFixed(1) 口径
            assert s6['ua'] is not None and s6['ua'] < 13.8, ('双指时右摇杆应仍驱动降高', s6)
            assert s6['lo'] == ['arrowup'] and s6['ro'] == [], ('两摇杆遥测应各自独立（右为纯竖拖无键）', s6)
            pg.wait_for_function("() => { const t = __dbg.mobile.state(); return t.l.on.length === 0 && t.r.on.length === 0; }", timeout=5000)
            zero = pg.evaluate("(() => { const t = __dbg.mobile.state(); "
                               "return t.l.on.length === 0 && t.r.on.length === 0 })()")
            assert zero, '双指释放后两摇杆都应归零'
            print('two-finger isolation OK: z=%.1f userAlt=%s' % (s6['z'], s6['ua']))

            # G) touchCancel：拖动中取消 → 全部输入归零
            cdp.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[{'x': LX, 'y': LY, 'id': 1}]))
            cdp.send('Input.dispatchTouchEvent', dict(type='touchMove', touchPoints=[{'x': LX, 'y': LY - 40, 'id': 1}]))
            pg.wait_for_function("() => __dbg.mobile.state().l.on.length > 0", timeout=5000)
            held = pg.evaluate("__dbg.mobile.state().l.on.length > 0")
            cdp.send('Input.dispatchTouchEvent', dict(type='touchCancel', touchPoints=[]))
            pg.wait_for_function("() => { const t = __dbg.mobile.state(); return t.l.on.length === 0 && t.l.y === 0; }", timeout=5000)
            cz = pg.evaluate("(() => { const t = __dbg.mobile.state(); return t.l.on.length === 0 && t.l.y === 0 })()")
            assert held and cz, ('touchCancel 应清零拖动输入', held, cz)

            # H) blur：活动拖动中页面失焦 → 全部输入归零（触摸屏没有配对 keyup）
            pg.evaluate("document.getElementById('mstick-r').dispatchEvent("
                        "new PointerEvent('pointerdown', { pointerId: 9, clientX: %d, clientY: %d, bubbles: true }))" % (RX, RY))
            pg.evaluate("document.getElementById('mstick-r').dispatchEvent("
                        "new PointerEvent('pointermove', { pointerId: 9, clientX: %d, clientY: %d, bubbles: true }))" % (RX, RY + 30))
            pg.wait_for_timeout(200)
            held2 = pg.evaluate("(() => { const t = __dbg.mobile.state(); "
                               "return t.r.y !== 0 || t.r.on.length > 0 || __dbg.FLY.userAlt !== null })()")
            pg.evaluate("window.dispatchEvent(new Event('blur'))")
            pg.wait_for_timeout(300)
            bz = pg.evaluate("(() => { const t = __dbg.mobile.state(); "
                            "return t.r.x === 0 && t.r.y === 0 && t.r.on.length === 0 && t.l.on.length === 0 })()")
            assert held2 and bz, ('blur 应清零全部摇杆输入', held2, bz)
            print('touchCancel + blur zeroing OK')

            # I) 右摇杆键盘降级：聚焦后 ↓ 应升降且不串平移键（stopPropagation 生效）
            pg.evaluate("__dbg.FLY.z=0; __dbg.FLY.userAlt=null; __dbg.FLY.state='hover'; __dbg.S.running=true")
            pg.wait_for_timeout(300)
            pg.evaluate("document.getElementById('mstick-r').focus()")
            pg.keyboard.press('ArrowDown')
            pg.keyboard.press('ArrowDown')
            pg.wait_for_timeout(300)
            kb = pg.evaluate("(() => ({ ua: __dbg.FLY.userAlt, z: +__dbg.FLY.z.toFixed(1) }))()")
            assert kb['ua'] is not None and kb['ua'] < 13.5, ('右摇杆聚焦时 ↓ 应降低 userAlt', kb)
            assert kb['z'] < 0.5, ('↓ 不应触发平移（须 stopPropagation）', kb)
            pg.evaluate("document.getElementById('mstick-r').blur()")
            print('keyboard fallback OK: userAlt=%.2f, no strafe leak (z=%.1f)' % (kb['ua'], kb['z']))

            # J) FPV：进入 → 摇杆隐藏（fp-touch 接管）；退出 → 恢复 + userAlt 同步当前高度
            ua0 = pg.evaluate("+__dbg.FLY.alt.toFixed(2)")
            pg.evaluate("__dbg.fp.enter()")
            pg.wait_for_timeout(400)
            f1 = pg.evaluate("(() => ({ fp: !!__dbg.fp.active, fpMode: document.body.classList.contains('fp-mode'), "
                             "disp: getComputedStyle(document.getElementById('mstick')).display, "
                             "ft: getComputedStyle(document.getElementById('fp-touch')).display }))()")
            assert f1['fp'] and f1['fpMode'] and f1['disp'] == 'none' and f1['ft'] != 'none', ('FPV 内摇杆应隐藏且方向键可见', f1)
            pg.evaluate("__dbg.fp.exit()")
            pg.wait_for_timeout(400)
            f2 = pg.evaluate("(() => ({ fpMode: document.body.classList.contains('fp-mode'), "
                             "disp: getComputedStyle(document.getElementById('mstick')).display, "
                             "ua: __dbg.FLY.userAlt }))()")
            assert not f2['fpMode'] and f2['disp'] == 'block', ('退出 FPV 摇杆应恢复', f2)
            assert abs(f2['ua'] - ua0) < 0.15, ('FPV 退出应同步 userAlt 为当前高度', ua0, f2)
            print('fpv visibility + userAlt sync OK')

            # K) 面板重开 → 摇杆隐藏（切换不粘滞）
            pg.evaluate("document.getElementById('btn-panel').click()")
            pg.wait_for_timeout(300)
            d1 = pg.evaluate("getComputedStyle(document.getElementById('mstick')).display")
            assert d1 == 'none', ('面板重开摇杆应隐藏', d1)
            pg.evaluate("document.getElementById('btn-panel').click()")
            pg.wait_for_timeout(300)

            # 收尾：复位飞行状态（S._alt 设回改前高度，防相机目标不回落）
            pg.evaluate("__dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.FLY.userAlt=null; __dbg.FLY.pitch=0; "
                        "__dbg.FLY.comp=0; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.S._alt=14")
            pg.screenshot(path=H.output_path('shot_mobile_drive.jpg'), type='jpeg', quality=88)
            print('mobile-drive OK: visibility/direction/bounds/two-finger/cancel/blur/kbd/fpv all pass')
        finally:
            b.close()
except Exception as e:
    errors.append('fatal: %s: %s' % (type(e).__name__, e))
    _wd.cancel()
    H._write_result('FAIL', str(errors[-1]) if errors else str(e))
    raise SystemExit('RESULT FAIL reason=%s' % errors[-1])
_wd.cancel()
if errors:
    H._write_result('FAIL', 'console/page errors: %s' % errors[:2])
    raise SystemExit('RESULT FAIL reason=%s' % errors[:2])
H._write_result('PASS', 'mobile drive OK')
print('RESULT PASS')
