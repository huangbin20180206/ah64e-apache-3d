# 导览全程回归：合成键真正生效（启旋/起飞/降落）+ 时间轴推进到结束
# 等待方式用导览游戏时间锚定（帧率无关）：tourTick 的 dt 钳制 0.05 下，
# 低帧率场景（水面/沙漠特效）游戏时间会慢于墙钟，固定 sleep 断言会漂移
# （2026-09-05 实测水面段 21s 墙钟只推进 <20s 游戏时间，47s 段迟 1 帧未触发）。
# 断言本身不变——t 锚定反而更严格：验证的是时间轴真的推进到位。
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && document.getElementById('btn-tour'))", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.click('#btn-tour')
    # t=13.5 启旋 → t=25 起飞；t≥26.5 时应在爬升/悬停（t=25 段已触发）
    pg.wait_for_function("() => __dbg.tourState && __dbg.tourState.t >= 26.5", timeout=90000)
    st = pg.evaluate("({run:__dbg.S.running, spin:+(__dbg.S.spin||0).toFixed(2), fly:__dbg.FLY.state, terr:__dbg.W.terrainKey})")
    print('during-tour(t>=26.5):', st)
    assert st['spin'] > 0.3 and st['fly'] in ('up', 'hover') and st['terr'] == 'desert', ('tour keys not working', st)
    # t=34 切水面、t=41 降落、t=47 切回停机坪+爆炸视图；t≥47.5 时应已到爆炸段
    pg.wait_for_function("() => __dbg.tourState && __dbg.tourState.t >= 47.5", timeout=90000)
    st2 = pg.evaluate("({terr:__dbg.W.terrainKey, fly:__dbg.FLY.state, env:__dbg.S.env})")
    print('during-tour(t>=47.5):', st2)
    assert st2['terr'] == 'pad' and st2['env'] == 'day', ('explode/pad step not reached', st2)
    # t=59 结束段触发 tourStop(true) → on=false；等导览自然收尾
    pg.wait_for_function("() => __dbg.tourState && !__dbg.tourState.on", timeout=90000)
    fin = pg.evaluate("(()=>({on:document.getElementById('btn-tour').classList.contains('on'), terr:__dbg.W.terrainKey}))()")
    print('finish:', fin)
    assert not fin['on'], 'tour should have finished'
    print('tour completed cleanly')

import pw_harness as H
H.guarded_main(run, hard_timeout=240)
print('PASS')
