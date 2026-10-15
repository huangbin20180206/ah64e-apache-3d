# -*- coding: utf-8 -*-
# 地面同心环回归（对应 2026-09-15 用户反馈"地面的同心圆…讨论无数次了"）
#
# 根因：WashDecal 的噪声采样用了【以机腹为圆心的极性相位】——
#   ① 弧长相位 s = r·ang（含 r×ang 交叉项 ⇒ 螺旋带，任何一瞬都读作同心环）
#   ② sin(r·uWave·1.9) 与噪声径向频率 r×5.5/11/22（径向周期仅 0.7~1.1u ⇒ 十几~几十圈）
# 探针消融（同机位逐层关闭）：关 WashDecal → 环全消；uWave=0 → 环全消；
#   关其余 8 层（粒子/沙雾/沙漠痕迹/近景地面/远景盘/远景沙丘/接地阴影/草场）→ 环不变。
# 修法：改在【风向世界坐标系】采样二维噪声，径向相位彻底消失。
#
# 断言：结构级（着色器不得再含极性相位/径向周期项）+ 行为级（层仍生效、水面波环保留）
import sys, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.washfx && __dbg.washfx.decal)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close')?.click()")
    pg.evaluate("window.__dbg.audio.enabled = false")
    pg.wait_for_timeout(300)

    src = pg.evaluate("__dbg.washfx.decal.mat.fragmentShader")
    # 先剥掉 // 注释再查——本次修复的注释里会逐字引用被删除的旧写法做说明
    # （"uWave * 1.9" 等），只检查真正参与编译的代码文本
    import re as _re
    code = _re.sub(r'//[^\n]*', '', src)
    print('着色器长度: %d（去注释后 %d）' % (len(src), len(code)), flush=True)
    # ① 不得再有"以机腹为圆心"的相位与径向周期项
    banned = {
        '弧长极性相位 s = r·ang': 'r * (ang +',
        '陆地波环项 uWave*1.9': 'uWave * 1.9',
        '噪声径向高频 r*5.5': 'r * 5.5',
        '噪声径向高频 r*11.0': 'r * 11.0',
        '噪声径向高频 r*22.0': 'r * 22.0',
    }
    for k, v in banned.items():
        assert v not in code, ('地面同心环回归：着色器代码仍含 ' + k, v)
    # ② 必须改成风向世界坐标采样
    assert 'dot(vP, wdn) * 0.80' in code, ('未使用风向世界坐标采样（同心环修复被回退）', )
    # ③ 水面波环必须保留（水没有干辐条，波环就是水面主视觉，用户已接受）
    assert 'sin(r * uWave * reach' in code, ('水面波环被误删', )
    assert 'uWater' in code, ('水面分支异常', )

    # 行为级：沙漠 + 贴地 + 开旋翼，刷痕盘必须仍生效（不能被"治环"治没了）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\'desert\\']')?.click()")
    pg.wait_for_timeout(500)
    pg.evaluate("() => { __dbg.S.running = true; __dbg.S.spin = 1;"
                " __dbg.FLY.state = 'ground'; __dbg.FLY.alt = 0; __dbg.S._alt = 0; }")
    pg.wait_for_function("() => __dbg.washfx.decal.mesh.visible", timeout=20000)
    pg.wait_for_timeout(400)
    st = pg.evaluate("""() => { const d = __dbg.washfx.decal;
        return { visible: d.mesh.visible, wash: +d.uniforms.uWash.value.toFixed(3),
                 dune: d._dune, wave: d.uniforms.uWave.value,
                 rad: +(d._rad || 0).toFixed(2),
                 wind: [ +d.uniforms.uWind.value.x.toFixed(3),
                         +d.uniforms.uWind.value.y.toFixed(3) ] }; }""")
    print('沙漠刷痕盘:', st, flush=True)
    assert st['visible'] and st['wash'] > 0.5, ('刷痕盘在沙漠贴地时未生效（被修没了）', st)
    assert st['dune'], ('沙漠未开启贴花沙丘贴合', st)
    assert st['wave'] > 0.0, ('uWave 被置零（水面波环会失效）', st)
    print('地面同心环回归 OK: 无极性相位/径向周期项、水面波环保留、刷痕盘仍生效')


H.guarded_main(run, hard_timeout=180)
