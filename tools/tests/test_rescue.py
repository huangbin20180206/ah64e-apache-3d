# 绞车救援全流程验证：K 放绞车 → 吊钩落地挂接 → 收绞车救起 → 送坪完成
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rescue)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1500)
    # 悬停于幸存者上方 8u（幸存者 desert (26,-14)）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.keyboard.press('KeyC')                    # 先进 FPV（状态机让位）
    pg.wait_for_timeout(900)
    # 再设高度 8 与位置（FPV 接管后 alt 由 FPV 驱动）
    pg.evaluate("__dbg.FLY.alt=8; __dbg.FLY.x=26; __dbg.FLY.z=-14; __dbg.S._alt=8")
    # B6+：rescue.ok 由 48-rescue.js:185/200 updater 每帧写（分类器真候选 L14→L20）
    pg.wait_for_function("() => !!__dbg.rescue.ok", timeout=15000)
    act = pg.evaluate("!!__dbg.fp.active")
    assert act, 'FPV not entered'
    st0 = pg.evaluate("({ok:__dbg.rescue.ok, state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, "
                      "alt:+__dbg.FLY.alt.toFixed(1)})")
    print('initial:', st0)
    assert st0['ok'], 'no survivor on desert'
    # ① K 放绞车 → deploying
    # B12b：加重试——全量负载下按 K 会**整键丢失**（全量实测：15s 内状态从未变
    # deploying，且 initial 打印过、after K 没打印，定位唯一）。K 是**切换**语义
    #（deploying/holding 下再按转 retracting），故每轮先确认未在放绳再按。
    def deploy_winch(attempts=3):
        for _ in range(attempts):
            if pg.evaluate("['deploying','holding'].indexOf(__dbg.rescue.state) >= 0"):
                return True
            pg.keyboard.press('KeyK')
            try:
                pg.wait_for_function("() => ['deploying', 'holding'].indexOf(__dbg.rescue.state) >= 0", timeout=5000)
                return True
            except Exception:
                pass
        return False
    assert deploy_winch(), 'G-① K 放绞车连按 3 次未生效（非时序问题，需查按键通路）'
    st1 = pg.evaluate("({state:__dbg.rescue.state, rope:__dbg.rescue.rope.visible, "
                      "rootY:+__dbg.apache.root.position.y.toFixed(2), "
                      "toast:document.getElementById('toast').textContent})")
    print('after K:', st1)
    assert st1['state'] in ('deploying', 'holding'), ('winch not deploying', st1)
    rope_vis = pg.evaluate("__dbg.rescue.rope.visible")
    assert rope_vis, 'rope not visible'
    print('deploying OK, rope visible')
    # ② 吊钩落地 → 自动挂接 → lifting（绳长 0.2→~6.9 @3u/s ≈ 2.3s）
    # B6+：本测试是一条状态链（deploying→lifting→aboard→delivered），原实现靠固定睡眠
    # 分段；改成条件等待后若只改上游，下一段的固定睡眠会先到而状态还没推进。故整条链
    # 全部改为"等该状态出现"，与帧率无关。
    pg.wait_for_function("() => __dbg.rescue.state === 'lifting'", timeout=20000)
    st2 = pg.evaluate("__dbg.rescue.state")
    assert st2 == 'lifting', ('not lifting after hook lands', st2)
    print('attached, lifting OK')
    # ③ 收绞车 → 幸存者上升 → aboard（绳 6.9→0.36 @2.2u/s ≈ 3s）
    pg.wait_for_function("() => __dbg.rescue.state === 'aboard'", timeout=20000)
    st3 = pg.evaluate("({state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible})")
    assert st3['state'] == 'aboard', ('not aboard after lift', st3)
    print('aboard OK:', st3)
    # ④ 送回停机坪：低空悬停于坪心 → delivered
    pg.evaluate("__dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.alt=3; __dbg.S._alt=0")
    pg.wait_for_function("() => __dbg.rescue.state === 'delivered'", timeout=20000)
    st4 = pg.evaluate("({state:__dbg.rescue.state, gvis:__dbg.rescue.g.visible, svis:__dbg.rescue.smoke.visible})")
    print('delivered:', st4)
    assert st4['state'] == 'delivered', ('not delivered', st4)
    assert not st4['gvis'] and not st4['svis'], ('survivor/beacon should hide after delivery', st4)

import pw_harness as H
H.guarded_main(run, hard_timeout=180)
print('PASS')
