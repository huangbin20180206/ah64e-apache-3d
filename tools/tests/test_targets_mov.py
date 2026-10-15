# 动目标探针：卡车/坦克巡逻位移 + 命中快照同步
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.targets)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    def snap():
        return pg.evaluate("""(()=>{
          const ts=__dbg.targets.targets.filter(t=>t.mov&&t.alive);
          return ts.map(t=>({k:t.mov.kind,x:+t.group.position.x.toFixed(2),z:+t.group.position.z.toFixed(2),
            px:+t.pos.x.toFixed(2),pz:+t.pos.z.toFixed(2)}));
        })()""")
    a = snap(); pg.wait_for_timeout(1800); b = snap()
    assert len(a) >= 2, ('moving targets count', len(a))
    moved = sum(1 for p, q in zip(a, b) if abs(p['x']-q['x'])+abs(p['z']-q['z']) > 0.15)
    sync = all(abs(p['px']-p['x']) < 0.02 and abs(p['pz']-p['z']) < 0.02 for p in b)
    print('moved=%d/2, pos snapshot synced=%s, A=%s' % (moved, sync, a))
    assert moved >= 2, ('targets not moving', a, b)
    assert sync, ('pos snapshot desync', b)

import pw_harness as H
H.guarded_main(run, hard_timeout=120)
print('PASS')
