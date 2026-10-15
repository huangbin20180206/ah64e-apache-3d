# Phase 18 轻街机层：A6 结算分段公式复算（独立上下文，控制 opts 确定性）
# 结算 bonus 的分段：基础分 500 + 剩弹×系数 + 无损伤 + 快打（用时 < timeout*0.6）。
# 本节用受控 opts 一次 evaluate 内复算并断言，且覆盖失败路径不得分。
# 其余门禁见 test_arcade.py（A1-A5/A9/A10）/ test_arcade_hi.py（A7）/ test_arcade_privacy.py（A8）。

def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.arcade)", timeout=60000)

    # —— A6 结算 bonus 分段复算（veteran×1.5，standard 剩弹×5，无损伤+200，快打+300）——
    a6 = pg.evaluate("""(() => {
        const ac = __dbg.arcade;
        ac.onMissionStart();
        const before = ac.state().score;
        const opts = { difficulty:'veteran', damage:2, elapsed:100, variant:'standard',
                       grade:'B', ammoLeft:30, ammoLeftPct:40, missionTimeout:306 };
        const bonus = ac.onMissionDone(opts);
        // 同页内分段复算（与 83-arcade.js onMissionDone 逐行一致）
        let exp = 500;
        const expAmmoK = opts.variant === 'limited_ammo' ? 10 : 5;
        exp += opts.ammoLeft * expAmmoK;              // 剩弹 30×5 = 150
        if (opts.damage < 4) exp += 200;              // 无损伤（<4 命中）
        if (opts.elapsed < opts.missionTimeout * 0.6) exp += 300;   // 快打
        exp = Math.round(exp * 1.5);                  // veteran ×1.5
        const after = ac.state().score;
        return { bonus, exp, before, after };
    })()""")
    assert a6['bonus'] == a6['exp'], ('A6 结算分段复算', a6)
    assert a6['after'] == a6['before'] + a6['bonus'], ('A6 结算累加', a6)

    # —— A6 失败路径：不得分且连击复位 ——
    a6b = pg.evaluate("""(() => {
        const ac = __dbg.arcade;
        ac.onMissionStart();
        const base = ac.state().score;
        ac.onMissionFailed();
        return { after: ac.state().score, combo: ac.state().combo, base };
    })()""")
    assert a6b['after'] == a6b['base'] and a6b['combo'] == 1, ('A6 失败不得分+连击复位', a6b)
    print('A6 OK:', a6)

    # —— A6c (Phase 23)：SEAD 压制结算奖励——本局摧毁雷达则 +300（乘难度系数），
    #    单列 seadBonus 展示值；未摧毁则为 0（onMissionStart 清零）——
    a6c = pg.evaluate("""(() => {
        const ac = __dbg.arcade;
        // ① 未压制：seadBonus 应为 0，bonus 不含 SEAD 项
        ac.onMissionStart();
        const opts = { difficulty:'standard', damage:2, elapsed:1000, variant:'standard',
                       grade:'B', ammoLeft:0, ammoLeftPct:0, missionTimeout:306 };
        const noSead = ac.onMissionDone(opts);          // 500 + 无损伤200 = 700
        const seadOff = ac.state().seadBonus;
        // ② 压制：摧毁雷达后结算，bonus 多 300，seadBonus=300（standard×1.0）
        ac.onMissionStart();
        ac.onKill('radar');                              // 置 _radarKilled（同时计 radar 分，不影响本断言的 bonus 增量）
        const withSead = ac.onMissionDone(opts);
        const seadOn = ac.state().seadBonus;
        return { noSead, seadOff, withSead, seadOn };
    })()""")
    assert a6c['seadOff'] == 0, ('A6c: 未摧毁雷达 seadBonus 应为 0', a6c)
    assert a6c['seadOn'] == 300, ('A6c: standard 摧毁雷达 SEAD 奖励应为 300', a6c)
    assert a6c['withSead'] - a6c['noSead'] == 300, ('A6c: 压制局结算应比未压制多 300', a6c)
    print('A6c OK:', a6c)

    print('ALL A6 PASS')

import pw_harness as H
H.guarded_main(run, hard_timeout=300)
print('PASS')
