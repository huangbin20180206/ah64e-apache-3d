# 任务系统验证：发现触发简报 → 全歼触发结算 → B 重置关闭面板
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets && __dbg.targets.baseCenter)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("__dbg.S.mode = 'mission'")   # P6：任务测试声明处于任务模式（接近触发是任务模式兼容路径）
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1500)
    # ① 接近基地：飞到距基地中心 22u 处 → 发现播报 + 简报面板
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=20; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.wait_for_timeout(1800)
    st = pg.evaluate("""(()=>({
      show:document.getElementById('mission').classList.contains('show'),
      title:document.getElementById('mission-title').textContent,
      hasStats:document.getElementById('mission-body').innerHTML.includes('剩余目标'),
      mission:!!__dbg.S._mission
    }))()""")
    print('briefing:', st)
    assert st['show'] and st['hasStats'] and st['mission'], ('briefing not shown', st)
    # ② 全歼：直接摧毁全部存活目标 → 结算面板（评级 + 命中率）
    pg.evaluate("__dbg.air.enabled = false")
    pg.evaluate("""__dbg.targets.targets.forEach(t=>{ if(t.alive) __dbg.targets.destroy(t,3); })""")
    pg.wait_for_timeout(1800)
    res = pg.evaluate("""(()=>{
      const mp=document.getElementById('mission');
      return {show:mp.classList.contains('show'),
        done:!!__dbg.S._mission.done,
        hasGrade:mp.innerHTML.includes('评级'),
        hasAcc:mp.innerHTML.includes('命中率')};
    })()""")
    print('results:', res)
    assert res['done'] and res['hasGrade'] and res['hasAcc'], ('results panel missing', res)
    # ③ B 重置 → 面板关闭 + 任务清空。必须先飞离基地（>30u）：重置后若仍
    #    在 30u 发现圈内，发现逻辑会合法地同帧重新触发简报（Phase 0-0.2 修复
    #    后的预期行为），留在原地会把"清空"断言误判为失败
    pg.evaluate("__dbg.FLY.z = -20")
    pg.wait_for_timeout(400)
    pg.keyboard.press('KeyB')
    # B6+：#mission 面板由 loop-reachable 路径写（70-app.js:954/958）——等重置真正生效
    # 再断言，替代固定睡 800ms（分类器真候选 L40→L42）
    pg.wait_for_function("""() => !__dbg.S._mission && __dbg.S._baseFound === false
        && !document.getElementById('mission').classList.contains('show')""", timeout=15000)
    fin = pg.evaluate("({mission:__dbg.S._mission, found:__dbg.S._baseFound, show:document.getElementById('mission').classList.contains('show')})")
    assert not fin['mission'] and fin['found'] is False and not fin['show'], ('reset did not close mission', fin)
    print('reset OK:', fin)
    # ④ 再次接近 → 简报重新触发（重置后可再次触发是本修复的核心行为）
    pg.evaluate("__dbg.FLY.z = 20")
    pg.wait_for_function("() => !!__dbg.S._mission && document.getElementById('mission').classList.contains('show')", timeout=15000)
    again = pg.evaluate("({mission:__dbg.S._mission, show:document.getElementById('mission').classList.contains('show')})")
    assert again['mission'] and again['show'], ('briefing not re-triggered after reset', again)
    print('briefing re-triggered after reset OK:', again)

import pw_harness as H
H.guarded_main(run, hard_timeout=120)
print('PASS')
