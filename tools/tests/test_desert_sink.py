# 陷轮 + 撕环验证：沙漠停放时 root.y 下沉 / 起飞回升 / 粒子年龄扰动生效
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.washfx)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    # 沙漠停放 → 陷轮
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    # Phase 27 flaky 治理：陷轮是渐进沉降动画，固定 1600ms 睡在负载下曾未沉到位
    # （假失败 y=-0.349）。改条件等待沉降到位，替代固定墙钟。
    # C005 分诊修复（2026-09-20）：原等待阈值与下方断言阈值**同为 -0.38** ⇒ 会在
    # 沉降过渡带（-0.38 → 稳态 -0.4244 约需 0.5s）就被采样，toFixed(3) 恰好落在
    # -0.380 时严格 `< -0.38` 判假。实测：本批构建 1/3 通过、干净基线 da14e48
    # **同样 2/3 失败且签名一致**（与本批改动无关，属既有测试侧边界缺陷）；探针
    # 实测稳态 y=-0.42440（25/25 采样低于 -0.38，余量充足）。改为等到真正沉降
    # 收敛（<-0.42），**断言阈值保持 -0.38 不变**——语义不变，只去掉过渡带采样。
    pg.wait_for_function("() => __dbg.apache.root.position.y < -0.42", timeout=12000)
    y = pg.evaluate("+__dbg.apache.root.position.y.toFixed(3)")
    assert y < -0.38, ('no sink in sand (comp alone is ~-0.24)', y)
    print('sand ground sink y =', y)
    # 起飞（强制悬停）→ 拔出（条件等待回升离地，替代固定 2500ms）
    pg.evaluate("__dbg.FLY.fp=true; __dbg.FLY.state='hover'; __dbg.FLY.alt=6; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0")
    pg.wait_for_function("() => __dbg.apache.root.position.y > 5.0", timeout=12000)
    y2 = pg.evaluate("+__dbg.apache.root.position.y.toFixed(2)")
    assert y2 > 5.0, ('sink not released when airborne', y2)
    print('airborne y =', y2)
    # 停机坪不陷
    pg.evaluate("__dbg.FLY.fp=false; __dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.S._alt=0")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    # 条件等待沉降稳定进 comp-only 区间（停机坪不陷，仅悬架压缩 ~-0.24），替代固定睡
    # C005 分诊修复（2026-09-20）：旧等待带 (-0.32,-0.16) 是**过渡带**——机体从空中
    # （y>5）落回地面时穿过该带，等待在 y≈-0.161 的瞬态即命中，toFixed(3) 恰好落在
    # -0.160 时严格 `< -0.16` 判假（实测 2/5 失败）。探针实测 pad 稳态 y=-0.24438
    # （comp-only、sink→0，1.6s 收敛）。改为等待**收敛到稳态**（-0.26~-0.23），
    # **断言区间 -0.32~-0.16 保持不变**——语义不变且更强（真正量到 comp-only 值，
    # 而非下降途中的瞬态）。
    pg.wait_for_function("() => { const y = __dbg.apache.root.position.y; return y > -0.26 && y < -0.23; }", timeout=12000)
    y3 = pg.evaluate("+__dbg.apache.root.position.y.toFixed(3)")
    assert -0.32 < y3 < -0.16, ('pad should sit at comp only (~-0.24)', y3)
    print('pad ground y =', y3)
    # 扬沙存证：低空悬停开引擎，拍粒子场（人工核验撕环效果）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.evaluate("__dbg.FLY.fp=true; __dbg.FLY.state='hover'; __dbg.FLY.alt=2.5; __dbg.S._alt=0")
    pg.keyboard.press('Space')
    pg.wait_for_timeout(6500)
    pg.evaluate("__dbg.orbit.tPhi=1.30; __dbg.orbit.tDist=17")
    pg.wait_for_timeout(1000)
    pg.screenshot(path=H.output_path('shot_dust_torn.jpg'), type='jpeg', quality=90)

import pw_harness as H
H.guarded_main(run, hard_timeout=180)
print('PASS')
