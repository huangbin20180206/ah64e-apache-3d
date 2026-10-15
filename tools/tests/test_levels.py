# -*- coding: utf-8 -*-
# test_levels.py — P2（2026-10-13）：游戏模式关卡表 + 战役地图 + 星级/解锁/存档 v2
#   L0 #play → 战役地图：13 关卡片；新档仅 1-1 可进，制作中关（4-3）显示「制作中」
#   L1 点 2-1 → 简报带关卡名/目标/附加；S._mission.levelId=2-1、variant=standard；地图关闭
#   L2 注入全歼（50% 命中）→ 结算：星级行 + 附加目标；progress 记档；2-2 解锁；面板出现「下一关 2-2」
#   L3 「下一关」→ 2-2（timed_rescue，黄昏）；重试保持 levelId
#   L4 #play/4-2 未解锁 → 不进关、留在地图；v1 旧档迁移：首建 v2 时旧 3 关解锁覆盖到 2-3
import pw_harness as H

READY = "() => !!(window.__dbg && __dbg.apache && __dbg.step && __dbg.targets && __dbg.rig)"


def load(pg, hash_=''):
    pg.goto('about:blank')   # 仅 hash 不同的 goto 是同文档导航，不会重新载入
    pg.goto(H.BASE + '/?launch=1&nocine=1&nocut=1' + hash_, wait_until='domcontentloaded')
    pg.wait_for_function(READY, timeout=90000)
    H.step(pg, 0.5)


def win(pg):
    pg.evaluate("""(() => { const m = __dbg.S._mission; __dbg.beginMission();
        __dbg.enemyAir.reset(); __dbg.enemyVis.clearVisual();
        const rig = __dbg.rig; m.gun0 = rig.gunAmmo; m.rk0 = rig.rocketAmmo; m.hf0 = rig.hfAmmo;
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });
        m.hits = 15; rig.gunAmmo = m.gun0 - 30; })()""")
    H.step_until(pg, "() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", 30)


def run(pg):
    pg.wait_for_function(READY, timeout=90000)
    pg.evaluate("localStorage.removeItem('ah64_progress'); localStorage.removeItem('ah64_campaign')")
    # L0
    load(pg, '#play')
    st = pg.evaluate("""[document.body.className, document.getElementById('levelmap').classList.contains('show'),
        document.querySelectorAll('#levelmap .lm-lv').length,
        [...document.querySelectorAll('#levelmap .lm-lv:not(.locked)')].map(b => b.dataset.level),
        document.querySelectorAll('#levelmap .lm-lv.wip').length, !!__dbg.S._mission]""")
    assert 'app-play' in st[0] and st[1] and st[2] == 13, st
    assert st[3] == ['1-1'] and st[4] == 0 and st[5] is False, st
    print('L0 ok', st)

    # L1（先给 1-1 记 1 星——2-1 unlockAfter 1-1）
    pg.evaluate("__dbg.progress.record('1-1', 'B', 0, {}, 'standard'); __dbg.showLevelMap ? 0 : 0")
    pg.evaluate("document.querySelector('#btn-levelmap').click()"); H.step(pg, 0.3)
    pg.click('#levelmap .lm-lv[data-level="2-1"]'); H.step(pg, 0.5)
    b = pg.evaluate("""[__dbg.S._mission.levelId, __dbg.S._mission.variant, __dbg.S._mission.phase,
        document.getElementById('mission-title').textContent, document.getElementById('mission-body').innerText,
        document.getElementById('levelmap').classList.contains('show'), location.hash]""")
    assert b[0] == '2-1' and b[1] == 'standard' and b[2] == 'briefing', b
    assert b[3] == '2-1 · 初次出击' and '摧毁前哨与补给车队' in b[4] and '全部 8 个目标' in b[4] and '机体损伤不超过 3' in b[4], b
    assert b[5] is False and b[6] == '#play/2-1', b
    print('L1 ok')

    # L2
    win(pg)
    r = pg.evaluate("""[document.querySelector('#mission-body .mstars') ? +document.querySelector('#mission-body .mstars').dataset.stars : -1,
        0, JSON.parse(localStorage.getItem('ah64_progress')).levels['2-1'],
        document.getElementById('btn-next-level').style.display, document.getElementById('btn-next-level').textContent,
        document.getElementById('mission-title').textContent]""")
    assert r[0] >= 2, r          # 50% 命中短局 → S/A 档 ≥ 2 星
    assert r[2]['stars'] == r[0] and r[2]['clears'] == 1, r
    assert r[3] == '' and '2-2' in r[4] and r[5].endswith('完成'), r
    print('L2 ok', r)

    # L2b 结算卡内操作条（2026-10-14）：下一关 / 重玩 / 战役地图
    ra = pg.evaluate("[...document.querySelectorAll('#mission-body .mact .chip')].map(e => [e.id, e.textContent])")
    assert [x[0] for x in ra] == ['res-next', 'res-retry', 'res-map'] and '2-2' in ra[0][1], ra
    print('L2b ok', ra)

    # L3（N 键直接进下一关）
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('n'); H.step(pg, 0.5)
    assert pg.evaluate("!document.querySelector('#mission-body .mact')"), 'mact cleared'
    n = pg.evaluate("[__dbg.S._mission.levelId, __dbg.S._mission.variant, __dbg.S.env, document.getElementById('btn-next-level').style.display]")
    assert n == ['2-2', 'timed_rescue', 'dusk', 'none'], n
    pg.evaluate("__dbg.retryMission()"); H.step(pg, 0.3)
    assert pg.evaluate("__dbg.S._mission.levelId") == '2-2'
    print('L3 ok')

    # L4
    load(pg, '#play/4-2')
    s4 = pg.evaluate("[!!__dbg.S._mission, document.getElementById('levelmap').classList.contains('show')]")
    assert s4 == [False, True], s4
    pg.evaluate("""localStorage.removeItem('ah64_progress');
        localStorage.setItem('ah64_campaign', JSON.stringify({schema_version:1, unlocked:3, levels:[
          {bestScore:500,bestGrade:'B',ach:[],totalDmg:0},{bestScore:0,bestGrade:'',ach:[],totalDmg:0},
          {bestScore:0,bestGrade:'',ach:[],totalDmg:0},{bestScore:0,bestGrade:'',ach:[],totalDmg:0},
          {bestScore:0,bestGrade:'',ach:[],totalDmg:0},{bestScore:0,bestGrade:'',ach:[],totalDmg:0}]}))""")
    load(pg, '#play')
    open_ = pg.evaluate("[...document.querySelectorAll('#levelmap .lm-lv:not(.locked)')].map(b => b.dataset.level)")
    assert open_ == ['1-1', '2-1', '2-2', '2-3'], open_
    pg.evaluate("localStorage.removeItem('ah64_progress'); localStorage.removeItem('ah64_campaign')")
    print('L4 ok', open_)


H.guarded_main(run, hard_timeout=240)
