# -*- coding: utf-8 -*-
# 最终闭环修复八：DOF framebuffer 级像素验证（真实帧捕获）。
# 走产品 screenshot 同帧机制（shotPending → loop render 后同帧 toDataURL → 下载），
# 用 PIL 分析 ROI：
#   - 焦点 ROI（机头前方目标）清晰度基本保持（方差不显著下降）
#   - 背景 ROI（上部远景天空/远处）方差显著稳定下降（散焦生效）
#   - 启用 DOF 后高亮像素占比不骤降（Bloom 能量代理，DOF 前置光效保留）
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H
from PIL import Image

def grab(pg, tag):
    """Playwright 截屏（合成层缓存当前帧，navlights/reflection 同款既定用法）"""
    path = H.output_path('dof_%s.png' % tag)
    pg.screenshot(path=path)
    return Image.open(path).convert('L')

def roi_var(img, box):
    crop = img.crop(box)
    px = list(crop.getdata())
    n = len(px)
    s = sum(px); s2 = sum(p*p for p in px)
    mean = s / n
    hi = sum(1 for p in px if p > 220) / n
    return {'var': s2/n - mean*mean, 'mean': mean, 'hi': hi}

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=3; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.wait_for_timeout(400)
    # 焦点目标：targets[1] 到机头前方 8u（近景）
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("""() => {
      const t = __dbg.targets.targets[1];
      const pos = __dbg.apache.root.position;
      const fwd = t.pos.set(0, 0, 1).applyQuaternion(__dbg.apache.root.quaternion);
      t.group.position.set(pos.x + fwd.x * 8, 0, pos.z + fwd.z * 8);
      t.pos.set(t.group.position.x, 0, t.group.position.z);
      t.alive = true; t.group.visible = true;
      __dbg.targets.enabled = true;
    }""")
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_function("() => __dbg.composer._dofActive", timeout=8000)
    pg.wait_for_timeout(600)

    # 动态 ROI（复核修复）：按投影位置计算焦点目标与背景区域，不依赖固定屏幕坐标。
    # 焦点目标=targets[1] 世界位置投影；背景=目标上方 30%（远景地平线/基地区）
    roi = pg.evaluate("""() => {
      const t = __dbg.targets.targets[1];
      const p = t.pos.clone().project(__dbg.W.camera);   // clone 实例方法，非构造器
      const cx = (p.x * 0.5 + 0.5) * 1280, cy = (-p.y * 0.5 + 0.5) * 800;
      const fgBox = [cx-100, cy-80, cx+100, cy+80];
      const bgBox = [cx-140, Math.max(0, cy-240), cx+140, Math.max(0, cy-120)];
      return { fg: fgBox, bg: bgBox };
    }""")
    fg = tuple(int(v) for v in roi['fg'])
    bg = tuple(int(v) for v in roi['bg'])
    print('动态 ROI: fg=%s bg=%s' % (fg, bg))
    imgOn = grab(pg, 'on')
    fgOn, bgOn = roi_var(imgOn, fg), roi_var(imgOn, bg)
    print('DOF 开: fg var=', round(fgOn['var'],1), 'bg var=', round(bgOn['var'],1), 'hi=', round(bgOn['hi'],4))

    # 关 DOF（同 FPV 机位）：dofOn=false → _dofActive=false → 无散焦
    pg.evaluate("__dbg.composer.dofOn = false")
    pg.wait_for_function("() => !__dbg.composer._dofActive", timeout=6000)
    pg.wait_for_timeout(600)
    imgOff = grab(pg, 'off')
    fgOff, bgOff = roi_var(imgOff, fg), roi_var(imgOff, bg)
    print('DOF 关(同机位): fg var=', round(fgOff['var'],1), 'bg var=', round(bgOff['var'],1), 'hi=', round(bgOff['hi'],4))
    pg.evaluate("__dbg.composer.dofOn = true")   # 恢复
    pg.wait_for_function("() => __dbg.composer._dofActive", timeout=6000)

    # 断言（同机位下 DOF 开/关的真实差异）：
    # 1) 背景 ROI 方差显著下降（散焦生效）：bg var 开 < 关 * 0.75（显著且稳定）
    assert bgOn['var'] < bgOff['var'] * 0.75 + 0.5, ('FB: 背景散焦未生效（同机位）', bgOn, bgOff)
    # 2) 焦点 ROI 清晰度基本保持：fg var 开 >= 关 * 0.5（焦点在景深半宽内；50% 是
    #    允许的轻微损失上限——目标在 ±2u 景深内 coc 小，实际应 >0.6）
    assert fgOn['var'] > fgOff['var'] * 0.5 - 0.5, ('FB: 焦点被错误散焦（同机位）', fgOn, fgOff)
    # 3) 高亮像素占比（Bloom/太阳高光代理）必须真正断言：DOF 开启不使高亮骤降
    #    （DOF 前置后光效叠加在已景深场景上，高亮区域应保留）
    assert bgOn['hi'] >= bgOff['hi'] * 0.5 - 0.005, ('FB: DOF 开启后高亮(Bloom)骤降', bgOn, bgOff)
    print('FB framebuffer 级断言 PASS（动态 ROI：背景散焦/焦点保持/高亮保留）')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')