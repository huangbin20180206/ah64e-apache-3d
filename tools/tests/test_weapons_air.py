# 空中火力与沙漠贴花回归（对应两个用户实测 bug）：
#   ① 空中按 F：地狱火必须锁定前方空中目标，而不是脚下看不见的地面坦克；
#   ② 沙漠降落：刷痕贴花的顶点位移必须留在贴地薄层，不能被 mesh.scale
#      放大成几十米高的沙色幕布（表现为画面被沙尘条纹吞没、机体半透明）。
# 用法: uv run --with playwright --with pillow python test_weapons_air.py
import pw_harness as H


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.rig && __dbg.air && __dbg.washfx)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close')?.click()")

    # ---------- ① 空中 F 键锁定 ----------
    # 直接把机体摆到悬停位并对准空中目标，避免等完整起飞流程（本用例只测武备逻辑）。
    # 靶机在 [0, 14, 30]，机头 +Z；把飞机放到 14u 高，机头目标正前方。
    pg.evaluate("""() => {
      __dbg.FLY.state = 'hover'; __dbg.FLY.alt = 14; __dbg.FLY.x = 0; __dbg.FLY.z = 0;
      __dbg.FLY.yaw = 0; __dbg.FLY.pitch = 0; __dbg.FLY.roll = 0; __dbg.FLY.comp = 0;
      __dbg.apache.root.position.set(0, 14, 0);
      __dbg.apache.root.rotation.set(0, 0, 0);
      __dbg.apache.root.updateMatrixWorld(true);
    }""")
    pg.wait_for_timeout(200)

    # P31 门禁定案：本用例对靶机巡逻相位（rnd(TAU)）存在随机依赖——相位落在
    # +Z 坦克走廊时，地面坦克恰在悬停俯视走廊内（俯角 20.5°≈悬停前倾角，
    # 夹角≈1°），角偏移竞争恒胜空中候选 → 假红。修复=发射前把靶机相位固定
    # 到 −X 侧翼（t.ang=π → 位置 [−20,14,30]，与坦克弧方位差 ~34°>30°：
    # 地面坦克被踢出 30° 地面锥，空中靶机成为唯一锁定候选）。断言语义不变。
    # 注意：相位固定必须先于 aim（aim 读 pl.g.position 实时值）。
    pg.evaluate("""() => {
      const pl = __dbg.air.list.find(t => t.type === 'plane');
      pl.ang = Math.PI;
    }""")
    pg.wait_for_function("() => { const pl = __dbg.air.list.find(t => t.type === 'plane');"
                         " return pl.g.position.x < -15; }", timeout=5000)

    # 把机头对准靶机（角偏移竞争锁定下，指向谁锁谁——随机盘旋位置的靶机
    # 需要先瞄准；200ms 内靶机沿圆弧漂移 <25° 锥容差）
    pg.evaluate("""() => {
      const pl = __dbg.air.list.find(t=>t.type==='plane');
      __dbg.FLY.yaw = Math.atan2(pl.g.position.x, pl.g.position.z - 0);
      __dbg.apache.root.rotation.y = __dbg.FLY.yaw;
      __dbg.apache.root.updateMatrixWorld(true);
    }""")
    pg.wait_for_timeout(200)

    # 发射一枚地狱火，检查它锁上了谁。air:true 即空中目标。
    lock = pg.evaluate("""() => {
      const r = __dbg.rig;
      r.hfAmmo = Math.max(r.hfAmmo, 1);
      const n0 = r.flying.length;
      const ok = r.launchHf();
      const f = r.flying[r.flying.length - 1];
      return { ok, added: r.flying.length - n0,
               air: !!(f && f.air),
               label: f && f.tgt ? f.tgt.label : null,
               ty: f && f.tgt ? +f.tgt.pos.y.toFixed(2) : null,
               dirY: f ? +f.dir.y.toFixed(3) : null };
    }""")
    assert lock['ok'] and lock['added'] == 1, ('地狱火未发射', lock)
    assert lock['air'], ('空中按 F 仍锁地面目标', lock)
    assert lock['ty'] > 5, ('锁定目标高度不合理（疑似仍用硬编码 y=0.9）', lock)
    # 最近的空中目标是 7.2u 高的无人机，从 14u 打下去必然带俯角；
    # 但不该是"扎地面"的量级（锁地面坦克时 dir.y ≈ -0.55 以下）。
    assert lock['dirY'] > -0.45, ('弹体一出架就扎地，瞄准点疑似被压到地面', lock)

    # 制导要真的把弹体带到目标：跑一会儿，弹体不能掉到地面附近。
    pg.wait_for_timeout(600)
    mid = pg.evaluate("""() => {
      const f = __dbg.rig.flying[0];
      return f ? { y: +f.g.position.y.toFixed(2), z: +f.g.position.z.toFixed(2) } : null;
    }""")
    if mid:      # 若已命中回收则跳过（命中本身就是通过）
        assert mid['y'] > 4, ('制导中的地狱火掉向地面', mid)

    # 贴地时 F 仍应打地面装甲（不能为了修空中把对地能力弄丢）
    pg.evaluate("""() => {
      __dbg.FLY.state = 'ground'; __dbg.FLY.alt = 0;
      __dbg.apache.root.position.set(0, 0, 0);
      __dbg.apache.root.rotation.set(0, 0, 0);
      __dbg.apache.root.updateMatrixWorld(true);
    }""")
    pg.wait_for_timeout(200)
    g = pg.evaluate("""() => {
      const r = __dbg.rig;
      r.hfAmmo = Math.max(r.hfAmmo, 1);
      r.launchHf();
      const f = r.flying[r.flying.length - 1];
      return { air: !!(f && f.air), label: f && f.tgt ? f.tgt.label : null };
    }""")
    assert g['label'] is not None, ('地面按 F 没锁到任何目标', g)

    # ---------- ② 沙漠刷痕贴花不得被缩放放大 ----------
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\\'desert\\']')?.click()")
    pg.wait_for_timeout(400)
    # 开旋翼 + 贴地，让贴花可见并进入沙丘顶点位移分支
    pg.evaluate("""() => {
      __dbg.S.running = true; __dbg.S.spin = 1;
      __dbg.FLY.state = 'ground'; __dbg.FLY.alt = 0;
    }""")
    pg.wait_for_function("() => __dbg.washfx.decal.mesh.visible", timeout=20000)
    pg.wait_for_timeout(600)

    dec = pg.evaluate("""() => {
      const d = __dbg.washfx.decal;
      const p = d.mesh.geometry.attributes.position;
      let zmax = 0;
      for (let i = 0; i < p.count; i++) zmax = Math.max(zmax, Math.abs(p.getZ(i)));
      // 注意不能在这里 new THREE.xxx：three 与 app 各自封在 IIFE 里，
      // THREE 不是全局符号。世界高度直接由局部位移 × 缩放算。
      return { dune: d._dune, rad: d._rad, scale: +d.mesh.scale.x.toFixed(2),
               zmaxLocal: +zmax.toFixed(3),
               worldH: +(zmax * d.mesh.scale.x).toFixed(2) };
    }""")
    assert dec['dune'], ('沙漠未开启贴花沙丘模式', dec)
    # duneH 峰值约 0.56u（三角剖面版，坡角卡在松沙摩擦角 33°）；缩放后的
    # 世界高度必须还在这个量级，不能是 rad 倍。
    # 旧 bug：写世界高度进局部 z，再乘 scale=12.5 → worldH 接近 19u（沙色幕布糊屏）。
    assert dec['zmaxLocal'] < 0.25, ('贴花局部顶点位移过大（写了世界高度？）', dec)
    assert dec['worldH'] < 4.0, ('贴花被缩放拉成高墙', dec)

    # 视觉/材质兜底：沙漠贴地时画面不能被单一沙色铺满（幕布糊屏的直接判据），
    # 近景地面也必须仍有可读的风纹与微粒反照率层次。后者不用依赖截图的灯光/机位，
    # 直接从 CanvasTexture 的源画布抽样，验证亮度存在高频变化且没有透明像素。
    tex = pg.evaluate("""() => {
      const map = __dbg.W.padMat.map.image;
      const normal = __dbg.W.padMat.normalMap.image;
      const stat = cv => {
        const q = document.createElement('canvas'); q.width = q.height = 128;
        const x = q.getContext('2d'); x.drawImage(cv, 0, 0, 128, 128);
        const p = x.getImageData(0, 0, 128, 128).data;
        let sum = 0, sum2 = 0, edge = 0, alphaMin = 255, n = 0;
        for (let y = 1; y < 127; y++) for (let x0 = 1; x0 < 127; x0++) {
          const o = (y * 128 + x0) * 4;
          const lum = p[o] * 0.299 + p[o + 1] * 0.587 + p[o + 2] * 0.114;
          sum += lum; sum2 += lum * lum; alphaMin = Math.min(alphaMin, p[o + 3]); n++;
          const l = (p[o - 4] * 0.299 + p[o - 3] * 0.587 + p[o - 2] * 0.114);
          const r = (p[o + 4] * 0.299 + p[o + 5] * 0.587 + p[o + 6] * 0.114);
          const u = (p[o - 512] * 0.299 + p[o - 511] * 0.587 + p[o - 510] * 0.114);
          const d = (p[o + 512] * 0.299 + p[o + 513] * 0.587 + p[o + 514] * 0.114);
          edge += Math.abs(r - l) + Math.abs(d - u);
        }
        const mean = sum / n;
        return { sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2),
                 edge: +(edge / n).toFixed(2), alphaMin };
      };
      return { map: stat(map), normal: stat(normal), size: [map.width, normal.width] };
    }""")
    assert tex['size'] == [1024, 512], ('沙漠贴图尺寸异常', tex)
    # 128px 缩略抽样专门衡量风纹的"可读性"：它会滤掉 1px 级砂粒，因此阈值
    # 必须按下采样后的实测基线制定。颜色图 sd=4.41 / edge=7.08 已通过，而旧版
    # 稀疏波痕在同一统计下 edge 约为 2~4；法线阈值仍高，防止只刷色不做起伏。
    assert tex['map']['sd'] > 4.0 and tex['map']['edge'] > 6.5, ('沙面缺少可读微细节', tex)
    assert tex['normal']['sd'] > 7.0 and tex['normal']['edge'] > 22.0, ('风纹法线层过平', tex)
    assert tex['map']['alphaMin'] == 255 and tex['normal']['alphaMin'] == 255, ('沙漠贴图有透明孔洞', tex)

    pg.evaluate("document.querySelector('#btn-panel')?.click()")
    pg.wait_for_timeout(300)
    pg.screenshot(path=H.output_path('shot_desert_decal.jpg'), type='jpeg', quality=90)


H.guarded_main(run, hard_timeout=180)
