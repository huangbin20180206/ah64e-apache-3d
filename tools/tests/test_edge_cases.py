# 边界回归：场景连续切换、质量档位、失焦与指针锁定丢失后的状态清理。
# 用法: uv run --with playwright python test_edge_cases.py
import pw_harness as H


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close')?.click()")

    # 质量档位必须三处联动：像素倍率、bloom mip 级数、特效粒子上限。
    # 附带守卫：WashFX 下挂的每个特效子对象都必须实现 setQuality——
    # 少一个（曾漏 SpraySurfaceFX）会让 applyQuality 在启动时就抛 TypeError，
    # 整个页面死在加载条上。
    missing = pg.evaluate("""() => {
      const w = __dbg.washfx;
      return ['parts', 'grass', 'sprayFx', 'debris', 'duneSand']
        .filter(k => typeof w[k]?.setQuality !== 'function');
    }""")
    assert missing == [], ('特效子对象缺 setQuality', missing)

    seen = {}
    for value, levels in [('0.75', 2), ('1', 4), ('1.5', 4), ('2', 4)]:
        pg.select_option('#sel-quality', value)
        pg.wait_for_timeout(120)
        state = pg.evaluate("""() => ({
          quality: __dbg.S.quality,
          levels: __dbg.composer.activeLevels,
          dpr: __dbg.renderer.getPixelRatio(),
          parts: __dbg.washfx.parts.geo.instanceCount,
          grass: __dbg.washfx.grass.mesh.geometry.instanceCount,
          drops: __dbg.washfx.sprayFx._activeMax
        })""")
        assert abs(state['quality'] - float(value)) < 0.001, ('quality value', value, state)
        assert state['levels'] == levels, ('quality levels', value, state)
        seen[value] = state
    # 性能档必须真的降下来（不能只是改了下拉框）
    assert seen['0.75']['dpr'] < seen['1']['dpr'], ('dpr not scaled', seen)
    assert seen['0.75']['parts'] < seen['1']['parts'], ('wash particles not scaled', seen)
    assert seen['0.75']['grass'] < seen['1']['grass'], ('grass not scaled', seen)
    assert seen['0.75']['drops'] < seen['1']['drops'], ('spray drops not scaled', seen)
    assert seen['2']['dpr'] > seen['1']['dpr'], ('high tier dpr', seen)
    # 高档位回落后特效密度必须完全恢复
    assert seen['2']['parts'] == seen['1']['parts'], ('effects not restored', seen)
    assert seen['2']['drops'] == seen['1']['drops'], ('spray drops not restored', seen)

    # 反复切换全部介质，确认状态最终一致且没有同步异常。
    for terrain in ('grass', 'water', 'desert', 'pad', 'water', 'grass', 'pad'):
        pg.click('#terrain-row [data-terrain="%s"]' % terrain)
        pg.wait_for_timeout(120)
        state = pg.evaluate("({terrain: __dbg.W.terrainKey, medium: __dbg.washfx.medium})")
        assert state['terrain'] == terrain, ('terrain', terrain, state)
        expected = {'pad': 'dust', 'grass': 'grass', 'water': 'spray', 'desert': 'sand'}[terrain]
        assert state['medium'] == expected, ('medium', terrain, state)

    # 没有 keyup 的失焦路径也必须释放所有武器扳机。
    pg.evaluate("__dbg.rig.gunOn = true; __dbg.rig.rocketOn = true; window.dispatchEvent(new Event('blur'))")
    state = pg.evaluate("({gun: __dbg.rig.gunOn, rocket: __dbg.rig.rocketOn})")
    assert state == {'gun': False, 'rocket': False}, ('blur release', state)

    # 指针锁定丢失事件同样必须释放扳机。
    pg.evaluate("__dbg.rig.gunOn = true; __dbg.rig.rocketOn = true; document.dispatchEvent(new Event('pointerlockchange'))")
    state = pg.evaluate("({gun: __dbg.rig.gunOn, rocket: __dbg.rig.rocketOn})")
    assert state == {'gun': False, 'rocket': False}, ('pointer lock release', state)

    # FPV 进入后可退出；指针未锁定时必须给出重新捕获出口而不是卡死。
    pg.evaluate("__dbg.FLY.state = 'hover'; __dbg.FLY.alt = 14; __dbg.FLY.pitch = 0; __dbg.FLY.comp = 0")
    pg.keyboard.press('c')
    pg.wait_for_function("() => __dbg.fp.active", timeout=3000)
    # 提示条与锁定状态严格互斥：锁定成功则隐藏，未锁定则必须可见可点。
    pg.evaluate("if (document.pointerLockElement) document.exitPointerLock()")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.fp.update(0.016)")
    cap = pg.evaluate("""() => {
      const b = document.querySelector('#fp-capture');
      const r = document.querySelector('#fp-recapture');
      return { display: b.style.display, locked: !!document.pointerLockElement, btn: !!r };
    }""")
    assert cap['btn'], ('recapture button missing', cap)
    if cap['locked']:
        assert cap['display'] == 'none', ('capture shown while locked', cap)
    else:
        assert cap['display'] in ('block', 'inline-flex', 'flex'), ('capture control', cap)

    # 触屏方向键写入的是同一张驾驶键表；退出 FP 必须清零，避免下次自行加速。
    box = pg.evaluate("""() => {
      const el = document.querySelector('#fp-touch-w');
      el.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
      const down = !!__dbg.keys['w'];
      el.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
      return { down, up: !!__dbg.keys['w'] };
    }""")
    assert box == {'down': True, 'up': False}, ('touch dpad', box)

    pg.evaluate("__dbg.rig.gunOn = true; window.dispatchEvent(new Event('blur'))")
    assert pg.evaluate("__dbg.rig.gunOn") is False
    pg.evaluate("__dbg.keys['w'] = true")
    pg.keyboard.press('c')
    pg.wait_for_function("() => !__dbg.fp.active", timeout=3000)
    assert pg.evaluate("!__dbg.keys['w']"), 'FP 退出未清理驾驶键'
    assert pg.evaluate("document.querySelector('#fp-capture').style.display") == 'none'

    # —— Phase 2-A1：自动降档冷却 + 开关 ——
    # S._qCool 必须在 S 字面量里初始化（不是 undefined）
    qcool_init = pg.evaluate("__dbg.S._qCool")
    assert qcool_init is not None and isinstance(qcool_init, (int, float)), '_qCool 未初始化'
    # S._qAutoOff 必须存在且默认 false
    assert pg.evaluate("__dbg.S._qAutoOff") is False, '_qAutoOff 默认应为 false'
    # 勾选 chk-qauto = 允许自动降档（默认）→ 取消勾选 = S._qAutoOff 变 true
    pg.evaluate("document.getElementById('chk-qauto').checked = false; document.getElementById('chk-qauto').dispatchEvent(new Event('change'))")
    assert pg.evaluate("__dbg.S._qAutoOff") is True, '取消勾选后 _qAutoOff 应为 true'
    # 恢复勾选 → _qAutoOff 变回 false
    pg.evaluate("document.getElementById('chk-qauto').checked = true; document.getElementById('chk-qauto').dispatchEvent(new Event('change'))")
    assert pg.evaluate("__dbg.S._qAutoOff") is False, '恢复勾选后 _qAutoOff 应为 false'
    # —— _qCool 冷却豁免三路径（P2-A1） ——
    # B6+ 改造（2026-09-18，分类器真候选 L117/L123/L129）：原写法是"清 _qCool →
    # 执行切换 → 固定睡 200ms → 断言 _qCool > 0"，两个失效机理都会让它假失败：
    #   ① _qCool 是 **loop 每帧递减**的活值（70-app.js:738/742 写），200ms 后可能已被减到 0；
    #   ② 切换动作（click / select_option）在高负载下可能根本没生效。
    # 故改为：等目标值出现（条件等待），失败则**重试切换动作**（切换是幂等的——再点
    # 同一 chip 仍会重新置冷却）。这样两类失效都能自愈，且失败时报"连试 3 次未置"，
    # 与"时序慢"可区分。
    def expect_qcool(action, label):
        for _ in range(3):
            pg.evaluate("__dbg.S._qCool = 0")
            action()
            try:
                pg.wait_for_function("() => __dbg.S._qCool > 0", timeout=4000)
                return
            except Exception:
                pass
        raise AssertionError('%s：连试 3 次 _qCool 都未被置正数（非时序问题，需查切换通路）' % label)

    expect_qcool(lambda: pg.evaluate(
        "document.querySelector('#terrain-row [data-terrain=\"water\"]').click()"), '切场地')
    expect_qcool(lambda: pg.evaluate(
        "document.querySelector('#env-row [data-env=\"night\"]').click()"), '切环境')
    expect_qcool(lambda: pg.select_option('#sel-quality', '0.75'), '手动画质')
    # 切回 pad + 恢复画质（恢复测试前置状态）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    pg.wait_for_timeout(200)

    # —— Phase 2-A3：首访三步引导（fresh context 完整链路） ——
    # 新建 context（localStorage 空）→ 等待 bindUI 执行（S._guide=1 + #guide opacity=1）
    # → 真实 canvas click → _guide === 0 → btn-tour → _guide === 0
    # （#guide textContent 有 dataset.tip 缓存竞态——用状态 _guide + opacity 断言代替）
    # D-2：fresh context 的页面不在 pw_harness 的监听范围内——每个页面自挂
    # pageerror/console.error 收集，任一错误使测试失败；close() 走 try/finally
    # 断言失败时不残留页面。setPointerCapture 白名单：合成 pointerdown 在无活跃
    # 指针时 Chromium 会派发该无害异常（既有已知噪声）。
    g_ctx = pg.context.browser.new_context(viewport={'width': 1280, 'height': 800})
    g_errs = []
    try:
        g_pg = g_ctx.new_page()
        g_pg.on('pageerror', lambda e: g_errs.append('pageerror: %s' % e))
        g_pg.on('console', lambda m: g_errs.append('console.error: %s' % m.text) if m.type == 'error' else None)
        # ?nocine=1：本段测的是首访引导流程（开场运镜由 test_cinematic 专测），
        # 避免开场序列（guide=-1 + 沉浸模式）与引导断言竞争
        g_pg.goto(H.BASE + '/?nocine=1', wait_until='domcontentloaded')
        g_pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.S._guide === 1)", timeout=60000)
        g1 = g_pg.evaluate("__dbg.S._guide")
        assert g1 == 1, ('fresh context 首访 _guide 应为 1', g1)
        g_pg.wait_for_function("() => document.getElementById('guide').style.opacity === '1'", timeout=10000)
        # 真实 canvas click → _guide 归零
        g_pg.locator('#gl').click(position={'x': 400, 'y': 300})
        g_pg.wait_for_timeout(300)
        g2 = g_pg.evaluate("__dbg.S._guide")
        assert g2 == 0, ('canvas click 后 _guide 应归零', g2)
        # btn-tour → 导览启动 → _guide === 0（此处 _guide 已是 0，恒真——
        # 这条链路证明的是 canvas 跳过通道；tourStart 的清除因果由下方
        # 第二个 fresh context 证明）
        g_pg.evaluate("document.getElementById('btn-tour').click()")
        g_pg.wait_for_timeout(300)
        g3 = g_pg.evaluate("__dbg.S._guide")
        # tour 变量在 IIFE 作用域内，pg.evaluate 在全局上下文不可访问——
        # 用 S._guide === 0 + btn-tour 的 'on' 类来间接验证导览已启动
        tour_armed = g_pg.evaluate("document.getElementById('btn-tour').classList.contains('on')")
        assert g3 == 0, ('btn-tour 后 _guide 应归零', g3)
        assert tour_armed, ('导览应已启动（btn-tour 有 on 类）', tour_armed)
        # 停止导览（用既有退出通道）
        g_pg.evaluate("document.getElementById('tour-exit').click()")
        g_pg.wait_for_timeout(200)
        assert not [e for e in g_errs if 'setPointerCapture' not in e], ('A3 canvas 链路页面错误', g_errs[:3])
    finally:
        g_ctx.close()

    # —— D-1：A3 因果链证据——第二个 fresh context，不点 canvas 直点 btn-tour ——
    # canvas 链路里点 btn-tour 时 _guide 已被 canvas click 置 0，断言恒真，
    # 证明不了 tourStart() 做了清除。这里加载后 _guide===1（不点 canvas），
    # 直接点 btn-tour → 只有 tourStart() 内部的 S._guide=0 才能让它归零。
    g2_ctx = pg.context.browser.new_context(viewport={'width': 1280, 'height': 800})
    g2_errs = []
    try:
        g2_pg = g2_ctx.new_page()
        g2_pg.on('pageerror', lambda e: g2_errs.append('pageerror: %s' % e))
        g2_pg.on('console', lambda m: g2_errs.append('console.error: %s' % m.text) if m.type == 'error' else None)
        g2_pg.goto(H.BASE + '/?nocine=1', wait_until='domcontentloaded')
        g2_pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.S._guide === 1)", timeout=60000)
        pre = g2_pg.evaluate("__dbg.S._guide")
        assert pre == 1, ('第二 context 加载后 _guide 应仍为 1（未点 canvas）', pre)
        # 不点 canvas，直接启动导览——归零只能来自 tourStart() 的 S._guide=0
        g2_pg.evaluate("document.getElementById('btn-tour').click()")
        g2_pg.wait_for_timeout(300)
        post = g2_pg.evaluate("(() => ({ guide: __dbg.S._guide, on: document.getElementById('btn-tour').classList.contains('on') }))()")
        assert post['guide'] == 0, ('btn-tour 直点后 _guide 应归零（tourStart 清除的因果）', post)
        assert post['on'], ('导览应已启动（btn-tour 有 on 类）', post)
        g2_pg.evaluate("document.getElementById('tour-exit').click()")
        g2_pg.wait_for_timeout(200)
        assert not [e for e in g2_errs if 'setPointerCapture' not in e], ('A3 因果链页面错误', g2_errs[:3])
    finally:
        g2_ctx.close()

    # —— Phase 2-A5：prefers-reduced-motion（独立 context） ——
    # 创建 reduced_motion="reduce" 的 context，验证 chk-vib/chk-auto 默认关
    rm_ctx = pg.context.browser.new_context(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
    rm_errs = []
    try:
        rm_pg = rm_ctx.new_page()
        rm_pg.on('pageerror', lambda e: rm_errs.append('pageerror: %s' % e))
        rm_pg.on('console', lambda m: rm_errs.append('console.error: %s' % m.text) if m.type == 'error' else None)
        rm_pg.goto(H.BASE, wait_until='domcontentloaded')
        rm_pg.wait_for_function("() => !!(window.__dbg && __dbg.apache)", timeout=60000)
        rm_pg.wait_for_timeout(600)
        rm_state = rm_pg.evaluate("""() => ({
          vib: document.getElementById('chk-vib').checked,
          auto: document.getElementById('chk-auto').checked,
          svib: __dbg.S.vib
        })""")
        assert rm_state['vib'] is False, ('reduced-motion chk-vib should be unchecked', rm_state)
        assert rm_state['auto'] is False, ('reduced-motion chk-auto should be unchecked', rm_state)
        assert rm_state['svib'] is False, ('reduced-motion S.vib should be false', rm_state)
        # 手动勾回 chk-vib → S.vib 变 true
        rm_pg.evaluate("document.getElementById('chk-vib').checked = true; document.getElementById('chk-vib').dispatchEvent(new Event('change'))")
        assert rm_pg.evaluate("__dbg.S.vib") is True, 'reduced-motion 手动勾回 chk-vib 后 S.vib 应为 true'
        assert not [e for e in rm_errs if 'setPointerCapture' not in e], ('reduced-motion 页面错误', rm_errs[:3])
    finally:
        rm_ctx.close()

    # —— Phase 2-A6：progressbar aria 属性 ——
    pb = pg.evaluate("""() => {
      const el = document.getElementById('loading');
      return { min: el.getAttribute('aria-valuemin'),
               max: el.getAttribute('aria-valuemax'),
               now: el.getAttribute('aria-valuenow'),
               role: el.getAttribute('role') };
    }""")
    assert pb['role'] == 'progressbar', ('loading 缺 progressbar role', pb)
    assert pb['min'] == '0', ('aria-valuemin', pb)
    assert pb['max'] == '100', ('aria-valuemax', pb)
    assert pb['now'] is not None and int(pb['now']) >= 0, ('aria-valuenow', pb)
    # aria-valuenow 应为 100（页面已完全加载，prog(1) 已执行）
    assert int(pb['now']) == 100, ('aria-valuenow should be 100 after full load', pb['now'])

    # —— 无障碍：.chip 伪按钮必须键盘可达且语义正确 ——
    a11y = pg.evaluate("""() => {
      const chips = [...document.querySelectorAll('.chip')];
      return {
        total: chips.length,
        noRole: chips.filter(c => c.getAttribute('role') !== 'button'
                                && c.getAttribute('role') !== 'radio').length,
        // Phase 11 X1：Tab 顺序用正向 tabindex 实现（启旋→起飞→模式行→其余，
        // btn-start=1/btn-fly=2/mode=3..5）——正 tabindex 同样键盘可聚焦，
        // 只有负值才是真不可聚焦；原 `!== 0` 会把正向显式顺序误判为不可聚焦
        noTab: chips.filter(c => c.tabIndex < 0).length,
        pressed: chips.filter(c => c.hasAttribute('aria-pressed')).length,
        checked: chips.filter(c => c.hasAttribute('aria-checked')).length,
        canvas: !!document.querySelector('#gl').getAttribute('aria-label'),
        toastLive: document.querySelector('#toast').getAttribute('aria-live'),
      };
    }""")
    assert a11y['total'] > 20, ('chip count', a11y)
    assert a11y['noRole'] == 0, ('chip 缺 role', a11y)
    assert a11y['noTab'] == 0, ('chip 不可 Tab 聚焦', a11y)
    assert a11y['pressed'] >= 10, ('开关型 chip 缺 aria-pressed', a11y)
    assert a11y['checked'] >= 12, ('机位条缺 aria-checked', a11y)
    assert a11y['canvas'], ('canvas 缺 aria-label', a11y)
    assert a11y['toastLive'] == 'polite', ('toast 缺 live region', a11y)

    # aria-pressed 必须跟随 .on 类翻转（MutationObserver 镜像）
    pg.click('#env-row [data-env="night"]')
    pg.wait_for_timeout(160)
    st = pg.evaluate("""() => {
      const q = k => document.querySelector(`#env-row [data-env="${k}"]`);
      return { night: q('night').getAttribute('aria-pressed'),
               day: q('day').getAttribute('aria-pressed') };
    }""")
    assert st == {'night': 'true', 'day': 'false'}, ('aria-pressed 未跟随', st)

    # 键盘触发：回车必须点到 chip，且空格不得同时误触发"启停旋翼"全局键
    pg.click('#env-row [data-env="day"]')
    pg.wait_for_timeout(140)
    run0 = pg.evaluate("__dbg.S.running")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\'grass\\']').focus()")
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(200)
    assert pg.evaluate("__dbg.W.terrainKey") == 'grass', '回车未触发 chip'
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\'pad\\']').focus()")
    pg.keyboard.press(' ')
    pg.wait_for_timeout(200)
    assert pg.evaluate("__dbg.W.terrainKey") == 'pad', '空格未触发 chip'
    assert pg.evaluate("__dbg.S.running") == run0, '空格在 chip 上误触发了旋翼启停'

    # —— P2-B2：键盘切机位一次性 toast ——
    # 面板收起时按机位快捷键只有画面在动——现在必须弹一次性 toast 报机位名
    # 前置：禁用自动降档——低帧负载下降档 toast（'帧率偏低…'）会在机位 toast
    # 的 2s 窗口内重置计时，造成"2s 未隐藏"假失败（既有脆弱；本测试意图=
    # 机位 toast 的一次性语义，与降档无关；产品行为正确，此为测试侧隔离）
    pg.evaluate("document.getElementById('chk-qauto').checked = false; document.getElementById('chk-qauto').dispatchEvent(new Event('change'))")
    pg.evaluate("document.activeElement && document.activeElement.blur()")
    # 等机位 toast 真正出现再断言，而非固定睡 250ms 后盲读——Phase 19 新增了
    # SAM 告警 toast（'导弹来袭——转向规避或用 J 投放干扰弹'）这一**更高优先级的
    # 生产者**，会在窗口内抢走单槽 toast。实测失败现场：press 后 250ms 读到的是
    # SAM 告警文本、而 view 已切到 1（说明机位 toast 确实先亮过，只是被顶掉）。
    # B6+ 追加重试（分类器真候选 L304→L310）：全量负载下按 '2' 还可能**整键丢失**
    # （实测该等待 8 秒超时、toast 从未出现）——setView 幂等，重按只是再弹一次，
    # 故连试 3 次；失败时报"连按 3 次未触发"以区别于"时序慢"。
    def press_view_key():
        for _ in range(3):
            pg.keyboard.press('2')   # VIEWS[1] = 正侧
            try:
                pg.wait_for_function(
                    "() => document.getElementById('toast').textContent.indexOf('正侧') >= 0",
                    timeout=4000)
                return True
            except Exception:
                pass
        return False
    assert press_view_key(), 'B2: 连按 3 次机位键都未见机位 toast（非时序问题，需查按键/toast 通路）'
    b2 = pg.evaluate("""(() => ({
      txt: document.getElementById('toast').textContent,
      show: document.getElementById('toast').classList.contains('show'),
      view: __dbg.S.view
    }))()""")
    assert b2['show'], ('B2 toast 未显示', b2)
    assert '正侧' in b2['txt'], ('B2 toast 应含机位名', b2)
    assert b2['view'] == 1, ('B2 setView 未生效', b2)
    # 一次性：toast 2s 自动隐藏（既有行为，B2 沿用）
    # 等 toast 实际消失，而非固定睡 2.3s——实测 15 次里 8 次失败：
    # 高负载下 setTimeout 会漂移，且自动降档 toast（"帧率偏低…"）会重置计时器，
    # 固定睡必然偶发假失败。条件等待 2s 到即走，既更快也更稳。
    pg.wait_for_function("() => !document.getElementById('toast').classList.contains('show')", timeout=8000)

    # —— P2-B3：部件解说牌 ——
    # LABELS 已扩为三元组（节点名/显示名/解说），14 条且解说非空
    labs = pg.evaluate("(() => __dbg.LABELS.map(l => [l[1], typeof l[2] === 'string' && l[2].length > 10]))()")
    assert len(labs) == 14, ('LABELS 数量应为 14', len(labs))
    assert all(x[1] for x in labs), '每条 LABELS 应有实质解说文案'
    # 打开部件标签 → 点击一个可见标签 → 解说牌显示且内容与标签/LABELS 表一致
    pg.evaluate("document.getElementById('chk-labels').checked = true; document.getElementById('chk-labels').dispatchEvent(new Event('change'))")
    pg.wait_for_timeout(400)
    b3 = pg.evaluate("""(() => {
      const el = [...document.querySelectorAll('.lab')].find(e => e.style.display !== 'none');
      if (!el) return { err: 'no visible label' };
      el.click();
      const info = document.getElementById('label-info');
      return { txt: el.textContent, vis: info.style.display,
               name: info.querySelector('b') ? info.querySelector('b').textContent : null,
               desc: info.querySelector('p') ? info.querySelector('p').textContent : null };
    })()""")
    assert 'err' not in b3, b3
    assert b3['vis'] == 'block', ('B3 解说牌未显示', b3)
    assert b3['name'] == b3['txt'], ('B3 解说牌部件名应与标签一致', b3)
    assert b3['desc'] and len(b3['desc']) > 20, ('B3 解说应有实质内容', b3)
    desc_from_table = pg.evaluate("""(txt) => {
      const row = __dbg.LABELS.find(l => l[1] === txt);
      return row ? row[2] : null;
    }""", b3['txt'])
    assert desc_from_table == b3['desc'], ('B3 解说与 LABELS 表一致', b3['txt'])
    # 再点同一标签 → 收起
    b3b = pg.evaluate("""(txt) => {
      const el = [...document.querySelectorAll('.lab')].find(e => e.textContent === txt);
      el.click();
      return { vis: document.getElementById('label-info').style.display };
    }""", b3['txt'])
    assert b3b['vis'] == 'none', ('B3 同一标签再点应收起', b3b)
    # 点解说牌本身 → 收起（牌面自关闭）
    pg.evaluate("""(txt) => {
      const el = [...document.querySelectorAll('.lab')].find(e => e.textContent === txt);
      el.click();
    }""", b3['txt'])
    pg.wait_for_timeout(100)
    assert pg.evaluate("document.getElementById('label-info').style.display") == 'block', 'B3 重开解说牌'
    pg.evaluate("document.getElementById('label-info').click()")
    assert pg.evaluate("document.getElementById('label-info').style.display") == 'none', 'B3 点牌面应收起'
    # 关闭 chk-labels → 解说牌联动隐藏
    pg.evaluate("""(txt) => {
      const el = [...document.querySelectorAll('.lab')].find(e => e.textContent === txt);
      el.click();
    }""", b3['txt'])
    pg.evaluate("document.getElementById('chk-labels').checked = false; document.getElementById('chk-labels').dispatchEvent(new Event('change'))")
    assert pg.evaluate("document.getElementById('label-info').style.display") == 'none', 'B3 关标签应联动隐藏解说牌'


H.guarded_main(run, hard_timeout=120)
