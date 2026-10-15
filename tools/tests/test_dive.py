# 俯冲攻击验证：下俯推杆加速 + 高度掉落 + 拉起爬升 + Betty ALTITUDE 触发
def run(pg):
    import pw_harness as H
    pg.evaluate("""
      window.__bettyLog = [];
      class FakeUtterance { constructor(t){ this.text = t; } }
      window.SpeechSynthesisUtterance = FakeUtterance;
      const fake = { getVoices: () => [], speak: (u) => { window.__bettyLog.push(u.text); },
                     addEventListener: () => {}, removeEventListener: () => {},
                     speaking: false, pending: [] };
      Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
    """)
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.fp)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    # 强制悬停 14u → 进 FPV → 推杆俯冲
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; "
                "__dbg.S.running=true")
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(900)
    act = pg.evaluate("!!__dbg.fp.active")
    assert act, 'FPV not entered'
    pg.evaluate("__dbg.fp.vPitch = 1.6")     # 推杆俯冲（正=机头下俯，钳位后 pitch ≈ +0.85）
    z0 = pg.evaluate("+__dbg.FLY.z.toFixed(1)")
    pg.keyboard.down('KeyW')
    for i in range(6):                        # 诊断：俯冲过程逐段采样
        pg.wait_for_timeout(350)
        d = pg.evaluate("({p:+__dbg.FLY.pitch.toFixed(2), vp:+__dbg.fp.vPitch.toFixed(2), "
                        "s:+__dbg.fp.spd.toFixed(1), a:+__dbg.FLY.alt.toFixed(1), "
                        "act:__dbg.fp.active, z:+__dbg.FLY.z.toFixed(1)})")
        print('seg%d:' % i, d)
    spd = pg.evaluate("+__dbg.fp.spd.toFixed(1)")
    alt = pg.evaluate("+__dbg.FLY.alt.toFixed(1)")
    z1 = pg.evaluate("+__dbg.FLY.z.toFixed(1)")
    print('dive: spd=%s alt=%s z %s->%s' % (spd, alt, z0, z1))
    assert spd > 18, ('dive boost not applied', spd)
    assert float(alt) < 8, ('dive did not descend', alt)
    assert float(z1) > float(z0) + 8, ('no forward motion in dive', z0, z1)
    # Betty ALTITUDE 应在俯冲掉高度时触发
    pg.wait_for_timeout(600)
    log = pg.evaluate("window.__bettyLog.join('|')")
    assert 'ALTITUDE' in log, ('Betty ALTITUDE not fired during dive', log)
    print('betty log:', log)
    # 拉起爬升：俯仰输入拉满向上 + 带功率（W 保持按住——真实拉起是带油门的）
    pg.evaluate("__dbg.fp.vPitch = -0.6")
    for i in range(5):                        # 诊断：拉起过程逐段采样
        pg.wait_for_timeout(500)
        d = pg.evaluate("({p:+__dbg.FLY.pitch.toFixed(2), vp:+__dbg.fp.vPitch.toFixed(2), "
                        "s:+__dbg.fp.spd.toFixed(1), a:+__dbg.FLY.alt.toFixed(1), "
                        "act:__dbg.fp.active})")
        print('pull%d:' % i, d)
    alt2 = pg.evaluate("+__dbg.FLY.alt.toFixed(1)")
    print('after pull-up: alt=%s' % alt2)
    assert alt2 > alt + 3, ('pull-up did not climb', alt, alt2)
    pg.keyboard.up('KeyW')
    pg.keyboard.up('KeyW')
    # 恢复平飞姿态并退出 FPV
    pg.evaluate("__dbg.fp.vPitch = 0")
    pg.keyboard.press('KeyC')
    pg.wait_for_timeout(600)
    act2 = pg.evaluate("!!__dbg.fp.active")
    assert not act2, 'FPV should be exited'

import pw_harness as H
H.guarded_main(run, hard_timeout=180)
print('PASS')
