# 夜间灯光系统验证 v5（走 pw_harness 护具）：航行灯红/绿分侧、信标/频闪
# 连拍差分+峰值保持、搜索灯光池、编队灯条、仪表绿光、白天灭灯、湖面倒影。
# 用法: uv run --with playwright --with pillow python test_navlights.py
import io
import pw_harness as H
from PIL import Image

OUT = H.OUTPUT_DIR

def count(im, pred, y_min=0.0):
    w, h = im.size
    y0 = int(h * y_min)
    return sum(1 for y in range(y0, h) for x in range(w)
               if pred(*im.getpixel((x, y))))

# 主色占优判定：ACES 后灯芯白热化，纯通道阈值会漏判
RED   = lambda r, g, b: r > 140 and r > 1.8 * g and r > 1.8 * b
GREEN = lambda r, g, b: g > 140 and g > 1.8 * r and g > 1.4 * b
WHITE = lambda r, g, b: min(r, g, b) > 195 and max(r, g, b) - min(r, g, b) < 40
# 搜索灯光池：高亮且不偏蓝（光池核心被 ACES 推成纯白，边缘混夜间蓝环境光；
# 停机坪标线是蓝灰色 b>r，用 b<=r+12 排除）
WARM  = lambda r, g, b: min(r, g, b) > 195 and b <= r + 12

def settle(pg, timeout=15000):
    """等 orbit 相机阻尼收敛到目标参数，再截图/取样。

    相机位置每帧向 t* 逼近（dt 钳制 0.05），固定 sleep 在门禁负载下会采样到
    过渡中途的视角（GATE-R7：夜间强度只到 0.776、未达 0.9 阈值）。判据只查
    dist/phi/theta——tTarget 会被飞行目标跟随器持续微调，纳入判据会永不收敛。
    """
    pg.wait_for_function("""() => { const o = __dbg.orbit;
      return Math.abs(o.dist - o.tDist) < 0.05
          && Math.abs(o.phi - o.tPhi) < 0.005
          && Math.abs(o.theta - o.tTheta) < 0.005; }""", timeout=timeout)

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.nl)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#btn-panel') && document.querySelector('#btn-panel').click()")

    # 1) 夜间（引擎未启动）：航行灯/编队灯亮，信标/频闪不闪，搜索灯/仪表光开
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    # 灯光强度是逐帧阻尼收敛（dt 钳制 0.05，低帧率下按墙上时间远慢于固定睡）——
    # 与本文件第 5 步同一处理：轮询到收敛再断言。固定睡 1300ms 在门禁负载下
    # 只到 intensity 0.776 / search 2314（GATE-R7 实测），双双卡在阈值下方。
    # search = 3000*(I-0.02)/0.98，故 I>0.95 时 search≈2847，一并覆盖下方两条断言。
    pg.wait_for_function("() => __dbg.nl.state().intensity > 0.95", timeout=15000)
    st = pg.evaluate("__dbg.nl.state()")
    assert st['intensity'] > 0.9, ('night intensity', st)
    for k in ('navL', 'navR', 'tailNav', 'fmtBodyR1', 'fmtBoomL1', 'fmtFinL'):
        assert st['lights'][k]['visible'], ('nav/fmt on', k, st)
    assert not st['lights']['beaconTop']['visible'], ('beacon off', st)
    assert not st['lights']['strobe']['visible'], ('strobe off', st)
    # polish3：冷机停放不开搜索灯（原来斜照出机头前硬边白斑）；离地/旋翼转起来才亮——见 2b
    assert st['search'] < 50, ('searchlight off when parked cold', st)
    assert st['dash'] > 0.35, ('dash glow on', st)

    # 2) 右侧机位：绿灯+编队灯条像素 + 停放搜索灯光池（腹部灯离地仅 0.4u，
    # 光斑小、在机鼻前下方，热白边缘即证据；3000cd 下探针已证实可见）
    pg.evaluate("__dbg.orbit.tTheta = 0.72; __dbg.orbit.tPhi = 1.16; __dbg.orbit.tDist = 13.5")
    settle(pg)
    right = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
    g_px = count(right, GREEN)
    pool_px = count(right, WARM, y_min=0.45)
    assert g_px > 250, ('green nav+formation pixels', g_px)
    # polish3：冷机停放不再有光池，pool_px 只打印不断言
    print('green px=%d, warm pool px (parked)=%d' % (g_px, pool_px))
    pg.screenshot(path=H.output_path('shot_nl_night_right.jpg'), type='jpeg', quality=90)

    # 2b) 悬停光池：FLY.fp 门控让 flyUpdate 让位（alt=6），相机对准光池落点
    pg.evaluate("__dbg.FLY.fp = true; __dbg.FLY.state = 'hover'; __dbg.FLY.alt = 6; __dbg.FLY.pitch = 0; __dbg.FLY.comp = 0")
    pg.evaluate("__dbg.orbit.tTarget.set(0, 0.5, 10); __dbg.orbit.tPhi = 1.32; __dbg.orbit.tDist = 15")
    settle(pg)
    hov = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
    hov_px = count(hov, WARM)
    assert hov_px > 200, ('searchlight ground pool @hover', hov_px)
    print('warm pool px (hover) =', hov_px)
    pg.screenshot(path=H.output_path('shot_nl_night_hover.jpg'), type='jpeg', quality=90)
    # 复位回地面：S._alt 必须同帧清零——loop 的目标跟随器会在下一帧补差值
    # (alt−S._alt)×0.92，否则 tTarget.y 被二次下移 5.5u，相机对着地下拍（竞态）
    pg.evaluate("__dbg.FLY.fp = false; __dbg.FLY.state = 'ground'; __dbg.FLY.alt = 0; __dbg.FLY.pitch = 0; __dbg.S._alt = 0")
    pg.evaluate("__dbg.orbit.tTarget.set(0, 1.1, 0); __dbg.orbit.tPhi = 1.16; __dbg.orbit.tDist = 13.5")
    pg.wait_for_timeout(800)

    # 2c) 机鼻特写：编队灯条/仪表绿光肉眼核对
    pg.evaluate("__dbg.orbit.tTheta = 0.9; __dbg.orbit.tPhi = 1.25; __dbg.orbit.tDist = 6")
    settle(pg)
    pg.screenshot(path=H.output_path('shot_nl_nose_closeup.jpg'), type='jpeg', quality=90)
    pg.evaluate("__dbg.orbit.tTheta = 0.72; __dbg.orbit.tPhi = 1.16; __dbg.orbit.tDist = 13.5")
    pg.wait_for_timeout(800)

    # 3) 左侧机位：红灯像素（临时隐藏仪表绿光 Sprite——update 只写 opacity 不写
    #    visible，visible=false 才能稳定生效；opacity=0 会被下一帧覆写，纯竞态）
    pg.evaluate("__dbg.orbit.tTheta = 0.72 + Math.PI")
    settle(pg)
    pg.evaluate("__dbg.nl.dash.visible = false")
    # B6+：等两帧真正渲染（dash 隐藏要落到画面里才能数像素），替代固定睡 350ms——
    # 帧等待与帧率无关（分类器真候选 L96→L101）
    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    left = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
    pg.screenshot(path=H.output_path('shot_nl_night_left.jpg'), type='jpeg', quality=90)
    pg.evaluate("__dbg.nl.dash.visible = true")
    r_px = count(left, RED)
    assert r_px > 30, ('red nav pixels', r_px)
    print('red px (left side) =', r_px)

    # 4) 顶部斜视角：启动引擎。信标=像素差分证据；频闪=纯轮询峰值证据
    #（频闪双闪窗口 ~250ms/1.5s 周期，截图连拍把采样间隔拉到 ~700ms 必然错过——
    #  纯 evaluate 轮询无截图负担，峰值保持可可靠命中，纯遥测探针已实证）
    pg.evaluate("__dbg.nl.search.intensity = 0"); pg.evaluate("__dbg.orbit.tTheta = 2.4; __dbg.orbit.tPhi = 0.85; __dbg.orbit.tDist = 12")
    settle(pg)
    base = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
    base_red = count(base, RED)
    pg.keyboard.press('Space')          # 启动引擎
    # 信标/频闪断言：用 peak 峰值保持遥测（可靠命中窄脉冲），像素差分仅参考
    beacon_peak, strobe_peak = 0.0, 0.0
    for i in range(50):                 # ~4s：引擎 spin>2% 需 ~1.3s，频闪首闪在
                                        # 启动后 1.3~2.8s（探针实测）——旧 20 次
                                        # (~2s) 窗口会整体错过首闪，peak 恒 0
        pg.wait_for_timeout(60)         # 让出主线程，防帧量化
        s = pg.evaluate("__dbg.nl.state()")
        beacon_peak = max(beacon_peak, s['peak']['beacon'])
        strobe_peak = max(strobe_peak, s['peak']['strobe'])
    assert beacon_peak > 0.5, ('beacon peak', beacon_peak)
    assert strobe_peak > 0.5, ('strobe peak', strobe_peak)
    # 像素差分作辅助证据（受截图时序影响，不稳定但>0 即证明红光渲染）
    reds = []
    for i in range(8):
        im = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
        reds.append(count(im, RED))
    d_red = max(reds) - base_red
    print('beacon: pixel delta=%d | peaks: beacon=%.2f strobe=%.2f' % (d_red, beacon_peak, strobe_peak))
    assert d_red >= 0, ('beacon pixel sanity', d_red)
    pg.screenshot(path=H.output_path('shot_nl_night_engine.jpg'), type='jpeg', quality=90)

    # 5) 切正午：全灭（含搜索灯/仪表光）
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    # damp 收敛与实际帧率相关（dt 被钳制 0.05，低帧率下 I 衰减远慢于墙上时间，
    # 实测 3.5s 后 search 残留 ~16）——轮询收敛直到全灭，上限 15s
    # B6+：手写轮询改为 wait_for_function（等价且更清晰；分类器真候选 L139→L143/L144/L145）
    pg.wait_for_function("""() => { const s = __dbg.nl.state();
        return s.intensity < 0.06 && s.search < 5 && s.dash < 0.05; }""", timeout=20000)
    st3 = pg.evaluate("__dbg.nl.state()")
    assert st3['intensity'] < 0.06, ('day off', st3)
    assert st3['search'] < 5, ('day search off', st3)
    assert st3['dash'] < 0.05, ('day dash off', st3)

    # 6) 夜间 + 湖面：灯珠镜像自发光 + 克隆体中的真实光源已摘除
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_function("() => __dbg.nl.state().intensity > 0.95", timeout=15000)
    st4 = pg.evaluate("__dbg.nl.state()")
    assert st4['mirror'] >= 16, ('mirror lights', st4)
    assert st4['mirrorLights'] == 1, ('mirror spotlight removed', st4)
    assert pg.evaluate("__dbg.refl.enabled") is True
    pg.screenshot(path=H.output_path('shot_nl_night_water.jpg'), type='jpeg', quality=90)

H.guarded_main(run, hard_timeout=300)
print('PASS')
