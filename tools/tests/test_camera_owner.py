# -*- coding: utf-8 -*-
# 最终闭环修复二：唯一相机所有权验证。
#   A) FPV 激活时 startMission：显式退出 FPV、规范化 FLY、过场实际驱动渲染相机
#      ——采集至少两个时刻真实 camera.matrixWorld 证明过场运镜生效（非仅 state().on）
#   B) 单一 owner：cinematic 开场激活时启动 mission → 只有一个活跃序列；
#      采集 camera.matrixWorld 关键帧间发生符合预期的变化（过场驱动相机）。
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_harness as H

def cam(pg):
    return pg.evaluate("""() => {
      const e = __dbg.W.camera.matrixWorld.elements;
      return [e[12], e[13], e[14]].map(v => +v.toFixed(2));   // 相机世界位置 x/y/z
    }""")

def run(pg):
    pg.goto(H.BASE + '/?nocine=1&nocut=0', wait_until='domcontentloaded')
    pg.wait_for_function("() => !!window.__dbg", timeout=60000)
    pg.wait_for_function("() => __dbg.apache && __dbg.fp && __dbg.rescue", timeout=60000)

    # A) 从 FPV 启动任务：FPV 应失去所有权、过场取得相机
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0; __dbg.S.running=true")
    pg.wait_for_timeout(400)
    pg.evaluate("__dbg.fp.toggle()")          # 进 FPV
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    pg.wait_for_timeout(500)
    # FPV 中相机随眼位（离机体很近）——记录 FPV 相机位置特征
    fpCam = cam(pg)
    print('FPV 相机:', fpCam)
    assert abs(fpCam[1]) > 10, ('FPV 相机应贴机体高空（高度特征）', fpCam)
    # 进入 FPV 后故意制造驾驶/相机残留（camera.up 旋转、速度、视线累积、
    # 高度缓存、按键）——exitNormalized 必须全部规范化（复核一轮项四逐项断言）
    pg.evaluate("""() => {
      __dbg.W.camera.up.set(0, 0.5, 0.87);          // 旋转 camera.up（FPV 机动残留）
      __dbg.fp.spd = 9.3; __dbg.fp.vy = 2.1; __dbg.fp.vSide = -4.7;   // 驾驶速度
      __dbg.fp.vYaw = 1.3; __dbg.fp.vPitch = -0.6;  // 视线累积
      __dbg.fp._plAcq = {gen: 7, state: 'armed'};   // 残留 acquisition
      __dbg.FLY.userAlt = 21; __dbg.S._alt = 17;    // 高度缓存
      __dbg.FLY.pitch = 0.31; __dbg.FLY.roll = -0.2;// 机体姿态
      __dbg.FLY.alt = 12; __dbg.FLY.state = 'hover';
    }""")
    # 按键状态（触屏/键盘按住残留）：向 keys 表注入 w/g（46-fpview 模块级对象——
    # 经 __dbg.fp 间接不可读，改经 exitNormalized 后 FPV 行为无残留来间接验证；
    # 无法直接注入模块闭包 keys，改为验证可视化可观测字段）
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)   # FPV 已退出
    pg.wait_for_function("() => __dbg.cutsceneState && __dbg.cutsceneState.on", timeout=6000)
    # 逐项断言 exitNormalized 规范化（复核一轮项四）：
    st = pg.evaluate("""() => {
      const fp = __dbg.fp;
      return {
        fp: fp.active, fly: __dbg.FLY.state,
        alt: +__dbg.FLY.alt.toFixed(2), yaw: +__dbg.FLY.yaw.toFixed(2),
        pitch: +__dbg.FLY.pitch.toFixed(3), roll: +__dbg.FLY.roll.toFixed(3),
        userAlt: +__dbg.FLY.userAlt.toFixed(2), S_alt: +__dbg.S._alt.toFixed(2),
        spd: fp.spd, vy: fp.vy, vSide: fp.vSide,
        vYaw: +fp.vYaw.toFixed(3), vPitch: +fp.vPitch.toFixed(3),
        plAcq: fp._plAcq,
        camUp: Array.from(__dbg.W.camera.up.toArray()).map(v => +v.toFixed(3)),
        orbitTarget: __dbg.orbit.tTarget.toArray().map(v => +v.toFixed(2)),
        orbitTarget2: __dbg.orbit.target.toArray().map(v => +v.toFixed(2)),
        on: __dbg.cutsceneState.on
      };
    }""")
    print('A exitNormalized 规范化断言:', st)
    assert not st['fp'] and st['fly'] == 'ground' and st['alt'] == 0 and st['yaw'] == 0, (
        'A: FPV 未退出/FLY 未规范化', st)
    # pitch/roll：exitNormalized 清零后 startMission 可能按任务初值设置合法姿态
    #（GROUND_PITCH），不能要求精确 0——断言"非残留巨幅"（无 0.31 级残留）
    assert abs(st['pitch']) < 0.3 and abs(st['roll']) < 0.3, ('A: 机体姿态残留', st)
    assert st['userAlt'] == 0 and st['S_alt'] == 0, ('A: 高度缓存未清零', st)
    assert st['spd'] == 0 and st['vy'] == 0 and st['vSide'] == 0, ('A: 驾驶速度残留', st)
    assert st['vYaw'] == 0 and st['vPitch'] == 0, ('A: 视线累积残留', st)
    assert st['plAcq'] is None, ('A: acquisition 残留（应清空）', st)
    assert st['camUp'][0] == 0 and st['camUp'][1] == 1 and st['camUp'][2] == 0, (
        'A: camera.up 未恢复标准朝上（应 +Y）', st['camUp'])
    # orbit tTarget：exitNormalized 拉回停放位 (x,1.1,z) 后，startMission 会按任务
    # 初值定位到基地 (0,1,42)（合法，非残留）——断言"目标已非 FPV 残留态"：
    # FPV 残留特征为 orbit.enabled=false + tTarget 在机体悬停位（y=1.1+alt*0.92
    # 或任务前旧值）；任务位 z=42 说明已按任务重新定位
    assert st['orbitTarget'][2] > 40, ('A: orbit tTarget 未按任务定位（非残留）', st['orbitTarget'])
    assert abs(st['orbitTarget'][0]) < 5 and abs(st['orbitTarget'][1] - 1) < 1, (
        'A: orbit tTarget 异常', st['orbitTarget'])
    assert abs(st['orbitTarget2'][0] - st['orbitTarget'][0]) < 0.02, (
        'A: orbit.target 未同步 tTarget', st['orbitTarget2'], st['orbitTarget'])
    print('A exitNormalized 逐项规范化 OK（camera.up/速度/视线/acq/姿态/高度缓存/orbit 按任务定位）')
    # 过场驱动相机：采集两个时刻 camera.matrixWorld（mission 过场 KF0 基地远景→KF1 目标推近）。
    # orbit 用 damp 缓动追赶 tTarget（收敛慢），2.2s 内相机处于中途——断言用
    # "相机位置显著移动（欧氏距离）+ 已朝基地区域推进"而非精确到达 KF 端点：
    # 若 cutscene 未驱动相机，相机将静止在 setView(0) 英雄机位 (7.5,3.4,9.5) 附近
    c0 = cam(pg)
    pg.wait_for_function("""(c0) => {
      const e = __dbg.W.camera.matrixWorld.elements;
      const d = Math.hypot(e[12]-c0[0], e[13]-c0[1], e[14]-c0[2]);
      return d > 2;    // 状态等待：过场驱动相机移动 >2u（低帧下 orbit 缓动也持续）
    }""", arg=c0, timeout=8000)
    c1 = cam(pg)
    print('过场相机轨迹: t0=', c0, 't1=', c1)
    moved = ((c1[0]-c0[0])**2 + (c1[1]-c0[1])**2 + (c1[2]-c0[2])**2) ** 0.5
    assert moved > 2, ('过场应驱动相机移动（matrixWorld 变化）', c0, c1, moved)
    assert c0[2] > 35 and c1[2] > 35, ('过场相机应朝基地区域推进（z>35）', c0, c1)
    print('过场相机驱动 OK: moved=', round(moved, 1))
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)

    # B) cinematic 开场激活时启动 mission：owner 互斥 + pending 闭环（修复三）——
    #    开场持有 owner 时任务过场被拒且 pending；开场结束后任务自动取得 owner 播放
    pg.evaluate("localStorage.clear()")
    pg.goto(H.BASE + '/?nocut=0', wait_until='domcontentloaded')   # 无 nocine → 开场
    pg.wait_for_function("() => !!window.__dbg && __dbg.cinema", timeout=60000)
    pg.wait_for_function("() => __dbg.cinema.on", timeout=60000)
    assert pg.evaluate("__dbg.cinema.on"), '开场应激活'
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_timeout(600)
    owners = pg.evaluate("""() => ({
      cinema: __dbg.cinema.on, cut: __dbg.cutsceneState ? __dbg.cutsceneState.on : false,
      camSeq: __dbg.camSeqOwner,
      playedRound: __dbg.cutsceneState ? __dbg.cutsceneState.playedRound : null
    })""")
    print('B1 开场+任务 owners:', owners)
    # 开场持有 owner 时：任务过场不得播放（cut=false）、camSeq 必须是 'cinematic'
    assert owners['cinema'] and owners['camSeq'] == 'cinematic', ('B1: 开场应持有 owner', owners)
    assert not owners['cut'], ('B1: 开场持有期间任务过场不应播放', owners)
    # 开场结束（Esc 跳过）→ 任务过场自动取得 owner 并播放（pending 闭环）
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !__dbg.cinema.on", timeout=5000)
    pg.wait_for_function("() => __dbg.cutsceneState && __dbg.cutsceneState.on", timeout=8000)
    st2 = pg.evaluate("""() => ({
      cut: __dbg.cutsceneState.on, preset: __dbg.cutsceneState.preset,
      camSeq: __dbg.camSeqOwner,
      playedRound: __dbg.cutsceneState.playedRound,
      missionRound: __dbg.S._missionRound
    })""")
    print('B2 开场结束后:', st2)
    # 期望序列（mission cutscene）必须真实取得 owner，且 round 已提交
    assert st2['cut'] and st2['preset'] == 'mission' and st2['camSeq'] == 'cutscene', (
        'B2: 任务过场未取得 owner/未播放', st2)
    assert st2['playedRound'] == st2['missionRound'], ('B2: playedRound 应等于当前轮', st2)
    # 全程仅一个活动序列（cinema 已关、cut 已开）
    activeNow = (1 if pg.evaluate("__dbg.cinema.on") else 0) + (1 if st2['cut'] else 0)
    assert activeNow == 1, ('B2: 应仅一个活动 camera sequence', activeNow)
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    print('B owner 互斥+pending 闭环 OK')

    # C) 按键残留（指令三修正版：只读快照 keyState() 直接证明清键）
    #    必须在 FPV active 状态下制造 w/a/s/d/r/q/g/x 代表性 true 状态，且不派发
    #    keyup；随后触发 startMission→exitNormalized，读 __dbg.fp.keyState() 只读
    #    快照断言这 8 键全为 false。mutation-sensitive：若删除 exitNormalized 的
    #    清键循环，本断言必然失败（keys 表残留 true 直接可见，无需行为推断）。
    #    进入 FPV 前需重设 hover（B 段 startMission 后 FLY.state=ground，enter 门控）
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.fp.toggle()")                 # 进入 FPV（active）
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    # 制造 8 个代表性按键 true 状态（真实 keydown，不派发 keyup——残留依赖
    # exitNormalized 清键，而不是 keyup 配对）
    for k in ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyQ', 'KeyG', 'KeyX']:
        pg.keyboard.down(k)
    pg.wait_for_timeout(150)
    held = pg.evaluate("__dbg.fp.keyState()")
    held_keys = {kk for kk, v in held.items() if v}
    assert {'w', 'a', 's', 'd', 'r', 'q', 'g', 'x'} <= held_keys, (
        'C: FPV active 下应先真实持有这些键（前置失败，非清键问题）', held)
    # startMission → exitNormalized（不派发任何 keyup）
    pg.evaluate("__dbg.startMission()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)
    pg.wait_for_timeout(150)
    st_k = pg.evaluate("__dbg.fp.keyState()")
    residue_keys = {kk for kk, v in st_k.items() if v}
    print('C exitNormalized 后 keyState 快照:', st_k)
    assert not (residue_keys & {'w', 'a', 's', 'd', 'r', 'q', 'g', 'x'}), (
        'C: exitNormalized 未清按键（keyState 残留 true——删除清键循环必触发本条）', st_k)
    # 跳过 startMission 触发的 mission cutscene（避免干扰行为佐证阶段的相机）
    pg.keyboard.press('Escape')
    pg.wait_for_function("() => !__dbg.cutsceneState.on", timeout=5000)
    # 行为佐证（可靠可观测行为）：重进 FPV 不按键不自加速——若清键循环缺失，
    # 残留 true 会经 update() 驱动 spd 冲高
    pg.evaluate("__dbg.FLY.state='hover'; __dbg.FLY.alt=14; __dbg.FLY.fp=true; __dbg.FLY.x=0; __dbg.FLY.z=0; "
                "__dbg.FLY.yaw=0; __dbg.FLY.pitch=0; __dbg.FLY.comp=0; __dbg.S._alt=0")
    pg.wait_for_timeout(200)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => __dbg.fp.active", timeout=8000)
    # B6+：fp.spd/FLY.x/z 由 46-fpview.js:341 updater 每帧写——等残速衰减达标再断言
    # （分类器真候选 L187→L192）
    pg.wait_for_function("() => Math.abs(__dbg.fp.spd) < 0.5 && Math.abs(__dbg.FLY.x) < 0.5 && Math.abs(__dbg.FLY.z) < 0.5", timeout=15000)
    residue2 = pg.evaluate("""() => ({ spd: +__dbg.fp.spd.toFixed(3),
      x: +__dbg.FLY.x.toFixed(2), z: +__dbg.FLY.z.toFixed(2),
      vSide: +__dbg.fp.vSide.toFixed(3), vYaw: +__dbg.fp.vYaw.toFixed(3) })""")
    print('C 重进 FPV 行为:', residue2)
    assert abs(residue2['spd']) < 0.5 and abs(residue2['x']) < 0.5 and abs(residue2['z']) < 0.5, (
        'C: 重进 FPV 自加速（行为佐证失败）', residue2)
    assert abs(residue2['vSide']) < 0.5 and abs(residue2['vYaw']) < 0.5, (
        'C: 转向/侧飞输入残留', residue2)
    pg.evaluate("__dbg.fp.toggle()")
    pg.wait_for_function("() => !__dbg.fp.active", timeout=6000)
    print('C 按键残留清理 OK（keyState 快照全 false + 重进 FPV 无自加速）')

import pw_harness as H2
H2.guarded_main(run, hard_timeout=240)
print('PASS')