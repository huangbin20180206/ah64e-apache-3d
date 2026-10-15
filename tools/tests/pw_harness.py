# ============================================================
# pw_harness.py — Playwright 测试护具（无人值守自救三件套）
# ============================================================
# 所有 apache_web 页面测试脚本统一走这个护具，保证：
#   1) 看门狗硬超时：任何卡死（rAF 停/等待悬挂/CDP 僵死）在硬上限内
#      强杀浏览器进程并退出，绝不留冻结窗口在用户屏幕上；
#   2) try/finally 全路径清理：断言失败/超时/Ctrl+C 都关浏览器；
#   3) 起测前清场：只杀命令行含 ms-playwright 的孤儿 chromium
#      （用户自己的浏览器不含此特征串，绝不误伤）；
#   4) 结果落盘：last_result.json 记录 PASS/FAIL 与细节——即使 CLI
#      会话中断没收到通知，下个会话读文件即可恢复状态继续工作。
# 测试脚本用法：
#   import pw_harness as H
#   def run(pg): ...    # 需要浏览器句柄时用 H.browser；断言失败抛异常即可
#   H.guarded_main(run, hard_timeout=240)
# ============================================================
import io, json, os, platform, subprocess, sys, threading, time, traceback
from pathlib import Path

# 结果文件可用 APACHE_PW_RESULT 覆盖（分片并行门禁场景：每个分片各写各的，
# 避免互写 last_result.json 导致后写者覆盖先写者）
RESULT_PATH = os.environ.get('APACHE_PW_RESULT') or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'last_result.json')
OUTPUT_DIR = Path(os.environ.get('APACHE_TEST_OUT', os.path.dirname(RESULT_PATH)))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
browser = None              # guarded_main 注入，测试脚本经 H.browser 取用

# 静态服务地址：端口可配（2026-09-17 D2 去耦）。此前测试脚本硬编码
# http://localhost:8642，而嵌套门禁自测（test_gate_harness）会跑子门禁——子门禁
# 启动前按端口杀残留监听，把外层门禁正在用的服务连根拔掉，外层后续测试全部
# ERR_CONNECTION_REFUSED 假失败。现在端口由 APACHE_TEST_PORT 决定，嵌套门禁换个
# 端口即可与外层完全隔离。测试脚本一律用 H.BASE 拼 URL，不再写死端口。
PORT = int(os.environ.get('APACHE_TEST_PORT') or 8642)
BASE = 'http://localhost:%d' % PORT

# ---- 浏览器显示模式（2026-09-17）----
# 默认**无头**。有头模式下 71 个测试会在桌面上轮番弹出真窗口：抢焦点、出声、
# 压住你正在用的窗口——而且被盖住的窗口会被 Windows 原生遮挡检测判定 occluded，
# rAF 直接停摆，所有"等渲染帧"的断言读到旧值（本会话修掉的 5 处假失败很可能都
# 源于此）。无头没有窗口，这一整类问题连同对你操作的干扰一起消失。
# 历史注释曾称"headless 走 SwiftShader 只有 ~2FPS"，需注意本机有头模式**同样**跑
# 软件渲染（启动参数带 --enable-unsafe-swiftshader），该对比前提不成立，已实测复核。
# APACHE_PW_HEADFUL=1 可强制回到有头（排障时需肉眼看画面用）。
HEADLESS = os.environ.get('APACHE_PW_HEADFUL') != '1'


def browser_args(extra=None):
    """所有浏览器启动统一走这里（guarded_main 与各测试自管启动都调用）。

    --mute-audio 是浏览器层静音：页面内的 audio.enabled=false 覆盖不到 5 个音频
    专项测试（它们故意不静音以断言输出电平），也挡不住物理出声；这个 flag 在音频
    栈出口静音，既保证全程不吵，又不影响那些测试（它们断言的是 WebAudio 图的数值）。
    """
    a = ['--mute-audio',
         '--disable-backgrounding-occluded-windows',
         '--disable-renderer-backgrounding',
         '--disable-background-timer-throttling',
         # Windows 下 Chromium 的原生遮挡检测会把被其它窗口盖住的有头窗口
         # 判定为 occluded 并完全停止 rAF（visibilityState 仍是 visible，
         # 2026-09-05 实测 tour 的 rAF 时间戳冻结、过期帧 dt 为负）。
         '--disable-features=CalculateNativeWinOcclusion']
    if not HEADLESS:
        a += ['--window-position=60,40', '--window-size=1280,800']
    else:
        # 关键：无头模式默认**不走 GPU**，掉进 SwiftShader 软件渲染。本机实测
        # （2026-09-17 探针，Intel Iris Xe）：
        #   有头                     55.9 fps  D3D11 硬件
        #   无头（裸）                1.7 fps  SwiftShader 软件；页面时间仅 0.07× 实时
        #   无头 + --use-angle=d3d11 58.7 fps  D3D11 硬件（比有头还快，无窗口合成开销）
        # 软件渲染下页面内时间比墙上时间慢 14 倍，"等字幕出现/等涟漪扩散"这类断言
        # 必然超时（实测 test_cinematic / test_water_ripple / test_edge_cases 三挂）。
        # 显式指定 D3D11 后端即可让无头用上硬件——这是无头可行性的前提，不是优化。
        a += ['--use-angle=d3d11']
    return a + list(extra or [])

def kill_stale_pw_chromium():
    """门禁总控专用的一次性清场。**测试脚本绝不可调用。**

    去耦（2026-09-17 D1）：此前 guarded_main 每起一测都调一次本函数，判据是
    "命令行含 ms-playwright"——不区分浏览器是谁启的，于是**杀掉全部**并发运行的
    playwright 浏览器。GATE-R6 实测事故：并发跑的截图脚本杀掉门禁正在跑的浏览器，
    门禁侧 4 个测试报 TargetClosedError 假失败（两边互杀）。

    现在只由门禁总控在**起测前**调用一次（run_tests.ps1 / shard_gate.py /
    demo_capture.py）。原 APACHE_SKIP_STALE_KILL 开关随之作废——它的唯一用途是
    让分片 worker 跳过"每测都跑"的全局清场，现在没有"每测都跑"这回事了。
    """
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='chromium.exe' or Name='headless_shell.exe'\" "
          "| Where-Object { $_.CommandLine -like '*ms-playwright*' } "
          "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    try:
        subprocess.run(['powershell', '-NoProfile', '-Command', ps],
                       capture_output=True, timeout=30)
    except Exception as e:
        print('WARN: stale cleanup skipped:', e)

class _Guard:
    def __init__(self, hard_timeout):
        self.browser = None          # 由 guarded_main 注入
        self.timer = threading.Timer(hard_timeout, self._fire)
        self.fired = False

    def _fire(self):
        self.fired = True
        # os._exit 会跳过 finally，浏览器必须先在这里强杀
        try:
            if self.browser is not None:
                self.browser.process and self.browser.process().kill()
        except Exception:
            pass
        _write_result('FAIL', 'hard timeout (watchdog fired)', skipped=True)
        print('RESULT FAIL reason=hard_timeout', flush=True)
        os._exit(3)

def _write_result(status, reason, **extra):
    try:
        with open(RESULT_PATH, 'w', encoding='utf-8') as f:
            json.dump({'status': status, 'reason': reason,
                       'time': time.strftime('%Y-%m-%d %H:%M:%S'), **extra},
                      f, ensure_ascii=False, indent=1)
    except Exception:
        pass

def output_path(name):
    """返回测试产物路径；可用 APACHE_TEST_OUT 覆盖，避免脚本写死 Windows 路径。"""
    return str(OUTPUT_DIR / name)


# 静音（2026-09-14 用户要求：跑测试/全量门禁时关闭全部音效，太吵；音效最后统一核对）。
# 机制：页面音频模块的全局 enabled 开关（18-audio.js，门控三条最终输出总线），
# 加载后置 false 即全程零音量（含用户手势后 ensureStarted——enabled=false 语义
# 优先于一切，输出恒 0）。音频专项测试豁免：它们断言输出电平/RMS/静音逻辑本身
# （test_audio 的 master>0.05 / 静音归零、test_music_bus 的 musicRMS 等），
# 静音会使其断言失败——这批测试即"最后统一核对校验"的音效批次，保留真实输出。
# 覆盖：环境变量 APACHE_NO_MUTE=1 可豁免任意测试（调试时手动验证用）。
AUDIO_TESTS = {'test_audio.py', 'test_audio_resume.py', 'test_music.py',
               'test_music_bus.py', 'test_weather.py'}

def _mute_audio(pg):
    if os.environ.get('APACHE_NO_MUTE'):
        return
    if os.path.basename(sys.argv[0]) in AUDIO_TESTS:
        return
    try:
        pg.wait_for_function("() => !!(window.__dbg && window.__dbg.audio)", timeout=5000)
        pg.evaluate("window.__dbg.audio.enabled = false")
        print('audio muted for test (user request 2026-09-14)', flush=True)
    except Exception as e:
        # 失败路径测试（WebGL 不可用/GLB 失败等）页面可能永远不产生 __dbg.audio，
        # 5s 超时后静音放弃——不得让静音拖垮这类本就测"加载失败"的测试
        print('WARN: audio mute skipped:', e, flush=True)


def step_until(pg, cond, game_sec, chunk=1.0, h=1.0 / 30, label=None):
    """按游戏时间等待（2026-10-12 批 E）：经 __dbg.step 同步推进页面逻辑，
    直到 cond（JS 箭头函数字符串，如 "() => __dbg.x > 1"）为真。

    与 wait_for_function 的区别：后者按墙钟等，软件渲染下页面时间只有墙钟的
    ~0.07×，"SAM 锁定约 14s 游戏时间"要等 200s 墙钟而超时；这里每块 chunk 秒
    游戏时间在一次 evaluate 里同步跑完（跳过 GPU 渲染），与机器帧率无关。
    game_sec 是游戏时间上限；超限抛 TimeoutError。返回实际推进的游戏秒数。
    """
    # 先推进一帧再判条件：与真实 loop 一致（按键/点击后至少过一帧，渲染镜像层才跟上）
    js = ("(a) => { const c = (%s); let t = __dbg.step(a.h, a.h); if (c()) return { ok: true, t };"
          " t += __dbg.step(a.chunk, a.h, c); return { ok: !!c(), t }; }") % cond
    spent = 0.0
    while True:
        r = pg.evaluate(js, {'chunk': chunk, 'h': h})
        spent += r['t']
        if r['ok']:
            return spent
        if spent >= game_sec:
            raise TimeoutError('step_until 超时（%.1fs 游戏时间）：%s' % (spent, label or cond))


def step(pg, game_sec, h=1.0 / 30):
    """无条件推进 game_sec 秒游戏时间（替代"等几百毫秒让 loop 跑几帧"）。"""
    return pg.evaluate("(a) => __dbg.step(a.s, a.h)", {'s': game_sec, 'h': h})


def guarded_main(run, base_url=None, hard_timeout=240, launch_args=None):
    # 起测前**不**做全局清场（2026-09-17 D1 去耦）：那会杀掉并发运行的其它
    # playwright 浏览器（GATE-R6 互杀事故）。清场由门禁总控在整轮开始前做一次。
    from playwright.sync_api import sync_playwright
    errors = []
    g = _Guard(hard_timeout)
    g.timer.start()
    status, reason = 'PASS', ''
    b = None
    pg = None
    # ?nocine=1：跳过电影开场运镜（78-cinematic）——自动化测试直接进入可交互
    # 状态，避免 14s 开场序列干扰时序断言；真实用户访问（无参数）正常播放开场
    # ?nocut=1：跳过任务/救援过场（82-cutscene，M6）——任务类测试不被打断运镜
    base_url = base_url or os.environ.get('APACHE_TEST_URL') or (BASE + '/?nocine=1&nocut=1')
    args = browser_args(launch_args)
    try:
        with sync_playwright() as p:
            try:
                b = p.chromium.launch(headless=HEADLESS, args=args)
                g.browser = b
                globals()['browser'] = b
                pg = b.new_page(viewport={'width': 1280, 'height': 800})
                pg.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
                pg.on('console', lambda m: errors.append('console.error: %s' % m.text) if m.type == 'error' else None)
                pg.goto(base_url, wait_until='domcontentloaded')
                _mute_audio(pg)
                run(pg)
            except Exception as e:
                status, reason = 'FAIL', '%s: %s' % (type(e).__name__, e)
                try:  # 失败现场留证：即使启动/导航失败也不能二次抛错
                    if pg is not None:
                        pg.screenshot(path=output_path('fail_shot.png'))
                except Exception:
                    pass
            finally:
                try:
                    if b is not None:
                        b.close()
                except Exception:
                    pass
    except Exception as e:
        status, reason = 'FAIL', '%s: %s' % (type(e).__name__, e)
    finally:
        g.timer.cancel()
        globals()['browser'] = None
    if errors and status == 'PASS':
        status, reason = 'FAIL', 'console/page errors: %s' % errors[:3]
    _write_result(status, reason, errors=errors)
    print('ERRORS:', errors if errors else 'none', flush=True)
    print('RESULT %s%s' % (status, (' reason=' + reason) if reason else ''), flush=True)
    sys.exit(0 if status == 'PASS' else 1)
