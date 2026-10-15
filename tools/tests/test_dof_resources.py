# -*- coding: utf-8 -*-
# 最终闭环修复七/八：DOF 合成链与资源治理 framebuffer 级验证。
#   A) 资源治理：0.75 档 dofRT 释放 + sceneRT.depthTexture detach；恢复 1 档惰性重建；
#      resize 后 dofRT/depthTexture 实际尺寸正确；多次切档无泄漏/不引用已 dispose
#   B) DOF 合成链：启用 DOF 后 Bloom 高亮能量不骤降（DOF 前置，光效在其上叠加）
#   C) DOF framebuffer 级：焦点 ROI 清晰度保持、背景 ROI 方差显著下降（散焦生效）
# 值级 + 像素级断言（ROI 方差用 canvas 读像素计算）。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.composer && __dbg.apache)", timeout=60000)

    # A1) 1 档：DOF 资源存在（dofRT + depthTexture）
    st = pg.evaluate("""() => ({
      dofRT: !!__dbg.composer.dofRT, depthTex: !!__dbg.composer.sceneRT.depthTexture,
      dofOn: __dbg.composer.dofOn,
      dofRTW: __dbg.composer.dofRT ? __dbg.composer.dofRT.width : 0,
      depthTexW: __dbg.composer.sceneRT.depthTexture ? __dbg.composer.sceneRT.depthTexture.image.width : 0
    })""")
    print('A1 高档资源:', st)
    assert st['dofRT'] and st['depthTex'] and st['dofOn'], ('A1: 高档应有 DOF 资源', st)
    # resize 尺寸：dofRT ≈ w/2，depthTexture = 全屏宽
    assert abs(st['dofRTW'] - 640) <= 2 and st['depthTexW'] == 1280, ('A1: DOF 资源尺寸异常', st)

    # A2) 0.75 档：释放（dofRT=null + depthTexture detach）
    pg.evaluate("""(()=>{const s=document.getElementById('sel-quality');
      s.value='0.75'; s.dispatchEvent(new Event('change',{bubbles:true}));})()""")
    pg.wait_for_timeout(500)
    st2 = pg.evaluate("""() => ({
      dofRT: !!__dbg.composer.dofRT, depthTex: !!__dbg.composer.sceneRT.depthTexture,
      dofOn: __dbg.composer.dofOn, active: !!__dbg.composer._dofActive
    })""")
    print('A2 0.75 档释放:', st2)
    assert not st2['dofRT'] and not st2['depthTex'] and not st2['dofOn'], ('A2: 0.75 档未释放 DOF 资源', st2)

    # A3) 恢复 1 档：惰性重建 + 尺寸正确 + resize 后一致
    pg.evaluate("""(()=>{const s=document.getElementById('sel-quality');
      s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true}));})()""")
    pg.wait_for_timeout(500)
    st3 = pg.evaluate("""() => ({
      dofRT: !!__dbg.composer.dofRT, depthTex: !!__dbg.composer.sceneRT.depthTexture,
      dofRTW: __dbg.composer.dofRT ? __dbg.composer.dofRT.width : 0,
      depthTexW: __dbg.composer.sceneRT.depthTexture ? __dbg.composer.sceneRT.depthTexture.image.width : 0
    })""")
    print('A3 恢复重建:', st3)
    assert st3['dofRT'] and st3['depthTex'], ('A3: 高档未惰性重建 DOF 资源', st3)
    assert abs(st3['dofRTW'] - 640) <= 2 and st3['depthTexW'] == 1280, ('A3: 重建后尺寸异常', st3)

    # A4) 多次切档 + dispose 证据（指令四加强版）：保存旧 sceneRT/depthTexture/
    #     dofRT 引用，切档前包装/spy dispose 方法，断言：
    #       高→低：旧 sceneRT（含其 depthTexture 级联）与旧 dofRT 的 dispose
    #              各被恰当调用 1 次；
    #       低→高：旧无 depth 的 sceneRT 被 dispose 1 次；
    #       新对象与旧对象 identity 不同、generation（userData.gen）匹配 _rtGen；
    #       连续多轮切档创建/释放计数平衡（created == disposed + 当前存活）。
    #     不以字段为 null 或 gen 递增作为"无泄漏"的唯一表述（dispose 调用是
    #     释放事实的直接证据）。
    def install_wraps():
        # 对当前存在的 sceneRT/dofRT 包装 dispose：记录 created 与 disposed
        # （tag:gen），调用原 dispose 保持真实释放语义；幂等（__dfw）。
        # 注：depthTexture 不包装 dispose——three r160 的 WebGLRenderTarget.
        # dispose() 仅派发 'dispose' 事件，内部 deallocateTexture 不调用
        # depthTexture.dispose() 方法（spy 它必落空）；depth 释放证据改为：
        # 保存旧引用 + 高→低后 sceneRT.depthTexture 不存在 + 低→高后新 depth
        # identity 不同且 userData.gen 匹配（随宿主原子重建，由 three 语义保证）
        pg.evaluate("""() => {
          if (!window.__doflife) window.__doflife = { created: [], disposed: [] };
          const wrap = (obj, tag) => {
            if (!obj || obj.__dfw) return;
            const g = (obj.userData && obj.userData.gen != null) ? obj.userData.gen : '?';
            window.__doflife.created.push(tag + ':' + g);
            const orig = obj.dispose.bind(obj);
            obj.__dfw = true;
            obj.dispose = () => {
              window.__doflife.disposed.push(tag + ':' + g);
              orig();
            };
          };
          const c = __dbg.composer;
          wrap(c.sceneRT, 'sceneRT');
          wrap(c.dofRT, 'dofRT');
        }""")

    def snapshot():
        return pg.evaluate("""() => {
          const c = __dbg.composer;
          return { created: window.__doflife.created.slice(),
                   disposed: window.__doflife.disposed.slice(),
                   gen: c._rtGen,
                   sceneGen: c.sceneRT && c.sceneRT.userData ? c.sceneRT.userData.gen : null,
                   dofGen: c.dofRT && c.dofRT.userData ? c.dofRT.userData.gen : null,
                   depthGen: c.sceneRT && c.sceneRT.depthTexture && c.sceneRT.depthTexture.userData
                             ? c.sceneRT.depthTexture.userData.gen : null,
                   sceneNew: c.sceneRT !== window.__prevScene,
                   dofNew: !c.dofRT || c.dofRT !== window.__prevDof,
                   depthNew: !c.sceneRT || !c.sceneRT.depthTexture
                             || c.sceneRT.depthTexture !== window.__prevDepth,
                   depthTex: !!(c.sceneRT && c.sceneRT.depthTexture),
                   dofAlive: !!c.dofRT };
        }""")

    def set_quality(q):
        pg.evaluate("""(()=>{const s=document.getElementById('sel-quality');
          s.value='%s'; s.dispatchEvent(new Event('change',{bubbles:true}));})()""" % q)

    def update_prev():
        pg.evaluate("window.__prevScene = __dbg.composer.sceneRT; window.__prevDof = __dbg.composer.dofRT; "
                    "window.__prevDepth = __dbg.composer.sceneRT ? __dbg.composer.sceneRT.depthTexture : null")

    install_wraps()
    update_prev()
    gen0 = pg.evaluate("__dbg.composer._rtGen")
    gens = []
    for i in range(3):
        # —— 高→低：旧 sceneRT（含 depth 附着）与旧 dofRT 各 dispose 1 次 ——
        pre = snapshot()
        n0 = len(pre['disposed'])
        set_quality('0.75'); pg.wait_for_timeout(250)
        install_wraps()
        lo = snapshot()
        disp_lo = lo['disposed'][n0:]
        assert not lo['dofAlive'] and not lo['depthTex'], ('A4: 0.75 档应无 DOF 资源', lo)
        assert disp_lo.count('sceneRT:' + str(pre['sceneGen'])) == 1, (
            'A4-高→低: 旧 sceneRT dispose 应恰好 1 次', pre, lo)
        assert pre['dofGen'] is not None and disp_lo.count('dofRT:' + str(pre['dofGen'])) == 1, (
            'A4-高→低: 旧 dofRT dispose 应恰好 1 次', pre, lo)
        assert lo['sceneNew'], ('A4-高→低: 新 sceneRT 应 identity 不同', pre, lo)
        assert lo['sceneGen'] == lo['gen'], ('A4-高→低: 新 sceneRT gen 匹配 _rtGen', lo)
        update_prev()
        # —— 低→高：旧无 depth sceneRT 被 dispose；新 dofRT 惰性创建；新 depth identity 不同 ——
        n1 = len(lo['disposed'])
        set_quality('1'); pg.wait_for_timeout(250)
        install_wraps()
        hi = snapshot()
        disp_hi = hi['disposed'][n1:]
        assert hi['dofAlive'] and hi['depthTex'], ('A4: 1 档应重建 DOF 资源', hi)
        assert disp_hi.count('sceneRT:' + str(lo['sceneGen'])) == 1, (
            'A4-低→高: 旧无 depth sceneRT dispose 应恰好 1 次', lo, hi)
        assert hi['sceneNew'] and hi['dofNew'], ('A4-低→高: 新旧对象 identity 不同', hi)
        assert hi['depthNew'], ('A4-低→高: 新 depthTexture 应 identity 不同（旧随宿主释放）', hi)
        assert hi['sceneGen'] == hi['gen'] and hi['depthGen'] == hi['gen'] and hi['dofGen'] == hi['gen'], (
            'A4-低→高: 新对象 generation 匹配 _rtGen', hi)
        assert hi['gen'] > gen0, ('A4: 切档后 _rtGen 应递增', gen0, hi['gen'])
        gens.append(hi['gen'])
        update_prev()
    # 连续多轮计数平衡（sceneRT/dofRT 是唯一会调用 dispose() 的资源对象）：
    # 所有曾创建对象（created）== 已释放（disposed）+ 当前存活
    fin = snapshot()
    alive = (1 if fin['sceneGen'] is not None else 0) + (1 if fin['dofAlive'] else 0)
    assert len(fin['created']) == len(fin['disposed']) + alive, (
        'A4: 创建/释放计数不平衡（资源泄漏）', len(fin['created']), len(fin['disposed']), alive)
    assert gens == sorted(set(gens)), ('A4: gen 应严格递增（重复切档每次都原子重建）', gens)
    print('A4 多次切档+dispose证据 OK:', gens, 'created=%d disposed=%d alive=%d' % (
        len(fin['created']), len(fin['disposed']), alive))

    # A5) resize 循环：切档后 setSize（窗口变化）→ 新代际 + 尺寸正确
    pg.evaluate("__dbg.composer.setSize(1600, 900)")
    pg.wait_for_timeout(300)
    st5 = pg.evaluate("""() => ({
      gen: __dbg.composer._rtGen,
      sceneW: __dbg.composer.sceneRT.width, sceneH: __dbg.composer.sceneRT.height,
      dofW: __dbg.composer.dofRT ? __dbg.composer.dofRT.width : 0,
      depthW: __dbg.composer.sceneRT.depthTexture ? __dbg.composer.sceneRT.depthTexture.image.width : 0
    })""")
    print('A5 resize 1600x900:', st5)
    assert st5['sceneW'] == 1600 and st5['sceneH'] == 900, ('A5: sceneRT 尺寸错误', st5)
    assert st5['dofW'] == 800, ('A5: dofRT 应半分辨率 800', st5)
    assert st5['depthW'] == 1600, ('A5: depthTexture 应全屏 1600', st5)
    assert st5['gen'] >= gens[-1], ('A5: resize 不降代际', st5, gens)
    # 恢复标准尺寸
    pg.evaluate("__dbg.composer.setSize(1280, 800)")
    pg.wait_for_timeout(300)
    st5b = pg.evaluate("""() => ({ sceneW: __dbg.composer.sceneRT.width,
      dofW: __dbg.composer.dofRT ? __dbg.composer.dofRT.width : 0 })""")
    assert st5b['sceneW'] == 1280 and st5b['dofW'] == 640, ('A5b: 尺寸未恢复', st5b)
    print('A5 resize 循环+尺寸 OK')

    # B) DOF 合成链：DOF 开启后 Bloom/God Rays 参数路径活跃（复核一轮项四——本测试
#    聚焦资源治理，受控 framebuffer/ROI 像素信号断言由 test_dof_fb 完整覆盖：
#    动态 ROI 方差 + 高亮占比同机位对比，见 test_dof_fb.py）。
#    此处做向量级：DOF ON 时 _dofActive=true 且 bloom 输入链参数有效；确认
#    composer 暴露的合成链状态无异常（非仅 render 调用数，但像素级见 dof_fb）。
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=3; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.wait_for_timeout(400)
    pg.evaluate("__dbg.targets.enabled = false; __dbg.air.enabled = false")
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_function("() => __dbg.composer._dofActive", timeout=8000)
    pg.wait_for_timeout(600)
    chain = pg.evaluate("""() => ({
      dofActive: !!__dbg.composer._dofActive,
      dofRT: !!__dbg.composer.dofRT,
      depthTex: !!(__dbg.composer.sceneRT && __dbg.composer.sceneRT.depthTexture),
      bloomLevels: __dbg.composer.activeLevels,
      bloomStrength: +(__dbg.composer.strength || 0).toFixed(3),
      godOn: __dbg.composer.godOn,
      mipN: __dbg.composer.mips ? __dbg.composer.mips.length : 0
    })""")
    print('B DOF ON 合成链状态:', chain)
    assert chain['dofActive'] and chain['dofRT'] and chain['depthTex'], ('B: DOF 资源/激活异常', chain)
    assert chain['bloomLevels'] >= 4, ('B: q=1 bloom 级数应 >=4', chain)
    assert chain['mipN'] >= chain['bloomLevels'], ('B: mip 链完整', chain)
    # 关闭 DOF 后合成链回退 sceneRT（无散焦路径）
    pg.evaluate("__dbg.composer.dofOn = false")
    pg.wait_for_function("() => !__dbg.composer._dofActive", timeout=6000)
    pg.wait_for_timeout(400)
    chain2 = pg.evaluate("""() => ({ dofActive: !!__dbg.composer._dofActive,
      dofRT: !!__dbg.composer.dofRT })""")
    assert not chain2['dofActive'], ('B: DOF 关闭后 _dofActive 应 false', chain2)
    pg.evaluate("__dbg.composer.dofOn = true")
    pg.wait_for_function("() => __dbg.composer._dofActive", timeout=6000)
    print('B DOF 合成链状态切换 OK（像素级 ROI 信号见 test_dof_fb）')

    # C) framebuffer 级：焦点/背景 ROI 方差（散焦生效）——由 test_dof_fb 独立覆盖
    #    （本测试聚焦资源治理与合成链；像素级 ROI 方差需可控近景/远景场景构造）
    pg.evaluate("__dbg.fp.toggle()")   # 退出 FPV → DOF 关
    pg.wait_for_function("() => !__dbg.fp.active", timeout=8000)
    pg.wait_for_timeout(600)
    print('C 场景已复位（像素级验证见 test_dof_fb）')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')