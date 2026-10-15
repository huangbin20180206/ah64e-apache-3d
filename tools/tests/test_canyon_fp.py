# -*- coding: utf-8 -*-
# test_canyon_fp.py — 批 E（2026-10-12）：第一人称飞峡谷
# 帧率无关：时间推进走 __dbg.step（H.step / H.step_until），不依赖墙钟帧率。
# 断言：
#   F0 峡谷任务里悬停进 FPV → #fp-gpws 显示，读数含"离地/崖顶下"；非峡谷场地 FPV 不显示
#   F1 probe：谷底中线机头朝前 → warn=0、离地≈悬停高度；机头正对近处岩壁 → warn=2 且 HUD 标红"拉起"
#   F2 爬到崖顶以上 → rimGap<0、HUD 切到"已露头"、暴露条上涨
#   F3 FPV 按住 W 朝岩壁冲 3s → 旋翼盘始终不进岩体（collide 退回），擦碰计数增加
#   F4 退出 FPV / 离开峡谷 → #fp-gpws 隐藏
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

SETUP = """(() => { const m = __dbg.S._mission; m.phase='active'; if (m.t0 == null) m.t0 = __dbg.S.time;
  const r=__dbg.rig; m.gun0=r.gunAmmo; m.rk0=r.rocketAmmo; m.hf0=r.hfAmmo; __dbg.beginMission(); })()"""

def gp(pg):
    return pg.evaluate("""(() => { const el = document.getElementById('fp-gpws');
      return { show: el.classList.contains('show'), txt: el.textContent, warn: el.classList.contains('warn'),
        caution: el.classList.contains('caution'), exposed: el.classList.contains('exposed'),
        disp: getComputedStyle(el).display, vis: el.offsetParent !== null }; })()""")

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.targets.canyon && __dbg.fp)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S._guide = 0")

    # ---- F0a 非峡谷：标准场地 FPV 不显示地形读数 ----
    pg.evaluate("(() => { const F=__dbg.FLY; __dbg.S.running=true; __dbg.S.spin=1; F.state='hover'; F.alt=14; F.x=0; F.z=0; F.yaw=0; __dbg.fp.enter(); })()")
    H.step(pg, 0.5)
    g = gp(pg)
    assert pg.evaluate("__dbg.fp.active") and not g['show'] and not g['vis'], ('F0: 非峡谷 FPV 不应显示 gpws', g)
    pg.evaluate("__dbg.fp.exit()")
    H.step(pg, 0.3)

    # ---- 进峡谷任务 ----
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    H.step(pg, 0.3)
    pg.evaluate("__dbg.startMission()")
    H.step_until(pg, "() => document.querySelectorAll('#mission-variants .chip').length === 7", 15)
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"canyon_run\"]').click()")
    H.step_until(pg, "() => __dbg.targets.canyon.active === true", 20)
    pg.evaluate(SETUP)
    # 谷底中线、路径 10% 处、机头沿谷向，悬停 4.5
    pg.evaluate("""(() => { const C=__dbg.targets.canyon, F=__dbg.FLY, p=C.pointAt(0.10);
      __dbg.S.running=true; __dbg.S.spin=1; F.state='hover'; F.x=p.x; F.z=p.z; F.alt=4.5; F.userAlt=4.5;
      F.yaw=Math.atan2(p.dirx, p.dirz); F.pitch=0; F.roll=0; __dbg.fp.enter(); })()""")
    H.step(pg, 0.4)
    g = gp(pg)
    print('F0', g)
    assert g['show'] and g['vis'], ('F0: 峡谷 FPV 应显示 gpws', g)
    assert '离地' in g['txt'] and '崖顶下' in g['txt'], ('F0: 读数应含离地/崖顶下', g)

    # ---- F1 probe：谷向安全；正对岩壁告警 ----
    p1 = pg.evaluate("""(() => { const C=__dbg.targets.canyon, F=__dbg.FLY; const o={};
      const a = C.probe(F, {}); o.safe = { warn: a.warn, agl: a.agl, rim: a.rimGap, ahead: a.ahead };
      // 机头转 90° 正对侧壁，贴近到离中线 3u
      const p=C.pointAt(0.10); const nx=p.dirz, nz=-p.dirx;
      F.x = p.x + nx*3; F.z = p.z + nz*3; F.yaw = Math.atan2(nx, nz);
      const b = C.probe(F, {}); o.wall = { warn: b.warn, ahead: b.ahead }; return o; })()""")
    print('F1', p1)
    assert p1['safe']['warn'] == 0, ('F1: 谷底中线沿谷向应无告警', p1)
    assert abs(p1['safe']['agl'] - 4.5) < 0.3 and p1['safe']['rim'] > 3, ('F1: 离地≈4.5u、在崖顶以下', p1)
    assert p1['wall']['warn'] == 2 and p1['wall']['ahead'] < 0.4, ('F1: 正对近壁应拉起告警', p1)
    # 不推进帧（推进会被 collide 退回原位），直接刷新 HUD 读数
    pg.evaluate("__dbg.fp._gpws()")
    g = gp(pg)
    assert g['warn'] and '拉起' in g['txt'], ('F1: HUD 应标红拉起', g)

    # ---- F2 露头 ----
    pg.evaluate("""(() => { const C=__dbg.targets.canyon, F=__dbg.FLY, p=C.pointAt(0.10);
      F.x=p.x; F.z=p.z; F.yaw=Math.atan2(p.dirx, p.dirz); F.alt=13; C.exposure=0; })()""")
    H.step(pg, 0.6)
    g = gp(pg)
    ex = pg.evaluate("__dbg.targets.canyon.exposure")
    print('F2', g, ex)
    assert g['exposed'] and '已露头' in g['txt'], ('F2: 崖顶以上应显示已露头', g)
    assert ex > 0, ('F2: 露头后暴露度应上涨', ex)

    # ---- F3 FPV 按 W 冲向岩壁：不穿岩 + 计擦碰 ----
    r3 = pg.evaluate("""(() => { const C=__dbg.targets.canyon, F=__dbg.FLY, p=C.pointAt(0.10);
      const nx=p.dirz, nz=-p.dirx; F.x=p.x; F.z=p.z; F.alt=3; F.userAlt=3; F.yaw=Math.atan2(nx, nz);
      __dbg.fp.vYaw = F.yaw; __dbg.fp.vPitch = 0; __dbg.fp.spd = 0; C.strikes = 0; C._hitCd = 0; C._px = null;
      __dbg.keys['w'] = true; let worst = 99;
      for (let i = 0; i < 90; i++) { __dbg.step(1/30);
        let m = 0; for (let k = 0; k < 8; k++) { const a = k*Math.PI/4;
          m = Math.max(m, C.heightAt(F.x + Math.cos(a)*3, F.z + Math.sin(a)*3)); }
        worst = Math.min(worst, F.alt + 1.7 - m); }
      __dbg.keys['w'] = false;
      return { worst, strikes: C.strikes, dist: Math.hypot(F.x - p.x, F.z - p.z) }; })()""")
    print('F3', r3)
    assert r3['strikes'] >= 1, ('F3: 冲向岩壁应计擦碰', r3)
    assert r3['worst'] > -0.6, ('F3: 旋翼盘不应深入岩体', r3)
    assert r3['dist'] < 8, ('F3: 应被岩壁挡住', r3)

    # ---- F4 退出 FPV / 离开峡谷 ----
    pg.evaluate("__dbg.fp.exit()")
    H.step(pg, 1.0)
    assert not gp(pg)['vis'], 'F4: 退出 FPV 后 gpws 随 fp-hud 隐藏'
    pg.evaluate("""(() => { const F=__dbg.FLY; F.alt=4.5; __dbg.fp.enter(); })()""")
    H.step(pg, 0.3)
    pg.evaluate("document.querySelector('#mission-variants [data-variant=\"standard\"]').click() || __dbg.setMode('display')")
    pg.evaluate("__dbg.setMode('display')")
    H.step_until(pg, "() => __dbg.targets.canyon.active === false", 10)
    H.step(pg, 0.3)
    g = gp(pg)
    assert not g['show'], ('F4: 离开峡谷 gpws 应隐藏', g)
    print('canyon FP OK: F0-F4')


H.guarded_main(run, hard_timeout=240)
print('PASS')
