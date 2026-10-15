# -*- coding: utf-8 -*-
# 2026-10-14 用户反馈：第一人称难以机头下俯瞄准地面
#   A1 鼠标下移 = 机头下俯，pitch 趋近 1.0（旧版上限只有 0.35）
#   A2 方向键 ↓ 下俯 / ↑ 抬头
#   A3 无指针锁定：光标在画面下方 → 机头下俯；光标在右侧 → 右转（vYaw 减小）
import pw_harness as H


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("__dbg.FLY.state = 'hover'; __dbg.FLY.alt = 30; __dbg.FLY.pitch = 0; __dbg.FLY.comp = 0")
    pg.evaluate("__dbg.fp.enter()"); H.step(pg, 0.2)
    pg.evaluate("__dbg.fp.cursor = null; for (let i = 0; i < 25; i++) __dbg.fp.mouse(0, 100)"); H.step(pg, 1.0)
    a = pg.evaluate("[__dbg.fp.vPitch, __dbg.FLY.pitch]")
    assert a[0] > 1.7 and 0.7 < a[1] <= 1.0, ('A1', a)
    print('A1 ok', a)
    pg.evaluate("__dbg.fp.vPitch = 0; __dbg.fp.pitchKeys = 1"); H.step(pg, 0.5)
    b1 = pg.evaluate("__dbg.fp.vPitch")
    pg.evaluate("__dbg.fp.pitchKeys = -1"); H.step(pg, 0.5)
    b2 = pg.evaluate("__dbg.fp.vPitch")
    pg.evaluate("__dbg.fp.pitchKeys = 0")
    assert b1 > 0.6 and b2 < b1 - 0.6, ('A2', b1, b2)
    print('A2 ok', b1, b2)
    # harness 默认伪造指针锁定；此处临时模拟“不支持指针锁定”的环境
    pg.evaluate("Object.defineProperty(document, 'pointerLockElement', {get: () => null, configurable: true}); __dbg.fp.vPitch = 0; __dbg.fp.cursor = {on: true, x: 0, y: 0.9}"); H.step(pg, 1.5)
    c = pg.evaluate("[__dbg.fp.vPitch, __dbg.FLY.pitch]")
    y0 = pg.evaluate("__dbg.fp.vYaw")
    pg.evaluate("__dbg.fp.cursor = {on: true, x: 0.9, y: 0}"); H.step(pg, 0.5)
    y1 = pg.evaluate("__dbg.fp.vYaw")
    pg.evaluate("delete document.pointerLockElement; __dbg.fp.cursor = null; __dbg.fp.exit()")
    assert c[0] > 1.0 and c[1] > 0.5 and y1 < y0 - 0.3, ('A3', c, y0, y1)
    print('A3 ok', c, y0, y1)


H.guarded_main(run, hard_timeout=200)
print('PASS')
