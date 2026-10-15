# -*- coding: utf-8 -*-
# P10 Apache 重点部件细节件——值级浏览器断言（D2 阈值参数化版）
# 覆盖：D1 加载与诊断；D2 **世界包围盒硬断言**（不穿地面/不超宿主/尺寸上限）；
# D3 四地形/昼昏夜切换不丢；D4 质量档降级 + 恢复；D5 重复切场地/重置无增长；
# D6 P8 威胁/受损链路不破坏；D7 移动端窄视口；D8 失败回退（独立文件）。
#
# 修正批背景：首轮 D2 只比对"细节件 bbox 中心 vs 锚点 bbox 中心"，容差 0.2/0.5/0.8 单位
# （≈0.4–1.5m），导致 turret.glb 轴向错位（两枚 1 米环垂直叠放 → 高 2.17 单位、低于地面
# 0.24 单位）仍判 PASS。本版改为 bbox 包含性/尺寸/离地三类硬断言，该缺陷会被三重拦下。
#
# 【D2 阈值语义（重做批，2026-09-09 参数化）】
#   D2_DEFAULTS 与 D2_CFG 里的 TOL_CONTAIN/SIZE_MAX/GROUND_EPS/GROUND_TIRE **不是通用定律**，
#   而是**当前资产集（各细节件宿主尺寸 + 装配关系）的适配约束**：容差随宿主 bbox 走，
#   尺寸上限随宿主比例走，离地阈值随"是否接地件"走。
#   新增部件时必须**按该件宿主重新设定阈值并说明理由**（在 D2_CFG 中按 url 覆盖），
#   不得直接沿用别件的数值，更不得为了通过而放宽。
#   注意：bbox 断言只能证明"落在宿主包围盒内"，**不能证明与宿主表面有接触**——重做批的
#   机首箍环正是 D2 全过却因内表面与宿主零接触（间隙 0.055–0.138 单位）而弃件；
#   新增"贴合类"部件时须另做接触/间隙检查。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

# 默认阈值（可被 D2_CFG 每件覆盖）
D2_DEFAULTS = {
    'tol_contain': 0.06,   # 允许细节件超出宿主 bbox 的余量（单位；≈11cm）
    'size_max':    1.5,    # 细节件各轴尺寸 ≤ 宿主 × 1.5
    'ground_eps':  0.02,   # 非接地件最低点须 ≥ GROUND_Y + 0.02
    'ground_tire': 0.03,   # 轮胎接地件允许的最低点（与轮胎受压变形同量级）
}
# 每件配置（顺序必须与 DETAIL_MANIFEST 一致；hosts 为运行时对象名，多个取并集）
D2_CFG = [
    # 炮口箍：宿主 30mm 链炮炮管；非接地件
    {'url': 'assets/details/gun.glb',    'hosts': ['Cylinder014'], 'ground_contact': False},
    # 轮毂盘：宿主左右主轮；轮胎接地件（允许 -0.03 接地量）
    {'url': 'assets/details/wheels.glb', 'hosts': ['Cylinder008', 'Cylinder009'], 'ground_contact': True},
]

def cfg_of(url):
    for c in D2_CFG:
        if c['url'] == url:
            return c
    return None

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.dp && __dbg.targets && __dbg.rig)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)
    pg.wait_for_function("() => __dbg.dp.stats().loaded === 2 || __dbg.dp.stats().fallback === true", timeout=15000)

    # ---- D1: 加载与诊断（资产真实加载、非测试伪造） ----
    st = pg.evaluate("__dbg.dp.stats()")
    assert st['loaded'] == 2 and st['total'] == 2, ('D1: 两件应全部加载', st)
    assert st['fallback'] is False and st['error'] == '', ('D1: 无回退', st)
    assert st['tris'] > 0 and st['scenes'] == 2, ('D1: tris/scenes', st)
    assert all('turret' not in u for u in st['manifest']), ('D1: turret 应已移除', st['manifest'])
    assert all('nose' not in u for u in st['manifest']), ('D1: 机首件已弃用（宿主无圆柱面，箍环悬浮）', st['manifest'])
    assert st['manifest'] == [c['url'] for c in D2_CFG], ('D1: manifest 顺序应与 D2_CFG 一致', st['manifest'])
    print('D1 PASS: detail loaded=2 tris=%d scenes=2' % st['tris'])

    # ---- D2: 世界包围盒硬断言（包含性 / 尺寸上限 / 离地；阈值按件可配） ----
    r = pg.evaluate("""(hostSets) => {
      const a = __dbg.apache; const V = __dbg.W.camera.position.clone();
      const bbox = obj => { if(!obj) return null; const m=[1e9,1e9,1e9],M=[-1e9,-1e9,-1e9];
        obj.updateWorldMatrix(true,false);
        obj.traverse(ch=>{ if(!ch.isMesh||!ch.geometry||!ch.geometry.attributes.position)return;
          const p=ch.geometry.attributes.position;
          for(let i=0;i<p.count;i++){V.set(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(ch.matrixWorld);
            for(let k=0;k<3;k++){if(V.getComponent(k)<m[k])m[k]=V.getComponent(k);if(V.getComponent(k)>M[k])M[k]=V.getComponent(k);}}});
        return (m[0]>1e8)?null:[m,M]; };
      const union = (b1,b2) => { if(!b1) return b2; if(!b2) return b1;
        return [b1[0].map((v,i)=>Math.min(v,b2[0][i])), b1[1].map((v,i)=>Math.max(v,b2[1][i]))]; };
      return { dp: __dbg.dp.scenes.map(s=>bbox(s)),
               hosts: hostSets.map(ns => ns.reduce((acc,n)=>union(acc,bbox(a.get(n))), null)),
               ground: 0 }; }""", [c['hosts'] for c in D2_CFG])   # GROUND_Y=0（05-config；世界系，MODEL_LIFT 已含在 matrixWorld）

    # 顺序与 DETAIL_MANIFEST / D2_CFG 一致
    G = r['ground']
    for i, c in enumerate(D2_CFG):
        name = c['url'].split('/')[-1]
        det, host = r['dp'][i], r['hosts'][i]
        tol = c.get('tol_contain', D2_DEFAULTS['tol_contain'])
        smax = c.get('size_max', D2_DEFAULTS['size_max'])
        assert det and host, ('D2: bbox 取不到', name, det, host)
        for k in range(3):
            assert det[0][k] >= host[0][k] - tol, ('D2: %s 超出宿主 min 轴%d（容差 %.2f）' % (name, k, tol), det, host)
            assert det[1][k] <= host[1][k] + tol, ('D2: %s 超出宿主 max 轴%d（容差 %.2f）' % (name, k, tol), det, host)
            dsz = det[1][k] - det[0][k]; hsz = host[1][k] - host[0][k]
            assert dsz <= hsz * smax + 1e-6, ('D2: %s 尺寸超宿主 %.1f 倍 轴%d' % (name, smax, k), det, host)
        if c['ground_contact']:
            ge = c.get('ground_tire', D2_DEFAULTS['ground_tire'])
            assert det[0][1] >= G - ge, ('D2: %s 穿地面（接地件容差 %.2f）' % (name, ge), det)
        else:
            ge = c.get('ground_eps', D2_DEFAULTS['ground_eps'])
            assert det[0][1] >= G + ge, ('D2: %s 穿地面（须离地 %.2f）' % (name, ge), det)
    print('D2 PASS: 世界 bbox 包含性/尺寸/离地 全过（gun 与 wheels）')

    # ---- D3: 四地形/昼昏夜切换不丢 ----
    for terr in ['pad', 'grass', 'water', 'desert']:
        pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"%s\"]').click()" % terr)
        pg.wait_for_timeout(300)
        assert pg.evaluate("__dbg.dp.stats().scenes") == 2, ('D3: %s 切场 scenes 变化' % terr)
    for env in ['dusk', 'night', 'day']:
        pg.evaluate("document.querySelector('#env-row [data-env=\"%s\"]').click()" % env)
        pg.wait_for_timeout(300)
        assert pg.evaluate("__dbg.dp.stats().scenes") == 2, ('D3: %s 环境切换 scenes 变化' % env)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)
    print('D3 PASS: 四地形/昼昏夜切换细节件不丢')

    # ---- D4: 质量档降级（0.75 隐藏场景仍在 / 1 显示）/ 恢复 ----
    qv = pg.evaluate("""(() => { const s=document.getElementById('sel-quality'); s.value='0.75';
      s.dispatchEvent(new Event('change',{bubbles:true})); return __dbg.S.quality; })()""")
    pg.wait_for_timeout(300)
    d4 = pg.evaluate("""(() => ({ q: __dbg.S.quality,
      vis: __dbg.dp.scenes.map(s=>s.visible),
      scenes: __dbg.dp.scenes.length }))()""")
    assert d4['q'] == 0.75 and all(v is False for v in d4['vis']) and d4['scenes'] == 2, ('D4: 0.75 应隐藏全部细节件', d4)
    qv2 = pg.evaluate("""(() => { const s=document.getElementById('sel-quality'); s.value='1';
      s.dispatchEvent(new Event('change',{bubbles:true})); return __dbg.S.quality; })()""")
    pg.wait_for_timeout(300)
    d4b = pg.evaluate("__dbg.dp.scenes.map(s=>s.visible)")
    assert qv2 == 1 and all(v is True for v in d4b), ('D4: 恢复 1 档应重新显示', qv2, d4b)
    print('D4 PASS: 质量档 0.75 隐藏/1 显示（加载路径降级）')

    # ---- D5: 重复切场地/任务重置无对象增长（生命周期） ----
    before = pg.evaluate("__dbg.dp.scenes.length")
    for terr in ['desert', 'water', 'pad', 'desert']:
        pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"%s\"]').click()" % terr)
        pg.wait_for_timeout(250)
    assert pg.evaluate("__dbg.dp.scenes.length") == before, ('D5: 切场后 scenes 增长', before)
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_timeout(300)
    assert pg.evaluate("__dbg.dp.scenes.length") == before, 'D5: 任务重试 scenes 增长'
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_timeout(200)
    print('D5 PASS: 切场地/任务重置无对象增长')

    # ---- D6: P8 威胁/受损链路不破坏 ----
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(500)
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_timeout(250)
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_timeout(200)
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    # 条件等待替代固定 450ms（2026-09-09 修）：同 test_visual_materials M6
    pg.wait_for_function("() => __dbg.targets._threat >= 1", timeout=8000)
    assert pg.evaluate("__dbg.targets._threat") >= 1, 'D6: 威胁应可见（P8 链路保持）'
    assert pg.evaluate("!!__dbg.targets.baseCenter"), 'D6: 前置失败——baseCenter 应存在'
    pg.evaluate("__dbg.targets._heliDmg = 5; __dbg.targets._threatHitFlash = 3")
    # B6+：_dmgSmoke.visible 由 16-targets.js:429 updater 每帧派生（分类器真候选 L161→L162）
    pg.wait_for_function("() => __dbg.targets._dmgSmoke.visible", timeout=15000)
    assert pg.evaluate("__dbg.targets._dmgSmoke.visible") is True, 'D6: 受损烟应显示'
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_timeout(300)
    c6 = pg.evaluate("(() => ({ dmg: __dbg.targets._heliDmg, threat: __dbg.targets._threat,"
                     " penalty: __dbg.rig._dmgPenalty, scenes: __dbg.dp.scenes.length }))()")
    assert c6['dmg'] == 0 and c6['threat'] == 0 and c6['penalty'] == 0 and c6['scenes'] == 2, ('D6: P8 链路或细节件受损', c6)
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_timeout(200)
    print('D6 PASS: P8 威胁/受损可见可清可重试 + 细节件不受影响')

    # ---- D7: 移动端窄视口可加载核心场景 + 细节件状态正常 ----
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.wait_for_timeout(400)
    d7 = pg.evaluate("(() => ({ vw: innerWidth, scenes: __dbg.dp.scenes.length,"
                     " tris: __dbg.dp.stats().tris }))()")
    assert d7['vw'] == 390 and d7['scenes'] == 2 and d7['tris'] > 0, ('D7: 窄视口细节件异常', d7)
    assert pg.evaluate("__dbg.W.terrainKey") == 'desert', 'D7: 窄视口切场地失败'
    print('D7 PASS: 移动端窄视口可加载核心场景 + 细节件')

    pg.screenshot(path=H.output_path('p10_detail_parts.jpg'), type='jpeg', quality=90)
    print('P10 detail-parts OK: D1-D7 全过（D8 由独立 route 拦截测试覆盖）')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
