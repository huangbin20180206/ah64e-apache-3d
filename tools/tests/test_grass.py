# 草地场景升级验证（2026-09-02）：全域均匀密度 / 停机压痕 / 细长草叶屑
# 断言走 __dbg.washfx 内部数值，像素仅存证
import io
import pw_harness as H
from PIL import Image

def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.washfx)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"grass\"]').click()")
    pg.wait_for_timeout(1500)

    # 1) 草叶总量：默认画质 1 档 × particles 0.75 → 51000
    n = pg.evaluate("__dbg.washfx.grass.mesh.geometry.instanceCount")
    assert n >= 40000, ('grass instanceCount', n)

    # 2) 全域均匀：按半径分箱数密度，内圈(r<5) vs 中圈(7-12) vs 外圈(14-18)
    #    密度差应 <18%（羽化只发生在最外 18%）
    dens = pg.evaluate("""(()=>{
      const a=__dbg.washfx.grass.mesh.geometry.attributes.aOff.array, N=a.length/4;
      const b=[0,0,0,0];
      for(let i=0;i<N;i++){const r=Math.hypot(a[i*4],a[i*4+1]);
        if(r<5)b[0]++;else if(r<7)b[1]++;else if(r<12)b[1]++;else if(r<14)b[2]++;else if(r<18.5)b[3]++;}
      const area=[Math.PI*25,Math.PI*(144-25),Math.PI*(196-144),Math.PI*(342.25-196)];
      return b.map((v,i)=>+(v/area[i]).toFixed(1));
    })()""")
    inner, mid, outer1, outer2 = dens
    assert abs(inner - mid) / mid < 0.18, ('density uniform inner/mid', dens)
    assert abs(outer1 - mid) / mid < 0.18, ('density uniform outer1', dens)
    assert outer2 >= mid * 0.62, ('density feather edge', dens)
    print('grass density/u2 by ring [r<5, 5-12, 12-14, 14-18.5]:', dens, 'count=', n)

    # 3) 碎草几何 = 细长叶片（4 顶点双三角），不再是 3 顶点三角
    gv = pg.evaluate("__dbg.washfx.debris.mesh.geometry.attributes.position.count")
    assert gv == 4, ('debris blade verts', gv)
    print('debris verts =', gv)

    # 4) 停机压痕：启动引擎（直升机停在地上）→ spin 爬升 → 下洗盖章
    pg.keyboard.press('Space')
    pg.wait_for_timeout(4500)
    imp = pg.evaluate("__dbg.washfx.imprint.state()")
    assert imp['stamps'] >= 2, ('imprint stamps', imp)
    assert imp['visible'], ('imprint visible', imp)
    print('imprint:', imp)

    # 5) 存证截图：俯视草场（均匀性肉眼核）+ 压痕特写
    pg.evaluate("__dbg.orbit.tPhi = 0.42; __dbg.orbit.tDist = 24; __dbg.orbit.tTheta = 0.8")
    pg.wait_for_timeout(900)
    pg.screenshot(path=H.output_path('shot_grass_uniform.jpg'), type='jpeg', quality=90)
    pg.evaluate("__dbg.orbit.tPhi = 1.30; __dbg.orbit.tDist = 9")
    pg.wait_for_timeout(900)
    pg.screenshot(path=H.output_path('shot_grass_imprint.jpg'), type='jpeg', quality=90)

H.guarded_main(run, hard_timeout=240)
print('PASS')
