# -*- coding: utf-8 -*-
# 手动反馈修复批定向测试（2026-09-09 用户实测反馈）：
#   ① 部件标签引线：.labline 存在且可见标签引线 length>0（文字不再糊机体）
#   ② 地狱火弹体朝向：机头转向后发射，弹体前向与飞行方向点积 ≈1
#      （修复"导弹与发射方向垂直"；用 f.dir.clone() 实例方法，禁 THREE 构造器）
#   ③ FPV 完整键位提示 + 锁定目标建议武器：#fp-tip 含全部键位、
#      #fp-lock-w 按目标类型显示建议（坦克→F 地狱火）
#   ④ 训练提示：重入/进行中 #guide 常驻显示"训练 ①/⑤ 按 空格 启动旋翼"
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rig && __dbg.targets && __dbg.rescue)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S._guide = 0")
    pg.wait_for_timeout(400)

    # ---- ① 部件标签引线 ----
    pg.evaluate("document.getElementById('chk-labels').click()")   # 打开标签
    pg.wait_for_timeout(800)
    lab = pg.evaluate("""() => {
      const labs = [...document.querySelectorAll('#labels .lab')];
      const withLine = labs.filter(el => el.querySelector('.labline'));
      const vis = withLine.filter(el => el.style.display !== 'none' && parseFloat(el.querySelector('.labline').style.width || 0) > 0);
      return { total: labs.length, withLine: withLine.length, visibleWithLine: vis.length };
    }""")
    assert lab['total'] > 0, ('标签未显示', lab)
    assert lab['withLine'] == lab['total'], ('标签缺引线元素', lab)
    assert lab['visibleWithLine'] > 0, ('可见标签引线 length 应为正（文字已抬离锚点）', lab)
    print('① 标签引线 OK:', lab)

    # ---- 起飞悬停（后续 ②③ 共用） ----
    pg.keyboard.press('Space')
    pg.wait_for_function("() => __dbg.S.spin >= __dbg.FLY.MIN_SPIN", timeout=20000)
    pg.keyboard.press('KeyT')
    pg.wait_for_function("() => __dbg.FLY.state === 'hover'", timeout=20000)
    pg.wait_for_timeout(400)

    # ---- ② 地狱火弹体朝向（机头转向 +Yaw=π/2 后发射） ----
    pg.evaluate("__dbg.FLY.yaw = Math.PI / 2")      # 机头朝 +X
    pg.wait_for_timeout(300)
    pg.keyboard.press('KeyF')                        # 发射地狱火
    pg.wait_for_timeout(600)
    dot = pg.evaluate("""() => {
      const fs = __dbg.rig.flying;
      if (!fs.length) return { n: 0, dot: 0 };
      const f = fs[fs.length - 1];
      // 弹体前向 = 几何长轴 Z 经 quaternion 旋转；f.dir.clone() 复用实例方法（禁 THREE 构造器）
      const fwd = f.dir.clone().set(0, 0, 1).applyQuaternion(f.g.quaternion);
      return { n: fs.length, dot: +fwd.dot(f.dir).toFixed(4) };
    }""")
    assert dot['n'] > 0, ('地狱火未发射', dot)
    assert dot['dot'] > 0.99, ('弹体朝向与飞行方向不一致（曾为垂直 bug）', dot)
    print('② 地狱火朝向 OK: 前向·飞行方向 点积 =', dot['dot'])
    # 复位机头朝 +Z（对准基地，供 ③ 锁定）
    pg.evaluate("__dbg.FLY.yaw = 0; __dbg.rig.clearTransient()")
    pg.wait_for_timeout(400)

    # ---- ③ FPV 完整提示 + 锁定目标建议武器 ----
    tip = pg.evaluate("document.getElementById('fp-tip').textContent")
    for kw in ['W/S', 'A/D', 'R/Q', 'Z/X', '左键', '右键', 'F 地狱火', 'C 退出']:
        assert kw in tip, ('FPV 提示缺键位: %s' % kw, tip)
    assert '灵敏度' in pg.evaluate("document.getElementById('panel').textContent"), '面板缺 FPV 灵敏度滑块'
    # 进 FPV：机头朝 +Z（基地目标在 42u 前方锥内）→ 应锁定目标并给建议武器
    pg.keyboard.press('KeyC')
    pg.wait_for_function("() => !!__dbg.fp.active", timeout=10000)
    # B6+：锁定建议由 loop 每帧写（分类器真候选 L70→L74）——固定睡 1200ms 在低帧下
    # 可能一帧未跑，读到空的建议文本
    pg.wait_for_function("() => document.getElementById('fp-lock-w').textContent.indexOf('建议') >= 0", timeout=15000)
    wTip = pg.evaluate("document.getElementById('fp-lock-w').textContent")
    # 锁定类型取决于场景布局（坦克/卡车/空中目标谁更贴轴）——只验证建议
    # 逻辑工作：提示非空、含'建议'与至少一个武器快捷键
    assert '建议' in wTip and any(k in wTip for k in ['G', 'F', 'X']), ('锁定目标未给建议武器', wTip)
    print('③ FPV 提示 OK: #fp-tip 全键位 + 建议武器 =', wTip)
    pg.keyboard.press('KeyC')                        # 退出 FPV
    pg.wait_for_timeout(400)

    # ---- ④ 训练提示 guide 常驻（复位飞行状态，让训练从 ① 开始） ----
    pg.evaluate("__dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.S.running=false; __dbg.S._trainFp=false; __dbg.S._trainOrbit=false; __dbg.S._trainRescue=false")
    pg.wait_for_timeout(400)
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"train\"]').click()")
    # B6+：S._train / #guide / #toast 均由 loop 派生（分类器真候选 L83→L85/L86/L88），
    # 固定睡 600ms 覆盖不全 0.5s 节流块
    pg.wait_for_function("""() => __dbg.S._train === 1
        && document.getElementById('guide').textContent.indexOf('①/⑤') >= 0
        && document.getElementById('toast').textContent.indexOf('①/⑤') >= 0""", timeout=15000)
    g = pg.evaluate("({guide: document.getElementById('guide').textContent, train: __dbg.S._train})")
    assert g['train'] == 1, ('训练未从 ① 开始', g)
    assert '训练' in g['guide'] and '①/⑤' in g['guide'] and '空格' in g['guide'], ('guide 未常驻显示训练操作', g)
    toastT = pg.evaluate("document.getElementById('toast').textContent")
    assert '①/⑤' in toastT, ('训练 toast 应含步骤编号', toastT)
    print('④ 训练提示 OK: guide 常驻 =', g['guide'])

    # ---- ⑤ 涂装贴花观感修正（手动反馈第 2 批）----
    dec = pg.evaluate("""() => {
      const a = __dbg.apache;
      const arr = a.mats.get('USMC_LowVis_Marking');
      const c = arr && arr[0] ? arr[0].color.getHexString() : 'NONE';
      const sL = a.get('USMC_Serial_L'), sR = a.get('USMC_Serial_R');
      return { color: c, serialZ: [sL ? +sL.position.z.toFixed(3) : null, sR ? +sR.position.z.toFixed(3) : null] };
    }""")
    # 颜色：0x1e2121 低可视深灰（原 0x303635 灰绿——用户反馈"绿标志贴灰机身"混搭）
    assert dec['color'] == '1e2121', ('贴花材质未压为低可视深灰', dec)
    # 间距：USMC_Serial 后移 0.15u（MARINES/尾号 粘连 0.15u → 0.30u 间隔）
    assert dec['serialZ'][0] is not None and dec['serialZ'][0] < -0.1 and dec['serialZ'][0] == dec['serialZ'][1], ('尾号未后移拉开间距', dec)
    print('⑤ 贴花观感修正 OK: Marking 深灰 =', dec['color'], '| Serial z =', dec['serialZ'])

    print('fixes OK: 标签引线 / 地狱火朝向 / FPV 提示+建议武器 / 训练 guide 常驻 / 贴花观感 全过')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')
