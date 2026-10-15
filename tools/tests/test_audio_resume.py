# -*- coding: utf-8 -*-
# 最终闭环修复四：AudioContext 挂起后手势恢复验证。
# 启动音频确认 running → 主动 ctx.suspend() → 触发规定恢复手势（轻量 resumeKick）
# → 等 ctx.state==='running' → 验证停机沙暴 ambient RMS 恢复 → 无重复节点/连接
# → 静音状态不因 resume 被错误解除。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!window.__dbg && __dbg.audio", timeout=60000)
    # 手势启动 AudioContext（audioKick 挂 pointerdown）
    pg.mouse.click(640, 400)
    pg.wait_for_function("() => __dbg.audio.ctx && __dbg.audio.ctx.state === 'running'", timeout=10000)
    pg.wait_for_function("() => __dbg.audio.state().samples === 4", timeout=15000)
    # 沙暴风声打开（停机）——作为可恢复信号源
    pg.evaluate("__dbg.S.running = false; __dbg.S.spin = 0")
    pg.evaluate("document.querySelector('#weather-row [data-weather=\"sand\"]').click()")
    pg.wait_for_function("() => __dbg.audio.state().windGain > 0.2", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.ambientRMS() > 0.01", timeout=8000)
    rms0 = pg.evaluate("__dbg.audio.ambientRMS()")
    print('AR 沙暴风声基线 RMS:', round(rms0, 4))

    # 记录节点实例指纹（防重复创建）
    nodeFp = pg.evaluate("""() => ({
      master: !!__dbg.audio.master, ambient: !!__dbg.audio.ambient, musicBus: !!__dbg.audio.musicBus,
      sampKeys: Object.keys(__dbg.audio._sampGain || {}).sort().join(','),
      srcKeys: Object.keys(__dbg.audio._src || {}).sort().join(',')
    })""")
    print('AR 节点指纹:', nodeFp)

    # 主动 suspend（模拟切后台/设备切换）
    pg.evaluate("__dbg.audio.ctx.suspend()")
    pg.wait_for_function("() => __dbg.audio.ctx.state === 'suspended'", timeout=6000)
    print('AR ctx suspended OK')

    # 触发恢复手势（轻量 resumeKick：pointerdown/keydown）→ 等 running
    pg.mouse.click(640, 400)
    pg.wait_for_function("() => __dbg.audio.ctx.state === 'running'", timeout=8000)
    print('AR resume 恢复 running OK')

    # 沙暴风声恢复（ambient RMS 重新流动）
    pg.wait_for_function("() => __dbg.audio.ambientRMS() > 0.008", timeout=8000)
    rms1 = pg.evaluate("__dbg.audio.ambientRMS()")
    assert rms1 > 0.008, ('AR: resume 后风声 RMS 未恢复', rms1)
    print('AR 风声 RMS 恢复:', round(rms1, 4))

    # 无重复节点/连接（复核修复）：布尔指纹不足——连续 suspend/resume 后节点
    # 集合必须不增长（18-audio resume 路径只调 ctx.resume()，不重建任何节点）
    nodeFp2 = pg.evaluate("""() => ({
      master: !!__dbg.audio.master, ambient: !!__dbg.audio.ambient, musicBus: !!__dbg.audio.musicBus,
      sampKeys: Object.keys(__dbg.audio._sampGain || {}).sort().join(','),
      srcKeys: Object.keys(__dbg.audio._src || {}).sort().join(',')
    })""")
    assert nodeFp == nodeFp2, ('AR: resume 后节点被重复创建', nodeFp, nodeFp2)
    # 连续 3 次 suspend/resume：节点集合/连接集合必须保持不变（不增长）
    nodeSet = pg.evaluate("Object.keys(__dbg.audio._sampGain || {}).sort().join(',') + '|' + Object.keys(__dbg.audio._src || {}).sort().join(',')")
    for _ in range(3):
        pg.evaluate("__dbg.audio.ctx.suspend()")
        pg.wait_for_function("() => __dbg.audio.ctx.state === 'suspended'", timeout=6000)
        pg.mouse.click(640, 400)
        pg.wait_for_function("() => __dbg.audio.ctx.state === 'running'", timeout=8000)
    nodeSet2 = pg.evaluate("Object.keys(__dbg.audio._sampGain || {}).sort().join(',') + '|' + Object.keys(__dbg.audio._src || {}).sort().join(',')")
    assert nodeSet == nodeSet2, ('AR: 多次 suspend/resume 后节点增长', nodeSet, nodeSet2)
    print('AR 无重复节点 OK（含 3 次 suspend/resume 不增长）')

    # 静音状态不因 resume 被错误解除：静音→suspend→resume→仍静音（wind 输出门关）
    pg.evaluate("__dbg.audio.toggle()")    # 静音
    pg.wait_for_function("() => !__dbg.audio.state().enabled", timeout=4000)
    pg.wait_for_function("() => __dbg.audio.state().windOutputGain < 0.05", timeout=6000)
    pg.evaluate("__dbg.audio.ctx.suspend()")
    pg.wait_for_function("() => __dbg.audio.ctx.state === 'suspended'", timeout=6000)
    pg.mouse.click(640, 400)               # resume 手势
    pg.wait_for_function("() => __dbg.audio.ctx.state === 'running'", timeout=8000)
    st = pg.evaluate("({enabled: __dbg.audio.state().enabled, windOut: +__dbg.audio.state().windOutputGain.toFixed(3)})")
    assert not st['enabled'] and st['windOut'] < 0.05, ('AR: resume 不应解除静音', st)
    print('AR 静音保持 OK:', st)
    pg.evaluate("__dbg.audio.toggle()")    # 恢复
    pg.wait_for_function("() => __dbg.audio.state().enabled", timeout=4000)

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')