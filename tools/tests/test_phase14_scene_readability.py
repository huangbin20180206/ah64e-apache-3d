# -*- coding: utf-8 -*-
# Phase 14-F：场景空间可读性与叙事展示 — 定向测试
#   S1 语义对象定位（name 全套：radar/sam/ammo/lamp/patrol/smoke）
#   S2 world-space bbox：地面件贴地、巡逻机空中高度、烟柱底缘贴地升起
#   S3 灯柱-灯头衔接（迁移 R5 断言）
#   S4 地面件间 XZ 无明显穿插
#   S5 10 秒运动采样：雷达持续旋转、巡逻机沿轨道连续移动（无瞬移）、烟柱呼吸
#   S6 巡逻机机头沿切线方向（R1 返修点：rotation.y=-a）
#   S7 全轨迹有限数值（无 NaN/Infinity/瞬移尖峰）
#   S8 多视角可见性：默认环绕 / 基地方向 / FPV / 夜间——对象入视锥 + DOM 反馈保持
#   S9 无 pageerror/控制台异常（harness ERRORS 收集）
#   S10 内建失败断言：烟柱消失（opacity 恒 0）、巡逻机过低、地面件穿地
import sys, os, math
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

WORLDBOX_JS = """(o) => {
  o.updateMatrixWorld(true);
  const b = (o.geometry.boundingBox) || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
  if (!b) return null;
  const e = o.matrixWorld.elements;
  const x=b.min.x,y=b.min.y,z=b.min.z,X=b.max.x,Y=b.max.y,Z=b.max.z;
  const pts=[[x,y,z],[X,y,z],[x,Y,z],[x,y,Z],[X,Y,z],[X,y,Z],[x,Y,Z],[X,Y,Z]];
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for (const p of pts) {
    const wx=e[0]*p[0]+e[4]*p[1]+e[8]*p[2]+e[12];
    const wy=e[1]*p[0]+e[5]*p[1]+e[9]*p[2]+e[13];
    const wz=e[2]*p[0]+e[6]*p[1]+e[10]*p[2]+e[14];
    if (wx<mn[0])mn[0]=wx; if (wy<mn[1])mn[1]=wy; if (wz<mn[2])mn[2]=wz;
    if (wx>mx[0])mx[0]=wx; if (wy>mx[1])mx[1]=wy; if (wz>mx[2])mx[2]=wz;
  }
  return { mn, mx };
}"""


def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=1', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg && __dbg.narrative && __dbg.apache", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.targets.enabled = true")
    pg.wait_for_timeout(500)

    # ---- S1 语义对象定位（name 全套） ----
    found = pg.evaluate("""() => {
      const names = ['narrative-radar', 'narrative-radar-mast', 'narrative-radar-dish',
        'narrative-sam', 'narrative-sam-body', 'narrative-ammo',
        'narrative-ammo-crate-0', 'narrative-ammo-crate-1', 'narrative-ammo-crate-2',
        'narrative-lamp', 'narrative-lamp-pole', 'narrative-lamp-head',
        'narrative-patrol-0', 'narrative-patrol-1',
        'narrative-smoke-0', 'narrative-smoke-1'];
      const found = {}, missing = [];
      const idx = {};
      __dbg.narrative.group.traverse(o => {
        if (o.name) { found[o.name] = (found[o.name] || 0) + 1; idx[o.name] = o; }
      });
      for (const n of names) if (!found[n]) missing.push(n);
      return { found, missing, idxNames: Object.keys(idx).filter(k => k.startsWith('narrative-')) };
    }""")
    assert not found['missing'], ('S1: 语义对象缺失', found['missing'])
    assert len(found['idxNames']) >= 16, ('S1: name 标记数量不足', found['idxNames'])
    print('S1 语义定位 OK: %d 个命名对象' % len(found['idxNames']))

    # ---- S2/S3/S4/S10 world bbox：贴地/高度/衔接/穿插 ----
    boxes = pg.evaluate("""() => {
      function worldBox(o) {
        o.updateMatrixWorld(true);
        const b = (o.geometry.boundingBox) || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
        if (!b) return null;
        const e = o.matrixWorld.elements;
        const x=b.min.x,y=b.min.y,z=b.min.z,X=b.max.x,Y=b.max.y,Z=b.max.z;
        const pts=[[x,y,z],[X,y,z],[x,Y,z],[x,y,Z],[X,Y,z],[X,y,Z],[x,Y,Z],[X,Y,Z]];
        let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
        for (const p of pts) {
          const wx=e[0]*p[0]+e[4]*p[1]+e[8]*p[2]+e[12];
          const wy=e[1]*p[0]+e[5]*p[1]+e[9]*p[2]+e[13];
          const wz=e[2]*p[0]+e[6]*p[1]+e[10]*p[2]+e[14];
          if (wx<mn[0])mn[0]=wx; if (wy<mn[1])mn[1]=wy; if (wz<mn[2])mn[2]=wz;
          if (wx>mx[0])mx[0]=wx; if (wy>mx[1])mx[1]=wy; if (wz>mx[2])mx[2]=wz;
        }
        return { mn, mx };
      }
      const pick = {};
      __dbg.narrative.group.traverse(o => {
        if (!o.isMesh) return;
        const b = worldBox(o);
        if (!b) return;
        pick[o.name] = { minY: +b.mn[1].toFixed(3), maxY: +b.mx[1].toFixed(3),
          minX: +b.mn[0].toFixed(2), maxX: +b.mx[0].toFixed(2),
          minZ: +b.mn[2].toFixed(2), maxZ: +b.mx[2].toFixed(2) };
      });
      return pick;
    }""")
    # S2 地面件不穿地
    ground = ['narrative-radar-mast', 'narrative-sam-body', 'narrative-ammo-crate-0',
              'narrative-ammo-crate-1', 'narrative-lamp-pole']
    below = [n for n in ground if boxes[n]['minY'] < -0.05]
    assert not below, ('S2/S10: 地面件穿地', {n: boxes[n] for n in below})
    # 烟柱底缘贴地升起（Sprite 中心 y-半高 >= 0）
    smokeBottom = pg.evaluate("""() => __dbg.narrative.smokes.map(sm =>
      +(sm.s.position.y - sm.s.scale.y / 2).toFixed(2))""")
    assert all(b >= 0 for b in smokeBottom), ('S2/S10: 烟柱底缘穿地', smokeBottom)
    # B3 巡逻机空中高度（>=10）
    airMinY = min(boxes['narrative-patrol-%d-fus' % i]['minY'] for i in range(2))
    assert airMinY > 10, ('S10: 巡逻机过低（<10u）', airMinY)
    # S3 灯柱贴地 + 柱顶-灯头底衔接
    assert abs(boxes['narrative-lamp-pole']['minY']) <= 0.05, ('S3: 灯柱应贴地', boxes['narrative-lamp-pole'])
    gap = boxes['narrative-lamp-head']['minY'] - boxes['narrative-lamp-pole']['maxY']
    assert -0.25 <= gap <= 0.1, ('S3: 灯柱-灯头衔接异常', round(gap, 3))
    # S4 地面组间 XZ 无明显穿插（radar/sam/ammo/lamp 四组包围盒两两不重叠）
    groups = {}
    for n in boxes:
        for pref in ['narrative-radar', 'narrative-sam', 'narrative-ammo', 'narrative-lamp-pole']:
            if n.startswith(pref):
                groups.setdefault(pref, []).append(boxes[n])
    gs = {k: {'minX': min(b['minX'] for b in v), 'maxX': max(b['maxX'] for b in v),
              'minZ': min(b['minZ'] for b in v), 'maxZ': max(b['maxZ'] for b in v)}
          for k, v in groups.items()}
    keys = list(gs.keys())
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = gs[keys[i]], gs[keys[j]]
            overlap = (a['minX'] < b['maxX'] and b['minX'] < a['maxX'] and
                       a['minZ'] < b['maxZ'] and b['minZ'] < a['maxZ'])
            assert not overlap, ('S4: 地面组 XZ 穿插', keys[i], keys[j], a, b)
    print('S2/S3/S4 bbox OK: 贴地/衔接/无穿插（烟柱底 %s）' % smokeBottom)

    # ---- S5/S6/S7 10 秒运动采样（雷达/巡逻/烟柱 + 机头切向 + 有限性） ----
    pg.evaluate("""() => {
      window.__m10 = { t: [], radar: [], patrol: [], smoke: [], rot: [], done: false, n: 0 };
      const S = window.__m10;
      function tick() {
        const st = __dbg.narrative.state();
        S.t.push(+__dbg.S.time.toFixed(2));
        S.radar.push(st.radarR);
        S.patrol.push(st.patrol.map(p => [p.x, p.z]));
        S.smoke.push(st.smokeOpacity.slice());
        S.rot.push(__dbg.narrative.patrol.map(p => +p.g.rotation.y.toFixed(3)));
        S.n++;
        if (S.n < 40) requestAnimationFrame(tick);   // 40 帧 × 采样间隔由外部 rAF 节奏决定
        else { S.done = true; }
      }
      // 每 0.25s 采一次，40 次 ≈ 10s
      const iv = setInterval(() => { if (S.done) { clearInterval(iv); } }, 250);
      // 用 setInterval 采样（rAF 依赖渲染帧率，采样窗固定 0.25s 更均匀）
      const sample = () => {
        if (S.done) return;
        const st = __dbg.narrative.state();
        S.t.push(+__dbg.S.time.toFixed(2));
        S.radar.push(st.radarR);
        S.patrol.push(st.patrol.map(p => [p.x, p.z]));
        S.smoke.push(st.smokeOpacity.slice());
        S.rot.push(__dbg.narrative.patrol.map(p => +p.g.rotation.y.toFixed(3)));
        S.n++;
        setTimeout(sample, 250);
      };
      sample();
    }""")
    pg.wait_for_function("() => window.__m10 && window.__m10.n >= 40", timeout=15000)
    m10 = pg.evaluate("() => window.__m10")
    # 雷达持续平滑旋转（每相邻采样 |Δ|>0 且方向一致累计 >0.1）
    dr = [m10['radar'][i] - m10['radar'][i-1] for i in range(1, len(m10['radar']))]
    assert all(abs(d) > 1e-6 for d in dr), ('S5: 雷达存在静止采样', dr)
    totalRot = m10['radar'][-1] - m10['radar'][0]
    assert abs(totalRot) > 0.3, ('S5: 雷达 10s 旋转量不足', totalRot)
    # 巡逻机连续移动（每相邻采样位移 0~2u，无瞬移；累计移动明显）
    for pi in range(2):
        ds = []
        for i in range(1, len(m10['patrol'])):
            a = m10['patrol'][i][pi]; b = m10['patrol'][i-1][pi]
            ds.append(((a[0]-b[0])**2 + (a[1]-b[1])**2) ** 0.5)
        assert all(math.isfinite(d) and d < 2 for d in ds), ('S5/S7: 巡逻机瞬移/异常', pi, ds)
        assert sum(ds) > 2, ('S5: 巡逻机 10s 移动量不足', pi, sum(ds))
    # 烟柱呼吸：opacity 全程有变化且最大值 >0.1（未消失）
    smMin = min(min(s) for s in m10['smoke'])
    smMax = max(max(s) for s in m10['smoke'])
    assert smMax > 0.1, ('S10: 烟柱消失（最大 opacity <=0.1）', smMax)
    assert smMax - smMin > 0.05, ('S5: 烟柱无呼吸变化', smMin, smMax)
    # S6 巡逻机机头沿切线：机头方向 (sinθ,cosθ) 与切向夹角 < 0.3rad
    # 由相邻位置差推实际飞行方向，与 rotation.y 预测机头方向比较
    for pi in range(2):
        n = len(m10['patrol'])
        for i in range(1, n):
            a = m10['patrol'][i][pi]; b = m10['patrol'][i-1][pi]
            vx, vz = a[0]-b[0], a[1]-b[1]
            vl = math.hypot(vx, vz)
            if vl < 1e-3:
                continue
            heading = m10['rot'][i][pi]
            hx, hz = math.sin(heading), math.cos(heading)
            dot = (hx*vx + hz*vz) / vl
            ang = math.acos(max(-1, min(1, dot)))
            assert ang < 0.3, ('S6: 巡逻机机头偏离切向', pi, i, round(ang, 3))
    # S7 全有限
    allt = m10['t'] + [v for p in m10['patrol'] for pp in p for v in pp] + \
           [v for s in m10['smoke'] for v in s] + m10['radar'] + [v for r in m10['rot'] for v in r]
    assert all(math.isfinite(v) for v in allt), 'S7: 采样含 NaN/Infinity'
    print('S5/S6/S7 10s 运动采样 OK: 雷达 %.2frad、巡逻连续、机头切向<0.3rad、烟柱呼吸 %.2f~%.2f、全有限' % (
        abs(totalRot), smMin, smMax))

    # ---- S8 多视角可见性（环绕默认 / 基地方向 / FPV / 夜间） ----
    def visibility(view_setup, settle_orbit=False):
        pg.evaluate(view_setup)
        if settle_orbit:
            # 相机位置由 orbit 阻尼逐帧收敛（damping 0.12）；固定睡 500ms 在高负载下
            # rAF 被节流时可能一帧都没跑，采样到的是过渡中途的视角——GATE-R6 实测
            # lamp 夹角 1.081 / patrol 1.285 越过 1.05 阈值，纯属"还没转到位"。
            # 等到 live 参数真的收敛到目标参数再采样。
            pg.wait_for_function("""() => { const o = __dbg.orbit;
              return Math.abs(o.dist - o.tDist) < 0.05
                  && Math.abs(o.phi - o.tPhi) < 0.005
                  && Math.abs(o.theta - o.tTheta) < 0.005; }""", timeout=15000)
        else:
            pg.wait_for_timeout(500)
        return pg.evaluate("""() => {
          const cam = __dbg.W.camera;
          const items = [];
          const g = __dbg.narrative.group;
          g.traverse(o => { if (o.name === 'narrative-radar' || o.name === 'narrative-sam'
                || o.name.startsWith('narrative-patrol-') || o.name === 'narrative-lamp'
                || o.name.startsWith('narrative-smoke-')) items.push(o); });
          // 可见性判据（视角夹角，纯算术稳健）：视线方向 = orbit.target - 相机位置；
          // 对象方向与视线夹角 < 60° 视为在视锥内可辨（不依赖投影矩阵更新时机）
          const cp = cam.position;
          const lk = __dbg.orbit.target;
          let dlx = lk.x - cp.x, dly = lk.y - cp.y, dlz = lk.z - cp.z;
          const dll = Math.hypot(dlx, dly, dlz) || 1;
          dlx /= dll; dly /= dll; dlz /= dll;
          let vis = 0;
          const det = [];
          for (const obj of items) {
            obj.updateWorldMatrix(true, false);
            const wp = [obj.matrixWorld.elements[12], obj.matrixWorld.elements[13],
                        obj.matrixWorld.elements[14]];
            const vx = wp[0] - cp.x, vy = wp[1] - cp.y, vz = wp[2] - cp.z;
            const vl = Math.hypot(vx, vy, vz) || 1;
            const dot = (vx*dlx + vy*dly + vz*dlz) / vl;
            const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
            const ok = ang < 1.05;                     // ~60°（FOV 34°+余量）
            det.push({ name: obj.name, ang: +ang.toFixed(3), ok });
            if (ok) vis++;
          }
          return { total: items.length, vis, det,
            chip: document.getElementById('mode-chip').textContent };
        }""")
    # 环绕基地方向（相机看向基地）
    # 注意：FPV 退出触发的 R1 flyTo 会每帧驱动 orbit 参数（指向机体眼位）——
    # 测试设置自定义视角前必须清 orbit.fly，否则视线中心被动画覆盖
    pg.evaluate("__dbg.orbit.fly = null")
    v1 = visibility("__dbg.orbit.tTarget.set(0, 3, 42); __dbg.orbit.target.copy(__dbg.orbit.tTarget); __dbg.orbit.tDist = 60; __dbg.orbit.tPhi = 1.0; __dbg.orbit.tTheta = 0.4;", settle_orbit=True)
    # 核心件（radar/sam/lamp/patrol）必须可见；烟柱在基地外围北侧（82-130u），
    # 该视角下天然位于相机背后/锥外——不强制可见（其"存在+呼吸"由 S5 验证）
    coreOk = [d for d in v1['det'] if not d['name'].startswith('narrative-smoke-')]
    coreBad = [d for d in coreOk if not d['ok']]
    assert not coreBad, ('S8: 基地方向视角核心件不可见', coreBad)
    assert v1['vis'] >= v1['total'] - 2, ('S8: 基地方向视角可见数异常', v1)
    # FPV（悬停低空看基地）
    pg.evaluate("__dbg.S.running = true; __dbg.FLY.state='hover'; __dbg.FLY.alt=8; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=10; __dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0;")
    pg.wait_for_timeout(150)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    # B6+：#mode-chip 由 loop 每帧写（70-app.js:707/708）——等它有内容再断言
    # （分类器真候选 L262→L265）
    pg.wait_for_function("() => (document.getElementById('mode-chip').textContent || '') !== ''", timeout=15000)
    v2 = visibility("__dbg.FLY.yaw = 0")
    assert v2['vis'] >= 2, ('S8: FPV 视角基地对象不可辨', v2)
    assert pg.evaluate("document.getElementById('mode-chip').textContent") != '', 'S8: FPV 中 chip 应保持'
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)
    # 夜间（黄昏/夜间环境切换）
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.wait_for_timeout(600)
    pg.evaluate("__dbg.orbit.fly = null")   # 同上：清残留过渡动画
    v3 = visibility("__dbg.orbit.tTarget.set(0, 3, 42); __dbg.orbit.target.copy(__dbg.orbit.tTarget); __dbg.orbit.tDist = 60; __dbg.orbit.tPhi = 1.0; __dbg.orbit.tTheta = 0.4;", settle_orbit=True)
    assert v3['vis'] >= v3['total'] - 2, ('S8: 夜间视角对象不可辨', v3)
    stN = pg.evaluate("__dbg.narrative.state()")
    assert stN['enabled'] and stN['groupVisible'], ('S8: 夜间叙事应可见', stN)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)
    print('S8 多视角 OK: 基地方向/FPV/夜间对象均可辨、chip 保持')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')