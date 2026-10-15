# CI 冒烟测试：帧率无关的结构断言（软件渲染环境也能可靠通过）。
# 背景：GitHub 托管 runner 无 GPU，xvfb 有头 chromium 落到 SwiftShader 软渲染，
# 游戏时间约 1/50 实速——所有基于实时推进的断言在 CI 不可行（实测 1/21，唯一
# 通过的 test_phase0_evidence 恰好全是状态断言）。本测试只含一次性事件、数学与
# DOM 契约断言：页面引导完成 + FPV 鼠标 dx/dy 各自单次累加 + 轴间隔离
# （Phase 0-0.1 核心行为），不依赖帧率；本地门禁同样运行它作为快速结构自检。
def run(pg):
    import pw_harness as H
    import sys as _sys
    try:
        _sys.stdout.reconfigure(line_buffering=True)   # CI 日志时序=执行时序（块缓冲会把失败点伪装成别处）
    except Exception:
        pass
    # ① 引导完成：载入遮罩收起（finish() 末尾 setTimeout 260ms 才加 done 类——
    #    与 wait_for_function(__dbg) 之间存在 260ms 竞态，须显式等待该类）
    #    + __dbg 就绪（boot 是有界工作，与帧率无关）
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=120000, polling=100)   # boot 就绪：加载期主线程空闲，间隔轮询比 rAF 稳
    pg.wait_for_function("() => document.getElementById('loading').classList.contains('done')", timeout=30000, polling=100)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    # ② FPV 进入 + 鼠标水平/垂直输入各自只计算一次（纯状态断言）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.keyboard.press('KeyC')
    H.step_until(pg, "() => __dbg.fp.active === true", 5)   # enter 同步置位——游戏时间步进，与帧率/墙钟解耦
    y0 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    p0 = pg.evaluate("+__dbg.fp.vPitch.toFixed(5)")
    pg.evaluate("__dbg.fp.mouse(10, 0)")
    y1 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    p1 = pg.evaluate("+__dbg.fp.vPitch.toFixed(5)")
    assert abs((y0 - y1) - 0.040) < 0.001, ('mouse dx=10 should add yaw exactly 0.040 once', y0, y1)
    assert p0 == p1, ('dx must not touch pitch', p0, p1)
    pg.evaluate("__dbg.fp.mouse(0, 10)")
    y2 = pg.evaluate("+__dbg.fp.vYaw.toFixed(5)")
    p2 = pg.evaluate("+__dbg.fp.vPitch.toFixed(5)")
    assert y1 == y2, ('dy must not touch yaw', y1, y2)
    assert abs((p2 - p0) - 0.040) < 0.001, ('mouse dy=10 (down) should add nose-down pitch exactly 0.040 once', p0, p2)
    print('ci smoke OK: dx->yaw 0.040 once / dy->pitch 0.040 once / cross-axis isolated')
    # ③ 退出 FPV 收尾
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(400)
    assert not pg.evaluate("!!__dbg.fp.active"), 'FPV not exited'

    # ---- Phase 2-A 结构断言（帧率无关） ----
    # A1: _qCool/_qAutoOff 存在且默认值正确
    qcool = pg.evaluate("__dbg.S._qCool")
    assert qcool is not None and isinstance(qcool, (int, float)), '_qCool 未初始化'
    assert pg.evaluate("__dbg.S._qAutoOff") is False, '_qAutoOff 默认应为 false'
    # A1: 切场地后 _qCool 置正数（冷却豁免）
    pg.evaluate("__dbg.S._qCool = 0")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    # 条件由 click handler 同步置位——游戏时间步进（step_until 首查即中）。
    # CI SwiftShader 下单帧可达 10s+，任何墙钟预算都可能小于最坏帧时长。
    H.step_until(pg, "() => __dbg.S._qCool > 0", 5)
    qcool_after = pg.evaluate("__dbg.S._qCool")
    assert qcool_after > 0, ('切场地后 _qCool 应置正数', qcool_after)
    # A1: chk-qauto 取消勾选 → _qAutoOff 变 true
    pg.evaluate("document.getElementById('chk-qauto').checked = false; document.getElementById('chk-qauto').dispatchEvent(new Event('change'))")
    assert pg.evaluate("__dbg.S._qAutoOff") is True, '取消勾选后 _qAutoOff 应为 true'
    # 恢复勾选
    pg.evaluate("document.getElementById('chk-qauto').checked = true; document.getElementById('chk-qauto').dispatchEvent(new Event('change'))")
    assert pg.evaluate("__dbg.S._qAutoOff") is False, '恢复勾选后 _qAutoOff 应为 false'
    # A3: _guide 初始化（首访 localStorage 空 → _guide === 1）
    assert pg.evaluate("__dbg.S._guide") >= 0, '_guide 未初始化'
    # A6: progressbar aria 属性完整且 aria-valuenow 与 #load-fill 宽度一致
    pb = pg.evaluate("""() => {
      const el = document.getElementById('loading');
      const fill = document.getElementById('load-fill');
      return { role: el.getAttribute('role'),
               min: el.getAttribute('aria-valuemin'),
               max: el.getAttribute('aria-valuemax'),
               now: el.getAttribute('aria-valuenow'),
               fillW: fill ? fill.style.width : '' };
    }""")
    assert pb['role'] == 'progressbar', ('loading 缺 progressbar role', pb)
    assert pb['min'] == '0', ('aria-valuemin', pb)
    assert pb['max'] == '100', ('aria-valuemax', pb)
    assert pb['now'] is not None and int(pb['now']) >= 0, ('aria-valuenow', pb)
    # aria-valuenow 应与 load-fill 宽度百分比一致（全量加载后 fill=100%）
    assert int(pb['now']) == 100, ('aria-valuenow should be 100 after full load', pb['now'])
    assert '100' in pb['fillW'], ('load-fill width should be 100% after full load', pb['fillW'])
    print('ci smoke OK: A1 _qCool/_qAutoOff + A3 _guide + A6 progressbar aria + load-fill 一致')

    # ---- Phase 2-B 结构断言（帧率无关：全部同步 DOM/状态操作） ----
    # B2: 键盘切机位 → 一次性 toast 报机位名（setView/toast 均为同步操作）
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    pg.keyboard.press('2')
    H.step_until(pg, "() => document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent.includes('正侧')", 5)   # setView/toast 同步——游戏时间步进
    b2 = pg.evaluate("""(() => ({ txt: document.getElementById('toast').textContent,
                                   show: document.getElementById('toast').classList.contains('show'),
                                   view: __dbg.S.view }))()""")
    assert b2['show'] and '正侧' in b2['txt'] and b2['view'] == 1, ('B2 toast', b2)
    # B3: LABELS 已扩为三元组（节点名/显示名/解说），14 条且解说非空
    labs = pg.evaluate("(() => __dbg.LABELS.map(l => [l[0], l[1], typeof l[2] === 'string' && l[2].length > 10]))()")
    assert len(labs) == 14, ('LABELS 数量应为 14', len(labs))
    assert all(x[2] for x in labs), '每条 LABELS 应有实质解说文案'
    # B3: 解说牌点击链（DOM 同步——不依赖标签可见性/位置/帧率）
    pg.evaluate("document.getElementById('chk-labels').checked = true; document.getElementById('chk-labels').dispatchEvent(new Event('change'))")
    b3 = pg.evaluate("""(() => {
      const el = [...document.querySelectorAll('.lab')][0];
      if (!el) return { err: 'no .lab' };
      el.click();
      const info = document.getElementById('label-info');
      return { txt: el.textContent, vis: info.style.display,
               name: info.querySelector('b') ? info.querySelector('b').textContent : null,
               desc: info.querySelector('p') ? info.querySelector('p').textContent : null };
    })()""")
    assert 'err' not in b3, b3
    assert b3['vis'] == 'block' and b3['name'] == b3['txt'] and b3['desc'], ('B3 解说牌', b3)
    b3b = pg.evaluate("(() => { [...document.querySelectorAll('.lab')][0].click(); return { vis: document.getElementById('label-info').style.display }; })()")
    assert b3b['vis'] == 'none', ('B3 同标签再点应收起', b3b)
    pg.evaluate("document.getElementById('chk-labels').checked = false; document.getElementById('chk-labels').dispatchEvent(new Event('change'))")
    assert pg.evaluate("document.getElementById('label-info').style.display") == 'none', 'B3 关标签应联动隐藏解说牌'
    # B4: 导览控制按钮存在 + 暂停状态机（同步状态断言，不依赖时间推进）
    assert pg.evaluate("!!document.getElementById('tour-pause') && !!document.getElementById('tour-next')"), 'B4 按钮缺失'
    pg.evaluate("document.getElementById('btn-tour').click()")
    pg.wait_for_timeout(300)
    b4 = pg.evaluate("""(() => ({ armed: document.getElementById('btn-tour').classList.contains('on'),
                                   pv: document.getElementById('tour-pause').style.display,
                                   nv: document.getElementById('tour-next').style.display }))()""")
    assert b4['armed'] and b4['pv'] != 'none' and b4['nv'] != 'none', ('B4 启动后控制按钮应显示', b4)
    pg.evaluate("document.getElementById('tour-pause').click()")
    b4p = pg.evaluate("""(() => ({ paused: __dbg.tourState.paused,
                                    armed: document.getElementById('btn-tour').classList.contains('on'),
                                    ptxt: document.getElementById('tour-pause').textContent }))()""")
    assert b4p['paused'] is True and b4p['armed'] and b4p['ptxt'] == '▶ 继续', ('B4 暂停状态', b4p)
    pg.evaluate("document.getElementById('tour-pause').click()")
    assert pg.evaluate("!!__dbg.tourState.paused") is False, 'B4 继续应解除暂停'
    pg.evaluate("document.getElementById('tour-exit').click()")
    b4x = pg.evaluate("""(() => ({ armed: document.getElementById('btn-tour').classList.contains('on'),
                                    pv: document.getElementById('tour-pause').style.display }))()""")
    assert not b4x['armed'] and b4x['pv'] == 'none', ('B4 退出应复位控制按钮', b4x)
    print('ci smoke OK: B2 toast / B3 解说牌 / B4 tour 暂停状态机')

    # ---- Phase 3 结构断言（帧率无关：状态/数学/一次性事件） ----
    # P3-7 湖面倒影：绑定结构 + 镜像容器数学 + 水面门控双向。
    # 注意：B4 导览段会切走场地，此块必须显式切换、不依赖任何前置状态。
    r7 = pg.evaluate("""(() => { const r = __dbg.refl;
      return { bound: !!(r && r._pairs && r._pairs.length > 0),
               sy: r.group.scale.y, gy: r.group.position.y, py: r.planeY }; })()""")
    assert r7['bound'], ('P3-7 倒影未绑定', r7)
    assert r7['sy'] == -1 and abs(r7['gy'] - 2 * r7['py']) < 1e-9, ('P3-7 镜像容器变换', r7)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(200)
    r7w = pg.evaluate("({ en: __dbg.refl.enabled, vis: __dbg.refl.group.visible })")
    assert r7w['en'] and r7w['vis'], ('P3-7 water 场地应启用倒影', r7w)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    pg.wait_for_timeout(200)
    r7b = pg.evaluate("({ en: __dbg.refl.enabled, vis: __dbg.refl.group.visible })")
    assert r7b['en'] is False and r7b['vis'] is False, ('P3-7 切离 water 应关闭并隐藏倒影', r7b)
    print('ci smoke OK: P3-7 倒影绑定/门控/镜像数学/切场清理')
    # P3-8 统一风向：风状态存在 + 粒子/贴花接线共享同一方向（帧率无关：
    # 只读同帧状态与 uniform，不做实时推进等待）
    w8 = pg.evaluate("""(() => { const w = __dbg.washfx;
      const partsOK = Math.abs(w.parts.uniforms.uWind.value.x - w.windX) < 1e-6
                    && Math.abs(w.parts.uniforms.uWind.value.y - w.windZ) < 1e-6;
      const decalOK = Math.abs(w.decal.uniforms.uWind.value.x - w.windX) < 1e-6
                    && Math.abs(w.decal.uniforms.uWind.value.y + w.windZ) < 1e-6;
      return { has: typeof w.windX === 'number' && typeof w.windZ === 'number',
               partsOK, decalOK }; })()""")
    assert w8['has'], ('P3-8 风状态未暴露', w8)
    assert w8['partsOK'], ('P3-8 下洗粒子 uWind 未接风向', w8)
    assert w8['decalOK'], ('P3-8 贴花 uWind 未接盘面局部风向', w8)
    print('ci smoke OK: P3-8 风状态/粒子贴花方向共享')
    # P3-9 沙漠痕迹：合成步进驱动 累积 → 衰减 → 切场清除（全程不依赖帧率推进；
    # ci_smoke 的悬停在 alt 14，真实下洗强度恒 0，合成参数是唯一驱动源）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(200)
    t9a = pg.evaluate("(() => ({ s: __dbg.washfx.tracks.stamps, v: __dbg.washfx.tracks.mesh.visible }))()")
    assert t9a['s'] == 0 and t9a['v'] is True, ('P3-9 进入沙漠应清零并显示', t9a)
    for _ in range(24):
        pg.evaluate("__dbg.washfx.update(0.2, 1, 2, 0, 0, __dbg.S.time)")
    t9b = pg.evaluate("(() => ({ s: __dbg.washfx.tracks.stamps }))()")
    assert t9b['s'] >= 5, ('P3-9 合成步进应累积痕迹', t9b)
    # 衰减：封住累积门后慢消退，alpha 总量下降但远未清空
    pg.evaluate("__dbg.washfx.tracks._acc = 2.0")
    a9_0 = pg.evaluate("(() => { const t = __dbg.washfx.tracks; const d = t.cx.getImageData(0,0,t.N,t.N).data;"
                       " let s=0; for (let i=3;i<d.length;i+=64) s+=d[i]; return s; })()")
    for _ in range(12):
        pg.evaluate("__dbg.washfx.tracks.update(3.05)")
    a9_1 = pg.evaluate("(() => { const t = __dbg.washfx.tracks; const d = t.cx.getImageData(0,0,t.N,t.N).data;"
                       " let s=0; for (let i=3;i<d.length;i+=64) s+=d[i]; return s; })()")
    assert a9_0 * 0.35 < a9_1 < a9_0 * 0.85, ('P3-9 痕迹应缓慢消退（0.98^12≈0.78）', a9_0, a9_1)
    pg.evaluate("__dbg.washfx.strength = 0")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    t9c = pg.evaluate("(() => ({ s: __dbg.washfx.tracks.stamps, v: __dbg.washfx.tracks.mesh.visible }))()")
    assert t9c['s'] == 0 and t9c['v'] is False, ('P3-9 切离沙漠应清零并隐藏', t9c)
    print('ci smoke OK: P3-9 痕迹累积/衰减/清除')

    # ---- P4-A 结构断言（帧率无关：DOM/遥测/初始零态；无触控推进） ----
    # ② 段的 KeyC 进出 FPV 会把 userAlt 同步为退出时高度——先复位再断言零态
    pg.evaluate("__dbg.FLY.userAlt = null")
    m4 = pg.evaluate("""(() => { const t = __dbg.mobile ? __dbg.mobile.state() : null;
      return { has: !!__dbg.mobile, ua: __dbg.FLY.userAlt,
               zero: !!(t && t.l.on.length === 0 && t.r.on.length === 0 && t.l.x === 0 && t.r.x === 0),
               dom: !!document.getElementById('mstick-l') && !!document.getElementById('mstick-rk'),
               disp: getComputedStyle(document.getElementById('mstick')).display,
               fpMode: document.body.classList.contains('fp-mode'),
               a11y: !!(document.getElementById('mstick-l').getAttribute('aria-label') &&
                        document.getElementById('mstick-r').tabIndex === 0) } })()""")
    assert m4['has'], ('P4-A 遥测 __dbg.mobile 未挂载', m4)
    assert m4['dom'] and m4['a11y'], ('P4-A 摇杆 DOM/无障碍属性缺失', m4)
    assert m4['ua'] is None and m4['zero'], ('P4-A 初始应零态且未接管高度', m4)
    assert m4['disp'] == 'none' and not m4['fpMode'], ('P4-A 桌面/非 FPV 下摇杆应隐藏', m4)
    print('ci smoke OK: P4-A 摇杆遥测/DOM/a11y/初始零态/桌面隐藏')

    # ---- P4-B 结构断言（帧率无关：DOM 契约 / 状态机暴露 / 桌面不隐藏；无触控无推进） ----
    bpb = pg.evaluate("() => { const m=document.getElementById('mission'); const r=document.getElementById('btn-rescue'); const st=['idle','deploying','holding','lifting','aboard','delivered','retracting']; return { m: !!m, mRole: m && m.getAttribute('role'), mLabel: m && m.getAttribute('aria-label'), title: !!document.getElementById('mission-title'), body: !!document.getElementById('mission-body'), pe: m ? getComputedStyle(m).pointerEvents : null, chip: !!r, chipRole: r && r.getAttribute('role'), chipText: r && r.textContent.trim(), rescueState: __dbg.rescue ? __dbg.rescue.state : null, stateValid: __dbg.rescue ? st.indexOf(__dbg.rescue.state) >= 0 : null, mission: __dbg.S._mission, disp: m ? getComputedStyle(m).display : null }; }")
    assert bpb['m'] and bpb['mRole'] == 'region' and bpb['mLabel'] == '任务面板', ('P4-B 任务面板结构', bpb)
    assert bpb['title'] and bpb['body'], ('P4-B mission-title/body 缺失', bpb)
    assert bpb['pe'] == 'none', ('P4-B 任务面板应 pointer-events:none（不拦画布触控）', bpb)
    assert bpb['chip'] and bpb['chipRole'] == 'button' and '绞车' in (bpb['chipText'] or ''), ('P4-B 救援触控芯片/a11y', bpb)
    assert bpb['stateValid'], ('P4-B rescue.state 越界', bpb)
    assert bpb['mission'] is None, ('P4-B 初始 _mission 应为空', bpb)
    assert bpb['disp'] != 'none', ('P4-B 桌面任务面板不应被隐藏（>820px 与面板共存）', bpb)
    print('ci smoke OK: P4-B 任务/救援 DOM 契约 + 桌面共存')

    # ---- P5-A 结构断言（帧率无关：手动步进/一次性切换事件；无实时推进等待） ----
    # P5-A(A)：手动步进 flyUpdate——各状态切换 pitch 单步变化有界（无硬切换），
    #          且每步 comp == pitch/GROUND_PITCH*GROUND_PITCH_COMP（派生关系逐点成立）
    pa = pg.evaluate("""(() => { const F = __dbg.FLY; const out = [];
      F.state = 'ground'; F.pitch = 0; F.alt = 0;
      for (let i = 0; i < 10; i++) { __dbg.flyUpdate(0.05); out.push(F.pitch); }
      const maxG = Math.max(...out.slice(1).map((v, i) => Math.abs(v - out[i])));
      F.state = 'up'; F.alt = 0.1;
      const up = [];
      for (let i = 0; i < 6; i++) { __dbg.flyUpdate(0.05); up.push(F.pitch); }
      const maxU = Math.max(...up.slice(1).map((v, i) => Math.abs(v - up[i])));
      let compOK = true;
      for (let i = 0; i < 20; i++) { __dbg.flyUpdate(0.05);
        const e = Math.abs(F.comp - (F.pitch / -0.1107) * -0.2444);
        if (e > 0.002) { compOK = false; break; } }
      F.state = 'ground'; F.alt = 0; F.pitch = -0.1107; F.fp = false; F.userAlt = null;
      __dbg.flyUpdate(0.05);
      return { maxG, maxU, compOK,
               bound: maxG <= 0.05 && maxU <= 0.05 }; })()""")
    assert pa['bound'], ('P5-A(A): 手动步进 pitch 单步变化越界（硬切换回归）', pa)
    assert pa['compOK'], ('P5-A(A): comp 派生关系破坏', pa)
    print('ci smoke OK: P5-A(A) flyUpdate 手动步进——状态切换 pitch 连续 + comp 派生逐点成立')

    # P5-A(D)：desert fog 色随 day/night 预设变化且密度恒定 + fogBase 同步 + duneFar 色变
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(200)
    fd = pg.evaluate("(() => { const W = __dbg.W; return { fogC: W.scene.fog.color.getHex(),"
                      " baseD: +W.fogBase.d.toFixed(5), baseC: W.fogBase.c,"
                      " duneR: +W.duneFar.material.color.r.toFixed(4) }; })()")
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.wait_for_timeout(200)
    fn = pg.evaluate("(() => { const W = __dbg.W; return { fogC: W.scene.fog.color.getHex(),"
                     " baseD: +W.fogBase.d.toFixed(5), baseC: W.fogBase.c,"
                     " duneR: +W.duneFar.material.color.r.toFixed(4) }; })()")
    assert fd['fogC'] != fn['fogC'], ('P5-A(D): desert fog 色未随预设变化', fd, fn)
    # 密度真源 fogBase.d（本测试前段 FPV 段开过引擎，brownout 在 scene.fog.density 合法叠加）
    assert abs(fd['baseD'] - 0.0034) < 1e-6 and abs(fn['baseD'] - 0.0034) < 1e-6, ('P5-A(D): 场地雾密度被改变', fd, fn)
    assert fd['baseC'] == fd['fogC'] and fn['baseC'] == fn['fogC'], ('P5-A(D): fogBase 漂移', fd, fn)
    assert abs(fd['duneR'] - 0.4657) < 0.01 and abs(fn['duneR'] - 0.2301) < 0.01, ('P5-B(D): duneFar 色未随预设', fd, fn)
    print('ci smoke OK: P5-B(D) desert fog/duneFar 随预设协调 + 密度恒定 + fogBase 同步')

    # P5-B(C)：机体 envMapIntensity 随预设（day=1.0 / night≈0.312）+ 重复切换不累积
    ec = pg.evaluate("(() => +__dbg.apache.mats.get('USMC_LowVis_Body')[0].envMapIntensity.toFixed(4))()")
    assert abs(ec - 0.312) < 0.001, ('P5-B(C): night envI 应 ≈0.312', ec)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(200)
    ec2 = pg.evaluate("(() => +__dbg.apache.mats.get('USMC_LowVis_Body')[0].envMapIntensity.toFixed(6))()")
    assert abs(ec2 - 1.0) < 1e-6, ('P5-B(C): 重复切换应回到 1.0 不累积', ec2)
    print('ci smoke OK: P5-B(C) envMapIntensity 随预设 + 零累积')

    # ---- P5-C：场地切换武器视觉清理（帧率无关：切前发射 2 弹 → 切后检查池计数） ----
    # 前置：沙漠 + 悬停 + 发射 2 枚火箭制造活跃弹体
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("""(() => { const F = __dbg.FLY; F.state='hover'; F.alt=14; __dbg.S._alt=0;
      F.x=0; F.z=0; F.yaw=0; F.pitch=0; __dbg.S.running=true; __dbg.S.spin=1; })()""")
    pg.wait_for_timeout(250)
    pg.evaluate("__dbg.rig.launchRocket(); __dbg.rig.launchRocket()")
    pg.wait_for_timeout(120)
    n_before = pg.evaluate("(() => ({ r: __dbg.rig.rockets.filter(x=>x.g.visible).length,"
                           " t: __dbg.rig.tracers.filter(x=>x.m.visible).length,"
                           " f: __dbg.rig.flying.length }))()")
    assert n_before['r'] >= 1, ('P5-C: 前置失败——火箭未发射', n_before)
    # 切湖面：飞行中弹体必须全部清理（不横跨进入新场地）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(350)
    n_after = pg.evaluate("(() => ({ r: __dbg.rig.rockets.filter(x=>x.g.visible).length,"
                          " t: __dbg.rig.tracers.filter(x=>x.m.visible).length,"
                          " f: __dbg.rig.flying.length,"
                          " terr: __dbg.W.terrainKey, en: __dbg.targets.enabled }))()")
    assert n_after['terr'] == 'water' and n_after['en'] is False, ('P5-C: 湖面切换失败', n_after)
    assert n_after['r'] == 0 and n_after['t'] == 0 and n_after['f'] == 0, ('P5-C: 切场后武器弹体残留', n_before, n_after)
    # 湖面靶场禁用时残骸燃烧不应冒烟（制造残骸 → 手动驱动 update → puffs 不新增）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(250)
    wreck_ok = pg.evaluate("""(() => { const ts = __dbg.targets.targets; const t = ts.find(x=>x.alive);
      if (!t) return false; __dbg.targets.destroy(t, 2); return true; })()""")
    assert wreck_ok, 'P5-C: 无靶标可毁（前置失败）'
    smoke0 = pg.evaluate("__dbg.rig.puffs.filter(p=>p.m.visible).length")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(300)
    pg.evaluate("(() => { try { __dbg.targets.update(0.24, __dbg.apache.root.position); } catch(e){} })()")
    pg.evaluate("(() => { try { __dbg.targets.update(0.24, __dbg.apache.root.position); } catch(e){} })()")
    pg.wait_for_timeout(200)
    smoke1 = pg.evaluate("__dbg.rig.puffs.filter(p=>p.m.visible).length")
    assert smoke1 <= smoke0 + 1, ('P5-C: 湖面禁用下残骸冒烟残留', smoke0, smoke1)
    # 清理不破坏复用池：切回沙漠仍可发射
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(300)
    ok = pg.evaluate("(() => { __dbg.rig.rocketAmmo = 38; return __dbg.rig.launchRocket() === true; })()")
    assert ok, 'P5-C: 清理后火箭无法再发射（复用池破坏）'
    print('ci smoke OK: P5-C 切场武器/残骸清理 + 复用池可用')

    # ---- P5-D：交互入口一致性（帧率无关：合成事件+数值谓词） ----
    # D1: repeat 空格不得反复启停（长按自动重复只应维持首次效果）
    pg.evaluate("__dbg.S.running = false;")
    pg.wait_for_timeout(150)
    pg.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))")
    pg.wait_for_timeout(120)
    assert pg.evaluate("__dbg.S.running") is True, 'P5-D(D1): 首空格应启旋翼'
    flipped = pg.evaluate("""(() => { const s=[]; for(let i=0;i<5;i++){ s.push(__dbg.S.running);
      window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,repeat:true}));}
      return s; })()""")
    assert pg.evaluate("__dbg.S.running") is True, ('P5-D(D1): repeat 空格翻转启停', flipped)
    # D2: 湖面(禁用)键盘 B 重置后靶标保持隐藏（syncTargetsVis 语义与按钮一致）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(400)
    st = pg.evaluate("(() => ({ en: __dbg.targets.enabled,"
                     " vis: __dbg.targets.targets.filter(t=>t.group.visible).length }))()")
    assert st['en'] is False and st['vis'] == 0, ('P5-D(D2): 湖面前置应禁用全隐', st)
    pg.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',bubbles:true}))")
    pg.wait_for_timeout(250)
    st2 = pg.evaluate("__dbg.targets.targets.filter(t=>t.group.visible).length")
    assert st2 == 0, ('P5-D(D2): 湖面键盘 B 后靶标浮水', st2)
    # D3: visibilitychange(hidden) 释放扳机（与 76-mobile 同语义）
    # 原子性要求（2026-09-09 修）：置扳机与派发释放必须在**同一个 JS 任务**内完成。
    # 若拆成两次 pg.evaluate，中间会插入渲染帧——mounted（机炮可见）为真时
    # 65-weapons 的连发逻辑会击发 1 发，使后续 P6-M3 的 gun0 断言偶发 1199
    # （既有测试侧竞态，与产品代码无关）。dispatchEvent 同步执行 handler，
    # 因此合并后 releaseTriggers() 在同一任务内即完成，帧无法插队。
    pg.evaluate("""(() => {
      __dbg.rig.gunOn = true; __dbg.rig.rocketOn = true;
      const d = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
      window.__hd = d;
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    })()""")
    pg.wait_for_timeout(200)
    tr = pg.evaluate("(() => ({ g: __dbg.rig.gunOn, r: __dbg.rig.rocketOn }))()")
    assert tr['g'] is False and tr['r'] is False, ('P5-D(D3): visibilitychange 未释放扳机', tr)
    pg.evaluate("(() => { if (window.__hd) Object.defineProperty(document,'hidden',window.__hd); })()")
    print('ci smoke OK: P5-D 入口一致性（repeat 守卫 / 湖面键盘 B / 后台释放扳机）')

    # ---- P6：任务模式状态机（帧率无关：合成事件+数值谓词+状态源比对） ----
    # P6-M1: 三模式切换，show 模式零任务状态
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_timeout(200)
    assert pg.evaluate("__dbg.S.mode") == 'show' and pg.evaluate("__dbg.mission") is None, 'P6(M1): show 应无任务状态'
    # P6-M2: 任务模式 startMission → briefing（含完成/失败条件文案）
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.evaluate("__dbg.startMission()")
    H.step_until(pg, "() => __dbg.mission && __dbg.mission.phase === 'briefing' && document.getElementById('mission').classList.contains('show')", 5)   # B3：同步链条件等待
    m2 = pg.evaluate("() => { const mp=document.getElementById('mission');"
                     " return { phase: __dbg.mission && __dbg.mission.phase,"
                     " show: mp.classList.contains('show'), body: mp.innerHTML }; }")
    assert m2['phase'] == 'briefing' and m2['show'] and '完成条件' in m2['body'] and '失败条件' in m2['body'], ('P6(M2): 简报', m2)
    # P6-M3: briefing→active（beginMission 记录 t0/gun0）
    pg.evaluate("__dbg.beginMission()")
    H.step_until(pg, "() => __dbg.mission.phase === 'active' && __dbg.mission.t0 !== null", 5)
    m3 = pg.evaluate("() => ({ phase: __dbg.mission.phase, t0: __dbg.mission.t0,"
                     " g0: __dbg.mission.gun0, hits: __dbg.mission.hits })")
    assert m3['phase'] == 'active' and m3['t0'] is not None and m3['g0'] == 1200 and m3['hits'] == 0, ('P6(M3): active', m3)
    # P6-M5: done 冻结——全歼后 updateMissionPanel 不再改写
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("__dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t,3); })")
    # loop 0.5s 游戏节流判定。CI SwiftShader 下主循环 dt 钳制 0.05（70-loop.js），
    # 游戏时间仅实速 1/10~1/50，墙钟等待物理不可达——改游戏时间步进（batch-E 范式，
    # 与 test_challenge_variants/test_resources 一致），断言语义不变。
    H.step_until(pg, "() => __dbg.mission.phase === 'done' && __dbg.mission.frozen", 15)
    st = pg.evaluate("() => ({ phase: __dbg.mission.phase, frozen: __dbg.mission.frozen })")
    assert st['phase'] == 'done' and st['frozen'], ('P6(M5): done 冻结', st)
    body0 = pg.evaluate("document.getElementById('mission-body').innerHTML")
    pg.evaluate("__dbg.updateMissionPanel()")   # 同步调用，frozen 门控下立即返回——无需固定窗
    body1 = pg.evaluate("document.getElementById('mission-body').innerHTML")
    assert body0 == body1, 'P6(M5): 冻结后面板被改写'
    # P6-M6: retry → briefing + 全清（air 复活/武器瞬态清/救援 idle）
    pg.evaluate("__dbg.retryMission()")
    H.step_until(pg, "() => __dbg.mission.phase === 'briefing'", 5)
    m6 = pg.evaluate("() => ({ phase: __dbg.mission.phase, airDead: __dbg.air.list.filter(t=>!t.alive).length,"
                     " rockets: __dbg.rig.rockets.filter(r=>r.g.visible).length, rstate: __dbg.rescue.state })")
    assert m6['phase'] == 'briefing' and m6['airDead'] == 0 and m6['rockets'] == 0 and m6['rstate'] == 'idle', ('P6(M6): retry 清理', m6)
    # P6-M8: show 模式接近基地不触发（模式边界）
    # （2026-10-15 P4f：接近点随基地 20→53——原先 z=20 在基地北移后已不在接近圈内，
    #  负断言会 vacuous pass，同步后才是真断言）
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.S._mission = null; __dbg.S._baseFound = false")
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=53; __dbg.S._alt=0")
    pg.wait_for_timeout(1200)
    assert pg.evaluate("__dbg.mission") is None, 'P6(M8): show 模式接近不应触发任务'
    # P6 修复批-M9: 任务 active 切 show → 统一清理（S._mission=null/_baseFound=false/面板隐藏）
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.evaluate("__dbg.startMission()")
    H.step_until(pg, "() => __dbg.mission && __dbg.mission.phase === 'briefing'", 5)
    pg.evaluate("__dbg.beginMission()")
    H.step_until(pg, "() => __dbg.mission.phase === 'active'", 5)
    assert pg.evaluate("__dbg.mission.phase") == 'active', 'P6(M9): 前置 active'
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    H.step_until(pg, "() => __dbg.mission === null && __dbg.S._baseFound === false", 5)
    m9 = pg.evaluate("(() => ({ m: __dbg.mission, found: __dbg.S._baseFound,"
                     " show: document.getElementById('mission').classList.contains('show') }))()")
    assert m9['m'] is None and m9['found'] is False and not m9['show'], ('P6(M9): 切 show 未统一清理', m9)
    # 切回 mission 不自动重建（须由开始任务入口）
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.evaluate("(() => { const t0c = Date.now(); while (Date.now() - t0c < 50); })()")   # 同步让出一拍（模式事件落定）
    assert pg.evaluate("__dbg.mission") is None, 'P6(M9): 切回 mission 不应自动重建旧任务'
    # P6 修复批-M10: 从 water 启动任务 → 立即 desert + rescue 就绪（不依赖下帧）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.evaluate("__dbg.startMission()")
    H.step_until(pg, "() => __dbg.W.terrainKey === 'desert' && __dbg.mission.phase === 'briefing'", 5)
    m10 = pg.evaluate("(() => ({ terr: __dbg.W.terrainKey, ok: __dbg.rescue.ok,"
                      " rstate: __dbg.rescue.state, gvis: __dbg.rescue.g.visible }))()")
    assert m10['terr'] == 'desert' and m10['ok'] and m10['rstate'] == 'idle' and m10['gvis'], ('P6(M10): water 启动未就绪', m10)
    print('ci smoke OK: P6 修复批（切 show 统一清理 + 切回不重建 + water 启动即 desert/rescue 就绪）')

    # ---- P7：飞行战术决策（帧率无关：合成状态+数值谓词） ----
    # P7-1: 环绕静止 stability=1；方向键平移 stability=0.7；松键恢复 1
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"show\"]').click()")
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=0;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    H.step_until(pg, "() => __dbg.S._stability === 1", 15)   # 帧派生——游戏时间步进
    assert pg.evaluate("__dbg.S._stability") == 1, 'P7-1: 环绕静止 stability 应为 1'
    pg.evaluate("__dbg.keys['arrowleft'] = true")
    H.step_until(pg, "() => __dbg.S._stability === 0.7", 15)
    assert pg.evaluate("__dbg.S._stability") == 0.7, 'P7-1: 环绕平移 stability 应为 0.7'
    pg.evaluate("__dbg.keys['arrowleft'] = false")
    H.step_until(pg, "() => __dbg.S._stability === 1", 15)
    assert pg.evaluate("__dbg.S._stability") == 1, 'P7-1: 松键恢复 1'
    # P7-2: FPV 高速稳定性显著下降 + 恢复（无跨轴泄漏）
    pg.evaluate("__dbg.fp.enter()")
    H.step_until(pg, "() => __dbg.S._stability > 0.9", 15)
    assert pg.evaluate("__dbg.S._stability") > 0.9, 'P7-2: FPV 静止 stability 应接近 1'
    # B3：按到达标才松键（keys 直写键表——固定 900ms 低帧下加速不达标）
    pg.evaluate("__dbg.keys['w'] = true")
    H.step_until(pg, "() => __dbg.S._stability < 0.75", 15)
    pg.evaluate("__dbg.keys['w'] = false")
    stab_lo = pg.evaluate("__dbg.S._stability")
    assert stab_lo < 0.75, ('P7-2: FPV 高速 stability 应显著下降', stab_lo)
    H.step_until(pg, "() => __dbg.fp.spd < 0.5 && __dbg.S._stability > 0.9", 15)
    # P7-3: 救援速度窗口——低速部署 / 高速拒绝 / 恢复部署（速度源 loop 派生）
    pg.evaluate("__dbg.FLY.alt=8; __dbg.FLY.x=26; __dbg.FLY.z=-14; __dbg.S._alt=8")
    H.step_until(pg, "() => __dbg.rescue.speed < 0.5", 15)
    pg.keyboard.press('KeyK')
    H.step_until(pg, "() => __dbg.rescue.state === 'deploying'", 15)
    assert pg.evaluate("__dbg.rescue.state") == 'deploying', 'P7-3: 低速应可部署'
    pg.keyboard.press('KeyK')
    H.step_until(pg, "() => __dbg.rescue.state === 'idle'", 15)
    assert pg.evaluate("__dbg.rescue.state") == 'idle', 'P7-3: 收回应 idle'
    # B3：按到达标才松键（固定 900ms 低帧下 speed 爬不到 3）
    pg.evaluate("__dbg.keys['w'] = true")
    H.step_until(pg, "() => __dbg.rescue.speed > 3", 15)
    pg.evaluate("__dbg.keys['w'] = false")
    assert pg.evaluate("__dbg.rescue.speed") > 3, 'P7-3: 前置——高速 speed>3'
    pg.evaluate("document.getElementById('toast').textContent = ''")
    pg.keyboard.press('KeyK')
    H.step_until(pg, "() => __dbg.rescue.state === 'idle'", 15)
    st3 = pg.evaluate("({st:__dbg.rescue.state, toast:document.getElementById('toast').textContent})")
    assert st3['st'] == 'idle' and '绞车' in st3['toast'], ('P7-3: 高速应拒绝并提示', st3)
    H.step_until(pg, "() => __dbg.rescue.speed < 3", 15)
    pg.keyboard.press('KeyK')
    H.step_until(pg, "() => __dbg.rescue.state === 'deploying'", 15)
    assert pg.evaluate("__dbg.rescue.state") == 'deploying', 'P7-3: 恢复低速应可再部署'
    pg.keyboard.press('KeyK')
    pg.wait_for_timeout(400)
    pg.evaluate("__dbg.fp.exit()")
    pg.wait_for_timeout(200)
    print('ci smoke OK: P7 飞行战术（稳定度派生/散布放大/救援低速窗口阈值两侧+恢复）')

    # ---- P8：威胁/受损/归因（帧率无关：合成状态+数值谓词） ----
    # P8-1: 威胁派生——地面 0、悬停反击区 ≥1、受击 3、解除 0
    pg.evaluate("document.querySelector('#mode-row [data-mode=\"mission\"]').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_timeout(250)
    pg.evaluate("__dbg.beginMission()")
    H.step_until(pg, "() => __dbg.targets._threat === 0", 2)
    assert pg.evaluate("__dbg.targets._threat") == 0, 'P8-1: 地面停放威胁应 0'
    pg.evaluate("""(() => { const F=__dbg.FLY; F.state='hover'; F.alt=14; F.x=0; F.z=33;
      F.yaw=0; F.pitch=0; F.roll=0; F.comp=0; __dbg.S._alt=0; __dbg.S.running=true; })()""")
    # 条件等待替代固定 500ms（2026-09-09 修）：同 M6/D6，威胁派生依赖任务推进
    # （loop 逐帧派生——CI 慢帧下改游戏时间步进，与机器帧率解耦）
    H.step_until(pg, "() => __dbg.targets._threat >= 1", 8)
    assert pg.evaluate("__dbg.targets._threat") >= 1, 'P8-1: 悬停反击区威胁应 ≥1'
    pg.evaluate("__dbg.targets._threatHitFlash = 3")
    H.step_until(pg, "() => __dbg.targets._threat === 3", 2)
    assert pg.evaluate("__dbg.targets._threat") == 3, 'P8-1: 受击威胁应 3'
    pg.evaluate("__dbg.FLY.alt=0; __dbg.FLY.state='ground'; __dbg.S._alt=0; __dbg.targets._threatHitFlash=0")
    H.step_until(pg, "() => __dbg.targets._threat === 0", 2)
    assert pg.evaluate("__dbg.targets._threat") == 0, 'P8-1: 解除应 0'
    # P8-2: 受损惩罚派生（onHeliHit→_dmgPenalty）+ 散布公式叠加
    pg.evaluate("__dbg.rig._dmgPenalty = 0")
    pg.evaluate("__dbg.targets.onHeliHit(5, null)")
    pg.wait_for_timeout(200)
    assert abs(pg.evaluate("__dbg.rig._dmgPenalty") - 0.3) < 1e-6, 'P8-2: onHeliHit 应派生 0.3'
    # P8-3: 损伤≥12 → failed(damage) 归因（状态源一致）
    pg.evaluate("__dbg.targets._heliDmg = 12")
    # loop 0.5s 游戏节流判失败——墙钟固定窗在 CI 慢帧下跑不完节流，改游戏时间步进
    H.step_until(pg, "() => __dbg.mission.phase === 'failed' && __dbg.mission.failedReason === 'damage'", 10)
    m8 = pg.evaluate("(() => ({ phase: __dbg.mission.phase, reason: __dbg.mission.failedReason }))()")
    assert m8['phase'] == 'failed' and m8['reason'] == 'damage', ('P8-3: 损伤≥12 失败归因', m8)
    # P8-4: 重试清理（受损/威胁/惩罚）
    pg.evaluate("__dbg.retryMission()")
    pg.wait_for_timeout(300)
    c8 = pg.evaluate("(() => ({ dmg: __dbg.targets._heliDmg, threat: __dbg.targets._threat,"
                     " penalty: __dbg.rig._dmgPenalty }))()")
    assert c8['dmg'] == 0 and c8['threat'] == 0 and c8['penalty'] == 0, ('P8-4: 重试未清威胁状态', c8)
    print('ci smoke OK: P8 威胁/受损/归因（派生+升级+解除+失败归因+重试清理）')

    # ---- P9：材质精修（帧率无关：visualTokens 只读诊断值 + 环境联动公式） ----
    # P9-1: 材质 token 生效（glass 高反射/body 哑光/missile 金属/exhaust 热端）
    vt = pg.evaluate("__dbg.apache.visualTokens()")
    assert vt['glass']['rough'] == 0.14 and vt['body']['rough'] == 0.70, ('P9-1: 材质 token 生效', vt)
    assert vt['missile']['metal'] == 0.2 and vt['exhaust']['rough'] == 0.35, ('P9-1: 弹体金属/热端', vt)
    # P9-2: 环境联动——glass envI = v × 2.4（P5-A 公式 v=clamp(0.12+hemi×1.6)），body 1× 不变
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(250)
    d = pg.evaluate("(() => ({ glass: __dbg.apache.mats.get('USMC_LowVis_Glass')[0].envMapIntensity,"
                    " body: __dbg.apache.mats.get('USMC_LowVis_Body')[0].envMapIntensity }))()")
    assert abs(d['glass'] - 2.4) < 1e-3 and abs(d['body'] - 1.0) < 1e-3, ('P9-2: 白天 glass 2.4/body 1', d)
    pg.evaluate("document.querySelector('#env-row [data-env=\"night\"]').click()")
    pg.wait_for_timeout(250)
    n = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Glass')[0].envMapIntensity")
    assert abs(n - 0.312 * 2.4) < 1e-2, ('P9-2: 夜间 glass 联动', n)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(250)
    # P9-3: 涂装切换保留 P9 值（army→lowvis 恢复后 body r 仍 0.70）
    pg.evaluate("document.querySelector('#scheme-row [data-scheme=\"army\"]').click()")
    pg.wait_for_timeout(250)
    pg.evaluate("document.querySelector('#scheme-row [data-scheme=\"lowvis\"]').click()")
    pg.wait_for_timeout(250)
    r = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Body')[0].roughness")
    assert abs(r - 0.70) < 1e-3, ('P9-3: lowvis 恢复后 roughness 应保留 0.70', r)
    print('ci smoke OK: P9 材质精修（token 生效/环境联动/涂装保留）')

    # ---- P9 补强批：机身材质可见细节（帧率无关：只读诊断 + 同步贴图状态） ----
    # R1: detail 诊断（开关/合成数/尺寸/画布哈希 16 位）——一次性生成期事实，与帧率无关
    dr = pg.evaluate("__dbg.apache.visualTokens().detail")
    assert dr['enabled'] is True and dr['skins'] >= 1 and dr['skinSize'] == 2048, ('R1: detail 诊断', dr)
    assert dr['exhaust'] is True and dr['lens'] is True, ('R1: 积碳/镜片贴图应应用', dr)
    assert len(dr['hash']) == 16 and dr['hash'] != '0' * 16, ('R1: 画布哈希', dr)
    # R2: 材质接线（Body 2048 细节 map / Exhaust 积碳+提亮 / lens 镜片 / Glass 无贴图）
    rw = pg.evaluate("""(() => { const get=n=>{const l=__dbg.apache.mats.get(n); return l&&l[0]?l[0]:null;};
      const b=get('USMC_LowVis_Body'), ex=get('USMC_LowVis_Exhaust'), g=get('USMC_LowVis_Glass');
      return { bm: b&&b.map?b.map.image.width:0, exm: !!(ex&&ex.map),
               exc: ex?+ex.color.r.toFixed(2):0, gm: !!(g&&g.map) }; })()""")
    assert rw['bm'] == 2048 and rw['exm'] and rw['exc'] > 0.10 and rw['gm'] is False, ('R2: 材质接线', rw)
    # R3: 涂装切换保留细节（army→lowvis 恢复后 Body 细节贴图仍在）——既有 R 段已切回 lowvis
    r3 = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Body')[0].map ? __dbg.apache.mats.get('USMC_LowVis_Body')[0].map.image.width : 0")
    assert r3 == 2048, ('R3: 涂装切换细节保留', r3)
    # R4: 四地形切换后细节不丢 + 环境切换后哈希不变
    h0 = pg.evaluate("__dbg.apache.visualTokens().detail.hash")
    for terr in ['pad', 'grass', 'water', 'desert']:
        pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"%s\"]').click()" % terr)
        pg.wait_for_timeout(250)
        w = pg.evaluate("__dbg.apache.mats.get('USMC_LowVis_Body')[0].map ? __dbg.apache.mats.get('USMC_LowVis_Body')[0].map.image.width : 0")
        assert w == 2048, ('R4: %s 切场细节丢失' % terr, w)
    for env in ['night', 'day']:
        pg.evaluate("document.querySelector('#env-row [data-env=\"%s\"]').click()" % env)
        pg.wait_for_timeout(250)
        h = pg.evaluate("__dbg.apache.visualTokens().detail.hash")
        assert h == h0, ('R4: %s 环境切换哈希漂移' % env, h)
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.wait_for_timeout(250)
    print('ci smoke OK: P9 补强批（detail 诊断/材质接线/涂装保留/四地形环境切换不丢）')

    # ---- P10：重点部件细节件（帧率无关：只读诊断 + 同步挂载状态；不依赖实时推进） ----
    # P10-1: dp 存在且诊断结构完整（资产真实加载与否由 state 反映；本地门禁 q=1 会加载）
    assert pg.evaluate("!!__dbg.dp"), 'P10-1: __dbg.dp 应暴露'
    st = pg.evaluate("__dbg.dp.stats()")
    assert st['total'] == 2 and len(st['manifest']) == 2, ('P10-1: manifest 应 2 件（机首件弃用后）', st)
    assert all('turret' not in u for u in st['manifest']), ('P10-1: turret 应已移除', st['manifest'])
    assert all('nose' not in u for u in st['manifest']), ('P10-1: 机首件应已弃用', st['manifest'])
    assert st['loaded'] >= 0 and st['scenes'] >= 0 and st['tris'] >= 0, ('P10-1: 诊断值域', st)
    # 若已加载（q=1 门禁默认）：场景与三角形数 >0；若低档回退也不报错（fallback 状态合法）
    if st['loaded'] > 0:
        assert st['scenes'] == st['loaded'] and st['tris'] > 0, ('P10-1: 已加载诊断一致', st)
    # P10-2: 质量档联动（0.75 隐藏 / 1 显示）——同步 DOM 事件，帧率无关
    pg.evaluate("""(() => { const s=document.getElementById('sel-quality'); s.value='0.75';
      s.dispatchEvent(new Event('change',{bubbles:true})); })()""")
    pg.wait_for_timeout(300)
    v075 = pg.evaluate("__dbg.dp.scenes.length ? __dbg.dp.scenes.every(s=>!s.visible) : true")
    assert v075, 'P10-2: 0.75 档应隐藏全部细节件'
    pg.evaluate("""(() => { const s=document.getElementById('sel-quality'); s.value='1';
      s.dispatchEvent(new Event('change',{bubbles:true})); })()""")
    pg.wait_for_timeout(300)
    v1 = pg.evaluate("__dbg.dp.scenes.length ? __dbg.dp.scenes.every(s=>s.visible) : true")
    assert v1, 'P10-2: 恢复 1 档应显示细节件'
    # P10-3: 细节件材质并入 apache.mats（P9 涂装/环境语义复用）——检测 P10_* 材质名存在
    hasP10 = pg.evaluate("__dbg.apache.mats ? [...__dbg.apache.mats.keys()].some(k=>k.indexOf('P10_')===0) : false")
    if st['loaded'] > 0:
        assert hasP10, ('P10-3: P10 材质应并入 apache.mats（已加载时）', st)
    print('ci smoke OK: P10 细节件（诊断/质量档联动/材质并入 mats）')

    # ---- P18：轻街机层（帧率无关：槽位注册 + HUD id 契约 + 难度默认值） ----
    # P18-1: 83-arcade 经 HOST.makeArcade 工厂槽注册（79/80/81 先例），state() 遥测可读
    assert pg.evaluate("!!__dbg.arcade"), 'P18-1: __dbg.arcade 槽位应注册'
    # M3 修正：拓扑检查器无法发现"宿主槽位只被引用、从未赋值"（P0-1 即从此漏过）——
    # 此处补运行时值级断言：HOST.arcade 必须真正装配（经 arcSlot 读口），否则 16-targets 读兜底 1
    assert pg.evaluate("__dbg.arcSlot === true"), \
        'P18-1: HOST.arcade 槽位必须装配（arcSlot 读口）'
    assert pg.evaluate("__dbg.arcade.state().difficulty === 'standard' && __dbg.arcade.state().score === 0"), \
        'P18-1: 难度默认 standard 且本局分数 0'
    # P18-2: HUD id 契约——分数/连击读取口存在（#hud-combo-wrap 初始隐藏）
    p18b = pg.evaluate("(() => ({\n"
                      "  score: !!document.getElementById('hud-score'),\n"
                      "  combo: !!document.getElementById('hud-combo'),\n"
                      "  wrapHidden: document.getElementById('hud-combo-wrap').style.display === 'none',\n"
                      "  diffRow: !!document.getElementById('mission-difficulties'),\n"
                      "  ach: !!document.getElementById('arcade')\n"
                      "}))()")
    assert p18b['score'] and p18b['combo'] and p18b['wrapHidden'] and p18b['diffRow'] and p18b['ach'], \
        ('P18-2: HUD/面板 id 契约', p18b)
    print('ci smoke OK: P18 轻街机层（槽位注册/HUD id 契约/难度默认值）')

import pw_harness as H
H.guarded_main(run, hard_timeout=300)
print('PASS')
