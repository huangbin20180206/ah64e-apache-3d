# -*- coding: utf-8 -*-
# Phase 11 X1-X6 跨端体验值级测试：
#   X1  模式 chip aria-pressed；触屏 toast 字号 ≥14px；Tab 顺序（启旋→起飞→模式行）
#   X2  hint 对话框含训练/变体/摇杆说明；窄屏可滚动（max-height:70vh; overflow-y:auto）
#   X3  移动端训练提示（toast）与摇杆不相交；变体 chip flex-wrap；结算窄屏字号 ≥13px
#   X4  变体 chip aria-pressed；方向键切换变体；纯键盘可聚焦模式 chip
#   X5  reduced-motion：结算面板无 transition（transition-duration 0s）
# 自管浏览器（需要 has_touch 移动端 context + --force-prefers-reduced-motion 全局 flag），
# 补齐同等可靠性保护：看门狗硬超时 / 结果落盘 / 错误收集（仿 test_mobile）。
import sys, os, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def _watchdog():
    H._write_result('FAIL', 'cross-platform watchdog timeout (240s)', skipped=True)
    print('RESULT FAIL reason=cross-platform watchdog timeout', flush=True)
    os._exit(3)
_wd = threading.Timer(240, _watchdog)
_wd.start()
errors = []
b = None
try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=H.HEADLESS, args=H.browser_args())
        # ================= 桌面页（1920×1080） =================
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.emulate_media(reduced_motion='reduce')         # X5：reduced-motion 全局启用
        pg.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
        pg.on('console', lambda m: errors.append('console.error: %s' % m.text) if m.type == 'error' else None)
        pg.goto(H.BASE + '/?nocine=1&nocut=1', wait_until='domcontentloaded')
        pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rig)", timeout=60000)
        pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
        pg.evaluate("__dbg.S._guide = 0")
        pg.wait_for_timeout(400)

        # X1：Tab 顺序——启旋(1) → 起飞(2) → 模式行(3,4,5)
        seq = []
        for _ in range(3):
            pg.keyboard.press('Tab')
            seq.append(pg.evaluate("() => { const a=document.activeElement; return a ? (a.id || (a.parentElement && a.parentElement.id) || a.className) : '' }"))
        assert seq[0] == 'btn-start', ('X1: Tab 1 应到启旋按钮', seq)
        assert seq[1] == 'btn-fly', ('X1: Tab 2 应到起飞', seq)
        assert seq[2] == 'mode-row', ('X1: Tab 3 应到模式行', seq)

        # X1：模式 chip aria-pressed
        ap = pg.evaluate("() => [...document.querySelectorAll('#mode-row .chip')].every(c => c.getAttribute('aria-pressed') !== null)")
        assert ap, 'X1: 模式 chip 缺 aria-pressed'

        # X2：hint 含训练/变体/摇杆说明
        pg.evaluate("document.getElementById('btn-help').click()")
        pg.wait_for_timeout(300)
        hintTxt = pg.evaluate("document.getElementById('hint').textContent")
        assert '训练模式' in hintTxt and '任务变体' in hintTxt and '左摇杆' in hintTxt, ('X2: hint 缺训练/变体/摇杆说明', hintTxt[:120])
        pg.evaluate("document.getElementById('hint-close').click()")

        # X4：变体 chip aria-pressed（进 mission 简报）
        pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
        pg.wait_for_timeout(300)
        pg.evaluate("__dbg.startMission()")
        pg.wait_for_timeout(400)
        vp = pg.evaluate("() => [...document.querySelectorAll('#mission-variants .chip')].every(c => c.getAttribute('aria-pressed') !== null)")
        assert vp, 'X4: 变体 chip 缺 aria-pressed'

        # X5：reduced-motion 下结算面板无 transition（制造一次完成）
        pg.evaluate("__dbg.beginMission()")
        pg.wait_for_timeout(300)
        pg.evaluate("__dbg.air.enabled = false")
        pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
        # B6+：#mission 由 loop-reachable 写——等任务真正结算，再读 CSS（分类器真候选 L71→L73）
        pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", timeout=20000)
        td = pg.evaluate("getComputedStyle(document.getElementById('mission')).transitionDuration")
        assert td == '0s', ('X5: reduced-motion 下结算面板不应有 transition', td)

        # X4：方向键切换变体（radiogroup 内 ArrowLeft/Right 移动焦点并选中）
        pg.evaluate("__dbg.retryMission()")
        # 状态等待：retryMission 重绘 chips（renderVariantChips 内 setTimeout(0)
        # 焦点恢复）——等 standard chip 选中（低帧下固定 sleep 不足）
        try:
            pg.wait_for_function("""() => {
              const c = document.querySelector('#mission-variants [data-variant="standard"]');
              return c && c.classList.contains('on');
            }""", timeout=6000)
        except Exception:
            dbg = pg.evaluate("""() => ({
              phase: __dbg.mission ? __dbg.mission.phase : null,
              chips: document.querySelectorAll('#mission-variants .chip').length,
              show: document.getElementById('mission').classList.contains('show'),
              cutOn: __dbg.cutsceneState ? __dbg.cutsceneState.on : false,
              cutReason: __dbg.cutsceneState ? __dbg.cutsceneState.reason : null,
              err: window.__err || null,
            })""")
            raise AssertionError('X4: standard chip 未选中（诊断）: %r' % dbg)
        pg.evaluate("document.querySelector('#mission-variants [data-variant=\"standard\"]').focus()")
        pg.keyboard.press('ArrowRight')
        # 状态等待：方向键选中生效（variant 切换），非固定 sleep
        pg.wait_for_function("() => __dbg.mission.variant === 'timed_rescue'", timeout=6000)
        assert pg.evaluate("__dbg.mission.variant") == 'timed_rescue', 'X4: 方向键右应切到限时救援'
        # ArrowLeft 前确保焦点在 row 内（setMissionVariant 重绘 chips 会销毁
        # 原聚焦元素，setTimeout(0) 焦点恢复在低帧下偶发未生效——显式聚焦当前
        # 选中 chip 使方向键事件正确落入 radiogroup handler）
        pg.evaluate("document.querySelector('#mission-variants [data-variant=\"timed_rescue\"]').focus()")
        pg.keyboard.press('ArrowLeft')
        pg.wait_for_function("() => __dbg.mission.variant === 'standard'", timeout=6000)
        assert pg.evaluate("__dbg.mission.variant") == 'standard', 'X4: 方向键左应切回标准'
        pg.close()

        # ================= 移动端页（390×844 + has_touch） =================
        pm = b.new_page(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pm.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
        pm.on('console', lambda m: errors.append('console.error: %s' % m.text) if m.type == 'error' else None)
        pm.goto(H.BASE + '/?nocine=1', wait_until='domcontentloaded')
        pm.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rig)", timeout=60000)
        pm.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
        pm.evaluate("__dbg.S._guide = 0")
        pm.wait_for_timeout(400)

        # 移动端面板默认打开会隐藏摇杆（#panel:not(.hide) ~ #mstick 让位设计）——
        # 先关面板让摇杆可见（mode-row chip 仍在 DOM，evaluate click 不受影响）
        pm.evaluate("document.getElementById('btn-panel').click()")
        pm.wait_for_timeout(400)

        # X3：训练提示（toast）与摇杆不相交——切训练产生训练 toast
        pm.evaluate("document.querySelector('#mode-row [data-mode=\"train\"]').click()")
        pm.wait_for_timeout(300)
        boxes = pm.evaluate("() => { const t=document.getElementById('toast').getBoundingClientRect(); const s=document.getElementById('mstick-l').getBoundingClientRect(); return {t:{top:t.top,bottom:t.bottom}, s:{top:s.top,bottom:s.bottom}} }")
        assert boxes['t']['bottom'] < boxes['s']['top'], ('X3: 训练提示与摇杆重叠', boxes)

        # X1：触屏 toast 字号 ≥14px
        tfs = pm.evaluate("parseFloat(getComputedStyle(document.getElementById('toast')).fontSize)")
        assert tfs >= 14, ('X1: 触屏 toast 字号应 ≥14px', tfs)

        # X2：hint 窄屏可滚动（computed maxHeight 返回解析后 px：70vh×844≈590.8）
        hintCss = pm.evaluate("(() => { const h=document.getElementById('hint'); const s=getComputedStyle(h); return {mh:parseFloat(s.maxHeight), oy:s.overflowY, vh:innerHeight} })()")
        assert abs(hintCss['mh'] - hintCss['vh'] * 0.7) < 1 and hintCss['oy'] == 'auto', ('X2: hint 窄屏应可滚动', hintCss)

        # X3：变体 chip flex-wrap（允许窄屏换行不溢出）——进 mission 简报
        pm.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
        pm.wait_for_timeout(300)
        pm.evaluate("__dbg.startMission()")
        pm.wait_for_timeout(400)
        fw = pm.evaluate("getComputedStyle(document.getElementById('mission-variants')).flexWrap")
        assert fw == 'wrap', ('X3: 变体 chip 应 flex-wrap', fw)

        # X3：结算面板窄屏字号 ≥13px（制造一次完成）
        pm.evaluate("__dbg.beginMission()")
        pm.wait_for_timeout(300)
        pm.evaluate("__dbg.air.enabled = false")
        pm.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
        pm.wait_for_timeout(1500)
        fs = pm.evaluate("parseFloat(getComputedStyle(document.getElementById('mission')).fontSize)")
        assert fs >= 13, ('X3: 结算面板窄屏字号应 ≥13px', fs)
        pm.close()
finally:
    _wd.cancel()
    try:
        if b is not None:
            b.close()
    except Exception:
        pass
if errors:
    H._write_result('FAIL', 'errors: %s' % errors[:3])
    print('RESULT FAIL reason=%s' % errors[:3])
    raise SystemExit(1)
H._write_result('PASS', 'cross-platform OK')
print('RESULT PASS')
