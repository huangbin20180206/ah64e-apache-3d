# Phase 2-A2：失败路径测试覆盖（WebGL 不可用 / context lost / GLB 载入失败）
# 三条路径此前零测试——本文件补齐。
#
# 自管模式（仿 test_mobile.py）：需要多个浏览器实例以不同 launch args 启动
# （--disable-webgl 造 WebGL 不可用 / route 拦截造 GLB 失败），guarded_main
# 的单浏览器模型不适用。自行复刻护具三件套：看门狗硬超时 / try-except 全路径
# 关浏览器 / H._write_result 落盘。
# + 每页挂 pageerror / console.error 收集（有错误则测试失败）。
import sys, os, json, threading, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import pw_harness as H

BASE = H.BASE + '/?nocine=1&nocut=1'
RESULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'last_result.json')

# watchdog 可见的当前浏览器句柄（全局——os._exit 前强杀）
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
    # G-3：先尝试关闭当前浏览器，再写结果并退出
    try:
        if _current_browser:
            _current_browser.close()
    except Exception:
        pass
    _write_result('FAIL', 'watchdog timeout (180s)', skipped=True)
    print('RESULT FAIL reason=watchdog_timeout', flush=True)
    os._exit(3)

def _run_all():
    from playwright.sync_api import sync_playwright
    global _current_browser
    results = []
    all_errors = []
    with sync_playwright() as p:
        # ---- ① context lost + restore（有头正常模式，护具默认 args） ----
        b = None
        try:
            b = p.chromium.launch(headless=H.HEADLESS, args=H.browser_args())
            _current_browser = b
            pg = b.new_page(viewport={'width': 1280, 'height': 800})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
            pg.on('console', lambda m: errs.append('console: ' + m.text[:200]) if m.type == 'error' else None)
            pg.goto(BASE, wait_until='domcontentloaded')
            pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.composer)", timeout=60000)
            pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")

            # context lost via WEBGL_lose_context
            pg.evaluate("""(() => {
              const cv = document.getElementById('gl');
              const gl = cv.getContext('webgl2') || cv.getContext('webgl');
              if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
            })()""")
            # B6+：#load-txt 由 loop-reachable 路径写（70-app.js:152/186/838）——
            # 等报错文案真正出现再断言，替代固定睡 600ms（分类器真候选 L64→L66）
            pg.wait_for_function("() => document.getElementById('load-txt').textContent.indexOf('显卡上下文丢失') >= 0", timeout=15000)
            lost_msg = pg.evaluate("document.getElementById('load-txt').textContent")
            assert '显卡上下文丢失' in lost_msg, ('context lost error msg missing', lost_msg)
            loading_done = pg.evaluate("document.getElementById('loading').classList.contains('done')")
            assert not loading_done, 'loading should re-show during context lost'

            # context restore → 不崩溃 + __dbg 存活
            # （WEBGL_lose_context 的 restoreContext 在 three.js 下不保证 loading 'done'
            #   自动恢复——three.js 需要自行重建资源；此处务实断言：恢复调用不崩溃且
            #   __dbg 仍可访问）
            pg.evaluate("""(() => {
              const cv = document.getElementById('gl');
              const gl = cv.getContext('webgl2') || cv.getContext('webgl');
              if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.restoreContext(); }
            })()""")
            pg.wait_for_timeout(3000)
            alive = pg.evaluate("!!window.__dbg && !!window.__dbg.S")
            assert alive, 'app should not crash after context restore'
            # G-3：收集 pageerror/console.error——还原操作可能触发 setPointerCapture
            # pageerror（合成事件已知无害），只收集还原步骤后新产生的
            post_restore = [e for e in errs if 'setPointerCapture' not in e]
            assert not post_restore, ('context restore 产生未预期 pageerror', post_restore[:3])
            print('context lost/restore OK: lost msg shown, restore does not crash, __dbg alive')
            results.append(('context_lost_restore', 'PASS'))
        finally:
            if b:
                try: b.close()
                except Exception: pass
            _current_browser = None

        # ---- ② WebGL 不可用 → 早期探测 + __showErr ----
        b = None
        try:
            b = p.chromium.launch(headless=H.HEADLESS, args=H.browser_args([
                '--disable-webgl', '--disable-webgl2', '--disable-web-security']))
            _current_browser = b
            pg = b.new_page(viewport={'width': 1280, 'height': 800})
            errs2 = []
            pg.on('pageerror', lambda e: errs2.append(str(e)[:200]))
            pg.on('console', lambda m: errs2.append('console: ' + m.text[:200]) if m.type == 'error' else None)
            pg.goto(BASE, wait_until='domcontentloaded')
            # B6+：等 WebGL 不可用的报错文案出现，替代固定睡 2000ms（分类器真候选 L105→L107）
            pg.wait_for_function("() => document.getElementById('load-txt').textContent.indexOf('WebGL') >= 0", timeout=20000)
            msg = pg.evaluate("document.getElementById('load-txt').textContent")
            assert '不支持 WebGL' in msg or 'WebGL' in msg, ('webgl unavailable msg missing', msg)
            title = pg.evaluate("document.title")
            assert '错误' in title, ('title should show error', title)
            print('webgl unavailable OK: msg=%s title=%s' % (msg[:40], title))
            # D-3：监听建了必须读——WebGL 不可用是"被处理的失败"，__showErr
            # 有意展示错误 UI，页面不应产生未捕获 pageerror/console.error。
            # 噪声按内容精确白名单：
            # - "A WebGL context could not be created"：THREE.WebGLRenderer 在
            #   WebGL 被禁用时构造渲染器的内在抱怨——本子测试制造的就是这个
            #   失败场景，应用层 __showErr 已正确接管。
            # - "setPointerCapture"：合成 pointerdown 在无活跃指针时 Chromium
            #   派发的无害异常（既有已知噪声）。
            NOISE2 = ('A WebGL context could not be created', 'Error creating WebGL context')
            unexpected2 = [e for e in errs2
                           if 'setPointerCapture' not in e
                           and not any(n in e for n in NOISE2)]
            assert not unexpected2, ('webgl-unavailable 子测试产生未预期错误', unexpected2[:3])
            results.append(('webgl_unavailable', 'PASS'))
        except Exception as e:
            all_errors.append('webgl_unavailable: %s' % e)
            results.append(('webgl_unavailable', 'FAIL'))
        finally:
            if b:
                try: b.close()
                except Exception: pass
            _current_browser = None

        # ---- ③ GLB 载入失败 → 路由拦截 ----
        b = None
        try:
            b = p.chromium.launch(headless=H.HEADLESS, args=H.browser_args())
            _current_browser = b
            pg = b.new_page(viewport={'width': 1280, 'height': 800})
            errs3 = []
            pg.on('pageerror', lambda e: errs3.append(str(e)[:200]))
            pg.on('console', lambda m: errs3.append('console: ' + m.text[:200]) if m.type == 'error' else None)
            pg.route("**/*.glb", lambda route: route.abort())
            pg.goto(BASE, wait_until='domcontentloaded')
            # B6+：等 GLB 失败文案出现，替代固定睡 4000ms（分类器真候选 L145→L147）
            pg.wait_for_function("""() => { const t = document.getElementById('load-txt').textContent;
                return t.indexOf('GLB') >= 0 || t.indexOf('载入失败') >= 0 || t.indexOf('出错') >= 0; }""", timeout=25000)
            msg = pg.evaluate("document.getElementById('load-txt').textContent")
            assert 'GLB' in msg or '载入失败' in msg or '出错' in msg, ('GLB failure msg missing', msg)
            print('GLB load failure OK: msg=%s' % msg[:60])
            # D-3：同上——GLB 载入失败是"被处理的失败"（GLTFLoader onError
            # → __showErr），fetch abort 不应产生未捕获错误。
            # "net::ERR_FAILED" 白名单：GLB 请求被故意 abort 时浏览器对
            # 失败资源的标准 console 报告——route 拦截本身就是测试目标。
            NOISE3 = ('net::ERR_FAILED',)
            unexpected3 = [e for e in errs3
                           if 'setPointerCapture' not in e
                           and not any(n in e for n in NOISE3)]
            assert not unexpected3, ('glb-load-failure 子测试产生未预期错误', unexpected3[:3])
            results.append(('glb_load_failure', 'PASS'))
        except Exception as e:
            all_errors.append('glb_load_failure: %s' % e)
            results.append(('glb_load_failure', 'FAIL'))
        finally:
            if b:
                try: b.close()
                except Exception: pass
            _current_browser = None

    return results, all_errors

# ---- 看门狗 + 主流程 ----
_wd = threading.Timer(180, _watchdog)
_wd.start()

try:
    results, errors = _run_all()
    real_errors = [e for e in errors if 'setPointerCapture' not in e]
    all_pass = all(s == 'PASS' for _, s in results)
    if real_errors:
        _write_result('FAIL', '; '.join(real_errors))
        print('RESULT FAIL reason=%s' % '; '.join(real_errors), flush=True)
        sys.exit(1)
    _write_result('PASS', 'all 3 fail-path sub-tests OK')
    for name, status in results:
        print('%-30s %s' % (name, status))
    print('RESULT PASS', flush=True)
except Exception as e:
    _write_result('FAIL', str(e)[:200])
    print('RESULT FAIL reason=%s' % e, flush=True)
    sys.exit(1)
finally:
    _wd.cancel()


