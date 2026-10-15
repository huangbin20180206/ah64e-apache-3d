# -*- coding: utf-8 -*-
# C005 制空作战（air_superiority）确定性冒烟测试——验证"续波 + 计数 + 满 6 结算"逻辑链：
#   A1 变体登记：简报多出「制空作战」chip；名称/目标/完成条件/时限（300s=5 分钟）文案；
#      弹药标准满弹（不减半，与 standard 一致）
#   A2 开局波次：2 架并发在场（ENEMYCFG.N=2 编队结构未改、单元数恒 2）、总击落 0、
#      进度面板渲染「已击落敌机 0 / 6」+「第 1 / 3 波」
#   A3 【架构铁律】地面全歼不结算：本变体胜利与地面目标无关——清光地面后仍 active、
#      不误判胜利、击落数不受影响（证明完成判定未挂在 aliveCount===0 上）
#   A4 续波：每波 2 架全下 → 自动复用既有 2 单元 spawn 下一波（单元数恒 2、满血满弹复位）；
#      未满 6 时不结算（不误判胜利）
#   A5 满 6 → completeMission：结算面板含变体名 + 「击落敌机 6 / 6」
#
# 确定性说明：
#   ① 击落注入走 87 既有入口 enemyAir.hitTest(单元实时坐标, 致命伤害)——不真跑 AI 飞行；
#      计数消费走 loop 既有 killEvent 链路（验证真实链路，非直接写计数）。
#   ② 本局把玩家机位泊到远场（FLY.x=220，既有平移通道），使敌机索敌视距（55u）与
#      基地 AA 交战区（8~55u）都够不到——避免敌机开火累加 _heliDmg 触发既有的
#      「损伤≥12 失败」路径干扰本测试（该失败条件属既有链路，另行由 P8 测试覆盖）。
#      末尾显式断言 _heliDmg 恒 0，把"中和生效"变成正向证据而非假设。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

KILLS = 6


def _kill_one(pg, expect):
    """击落当前在场的一架（读实时坐标 → 致命 hitTest），等 loop 消费计数到 expect。"""
    info = pg.evaluate("""() => {
      const u = __dbg.enemyAir.units.find(x => x.on && x.phase !== 'down');
      return u ? { x: u.x, y: u.y, z: u.z } : null;
    }""")
    assert info, 'A4: 当前波无在场敌机可击落'
    pg.evaluate("__dbg.enemyAir.hitTest({ x: %r, y: %r, z: %r }, 999)"
                % (info['x'], info['y'], info['z']))
    pg.wait_for_function("() => (__dbg.mission._airKills || 0) >= %d" % expect, timeout=10000)


def run(pg):
    # 就绪条件只等已装配的槽位——__dbg.mission 在 startMission 之前是 undefined
    # （S._mission 属性此刻尚未创建），把它写进就绪条件会让条件恒假而超时。
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets "
                         "&& __dbg.rig && __dbg.enemyAir)",
                         timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S._guide = 0")

    # ---- A1：进入制空作战变体（简报）----
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("""() => document.querySelectorAll('#mission-variants .chip').length === 7
        && document.getElementById('mission-body').innerHTML.indexOf('完成条件') >= 0""", timeout=15000)
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"air_superiority\"]').click()")
    pg.wait_for_function("() => __dbg.mission.variant === 'air_superiority'", timeout=10000)
    b = pg.evaluate("document.getElementById('mission-body').innerHTML")
    assert '制空作战' in b, ('A1: 简报应含变体名 制空作战', b)
    assert '击落全部来袭敌机' in b, ('A1: 简报完成条件文案', b)
    assert '来袭敌机 ×6' in b and '3 波' in b, ('A1: 简报目标文案（6 架 / 3 波）', b)
    assert '5 分钟' in b, ('A1: 时限应为 300s（5 分钟）', b)
    am = pg.evaluate("({gun:__dbg.rig.gunAmmo, rk:__dbg.rig.rocketAmmo, hf:__dbg.rig.hfAmmo})")
    assert am['gun'] == 1200 and am['rk'] == 38 and am['hf'] == 8, ('A1: 制空作战应标准满弹（不减半）', am)
    print('A1 PASS: 变体登记 / 简报文案 / 时限 300s / 标准满弹')

    # ---- A2：开局波次 = 2 架并发，战果 0 ----
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'active'", timeout=10000)
    # 泊远场（见文件头确定性说明②）
    pg.evaluate("__dbg.FLY.x = 220; __dbg.FLY.z = 0")
    st = pg.evaluate("() => { const s = __dbg.enemyAir.state(); return { live: s.live, units: s.units.length }; }")
    assert st['live'] == 2 and st['units'] == 2, ('A2: 开局应 2 架并发且单元数恒 2（未扩结构）', st)
    k0 = pg.evaluate("__dbg.mission._airKills || 0")
    assert k0 == 0, ('A2: 开局击落数应为 0', k0)
    pg.wait_for_function("() => document.getElementById('mission-body').innerHTML.indexOf('已击落敌机') >= 0",
                         timeout=10000)
    pb = pg.evaluate("document.getElementById('mission-body').innerHTML")
    assert '0 / 6' in pb and '第 1 / 3 波' in pb, ('A2: 进度面板应渲染空战战果', pb)
    print('A2 PASS: 开局 2 架并发 / 战果 0 / 面板 0-6 + 第 1 波')

    # ---- A3：架构铁律——地面全歼不结算（胜利与地面目标解耦）----
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); })")
    pg.wait_for_function("() => __dbg.targets.aliveCount === 0", timeout=10000)
    pg.wait_for_function("() => __dbg.S.time > 0", timeout=5000)
    pg.wait_for_timeout(1600)          # 越过 ≥3 个 0.5s 判定节流窗
    s3 = pg.evaluate("({phase:__dbg.mission.phase, done:__dbg.mission.done, "
                     "alive:__dbg.targets.aliveCount, k:__dbg.mission._airKills||0})")
    assert s3['alive'] == 0, ('A3: 地面应已全歼', s3)
    assert s3['phase'] == 'active' and not s3['done'], \
        ('A3【架构铁律】: 地面全歼不得判定制空作战胜利（胜利须与地面解耦）', s3)
    assert s3['k'] == 0, ('A3: 击落数不应受地面清空影响', s3)
    print('A3 PASS: 地面全歼不结算（胜利与地面目标解耦）')

    # ---- A4 / A5：逐波击落 6 架（续波 + 计数 + 满 6 结算）----
    for wave in (1, 2, 3):
        base = (wave - 1) * 2
        _kill_one(pg, base + 1)
        _kill_one(pg, base + 2)
        if wave < 3:
            s = pg.evaluate("({phase:__dbg.mission.phase, done:__dbg.mission.done, k:__dbg.mission._airKills||0})")
            assert s['phase'] == 'active' and not s['done'], \
                ('A4: 未满 6 不得结算（第 %d 波清光后）' % wave, s)
            pg.wait_for_function("() => __dbg.enemyAir.state().live === 2", timeout=10000)
            nx = pg.evaluate("""() => {
              const u = __dbg.enemyAir.units;
              return { n: u.length, all: u.every(x => x.on && x.phase === 'patrol' && x.hp === 8 && x.gunN === 40) };
            }""")
            assert nx['n'] == 2 and nx['all'], \
                ('A4: 续波应复用既有 2 单元并满血满弹复位（不新增单元）', nx)
            print('A4 PASS: 第 %d 波清光 → 续第 %d 波（单元数恒 2 / 满血复位 / 未满 6 不结算）'
                  % (wave, wave + 1))
    # 第 3 波清光 = 满 6 → completeMission
    pg.wait_for_function("() => __dbg.mission.phase === 'done'", timeout=15000)
    s5 = pg.evaluate("({phase:__dbg.mission.phase, done:__dbg.mission.done, frozen:__dbg.mission.frozen, "
                     "k:__dbg.mission._airKills||0, dmg:__dbg.targets._heliDmg||0, "
                     "body:document.getElementById('mission-body').innerHTML})")
    assert s5['k'] == KILLS, ('A5: 总击落应为 6', s5)
    assert s5['done'] and s5['phase'] == 'done' and s5['frozen'], ('A5: 满 6 应结算并冻结', s5)
    assert '制空作战' in s5['body'], ('A5: 结算面板应含变体名', s5['body'])
    assert '击落敌机' in s5['body'] and '6 / 6' in s5['body'], ('A5: 结算面板应含击落战果', s5['body'])
    assert s5['dmg'] == 0, ('A5: 泊远场后机体应零损伤（确定性中和生效）', s5)
    print('A5 PASS: 满 6 结算（面板含变体名 + 击落敌机 6 / 6；机体零损伤）')

    # ---- A6：撤离退场不续波（老黄拍板"退场就退场吧，不要再回来了，正常游戏逻辑"）----
    # 语义：只有"被打光"（两架皆 phase==='down'）才续下一波；撤离退场（withdraw 出界
    # → on=false，phase 仍为 'withdraw'）的敌机**永久退场**，不得以"满血新波"形式回来。
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'briefing'", timeout=10000)
    assert pg.evaluate("__dbg.mission.variant") == 'air_superiority', 'A6: 重试应保留制空作战变体'
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_function("() => __dbg.mission.phase === 'active'", timeout=10000)
    pg.evaluate("__dbg.FLY.x = 220; __dbg.FLY.z = 0")
    pg.wait_for_function("() => __dbg.enemyAir.state().live === 2", timeout=10000)
    # ① 一号机复刻"撤离退场"状态（87 出界后的真实终态：phase='withdraw' 且 on=false）
    pg.evaluate("""() => {
      const u = __dbg.enemyAir.units[0];
      u.phase = 'withdraw'; u.on = false;
      return true;
    }""")
    # ② 击落二号机 → 本波"一死一逃"，不得续波
    _kill_one(pg, 1)
    pg.wait_for_timeout(1600)          # 越过 ≥3 个 0.5s 续波判定窗
    s6 = pg.evaluate("({live:__dbg.enemyAir.state().live, k:__dbg.mission._airKills||0, "
                     "phase:__dbg.mission.phase, done:__dbg.mission.done})")
    assert s6['live'] == 0, ('A6: 撤离退场不得触发续波（逃掉的敌机不许回来）', s6)
    assert s6['k'] == 1 and s6['phase'] == 'active' and not s6['done'], \
        ('A6: 未满 6 不得结算（逃机未补波）', s6)
    print('A6 PASS: 撤离退场不续波（逃机永久退场，本局不再补波）')

    print('air-superiority OK: 续波(3 波 × 2 架) + 计数 + 满 6 结算 + 地面解耦 + 退场不续波')


H.guarded_main(run, hard_timeout=240)
print('PASS')
