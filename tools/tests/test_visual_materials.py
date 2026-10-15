# -*- coding: utf-8 -*-
# P9 Apache 外观渲染与材质精修——值级浏览器断言
# 覆盖指令 §6：材质诊断值（visualTokens 只读数值）、四地形×昼昏夜×质量档、
# 第三人称/FPV-环绕切换、受损清理后状态、场地切换、涂装切换保留 P9 值、
# P8 威胁/受损仍可见可清可重试。截图辅助，数值为主。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rig)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1200)

    # ---- M1: 材质精修 token 生效（glass 高反射/body 哑光/missile 金属/exhaust 热端） ----
    vt = pg.evaluate("__dbg.apache.visualTokens()")
    assert vt['glass']['rough'] == 0.14, ('M1: 玻璃粗糙度应 0.14', vt['glass'])
    assert vt['body']['rough'] == 0.70, ('M1: 机身粗糙度应 0.70', vt['body'])
    assert vt['missile']['metal'] == 0.2 and vt['missile']['rough'] == 0.5, ('M1: 地狱火弹体金属度', vt['missile'])
    assert vt['exhaust']['rough'] == 0.35, ('M1: 排气热端粗糙度应 0.35', vt['exhaust'])
    print('M1 PASS: 材质 token 生效 (glass r0.14 / body r0.70 / missile m0.2 / exhaust r0.35)')

    # ---- M2: 环境联动——glass envI = v × 2.4（白天 2.4/黄昏 1.52/夜间 0.75），body 保持 1× ----
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)
    d = pg.evaluate("(() => ({ glass: __dbg.apache.mats.get('USMC_LowVis_Glass')[0].envMapIntensity,"
                    " body: __dbg.apache.mats.get('USMC_LowVis_Body')[0].envMapIntensity }))()")
    assert abs(d['glass'] - 2.4) < 1e-3 and abs(d['body'] - 1.0) < 1e-3, ('M2: 白天 glass 2.4/body 1', d)
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.wait_for_timeout(300)
    n = pg.evaluate("(() => ({ glass: __dbg.apache.mats.get('USMC_LowVis_Glass')[0].envMapIntensity,"
                    " body: __dbg.apache.mats.get('USMC_LowVis_Body')[0].envMapIntensity }))()")
    assert abs(n['glass'] - 0.312 * 2.4) < 1e-2 and abs(n['body'] - 0.312) < 1e-3, ('M2: 夜间 glass/body 联动', n)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)
    print('M2 PASS: 环境联动 glass 2.4x/body 1x（白天 2.4/夜间 0.749）')

    # ---- M3: 涂装切换保留 P9 值（army→lowvis 恢复后仍 0.70） ----
    pg.evaluate("document.querySelector('#scheme-row [data-scheme=\"army\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#scheme-row [data-scheme=\"lowvis\"]').click()")
    pg.wait_for_timeout(300)
    r = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Body')[0].roughness")
    assert abs(r - 0.70) < 1e-3, ('M3: lowvis 恢复后机身粗糙度应保留 0.70', r)
    print('M3 PASS: 涂装切换保留 P9 值（army→lowvis 后 body r=0.70）')

    # ---- M4: 四地形切换无残留（材质/场景不漂移） ----
    for terr in ['pad', 'grass', 'water', 'desert']:
        pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"%s\"]').click()" % terr)
        pg.wait_for_timeout(400)
        st = pg.evaluate("(() => ({ terr: __dbg.W.terrainKey, glass: __dbg.apache.mats.get('USMC_LowVis_Glass')[0].roughness,"
                         " env: __dbg.S.env }))()")
        assert st['terr'] == terr and abs(st['glass'] - 0.14) < 1e-3, ('M4: 场地切换残留', st)
    print('M4 PASS: 四地形切换无残留（材质稳定）')

    # ---- M5: 质量档降级不崩坏（0.75 档材质仍可读） ----
    pg.evaluate("""(() => { const s=document.getElementById('sel-quality'); s.value='0.75';
      s.dispatchEvent(new Event('change',{bubbles:true})); })()""")
    # B6+：等画质真正切到 0.75 且渲染两帧，替代固定睡 400ms（分类器真候选 L63→L66）
    pg.wait_for_function("() => __dbg.S.quality === 0.75", timeout=15000)
    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    q = pg.evaluate("(() => ({ q: __dbg.S.quality, glass: __dbg.apache.visualTokens().glass,"
                    " dp: __dbg.renderer.getPixelRatio() }))()")
    assert q['q'] == 0.75 and q['glass']['rough'] == 0.14 and q['dp'] < 1.6, ('M5: 低档降级异常', q)
    pg.evaluate("""(() => { const s=document.getElementById('sel-quality'); s.value='1';
      s.dispatchEvent(new Event('change',{bubbles:true})); })()""")
    pg.wait_for_timeout(300)
    assert pg.evaluate("__dbg.S.quality") == 1, 'M5: 恢复标准档失败'
    print('M5 PASS: 0.75 档降级不崩坏 + 恢复 1 档')

    # ---- M6: P8 威胁/受损仍可见可清可重试（材质精修不破坏） ----
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_timeout(250)
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_timeout(200)
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    # 条件等待替代固定 400ms（2026-09-09 修）：威胁出现依赖任务推进与距离判定，
    # 固定墙钟在负载下会偶发超时；超时即失败，不会掩盖真实回归。
    pg.wait_for_function("() => __dbg.targets._threat >= 1", timeout=8000)
    assert pg.evaluate("__dbg.targets._threat") >= 1, 'M6: 威胁应可见（P8 链路保持）'
    pg.evaluate("__dbg.targets._heliDmg = 5; __dbg.targets._threatHitFlash = 3")
    # 受损烟与威胁等级都由渲染循环逐帧派生（16-targets：烟按 _heliDmg>=4 派生、
    # 威胁按 aaActive+_threatHitFlash 派生），固定睡 300ms 在门禁负载下可能一帧
    # 都没跑（GATE-R8 实测）。_threatHitFlash 每帧只减 dt（钳制 0.05），3s 窗口实为
    # 60 帧——节流下远长于下面 8s 等待上限，条件等待不会错过闪烁窗口。
    pg.wait_for_function("() => __dbg.targets._dmgSmoke.visible", timeout=8000)
    # 分开断言：合在一条里时无法区分"AA 未激活导致威胁到不了 3"与"帧没跑导致烟没显"
    threat_now = pg.evaluate("__dbg.targets._threat")
    assert threat_now == 3, ('M6: 受击后威胁应升到 3', threat_now)
    assert pg.evaluate("__dbg.targets._dmgSmoke.visible") is True, 'M6: 受损烟应显示'
    # 受损惩罚仍派生
    pg.evaluate("__dbg.rig._dmgPenalty = 0")
    pg.evaluate("__dbg.targets.onHeliHit(5, null)")
    pg.wait_for_timeout(200)
    assert abs(pg.evaluate("__dbg.rig._dmgPenalty") - 0.3) < 1e-6, 'M6: 受损惩罚仍派生'
    # 重试清理（P8 语义保持）
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_timeout(300)
    c = pg.evaluate("(() => ({ dmg: __dbg.targets._heliDmg, threat: __dbg.targets._threat,"
                    " penalty: __dbg.rig._dmgPenalty }))()")
    assert c['dmg'] == 0 and c['threat'] == 0 and c['penalty'] == 0, ('M6: 重试清理失败', c)
    print('M6 PASS: P8 威胁/受损仍可见可清可重试（材质精修不破坏）')

    # ---- M7: FPV/环绕切换 + 受损清理后材质无残留 ----
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.S._alt=0; __dbg.S.running=true")
    pg.evaluate("__dbg.fp.enter()")
    pg.wait_for_timeout(400)
    assert pg.evaluate("__dbg.fp.active"), 'M7: FPV 未进入'
    pg.evaluate("__dbg.fp.exit()")
    pg.wait_for_timeout(300)
    assert not pg.evaluate("__dbg.fp.active"), 'M7: FPV 未退出'
    vt2 = pg.evaluate("__dbg.apache.visualTokens()")
    assert vt2['glass']['rough'] == 0.14, 'M7: FPV 切换后材质残留'
    print('M7 PASS: FPV/环绕切换 + 清理后材质无残留')

    pg.screenshot(path=H.output_path('shot_visual_materials.jpg'), type='jpeg', quality=90)
    print('P9 visual-materials OK: M1-M7 全过')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
