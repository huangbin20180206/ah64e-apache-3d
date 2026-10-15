# -*- coding: utf-8 -*-
# P10 D8: fallback path — intercept one detail GLB URL (gun.glb) → fallback=true, core scene intact.
# 自管模式（仿 test_fail_paths）：route 拦截成功/失败混合必须精确白名单 console.error
# （预期 net::ERR_FAILED），pageerror 任何一条都失败；8s 看门狗防挂死；try/finally 关浏览器。
import sys, os, json, threading, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import pw_harness as H

BASE = H.BASE + '/?nocine=1&nocut=1'
RESULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'last_result.json')
_current_browser = None

def _write_result(status, reason, **extra):
    try:
        with open(RESULT_PATH, 'w', encoding='utf-8') as f:
            json.dump({'status': status, 'reason': reason,
                       'time': time.strftime('%Y-%m-%d %H:%M:%S'), **extra},
                      f, ensure_ascii=False, indent=1)
    except Exception:
        pass

def _watchdog():
    try:
        if _current_browser: _current_browser.close()
    except Exception: pass
    _write_result('FAIL', 'watchdog timeout (150s)', skipped=True)
    print('RESULT FAIL reason=watchdog_timeout', flush=True)
    os._exit(3)

def _run():
    from playwright.sync_api import sync_playwright
    global _current_browser
    b = None
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=H.HEADLESS, args=H.browser_args())
            _current_browser = b
            pg = b.new_page(viewport={'width': 1280, 'height': 800})
            pageerrors, console_errs = [], []
            pg.on('pageerror', lambda e: pageerrors.append(str(e)[:300]))
            pg.on('console', lambda m: console_errs.append(m.text[:200]) if m.type == 'error' else None)

            def deny(route):
                if 'gun.glb' in route.request.url:
                    route.abort('failed')
                else:
                    route.continue_()
            pg.route('**/assets/details/*.glb', deny)

            pg.goto(BASE, wait_until='domcontentloaded')
            pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.dp)", timeout=60000)
            pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
            pg.wait_for_timeout(300)
            pg.wait_for_function("() => __dbg.dp.stats().loaded >= 1 || __dbg.dp.stats().fallback === true", timeout=15000)
            st = pg.evaluate("__dbg.dp.stats()")
            print('D8_STATS:', st)
            assert st['loaded'] == 1, ('D8: gun 失败应 1 件加载', st)
            assert st['fallback'] is True and 'gun.glb' in st['error'], ('D8: fallback 应报告', st)
            assert pg.evaluate("!!__dbg.apache && !!__dbg.targets && !!__dbg.rig"), 'D8: 核心场景被破坏'
            vis = pg.evaluate("__dbg.dp.scenes.map(s=>s.visible)")
            assert len(vis) == 1 and all(vis), ('D8: 未失败件应可见', vis)
            # 白名单：只允许回退相关的 net::ERR_FAILED；其它 console.error 视为失败
            unexpected = [e for e in console_errs if 'ERR_FAILED' not in e and 'gun.glb' not in e]
            assert not unexpected, ('D8: 意外 console.error', unexpected)
            assert not pageerrors, ('D8: 有任何 pageerror 即失败', pageerrors)
            print('D8 PASS: 细节件失败回退 → fallback=true 场景完整未失败件可用')
            return 'PASS', ''
    finally:
        try:
            if b: b.close()
        except Exception: pass

# 三件套：看门狗 + 结果落盘 + 清理
_watchdog_timer = threading.Timer(150, _watchdog)
_watchdog_timer.start()
status, reason = 'PASS', ''
try:
    status, reason = _run()
except Exception as e:
    status, reason = 'FAIL', '%s: %s' % (type(e).__name__, e)
finally:
    _watchdog_timer.cancel()
_write_result(status, reason)
print('RESULT %s%s' % (status, (' reason=' + reason) if reason else ''), flush=True)
sys.exit(0 if status == 'PASS' else 1)
