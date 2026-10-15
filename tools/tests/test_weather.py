# -*- coding: utf-8 -*-
# Phase 13-M4 动态天气定向测试：
#   1) 默认 none：沙尘不可见、雾密度=场地基准
#   2) 切沙暴（可闻性修复三轮：停机风声真实可听）：dustVisible、uSand 缓变 >0.5、
#      fog 密度升至 >基准×1.5、windLevel>=1 且 windGain>0.20 + windOutputGain>0.5
#      （环境总线门开）+ windBus=='ambient'（接线事实）+ ambientRMS>0.015（探针
#      实测信号流动）、M3 体积光 ×1.8 加成（dusk 太阳入屏对比）
#   3) 切雷暴：dustVisible 关、闪电随机调度 flashCount 递增（≤8s）、
#      雷声延迟后 audio thunder 计数递增
#   4) 切回 none：雾密度回到基准、uSand=0
# 值级断言走 __dbg.weather.state() / __dbg.audio.state() / __dbg.audio.ambientRMS() 只读遥测。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    pg.mouse.click(640, 400)   # 手势：启动 AudioContext（雷声/风声走音频链）
    pg.wait_for_function("() => __dbg.audio && __dbg.audio.state().started", timeout=10000)
    # 1) 默认无天气
    st0 = pg.evaluate("__dbg.weather.state()")
    print('M4 默认:', st0)
    assert st0['mode'] == 'none' and not st0['dustVisible'] and st0['uSand'] == 0, ('M4: 默认天气异常', st0)
    base0 = st0['fogDensity']
    # 2) 沙暴——重点复核项（可闻性修复三轮）：停机（旋翼未运行）时风声样本
    #    也必须真实可听。wind 走独立环境总线（ambient，直连 destination，不受
    #    旋翼 spin 门控）——此处验证真实风声输出闭环：windGain（支路强度）+
    #    windOutputGain（环境总线门）+ windBus（接线事实）+ ambientRMS（探针
    #    实测信号真实流动），不只验 windLevel。
    pg.evaluate("__dbg.S.running = false; __dbg.S.spin = 0")   # 明确确保旋翼未运行/转速 0
    pg.wait_for_function("() => __dbg.audio.state().samples === 4", timeout=15000)   # wind 循环节点就绪
    pg.evaluate("document.querySelector('#weather-row [data-weather=\"sand\"]').click()")
    pg.wait_for_function("() => __dbg.weather.state().mode === 'sand'", timeout=3000)
    pg.wait_for_function("() => __dbg.weather.state().uSand > 0.5", timeout=8000)   # 缓变收敛
    # 停机沙暴风声真实输出闭环（状态等待而非固定墙钟）
    pg.wait_for_function("() => __dbg.audio.state().windGain > 0.20", timeout=10000)
    pg.wait_for_function("() => __dbg.audio.state().windOutputGain > 0.5", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.ambientRMS() > 0.015", timeout=10000)
    st1 = pg.evaluate("__dbg.weather.state()")
    ag1 = pg.evaluate("({wind: +__dbg.audio.state().windGain.toFixed(3), out: +__dbg.audio.state().windOutputGain.toFixed(3), bus: __dbg.audio.state().windBus, rms: +__dbg.audio.ambientRMS().toFixed(4)})")
    print('M4 沙暴:', st1, '| audio:', ag1)
    assert st1['dustVisible'] and st1['fogDensity'] > base0 * 1.5, ('M4: 沙暴 fog/沙尘异常', st1)
    assert st1['windLevel'] >= 1 and ag1['wind'] > 0.20, ('M4: 停机沙暴风声未生效（windGain 被转速门控钳制）', st1, ag1)
    assert ag1['out'] > 0.5 and ag1['rms'] > 0.015 and ag1['bus'] == 'ambient', ('M4: 停机沙暴可听路径不完整（环境总线/信号未流动）', ag1)
    # M3 体积光加成：dusk + 相机对准太阳（test_cinematic S2 取景）→ 对比 none/sand 的 god
    pg.evaluate("document.querySelector('#env-row [data-env=\"dusk\"]').click()")
    pg.wait_for_timeout(500)
    baseEnv = pg.evaluate("+__dbg.W.fogBase.d.toFixed(4)")   # 切黄昏后的场地雾基准（dusk=0.0070）
    print('M4 dusk 雾基准:', baseEnv)
    pg.evaluate("""() => {
      const d = __dbg.W.sun.position;
      const th = Math.atan2(d.x, d.z) + Math.PI;
      const o = __dbg.orbit;
      o.tTarget.set(0, 2, 0); o.target.copy(o.tTarget);
      o.tTheta = th; o.tPhi = 1.35; o.tDist = 14;
    }""")
    # B6+：composer.god 由 70-app.js:663 loop 每帧写（分类器真候选 L57→L59）——等加成生效
    pg.wait_for_function("() => __dbg.composer.god > 0.33 * 1.5", timeout=15000)
    godSand = pg.evaluate("+__dbg.composer.god.toFixed(3)")
    assert godSand > 0.33 * 1.5, ('M4: 沙暴体积光加成未生效', godSand)
    pg.evaluate("document.querySelector('#weather-row [data-weather=\"none\"]').click()")
    pg.wait_for_function("(gs) => __dbg.composer.god < gs", arg=godSand, timeout=15000)
    godNone = pg.evaluate("+__dbg.composer.god.toFixed(3)")
    print('M4 god 加成对比: sand=', godSand, 'none=', godNone)
    assert godNone < godSand, ('M4: 沙暴取消后 god 未回落', godNone, godSand)
    # 3) 夜雷暴
    pg.evaluate("document.querySelector('#weather-row [data-weather=\"storm\"]').click()")
    pg.wait_for_function("() => __dbg.weather.state().mode === 'storm'", timeout=3000)
    st2 = pg.evaluate("__dbg.weather.state()")
    assert not st2['dustVisible'], ('M4: 雷暴未关沙尘', st2)
    # 闪电调度（2.5~6.5s 随机间隔，8s 窗足够等到第一闪）
    pg.wait_for_function("() => __dbg.weather.state().flashCount >= 1", timeout=10000)
    fl = pg.evaluate("__dbg.weather.state().flashCount")
    assert fl >= 1, ('M4: 闪电未触发', fl)
    print('M4 闪电 OK: flashCount =', fl)
    # 雷声延迟（闪电后 0.6~2.2s 雷到；音频已启动，5s 窗等待）
    pg.wait_for_function("() => __dbg.audio.state().thunder >= 1", timeout=8000)
    th = pg.evaluate("__dbg.audio.state().thunder")
    assert th >= 1, ('M4: 雷声未触发', th)
    print('M4 雷声 OK: thunder =', th)
    # 4) 切回 none
    pg.evaluate("document.querySelector('#weather-row [data-weather=\"none\"]').click()")
    pg.wait_for_function("() => __dbg.weather.state().mode === 'none'", timeout=3000)
    pg.wait_for_timeout(800)
    st3 = pg.evaluate("__dbg.weather.state()")
    print('M4 复位:', st3)
    assert not st3['dustVisible'] and st3['uSand'] == 0, ('M4: 复位异常', st3)
    # 雾密度回落：沙暴 3.2× 加成已撤除（当前环境=黄昏基准 0.0070；允许 WashFX
    # brownout 残量，雾写入单一持有者是 washfx——查基准真源 + 乘数，不查精确相等）
    assert st3['fogDensity'] < baseEnv * 1.5, ('M4: 沙暴雾未撤除', st3, baseEnv)

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')
