# -*- coding: utf-8 -*-
# Phase 20-A：A2A 敌方武装直升机——值级浏览器断言（playwright）
# 全部 __dbg 数值断言、条件等待无固定墙钟；概率分支的确定性验证在纯
# pytest（tests_pure），此处验证接线链（spawn/状态机推进/桥接/计分/清理）。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rig && __dbg.enemyAir && __dbg.enemyVis && __dbg.arcade && __dbg.resources && __dbg.campaign)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)

    # ---- E1: 默认态（非任务局）——敌机不在场、视觉全隐、enabled=false ----
    e1 = pg.evaluate("(() => { const a = __dbg.enemyAir.state(); return { active: a.active, live: a.live, vis: __dbg.enemyVis.state().live, enabled: __dbg.enemyVis.enabled }; })()")
    assert e1['active'] is False and e1['live'] == 0 and e1['vis'] == 0 and e1['enabled'] is False, ('E1: 非任务局敌机应全隐', e1)
    print('E1 PASS: 非任务局敌机全隐（active=false/live=0/enabled=false）')

    # ---- E2: startMission → spawn 2 机巡逻（任务锚=敌方基地方位） ----
    pg.evaluate("(() => { __dbg.S.mode = 'mission'; __dbg.startMission('standard'); })()")
    e2 = pg.evaluate("(() => { const a = __dbg.enemyAir.state(); return { active: a.active, live: a.live, phases: a.units.map(u => u.phase) }; })()")
    assert e2['active'] is True and e2['live'] == 2, ('E2: 任务局应 spawn 2 机', e2)
    assert all(p == 'patrol' for p in e2['phases']), ('E2: 初始相位应 patrol', e2)
    # enabled 用 _live 缓存（88.update 每帧刷新）——条件等待 loop 跑过一帧
    pg.wait_for_function("() => __dbg.enemyVis.enabled === true", timeout=5000)
    print('E2 PASS: startMission spawn 2 机巡逻（enabled=true）')

    # ---- E3: 索敌链——玩家悬停敌机视距内 → search → attack（条件等待） ----
    # 悬停 (30, alt 14, 93)：长机 spawn 位置 (30,18,75)（基地 BASE_C z=75，2026-10-15 由 42 挪远） 机头朝 +z——玩家恰在
    # 其正前方 18u（与纯 pytest chain 用例同款确定性几何，无需等巡逻相位）。
    # 注意不能悬停在巡逻环心附近（如 z=30 距锚 12u）——巡逻切线视锥与
    # 环心方向 dot≈0，30s 内永远扫不到（首轮实测超时的根因）。
    # 命中链的概率确定性已由纯 pytest 覆盖，此处断言状态机推进到攻击态。
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=30; F.z=93;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; F.fp=false; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    pg.evaluate("(() => { const m=__dbg.S._mission; m.phase='active'; if(m.t0==null) m.t0=__dbg.S.time; __dbg.beginMission(); })()")
    pg.wait_for_function("() => __dbg.enemyAir.state().attacking > 0", timeout=30000)
    e3 = pg.evaluate("(() => { const a = __dbg.enemyAir.state(); return { attacking: a.attacking, hp: a.units[0].hp, gunN: a.units[0].gunN }; })()")
    assert e3['attacking'] >= 1, ('E3: 应至少 1 机进入攻击态', e3)
    assert e3['hp'] == 8 and e3['gunN'] == 40, ('E3: 初始满血满弹', e3)
    print('E3 PASS: 索敌链 patrol→search→attack（attacking=%d）' % e3['attacking'])

    # ---- E4: 击落链——桥接 hitTest 击落 → 计分 + ace 成就 + 视觉动画 ----
    # killEvent 是单槽（84 hitPending 同款设计取舍，REPORT §13 声明：同帧
    # 双杀后发覆盖先发）——测试逐机击杀+逐次等 loop 消费计分，防覆盖。
    s0 = pg.evaluate("(() => ({ score: __dbg.arcade.state().score, kills: __dbg.arcade.state().kills }))()")
    for _round in range(2):
        pg.evaluate("""(() => {
            const ev = __dbg.enemyVis;
            for (const u of __dbg.enemyAir.units) {
              if (!u.on) continue;
              ev.hitTest({ x: u.x, y: u.y, z: u.z }, 8, 0);   // 一发击落（HP 8）
              return true;
            }
            return false; })()""")
        pg.wait_for_function("() => __dbg.arcade.state().enemyKills >= %d" % (_round + 1), timeout=5000)
    pg.wait_for_function("() => __dbg.enemyAir.state().live === 0", timeout=5000)
    e4 = pg.evaluate("(() => { const a = __dbg.arcade.state(); return { score: a.score, kills: a.kills, ek: a.enemyKills, ace: a.unlocked.includes('ace'), live: __dbg.enemyAir.state().live }; })()")
    assert e4['ek'] == 2 and e4['kills'] - s0['kills'] == 2, ('E4: 击落应计 2 机', e4)
    assert e4['ace'] is True, ('E4: ace 成就应解锁', e4)
    # 敌机分 500×难度×连击（standard=1.0；连击 1→2）= 500+575=1075
    assert e4['score'] - s0['score'] >= 1000, ('E4: 击落计分应 ≥1000（500×2 连击加成）', (s0, e4))
    assert e4['live'] == 0, ('E4: 击落后无活机', e4)
    print('E4 PASS: 击落 2 机→enemyKills=2+ace 成就+计分（+%d）' % (e4['score'] - s0['score']))

    # ---- E5: nearest 桥接（敌机已全灭——enabled=false 后 nearest 返回 null） ----
    e5 = pg.evaluate("(() => ({ enabled: __dbg.enemyVis.enabled, n: __dbg.enemyVis.nearest(__dbg.apache.root.position, { x: 0, y: 0, z: 1 }, 42) }))()")
    assert e5['enabled'] is False and e5['n'] is None, ('E5: 全灭后 nearest 应 null', e5)
    print('E5 PASS: 全灭后 enabled=false/nearest=null')

    # ---- E6: resetRange 清理（A2A 状态+视觉+燃油全清） ----
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => __dbg.enemyAir.state().active === false && __dbg.enemyVis.state().live === 0", timeout=5000)
    e6 = pg.evaluate("(() => ({ fuel: __dbg.resources.state().fuel, active: __dbg.enemyAir.state().active }))()")
    assert e6['fuel'] == 100 and e6['active'] is False, ('E6: resetRange 应清敌机+燃油复位', e6)
    print('E6 PASS: resetRange 清 A2A/视觉/燃油')

    pg.screenshot(path=H.output_path('shot_enemyair.jpg'), type='jpeg', quality=88)
    print('Phase 20 enemyair OK: E1-E6 全过')


import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
