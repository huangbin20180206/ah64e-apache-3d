# -*- coding: utf-8 -*-
# Phase 21：敌方基地设施可摧毁 + 雷达 SEAD 压制——值级浏览器断言（playwright）
# 全部 __dbg 数值断言、条件等待无固定墙钟。覆盖接线链：打击层 hitTest/摧毁/
# killEvent 消费计分 + sead 成就 / 雷达毁停转 / SEAD 闭环（雷达毁→samwar 回 idle）/
# 弹药库殉爆标记 / resetRange 复位 / 难度抗打击。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rig && __dbg.narrative && __dbg.samwar && __dbg.arcade && __dbg.resetRange)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)
    # 切沙漠（靶场启用 → narrative.syncEnabled 打开打击层）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_function("() => __dbg.targets.enabled && __dbg.narrative.state().enabled", timeout=5000)

    # ---- N1: 初始态——三设施 alive、hp=hp0、radarAlive=true ----
    n1 = pg.evaluate("__dbg.narrative.state()")
    print('N1 初始:', n1['strikes'], 'radarAlive=', n1['radarAlive'])
    keys = sorted(s['key'] for s in n1['strikes'])
    assert keys == ['ammo', 'radar', 'sam'], ('N1: 打击层应含 radar/sam/ammo 三设施', n1['strikes'])
    assert all(s['alive'] for s in n1['strikes']), ('N1: 初始三设施应全部存活', n1['strikes'])
    hp0 = {s['key']: s['hp'] for s in n1['strikes']}
    assert hp0['radar'] == 2 and hp0['sam'] == 3 and hp0['ammo'] == 1, ('N1: 初始 hp 应为 radar2/sam3/ammo1', hp0)
    assert n1['radarAlive'] is True, ('N1: 初始雷达应存活', n1)
    print('N1 PASS: 三设施 alive + hp=hp0 + radarAlive')

    # ---- N2: 命中未毁——防空车 hp3 打 1 发 → hp 降、仍存活、无 killEvent ----
    # 防空车世界坐标 (12, 0, 69)；standard 抗打击 res=1.0，机炮威力 1 → 扣 1
    hit_sam = "__dbg.narrative.hitTest({ x: 12, y: 0.8, z: 69 }, 1)"
    ok = pg.evaluate("(() => !!%s)()" % hit_sam)
    assert ok, ('N2: 应命中防空车（radius 2.0 覆盖）',)
    n2 = pg.evaluate("__dbg.narrative.state()")
    sam2 = next(s for s in n2['strikes'] if s['key'] == 'sam')
    assert abs(sam2['hp'] - 2) < 1e-6 and sam2['alive'], ('N2: 防空车受击后 hp 3→2 且存活', sam2)
    assert n2['killEvent'] is False, ('N2: 未摧毁不应产 killEvent', n2)
    print('N2 PASS: 防空车 hp 3→2、存活、无 killEvent')

    # ---- N5+N3+N6: SEAD 闭环 + 雷达摧毁计分 + sead 成就（任务局） ----
    # 起任务局 → 玩家悬停反击区（z=33，距基地 BASE_C 42u）→ samwar 建锁交战（radar 存活）→
    # 摧毁雷达 → siteN 门断 → samwar 回落 idle；同时 70-app 消费 killEvent 计分 + sead。
    pg.evaluate("(() => { __dbg.S.mode = 'mission'; __dbg.startMission('standard'); })()")
    pg.wait_for_function("() => __dbg.narrative.state().enabled && __dbg.narrative.state().radarAlive", timeout=5000)
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=33;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; F.fp=false; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    pg.evaluate("(() => { const m=__dbg.S._mission; m.phase='active'; if(m.t0==null) m.t0=__dbg.S.time; __dbg.beginMission(); })()")
    # 雷达存活时 samwar 应进入交战（track/lock/launch）——SEAD 前置：防空活跃
    pg.wait_for_function("() => __dbg.samwar.state().phase !== 'idle'", timeout=30000)
    engaged = pg.evaluate("__dbg.samwar.state().phase")
    print('N5 雷达存活 samwar 交战相位:', engaged)
    assert engaged in ('track', 'lock', 'launch'), ('N5: 雷达存活时 samwar 应交战', engaged)

    s0 = pg.evaluate("(() => ({ score: __dbg.arcade.state().score, sead: __dbg.arcade.state().unlocked.includes('sead') }))()")
    assert s0['sead'] is False, ('N3: 摧毁前 sead 未解锁', s0)
    # 摧毁雷达：雷达世界坐标 (-16, 0, 79)，hp2，机炮 2 发（standard res=1）
    pg.evaluate("""(() => {
      __dbg.narrative.hitTest({ x: -16, y: 0.8, z: 79 }, 1);
      __dbg.narrative.hitTest({ x: -16, y: 0.8, z: 79 }, 1);
    })()""")
    # killEvent 由 70-app loop 消费 → onKill('radar')；等计分入账 + radarAlive 翻转
    pg.wait_for_function("() => __dbg.narrative.state().radarAlive === false", timeout=5000)
    pg.wait_for_function("() => __dbg.arcade.state().unlocked.includes('sead')", timeout=5000)
    n3 = pg.evaluate("(() => ({ score: __dbg.arcade.state().score, sead: __dbg.arcade.state().unlocked.includes('sead'),"
                     " radarAlive: __dbg.narrative.state().radarAlive,"
                     " radarDead: !__dbg.narrative.state().strikes.find(s => s.key==='radar').alive }))()")
    assert n3['radarAlive'] is False and n3['radarDead'], ('N3: 雷达应已摧毁', n3)
    assert n3['sead'] is True, ('N6: sead 成就应解锁', n3)
    # radar 基础分 200 × standard 1.0 × 连击（首杀 combo=1 → ×1）= 200
    assert n3['score'] - s0['score'] >= 200, ('N3: 摧毁雷达应计分 ≥200', (s0, n3))
    print('N3+N6 PASS: 雷达摧毁 → 计分 +%d + sead 成就' % (n3['score'] - s0['score']))
    # 雷达毁后停转（radarR 不再推进）——毁后取冻结基准，再等一段确认不变
    radarRDead = pg.evaluate("__dbg.narrative.state().radarR")
    pg.wait_for_timeout(600)
    radarR1 = pg.evaluate("__dbg.narrative.state().radarR")
    assert abs(radarR1 - radarRDead) < 1e-6, ('N3: 雷达毁后雷达盘应停转', radarRDead, radarR1)
    print('N3 PASS: 雷达盘停转（radarR 冻结）')
    # SEAD 闭环：雷达毁 → siteN 门断 → samwar 回落 idle（导弹在飞则待其自毁后归 idle）
    pg.wait_for_function("() => __dbg.samwar.state().phase === 'idle'", timeout=25000)
    print('N5 PASS: SEAD 闭环——雷达毁 → samwar 回落 idle')

    # ---- N9: SEAD 可读性——雷达毁后 RWR HUD 显"压制"（区别于"安全"） ----
    # samwar idle + 雷达已毁 → HUD 节流块（0.5s）应把 hud-rwr 写为"压制"
    pg.wait_for_function("""() => {
      const el = document.getElementById('hud-rwr');
      return el && el.textContent === '压制';
    }""", timeout=5000)
    print('N9 PASS: 雷达毁后 RWR HUD 显“压制”')

    # ---- N4: 弹药库殉爆——hp1 一发毁 + 二次爆炸标记（_ammoBoom） ----
    # 弹药库世界坐标 (-11, 0, 73)，hp1，机炮 1 发即毁。原子读 _ammoBoom：与
    # hitTest 同一 evaluate（_destroy 同步置标记），零帧间隔避免 0.5s 殉爆倒计时跑完
    n4 = pg.evaluate("""(() => {
      __dbg.narrative.hitTest({ x: -11, y: 0.8, z: 73 }, 1);
      return { ammoDead: !__dbg.narrative.state().strikes.find(s => s.key==='ammo').alive,
               boom: __dbg.narrative._ammoBoom != null };
    })()""")
    assert n4['ammoDead'], ('N4: 弹药库 hp1 应一发摧毁', n4)
    assert n4['boom'], ('N4: 弹药库摧毁应置延迟殉爆标记 _ammoBoom', n4)
    print('N4 PASS: 弹药库一发毁 + 殉爆标记')

    # ---- N7: resetRange 复位——三设施 hp/alive 复原、radarAlive=true、雷达复转 ----
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => __dbg.narrative.state().radarAlive === true", timeout=5000)
    n7 = pg.evaluate("__dbg.narrative.state()")
    print('N7 resetRange 后:', n7['strikes'], 'enabled=', n7['enabled'])
    assert all(s['alive'] for s in n7['strikes']), ('N7: resetRange 后三设施应复活', n7['strikes'])
    hp7 = {s['key']: s['hp'] for s in n7['strikes']}
    assert hp7['radar'] == 2 and hp7['sam'] == 3 and hp7['ammo'] == 1, ('N7: resetRange 后 hp 应复原', hp7)
    # 雷达停转标记复位 → 复转（等一帧后 radarR 推进）
    rr0 = pg.evaluate("__dbg.narrative.state().radarR")
    pg.wait_for_function("(base) => __dbg.narrative.state().radarR !== base", arg=rr0, timeout=5000)
    print('N7 PASS: resetRange 复位 hp/alive/radarAlive + 雷达复转')

    # ---- N8: 难度抗打击——veteran res=1.4，扣减 = power/res ----
    # 直接设本局快照难度（targetResMul 读 S._mission.difficulty）；hitTest 前
    # 记 hp0，打 1 发威力 1 → 扣减应为 1/1.4≈0.714
    pg.evaluate("(() => { __dbg.S.mode='mission'; __dbg.startMission('standard'); __dbg.S._mission.difficulty='veteran'; })()")
    pg.wait_for_function("() => __dbg.narrative.state().enabled", timeout=5000)
    hpb = pg.evaluate("__dbg.narrative.state().strikes.find(s => s.key==='sam').hp")
    pg.evaluate("__dbg.narrative.hitTest({ x: 12, y: 0.8, z: 69 }, 1)")
    hpa = pg.evaluate("__dbg.narrative.state().strikes.find(s => s.key==='sam').hp")
    ded = hpb - hpa
    print('N8 veteran 扣减:', round(ded, 4), '(期望≈%.4f)' % (1 / 1.4))
    assert abs(ded - 1 / 1.4) < 0.02, ('N8: veteran res=1.4 下扣减应为 power/res≈0.714', hpb, hpa, ded)
    print('N8 PASS: 难度抗打击 power/res 生效')

    # ---- N10 (Phase 21.1)：摧毁残骸——焦黑箱体+烧蚀地贴生成、挂 this.group、余烬计时 ----
    # （N9=Phase 22 RWR「压制」；残骸块顺延 N10 起，避免与 N9 撞号）
    # N8 留下 veteran 半毁状态，且 resetRange 会置空 S._mission——按 N8 同款入口
    # startMission('standard') 重建任务局（difficulty 默认 standard，扣减可预期）
    pg.evaluate("(() => { __dbg.S.mode = 'mission'; __dbg.startMission('standard'); })()")
    pg.wait_for_function("() => __dbg.narrative.state().enabled && __dbg.narrative.state().radarAlive === true", timeout=5000)
    kids0 = pg.evaluate("__dbg.narrative.group.children.length")
    # 摧毁 + 遥测读取合入同一 evaluate（N4 原子读模式）：burn/kids 与 hitTest 零帧
    # 间隔——杜绝"两次 evaluate 之间往返延迟把 burn 拉低/拉空"的读时序脆弱
    # （实测：读间隙偶发 ~7s 时 burn 已自然衰减为 0，wreck 仍在——非产品缺陷）
    w9 = pg.evaluate("""(() => {
      const N = __dbg.narrative;
      for (let i = 0; i < 2; i++) N.hitTest({ x: -16, y: 0.8, z: 79 }, 1);
      for (let i = 0; i < 3; i++) N.hitTest({ x: 12, y: 0.8, z: 69 }, 1);
      N.hitTest({ x: -11, y: 0.8, z: 73 }, 1);
      return { st: N.state().wrecks, kids: N.group.children.length };
    })()""")
    print('N10 摧毁后残骸遥测:', w9['st'], 'group kids:', kids0, '->', w9['kids'])
    assert all(x['wreck'] for x in w9['st']), ('N10: 三设施应各生成残骸', w9)
    assert all(x['burn'] > 5 for x in w9['st']), ('N10: 残骸应带 ~7s 余烬计时', w9)
    assert w9['kids'] - kids0 == 3, ('N10: 三个残骸组应挂 this.group（随 syncEnabled 显隐）', (kids0, w9))
    det9 = pg.evaluate("""(() => {
      const out = { boxes: 0, shadowed: 0, scorch: 0, flat: 0 };
      __dbg.narrative.group.traverse(o => {
        if (!o.isMesh || !o.parent || o.parent.name.indexOf('narrative-wreck-') !== 0) return;
        if (o.geometry.type === 'BoxGeometry') { out.boxes++; if (o.castShadow) out.shadowed++; }
        if (o.geometry.type === 'CircleGeometry') {
          out.scorch++;
          if (o.rotation.x === -Math.PI / 2 && o.position.y === 0.012 && o.material.depthWrite === false) out.flat++;
        }
      });
      return out;
    })()""")
    print('N10 残骸结构:', det9)
    assert det9['boxes'] == 10 and det9['shadowed'] == 0, ('N10: 箱体应 3+4+3=10 且全部 castShadow=false（C3 纪律）', det9)
    assert det9['scorch'] == 3 and det9['flat'] == 3, ('N10: 三块烧蚀地贴应平铺（-PI/2, y=0.012, depthWrite=false）', det9)
    # 余烬计时由 update 每帧递减 → 条件等待自然平息（无固定墙钟）
    pg.wait_for_function("() => __dbg.narrative.state().wrecks.every(w => w.burn <= 0)", timeout=30000)
    print('N10 PASS: 残骸生成+结构合规+余烬自然平息')

    # ---- N11a (Phase 21.1)：resetStrikes 清理——残骸移除/释放/设施复原、几何零净增 ----
    # 泄漏守卫用 narr.resetStrikes() 紧窗口（同一次 evaluate 内无 rAF 插入，几何
    # 计数只可能因 dispose 下降，不会混入其它系统重生的噪声）
    clean = pg.evaluate("""(() => {
      const g0 = __dbg.renderer.info.memory.geometries;
      __dbg.narrative.resetStrikes();
      const g1 = __dbg.renderer.info.memory.geometries;
      const n = __dbg.narrative;
      let left = 0;
      n.group.traverse(o => { if (o.name.indexOf('narrative-wreck-') === 0) left++; });
      return { g0, g1, left, kids: n.group.children.length, st: n.state().wrecks,
               vis: ['narrative-radar', 'narrative-sam', 'narrative-ammo']
                    .map(k => n.group.getObjectByName(k).visible) };
    })()""")
    print('N11a 清理后:', clean['st'], 'left=', clean['left'], 'kids=', clean['kids'],
          'geos', clean['g0'], '->', clean['g1'], 'vis=', clean['vis'])
    assert clean['left'] == 0, ('N11a: 场景图不得残留残骸组', clean)
    assert all((not x['wreck']) and x['burn'] == 0 for x in clean['st']), ('N11a: 残骸引用应清零', clean)
    assert clean['kids'] == kids0, ('N11a: group 子数应复原（残骸组全移除）', (kids0, clean))
    assert all(clean['vis']), ('N11a: 复位后三设施组应恢复可见', clean)
    assert clean['g1'] <= clean['g0'], ('N11a: 同步清理窗口内几何数不得净增（泄漏守卫）', clean)
    print('N11a PASS: resetStrikes 残骸零残留+设施复原+几何零净增')

    # ---- N11b (Phase 21.1)：真实入口回归——resetRange（走 72-uibind 全链）也清残骸 ----
    # 前置只需"残骸存在"（burn 生效性已由 N9 原子读覆盖）；同样单 evaluate 原子读
    b = pg.evaluate("""(() => {
      __dbg.narrative.hitTest({ x: -11, y: 0.8, z: 73 }, 1);
      return __dbg.narrative.state().wrecks.find(w => w.key === 'ammo');
    })()""")
    assert b['wreck'], ('N11b: 二次摧毁弹药库应再生成残骸', b)
    rb = pg.evaluate("""(() => {
      __dbg.resetRange();
      const n = __dbg.narrative;
      let left = 0;
      n.group.traverse(o => { if (o.name.indexOf('narrative-wreck-') === 0) left++; });
      return { left, st: n.state().wrecks, vis: n.group.getObjectByName('narrative-ammo').visible };
    })()""")
    assert rb['left'] == 0 and all(not x['wreck'] for x in rb['st']), ('N11b: resetRange 后残骸应清零', rb)
    assert rb['vis'] is True, ('N11b: resetRange 后弹药库组应恢复可见', rb)
    print('N11b PASS: resetRange 全链清残骸')

    # ---- N12 (Phase 21.2)：摧毁冲击波环——生成结构合规 + ~0.5s 自动消退（移除+dispose） ----
    # dispose 证明用事件监听直证（three EventDispatcher 语义）：摧毁同帧给环的
    # geometry/material 挂 'dispose' 监听，update 到期自动清理时监听必触发——与
    # 渲染时序、其它系统的瞬态几何（弹药库殉爆 0.5s 二次爆的分批破片入账等）完全
    # 解耦。探针实证：跨帧几何计数差值断言会被二次爆炸噪声淹没，不可用。
    w12a = pg.evaluate("""(() => {
      __dbg.narrative.hitTest({ x: -11, y: 0.8, z: 73 }, 1);
      const n = __dbg.narrative;
      let wave = null;
      n.group.traverse(o => { if (o.name.indexOf('narrative-wave-') === 0) wave = o; });
      window.__wGeoGone = false; window.__wMatGone = false;
      if (wave) {
        wave.geometry.addEventListener('dispose', () => { window.__wGeoGone = true; });
        wave.material.addEventListener('dispose', () => { window.__wMatGone = true; });
      }
      return { waves: n.state().waves, waveName: wave ? wave.name : null,
               parent: wave ? wave.parent.name : null,
               flat: wave ? (wave.rotation.x === -Math.PI / 2 && wave.position.y === 0.05 &&
                             wave.material.depthWrite === false && wave.material.transparent === true) : false,
               geo: wave ? wave.geometry.type : null };
    })()""")
    print('N12 冲击波生成:', w12a)
    assert w12a['waves'] == 1 and w12a['waveName'] == 'narrative-wave-ammo', ('N12: 摧毁应在设施地面生成 1 个冲击波环', w12a)
    assert w12a['parent'] == 'narrative-wreck-ammo', ('N12: 环应挂残骸组内（随残骸显隐/清理）', w12a)
    assert w12a['flat'] and w12a['geo'] == 'RingGeometry', ('N12: 环应平铺地面（-PI/2, y=0.05, depthWrite=false, RingGeometry）', w12a)
    # ~0.5s 后环自动消退（update 推进移除+dispose）——条件等待，超时给足余量
    pg.wait_for_function("() => __dbg.narrative.state().waves === 0", timeout=8000)
    w12b = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      let left = 0;
      n.group.traverse(o => { if (o.name.indexOf('narrative-wave-') === 0) left++; });
      return { left, geoGone: window.__wGeoGone, matGone: window.__wMatGone };
    })()""")
    print('N12 消退后:', w12b)
    assert w12b['left'] == 0, ('N12: 环消退后场景图不得残留 narrative-wave 节点', w12b)
    assert w12b['geoGone'] is True and w12b['matGone'] is True, ('N12: 环到期应自动移除并 dispose 几何+材质', w12b)
    print('N12 PASS: 冲击波环生成→~0.5s 自动消退（移除+dispose 事件直证）')
    # 尾部复位：清掉 N12 的弹药库残骸，给 N13/N14 让出干净工作区
    pg.evaluate("__dbg.resetRange()")

    # ---- N13 (Phase 21.2)：命中脉冲——受击组下压回弹 + 命中点火花（puff 池复用） ----
    # 打防空车 1 发（hp3→2 未摧毁）→ 原子读：脉冲计时器置位 + puff 池可见数 +1
    # （火花同步发射；同 evaluate 零帧间隔）；随后条件等待脉冲走完 scale 精确归位
    w13 = pg.evaluate("""(() => {
      const rig = window.__rigFx;
      const before = rig && rig.puffs ? rig.puffs.filter(p => p.m.visible).length : -1;
      __dbg.narrative.hitTest({ x: 12, y: 0.8, z: 69 }, 1);
      const n = __dbg.narrative;
      const fx = n.state().fx.find(f => f.key === 'sam');
      const hp = n.state().strikes.find(s => s.key === 'sam').hp;
      const after = rig && rig.puffs ? rig.puffs.filter(p => p.m.visible).length : -1;
      return { punch: fx.punch, hp, before, after };
    })()""")
    print('N13 命中读数:', w13)
    assert abs(w13['hp'] - 2) < 1e-6, ('N13: 防空车应受击未毁（hp 3→2）', w13)
    assert w13['punch'] > 0, ('N13: 命中应置受击脉冲计时器（0.12s）', w13)
    if w13['before'] >= 0:
        assert w13['after'] > w13['before'], ('N13: 命中点火花应复用 puff 池发射（可见数 +1）', w13)
    # 脉冲由 update 推进——先证下压（scale.y<0.999，rAF 轮询抓 0.12s 窗口），再证回位
    pg.wait_for_function("() => __dbg.narrative.group.getObjectByName('narrative-sam').scale.y < 0.999", timeout=3000)
    pg.wait_for_function("""() => {
      const n = __dbg.narrative;
      const fx = n.state().fx.find(f => f.key === 'sam');
      const g = n.group.getObjectByName('narrative-sam');
      return fx.punch === 0 && g.scale.x === 1 && g.scale.y === 1 && g.scale.z === 1;
    }""", timeout=5000)
    print('N13 PASS: 命中脉冲下压→回弹→精确归位 + 命中点火花（puff 池零新增 draw）')

    # ---- N14 (Phase 21.2)：夜间残骸辉光——白天不挂 / 夜间挂 additive Sprite / 复位清理 ----
    # 前置：清干净（N13 留下 sam hp2）
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("() => __dbg.narrative.state().radarAlive === true", timeout=5000)
    # ① 白天（本测试此前未切环境，S.env 引导默认 'day'）：摧毁弹药库 → 残骸在烧
    # 但辉光不得挂载。用 radarR 推进证 update 确实跑过多帧（排除"没来得及挂"假阴性）
    d14 = pg.evaluate("""(() => {
      __dbg.narrative.hitTest({ x: -11, y: 0.8, z: 73 }, 1);
      const n = __dbg.narrative;
      return { env: __dbg.S.env, burn: n.state().wrecks.find(w => w.key === 'ammo').burn };
    })()""")
    assert d14['env'] == 'day', ('N14: 前置应为白天环境（本测试此前未切环境）', d14)
    assert d14['burn'] > 5, ('N14: 弹药库残骸应在燃烧（burn>5）', d14)
    rr14 = pg.evaluate("__dbg.narrative.state().radarR")
    pg.wait_for_function("(b) => __dbg.narrative.state().radarR !== b", arg=rr14, timeout=5000)
    day14 = pg.evaluate("(() => __dbg.narrative.state().fx.find(f => f.key === 'ammo').glow)()")
    assert day14 is False, ('N14: 白天不得挂夜间辉光（update 已跑多帧）', day14)
    print('N14 白天不挂 OK: burn>0 且 update 推进下 glow=false')
    # ② 切夜间 → update 应挂 additive Sprite 假辉光
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.wait_for_function("() => __dbg.narrative.state().fx.find(f => f.key === 'ammo').glow === true", timeout=8000)
    g14 = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      let sp = null, lights = 0, glowCount = 0;
      n.group.traverse(o => {
        if (o.isLight) lights++;
        if (o.name.indexOf('narrative-glow-') === 0) { glowCount++; sp = o; }
      });
      return { glowCount, lights, isSprite: sp ? !!sp.isSprite : false,
               parent: sp ? sp.parent.name : null,
               blending: sp ? sp.material.blending : null,
               depthWrite: sp ? sp.material.depthWrite : null,
               opacity: sp ? sp.material.opacity : null };
    })()""")
    print('N14 夜间辉光结构:', g14)
    assert g14['glowCount'] == 1 and g14['isSprite'], ('N14: 夜间应挂 1 个 Sprite 辉光', g14)
    assert g14['parent'] == 'narrative-wreck-ammo', ('N14: 辉光应挂残骸组内（随组显隐/清理）', g14)
    assert g14['blending'] == 2 and g14['depthWrite'] is False, ('N14: 辉光应为 additive 混合 + depthWrite=false（假辉光）', g14)
    assert g14['lights'] == 0, ('N14: 禁真光源——叙事组内不得出现任何 Light（A2 预算红线）', g14)
    # ③ 辉光应随余烬闪烁——双频正弦（主频周期 ~0.57s）内亮度必然变化
    o14 = pg.evaluate("() => __dbg.narrative.group.getObjectByName('narrative-glow-ammo').material.opacity")
    pg.wait_for_function("(b) => Math.abs(__dbg.narrative.group.getObjectByName('narrative-glow-ammo').material.opacity - b) > 0.01", arg=o14, timeout=5000)
    # ④ resetRange 复位清理——辉光/残骸/冲击波零残留、引用全清零（含 fx.glow）
    c14 = pg.evaluate("""(() => {
      __dbg.resetRange();
      const n = __dbg.narrative;
      let glow = 0, wreck = 0, wave = 0;
      n.group.traverse(o => {
        if (o.name.indexOf('narrative-glow-') === 0) glow++;
        if (o.name.indexOf('narrative-wreck-') === 0) wreck++;
        if (o.name.indexOf('narrative-wave-') === 0) wave++;
      });
      return { glow, wreck, wave, fx: n.state().fx, st: n.state().wrecks };
    })()""")
    print('N14 复位清理:', c14)
    assert c14['glow'] == 0 and c14['wave'] == 0 and c14['wreck'] == 0, ('N14: 复位后辉光/冲击波/残骸零残留', c14)
    assert all(not x['glow'] for x in c14['fx']), ('N14: 复位后辉光引用应清零', c14)
    assert all(not x['wreck'] for x in c14['st']), ('N14: 复位后残骸引用应清零', c14)
    # ⑤ 环境还原白天（尾帧截图与历史证据一致——测试全程未动相机）
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)
    print('N14 PASS: 夜间辉光挂载/闪烁/复位零残留 + 白天不挂')

    # ---- N15 (Phase 25)：雷达扫描波束——随盘转 / 夜亮昼淡 / 摧毁哑火 / 复位复活 ----
    # ① 结构：挂 radarDish 子节点（随盘同转、摧毁随组哑火的结构保证）+ 加性半透
    b15 = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      const beam = n.group.getObjectByName('narrative-beam');
      return { found: !!beam, parent: beam ? beam.parent.name : null,
               geo: beam ? beam.geometry.type : null,
               blending: beam ? beam.material.blending : null,
               depthWrite: beam ? beam.material.depthWrite : null,
               st: n.state().radarBeam };
    })()""")
    print('N15 波束结构:', b15)
    assert b15['found'] and b15['parent'] == 'narrative-radar-dish', ('N15: 波束应挂 radarDish 子节点（随盘同转、摧毁随组哑火）', b15)
    assert b15['geo'] == 'CircleGeometry' and b15['blending'] == 2 and b15['depthWrite'] is False, ('N15: 波束应为加性半透扇形（depthWrite:false）', b15)
    assert b15['st'] and b15['st']['on'] is True, ('N15: 雷达存活时波束遥测应可见', b15)
    # ② 随盘转：波束世界朝向（matrixWorld 第三列 = 局部 +Z 的世界向量，取 x/z 分量）
    #    随 radarR 推进 ~0.08rad 而变（等待量给足：0.058rad/s 下 ~1.4s，向量变幅 ~0.03）
    az0 = pg.evaluate("(() => { const e = __dbg.narrative.group.getObjectByName('narrative-beam').matrixWorld.elements; return [e[8], e[10]]; })()")
    r15 = pg.evaluate("__dbg.narrative.state().radarR")
    pg.wait_for_function("(b) => Math.abs(__dbg.narrative.state().radarR - b) > 0.08", arg=r15, timeout=10000)
    az1 = pg.evaluate("(() => { const e = __dbg.narrative.group.getObjectByName('narrative-beam').matrixWorld.elements; return [e[8], e[10]]; })()")
    assert abs(az1[0] - az0[0]) + abs(az1[1] - az0[1]) > 0.01, ('N15: 波束应随雷达盘旋转（世界朝向未变）', (az0, az1))
    print('N15 波束随盘旋转 OK')
    # ③ 夜亮昼淡：夜间 opacity 显著高于白天（update 按 env 逐帧驱动）
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.wait_for_function("() => __dbg.narrative.state().radarBeam.op > 0.25", timeout=8000)
    opN = pg.evaluate("__dbg.narrative.state().radarBeam.op")
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_function("() => __dbg.narrative.state().radarBeam.op < 0.15", timeout=8000)
    opD = pg.evaluate("__dbg.narrative.state().radarBeam.op")
    assert opN > opD + 0.1, ('N15: 波束应夜间更亮、白天压淡', (opN, opD))
    print('N15 夜亮昼淡 OK: night=%.3f day=%.3f' % (opN, opD))
    # ④ 摧毁雷达（hp2 两发）→ 波束随组哑火（有效可见性 false——隐藏非删除）；
    #    雷达信标同帧随组熄灭（信标熄灭语义在 N16 结构断言中完整覆盖，此处顺带读回）
    pg.evaluate("""(() => { __dbg.narrative.hitTest({ x: -16, y: 0.8, z: 79 }, 1);
      __dbg.narrative.hitTest({ x: -16, y: 0.8, z: 79 }, 1); })()""")
    pg.wait_for_function("() => __dbg.narrative.state().radarBeam.on === false", timeout=5000)
    d15 = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      const beam = n.group.getObjectByName('narrative-beam');
      return { parent: beam.parent.name, bc: n.state().beacons.find(b => b.key === 'radar') };
    })()""")
    assert d15['parent'] == 'narrative-radar-dish', ('N15: 波束结构应在（随组隐藏而非删除）', d15)
    assert d15['bc']['on'] is False, ('N15: 雷达信标应随组熄灭', d15)
    print('N15 摧毁哑火 OK: 波束 on=false + 结构仍在 + 信标同熄')
    # ⑤ 复位复活：resetRange → 波束/信标/设施全部回位
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("""() => __dbg.narrative.state().radarBeam.on === true
      && __dbg.narrative.state().beacons.every(b => b.on)""", timeout=5000)
    print('N15 PASS: 波束挂盘同转/夜亮昼淡/摧毁哑火/复位复活')

    # ---- N16 (Phase 25)：设施信标灯——挂载 / 呼吸 / 摧毁隐藏 / 复位复活 ----
    # ① 结构：radar/sam 各一枚 additive Sprite、挂对应设施组内、有效可见
    #    （有效可见性沿祖先链求积——组隐藏即熄，与 _beamOn 同法）
    g16 = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      const chk = [];
      for (const nm of ['narrative-beacon-radar', 'narrative-beacon-sam']) {
        const sp = n.group.getObjectByName(nm);
        let v = !!sp, p = sp;
        while (p) { v = v && p.visible; p = p.parent; }
        chk.push({ nm, isSprite: sp ? !!sp.isSprite : false, parent: sp ? sp.parent.name : null,
                   blending: sp ? sp.material.blending : null, visible: v });
      }
      return { list: n.state().beacons, chk };
    })()""")
    print('N16 信标结构:', g16)
    bl16 = {x['key']: x for x in g16['list']}
    assert len(g16['list']) == 2 and bl16['radar']['on'] and bl16['sam']['on'], ('N16: 应有 radar/sam 两枚存活信标', g16)
    for c16i in g16['chk']:
        assert c16i['isSprite'] and c16i['parent'] in ('narrative-radar', 'narrative-sam'), ('N16: 信标应挂对应设施组内', g16)
        assert c16i['blending'] == 2 and c16i['visible'], ('N16: 信标应为 additive 且有效可见', g16)
    # ② 低频呼吸：radar 信标 opacity 采样窗内必然变化（2.6s 周期、振幅 0.9）
    o16 = pg.evaluate("() => __dbg.narrative.group.getObjectByName('narrative-beacon-radar').material.opacity")
    pg.wait_for_function("(b) => Math.abs(__dbg.narrative.group.getObjectByName('narrative-beacon-radar').material.opacity - b) > 0.05", arg=o16, timeout=6000)
    print('N16 信标呼吸 OK')
    # ③ 摧毁防空车（hp3 三发）→ sam 信标随组熄（on=false + 祖先链有效可见性 false）
    pg.evaluate("(() => { for (let i = 0; i < 3; i++) __dbg.narrative.hitTest({ x: 12, y: 0.8, z: 69 }, 1); })()")
    pg.wait_for_function("() => __dbg.narrative.state().beacons.find(b => b.key === 'sam').on === false", timeout=5000)
    d16 = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      const sp = n.group.getObjectByName('narrative-beacon-sam');
      let v = true, p = sp;
      while (p) { v = v && p.visible; p = p.parent; }
      return { parent: sp.parent.name, visible: v };
    })()""")
    assert d16['parent'] == 'narrative-sam' and d16['visible'] is False, ('N16: 防空车信标应随组隐藏（结构在、不可见）', d16)
    print('N16 摧毁隐藏 OK: sam 信标 on=false + 有效可见性 false')
    # ④ 复位复活：resetRange → 双信标 on、波束 on、设施 alive（常驻件零残留语义）
    c16 = pg.evaluate("""(() => {
      __dbg.resetRange();
      const n = __dbg.narrative;
      return { bc: n.state().beacons, beam: n.state().radarBeam,
               alive: n.state().strikes.every(s => s.alive) };
    })()""")
    assert all(x['on'] for x in c16['bc']) and c16['beam']['on'] and c16['alive'], ('N16: 复位后信标/波束/设施应全部复活', c16)
    print('N16 PASS: 信标挂载/呼吸/摧毁隐藏/复位复活')

    # ---- N17 (Phase 28)：渐进损伤——置态 / 浓度随 hp / 微倾 / 复位清零 / 残骸链共存 ----
    # 损伤态为 update 纯派生（hp 函数）：遥测 hurt/d 与 hitTest 同步可原子读；
    # 软烟可见性/姿态微倾在下一帧 update 落地——用条件等待等 visible 翻转再读值。
    # 烟浓包络：opacity=(0.16+0.4·d)·br，br∈[0.5,1.0]——按 d 验证值域而非跨采样
    # 比较（呼吸调制使相邻采样不可比，包络检查才确定）
    # ① 基线：全完好 hurt=false/d=0；软烟件存在但不可见（零 draw 态）；姿态归零
    a17 = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      const out = { dmg: n.state().damaged, smokes: {}, dishZ: null, tubes: [] };
      for (const k of ['radar', 'sam']) {
        const sp = n.group.getObjectByName('narrative-dmgsmoke-' + k);
        out.smokes[k] = { found: !!sp, visible: sp ? sp.visible : null,
                          parent: sp ? sp.parent.name : null,
                          blending: sp ? sp.material.blending : null };
      }
      out.dishZ = n.group.getObjectByName('narrative-radar-dish').rotation.z;
      n.group.traverse(o => { if (o.name.indexOf('narrative-sam-tube-') === 0)
        out.tubes.push({ bx: o.userData._bx, dp: o.userData._dp, rx: o.rotation.x }); });
      return out;
    })()""")
    print('N17 基线:', a17['dmg'], 'tubes=', len(a17['tubes']))
    assert all((not x['hurt']) and x['d'] == 0 for x in a17['dmg']), ('N17: 初始应无损伤态', a17)
    for k in ('radar', 'sam'):
        assert a17['smokes'][k]['found'] and a17['smokes'][k]['parent'] == 'narrative-' + k, ('N17: 损伤烟应挂设施组内', a17)
        assert a17['smokes'][k]['visible'] is False, ('N17: 完好时损伤烟不得显示（零 draw）', a17)
        assert a17['smokes'][k]['blending'] == 1, ('N17: 暗灰烟应走普通混合（NormalBlending）', a17)
    assert abs(a17['dishZ']) < 1e-6, ('N17: 完好时雷达盘不应侧倾', a17)
    assert len(a17['tubes']) == 4, ('N17: 应有 4 根发射架引用', a17)
    for t in a17['tubes']:
        assert abs(t['rx'] - t['bx']) < 1e-6 and abs(t['bx'] + 0.35) < 1e-6, ('N17: 发射架姿态应=基线 -0.35', a17)
    # ② 打防空车 1 发（hp3→2，d=1/3）：hurt 置位、d 精确、软烟点亮在 d=1/3 包络、
    #    发射架按公式下垂；雷达/弹药堆不受波及（遥测原子读）
    h17 = pg.evaluate("""(() => {
      __dbg.narrative.hitTest({ x: 12, y: 0.8, z: 69 }, 1);
      return __dbg.narrative.state().damaged;
    })()""")
    dm17 = {x['key']: x for x in h17}
    assert dm17['sam']['hurt'] and abs(dm17['sam']['d'] - 1 / 3) < 1e-3, ('N17: 防空车应置损伤态 d≈0.333', h17)
    assert (not dm17['radar']['hurt']) and (not dm17['ammo']['hurt']), ('N17: 未受击设施不得置损伤态', h17)
    pg.wait_for_function("() => __dbg.narrative.group.getObjectByName('narrative-dmgsmoke-sam').visible === true", timeout=5000)
    v17 = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      const sp = n.group.getObjectByName('narrative-dmgsmoke-sam');
      const tubes = [];
      n.group.traverse(o => { if (o.name.indexOf('narrative-sam-tube-') === 0)
        tubes.push({ dp: o.userData._dp, rx: o.rotation.x }); });
      return { op: sp.material.opacity, tubes,
               dishZ: n.group.getObjectByName('narrative-radar-dish').rotation.z };
    })()""")
    assert 0.13 <= v17['op'] <= 0.31, ('N17: d=1/3 烟浓应在包络 [(0.16+0.4/3)·0.5, (0.16+0.4/3)·1.0]', v17)
    for t in v17['tubes']:
        assert abs(t['rx'] - (-0.35 + (1 / 3) * 0.55 * t['dp'])) < 1e-3 and t['rx'] > -0.35, ('N17: 发射架应按公式下垂', v17)
    assert abs(v17['dishZ']) < 1e-6, ('N17: 雷达未受击不应侧倾', v17)
    print('N17 置态 OK: d=1/3 烟亮 + 发射架下垂（公式精确复算）')
    # ③ 再打 1 发（hp2→1，d=2/3）：受创程度抬升（d 单调升 + 包络右移 + 下垂加深）；
    #    再打雷达 1 发（hp2→1，d=0.5）：盘侧倾精确 0.09 + 雷达软烟亮
    h17b = pg.evaluate("""(() => {
      __dbg.narrative.hitTest({ x: 12, y: 0.8, z: 69 }, 1);
      __dbg.narrative.hitTest({ x: -16, y: 0.8, z: 79 }, 1);
      return __dbg.narrative.state().damaged;
    })()""")
    dm17b = {x['key']: x for x in h17b}
    assert dm17b['sam']['hurt'] and abs(dm17b['sam']['d'] - 2 / 3) < 1e-3, ('N17: 防空车受创应加深 d≈0.667', h17b)
    assert dm17b['radar']['hurt'] and abs(dm17b['radar']['d'] - 0.5) < 1e-3, ('N17: 雷达应置损伤态 d=0.5', h17b)
    assert dm17b['sam']['d'] > dm17['sam']['d'], ('N17: 受创程度应随 hp 下降单调上升', (dm17, dm17b))
    pg.wait_for_function("""() => __dbg.narrative.group.getObjectByName('narrative-dmgsmoke-radar').visible === true
      && __dbg.narrative.group.getObjectByName('narrative-radar-dish').rotation.z > 0.089""", timeout=5000)
    v17b = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      const samSp = n.group.getObjectByName('narrative-dmgsmoke-sam');
      const tubes = [];
      n.group.traverse(o => { if (o.name.indexOf('narrative-sam-tube-') === 0)
        tubes.push({ dp: o.userData._dp, rx: o.rotation.x }); });
      return { opSam: samSp.material.opacity, tubes,
               dishZ: n.group.getObjectByName('narrative-radar-dish').rotation.z };
    })()""")
    assert 0.20 <= v17b['opSam'] <= 0.44, ('N17: d=2/3 烟浓应在包络 [0.4267·0.5, 0.4267]', v17b)
    for t in v17b['tubes']:
        assert abs(t['rx'] - (-0.35 + (2 / 3) * 0.55 * t['dp'])) < 1e-3, ('N17: 发射架下垂应随 d 加深', v17b)
    assert abs(v17b['dishZ'] - 0.09) < 1e-6, ('N17: 雷达盘侧倾应精确 = d·0.18 = 0.09', v17b)
    print('N17 程度抬升 OK: d 1/3→2/3 包络右移 + 盘侧倾 0.090')
    # ④ 复位清零：resetRange → hurt 全 false / d=0 / 软烟全灭 / 姿态精确归位
    pg.evaluate("__dbg.resetRange()")
    pg.wait_for_function("""() => !__dbg.narrative.group.getObjectByName('narrative-dmgsmoke-sam').visible
      && !__dbg.narrative.group.getObjectByName('narrative-dmgsmoke-radar').visible""", timeout=5000)
    c17 = pg.evaluate("""(() => {
      const n = __dbg.narrative;
      const tubes = [];
      n.group.traverse(o => { if (o.name.indexOf('narrative-sam-tube-') === 0) tubes.push(o.rotation.x); });
      return { dmg: n.state().damaged, dishZ: n.group.getObjectByName('narrative-radar-dish').rotation.z, tubes };
    })()""")
    assert all((not x['hurt']) and x['d'] == 0 for x in c17['dmg']), ('N17: 复位后损伤态应全清', c17)
    assert abs(c17['dishZ']) < 1e-6 and all(abs(r + 0.35) < 1e-6 for r in c17['tubes']), ('N17: 复位后姿态应精确归位', c17)
    print('N17 复位清零 OK: 烟灭 + hurt/d 归零 + 姿态归位')
    # ⑤ 摧毁走残骸链共存：满血防空车 3 发摧毁 → hurt=false/d=0（残骸语义接管）、
    #    软烟熄灭、wreck=true（21.1）+ waves==1（21.2）链原样
    d17 = pg.evaluate("""(() => {
      for (let i = 0; i < 3; i++) __dbg.narrative.hitTest({ x: 12, y: 0.8, z: 69 }, 1);
      const n = __dbg.narrative;
      return { dm: n.state().damaged.find(s => s.key === 'sam'),
               wreck: n.state().wrecks.find(w => w.key === 'sam'),
               waves: n.state().waves };
    })()""")
    assert (not d17['dm']['hurt']) and d17['dm']['d'] == 0, ('N17: 摧毁后应走残骸语义（hurt=false/d=0）', d17)
    assert d17['wreck']['wreck'] and d17['waves'] == 1, ('N17: 摧毁应走既有残骸+冲击波链', d17)
    pg.wait_for_function("() => !__dbg.narrative.group.getObjectByName('narrative-dmgsmoke-sam').visible", timeout=5000)
    print('N17 PASS: 渐进损伤置态/程度随 hp/微倾/复位清零/残骸链共存')

    pg.evaluate("__dbg.resetRange()")
    pg.screenshot(path=H.output_path('shot_narrative_strike.jpg'), type='jpeg', quality=88)
    print('Phase 21 narrative_strike OK: N1-N9 全过 + 21.1 残骸 N10/N11 全过 + 21.2 反馈 N12/N13/N14 全过 + 25 状态件 N15/N16 全过 + 28 渐进损伤 N17 全过')


import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
