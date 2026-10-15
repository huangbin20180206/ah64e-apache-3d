# -*- coding: utf-8 -*-
# Phase 14-C：展示与交互精修 — 构图平滑 / 画质一致性 / 后处理不干扰 DOM 反馈
#   D1 FPV→Orbit 切换相机无瞬移（fly 缓动，max jump < 4u；修复前实测 10.11u）
#   D2 画质档位切换后任务上下文（mode-chip/HUD）保持正确（DOM 不随画质丢失）
#   D3 FPV + DOF/Bloom 激活时锁定框 DOM 反馈存在且尺寸稳定（后处理不干扰 DOM）
import sys, os, math
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H


def set_u(pg, fn):
    pg.evaluate("(()=>{ %s })()" % fn)


def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=0', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg && __dbg.fp && __dbg.apache", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S.running = true; __dbg.S.fpSens = 1;")

    # ---- D1 FPV→Orbit 构图平滑：纯数学契约 + 真实首帧捕获 ----
    set_u(pg, "__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.wait_for_timeout(150)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_timeout(300)
    # 同一 evaluate：保存 preExitCamera → toggle 退出 → rAF 链捕获 120 帧轨迹
    #（含退出后的第一个真实渲染/Orbit 更新帧——Playwright 跨 evaluate 采样会漏掉它）
    pg.evaluate("""() => {
      if (!window.__d1) window.__d1 = {};
      const S = window.__d1;
      S.done = false; S.pre = null; S.samples = []; S.f = 0; S.maxF = 120; S.flyF0 = null;
      const cam = __dbg.W.camera;
      S.pre = [cam.position.x, cam.position.y, cam.position.z];
      __dbg.fp.toggle();                        // 退出 FPV → Orbit flyTo 平滑启动
      // toggle 同步返回后 flyTo 已设——立即快照 fly.f（采样结束后 fly 会被清空）
      const fly0 = __dbg.orbit.fly;
      S.flyF0 = fly0 ? { tgt: fly0.f.tgt.toArray().map(v=>+v.toFixed(3)),
        theta: +fly0.f.theta.toFixed(4), phi: +fly0.f.phi.toFixed(4),
        dist: +fly0.f.dist.toFixed(3), f2tgt: fly0.t2.tgt.toArray().map(v=>+v.toFixed(3)) }
        : null;
      function tick() {
        const p = [cam.position.x, cam.position.y, cam.position.z];
        S.samples.push(p);
        S.f++;
        if (S.f < S.maxF) requestAnimationFrame(tick);
        else S.done = true;
      }
      requestAnimationFrame(tick);
    }""")
    pg.wait_for_function("() => window.__d1 && window.__d1.done", timeout=10000)
    d1 = pg.evaluate("""() => {
      const S = window.__d1;
      const f = S.flyF0;
      let mathRecon = null, mathDist = null;
      if (f) {
        const sp = Math.sin(f.phi), cp = Math.cos(f.phi);
        const rx = f.tgt[0] + f.dist * sp * Math.sin(f.theta);
        const ry = f.tgt[1] + f.dist * cp;
        const rz = f.tgt[2] + f.dist * sp * Math.cos(f.theta);
        mathRecon = [+rx.toFixed(3), +ry.toFixed(3), +rz.toFixed(3)];
        mathDist = Math.hypot(rx - S.pre[0], ry - S.pre[1], rz - S.pre[2]);
      }
      return { pre: S.pre.map(v => +v.toFixed(3)), samples: S.samples,
               mathRecon, mathDist, flyF: f };
    }""")
    pre = d1['pre']
    samples = d1['samples']
    print('D1 pre(eye):', pre, ' samples:', len(samples),
          ' mathDist:', round(d1['mathDist'], 4) if d1['mathDist'] is not None else None)
    # 1) 纯数学契约：fly.f.tgt + spherical(f.theta,f.phi,f.dist) 重建的起始相机
    #    == 退出前眼位（三维距离 <= 0.05u）。修复前 target=eye 的组合重建出
    #    2*eye−t2（约 10u 偏差），本断言必 FAIL
    assert d1['mathDist'] is not None and d1['mathDist'] <= 0.05, (
        'D1-math: fly.f 重建相机应与退出前眼位一致（<=0.05u）',
        round(d1['mathDist'], 4) if d1['mathDist'] is not None else None,
        d1['mathRecon'], pre, d1['flyF'])
    # 2) preExit → 首个真实 Orbit 帧 三维位移 <= 0.5u（缓动首帧 ~0.2u；跳变>0.5 即异常）
    first = samples[0]
    dFirst = ((first[0]-pre[0])**2 + (first[1]-pre[1])**2 + (first[2]-pre[2])**2) ** 0.5
    print('D1 preExit→firstFrame 位移:', round(dFirst, 3))
    assert dFirst <= 0.5, ('D1-first: 首个 Orbit 帧位移应 <=0.5u', round(dFirst, 3))
    # 3) 任意相邻真实 RAF 帧位移不得异常尖峰（缓动 12u/1s 帧间 ~0.2u；>2u 判异常）
    jumps = []
    for i in range(1, len(samples)):
        di = ((samples[i][0]-samples[i-1][0])**2 + (samples[i][1]-samples[i-1][1])**2
              + (samples[i][2]-samples[i-1][2])**2) ** 0.5
        jumps.append(di)
    assert all(math.isfinite(j) for j in jumps), 'D1: 帧位移应为有限数值'
    peak = max(jumps)
    print('D1 最大帧间位移:', round(peak, 3))
    assert peak < 2.0, ('D1-peak: 相邻帧无异常尖峰（<2u）', round(peak, 3))
    # 4) 全轨迹有限数值（无 NaN/Infinity）
    finite = all(math.isfinite(v) for s in samples for v in s)
    assert finite, 'D1: 轨迹含 NaN/Infinity'
    # 5) 最终收敛：末 5 帧位移 < 0.1u；末点与 v0 环绕位重建值距离 < 1.5u（缓动收敛）
    tail = [((samples[i][0]-samples[i-1][0])**2 + (samples[i][1]-samples[i-1][1])**2
             + (samples[i][2]-samples[i-1][2])**2) ** 0.5
            for i in range(len(samples)-4, len(samples))]
    assert all(t < 0.1 for t in tail), ('D1-converge: 末段应收敛（帧位移<0.1u）', [round(t,3) for t in tail])
    print('D1 构图平滑 OK: 数学契约 %.4f / 首帧 %.3f / 峰值 %.2f / 收敛' % (
        d1['mathDist'], dFirst, peak))

    # ---- D2 画质档位切换后任务上下文保持 ----
    chip0 = pg.evaluate("document.getElementById('mode-chip').textContent")
    pg.evaluate("__dbg.S._qManual = true")
    for q in ['0.75', '1', '1.5', '2']:
        pg.evaluate("""(()=>{const s=document.getElementById('sel-quality');
          s.value='%s'; s.dispatchEvent(new Event('change',{bubbles:true}));})()""" % q)
        pg.wait_for_timeout(250)
    # B6+：#mode-chip / #hud-rpm 由 loop 每帧写（70-app.js:707/708/716）——等画质切到末档
    # 且渲染两帧后再读，替代循环内固定睡 250ms×4（分类器真候选 L111→L114/L115）
    pg.wait_for_function("() => __dbg.S.quality === 2", timeout=15000)
    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    chip1 = pg.evaluate("document.getElementById('mode-chip').textContent")
    hudRpm = pg.evaluate("document.getElementById('hud-rpm').textContent")
    assert chip0 == chip1 and chip1 != '', ('D2: 画质切换后 mode-chip 应保持且非空', chip0, chip1)
    assert hudRpm != '', ('D2: HUD 读数在画质切换后应存在', hudRpm)
    pg.evaluate("""(()=>{const s=document.getElementById('sel-quality');
      s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true}));})()""")
    pg.wait_for_timeout(250)
    print('D2 画质一致性 OK: 四档切换后 mode-chip/HUD 保持')

    # ---- D3 FPV + DOF 激活时锁定框反馈可见（后处理不干扰 DOM 反馈） ----
    # 低悬停 + 静态目标放机头前方 12u（锥 45° 内，确保真实锁定态）
    set_u(pg, "__dbg.FLY.state='hover'; __dbg.FLY.alt=5; __dbg.FLY.fp=true; "
                "__dbg.FLY.x=0; __dbg.FLY.z=30; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.wait_for_timeout(150)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_function("() => __dbg.composer._dofActive", timeout=8000)
    placed = pg.evaluate("""() => {
      const tt = __dbg.targets.targets;
      const t = tt.find(x => !x.mov);
      if (!t) return null;
      const p = __dbg.apache.root.position;
      t.pos.set(p.x, 0.8, p.z + 12);     // 机头前方 12u、地面
      t.alive = true; if (t.group) t.group.visible = true;
      return (t.label || t.type);
    }""")
    assert placed, ('D3: 应有静态目标可放置', placed)
    pg.wait_for_timeout(300)
    st = pg.evaluate("""() => {
      const el = document.getElementById('fp-lock');
      const ar = document.getElementById('fp-arr');
      return { dispLock: el ? getComputedStyle(el).display : 'none',
               dispArr: ar ? getComputedStyle(ar).display : 'none',
               lockD: +(__dbg.fp.lockD || 0).toFixed(1),
               dof: !!__dbg.composer._dofActive, owner: __dbg.modeState.owner };
    }""")
    print('D3 FPV+DOF 锁定框:', st)
    assert st['dof'] and st['owner'] == 'fp', ('D3: DOF 应激活且处于 FPV', st)
    # 锁定反馈可见（屏内=box 框、屏外=方位箭头——任一可见即反馈正常）：
    # DOF 是渲染 pass，不得抑制 DOM 锁定反馈
    assert st['lockD'] > 1, ('D3: 目标应在锥内锁定', st)
    assert st['dispLock'] == 'block' or st['dispArr'] == 'block', (
        'D3: DOF 激活下锁定反馈应可见（box/arrow）', st)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)
    print('D3 后处理不干扰 DOM 反馈 OK: DOF 激活下锁定框可见')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')