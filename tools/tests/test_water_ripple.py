# 水面下洗涟漪验证：湖面场地启动引擎 -> 涟漪从平台边缘外圈生成；
# 起飞/悬停/降落全程持续外传；贴花参数已驯服；零报错。
# 用法: uv run --with playwright --with pillow python test_water_ripple.py
import pw_harness as H

BASE = H.BASE + '/?nocine=1&nocut=1'   # 自动化通道：跳开场+过场（输入穿透修复后，首访开场会消费空格——测试需跳过）

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.washfx)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#btn-panel') && document.querySelector('#btn-panel').click()")
    # 稍高的侧俯机位，能同时看到平台和周围水面
    pg.evaluate("__dbg.orbit.tTheta = 0.72; __dbg.orbit.tPhi = 1.02; __dbg.orbit.tDist = 16")

    # 切湖面（白天），确认贴花参数已驯服（不再是实心白饼）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"water\\\"]').click()")
    pg.wait_for_timeout(600)
    amp = pg.evaluate("__dbg.washfx.decal.uniforms.uAmp.value")
    assert amp < 0.4, ('decal amp should be tamed', amp)

    # 启动引擎（未起飞）：下洗打在甲板上，水面应从平台外圈泛起涟漪
    pg.keyboard.press('Space')
    pg.wait_for_function("() => __dbg.S.spin > 0.9", timeout=30000)
    pg.wait_for_timeout(2000)
    r0 = pg.evaluate("({sp: __dbg.washfx.ripples._spawned, al: __dbg.washfx.ripples.alive})")
    assert r0['sp'] >= 2, ('ripples while engine running on pad', r0)
    assert r0['al'] >= 1, ('ripple rings alive on pad', r0)
    pg.screenshot(path=H.output_path('shot_water_ripple_pad.jpg'), type='jpeg', quality=90)

    # 起飞爬升：涟漪持续生成
    pg.keyboard.press('t')
    # B6+：等涟漪生成数真的增长再断言（分类器真候选 L32→L34），替代固定睡 1500ms
    pg.wait_for_function("(s0) => __dbg.washfx.ripples._spawned > s0", arg=r0['sp'], timeout=20000)
    st = pg.evaluate("({sp: __dbg.washfx.ripples._spawned, al: __dbg.washfx.ripples.alive, fly: __dbg.FLY.state})")
    assert st['sp'] > r0['sp'], ('spawned should grow during climb', r0, st)
    pg.screenshot(path=H.output_path('shot_water_ripple_takeoff.jpg'), type='jpeg', quality=90)

    # 悬停 = HOVER 14u（28m）：下洗强度趋近 0，波环停发并自然消亡
    pg.wait_for_function("() => __dbg.FLY.state === 'hover'", timeout=20000)
    pg.wait_for_timeout(4200)
    st2 = pg.evaluate("({sp: __dbg.washfx.ripples._spawned, al: __dbg.washfx.ripples.alive})")
    assert st2['al'] == 0, ('rings must die out at high hover', st2)
    pg.screenshot(path=H.output_path('shot_water_ripple_highhover.jpg'), type='jpeg', quality=90)

    # 降落：降回 9u 以下涟漪重新出现
    pg.keyboard.press('t')
    pg.wait_for_function("() => __dbg.washfx.ripples._spawned > %d" % st2['sp'], timeout=25000)
    pg.screenshot(path=H.output_path('shot_water_ripple_landing.jpg'), type='jpeg', quality=90)
    pg.wait_for_function("() => __dbg.FLY.state === 'ground'", timeout=30000)
    pg.wait_for_timeout(900)
    st3 = pg.evaluate("__dbg.washfx.ripples._spawned")
    assert st3 > st2['sp'], ('landing ripples', st2, st3)

    # 切回停机坪：涟漪必须全部清空
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\\"pad\\\"]').click()")
    pg.wait_for_timeout(500)
    st4 = pg.evaluate("({sp: __dbg.washfx.ripples._spawned, al: __dbg.washfx.ripples.alive})")
    assert st4['al'] == 0, ('ripples must clear when leaving water', st4)

H.guarded_main(run, base_url=BASE, hard_timeout=300)
