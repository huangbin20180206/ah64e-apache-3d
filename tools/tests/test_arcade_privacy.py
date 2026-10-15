# Phase 18 轻街机层：A8 隐私/禁用存储降级（独立上下文，需 add_init_script + reload）
# 模拟存储禁用（localStorage 读写抛错）：app 所有存储访问须被 try/catch 吞掉（无 pageerror），
# arcade 降级为纯内存运行——结算后 hi 读回本局分、score 正常累加。
# 其余门禁见 test_arcade.py（A1-A5/A9/A10）/ test_arcade_settle.py（A6）/ test_arcade_hi.py（A7）。

def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.arcade)", timeout=60000)

    # 覆写 localStorage 为抛错桩（模拟隐私模式/存储禁用），reload 后对页面生效
    pg.add_init_script("""
      (() => {
        const blocked = () => { throw new DOMException('storage disabled', 'QuotaExceededError'); };
        try {
          Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { return { getItem: blocked, setItem: blocked, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 }; }
          });
        } catch (e) { /* 只读场景忽略 */ }
      })()
    """)
    pg.reload()
    pg.wait_for_function("() => !!(window.__dbg && __dbg.arcade)", timeout=60000)

    # 结算（会走 _maybePersistHi / noteVariant 写存储路径）须被吞掉，内存降级可用
    a8 = pg.evaluate("""(() => {
        const ac = __dbg.arcade;
        __dbg.setMissionDifficulty('veteran');
        ac.onMissionStart();
        const bonus = ac.onMissionDone({ difficulty:'veteran', damage:1, elapsed:50, variant:'standard',
                                         grade:'A', ammoLeft:40, ammoLeftPct:60, missionTimeout:306 });
        const st = ac.state();
        return { bonus, score: st.score, hiVet: ac.hi('veteran') };
    })()""")
    assert a8['score'] > 0 and a8['bonus'] > 0, ('A8 存储禁用下结算可运行', a8)
    assert a8['hiVet'] == a8['score'], ('A8 内存降级 hi 读回本局分', a8)

    # guarded_main 尾部统一校验 pageerror/console.error——若任何存储访问未吞则将在此报失败。
    print('A8 OK:', a8)

    print('ALL A8 PASS')

import pw_harness as H
H.guarded_main(run, hard_timeout=300)
print('PASS')
