# -*- coding: utf-8 -*-
# Phase 13-M2 景深 DOF 定向测试：
#   1) 环绕模式：composer.dof==0（不干扰既有观感）
#   2) 0.75 画质档：dofOn=false（性能档关闭整类后处理）
#   3) FPV 模式：dof>0（0.85 强度）、_dofActive=true、无锁定聚焦默认 45u（P16 验收修复：战场距离）
#   4) FPV 锁定目标：composer.focus == fp.lockD（目标清晰/背景散焦）
#   5) 退出 FPV：dof 回 0
# 值级断言走 __dbg.composer（dof/dofOn/focus/_dofActive/state）+ __dbg.fp.lockD。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def run(pg):
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    # 1) 环绕模式（默认）→ dof 关闭
    st0 = pg.evaluate("({dof: __dbg.composer.dof, on: __dbg.composer.dofOn, focus: +__dbg.composer.focus.toFixed(1)})")
    print('M2 环绕:', st0)
    assert st0['dof'] == 0 and st0['on'], ('M2: 环绕模式 dof 应为 0 且不关闭门控', st0)
    # 2) 0.75 档关闭
    pg.evaluate("""(()=>{const s=document.getElementById('sel-quality');
      s.value='0.75'; s.dispatchEvent(new Event('change',{bubbles:true}));})()""")
    pg.wait_for_timeout(400)
    on075 = pg.evaluate("({on: __dbg.composer.dofOn, active: !!__dbg.composer._dofActive})")
    assert not on075['on'] and not on075['active'], ('M2: 0.75 档未关闭 DOF', on075)
    pg.evaluate("""(()=>{const s=document.getElementById('sel-quality');
      s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true}));})()""")
    pg.wait_for_timeout(400)
    on1 = pg.evaluate("__dbg.composer.dofOn")
    assert on1, 'M2: 1 档应恢复 DOF 门控'
    print('M2 档位门控 OK: 0.75 off / 1 on')
    # 3) 进 FPV → dof 启用（无锁定聚焦 12u）。
    #    FLY.fp=true 让位：环绕悬停每帧把 FLY.alt 钉回 HOVER=14（45-flight 既有
    #    行为），自定高度需 fp 让位（既定测试模式）；地面目标固定 y=0.9，alt=3
    #    时视线俯角 ~12° 在 45° 锁定锥内（nearestAhead 几何）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=3; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.wait_for_timeout(400)
    # 最终闭环适配：先禁用靶场与空中目标，确保 FPV 无锁定（基地在机头正前方，
    # 首帧隔离修复后机头不再被 Pointer Lock 污染而保持 +Z，会锁到 42u 外基地
    # 目标——"无锁定聚焦 12u"语义需显式无目标）
    pg.evaluate("__dbg.targets.enabled = false; __dbg.air.enabled = false")
    pg.evaluate("__dbg.fp.toggle()")   # 进 FPV（与 C 键同通道）
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    # B6+：composer.dof / composer.focus 是 loop 每帧写者（70-app.js:674/676），
    # 固定睡 600ms 在负载下可能一帧未跑（分类器真候选 L44→L48/L49/L51）
    pg.wait_for_function("() => __dbg.composer.dof > 0.8 && !!__dbg.composer._dofActive", timeout=15000)
    pg.wait_for_function("() => Math.abs(__dbg.composer.focus - 45) < 0.5", timeout=15000)
    st1 = pg.evaluate("({dof: +__dbg.composer.dof.toFixed(2), active: !!__dbg.composer._dofActive, "
                      "focus: +__dbg.composer.focus.toFixed(1), lockD: __dbg.fp.lockD || 0})")
    print('M2 FPV:', st1)
    assert st1['dof'] > 0.8 and st1['active'], ('M2: FPV 未启用 DOF', st1)
    assert st1['lockD'] == 0, ('M2: 靶场禁用后不应有锁定', st1)
    # P16 验收修复：无锁定默认聚焦 12u → 45u（战场距离，35~48u 靶标环清晰）
    assert abs(st1['focus'] - 45) < 0.5, ('M2: 无锁定应聚焦默认 45u', st1)
    # 4) FPV 锁定目标 → focus 跟随 lockD（目标清晰/背景散焦）。
    #    用 targets[1]（tank 第二个，无 mov 巡逻——targets[0] 是动目标会被
    #    update 每帧拉回巡逻线，移到机头前方会被立即拖走导致锁不到）。
    #    目标位置按实际机头方向（quaternion）放到前方 10u——首帧隔离后机头
    #    保持 yaw=0，固定 (0,0,10) 本可行，按机头方向放置对任何残留更鲁棒
    pg.evaluate("""() => {
      const t = __dbg.targets.targets[1];           // 无 mov 的静止目标
      const pos = __dbg.apache.root.position;
      // 禁 THREE 构造器（IIFE 无全局）——借用 t.pos 先算机头前向再复位为目标位置
      const fwd = t.pos.set(0, 0, 1).applyQuaternion(__dbg.apache.root.quaternion);
      t.group.position.set(pos.x + fwd.x * 10, 0, pos.z + fwd.z * 10);
      t.pos.set(t.group.position.x, 0, t.group.position.z);
      t.alive = true; t.group.visible = true;
      __dbg.targets.enabled = true;
    }""")
    # B6+：fp.lockD 是 fp.update 每帧写者（46-fpview.js:418），composer.focus 同理
    # （分类器真候选 L67→L70/L71）
    pg.wait_for_function("() => (__dbg.fp.lockD || 0) > 1", timeout=15000)
    pg.wait_for_function("() => Math.abs(__dbg.composer.focus - (__dbg.fp.lockD || 0)) < 0.8", timeout=15000)
    st2 = pg.evaluate("({lockD: __dbg.fp.lockD || 0, focus: +__dbg.composer.focus.toFixed(1), dof: +__dbg.composer.dof.toFixed(2)})")
    print('M2 FPV 锁定:', st2)
    assert st2['lockD'] > 1, ('M2: FPV 未锁定到目标', st2)
    assert abs(st2['focus'] - st2['lockD']) < 0.8, ('M2: 锁定时应聚焦目标距离', st2)
    # 5) 退出 FPV → dof 回 0
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=8000)
    # B6+：等 dof 真正复位（同 ① 的写者），而非固定睡 400ms（分类器真候选 L75→L77）
    pg.wait_for_function("() => __dbg.composer.dof === 0", timeout=15000)
    dofExit = pg.evaluate("__dbg.composer.dof")
    assert dofExit == 0, ('M2: 退出 FPV 后 dof 未复位', dofExit)
    print('M2 退出复位 OK: dof =', dofExit)

    # ---- 6) 弥散圆模型（2026-09-15 用户反馈"FPV 攻击目标全模糊、只能盲狙"）----
    # 旧模型：coc = clamp((uFocus-vz)/uDoF, -1, 1)（uDoF=2.0）→ |Δ|≥2u 立刻饱和，
    #         blurPx = |coc|*12（半分辨率像素）= 全分辨率 24px ⇒ 除焦点 ±2u 外全糊。
    # 新模型：rel = |vz-uFocus|/max(uFocus,1)，k = clamp((rel-uClear)/uFade,0,1)，
    #         blurPx = k*k*uMaxBlur（uClear=0.30 / uFade=0.60 / uMaxBlur=3.5）。
    # 断言按产品公式复算（值级，不靠截图判读）。
    coc = pg.evaluate("""() => {
        const u = __dbg.composer.dofPass.mat.uniforms;
        const f = (focus, vz) => {
            const rel = Math.abs(vz - focus) / Math.max(focus, 1);
            const k = Math.min(1, Math.max(0, (rel - u.uClear.value) / Math.max(u.uFade.value, 1e-3)));
            return +(k * k * u.uMaxBlur.value).toFixed(3);
        };
        return { clear: u.uClear.value, fade: u.uFade.value, maxBlur: u.uMaxBlur.value,
                 legacyDoF: u.uDoF ? u.uDoF.value : null,
                 f45_42: f(45, 42), f45_35: f(45, 35), f45_58: f(45, 58),
                 f45_60: f(45, 60), f45_70: f(45, 70), f45_80: f(45, 80),
                 f45_90: f(45, 90), f45_200: f(45, 200),
                 f95_42: f(95, 42), f95_200: f(95, 200) };
    }""")
    print('M2 CoC 模型:', coc, flush=True)
    assert coc['legacyDoF'] is None, ('M2: 旧的 uDoF 饱和模型仍在（未替换）', coc)
    assert abs(coc['clear'] - 0.30) < 1e-6 and abs(coc['fade'] - 0.60) < 1e-6, ('M2: 清晰区/过渡带参数异常', coc)
    assert abs(coc['maxBlur'] - 3.5) < 1e-6, ('M2: 最大模糊未封顶在 3.5（半分辨率）', coc)
    # 交战距离必须完全清晰（旧模型这些点全是 24px 满糊）
    assert coc['f45_42'] == 0 and coc['f45_35'] == 0 and coc['f45_58'] == 0, ('M2: 交战距离仍有模糊', coc)
    # 锁远处目标（焦点 95u）时，基地（42u）也应几乎不糊
    assert coc['f95_42'] < 1.0, ('M2: 锁定远目标时近处目标被过度散焦', coc)
    # 明显的前后景仍要散焦（保留电影感），且随距离单调增强直至封顶
    assert coc['f45_60'] < coc['f45_70'] < coc['f45_80'] < coc['f45_90'], ('M2: 散焦未随距离单调增强', coc)
    assert coc['f45_90'] >= coc['maxBlur'] - 1e-6, ('M2: 远背景未达到封顶散焦（景深失效）', coc)
    assert coc['f45_200'] <= 3.5 + 1e-6, ('M2: 散焦超过封顶值', coc)
    print('M2 CoC 清晰区 OK: 焦点±30%% 内 0 模糊、远景封顶 %.1f（半分辨率像素）' % coc['maxBlur'])

import pw_harness as H2
H2.guarded_main(run, hard_timeout=180)
print('PASS')