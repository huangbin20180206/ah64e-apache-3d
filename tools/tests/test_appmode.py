# -*- coding: utf-8 -*-
# test_appmode.py — P1（2026-10-13）：主菜单 / 展示 / 游戏 模式隔离
#   M0 默认自动化入口（webdriver）= legacy all：无主菜单，面板全部分节可见（既有测试零改动的前提）
#   M1 ?launch=1 → 主菜单：入口卡可见，面板/HUD 隐藏；菜单期间 T/空格 不驱动机体
#   M2 按 1 → 展示：#show，S.mode=show，五个分页互斥显示分节；游戏 HUD（分数/RWR）隐藏
#   M3 知识页：点卡片 → 解说牌出现、镜头目标移向部件
#   M4 ⌂ → 主菜单；点「游戏」→ #play，S.mode=mission 且战役地图打开（P2：选关后才下发简报）；展示专属分节隐藏
#   M5 游戏中返回主菜单 → 任务被清理（S.mode=show、无任务残留）；#show 直达
import pw_harness as H


def vis(pg, sel):
    return pg.evaluate("(s) => { const e = document.querySelector(s); if (!e) return null;"
                       " const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; }", sel)


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.step)", timeout=90000)
    # M0
    m0 = pg.evaluate("[document.body.className, getComputedStyle(document.getElementById('launcher')).display,"
                     " [...document.querySelectorAll('#panel .sec')].filter(s => getComputedStyle(s).display !== 'none').length]")
    assert 'app-all' in m0[0] and m0[1] == 'none', m0
    assert m0[2] == pg.evaluate("document.querySelectorAll('#panel .sec').length"), m0
    print('M0 ok', m0)

    # M1
    pg.goto(H.BASE + '/?launch=1&nocine=1&nocut=1', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.step)", timeout=90000)
    H.step(pg, 1)
    assert 'app-menu' in pg.evaluate("document.body.className")
    assert vis(pg, '#ln-show') and vis(pg, '#ln-play') and not vis(pg, '#panel') and not vis(pg, '#hud')
    pg.keyboard.press('t'); pg.keyboard.press(' '); H.step(pg, 0.5)
    st = pg.evaluate("[__dbg.S.running, __dbg.FLY.state]")
    assert st == [False, 'ground'], st
    print('M1 ok')

    # M2
    pg.keyboard.press('1'); H.step(pg, 0.5)
    r = pg.evaluate("[document.body.className, location.hash, __dbg.S.mode]")
    assert 'app-show' in r[0] and r[1] == '#show' and r[2] == 'show', r
    seen = {}
    for tab in ['fly', 'body', 'env', 'arm', 'know']:
        pg.click('#ptabs [data-tab="%s"]' % tab)
        ids = pg.evaluate("[...document.querySelectorAll('#panel .sec')].filter(s => getComputedStyle(s).display !== 'none')"
                          ".map(s => s.querySelector('h3').textContent)")
        assert ids, tab
        seen[tab] = ids
    assert '模式' not in sum(seen.values(), []), seen
    assert seen['arm'] == ['挂载与武备', '练习靶场'], seen
    assert not vis(pg, '#hud-score') and not vis(pg, '#hud-rwr') and vis(pg, '#hud-rpm')
    print('M2 ok', seen)

    # M3
    pg.click('#ptabs [data-tab="know"]')
    t0 = pg.evaluate("__dbg.orbit.target.toArray()")
    pg.click('#know-list .kcard[data-k="0"]'); H.step(pg, 1.5)
    k = pg.evaluate("[getComputedStyle(document.getElementById('label-info')).display, document.querySelector('#label-info b').textContent, __dbg.orbit.target.toArray()]")
    assert k[0] == 'block' and 'APG-78' in k[1], k
    assert abs(k[2][1] - t0[1]) > 0.5, (t0, k[2])   # 雷达在桅顶：目标点明显抬高
    print('M3 ok', k)

    # M4
    pg.click('#btn-home'); H.step(pg, 0.5)
    assert 'app-menu' in pg.evaluate("document.body.className") and pg.evaluate("location.hash") == ''
    assert pg.evaluate("getComputedStyle(document.getElementById('label-info')).display") == 'none'
    pg.click('#ln-play'); H.step(pg, 0.5)
    r = pg.evaluate("[document.body.className, location.hash, __dbg.S.mode, document.getElementById('levelmap').classList.contains('show')]")
    assert 'app-play' in r[0] and r[1] == '#play' and r[2] == 'mission' and r[3], r
    pg.click('#levelmap .lm-close'); H.step(pg, 0.2)
    assert not vis(pg, '#specs') and not vis(pg, '#ptabs') and vis(pg, '#mode-row') and not vis(pg, '#scheme-row')
    assert not vis(pg, '#mode-row [data-mode="show"]')
    print('M4 ok')

    # M5
    pg.click('#btn-home'); H.step(pg, 0.5)
    r = pg.evaluate("[__dbg.S.mode, !!__dbg.mission]")
    assert r == ['show', False], r
    pg.evaluate("location.hash = '#show'"); H.step(pg, 0.5)
    assert 'app-show' in pg.evaluate("document.body.className")
    print('M5 ok')


H.guarded_main(run, hard_timeout=200)
