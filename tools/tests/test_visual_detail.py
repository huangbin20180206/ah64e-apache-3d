# -*- coding: utf-8 -*-
# P9 补强批 Apache 机身材质可见细节——值级浏览器断言
# 覆盖补强指令 §3 必做增量（分区层次/使用痕迹/玻璃镜片边界）与 §5 验收：
#   M8  detail 诊断数值（开关/合成数/尺寸/画布哈希）
#   M9  材质接线（Body 2048 细节贴图 / Exhaust 积碳 / lens 镜片 / Glass 无贴图）
#       + 四地形切换后细节不丢
#   M10 昼/昏/夜切换后细节保留 + night glass envI 联动（首轮不破坏）
#   M11 低质量档下细节仍存在 + 恢复标准档
#   M12 FPV/环绕切换 + 涂装切换后细节保留
#   M13 P8 威胁/受损仍可见可清可重试（本批不破坏）+ 受损/清理后细节仍在
#   M14 移动端窄视口 detail 诊断正常（场景零 pageerror）
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.rig)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(600)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)

    # ---- M8: 本批细节诊断值存在（开关/合成数/尺寸/画布哈希 16 位非全零） ----
    d = pg.evaluate("__dbg.apache.visualTokens().detail")
    assert d['enabled'] is True, ('M8: 细节应启用', d)
    assert d['skins'] >= 1, ('M8: 蒙皮合成贴图应 ≥1', d)
    assert d['skinSize'] == 2048, ('M8: 蒙皮合成尺寸应 2048', d)
    assert d['exhaust'] is True, ('M8: 排气积碳应应用', d)
    assert d['lens'] is True, ('M8: 镜片贴图应应用', d)
    assert len(d['hash']) == 16 and d['hash'] != '0' * 16, ('M8: 画布哈希 16 位非全零', d)
    print('M8 PASS: detail 诊断（enabled/skins=%d/2048/exhaust/lens/hash=%s）' % (d['skins'], d['hash']))

    # ---- M9: 材质接线 + 四地形切换细节不丢 ----
    m = pg.evaluate("""(() => { const get=n=>{const l=__dbg.apache.mats.get(n); return l&&l[0]?l[0]:null;};
      const body=get('USMC_LowVis_Body'), ex=get('USMC_LowVis_Exhaust'), lens=get('lens'),
            glass=get('USMC_LowVis_Glass');
      return { bodyW: body&&body.map?body.map.image.width:0,
               exMap: !!(ex&&ex.map), exCol: ex?+ex.color.r.toFixed(2):0,
               lensMap: !!(lens&&lens.map), glassMap: !!(glass&&glass.map) }; })()""")
    assert m['bodyW'] == 2048, ('M9: Body 应挂 2048 细节贴图', m)
    assert m['exMap'] and m['exCol'] > 0.10, ('M9: Exhaust 应挂积碳贴图且基色提亮', m)
    assert m['lensMap'], 'M9: lens 应挂镜片贴图'
    assert m['glassMap'] is False, 'M9: Glass 必须无贴图（UV 折叠，贴图无效）'
    # 四地形切换：detail 不漂移（map 尺寸不变）
    for terr in ['pad', 'grass', 'water', 'desert']:
        pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"%s\"]').click()" % terr)
        pg.wait_for_timeout(350)
        w = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Body')[0].map ? __dbg.apache.mats.get('USMC_LowVis_Body')[0].map.image.width : 0")
        assert w == 2048, ('M9: %s 场地切换后细节贴图丢失' % terr, w)
    print('M9 PASS: 材质接线（Body 2048/Exhaust 积碳/lens 镜片/Glass 无贴图）+ 四地形不丢')

    # ---- M10: 昼/昏/夜切换后细节保留 + night glass envI 联动（首轮语义） ----
    hash_day = pg.evaluate("__dbg.apache.visualTokens().detail.hash")
    for env in ['dusk', 'night', 'day']:
        pg.evaluate("document.querySelector('#env-row [data-env=\"%s\"]').click()" % env)
        pg.wait_for_timeout(300)
        h = pg.evaluate("__dbg.apache.visualTokens().detail.hash")
        assert h == hash_day, ('M10: %s 环境切换后细节哈希漂移' % env, h, hash_day)
    # night glass envI 联动公式保持（首轮断言不破坏）
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.wait_for_timeout(300)
    ng = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Glass')[0].envMapIntensity")
    assert abs(ng - 0.312 * 2.4) < 1e-2, ('M10: night glass envI 联动', ng)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(300)
    print('M10 PASS: 昼/昏/夜切换细节保留 + night glass envI 联动')

    # ---- M11: 低质量档下细节仍存在 + 恢复标准档 ----
    pg.evaluate("""(() => { const s=document.getElementById('sel-quality'); s.value='0.75';
      s.dispatchEvent(new Event('change',{bubbles:true})); })()""")
    pg.wait_for_timeout(350)
    q = pg.evaluate("(() => ({ q: __dbg.S.quality, w: __dbg.apache.mats.get('USMC_LowVis_Body')[0].map.image.width,"
                    " en: __dbg.apache.visualTokens().detail.enabled }))()")
    assert q['q'] == 0.75 and q['w'] == 2048 and q['en'] is True, ('M11: 0.75 档细节应保留', q)
    pg.evaluate("""(() => { const s=document.getElementById('sel-quality'); s.value='1';
      s.dispatchEvent(new Event('change',{bubbles:true})); })()""")
    pg.wait_for_timeout(300)
    assert pg.evaluate("__dbg.S.quality") == 1, 'M11: 恢复标准档失败'
    print('M11 PASS: 0.75 档细节保留 + 恢复 1 档')

    # ---- M12: FPV/环绕切换 + 涂装切换后细节保留 ----
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.fp.enter()")
    pg.wait_for_timeout(350)
    assert pg.evaluate("__dbg.fp.active"), 'M12: FPV 未进入'
    h_fp = pg.evaluate("__dbg.apache.visualTokens().detail.hash")
    assert h_fp == hash_day, ('M12: FPV 中细节哈希漂移', h_fp)
    pg.evaluate("__dbg.fp.exit()")
    pg.wait_for_timeout(300)
    assert not pg.evaluate("__dbg.fp.active"), 'M12: FPV 未退出'
    # 涂装切换：army→lowvis 恢复细节（2048 map 仍在）
    pg.evaluate("document.querySelector('#scheme-row [data-scheme=\"army\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('#scheme-row [data-scheme=\"lowvis\"]').click()")
    pg.wait_for_timeout(300)
    w = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Body')[0].map.image.width")
    assert w == 2048, ('M12: 涂装切换 lowvis 恢复应保留细节贴图', w)
    print('M12 PASS: FPV 进出 + 涂装切换后细节保留')

    # ---- M13: P8 威胁/受损仍可见可清可重试（本批不破坏）+ 受损/清理后细节仍在 ----
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_timeout(250)
    pg.evaluate("__dbg.beginMission()")
    pg.wait_for_timeout(200)
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    # B6+：_threat 由 16-targets.js:440/442 updater 每帧写（分类器真候选 L115→L116）
    pg.wait_for_function("() => __dbg.targets._threat >= 1", timeout=15000)
    assert pg.evaluate("__dbg.targets._threat") >= 1, 'M13: 威胁应可见（P8 链路保持）'
    pg.evaluate("__dbg.targets._heliDmg = 5; __dbg.targets._threatHitFlash = 3")
    # B6+：_dmgSmoke.visible 由 16-targets.js:429 updater 每帧派生（分类器真候选 L118→L119）
    # ——与 test_visual_materials M6 同款修法
    pg.wait_for_function("() => __dbg.targets._dmgSmoke.visible", timeout=15000)
    assert pg.evaluate("__dbg.targets._threat") == 3 and pg.evaluate("__dbg.targets._dmgSmoke.visible") is True, 'M13: 受损烟应显示'
    # 受损后细节贴图仍在
    w_dmg = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Body')[0].map.image.width")
    assert w_dmg == 2048, ('M13: 受损后细节贴图应仍在', w_dmg)
    # 重试清理（P8 语义）+ 清理后细节仍在
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_timeout(300)
    c = pg.evaluate("(() => ({ dmg: __dbg.targets._heliDmg, threat: __dbg.targets._threat,"
                    " penalty: __dbg.rig._dmgPenalty, w: __dbg.apache.mats.get('USMC_LowVis_Body')[0].map.image.width }))()")
    assert c['dmg'] == 0 and c['threat'] == 0 and c['penalty'] == 0, ('M13: 重试清理失败', c)
    assert c['w'] == 2048, ('M13: 清理后细节贴图应仍在', c)
    print('M13 PASS: P8 威胁/受损可见可清可重试 + 受损/清理后细节保留')

    # ---- M14: 移动端窄视口 detail 诊断正常（390×844 无 pageerror） ----
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_timeout(200)
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.wait_for_timeout(400)
    m14 = pg.evaluate("(() => ({ en: __dbg.apache.visualTokens().detail.enabled,"
                      " w: __dbg.apache.mats.get('USMC_LowVis_Body')[0].map.image.width,"
                      " vw: innerWidth }))()")
    assert m14['en'] is True and m14['w'] == 2048 and m14['vw'] == 390, ('M14: 窄视口细节异常', m14)
    # 窄视口下切场地/环境不崩
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(350)
    assert pg.evaluate("__dbg.W.terrainKey") == 'water', 'M14: 窄视口切场地失败'
    print('M14 PASS: 移动端窄视口 detail 诊断正常 + 切场地不崩')

    pg.screenshot(path=H.output_path('shot_visual_detail.jpg'), type='jpeg', quality=90)
    print('P9-rein visual-detail OK: M8-M14 全过')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
