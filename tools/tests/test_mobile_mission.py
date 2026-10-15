# -*- coding: utf-8 -*-
# P4-B 任务闭环移动端适配验证：简报可读 / 目标进度随行为推进 / 结算与状态源一致 /
# 重置清零可再开始 / 救援 K 触控入口 / 窄屏响应式（面板开任务面板让位、任务面板不拦触控）
import sys, os, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

errors = []
from playwright.sync_api import sync_playwright

def _watchdog():
    H._write_result('FAIL', 'mobile-mission watchdog timeout (300s)', skipped=True)
    print('RESULT FAIL reason=mobile-mission watchdog timeout', flush=True)
    os._exit(3)
_wd = threading.Timer(300, _watchdog)
_wd.start()

def _tap(pg, cdp, sel):
    # 元素中心 CDP 真实触控 tap（elementFromPoint 自守卫：390 窄视口打开的面板有实体面积）
    # 面板内容长于 844 视口：先滚动元素进视口再取中心（scrollIntoView 对 fixed 面板内的滚动容器生效）
    pg.evaluate("(sel) => { const el = document.querySelector(sel);"
                 " if (el) el.scrollIntoView({ block: 'center' }); }", sel)
    pg.wait_for_timeout(150)
    pt = pg.evaluate("(sel) => { const el = document.querySelector(sel);"
                     " if (!el) return null; const r = el.getBoundingClientRect();"
                     " const x = r.left + r.width / 2, y = r.top + r.height / 2;"
                     " return { x, y, hit: document.elementFromPoint(x, y) === el }; }", sel)
    assert pt and pt['hit'], ('element not tappable', sel, pt)
    cdp.send('Input.dispatchTouchEvent', dict(type='touchStart', touchPoints=[{'x': pt['x'], 'y': pt['y'], 'id': 1}]))
    cdp.send('Input.dispatchTouchEvent', dict(type='touchEnd', touchPoints=[]))
    return pt

def _tap_until(pg, cdp, sel, cond_js, label, attempts=3, per_timeout=5000):
    # B6+ 重试式触控触发（GATE-77 20260918-132737 唯一红项的修复）：
    # 负载下 CDP 触点可能在探针（elementFromPoint 自检）与派发之间丢失——
    # TOCTOU。丢失时被等状态永不出现，原单次 15s 等待直接超时（该轮门禁
    # ④ reset tap 实测）。三站点的触发全部幂等或"条件未达=上次丢失"语义
    # （resetRange 幂等；rescue idle 下再按=重新部署；deploying/holding 下
    # 再按=转 retracting），重按正是恢复动作。连试 attempts 次仍未达则报
    # "连试 N 次未触发"，与"状态真不发生"（真退化）区分；总预算 attempts×
    # per_timeout 与原单次 15s 等待同量级。
    for i in range(attempts):
        try:
            _tap(pg, cdp, sel)
        except AssertionError:
            if i == attempts - 1:
                raise                      # 末次保留原始"不可点"诊断（布局问题）
            pg.wait_for_timeout(300)
            continue
        try:
            pg.wait_for_function(cond_js, timeout=per_timeout)
            return
        except Exception:
            if i == attempts - 1:
                raise AssertionError('%s：连试 %d 次触控都未触发（非时序慢，查触控通路）'
                                      % (label, attempts))
            pg.wait_for_timeout(200)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=H.HEADLESS, args=H.browser_args())
        pg = b.new_page(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
        pg.on('console', lambda m: errors.append('console.error: %s' % m.text) if m.type == 'error' else None)
        try:
            pg.goto(H.BASE + '/?nocine=1', wait_until='domcontentloaded')
            pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rescue && __dbg.targets && __dbg.targets.baseCenter)", timeout=60000)
            pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
            pg.evaluate("__dbg.S.mode = 'mission'")   # P6：任务测试声明处于任务模式（接近触发是任务模式兼容路径）
            pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
            pg.wait_for_timeout(1200)
            cdp = pg.context.new_cdp_session(pg)

            # 0) 结构（帧率无关）：救援 K 触控芯片存在且 a11y；任务面板纯只读不拦触控
            rescue_btn = pg.evaluate("() => { const el = document.getElementById('btn-rescue');"
                                     " return { ok: !!el, role: el && el.getAttribute('role'),"
                                     " text: el && el.textContent.trim() }; }")
            assert rescue_btn['ok'] and rescue_btn['role'] == 'button' and '绞车' in rescue_btn['text'], ('btn-rescue missing/a11y', rescue_btn)
            pe = pg.evaluate("getComputedStyle(document.getElementById('mission')).pointerEvents")
            assert pe == 'none', ('mission should be pointer-events:none', pe)
            print('structure OK: rescue chip role=%s, mission pointer-events=%s' % (rescue_btn['role'], pe))

            # ① 关闭面板(进飞行态) → 接近基地 → 简报可读
            pg.evaluate("document.getElementById('btn-panel').click()")
            pg.wait_for_timeout(300)
            pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                        "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
            pg.wait_for_timeout(300)
            pg.evaluate("__dbg.FLY.z = 20")
            # B6+：#mission 面板由 loop-reachable 路径写（70-app.js:954/958），固定睡 1800ms
            # 负载下会读到旧面板（分类器真候选 L64→L70/L71）
            pg.wait_for_function("""() => !!__dbg.S._mission
                && document.getElementById('mission').classList.contains('show')
                && document.getElementById('mission-body').innerHTML.indexOf('剩余目标') >= 0""", timeout=15000)
            m1 = pg.evaluate("() => { const mp = document.getElementById('mission');"
                             " return { show: mp.classList.contains('show'),"
                             " disp: getComputedStyle(mp).display, body: mp.innerHTML,"
                             " title: document.getElementById('mission-title').textContent,"
                             " mission: !!__dbg.S._mission }; }")
            assert m1['mission'], ('briefing not triggered', m1)
            assert m1['show'] and m1['disp'] != 'none' and '剩余目标' in m1['body'], ('briefing not readable on mobile', m1)
            print('① briefing readable on mobile:', m1['title'])

            # ② 任务状态随目标行为推进：面板【显示数值】与 __dbg.targets 状态源比对（复核修订：字段存在→数值一致）
            prog = pg.evaluate("""() => { const rows = [...document.querySelectorAll('#mission-body .mrow')];
              const val = (label) => { for (const r of rows) { const s = r.querySelector('span');
                if (s && s.textContent.trim() === label) { const bEl = r.querySelector('b');
                  return bEl ? bEl.textContent.trim() : null; } } return null; };
              return { shownRemain: val('剩余目标'), shownKills: val('已摧毁'),
                       alive: __dbg.targets.aliveCount, total: __dbg.targets.totalCount }; }""")
            assert prog['shownRemain'] is not None and prog['shownKills'] is not None, ('progress panel missing fields', prog)
            assert int(prog['shownRemain']) == prog['alive'], ('shown remain != aliveCount', prog)
            assert int(prog['shownKills']) == prog['total'] - prog['alive'], ('shown kills != total-alive', prog)
            print('② progress numbers match state source: remain %s==%d, kills %s==%d' %
                  (prog['shownRemain'], prog['alive'], prog['shownKills'], prog['total'] - prog['alive']))

            # ③ 前置：真实开火制造 shots>0 + 直写 hits 制造非零命中率（驱动结算显示公式的非退化路径）
            pg.evaluate("__dbg.rig.gunOn = true")
            pg.wait_for_timeout(600)
            pg.evaluate("__dbg.rig.gunOn = false")
            pg.evaluate("__dbg.S._mission.hits = (__dbg.S._mission.hits || 0) + 5")

            # ③ 结算与状态源一致：全歼 → done + 【显示数值】与 S._mission/rig 重算值比对（复核修订）
            pg.evaluate("__dbg.air.enabled = false")
            pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
            pg.wait_for_timeout(1800)
            res = pg.evaluate("""() => { const rows = [...document.querySelectorAll('#mission-body .mrow')];
              const val = (label) => { for (const r of rows) { const s = r.querySelector('span');
                if (s && s.textContent.trim() === label) { const bEl = r.querySelector('b');
                  return bEl ? bEl.textContent.trim() : null; } } return null; };
              const m = __dbg.S._mission, rg = __dbg.rig;
              const shots = (m.gun0 - rg.gunAmmo) + (m.rk0 - rg.rocketAmmo) + (m.hf0 - rg.hfAmmo);
              const acc = shots > 0 ? Math.round(m.hits / shots * 100) : 0;
              const el = __dbg.S.time - m.t0, a = acc / 100;
              // 与 70-app missionRating 同公式（边界 150/240/420s；测试全程 <150s 落同桶，完成时刻与复算时刻等价）
              const grade = (el < 150 && a >= 0.5) ? 'S' : (el < 240 && a >= 0.35) ? 'A' : (el < 420 && a >= 0.2) ? 'B' : 'C';
              const t = val('用时'); const tm = t ? t.split(':') : null;
              const frozen = tm ? (+tm[0]) * 60 + (+tm[1]) : null;
              return { done: !!m.done, shownAcc: val('命中率'), shownGrade: val('评级'),
                       shownTime: t, computedAcc: acc, computedGrade: grade,
                       shots, hits: m.hits, elapsed: el, frozen }; }""")
            assert res['done'], ('mission not done', res)
            assert res['shownAcc'] is not None and res['shownGrade'] is not None, ('results panel missing fields', res)
            assert int(res['shownAcc'].replace('%', '')) == res['computedAcc'], ('shown acc != computed', res)
            assert res['shownGrade'] == res['computedGrade'], ('shown grade != computed', res)
            assert res['frozen'] is not None and 0 < res['frozen'] <= res['elapsed'] + 1, ('frozen time out of range', res)
            print('③ results numbers match state source: acc %s==%d%%, grade %s==%s, shots=%d hits=%d' %
                  (res['shownAcc'], res['computedAcc'], res['shownGrade'], res['computedGrade'], res['shots'], res['hits']))

            # ④ 重置：先飞离发现圈 → 开面板(任务面板响应式让位) → 触控 tap 重置 → 任务清零；关面板再接近 → 重新触发
            pg.evaluate("__dbg.FLY.z = -20")
            pg.wait_for_timeout(400)
            # B6+：原写法"点一次侧栏按钮"**假定它当时是关的**——若已开着，这一点反而是关闭，
            # 任务面板就不会让位，后续断言方向全反（首改实测：等 display===none 15s 超时）。
            # 改为先**幂等**置为打开（#panel 显隐是 class 'hide'），再等任务面板真正让位。
            pg.evaluate("""(() => { const p = document.getElementById('panel');
                if (p.classList.contains('hide')) document.getElementById('btn-panel').click(); })()""")
            pg.wait_for_function("() => !document.getElementById('panel').classList.contains('hide')", timeout=15000)
            pg.wait_for_function("() => getComputedStyle(document.getElementById('mission')).display === 'none'", timeout=15000)
            m2 = pg.evaluate("() => ({ disp: getComputedStyle(document.getElementById('mission')).display,"
                             " mstick: getComputedStyle(document.getElementById('mstick')).display })")
            assert m2['disp'] == 'none', ('mission should yield when panel open on mobile', m2)
            # B6+（GATE-77 修复）：原单次 tap+15s 等待在负载下触点丢失即超时——
            # 改重试式（resetRange 幂等，重按即恢复）
            _tap_until(pg, cdp, '#btn-reset-targets',
                       "() => !__dbg.S._mission && __dbg.S._baseFound === false", '④ reset tap')
            after = pg.evaluate("({mission: __dbg.S._mission, found: __dbg.S._baseFound,"
                                " show: document.getElementById('mission').classList.contains('show')})")
            assert not after['mission'] and after['found'] is False and not after['show'], ('reset did not clear mission', after)
            pg.evaluate("document.getElementById('btn-panel').click()")
            pg.wait_for_timeout(300)
            pg.evaluate("__dbg.FLY.z = 20")
            pg.wait_for_function("() => !!__dbg.S._mission && document.getElementById('mission').classList.contains('show')", timeout=15000)
            again = pg.evaluate("({mission: __dbg.S._mission, show: document.getElementById('mission').classList.contains('show')})")
            assert again['mission'] and again['show'], ('briefing not re-triggered after mobile reset', again)
            print('④ mobile reset clears mission state; re-trigger after re-approach OK')

            # ⑤ 救援 K 触控入口：开面板 → tap #btn-rescue → deploying；再 tap → retracting（遵守既有状态机）
            pg.evaluate("document.getElementById('btn-panel').click()")
            pg.wait_for_timeout(300)
            pg.evaluate("__dbg.FLY.userAlt=8; __dbg.FLY.x=26; __dbg.FLY.z=-14; __dbg.FLY.yaw=0; __dbg.S._alt=8")
            pg.wait_for_timeout(500)
            assert pg.evaluate("__dbg.rescue.ok"), 'no survivor on desert'
            # rescue.state 是 48-rescue.js:175/178/183 updater 每帧写（分类器真候选 L148→L150）；
            # B6+（GATE-77 修复）：重试式防触点丢失——条件未达=上次 tap 丢失（idle 下重按=重新部署）
            _tap_until(pg, cdp, '#btn-rescue',
                       "() => ['deploying', 'holding'].indexOf(__dbg.rescue.state) >= 0", '⑤ rescue deploy tap')
            st1 = pg.evaluate("__dbg.rescue.state")
            assert st1 in ('deploying', 'holding'), ('rescue not deploying via touch', st1)
            # B6+：第二次触控 → 回收（48-rescue.js:152-153 规定 deploying/holding 下都转
            # retracting）。首改把第一次等待提前后绳只放出一小段，回收可能在 600ms 内走完
            # 并回到 idle（原写法睡 700ms 让绳更深，故总能在 retracting 上抓到）。
            # 放宽为"进入 retracting 或已完成回收(idle)"——**两者都证明触控被接受**：
            # 若触控被忽略，状态会停在 deploying/holding，本等待必然超时。
            # GATE-77 修复：重试式防触点丢失——条件未达=上次 tap 丢失（状态仍停在
            # deploying/holding，重按即转 retracting，恢复语义正确）
            _tap_until(pg, cdp, '#btn-rescue',
                       "() => ['retracting', 'idle'].indexOf(__dbg.rescue.state) >= 0", '⑤ rescue retract tap')
            st2 = pg.evaluate("__dbg.rescue.state")
            assert st2 in ('retracting', 'idle'), ('second touch should retract', st2)
            print('⑤ rescue K touch entry drives same state machine:', st1, '->', st2)

            # 收尾复位
            pg.evaluate("__dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.FLY.userAlt=null; __dbg.FLY.pitch=0; "
                        "__dbg.FLY.comp=0; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.S._alt=14")
            pg.screenshot(path=H.output_path('shot_mobile_mission.jpg'), type='jpeg', quality=88)
            print('mobile-mission OK: briefing/progress/results/reset/rescue-touch all pass')
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
H._write_result('PASS', 'mobile mission OK')
print('RESULT PASS')