# 一键导览验证：启动/字幕/显式退出按钮/Esc 停止三通道
# P2-B4：暂停/继续与跳段——冻结断言（暂停时 t 不推进）、恢复推进、跳段触发下一段；
# 三条退出通道中两条升级为"暂停态"退出（暂停不得改变停止语义）。
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && document.getElementById('btn-tour'))", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.click('#btn-tour')
    pg.wait_for_timeout(2500)
    cap_on = pg.evaluate("(()=>{const c=document.getElementById('tour-cap');return !!c && c.textContent.length>0})()")
    xbtn = pg.evaluate("!!document.getElementById('tour-exit')")
    btn = pg.evaluate("document.getElementById('btn-tour').classList.contains('on')")
    assert cap_on, ('tour caption missing')
    assert xbtn, ('explicit exit button missing')
    assert btn, ('tour button not armed')
    # P2-B4：暂停/跳段按钮存在且随导览显示
    ctl = pg.evaluate("""(()=>{const p=document.getElementById('tour-pause'),n=document.getElementById('tour-next');
      return {p:!!p, n:!!n, pv:p?p.style.display:null, nv:n?n.style.display:null}})()""")
    assert ctl['p'] and ctl['n'], ('P2-B4 按钮缺失', ctl)
    assert ctl['pv'] != 'none' and ctl['nv'] != 'none', ('P2-B4 按钮应随导览显示', ctl)
    # 步骤推进：5s 内应已触发 night 环境切换（step t=3.5）
    pg.wait_for_timeout(4000)
    env_now = pg.evaluate("__dbg.S.env")
    assert env_now in ('night', 'day'), ('env state', env_now)

    # —— P2-B4：暂停 = 时间冻结但导览未停止；继续 = 时间恢复推进 ——
    # 冻结基准必须在暂停生效之后取：Playwright click 派发有延迟，点击前的
    # 最后一帧（dt 钳制 ≤0.05）仍会推进 t——拿点击前的 t 当基准是测竞态不是测功能
    pg.click('#tour-pause')
    pg.wait_for_timeout(400)
    t0 = pg.evaluate("__dbg.tourState.t")
    frz = pg.evaluate("""(() => ({ paused: __dbg.tourState.paused,
                                    armed: document.getElementById('btn-tour').classList.contains('on'),
                                    ptxt: document.getElementById('tour-pause').textContent }))()""")
    assert frz['paused'] is True, ('暂停后 paused 应为 true', frz)
    assert frz['armed'], ('暂停不等于停止——btn-tour 应保持 on', frz)
    assert frz['ptxt'] == '▶ 继续', ('暂停按钮文案应为"▶ 继续"', frz)
    pg.wait_for_timeout(800)
    t1 = pg.evaluate("__dbg.tourState.t")
    assert t1 == t0, ('暂停期间 t 必须冻结', t0, t1)
    # 继续观看：paused 归 false 且时间恢复推进
    pg.click('#tour-pause')
    pg.wait_for_timeout(450)
    res = pg.evaluate("({paused: __dbg.tourState.paused, t: __dbg.tourState.t})")
    assert res['paused'] is False, ('继续后 paused 应为 false', res)
    assert res['t'] > t1, ('继续后 t 应恢复推进', t1, res['t'])
    # 跳段：idx 前进（下一段已触发），暂停态下点跳段同时解除暂停
    # 先暂停再点：tourTick 在暂停时提前 return，idx 不可能自行前进——idx 前进
    # 只能来自 next（t 重置到本段阈值 + 解除暂停）的因果。原版"运行态点跳段 +
    # 固定睡 250ms"在高负载下假失败：idx 由 rAF 循环推进，节流到 1fps 量级时
    # 250ms 可能一帧都没跑（GATE-R6 实测 idx 2→2）。
    pg.click('#tour-pause')
    pg.wait_for_function("() => __dbg.tourState.paused", timeout=8000)
    idx0 = pg.evaluate("__dbg.tourState.idx")
    pg.click('#tour-next')
    pg.wait_for_function("() => __dbg.tourState.idx > %d" % idx0, timeout=10000)
    nxt = pg.evaluate("({idx: __dbg.tourState.idx, paused: __dbg.tourState.paused})")
    assert nxt['idx'] > idx0, ('跳段应触发下一段（idx 前进）', idx0, nxt)
    assert nxt['paused'] is False, ('跳段应同时解除暂停', nxt)
    print('tour pause/next OK: freeze %.2f->%.2f, resume %.2f, idx %d->%d' % (t0, t1, res['t'], idx0, nxt['idx']))

    # 通道①：暂停态点显式退出按钮——停止语义不受暂停影响
    pg.click('#tour-pause')
    pg.wait_for_timeout(300)
    assert pg.evaluate("__dbg.tourState.paused") is True, '进入暂停态供退出验证'
    pg.click('#tour-exit')
    pg.wait_for_timeout(400)
    st = pg.evaluate("""(() => ({ armed: document.getElementById('btn-tour').classList.contains('on'),
                                   paused: __dbg.tourState.paused,
                                   pv: document.getElementById('tour-pause').style.display,
                                   nv: document.getElementById('tour-next').style.display }))()""")
    assert not st['armed'], 'exit button did not stop tour'
    assert st['paused'] is False, '停止后 paused 应复位'
    assert st['pv'] == 'none' and st['nv'] == 'none', ('停止后控制按钮应隐藏', st)
    print('exit via #tour-exit (paused) OK')
    # 通道②：暂停态 Esc
    pg.click('#btn-tour'); pg.wait_for_timeout(800)
    pg.click('#tour-pause'); pg.wait_for_timeout(300)
    assert pg.evaluate("__dbg.tourState.paused") is True
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    st2 = pg.evaluate("document.getElementById('btn-tour').classList.contains('on')")
    assert not st2, 'Esc did not stop tour'
    print('exit via Esc (paused) OK')
    # 通道③：canvas 点按
    pg.click('#btn-tour'); pg.wait_for_timeout(800)
    pg.mouse.click(640, 400); pg.wait_for_timeout(400)
    st3 = pg.evaluate("document.getElementById('btn-tour').classList.contains('on')")
    assert not st3, 'canvas click did not stop tour'
    print('exit via canvas click OK')
    print('tour OK: caption=%s, env=%s, pause/next + all 3 exit channels verified' % (cap_on, env_now))

import pw_harness as H
H.guarded_main(run, hard_timeout=150)
print('PASS')
