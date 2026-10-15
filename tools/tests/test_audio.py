# -*- coding: utf-8 -*-
# Phase 13-A1 音频样本层定向测试（可闻性修复版——双总线架构）：
#   A) 用户手势 → AudioContext 启动 + 4 个 WAV 样本异步加载完成
#   G) 旋翼运行：engine 样本增益随转速、master 总线>0、wind 混合、brass/thunder
#      一次性通道——既有行为零回归（含运行态静音非空证：master>0.05→静音→归零→恢复）
#   B-F) 停机沙暴可听闭环（复核三轮红线）：
#      B 旋翼停转 spin=0（master 旋翼总线衰减归零——rotor-only 语义）
#      C 沙暴 windLevel>=1
#      D 停机+沙暴+未静音：windGain>0.20（支路强度）且 windOutputGain>0.5
#        （环境总线门开）且 windBus=='ambient'（接线事实）且 ambientRMS()>0.010
#        （探针实测信号真实流动——不是增益代数冒充）
#      E 静音：windOutputGain/master 归零 + ambientRMS≈0（信号级归零）+ windGain 归零
#      F 解除静音（仍停机仍沙暴）：信号恢复 ambientRMS>0.015 + windGain>0.20
#      收尾 setWind(0)：不残留沙暴强度（windGain 回微风底噪）
# 值级断言走 __dbg.audio.state()/ambientRMS() 只读遥测；全部 wait_for_function
# 状态等待（等待真实音频参数收敛），无固定 sleep 冒充。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    # ---- A) 手势 + 样本就绪 ----
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    pg.mouse.click(640, 400)   # 手势：audioKick 挂在 window pointerdown
    pg.wait_for_function("() => __dbg.audio && __dbg.audio.state().started", timeout=10000)
    pg.wait_for_function("() => __dbg.audio.state().samples === 4", timeout=15000)
    st = pg.evaluate("__dbg.audio.state()")
    print('A1 样本加载:', st)
    assert st['samples'] == 4 and st['sampFailed'] == 0, ('A1: 样本未全部加载', st)
    # 接线事实：wind 必须在环境总线上（可闻性红线——增益代数不排除接线错误）
    assert st['windBus'] == 'ambient', ('A1: wind 未接环境总线', st)

    # ---- G-part1) 旋翼运行：engine 随转速（既有行为零回归）----
    pg.evaluate("__dbg.S.running = true")
    pg.wait_for_function("() => __dbg.audio.state().engineGain > 0.02", timeout=6000)
    eg = pg.evaluate("__dbg.audio.state().engineGain")
    assert eg > 0.02, ('A1: engine 样本增益未随旋翼上升', eg)
    # ---- 一次性通道：brass / thunder ----
    pg.evaluate("__dbg.audio.playSample('brass')")
    b1 = pg.evaluate("__dbg.audio.state().brass")
    assert b1 == 1, ('A1: brass 触发未计数', b1)
    pg.evaluate("__dbg.audio.playSfx('thunder', 1)")
    t1 = pg.evaluate("__dbg.audio.state().thunder")
    assert t1 == 1, ('A1: thunder 未计数', t1)
    print('G 引擎/brass/thunder OK: engineGain=%s brass=%s thunder=%s' % (round(eg, 3), b1, t1))
    # ---- G-part2) 运行态混合：master 总线>0 且 wind 沙暴混合不变 ----
    pg.evaluate("__dbg.audio.setWind(1)")
    pg.wait_for_function("() => __dbg.audio.state().windGain > 0.2", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.state().masterGain > 0.05", timeout=15000)
    print('G 运行态混合 OK: windGain=', pg.evaluate("+__dbg.audio.state().windGain.toFixed(3)"),
          'master=', pg.evaluate("+__dbg.audio.state().masterGain.toFixed(3)"))
    # ---- 静音守卫：toggle 后 playSample 不再触发（既有行为零回归）----
    pg.evaluate("__dbg.audio.toggle()")
    pg.evaluate("__dbg.audio.playSample('brass')")
    b2 = pg.evaluate("__dbg.audio.state().brass")
    assert b2 == 1, ('A1: 静音后 brass 仍触发', b2)
    # ---- G-part3) 运行态静音非空证：master 从>0.05 归零（静音因果隔离）----
    pg.wait_for_function("() => __dbg.audio.state().masterGain < 0.005", timeout=8000)
    pg.evaluate("__dbg.audio.toggle()")   # 解除（旋翼运行态恢复）
    pg.wait_for_function("() => __dbg.audio.state().masterGain > 0.05", timeout=10000)
    pg.evaluate("__dbg.audio.setWind(0)")
    print('G 运行态静音非空证 OK: master>0.05 → 静音归零 → 解除恢复')

    # ---- B) 停机：旋翼停转/转速 0（master 旋翼总线自然衰减——rotor-only 语义）----
    pg.evaluate("__dbg.S.running = false; __dbg.S.spin = 0")
    pg.wait_for_function("() => __dbg.audio.state().masterGain < 0.05", timeout=8000)
    # ---- C) 切入沙暴：windLevel>=1 ----
    pg.evaluate("__dbg.audio.setWind(1)")
    pg.wait_for_function("() => __dbg.audio.state().windLevel >= 1", timeout=3000)
    # ---- D) 停机+沙暴+未静音：可听路径完整证明（红线断言，四重证据）----
    pg.wait_for_function("() => __dbg.audio.state().windGain > 0.20", timeout=10000)
    pg.wait_for_function("() => __dbg.audio.state().windOutputGain > 0.5", timeout=8000)
    # 探针实测：环境总线 post-gain 真实信号电平（沙暴风声真实流动，非增益代数）
    pg.wait_for_function("() => __dbg.audio.ambientRMS() > 0.010", timeout=10000)
    d = pg.evaluate("({wind: +__dbg.audio.state().windGain.toFixed(3), out: +__dbg.audio.state().windOutputGain.toFixed(3), bus: __dbg.audio.state().windBus, rms: +__dbg.audio.ambientRMS().toFixed(4), master: +__dbg.audio.state().masterGain.toFixed(4)})")
    print('D 停机沙暴可听 OK:', d)
    assert d['wind'] > 0.19 and d['out'] > 0.5 and d['rms'] > 0.010, ('D: 可听路径不完整', d)
    assert d['master'] < 0.05, ('D: 旋翼总线停机未归零（rotor-only 语义破坏）', d)
    # ---- E) 静音：所有最终可听输出（环境+旋翼总线）信号级归零 ----
    pg.evaluate("__dbg.audio.toggle()")
    pg.wait_for_function("() => __dbg.audio.state().windOutputGain < 0.005", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.state().masterGain < 0.005", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.ambientRMS() < 0.001", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.state().windGain < 0.05", timeout=8000)
    e = pg.evaluate("({out: +__dbg.audio.state().windOutputGain.toFixed(4), master: +__dbg.audio.state().masterGain.toFixed(4), rms: +__dbg.audio.ambientRMS().toFixed(4), wind: +__dbg.audio.state().windGain.toFixed(3)})")
    print('E 静音归零 OK:', e)
    assert e['out'] < 0.005 and e['master'] < 0.005 and e['rms'] < 0.001, ('E: 静音未归零', e)
    # ---- F) 解除静音（仍停机、仍沙暴）：环境风声信号恢复 ----
    pg.evaluate("__dbg.audio.toggle()")
    pg.wait_for_function("() => __dbg.audio.state().windOutputGain > 0.5", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.state().windGain > 0.20", timeout=10000)
    pg.wait_for_function("() => __dbg.audio.ambientRMS() > 0.010", timeout=10000)
    f = pg.evaluate("({out: +__dbg.audio.state().windOutputGain.toFixed(3), wind: +__dbg.audio.state().windGain.toFixed(3), rms: +__dbg.audio.ambientRMS().toFixed(4), master: +__dbg.audio.state().masterGain.toFixed(4)})")
    print('F 解除静音恢复 OK:', f)
    assert f['rms'] > 0.010 and f['wind'] > 0.19, ('F: 风声未恢复', f)
    assert f['master'] < 0.05, ('F: 旋翼总线被误放开（停机放出旋翼程序音）', f)
    # ---- 收尾：切回非沙暴不残留大风声（windGain 回微风底噪 0.02）----
    pg.evaluate("__dbg.audio.setWind(0)")
    pg.wait_for_function("() => __dbg.audio.state().windGain < 0.05", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.ambientRMS() < 0.02", timeout=8000)
    print('B-F 停机沙暴可听闭环 PASS: 信号真实流动→静音归零→解除恢复→无残留')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')
