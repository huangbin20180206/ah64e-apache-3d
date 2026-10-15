# Phase 18 轻街机层（难度/分数/成就）状态级验证：A1-A5 + A9 + A10
# 断言原子化（一次 evaluate 置位+断言）+ wait_for_function 条件等待；
# 数值一律读 __dbg 状态源（__dbg.arcade.state() 等），不解析截图。
# 拆分说明：A6（结算公式复算）/A7（最高分 fresh reload）/A8（隐私存储降级）
# 因各自需独立上下文（控制 opts / reload / add_init_script），分别置于
# test_arcade_settle.py / test_arcade_hi.py / test_arcade_privacy.py，合计 manifest +4
# （基线 67 → 71，与规格 G4 一致）。
# 默认难度 standard 全 1.0——既有 67 项门禁行为零变化的回归铁律在此实证。

def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.arcade)", timeout=60000)

    # —— A1 默认：难度 chips 默认 standard；HUD 分数初始 0 / 连击 1 ——
    a1 = pg.evaluate("""(() => {
        const st = __dbg.arcade.state();
        return { slot: !!__dbg.arcade, diff: st.difficulty, score: st.score, combo: st.combo,
                 hud: document.getElementById('hud-score') ? document.getElementById('hud-score').textContent : null };
    })()""")
    assert a1['slot'] and a1['diff'] == 'standard' and a1['score'] == 0 and a1['combo'] == 1, ('A1 default state', a1)
    print('A1 OK:', a1)

    # —— A2 系数口值级：veteran 下 coeffs 恒 1.5/1.4，且 AA 接线实际生效 ——
    # 驱动 targets.update 强制敌方 AA 开火：_aaDmgMul 应被写为 1.4（16-targets 读 HOST.arcade），
    # _aaCool 采集值应落在 (1.2+rnd*1.4)/1.5 的缩放区间 [0.8, 1.733]——若难度未接线（兜底 1）
    # 则落在 [1.2, 2.6]，上限越界可检出。S4：命中概率不随难度缩放（本断言不涉命中概率）。
    a2 = pg.evaluate("""(() => {
        __dbg.setMissionDifficulty('veteran');
        const c = __dbg.arcade.coeffs(null);
        const t = __dbg.targets; t.enabled = true;
        const bc = t.baseCenter;
        const h = __dbg.apache.root.position.clone(); h.set(bc.x + 20, 5, bc.z);
        const cools = [];
        for (let i = 0; i < 24; i++) {
            t._aaCool = 0;                 // 强制即时开火，采集每次开火后的间隔
            t.update(4, h, null);          // m=null → coeffs 读当前选定 veteran
            if (t._aaCool > 0) cools.push(t._aaCool);
        }
        const r = { rate: c.aaRate, dmg: c.aaDmg, res: c.res,
                    dmgMul: t._aaDmgMul, min: Math.min(...cools), max: Math.max(...cools), n: cools.length };
        __dbg.setMissionDifficulty('standard');
        return r;
    })()""")
    assert abs(a2['rate'] - 1.5) < 1e-9 and abs(a2['dmg'] - 1.4) < 1e-9 and abs(a2['res'] - 1.4) < 1e-9, ('A2 coeffs', a2)
    assert a2['dmgMul'] == 1.4, ('A2 AA接线 _aaDmgMul 未写为 veteran 1.4', a2)   # 16-targets 读 HOST.arcade 验证
    assert a2['n'] >= 5, ('A2 AA 采样数不足', a2)
    assert a2['min'] >= 0.79 and a2['max'] <= 1.74, ('A2 _aaCool 未缩放至 /1.5 区间（AA 接线/兜底失效）', a2)
    print('A2 OK:', a2)

    # —— A3 击毁得分 = 公式复算（同页 evaluate 内复算 @ veteran scoreMul 1.5）——
    a3 = pg.evaluate("""(() => {
        const ac = __dbg.arcade;
        ac.onMissionStart();
        ac.update(1);
        const m = { difficulty: 'veteran' };
        const g1 = ac.onKill('tank', m);       // 150 × 1.5 × 连击1.0 = 225
        const g2 = ac.onKill('drone', m);      // 300 × 1.5 × 连击1.15 = 517.5 → 518
        const g3 = ac.onKill('barrel', m);     // 80 × 1.5 × 连击1.30 = 156
        const r = { g1, g2, g3,
                    r1: Math.round(150 * 1.5 * 1.0), r2: Math.round(300 * 1.5 * 1.15), r3: Math.round(80 * 1.5 * 1.30),
                    score: ac.state().score };
        return r;
    })()""")
    assert a3['g1'] == a3['r1'] and a3['g2'] == a3['r2'] and a3['g3'] == a3['r3'], ('A3 formula（连击档应为 1.0/1.15/1.30）', a3)
    assert a3['score'] == a3['g1'] + a3['g2'] + a3['g3'], ('A3 accum', a3)
    print('A3 OK:', a3)

    # —— A4 连击 6s 窗口衰减 + ×1.75 封顶（直接驱动 update 时间源，帧率无关）——
    a4 = pg.evaluate("""(() => {
        const ac = __dbg.arcade;
        ac.onMissionStart();
        ac.update(0); const g1 = ac.onKill('truck'); const c1 = ac.state().combo;
        ac.update(1); const g2 = ac.onKill('truck'); const c2 = ac.state().combo;
        ac.update(2); const g3 = ac.onKill('truck'); const c3 = ac.state().combo;
        ac.update(3); const g4 = ac.onKill('truck'); const c4 = ac.state().combo;
        ac.update(4); const g5 = ac.onKill('truck'); const c5 = ac.state().combo;
        ac.update(5); const g6 = ac.onKill('truck'); const c6 = ac.state().combo;
        ac.update(12); const g7 = ac.onKill('truck'); const c7 = ac.state().combo;
        return { g1,g2,g3,g4,g5,g6,g7, c1,c2,c3,c4,c5,c6,c7,
                 comboMax: ac.state().comboMax,
                 ok: g1===100 && g2===115 && g3===130 && g4===145 && g5===160 && g6===175 && g7===100 &&
                     c1===1 && c2===2 && c3===3 && c4===4 && c5===5 && c6===6 && c7===1 };
    })()""")
    assert a4['ok'], ('A4 combo 窗口/封顶逻辑', a4)
    assert a4['comboMax'] == 6, ('A4 comboMax', a4)
    print('A4 OK:', a4)

    # —— A5 时限系数（2026-10-14 放宽后）：standard ×1.2 / veteran ×0.85 / rookie ×1.5（读 missionTimeout 真源，非面板文案）——
    a5 = pg.evaluate("""(() => {
        const base = __dbg.missionTimeout();
        __dbg.setMissionDifficulty('veteran');
        const vet = __dbg.missionTimeout();
        __dbg.setMissionDifficulty('rookie');
        const roo = __dbg.missionTimeout();
        __dbg.setMissionDifficulty('standard');
        return { base, vet, roo };
    })()""")
    assert abs(a5['vet'] - a5['base'] / 1.2 * 0.85) < 1e-6, ('A5 veteran timeout ×0.85', a5)
    assert abs(a5['roo'] - a5['base'] / 1.2 * 1.5) < 1e-6, ('A5 rookie timeout ×1.5', a5)
    print('A5 OK:', a5)

    # —— A9 成就触发 + 结算面板（全歼走 destroy 完成 standard 局；first_blood/wipeout 即时、
    #     ghost 结算授予；面板行展示）——
    pg.evaluate("""(() => {
        __dbg.setMissionDifficulty('standard');
        __dbg.startMission('standard');
        const m = __dbg.S._mission; m.phase = 'active'; m.t0 = __dbg.S.time;
        const rig = __dbg.rig;
        m.gun0 = rig ? rig.gunAmmo : 0; m.rk0 = rig ? rig.rocketAmmo : 0; m.hf0 = rig ? rig.hfAmmo : 0;
        __dbg.beginMission();
        __dbg.air.enabled = false;
        __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });
    })()""")
    pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", timeout=30000)
    a9 = pg.evaluate("""(() => {
        const st = __dbg.arcade.state();
        const body = document.getElementById('mission-body');
        return { kills: st.kills, unlocked: st.unlocked.slice().sort(),
                 panelScore: body.innerHTML.includes('得分') && body.innerHTML.includes('最高分') };
    })()""")
    assert a9['kills'] == 10, ('A9 全歼 10 目标', a9)
    assert 'first_blood' in a9['unlocked'] and 'wipeout' in a9['unlocked'] and 'ghost' in a9['unlocked'], ('A9 成就 first_blood/wipeout/ghost', a9)
    assert a9['panelScore'], ('A9 结算面板分数行', a9)
    print('A9 OK:', a9)

    # —— A10 all_variants 跨局累计（A9 已完成 standard；此处再完成两变体后应解锁全部）——
    # 完成条件说明：timed_rescue 需"全歼 + 救援送抵"——测试里直接置 __dbg.rescue.state='delivered'
    # 等价于已完成救援送抵（完成条件 L570 读 rescue.state；不置则永不结算，见 phase-18-prompt §A10）。
    pg.evaluate("""(() => {
        const complete = (v) => {
          __dbg.startMission(v);
          const m = __dbg.S._mission; m.phase = 'active'; m.t0 = __dbg.S.time;
          const rig = __dbg.rig;
          m.gun0 = rig ? rig.gunAmmo : 0; m.rk0 = rig ? rig.rocketAmmo : 0; m.hf0 = rig ? rig.hfAmmo : 0;
          __dbg.beginMission();
          __dbg.air.enabled = false;
          if (v === 'timed_rescue' && __dbg.rescue) __dbg.rescue.state = 'delivered';
          __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });
        };
        complete('timed_rescue');
    })()""")
    pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", timeout=30000)
    pg.evaluate("""(() => {
        const complete = (v) => {
          __dbg.startMission(v);
          const m = __dbg.S._mission; m.phase = 'active'; m.t0 = __dbg.S.time;
          const rig = __dbg.rig;
          m.gun0 = rig ? rig.gunAmmo : 0; m.rk0 = rig ? rig.rocketAmmo : 0; m.hf0 = rig ? rig.hfAmmo : 0;
          __dbg.beginMission();
          __dbg.air.enabled = false;
          __dbg.targets.targets.forEach(t => { if (t.alive) __dbg.targets.destroy(t, 3); });
        };
        complete('limited_ammo');
    })()""")
    pg.wait_for_function("() => __dbg.S._mission && __dbg.S._mission.phase === 'done'", timeout=30000)
    a10 = pg.evaluate("""(() => {
        const raw = localStorage.getItem('ah64_arcade_achv');
        const st = __dbg.arcade.state();
        return { keys: raw ? JSON.parse(raw) : [], allV: st.allVariants,
                 unlocked: st.unlocked.includes('all_variants') };
    })()""")
    assert set(a10['keys']) == {'standard', 'timed_rescue', 'limited_ammo'}, ('A10 三变体已记录', a10)
    assert a10['allV'] and a10['unlocked'], ('A10 all_variants 成就解锁', a10)
    print('A10 OK:', a10)

    print('ALL A1-A5/A9/A10 PASS')

import pw_harness as H
H.guarded_main(run, hard_timeout=300)
print('PASS')
