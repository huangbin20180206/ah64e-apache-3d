# -*- coding: utf-8 -*-
# P5-D 交互入口一致性——值级断言（修复前应 FAIL，修复后 GREEN）
# 覆盖指令一.1 的入口一致性 + 一.2 清理生命周期：
#   C1: 长按空格（keydown repeat）不得反复 toggle 旋翼启停（只响第一次）
#   C2: 湖面(禁用)下键盘 B 重置后靶标保持隐藏（syncTargetsVis 语义与按钮一致）
#   C3: visibilitychange(hidden) 后扳机(机炮/火箭)释放；btn-gun pointercancel 释放
#   C4: FPV 退出后驾驶键 w/a/s/d/r/q 全清（既有语义回归锚）
# 全部走 __dbg 数值/DOM 谓词，无中文文案、无固定墙钟、无单帧截图。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright

KEYDOWN = "window.dispatchEvent(new KeyboardEvent('keydown',{key:'%s',bubbles:true%s}))"
def kd(pg, key, repeat=False):
    pg.evaluate(KEYDOWN % (key, ',repeat:true' if repeat else ''))

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rig && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.wait_for_timeout(300)
    # 地面停放态，旋翼关闭起步
    pg.evaluate("__dbg.S.running = false; __dbg.S.spin = 0")
    pg.wait_for_timeout(150)

    # ---- C1: 空格 repeat 不反复启停 ----
    # 第一次正常空格：running false→true（改变状态本身合法）
    kd(pg, ' ')
    pg.wait_for_timeout(120)
    assert pg.evaluate("__dbg.S.running") is True, 'C1: 首空格应启动旋翼'
    # 5 次 repeat：若守卫缺失会 5 次翻转回到 False（探针实证 [F,T,F,T,F]）
    pg.evaluate("(() => { const s=[]; for(let i=0;i<5;i++){"
                "window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,repeat:true}));"
                "s.push(__dbg.S.running);} return s; })()")
    pg.wait_for_timeout(120)
    assert pg.evaluate("__dbg.S.running") is True, ('C1: repeat 空格翻转了启停状态（缺 repeat 守卫）',
                                                    pg.evaluate("__dbg.S.running"))
    print('C1 PASS: repeat 空格不反复启停（running=%s）' % pg.evaluate("__dbg.S.running"))

    # ---- C2: 湖面键盘 B 后靶标保持隐藏 ----
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(400)
    st0 = pg.evaluate("(() => ({ en: __dbg.targets.enabled,"
                      " vis: __dbg.targets.targets.filter(t=>t.group.visible).length }))()")
    assert st0['en'] is False and st0['vis'] == 0, ('C2: 前置失败——湖面应禁用且全隐', st0)
    kd(pg, 'b')                                   # 键盘 B（与按钮 btn-reset-targets 同语义）
    pg.wait_for_timeout(250)
    st1 = pg.evaluate("(() => ({ vis: __dbg.targets.targets.filter(t=>t.group.visible).length,"
                      " en: __dbg.targets.enabled }))()")
    assert st1['vis'] == 0, ('C2: 湖面键盘 B 后靶标浮水可见（缺 syncTargetsVis）', st0, st1)
    print('C2 PASS: 湖面键盘 B 后靶标仍隐藏（vis=%d）' % st1['vis'])

    # ---- C3: 切后台释放扳机 ----
    # 原子性要求（2026-09-09 修，同 ci_smoke P5-D D3）：置扳机 + 覆盖 hidden + 派发
    # visibilitychange 必须在同一个 JS 任务内完成，否则中间的渲染帧会让 65-weapons
    # 连发逻辑击发弹药（测试侧竞态，与产品代码无关）。
    # 模拟移动端切后台：浏览器 hidden 状态由原生 getter 决定，Playwright 无法直接
    # 置真——用 defineProperty 覆盖 getter 再派发 visibilitychange（与真实事件路径
    # 一致，76-mobile 与 releaseTriggers 的守卫都读 document.hidden）。事后恢复。
    pg.evaluate("""(() => {
      __dbg.rig.gunOn = true; __dbg.rig.rocketOn = true;
      const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
      window.__hiddenDesc = desc;
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    })()""")
    pg.wait_for_timeout(250)
    trig = pg.evaluate("(() => ({ g: __dbg.rig.gunOn, r: __dbg.rig.rocketOn }))()")
    assert trig['g'] is False and trig['r'] is False, ('C3: visibilitychange 未释放扳机', trig)
    # 恢复 hidden getter（避免污染后续断言）
    pg.evaluate("(() => { if (window.__hiddenDesc) Object.defineProperty(document,'hidden',window.__hiddenDesc); })()")
    # btn-gun pointercancel 释放（按住后取消）
    pg.evaluate("(() => { const b = document.getElementById('btn-gun');"
                " b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch'})); })()")
    pg.wait_for_timeout(100)
    assert pg.evaluate("__dbg.rig.gunOn") is True, 'C3: 前置失败——pointerdown 未按住机炮'
    pg.evaluate("(() => { const b = document.getElementById('btn-gun');"
                " b.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'touch'})); })()")
    pg.wait_for_timeout(150)
    assert pg.evaluate("__dbg.rig.gunOn") is False, 'C3: btn-gun pointercancel 未释放扳机'
    print('C3 PASS: visibilitychange + btn-gun pointercancel 均释放扳机')

    # ---- C4: FPV 退出后驾驶键全清（回归锚） ----
    pg.evaluate("""(() => { const F = __dbg.FLY; F.state='hover'; F.alt=14; __dbg.S._alt=0;
      F.x=0; F.z=0; F.yaw=0; F.pitch=0; __dbg.S.running=true; __dbg.S.spin=1; })()""")
    pg.wait_for_timeout(300)
    pg.evaluate("__dbg.fp.enter()")
    pg.wait_for_timeout(300)
    pg.evaluate("(() => { const ks=__dbg.keys; ks['w']=true; ks['a']=true; ks['r']=true; })()")
    pg.evaluate("__dbg.fp.exit()")
    pg.wait_for_timeout(300)
    rem = pg.evaluate("(() => { const ks=__dbg.keys;"
                      " return ['w','a','s','d','r','q'].filter(k=>ks[k]).length; })()")
    assert rem == 0, ('C4: FPV 退出后驾驶键残留', rem)
    print('C4 PASS: FPV 退出后 w/a/s/d/r/q 全清')

    pg.screenshot(path=H.output_path('shot_p5d_entries.jpg'), type='jpeg', quality=88)
    print('P5-D entry-consistency OK: C1 repeat 守卫 / C2 湖面键盘 B / C3 后台释放 / C4 FPV 清键')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')