# 湖面倒影验证（P3-7）：水面门控 + 绑定结构 + 镜像数学（alt/yaw 动态跟随）
# + 染色探针可见性（悬停构图同框）+ 切场地零残留；零报错由护具判定。
# 取景依据：悬停 HOVER=14u 时镜像在水面下 ~12-17u，相机 dist 52 / phi 0.88
# 远距侧俯，视线越过浮筒平台边缘（deck r=6.8u，视线在 y=0 处距心 ~8.3-10.5u），
# 机身与倒影同框；低悬停(alt 3)时镜像被平台 deck 遮挡属物理正确，不做可见断言。
# 用法: uv run --with playwright --with pillow python test_reflection.py
import io
import pw_harness as H
from PIL import Image


def count(im, pred, x_min=0, y_min=0):
    w, h = im.size
    y0 = int(h * y_min)
    return sum(1 for y in range(y0, h) for x in range(x_min, w)
               if pred(*im.getpixel((x, y))))


# 染色探针判定：倒影材质统一浓染（线性 6,0.01,0.01），镜像像素穿过 0.62
# 半透明湖水 + 24% 距离雾 + bloom 后实测约 (240,130,143)——红主占优 1.5 倍；
# 水面碎金/天空白色 r≈g≈b、HUD 琥珀字 r/g≈1.4，均被 1.5 倍判据排除。
# 正午环境航行灯灭灯，画面内无其它红色像素源。
# 计数一律 x_min=140：画面左缘 x≤66 是常亮的 HUD 仪表琥珀/红色警告灯
# （与倒影无关，探针实测 ~1780px），镜像投影在画面中心 x≈643 不受影响。
RED = lambda r, g, b: r > 150 and r > 1.5 * g and r > 1.5 * b


def run(pg):
    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.refl)", timeout=60000)
    pg.evaluate("document.querySelector('#hint-close') && document.querySelector('#hint-close').click()")
    pg.evaluate("document.querySelector('#btn-panel') && document.querySelector('#btn-panel').click()")

    # 1) 初始 pad：倒影必须未启用且镜像组隐藏
    g0 = pg.evaluate("({ en: __dbg.refl.enabled, vis: __dbg.refl.group.visible })")
    assert g0['en'] is False and g0['vis'] is False, ('pad 上不应有倒影', g0)

    # 2) 切湖面：门控开启 + 绑定结构完整 + 镜像容器变换数学
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"water\"]').click()")
    pg.wait_for_timeout(700)
    st = pg.evaluate("""(() => { const r = __dbg.refl;
      return { en: r.enabled, vis: r.group.visible, pairs: r._pairs.length,
               sy: r.group.scale.y, gy: r.group.position.y, py: r.planeY, rate: r._rate }; })()""")
    assert st['en'] and st['vis'], ('water 应启用倒影', st)
    assert st['pairs'] > 40, ('镜像平行表应覆盖整机节点', st)
    assert st['sy'] == -1 and abs(st['gy'] - 2 * st['py']) < 1e-9, ('镜像容器：y 翻转 + 平面倍移', st)
    assert st['rate'] > 0, ('默认画质倒影更新率应 > 0', st)
    # 镜像网格统一水材质；夜灯镜像灯珠（bindMirror 恢复自发光）是唯一例外
    mat = pg.evaluate("""(() => { let n = 0, bad = 0, noRe = false;
      for (const [s, d] of __dbg.refl._pairs) {
        if (s.isMesh) { if (d.material === __dbg.refl.mat) n++; else bad++;
          if (s.userData.noRefl && d.visible) noRe = true; } }
      return { n, bad, noRe }; })()""")
    assert mat['n'] > 40, ('镜像网格应统一倒影材质', mat)
    assert mat['bad'] <= 25, ('非倒影材质的镜像网格过多（灯珠例外）', mat)
    assert not mat['noRe'], ('noRefl 特效网格（桨盘残影）不应出现在倒影中', mat)
    # 旋翼主节点成对且可见性同步（动画节点同步机制的抽样证据）。
    # 注意用运行时权威名 MainRotor_Pivot（60-model 绑定）——GLTFLoader 会把
    # 'Cylinder.010' 这类带点名字净化成 'Cylinder_010'，字面匹配旧名必落空
    rot = pg.evaluate("""(() => { for (const [s, d] of __dbg.refl._pairs)
        if (s.name === 'MainRotor_Pivot') return { sv: s.visible, dv: d.visible };
      return null; })()""")
    assert rot and rot['dv'] == rot['sv'], ('旋翼主节点镜像可见性应同步', rot)

    # 档位 2（实时同步）：跳帧更新率会让 pivot 落后 1-2 帧，振动差干扰数值断言
    pg.evaluate("__dbg.refl.setUpdateRate(2)")

    # 3) 动态跟随：强制悬停（自定高度须 FLY.fp=true 让位，S._alt 同帧清零）
    pg.evaluate("__dbg.FLY.fp=true; __dbg.FLY.state='hover'; __dbg.FLY.alt=3; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0")
    pg.wait_for_timeout(900)
    p1 = pg.evaluate("(() => ({ ry: __dbg.apache.root.position.y, py: __dbg.refl.pivot.position.y }))()")
    # 镜像世界 y = 容器 y(2*planeY) - pivot y：与主机世界 y 的理论镜像值比对
    mirror_w = st['gy'] - p1['py']
    mirror_th = 2 * st['py'] - p1['ry']
    assert abs(mirror_w - mirror_th) < 1e-6, ('镜像世界 y 数学', mirror_w, mirror_th)
    # 改高度时把 S._alt 设回改前值（3）：loop 跟随器按 (alt−S._alt)×0.92 增量补差，
    # 悬停中复位 S._alt=0 会重复施加全程增量，相机目标永久过冲抬高（曾把
    # 镜像挤出画面底边——探针 dump 定案）。S._alt=0 仅适用于"从地面起跳"。
    pg.evaluate("__dbg.FLY.alt=8; __dbg.S._alt=3")
    pg.wait_for_timeout(900)
    p2 = pg.evaluate("(() => ({ ry: __dbg.apache.root.position.y, py: __dbg.refl.pivot.position.y }))()")
    assert abs(p2['ry'] - p1['ry']) > 3, ('主机应实际爬升', p1, p2)
    assert abs((p2['py'] - p1['py']) - (p2['ry'] - p1['ry'])) < 1e-4, ('镜像位置随 alt 等幅跟随', p1, p2)

    # 4) yaw 跟随：pivot 四元数逐帧拷贝主机姿态
    pg.evaluate("__dbg.FLY.yaw=1.3")
    pg.wait_for_timeout(900)
    q = pg.evaluate("""(() => { const a = __dbg.apache.root.quaternion, b = __dbg.refl.pivot.quaternion;
      return { d: Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z)+Math.abs(a.w-b.w),
               y: Math.abs(a.y) }; })()""")
    assert q['y'] > 0.5, ('yaw 应已转到机体姿态上', q)
    assert q['d'] < 1e-6, ('镜像姿态应逐帧同步主机', q)

    # 5) 悬停构图同框：自然取证 + 染色探针（客观像素计数）
    #    取景几何（探针实测校准）：看向镜像点(深度D)的视线在水面处距平台心
    #    camH·D/(camY+D)——近陡机位该值落入浮台半径内(r≈6.8-7.1u)时镜像被
    #    平台整体遮挡（低悬停时更甚，物理正确）；dist 64/phi 0.82 侧舷时
    #    最浅的滑橇镜像(D≈12.7)越缘 8.5u、机身其余更深越缘更多，且角差
    #    ~14.9° < 半 FOV 17.3°，整机+镜像同框。染色探针实测 ~2800px。
    pg.evaluate("__dbg.FLY.alt=14; __dbg.FLY.yaw=0; __dbg.S._alt=8")
    pg.evaluate("__dbg.orbit.tTheta=1.57; __dbg.orbit.tPhi=0.82; __dbg.orbit.tDist=64")
    pg.wait_for_timeout(2200)
    pg.screenshot(path=H.output_path('shot_reflect_natural.jpg'), type='jpeg', quality=90)
    pg.evaluate("(() => { const u = __dbg.refl.uniforms; "
                "u.uShallow.value.set(6, 0.01, 0.01); u.uDeep.value.set(6, 0.01, 0.01); })()")
    # B6+：染色后等两帧真正渲染再截图数像素（帧等待与帧率无关），替代固定睡 400ms
    # （分类器真候选 L105→L109：截图类断言必须等帧）
    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    dyed = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
    pg.screenshot(path=H.output_path('shot_reflect_dyed.jpg'), type='jpeg', quality=90)
    red = count(dyed, RED, x_min=140)
    assert red > 300, ('染色倒影应在构图内可见（探针像素数不足）', red)
    print('reflection dyed red px =', red)

    # 6) 切回 pad：门控关闭 + 染色状态下的残留必须接近零像素
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"pad\"]').click()")
    # B6+：等门控关闭 + 两帧渲染后再数残留像素，替代固定睡 700ms（分类器真候选 L114→L120）
    pg.wait_for_function("() => __dbg.refl.enabled === false && __dbg.refl.group.visible === false", timeout=15000)
    pg.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    g1 = pg.evaluate("({ en: __dbg.refl.enabled, vis: __dbg.refl.group.visible })")
    assert g1['en'] is False and g1['vis'] is False, ('切离 water 倒影应隐藏', g1)
    after = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
    pg.screenshot(path=H.output_path('shot_reflect_residue.jpg'), type='jpeg', quality=90)
    residue = count(after, RED, x_min=140)
    assert residue < 15, ('切场地后不得有倒影残留像素', residue)
    print('reflection residue px after leaving water =', residue)

    # 收尾：复位飞行状态（S._alt 设回改前高度让跟随器把目标降回地面；
    # 见上文增量补差注释——直接置 0 会让相机目标悬在 14u 不回落）
    pg.evaluate("__dbg.FLY.fp=false; __dbg.FLY.state='ground'; __dbg.FLY.alt=0; __dbg.FLY.pitch=0; "
                "__dbg.FLY.comp=0; __dbg.FLY.x=0; __dbg.FLY.z=0; __dbg.FLY.yaw=0; __dbg.S._alt=14")


H.guarded_main(run, hard_timeout=300)
