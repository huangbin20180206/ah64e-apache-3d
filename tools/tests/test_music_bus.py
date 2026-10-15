# -*- coding: utf-8 -*-
# 最终闭环修复五：独立 music bus 路由语义验证。
#   A) 停机 ambient 模式：music 输出存在（musicBus 门开、pad 支路 >0、bus=='music'）
#   B) 停机 battle 模式：music 输出存在（鼓机调度 + musicBus 门开）
#   C) wind probe 不得把 music 信号计入 wind RMS（music 走独立 musicBus）
#   D) 静音后三类最终输出（rotor master/wind ambient/music bus）均归零
#   E) 解除静音后 wind/music 恢复，rotor 在停机时仍保持无声
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!window.__dbg && __dbg.audio && __dbg.music", timeout=60000)
    pg.mouse.click(640, 400)   # 手势启动 AudioContext
    pg.wait_for_function("() => __dbg.audio.ctx && __dbg.audio.ctx.state === 'running'", timeout=10000)
    pg.wait_for_function("() => __dbg.audio.state().samples === 4", timeout=15000)
    # 停机（旋翼不转）+ ambient 模式
    pg.evaluate("__dbg.S.running = false; __dbg.S.spin = 0")
    pg.wait_for_function("() => __dbg.music.state().mode === 'ambient'", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.state().padBus === 'music'", timeout=6000)
    pg.wait_for_function("() => __dbg.music.state().padGain > 0.1", timeout=10000)
    # musicBus 门由 update() 以 setTargetAtTime(tc=0.08) 驱动——从 0 渐近 1 需
    # ~0.5s，等 musicOut 收敛而非立即读（状态等待）
    pg.wait_for_function("() => __dbg.audio.state().musicOutputGain > 0.5", timeout=6000)
    stA = pg.evaluate("""() => ({
      padGain: __dbg.music.state().padGain, padBus: __dbg.audio.state().padBus,
      musicOut: +__dbg.audio.state().musicOutputGain.toFixed(3),
      master: +__dbg.audio.state().masterGain.toFixed(3),
      windOut: +__dbg.audio.state().windOutputGain.toFixed(3)
    })""")
    print('MB ambient:', stA)
    assert stA['padGain'] > 0.1 and stA['padBus'] == 'music', ('A: pad 未走音乐总线', stA)
    assert stA['musicOut'] > 0.5, ('A: 停机 ambient music 输出门未开', stA)
    assert stA['master'] < 0.05, ('A: 停机 rotor master 应归零', stA)
    # 停机时 music 输出存在（musicBus 门开 + pad 支路>0 = 可闻路径完整）
    print('A 停机 ambient music 可闻路径 OK')

    # C) wind probe 不因 music 污染：ambient RMS（wind 探针）在 music 播放下仍为 0
    #（无沙暴时 wind 支路≈0.02 微风底噪；music 独立总线不接 ambient）
    pg.wait_for_timeout(600)
    windRms = pg.evaluate("__dbg.audio.ambientRMS()")
    print('C 无沙暴 wind RMS（music 播放中）:', round(windRms, 4))
    # 微风底噪极低（<0.005 量级）；若 music 误入 ambient 探针会明显更高
    assert windRms < 0.01, ('C: music 信号污染了 wind probe', windRms)

    # B) 停机 battle 模式：music 输出存在（鼓机调度）
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => __dbg.music.state().mode === 'battle'", timeout=4000)
    pg.wait_for_function("() => __dbg.music.state().beat > 0", timeout=6000)
    stB = pg.evaluate("""() => ({
      mode: __dbg.music.state().mode, musicOut: +__dbg.audio.state().musicOutputGain.toFixed(3),
      master: +__dbg.audio.state().masterGain.toFixed(3), bus: __dbg.audio.state().padBus
    })""")
    print('B battle:', stB)
    assert stB['musicOut'] > 0.5, ('B: 停机 battle music 输出门未开', stB)
    assert stB['master'] < 0.05, ('B: 停机 rotor master 应保持归零', stB)
    print('B 停机 battle music 可闻路径 OK')

    # D) 静音后三类最终输出均归零（setTargetAtTime 渐近收敛，门值 <0.1 即无声——
    #    可听门是 0.5+，静音语义成立）
    pg.evaluate("__dbg.audio.toggle()")
    pg.wait_for_function("() => !__dbg.audio.state().enabled", timeout=4000)
    pg.wait_for_function("""() => {
      const s = __dbg.audio.state();
      return s.masterGain < 0.1 && s.windOutputGain < 0.1 && s.musicOutputGain < 0.1;
    }""", timeout=6000)
    stD = pg.evaluate("""() => ({ m: +__dbg.audio.state().masterGain.toFixed(3),
      w: +__dbg.audio.state().windOutputGain.toFixed(3), u: +__dbg.audio.state().musicOutputGain.toFixed(3) })""")
    assert stD['m'] < 0.1 and stD['w'] < 0.1 and stD['u'] < 0.1, ('D: 静音未关三类输出', stD)
    print('D 静音三类归零 OK:', stD)

    # E) 解除静音：wind/music 恢复，rotor 停机仍无声
    pg.evaluate("__dbg.audio.toggle()")
    pg.wait_for_function("() => __dbg.audio.state().enabled", timeout=4000)
    pg.wait_for_function("""() => {
      const s = __dbg.audio.state();
      return s.musicOutputGain > 0.5 && s.masterGain < 0.1;
    }""", timeout=6000)
    stE = pg.evaluate("""() => ({ m: +__dbg.audio.state().masterGain.toFixed(3),
      w: +__dbg.audio.state().windOutputGain.toFixed(3), u: +__dbg.audio.state().musicOutputGain.toFixed(3) })""")
    assert stE['u'] > 0.5, ('E: 解除静音后 music 未恢复', stE)
    assert stE['m'] < 0.1, ('E: 停机 rotor 不应恢复发声', stE)
    print('E 解除静音恢复 OK:', stE)

    # F) 停机 brass 真实可闻（复核一轮项四加强）：必须先停止 battle/pad 并等
    #    musicRMS 归零，再经 FilmMusic.brass() 真实入口（70-app 击毁反馈同一方法，
    #    非底层 playSample）触发；证明停转可听、wind probe 不受污染、mute 归零、
    #    unmute 后可再次触发。
    pg.evaluate("__dbg.S.running = false; __dbg.S.spin = 0")   # 停机
    # 先退出 battle 并回到 idle（停掉 pad/battle 全部支路），等 musicRMS 归零
    pg.evaluate("__dbg.music.setMode('idle')")
    pg.wait_for_function("() => __dbg.music.state().mode === 'idle'", timeout=8000)
    pg.wait_for_function("() => __dbg.audio.state().masterGain < 0.1", timeout=8000)
    # pad 增益回落：musicRMS 先回到底噪再触发 brass——避免把上一段 battle/pad
    # 的残余信号误算成 brass 抬升。
    # 健壮化（自 0.004/0.006 绝对阈值迭代）：门禁序列负载下实时底噪实测在
    # 0.0037-0.0061 波动，绝对上限必然再次碰边。改用「软回落 + 相对抬升」：
    #   前置 = 回落到 <0.02（任何正常底噪都满足，只拦 battle/pad 残留信号）；
    #   核心 = brass 触发后相对 musBase 抬升 ≥8 倍且绝对 ≥0.04（brass 实测
    #   ~0.19，任意底噪 0.004-0.006 下 8 倍都成立）——验证强度不降
    pg.wait_for_function("() => __dbg.audio.musicRMS() < 0.02", timeout=10000)
    windBase = pg.evaluate("__dbg.audio.ambientRMS()")          # brass 前 wind 底噪
    musBase = pg.evaluate("__dbg.audio.musicRMS()")             # brass 前 music 底噪基线
    assert musBase < 0.02, ('F: brass 触发前 musicRMS 未回落（battle/pad 残留）', musBase)
    # 经 FilmMusic.brass()（与 70-app 击毁反馈同一真实入口）触发
    pg.evaluate("__dbg.music.brass()")
    # brass 音在 musicBus post-gain 上应有显著 RMS 抬升：相对 musBase ≥8 倍 且 >0.04
    musThr = "Math.max(0.04, %s * 8)" % musBase
    pg.wait_for_function("() => __dbg.audio.musicRMS() > " + musThr, timeout=6000)
    musPeak = pg.evaluate("__dbg.audio.musicRMS()")
    windDuring = pg.evaluate("__dbg.audio.ambientRMS()")
    brassCount = pg.evaluate("__dbg.music.state().brass")
    print('F 停机 brass(FilmMusic.brass): musicRMS %s -> %s (peak), windRMS %s -> %s, brassCount=%s' % (
        round(musBase, 4), round(musPeak, 4), round(windBase, 4), round(windDuring, 4), brassCount))
    assert brassCount >= 1, ('F: FilmMusic.brass() 未计数', brassCount)
    # 停转可听：停机（master≈0）下 musicBus 仍有 brass 信号
    masterDuring = pg.evaluate("__dbg.audio.state().masterGain")
    assert masterDuring < 0.1, ('F: 停机 master 应归零', masterDuring)
    assert musPeak > 0.04, ('F: 停转 brass 不可听（musicRMS 未抬升）', musPeak)
    # wind probe 不得把 brass 计入（相对基线上限：wind 保持底噪量级）
    assert windDuring < max(0.02, windBase * 3 + 0.004), ('F: brass 污染了 wind probe', windDuring, windBase)
    # 静音后 music RMS 归零（静音门控→总线增益归零，目标远低于底噪）
    pg.evaluate("__dbg.audio.toggle()")
    pg.wait_for_function("() => __dbg.audio.musicRMS() < 0.004", timeout=6000)
    pg.evaluate("__dbg.audio.toggle()")
    pg.wait_for_function("() => __dbg.audio.state().enabled", timeout=4000)
    # 解静音后再经真实入口触发：music RMS 恢复（可再次触发；相对抬升判据同前）
    pg.wait_for_function("() => __dbg.audio.musicRMS() < 0.02", timeout=6000)
    musBase2 = pg.evaluate("__dbg.audio.musicRMS()")           # 解静音后回落的底噪基线
    pg.evaluate("__dbg.music.brass()")
    pg.wait_for_function("() => __dbg.audio.musicRMS() > Math.max(0.04, %s * 8)" % musBase2, timeout=6000)
    brassCount2 = pg.evaluate("__dbg.music.state().brass")
    assert brassCount2 >= brassCount + 1, ('F: 解静音后 brass 未再次可触发', brassCount, brassCount2)
    print('F 停机 brass(FilmMusic.brass) 可闻闭环 OK: 停转可听/静音归零/解静音可再触发/wind 未污染')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')