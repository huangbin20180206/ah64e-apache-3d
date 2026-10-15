# 沙漠场景升级验证（2026-09-02）：远景巨型沙丘 + brownout 遮蔽标定
# 断言走 __dbg 数值；截图存证（brownout 场景 + 远景沙丘地平线）
def run(pg):
    import pw_harness as H
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.washfx)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.wait_for_timeout(1200)

    # 1) 远景巨型沙丘：可见 + 峰值 ≥3u（背景山脉感）
    st = pg.evaluate("""(()=>{
      const m=__dbg.W.duneFar;
      let mx=0; const p=m.geometry.attributes.position;
      for(let i=0;i<p.count;i+=7) mx=Math.max(mx,p.getY(i));
      return {vis:m.visible, peak:+mx.toFixed(2)};
    })()""")
    assert st['vis'], ('duneFar visible', st)
    assert st['peak'] >= 3.0, ('duneFar peak', st)
    print('duneFar:', st)
    # 基地扇区（|方位角|<0.45, r<48）必须平地——靶标基地 35~48u 布在走廊上
    flat = pg.evaluate("""(()=>{
      const p=__dbg.W.duneFar.geometry.attributes.position;
      let mx=-9;
      for(let i=0;i<p.count;i++){
        const x=p.getX(i), z=p.getZ(i);
        if(Math.hypot(x,z)<48 && Math.abs(Math.atan2(x,z))<0.45 && p.getY(i)>mx) mx=p.getY(i);
      }
      return +mx.toFixed(3);
    })()""")
    assert flat < 0.05, ('base sector not flat', flat)
    print('base sector flat: max y =', flat)

    # 2) brownout：低空悬停 → 场地雾密度爬升到吞没级（fogBase+≥0.02）
    pg.evaluate("__dbg.FLY.fp=true; __dbg.FLY.state='hover'; __dbg.FLY.alt=3.5; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0")
    pg.keyboard.press('Space')
    pg.wait_for_timeout(7000)
    fog = pg.evaluate("(()=>({d:__dbg.W.scene.fog.density, base:__dbg.W.fogBase.d}))()")
    assert fog['d'] - fog['base'] >= 0.02, ('brownout fog add', fog)
    print('brownout fog: base=%.4f now=%.4f' % (fog['base'], fog['d']))
    pg.evaluate("__dbg.orbit.tPhi = 1.25; __dbg.orbit.tDist = 15")
    pg.wait_for_timeout(900)
    pg.screenshot(path=H.output_path('shot_desert_brownout.jpg'), type='jpeg', quality=90)

    # 3) 升高脱离 → 雾退场
    pg.evaluate("__dbg.FLY.alt=16; __dbg.S._alt=0")
    pg.wait_for_timeout(6000)
    fog2 = pg.evaluate("(()=>({d:__dbg.W.scene.fog.density, base:__dbg.W.fogBase.d}))()")
    assert fog2['d'] - fog2['base'] < 0.008, ('brownout clears', fog2)
    print('clear fog: base=%.4f now=%.4f' % (fog2['base'], fog2['d']))

    # 4) 远景沙丘地平线存证（机位抬高：沙丘剪影要高出地平线才读得出）
    pg.evaluate("__dbg.FLY.fp=false; __dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.S._alt=0")
    pg.evaluate("__dbg.orbit.tPhi = 1.52; __dbg.orbit.tDist = 11; __dbg.orbit.tTheta = 2.2")
    pg.wait_for_timeout(900)
    pg.screenshot(path=H.output_path('shot_desert_fardunes.jpg'), type='jpeg', quality=90)

import pw_harness as H
H.guarded_main(run, hard_timeout=240)
print('PASS')
