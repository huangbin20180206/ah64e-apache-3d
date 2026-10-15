# Betty 语音警告 + 转弯侧倾验证：ALTITUDE/AMMO 触发、左转压左坡度
def run(pg):
    import pw_harness as H
    # Betty 构造在页面脚本里已读取原生 speechSynthesis（this.ok 判定），
    # 运行时把 window.speechSynthesis 换成记录器即可拦截 speak() 调用。
    # 注意：speechSynthesis 是 getter-only 访问器属性，普通赋值静默失败，
    # 必须 Object.defineProperty 定义自有属性遮蔽原型链 getter
    pg.evaluate("""
      window.__bettyLog = [];
      class FakeUtterance { constructor(t){ this.text = t; } }
      window.SpeechSynthesisUtterance = FakeUtterance;
      const fake = { getVoices: () => [], speak: (u) => { window.__bettyLog.push(u.text); },
                     addEventListener: () => {}, removeEventListener: () => {},
                     speaking: false, pending: [] };
      Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
    """)
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.rig)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    # 强制悬停 → 制造低空快速下降（ALTITUDE）+ 弹药告罄（AMMO）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=8; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.wait_for_timeout(600)
    pg.evaluate("__dbg.FLY.alt = 1.5")
    pg.evaluate("__dbg.rig.hfAmmo = 1; __dbg.rig.gunAmmo = 10")
    pg.wait_for_timeout(1200)
    # ALTITUDE 走真实降落流程：悬停 8u 切'down'，下降穿越 5u 阈值时
    # 下降率 >2.5u/s → 触发（悬停态 alt 跳变会被状态机拉回，测不到）
    pg.evaluate("__dbg.FLY.state = 'down'")
    pg.wait_for_timeout(8000)
    log = pg.evaluate("window.__bettyLog.join('|')")
    print('betty log:', log)
    assert 'ALTITUDE' in log, ('ALTITUDE not spoken', log)
    assert 'AMMO' in log, ('AMMO not spoken', log)
    # 转弯侧倾：悬停中按住 A（左转）→ _bankR 应为负（左压坡度）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14")
    pg.keyboard.down('KeyA'); pg.wait_for_timeout(1200)
    bank = pg.evaluate("+(__dbg.S._bankR||0).toFixed(3)")   # 按住期间采样（松手即回平）
    pg.keyboard.up('KeyA')
    pg.wait_for_timeout(200)
    print('bank while holding A:', bank)
    assert bank < -0.1, ('bank not leaning left', bank)

import pw_harness as H
H.guarded_main(run, hard_timeout=120)
print('PASS')
