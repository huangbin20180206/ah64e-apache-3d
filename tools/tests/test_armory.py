# -*- coding: utf-8 -*-
# test_armory.py — 装备图鉴（35-armorydata / 71-armory，2026-10-17）
#   A1 主菜单按 3 → 图鉴全屏打开，13 个条目，S.armoryOpen=true（3D 暂停），第 1 张照片载入
#   A2 方向键 / 滚轮 / 点条目 切换；轮盘停稳后右侧标题、照片跟着换
#   A3 打字机：正文逐字出现，点正文立即出全文
#   A4 图鉴打开时驾驶键（T/空格）不驱动机体；Esc 关闭，回到主菜单，S.armoryOpen=false
#   A5 #armory 直达；展示「知识」页按钮也能打开
import pw_harness as H


def wait_shown(pg, i, ms=8000):
    # 轮盘停稳后右侧标题才换：等标题 = 第 i 个条目名
    pg.wait_for_function("(i) => { const it = document.querySelector('#armory .arm-item[data-i=\"' + i + '\"] span');"
                         " return it && document.querySelector('#armory .arm-cap h2').textContent === it.textContent; }", arg=i, timeout=ms)


def run(pg):
    pg.goto(H.BASE + '/?launch=1&nocine=1&nocut=1', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.step)", timeout=90000)
    H.step(pg, 0.5)
    # A1
    pg.keyboard.press('3')
    pg.wait_for_function("() => document.getElementById('armory') && document.getElementById('armory').classList.contains('on')", timeout=5000)
    r = pg.evaluate("[document.querySelectorAll('#armory .arm-item').length, __dbg.S.armoryOpen, document.querySelector('#armory .arm-cap h2').textContent]")
    assert r[0] == 13 and r[1] is True and r[2] == '主旋翼', r
    pg.wait_for_function("() => [...document.querySelectorAll('#armory .arm-frame img')].some(i => i.complete && i.naturalWidth >= 1600)", timeout=10000)
    print('A1 ok', r)
    # A2
    pg.keyboard.press('ArrowDown'); wait_shown(pg, 1)
    assert pg.evaluate("document.querySelector('#armory .arm-cap h2').textContent") == '剪刀式尾桨'
    pg.mouse.move(700, 400); pg.mouse.wheel(0, 120); wait_shown(pg, 2)
    pg.evaluate("document.querySelector('#armory .arm-item[data-i=\"0\"]').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 7, button: 0}))")
    pg.evaluate("document.querySelector('#armory .arm-wheel').dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 7}))")
    wait_shown(pg, 0)
    pg.keyboard.press('ArrowUp'); wait_shown(pg, 12)          # 0 往回一格 = 最后一条（环绕）
    h = pg.evaluate("[document.querySelector('#armory .arm-cap h2').textContent, document.querySelector('#armory .arm-cap').classList.contains('w')]")
    assert h == ['红外诱饵弹', True], h
    print('A2 ok', h)
    # A3
    pg.keyboard.press('Home'); wait_shown(pg, 0)
    pg.wait_for_timeout(900)
    n1 = pg.evaluate("__dbg && document.querySelector('#armory .arm-body span').textContent.length")
    pg.click('#armory .arm-body')
    n2 = pg.evaluate("document.querySelector('#armory .arm-body span').textContent.length")
    assert 0 < n1 < n2 and n2 >= 80, (n1, n2)
    print('A3 ok', n1, n2)
    # A4
    pg.keyboard.press('t'); pg.keyboard.press(' ')
    assert pg.evaluate("[__dbg.S.running, __dbg.FLY.state]") == [False, 'ground']
    pg.keyboard.press('Escape')
    r = pg.evaluate("[document.getElementById('armory').classList.contains('on'), __dbg.S.armoryOpen, document.body.className]")
    assert r[0] is False and r[1] is False and 'app-menu' in r[2], r
    print('A4 ok')
    # A5
    pg.goto(H.BASE + '/?launch=1&nocine=1&nocut=1#armory', wait_until='domcontentloaded')
    pg.wait_for_function("() => document.getElementById('armory') && document.getElementById('armory').classList.contains('on')", timeout=90000)
    pg.keyboard.press('Escape')
    pg.keyboard.press('1'); H.step(pg, 0.3)
    pg.click('#ptabs [data-tab="know"]'); pg.click('#btn-armory')
    assert pg.evaluate("document.getElementById('armory').classList.contains('on')")
    pg.keyboard.press('Escape')
    print('A5 ok')


H.guarded_main(run, hard_timeout=200)
