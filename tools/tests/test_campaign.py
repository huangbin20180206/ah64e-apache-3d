# -*- coding: utf-8 -*-
# Phase 20-C/D：结算评级 + 战役存档——值级浏览器断言（playwright）
# 兼容性黄金断言（grade 与旧 missionRating 场景一致）+ 七输入降档 + 战役
# chips/进入/记档/解锁 + 损坏存档容错。全部 __dbg 数值断言、条件等待。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

from playwright.sync_api import sync_playwright


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.campaign && __dbg.arcade && __dbg.targets && __dbg.resources)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    H.step(pg, 0.3)
    # 每轮测试前清战役存档（localStorage 唯一键），保证解锁链从第 1 关起
    pg.evaluate("(() => { try { localStorage.removeItem('ah64_campaign'); } catch (e) {} })()")
    pg.evaluate("location.reload()")
    pg.wait_for_function("() => !!(window.__dbg && __dbg.campaign && __dbg.arcade && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")

    # ---- C1: 评级兼容（短局全绿 → S，与旧公式逐位一致——73 项保护） ----
    # 注意：destroy 注入局的 shots=0 → acc=0 → 任何评级曲线（含旧公式）都给
    # C——S 场景必须注入真实命中输入（hits/弹药差制造 ≥50% 命中率，与
    # mobile_mission 的真实 gunOn 同语义）。
    pg.evaluate("""(() => { __dbg.S.mode = 'mission'; __dbg.startMission('standard');
        const m = __dbg.S._mission; m.phase='active'; m.t0 = __dbg.S.time;
        const rig = __dbg.rig; m.gun0 = rig.gunAmmo; m.rk0 = rig.rocketAmmo; m.hf0 = rig.hfAmmo;
        __dbg.beginMission();
        __dbg.enemyAir.reset(); __dbg.enemyVis.clearVisual();   // 本用例不测敌机
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });
        m.hits = 15; rig.gunAmmo = m.gun0 - 30; })()""")   # 注入：30 发 15 中（50%）
    H.step_until(pg, "() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", 30)
    c1 = pg.evaluate("""(() => { const b = document.getElementById('mission-body').innerHTML;
        const g = b.match(/<span>评级<\\/span><b style="color:var\\(--accent2\\)">([SABC])<\\/b>/);
        return { grade: g ? g[1] : '', hasGrade: b.includes('评级'), fuelRow: b.includes('剩余燃油') }; })()""")
    assert c1['hasGrade'], ('C1: 结算应有评级行', c1)
    assert c1['grade'] == 'S', ('C1: 短局全绿应为 S（兼容旧公式）', c1)
    assert c1['fuelRow'], ('C1: 结算应有剩余燃油行', c1)
    print('C1 PASS: 短局全绿 grade=S（与旧公式一致）+ 燃油行')

    # ---- C2: 七输入降档（燃油 <25% → S 降 A；命中输入同 C1 注入法） ----
    # 全歼 10 杀会让 comboMax≥5 触发"连击保档"把 fuel 降档抵消（grade_combo_keep
    # 的设计行为）——本用例先置位无连击（comboMax=1，与 d.sys.avionics=60 同款
    # 输入置位），隔离 fuel 降档通道。
    pg.evaluate("""(() => { __dbg.startMission('standard');
        const m = __dbg.S._mission; m.phase='active'; m.t0 = __dbg.S.time;
        const rig = __dbg.rig; m.gun0 = rig.gunAmmo; m.rk0 = rig.rocketAmmo; m.hf0 = rig.hfAmmo;
        __dbg.beginMission();
        const r = __dbg.resources; const env = { dt: 0.05, active: true, strength: 1, homeDist: 50, alt: 14, stability: 1, variant: 'standard' };
        for (let i = 0; i < 1600; i++) r.update(env);   // 同步驱动耗油到 20%（fuel<25 触发降档）
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });
        m.hits = 15; rig.gunAmmo = m.gun0 - 30;
        __dbg.arcade._comboMax = 1; __dbg.arcade._combo = 1; })()""")   # 注入：50% 命中 + 无连击
    H.step_until(pg, "() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", 30)
    c2 = pg.evaluate("""(() => { const b = document.getElementById('mission-body').innerHTML;
        const m = b.match(/<span>剩余燃油<\\/span><b>(\\d+)%/);
        const g = b.match(/<span>评级<\\/span><b style="color:var\\(--accent2\\)">([SABC])<\\/b>/);
        return { fuel: m ? +m[1] : -1, grade: g ? g[1] : '' }; })()""")
    assert c2['fuel'] < 25 and c2['fuel'] >= 0, ('C2: 燃油应 <25%', c2)
    assert c2['grade'] == 'A', ('C2: 低油局应 S→A（fuel 降档）', c2)
    print('C2 PASS: 七输入降档（燃油 %d%% → grade A）' % c2['fuel'])

    # ---- C2b: 连击保档（同 C2 场景但保留全歼连击 comboMax≥5 → 抵消 fuel 降档 → S） ----
    pg.evaluate("""(() => { __dbg.startMission('standard');
        const m = __dbg.S._mission; m.phase='active'; m.t0 = __dbg.S.time;
        const rig = __dbg.rig; m.gun0 = rig.gunAmmo; m.rk0 = rig.rocketAmmo; m.hf0 = rig.hfAmmo;
        __dbg.beginMission();
        const r = __dbg.resources; const env = { dt: 0.05, active: true, strength: 1, homeDist: 50, alt: 14, stability: 1, variant: 'standard' };
        for (let i = 0; i < 1600; i++) r.update(env);
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });   // 10 杀 → combo≥5
        m.hits = 15; rig.gunAmmo = m.gun0 - 30; })()""")   # 注入命中，连击保留（保档生效）
    H.step_until(pg, "() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", 30)
    c2b = pg.evaluate("""(() => { const b = document.getElementById('mission-body').innerHTML;
        const g = b.match(/<span>评级<\\/span><b style="color:var\\(--accent2\\)">([SABC])<\\/b>/);
        return { grade: g ? g[1] : '', comboMax: __dbg.arcade.state().comboMax }; })()""")
    assert c2b['comboMax'] >= 5 and c2b['grade'] == 'S', ('C2b: 连击保档应抵消 fuel 降档 → S', c2b)
    print('C2b PASS: 连击保档（comboMax=%d → fuel 降档被抵 → S）' % c2b['comboMax'])

    # ---- C3: 战役 chips（6 关；第 1 关可点、第 2 关锁定） ----
    pg.evaluate("(() => { __dbg.startMission('standard'); })()")
    c3 = pg.evaluate("""(() => {
        const cs = [...document.querySelectorAll('#mission-campaign .chip')];
        return { n: cs.length, states: cs.map(c => ({ open: !c.classList.contains('locked'), dis: c.getAttribute('aria-disabled') })) }; })()""")
    assert c3['n'] == 6, ('C3: 应有 6 个关卡 chip（Phase 26 增 SEAD 终关）', c3)
    assert c3['states'][0]['open'] and c3['states'][0]['dis'] == 'false', ('C3: 第 1 关应解锁', c3)
    assert all(not s['open'] for s in c3['states'][1:]), ('C3: 其余关应锁定', c3)
    print('C3 PASS: 战役 6 关 chips（1 解锁/5 锁定）')

    # ---- C4: startCampaign(0) → levelIdx/变体/难度快照 ----
    pg.evaluate("__dbg.startCampaign(0)")
    H.step(pg, 0.4)
    c4 = pg.evaluate("(() => { const m = __dbg.S._mission; return { li: m.levelIdx, v: m.variant, d: m.difficulty }; })()")
    assert c4['li'] == 0 and c4['v'] == 'standard' and c4['d'] == 'standard', ('C4: 关卡参数应快照', c4)
    print('C4 PASS: startCampaign(0) → levelIdx=0/standard/standard')

    # ---- C5: 关卡完成记档 + 解锁第 2 关（grade B 以上；命中输入同 C1 注入法） ----
    pg.evaluate("""(() => { const m = __dbg.S._mission; m.phase='active'; m.t0 = __dbg.S.time;
        const rig = __dbg.rig; m.gun0 = rig.gunAmmo; m.rk0 = rig.rocketAmmo; m.hf0 = rig.hfAmmo;
        __dbg.beginMission();
        __dbg.enemyAir.reset(); __dbg.enemyVis.clearVisual();
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });
        m.hits = 15; rig.gunAmmo = m.gun0 - 30; })()""")   # 注入：50% 命中 → S → 解锁
    H.step_until(pg, "() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", 30)
    H.step_until(pg, "() => __dbg.campaign.state().unlocked >= 2", 5)
    c5 = pg.evaluate("""(() => { const raw = localStorage.getItem('ah64_campaign');
        const o = raw ? JSON.parse(raw) : null; const s = __dbg.campaign.state();
        return { schema: o ? o.schema_version : -1, unlocked: s.unlocked,
          best: s.levels[0].bestScore > 0, grade: s.levels[0].bestGrade, dmg: s.levels[0].totalDmg }; })()""")
    assert c5['schema'] == 1 and c5['unlocked'] == 2, ('C5: 应记档并解锁第 2 关', c5)
    assert c5['best'] and c5['grade'] in ('S', 'A', 'B'), ('C5: 第 1 关应留最优记录', c5)
    print('C5 PASS: 记档 schema=1/unlocked=2/最优保留')

    # ---- C6: 损坏存档容错（垃圾 JSON → 页面不炸、全新档） ----
    pg.evaluate("(() => { try { localStorage.setItem('ah64_campaign', '{broken!!!'); } catch (e) {} location.reload(); })()")
    pg.wait_for_function("() => !!(window.__dbg && __dbg.campaign)", timeout=60000)
    c6 = pg.evaluate("(() => { const s = __dbg.campaign.state(); return { schema: s.schema, unlocked: s.unlocked, n: s.levelCount }; })()")
    assert c6['schema'] == 1 and c6['unlocked'] == 1 and c6['n'] == 6, ('C6: 损坏档应回全新档', c6)
    # 清理本轮测试存档（不污染后续用户数据）
    pg.evaluate("(() => { try { localStorage.removeItem('ah64_campaign'); } catch (e) {} })()")
    print('C6 PASS: 损坏存档回全新档（页面不炸）')

    pg.screenshot(path=H.output_path('shot_campaign.jpg'), type='jpeg', quality=88)
    print('Phase 20 campaign OK: C1-C6 全过')


import pw_harness as H2
H2.guarded_main(run, hard_timeout=300)
print('PASS')
