# -*- coding: utf-8 -*-
# Phase 19-补：特情处置可发现性——值级浏览器断言（playwright）
# 静态层：H 面板 U/N/I/J/K 五行；动态层：卡壳/超温/航电跨级的 just-in-time
# 提示（toast 通道不属信息战黑名单——hudFail 只隐藏 HUD 读数元素
# hud-mx/hud-alt/hud-threat/hud-rwr，70-app 消费段实证）。
# 断言全部条件等待（wait_for_function），无固定墙钟；特情注入走 damageSys
# 真实状态通道（与 test_damage D3/D4 同款手法）。
# 干扰源隔离（edge_cases B2 先例）：低帧下自动降档 toast 会在窗口内重置计时。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rig && __dbg.damageSys)", timeout=60000)
    pg.evaluate("document.getElementById('chk-qauto').checked = false; document.getElementById('chk-qauto').dispatchEvent(new Event('change'))")
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)

    # ---- S1: 静态层——H 面板可打开且含 U/N/I/J/K 五行 ----
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('h')
    pg.wait_for_function("() => document.getElementById('hint').classList.contains('show')", timeout=3000)
    rows = pg.evaluate("""() => {
      const desc = {};
      for (const tr of document.querySelectorAll('#hint tr')) {
        const tds = tr.querySelectorAll('td');
        if (tds.length === 2) desc[tds[0].textContent.trim()] = tds[1].textContent.trim();
      }
      return { keys: Object.keys(desc), desc };
    }""")
    for k in ['U', 'N', 'I', 'J', 'K']:
        assert k in rows['keys'], ('S1: H 面板缺键 ' + k, rows['keys'])
    for k, w in [('U', '降功率'), ('N', '上膛'), ('I', '重启'), ('J', '干扰弹'), ('K', '绞车')]:
        assert w in rows['desc'].get(k, ''), ('S1: ' + k + ' 描述缺关键词', k, rows['desc'].get(k))
    pg.evaluate("document.getElementById('hint-close').click()")
    print('S1 PASS: H 面板 U/N/I/J/K 五行齐全且描述含处置语义')

    # ---- S2: 卡壳发生 → toast 即时提示「按 N」 ----
    pg.evaluate("(() => { const d = __dbg.damageSys; d.rng = () => 0.5; d.jammed = true; })()")
    pg.wait_for_function("() => document.getElementById('toast').textContent.indexOf('按 N') >= 0"
                         " && document.getElementById('toast').classList.contains('show')", timeout=8000)
    print('S2a PASS: 卡壳发生瞬间 → toast「武器卡壳——按 N 重新上膛」')
    # 按 N 走完整处置链收尾（rng=0.5 < 0.75 必成功）——顺带验证提示描述的键真实可用
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('n')
    pg.wait_for_function("() => __dbg.damageSys.state().jamBusy", timeout=3000)
    pg.wait_for_function("() => !__dbg.damageSys.jammed && !__dbg.damageSys.state().jamBusy", timeout=8000)
    print('S2b PASS: N 处置链真实可用（3s 后解卡）')

    # ---- S3: 引擎超温 → toast 即时提示「按 U」 ----
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => !__dbg.damageSys.jammed && __dbg.damageSys.state().overheat === 0", timeout=3000)
    pg.evaluate("(() => { const d = __dbg.damageSys; d.sys.engine = 30; d.overheat = 1.0; })()")
    pg.wait_for_function("() => document.getElementById('toast').textContent.indexOf('按 U') >= 0"
                         " && document.getElementById('toast').classList.contains('show')", timeout=8000)
    print('S3 PASS: 引擎超温瞬间 → toast「引擎超温——按 U 降功率」')

    # ---- S4: 航电 Lv.2 跨级 → 告警附带「按 I」+ 信息战语义反向断言 ----
    # 直接置 sys.avionics 不产生跨级事件（applyHit 才有跨级检测）——走真实命中
    # 路径：front 扇区 avionics 权重 0.55、rng=0.5 扰动恒 1 → 100×0.55=55（lvl2）
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => __dbg.damageSys.sys.avionics === 0", timeout=3000)
    pg.evaluate("(() => { const d = __dbg.damageSys; d.rng = () => 0.5;"
                " d.applyHit({ dmg: 100, dir: { x: 0, y: 0, z: 1 } }); })()")
    pg.wait_for_function("() => document.getElementById('toast').textContent.indexOf('按 I') >= 0"
                         " && document.getElementById('toast').classList.contains('show')", timeout=8000)
    print('S4a PASS: 航电 Lv.2 跨级 → 告警附带「按 I 重启」')

    # S4b（重试式，edge_cases B2 先例）：hudFail 窗口（周期 8s 头 1.2s）内——
    # ① HUD 读数仍按信息战语义全黑（反向断言：证明本批未破坏原语义）；
    # ② toast 通道同时可用（注入新卡壳 → 「按 N」toast 在窗口内可见）。
    # 同帧双证；若注入/快照恰落窗尾出窗，最多重试 3 次（卡壳播报锁要求先
    # 归零再翻转才有新事件——每轮重臂）。
    s4b = None
    for _ in range(3):
        pg.wait_for_function("() => document.getElementById('hud-alt').textContent === '---'", timeout=12000)
        pg.evaluate("(() => { const d = __dbg.damageSys; d.jammed = false; })()")
        pg.wait_for_function("() => !__dbg.damageSys.jammed && !__dbg.damageSys._jamPrev", timeout=3000)
        pg.evaluate("(() => { const d = __dbg.damageSys; d.jammed = true; })()")
        try:
            pg.wait_for_function("() => document.getElementById('toast').textContent.indexOf('按 N') >= 0", timeout=4000)
            s4b = pg.evaluate("(() => ({ alt: document.getElementById('hud-alt').textContent,"
                              " mx: document.getElementById('hud-mx').textContent,"
                              " threat: document.getElementById('hud-threat').textContent,"
                              " toast: document.getElementById('toast').textContent }))()")
            if s4b['alt'] == '---' and s4b['mx'] == '---' and s4b['threat'] == '---' and '按 N' in s4b['toast']:
                break
            s4b = None
        except Exception:
            s4b = None
    assert s4b is not None, 'S4b: hudFail 窗口内 HUD 应 ---（信息战保持）且 toast 通道可用（3 次未双证）'
    assert s4b['alt'] == '---' and s4b['mx'] == '---' and s4b['threat'] == '---', ('S4b: 信息战语义被破坏', s4b)
    assert '按 N' in s4b['toast'], ('S4b: toast 通道在 hudFail 窗口内应可用', s4b)
    print('S4b PASS: hudFail 窗口内 HUD 读数 ---（信息战保持）且 toast 可见')

    # ---- 收尾：复位 + 截图 ----
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => document.getElementById('hud-mx').textContent === 'OK'", timeout=5000)
    pg.screenshot(path=H.output_path('shot_damage_hints.jpg'), type='jpeg', quality=88)
    print('Phase 19 discoverability OK: S1-S4 全过')


import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
