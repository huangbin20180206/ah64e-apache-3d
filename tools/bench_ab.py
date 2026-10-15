# -*- coding: utf-8 -*-
"""Phase 13 证据闭环 A/B 采样器（复核一轮项二/三）。

架构：由 bench_ab_run.ps1 自建两个干净 worktree（基线固定 SHA / 候选 terminal
SHA）分别构建并起服务，按 impl-1→base-1→impl-2→base-2→impl-3→base-3 交替调用
本脚本（AB_TAG/AB_GROUP/AB_RUN/AB_URL/AB_WORKTREE/AB_BUILD_TIME/AB_EXPECT_SHA/
AB_TEST_SCRIPT_SHA 环境变量）。

身份绑定（项二）：
- 构建产物（build.mjs）在页面注入 window.__BUILD_ID = {git_sha, bundle_sha256}；
- bundle_sha256 定义为内联 app 包（dist/app-check.mjs）SHA-256——无自引用，
  服务端可对同一 worktree 的 dist/app-check.mjs 独立重算；
- 本脚本从浏览器读取 __BUILD_ID，要求 git_sha == AB_EXPECT_SHA（impl/base 各自
  期望 SHA）且 bundle_sha256 == 服务端重算的 app-check 哈希，任一不符立即失败；
- JSON 记录 expected/observed SHA、served bundle hash、URL、worktree、构建时间、
  测试脚本 SHA、浏览器/GPU/viewport。

DOF 成本重测（项三）：
- DOF ON/OFF 使用完全相同的场景（desert/day）、质量档（q=1）、机位（固定
  tTarget/tPhi/tDist/tTheta）、camera matrix（同帧读）、分辨率、可见对象、
  预热时间与采样窗口，仅切 __dbg.composer.dofOn；
- 每帧正确 reset（renderer.info autoReset=true，每次 render 自动重置）并读取
  info.render.calls/triangles + 帧间隔——逐帧独立记录，不做跨帧累计后除 RAF
  次数的不可解释结果；
- 每组 ON/OFF camera matrix 容差内一致硬断言（cam_identical），终值须全 true；
- 只报告受控场景下的总帧时间/draw calls/triangles，**不把 ON/OFF 差值解释为
  单 pass 成本**（旧"DOF pass 增量 126 draws"结论已撤回）。

每组样本写独立不可覆盖 JSON（run_id+tag+group 命名）。
"""
import json, os, sys, time, hashlib
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tests'))
import pw_harness as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'ai-reviews', 'cinematic-pack-3-final', 'ab')

def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()

def frame_stats(pg, frames=30):
    """逐帧采样（项三）：monkey-patch renderer.render 累计一帧内全部 render 调用的
    draws/triangles，帧边界（rAF 回调）读取并清零——renderer.info 默认 autoReset
    导致 info.render 只有最后一次 render 的值（final pass 常仅 1 draw），直接读
    info 会把一帧的多段渲染（sceneRT/bloom/final）漏成 1 次调用。累计法保证
    每帧值 = 该帧所有 render 段之和，且不做任何除法。返回 draws/tri/frame_ms
    三个等长数组；采样结束恢复原 render。"""
    return pg.evaluate("""(frames) => new Promise(res => {
      const r = __dbg.renderer;
      const acc = { draws: 0, tri: 0 };
      const out = { draws: [], tri: [], frame_ms: [] };
      const orig = r.render.bind(r);
      r.render = function() { orig(...arguments); acc.draws += r.info.render.calls; acc.tri += r.info.render.triangles; };
      let last = performance.now(); let n = 0;
      function f() {
        out.draws.push(acc.draws); out.tri.push(acc.tri); acc.draws = 0; acc.tri = 0;
        const now = performance.now(); out.frame_ms.push(now - last); last = now;
        if (++n < frames) requestAnimationFrame(f); else { r.render = orig; res(out); }
      }
      requestAnimationFrame(f);
    })""", frames)

def cam_matrix(pg):
    return pg.evaluate("""() => {
      const e = __dbg.W.camera.matrixWorld.elements;
      return Array.from(e).map(v => +v.toFixed(4));
    }""")

def cam_identical(a, b, tol=0.02):
    return len(a) == len(b) and all(abs(x - y) <= tol for x, y in zip(a, b))

def run(pg):
    tag = os.environ.get('AB_TAG', 'impl')
    group = os.environ.get('AB_GROUP', '0')
    runid = os.environ.get('AB_RUN', str(int(time.time())))
    url = os.environ.get('AB_URL', 'http://localhost:8642')
    wt = os.environ.get('AB_WORKTREE', '')
    build_time = os.environ.get('AB_BUILD_TIME', '')
    expect_sha = os.environ.get('AB_EXPECT_SHA', '')
    test_script_sha = os.environ.get('AB_TEST_SCRIPT_SHA', '')

    pg.wait_for_function("() => !!(window.__dbg && __dbg.apache && __dbg.composer)", timeout=60000)
    # ---- 身份绑定校验（项二）：页面必须报告期望的 git SHA 且 bundle 哈希
    # 与服务端重算的 app-check 一致；legacy 基线（如 83583ed，build.mjs 无
    # __BUILD_ID）由 runner 在服务端用 worktree HEAD 校验（worktree 以固定
    # SHA 检出，不可伪造），此处对页面侧如实记录。----
    served_bundle = None
    observed_sha = None
    has_buildid = pg.evaluate("!!window.__BUILD_ID")
    if has_buildid:
        build_id = pg.evaluate("window.__BUILD_ID")
        observed_sha = build_id.get('git_sha', '')
        served_bundle = build_id.get('bundle_sha256', '')
    print('%s 身份: expect=%s observed=%s bundle=%s legacy(%s)' % (
        tag, expect_sha, observed_sha,
        (served_bundle[:12] if served_bundle else None), (not has_buildid)))
    if has_buildid:
        if not expect_sha or observed_sha != expect_sha:
            raise AssertionError('served git_sha %r != expected %r（服务了错误的版本？）' % (observed_sha, expect_sha))
        # 服务端重算：本 worktree 的 dist/app-check.mjs（runner 把 worktree 路径传进来）
        dist_appcheck = os.path.join(wt, 'dist', 'app-check.mjs')
        if not os.path.exists(dist_appcheck):
            raise AssertionError('worktree dist/app-check.mjs 不存在: %s' % dist_appcheck)
        local_bundle = sha256_of(dist_appcheck)
        if served_bundle != local_bundle:
            raise AssertionError('页面 bundle_sha256 %r != worktree app-check %r' % (served_bundle, local_bundle))
        print('%s 身份校验 PASS（git_sha + bundle 双一致）' % tag)
    else:
        # legacy 基线：runner 已校验 worktree HEAD（本进程内再复核一次），
        # 页面无 __BUILD_ID 属预期；observed 记服务端 HEAD
        import subprocess
        wt_head = subprocess.run(['git', '-C', wt, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
        if wt_head != expect_sha:
            raise AssertionError('worktree HEAD %r != expected %r（服务端身份不符）' % (wt_head, expect_sha))
        observed_sha = wt_head
        print('%s legacy 基线：worktree HEAD 校验 PASS（%s）' % (tag, wt_head[:12]))
    local_bundle = os.path.join(wt, 'dist', 'app-check.mjs')
    if os.path.exists(local_bundle):
        local_bundle = sha256_of(local_bundle)
    else:
        local_bundle = None

    ua = pg.evaluate("navigator.userAgent")
    gpu = pg.evaluate("""() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return 'no-webgl2';
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
    }""")
    vp = pg.evaluate("({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})")

    # ---- 完全受控场景（项三）：desert/day/q=1/固定机位 ----
    pg.evaluate("""() => { const q = document.getElementById('sel-quality');
      q.value = '1'; q.dispatchEvent(new Event('change', {bubbles:true})); }""")
    pg.wait_for_timeout(600)
    pg.evaluate("document.querySelector('#terrain-row [data-terrain=\"desert\"]').click()")
    pg.evaluate("document.querySelector('#env-row [data-env=\"day\"]').click()")
    pg.evaluate("""() => { const o = __dbg.orbit;
      o.tTarget.set(0, 1.25, 0.2); o.target.copy(o.tTarget);
      o.tPhi = 1.19; o.tDist = 12.6; o.tTheta = 0.78; }""")   # VIEWS[0] 英雄机位
    # 预热 2s（场景/相机/后处理状态稳定后再采样）
    pg.wait_for_timeout(2000)
    # 主场景（环绕非 FPV）
    main_stats = frame_stats(pg, 30)
    rows = [{
        'kind': 'main', 'run_id': runid, 'tag': tag, 'group': int(group),
        'quality': '1', 'terrain': 'desert', 'fpv': False,
        'draws_sorted': sorted(main_stats['draws']),
        'tri_sorted': sorted(main_stats['tri']),
        'frame_ms_sorted': sorted(main_stats['frame_ms']),
        'draws_raw': main_stats['draws'], 'tri_raw': main_stats['tri'],
        'frame_ms_raw': main_stats['frame_ms'],
        'dofOn': False, '_dofActive': False, 'bloom': pg.evaluate("__dbg.composer.strength"),
        'god': pg.evaluate("__dbg.composer.god"),
        'camera_matrix': cam_matrix(pg),
    }]
    fps = [1000.0 / (m if m > 0 else 1) for m in main_stats['frame_ms']]
    print('%s main desert q=1: draws_med=%d tri_med=%d fps_med=%.1f' % (
        tag, sorted(main_stats['draws'])[len(main_stats['draws'])//2],
        sorted(main_stats['tri'])[len(main_stats['tri'])//2], sorted(fps)[len(fps)//2]))

    # ---- DOF ON/OFF（完全相同场景/机位/预热/采样窗，仅切 dofOn）----
    # 资源断言：q=1 下 dofRT/depthTexture 必须就绪
    st = pg.evaluate("""() => ({
      dofOn: __dbg.composer.dofOn, dofActive: !!__dbg.composer._dofActive,
      dofRT: !!__dbg.composer.dofRT,
      depthTex: !!(__dbg.composer.sceneRT && __dbg.composer.sceneRT.depthTexture)
    })""")
    assert st['dofOn'] and st['dofRT'] and st['depthTex'], ('DOF 资源未就绪', st)
    # 进入 FPV（DOF 由 70-app 驱动 _dofActive）；随后 ON/OFF 只切 dofOn，不动 fp/视角
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=3; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.wait_for_timeout(400)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_function("() => __dbg.composer._dofActive", timeout=8000)
    pg.wait_for_timeout(1000)      # FPV 眼位稳定预热
    cam_fp = cam_matrix(pg)

    def dof_sample(on):
        pg.evaluate("__dbg.composer.dofOn = %s" % ('true' if on else 'false'))
        if on:
            pg.wait_for_function("() => __dbg.composer._dofActive", timeout=6000)
        else:
            pg.wait_for_function("() => !__dbg.composer._dofActive", timeout=6000)
        pg.wait_for_timeout(800)   # 预热（RT 重建/切换后状态稳定）
        s = frame_stats(pg, 30)
        cam0 = cam_matrix(pg)
        return {
            'draws_sorted': sorted(s['draws']), 'tri_sorted': sorted(s['tri']),
            'frame_ms_sorted': sorted(s['frame_ms']),
            'draws_raw': s['draws'], 'tri_raw': s['tri'], 'frame_ms_raw': s['frame_ms'],
            'camera_matrix': cam0,
            'bloom': pg.evaluate("__dbg.composer.strength"),
            'god': pg.evaluate("__dbg.composer.god"),
            'dofOn': on, '_dofActive': pg.evaluate("!!__dbg.composer._dofActive"),
        }

    on = dof_sample(True)
    off = dof_sample(False)
    cam_id = cam_identical(on['camera_matrix'], off['camera_matrix'])
    # 硬断言：同一受控场景下 ON/OFF camera 必须容差一致，且恢复 ON 后仍一致
    if not cam_id:
        raise AssertionError('DOF ON/OFF camera 不一致（视角被改动）', on['camera_matrix'], off['camera_matrix'])
    # 恢复 ON 并复核 camera（确认 OFF 采样未扰动状态）
    pg.evaluate("__dbg.composer.dofOn = true")
    pg.wait_for_function("() => __dbg.composer._dofActive", timeout=6000)
    pg.wait_for_timeout(600)
    cam_restore = cam_matrix(pg)
    cam_id2 = cam_identical(on['camera_matrix'], cam_restore)
    if not cam_id2:
        raise AssertionError('DOF 恢复后 camera 不一致', on['camera_matrix'], cam_restore)
    for row in (on, off):
        r = dict(row, kind='dof_on' if row['dofOn'] else 'dof_off',
                 run_id=runid, tag=tag, group=int(group), quality='1', terrain='desert', fpv=True,
                 cam_identical_this_group=cam_id)
        rows.append(r)
    print('%s DOF ON/OFF: draws_med %d/%d tri_med %d/%d fps_med %.1f/%.1f cam_identical=%s' % (
        tag,
        on['draws_sorted'][len(on['draws_sorted'])//2], off['draws_sorted'][len(off['draws_sorted'])//2],
        on['tri_sorted'][len(on['tri_sorted'])//2], off['tri_sorted'][len(off['tri_sorted'])//2],
        (1000.0 / on['frame_ms_sorted'][len(on['frame_ms_sorted'])//2] if on['frame_ms_sorted'] else 0),
        (1000.0 / off['frame_ms_sorted'][len(off['frame_ms_sorted'])//2] if off['frame_ms_sorted'] else 0),
        cam_id))
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=8000)

    # ---- 落盘（不可覆盖）----
    os.makedirs(OUT, exist_ok=True)
    fname = 'PERF-%s-%s-%s.json' % (runid, tag, group)
    fpath = os.path.join(OUT, fname)
    if os.path.exists(fpath):
        raise AssertionError('A/B 样本已存在（不可覆盖）：%s' % fpath)
    payload = {
        'run_id': runid, 'tag': tag, 'group': int(group), 'url': url,
        'worktree': wt, 'build_time': build_time,
        'expected_sha': expect_sha, 'observed_sha': observed_sha,
        'served_bundle_sha256': served_bundle,
        'appcheck_sha256_local': local_bundle,
        'test_script_sha': test_script_sha,
        'browser_ua': ua, 'gpu': gpu, 'viewport': vp,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'method_note': '逐帧 renderer.info 独立采样（autoReset=true）、不做跨帧除法；' +
                       'DOF ON/OFF 同场景/机位/预热/采样窗仅切 dofOn；差值不解释为单 pass 成本',
        'rows': rows,
    }
    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print('saved:', fpath)

H.guarded_main(run, hard_timeout=240, base_url=os.environ.get('AB_URL', 'http://localhost:8642/?nocine=1&nocut=1'))
print('PASS')