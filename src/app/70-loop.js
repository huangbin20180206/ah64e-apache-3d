// ============================================================
// 70-loop.js — 动画循环：旋翼/姿态/飞行约束 + 各子系统逐帧驱动 + 渲染
// ============================================================
// 2026-10-12 自 70-app.js 拆出（纯搬移 + 帧逻辑提成具名函数，行为不变）。
// 同前缀 70-* 文件在拓扑检查里同级（互引不算反向引用），拼接顺序按文件名。

const clock = { last: performance.now() / 1000 };

function loop() {
  requestAnimationFrame(loop);
  // 上下文丢失期间所有 GL 调用都是空转，跳过整帧（含 composer.render）
  if (_ctxLost) { clock.last = performance.now() / 1000; return; }
  // 装备图鉴（71-armory）全屏打开时 3D 被完全盖住：整帧暂停，省电、不占显卡
  if (S.armoryOpen) { clock.last = performance.now() / 1000; return; }
  const now = performance.now() / 1000;
  let dt = now - clock.last;
  clock.last = now;
  dt = Math.min(dt, 0.05);          // 切标签页回来时不要一次跳一大步
  _frame(dt, true);
}

// 测试步进（2026-10-12 批 E）：同步推进 sec 秒游戏时间，每步 h 秒，跳过 GPU 渲染。
// 软件渲染（SwiftShader）下页面时间只有墙钟的 ~0.07×，等"SAM 锁定 14s"这类
// 断言在墙钟上要等 200s；测试经 __dbg.step 直接推进逻辑，不依赖帧率。
// 只给测试用（72-uibind 挂到 __dbg），正常运行从不调用。
// until(可选)：每步后检查，返回真即提前停；返回实际推进的秒数。
function stepFrames(sec, h = 1 / 30, until = null) {
  let t = 0;
  while (t < sec - 1e-9) {
    const d = Math.min(h, sec - t);
    _frame(d, false);
    t += d;
    if (until && until()) break;
  }
  clock.last = performance.now() / 1000;
  return t;
}

// polish3c：展示模式右侧面板展开时，画面中心落在面板下面——小窗口（1024 宽）直升机尾桨被面板盖住。
// 面板打开时把镜头画面整体左移半个面板宽（相机视口偏移，不动相机本身；拾取/标签投影用同一投影矩阵，自动一致）。
// 只在展示模式 + 环绕镜头生效：游戏模式准星在屏幕正中、第一人称/航线/导览都不动。
const _PS = { x: 0, w: 0, h: 0 };
function _panelShift(dt) {
  let want = 0;
  const w = innerWidth, h = innerHeight;
  if (S.app === 'show' && !(fp && fp.active) && w > 600 && !document.body.classList.contains('route-mode')) {
    let L = 0, R = w;
    const pn = document.getElementById('panel');
    if (pn && !pn.classList.contains('hide')) {
      const r = pn.getBoundingClientRect();
      if (r.width > 0 && r.left > w * 0.4) R = r.left;
    }
    // 知识卡停靠左侧时（模板 #label-info.kc 规则），画面中心落在卡片右缘与面板左缘之间
    const kc = document.getElementById('label-info');
    if (kc && kc.classList.contains('kc') && kc.style.display !== 'none') {
      const r = kc.getBoundingClientRect();
      if (r.width > 0 && r.left < w * 0.2 && r.right < w * 0.5) L = r.right;
    }
    want = Math.round(w / 2 - (L + R) / 2);
  }
  const nx = Math.abs(want - _PS.x) < 0.5 ? want : _PS.x + (want - _PS.x) * Math.min(1, dt * 6);
  if (Math.abs(nx - _PS.x) < 0.01 && w === _PS.w && h === _PS.h) return;
  _PS.x = nx; _PS.w = w; _PS.h = h;
  if (Math.abs(nx) < 0.5) W.camera.clearViewOffset();
  else W.camera.setViewOffset(w, h, nx, 0, w, h);
}

function _frame(dt, doRender) {
  const rawDt = dt;                 // 慢动作会缩放 dt，白闪/震屏衰减用原始值
  // E1（2026-10-19）：慢动作真正作用于整帧模拟。此前 timeScale 在帧末才乘到 dt，
  // 只影响 HUD，世界并没有变慢。webdriver 下不缩放（保旧测试时间推进不变）。
  if (S._slowmo > 0 && KC.allow) dt *= 0.25;
  S.time += dt;

  // 转速：启停各按自己的时间常数线性趋近
  const target = S.running ? 1 : 0;
  const rate = S.running ? 1 / SPIN_UP_SEC : 1 / SPIN_DOWN_SEC;
  if (S.spin !== target) {
    const d = Math.sign(target - S.spin) * rate * dt;
    S.spin = Math.abs(target - S.spin) < Math.abs(d) ? target : S.spin + d;
  }
  // 转速曲线：起转时前段慢、后段快，更像涡轴带载
  const s = easeInOut(S.spin);
  const rpm = s * RPM_NOMINAL;
  const omega = rpm / 60 * TAU;     // rad/s

  if (apache) {
    S.angle = (S.angle + omega * dt) % TAU;
    S.tailAngle = (S.tailAngle + omega * TAIL_RATIO * dt) % TAU;
    if (apache.mainRotor) {
      apache.mainRotor.rotation.y = S.angle;
      // 桨盘挥舞：转速越高，前倾与横向摆动越明显（幅度很小，只求“活”）
      const fl = s * 0.016;
      apache.mainRotor.rotation.x = Math.sin(S.time * 2.1) * fl;
      apache.mainRotor.rotation.z = Math.cos(S.time * 1.7) * fl * 0.7;
    }
    if (apache.tailRotor) apache.tailRotor.rotation.x = S.tailAngle;

    // 龙弓雷达：±150° 往复扫描
    if (apache.radar) {
      if (S.scan) {
        S.radarPhase += dt * 0.55;
        apache.radar.rotation.y = Math.sin(S.radarPhase) * (150 * DEG);
      } else {
        apache.radar.rotation.y = lerp(apache.radar.rotation.y, 0, damp(0.06, dt));
      }
    }

    // 起降状态机：更新离地高度与飞行俯仰
    flyUpdate(dt);
    // 跟随飞行高度抬升/压低相机目标（保留用户手动平移后的相对位置）
    if (FLY.alt !== S._alt) { orbit.tTarget.y += (FLY.alt - S._alt) * 0.92; S._alt = FLY.alt; }
    // 2026-10-19 游戏线复查：第三人称下方向键平移机体时相机原地不动，几秒后飞机就飞出画面。
    // 与高度同理，按机体水平位移平移相机目标（用户拖拽平移后的相对偏移保留）。
    if (S._fx === undefined) { S._fx = FLY.x || 0; S._fz = FLY.z || 0; }
    if (FLY.x !== S._fx || FLY.z !== S._fz) {
      const ddx = (FLY.x || 0) - S._fx, ddz = (FLY.z || 0) - S._fz;
      if (Math.abs(ddx) + Math.abs(ddz) < 20) { orbit.tTarget.x += ddx; orbit.tTarget.z += ddz; }   // 瞬移/复位不跟（setView 自会重设）
      S._fx = FLY.x || 0; S._fz = FLY.z || 0;
    }

    // 机体姿态 = 飞行俯仰 + 高转速下的毫米级高频微颤（幅度收敛，避免拖拉机感）
    // 2026-10-14 用户反馈「起飞后抖动太厉害」：离地后微颤降到地面的 35%（离地 0~3u 平滑过渡），
    // 地面怠速/起转时的震感不变
    let jx = 0, jy = 0, jz = 0, rx = 0, rz = 0;
    if (S.vib && s > 0.02) {
      const airT = Math.min(1, Math.max(0, FLY.alt / 3));
      const airMul = 1 - 0.65 * airT * airT * (3 - 2 * airT);
      const a = s * s * 0.0026 * airMul * (S._dmgFx ? S._dmgFx.vibMul : 1);   // Phase 19：旋翼损伤振动放大
      jx = Math.sin(S.time * 47.3) * a;
      jy = Math.sin(S.time * 61.7) * a * 1.3;
      jz = Math.sin(S.time * 53.1) * a;
      rz = Math.sin(S.time * 39.1) * a * 0.55;
      rx = Math.sin(S.time * 44.7) * a * 0.4;
    }
    // 开炮后坐传导：shoot 置 _kick=0.10 后自然衰减，机体高频微抖（FP 相机继承震感）
    if (rig && rig._kick > 0.005) {
      const kf = rig._kick * 0.45;
      jx += Math.sin(S.time * 173) * kf;
      jy += Math.sin(S.time * 219) * kf * 0.7;
    }
    // 沙地陷轮（2026-09-02 用户需求）：沙面松软，停放/接地时起落架半陷入
    // 沙中（0.18u）；起飞离地时平滑拔出。草地/停机坪不陷。
    // 注意①场地键是 desert（WASH 介质键才是 sand）②damp 的 rate 必须 <1
    //（幂底数 1-rate 为正）；传 ≥1 会得到负底数的非整数幂 = NaN
    const sinkT = (W.terrainKey === 'desert' && FLY.alt < 0.4) ? 0.18 : 0;
    S._sink = lerp(S._sink || 0, sinkT, damp(0.08, dt));
    // 悬停蹬舵转向（A/D，与 FPV 同键位）：环绕模式下机头固定 +Z，尾部扇区
    // 的目标在武器锥外打不到、锥缘目标的导引弹道又歪——悬停蹬舵是真实直升机
    // 的标准机动；地面停放不允许（轮式起落架被地面约束）。
    const yawBefore = FLY.yaw;
    if ((!fp || !fp.active) && S.running && FLY.state !== 'ground') {
      if (keys['a']) FLY.yaw += 0.9 * (S._pen ? S._pen.yawMul : 1) * dt;    // 左转（战损降航向响应）
      if (keys['d']) FLY.yaw -= 0.9 * (S._pen ? S._pen.yawMul : 1) * dt;    // 右转
      // 悬停平移（方向键，环绕模式）：↑前 ↓后 ←左 →右，方向相对机头——
      // 与 A/D 蹬舵配合构成完整悬停机动；机体姿态随平移倾斜
      // 玩法批 D：峡谷里环绕模式也要能贴地——PageUp 升 / PageDown 降（写 userAlt，
      // 与移动端右摇杆同一通道）；其他变体不响应，行为不变
      if (targets && targets.canyon && targets.canyon.active && FLY.state === 'hover') {
        const up = (keys['pageup'] ? 1 : 0) - (keys['pagedown'] ? 1 : 0);
        if (up) FLY.userAlt = clamp((FLY.userAlt != null ? FLY.userAlt : FLY.alt) + up * 4 * dt, 2, 40);
      }
      let mxF = 0, mzF = 0;                  // 机头系：mz 前+ / mx 右+
      if (keys['arrowup']) mzF += 1;
      if (keys['arrowdown']) mzF -= 1;
      if (keys['arrowright']) mxF += 1;
      if (keys['arrowleft']) mxF -= 1;
      if (mxF || mzF) {
        const fs = Math.sin(FLY.yaw), fc = Math.cos(FLY.yaw);
        const sp = 7 * (S._pen ? S._pen.speedMul : 1) * dt;   // 战损降平移速度（表引用）
        FLY.x = clamp(FLY.x + (mzF * fs - mxF * fc) * sp, -FLY_BOUND, FLY_BOUND);
        FLY.z = clamp(FLY.z + (mzF * fc + mxF * fs) * sp, -FLY_BOUND, FLY_BOUND);
        S._leanP = lerp(S._leanP || 0, mzF * 0.10, damp(0.10, dt));   // 前飞低头
        S._leanR = lerp(S._leanR || 0, -mxF * 0.10, damp(0.10, dt));  // 侧飞压坡度
      } else {
        S._leanP = lerp(S._leanP || 0, 0, damp(0.10, dt));
        S._leanR = lerp(S._leanR || 0, 0, damp(0.10, dt));
      }
    }
    // 转弯侧倾（P1-2）：roll 附加项跟随转向角速度（左转左压坡度），上限约 13°；
    // 松舵后回平。真实直升机压坡度转弯的视觉核心。
    const yawRate = (FLY.yaw - yawBefore) / Math.max(dt, 1e-4);
    S._bankR = lerp(S._bankR || 0, clamp(-yawRate * 0.25, -0.22, 0.22), damp(0.10, dt));
    // 欧拉序 YXZ（航向→俯仰→滚转）：yaw≠0 时 pitch/roll 仍绕机体轴——
    // 默认 XYZ 序在转向后会把俯仰变成滚转（蹬舵转向+侧倾的配套修正）
    apache.root.rotation.order = 'YXZ';
    // 玩法批 D：峡谷地形约束（机体不进岩体；旋翼擦壁 → 退回 + 计伤 + 震屏）
    // P4b：展示航线自动驾驶沿中线飞，不做岩壁碰撞（避免航线被弹回/计伤）
    if (targets && targets.canyon && targets.canyon.active && !(HOST.routeState && HOST.routeState.on)) {
      const ev = targets.canyon.collide(FLY, dt);
      if (ev) {
        if (fp && fp.active) { fp.spd *= -0.3; fp.vSide *= -0.3; }
        if (ev === 'strike') {
          S._shake = Math.max(S._shake || 0, 0.7);
          toast('⚠ 旋翼擦到岩壁');
          if (targets.onHeliHit) targets.onHeliHit(targets._heliDmg, null);
        }
      }
    }
    apache.root.position.set(FLY.x + jx, FLY.alt + FLY.comp + jy - S._sink, FLY.z + jz);
    apache.root.rotation.y = FLY.yaw;
    apache.root.rotation.x = FLY.pitch + rx + (S._leanP || 0);
    apache.root.rotation.z = FLY.roll + rz + (S._leanR || 0) + (S._bankR || 0);
    // P7：飞行稳定度（0..1）——由可读飞行状态派生，供武器散布与救援窗口决策。
    // 悬停静止=1（散布基础值、绞车可作业）；FPV 高速/侧飞/俯仰或环绕平移中下降
    // （散布放大、绞车拒绝）。只读派生量写 S/rig/rescue，不新建 FLY 语义。
    let _stab = 1;
    if (fp && fp.active) {
      const m = (Math.abs(fp.spd) + Math.abs(fp.vSide)) / fp.SPD_MAX * 0.6
              + Math.abs(fp.vy) / 6 * 0.25 + Math.abs(FLY.pitch) / 0.85 * 0.15;
      _stab = clamp(1 - m, 0.25, 1);
    } else {
      const _mv = keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'];
      _stab = _mv ? 0.7 : 1;
    }
    S._stability = _stab;
    if (rig) rig._stability = _stab;
    // 救援作业水平速度（u/s）：FPV 用前向/侧飞合成；环绕模式方向键平移恒 7u/s
    if (rescue) {
      rescue.speed = (fp && fp.active)
        ? Math.hypot(fp.spd, fp.vSide)
        : (keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'] ? 7 : 0);
    }
    // Betty 语音警告（P1-3）：低空下降/弹药告罄等事件的女声播报
    if (betty) betty.update(dt);
    // 绞车救援（P2-3）：场地切换检测 + 每帧更新
    if (rescue) {
      if (W.terrainKey !== S._rescueTerr) { S._rescueTerr = W.terrainKey; rescue.setTerrain(W.terrainKey); }
      rescue.update(dt, apache.root.position);
      // game5：游戏线作战视角朝前看，放绞车时幸存者和吊绳在机腹正下方出画。
      // 放绳/对位/收绳期间镜头飞到斜侧后方、对准机腹到地面之间，人和绳都在画面里；结束后回作战视角。
      // 只在作战视角（S.view 0）且镜头无人占用（非 FPV/过场）时接管
      {
        const winch = rescue.state === 'deploying' || rescue.state === 'holding' || rescue.state === 'lifting';
        const camFree = S.app === 'play' && S.view === 0 && !(fp && fp.active) && !(HOST.camSeq && HOST.camSeq.owner);
        if (winch && camFree && !S._winchCam) {
          S._winchCam = true;
          const yaw = apache.root.rotation.y;
          orbit.flyTo({ target: [FLY.x || 0, FLY.alt * 0.55, FLY.z || 0], theta: PI * 0.9 + yaw + 0.75, phi: 1.12, dist: 14 + FLY.alt * 1.1, fov: 46 }, 0.9);
        } else if (!winch && S._winchCam) {
          S._winchCam = false;
          if (camFree) setView(0);
        }
      }
      // M6 救援成功 replay：delivered 触发短回放（每局一次；startMission 复位标记）。
      // 最终闭环修复（生命周期）：maybe 返回 accepted——仅当请求真正被接受/入队
      // 才提交 S._rescueCut；被拒（其他序列活跃）时不消费标记，下一帧重试，
      // replay 不永久丢失
      if (rescue.state === 'delivered' && !S._rescueCut) {
        if (HOST.cutsceneState && HOST.cutsceneState.maybe('rescue')) S._rescueCut = true;
      }
    }
    _tickMission(dt);

    // 接地阴影贴片随离地高度淡出
    W.csMat.opacity = 0.75 * (1 - smoothstep(1.2, 4.5, FLY.alt));

    // 武器特效：机炮 / 地狱火 / 烟尘 / 起降尘环
    if (rig) { rig.terrainKey = W.terrainKey; rig.update(dt, W.camera, S.time, s); }
    if (scenery) scenery.updateTrees(dt);   // 树木受爆：摇晃/倒下/火与烟
    // 靶场：油桶殉爆 / 残骸燃烧烟柱
    _tickMissionMaps(dt);
    if (targets) targets.update(dt, apache.root.position, S._mission);   // P8：传 heliPos——否则反击/威胁/受损全链（aaActive）恒不触发

    _tickSamwar(dt);
    // Phase 19：SAM 导弹/干扰弹视觉镜像（零分配；状态由 84 驱动）
    if (samvis) samvis.update(S.time);

    _tickDamage(dt);

    _tickEnemyAir(dt);

    _tickResources(dt);

    // 下洗 3D 特效（草浪/水纹/沙柱），跟随飞机位置
    if (washfx) washfx.update(dt, s, FLY.alt, apache.root.position.x, apache.root.position.z, S.time);
    // 空中打击目标：机动 + 击落坠毁动画
    if (air) air.update(dt, S.time);
    _tickNightOps(dt);   // P5-G3 热成像扫描 / 照明弹
    // P5-G2 敌方步兵：仅游戏关卡 + 基地靶场（非城镇/峡谷/训练/航线）出现，任务进行中才开火
    if (infantry) {
      const m = S._mission, cd = arcade && m ? arcade.coeffs(m) : null;
      const IE = S._infEnv || (S._infEnv = { dt: 0, heli: null, alt: 0, can: false, fire: false, rate: 1, dmg: 1 });
      IE.dt = dt; IE.heli = apache.root.position; IE.alt = FLY.alt;
      IE.can = !!(m && (m.phase === 'active' || m.phase === 'briefing') && targets && targets.enabled && !targets.passive
        && !(targets.town && targets.town.active) && !(targets.canyon && targets.canyon.active));
      IE.fire = IE.can && m.phase === 'active';
      IE.rate = cd ? cd.aaRate : 1; IE.dmg = cd ? cd.aaDmg : 1;
      infantry.update(IE);
      // 2026-10-18 战场活物（27-life）：基地摩托与步兵同条件；城镇平民/摩托随城镇关
      if (life) {
        const LE = S._lifeEnv || (S._lifeEnv = { dt: 0, heli: null, alt: 0, base: false, town: false });
        LE.dt = dt; LE.heli = IE.heli; LE.alt = IE.alt; LE.base = IE.can;
        LE.town = !!(m && (m.phase === 'active' || m.phase === 'briefing') && targets && targets.enabled
          && targets.town && targets.town.active);
        life.update(LE);
      }
    }
    // 机体指示灯：环境亮度淡入淡出 + 信标/频闪节拍（随引擎）
    if (nlights) nlights.searchTerrainMul = W.terrainKey === 'desert' ? 0.45 : 1;   // P4c 沙漠搜索灯过曝
    if (scenery && scenery.sync(W.terrainKey, S.env, S.mode === 'mission') && W.terrainKey === 'desert' && W.duneFar) {
      // P4c 沙漠色调随时段：清晨/黄昏远景沙丘偏暖（明度规则与 32-envpreset 同式）
      const P = ENV_PRESETS[S.env] || ENV_PRESETS.day;
      W.duneFar.material.color.setHex(DUNE_BASE).multiplyScalar(desertEnvDim(P) * 0.78);
      if (S.env === 'dusk' || S.env === 'dawn') W.duneFar.material.color.multiply(_scnWarm);
    }
    if (nlights) {
      // 2026-10-19 游戏线复查：夜战关在 28u 高度仍开机腹白光搜索灯，地面一大片黄光池既暴露位置又抢画面。
      // 实战任务中离地 8u 以上关灯（起降贴地时仍亮）；展示/训练不变。
      const _M = S._mission, _combat = !!(_M && _M.phase === 'active' && _M.variant && !/^train/.test(_M.variant));
      nlights.searchOn = (FLY.state !== 'ground' || (S.spin || 0) > 0.15) && !(_combat && FLY.alt > 8);
      nlights.update(dt, S.time, s);
    }   // polish3：冷机停放不开搜索灯
    // 湖面倒影：镜像整机逐帧同步姿态（仅湖面场地启用）
    if (refl) refl.update(apache.root, S.time);
    // 程序化旋翼音效（转速+下洗驱动音量/音高）
    if (audio) audio.update(s, washfx ? washfx.strength : 0, dt);
    // Phase 13-M4：动态天气（沙暴 fog/沙尘粒子/天空橙化、雷暴闪电+雷声）
    if (weather) weather.update(dt, S.time);
    // Phase 13-S4：配乐胜利旋律播完自动回落 ambient
    if (music) music.update(dt);
    // Phase 18：轻街机层每帧喂时间（连击窗口衰减；纯逻辑无渲染）
    if (arcade) arcade.update(S.time);
    // Phase 13-M5：环境叙事——随靶场显隐（湖面禁用靶标时基地叙事一并隐藏），
    // 每帧驱动雷达/编队/烟柱/探照灯
    if (narrative) {
      narrative.syncEnabled(!!(targets && targets.enabled));
      narrative.update(dt, S.time, S.env);
      // Phase 21：玩家摧毁基地设施 → 计分（83-arcade radar/sam/ammo 分 + sead 成就）
      // + 信息流/播报（仿 enemyAir.killEvent 消费；opt1 起为队列，每帧出队一个）
      if (narrative.killEvent) {
        const k = narrative.killEvent;
        narrative.killEvent = null;
        _kills++;
        S._flash = Math.max(S._flash, 0.5); S._shake = 1.0;
        killFeed(k.label);
        toast(`已摧毁：${k.label}`);
        if (music) music.brass();
        if (k.key === 'radar' && betty) betty.speak('ENEMY RADAR DESTROYED');   // SEAD 手感：致盲播报
        if (arcade && S._mission && S._mission.phase === 'active') arcade.onKill(k.type, S._mission);
      }
    }

    // 桨盘残影：60% 转速以上才明显，掩盖桨叶闪频
    if (disc) {
      // 第一人称时隐藏桨盘残影：眼位在桨盘正下方，半透明黑盘会铺满上半视野成"灰墙"
      // 峰值 0.85→0.70（2026-09-19 配合桨盘扩孔）：外圈从斜俯角扫到雷达罩时更透，
      // 不把罩体"抹掉"；配合 makeRotorDisc 扩孔，中央竖轴不再被残影压暗。
      const op = (S.disc && !(fp && fp.active)) ? smoothstep(0.35, 0.95, s) * 0.70 : 0;
      disc.visible = op > 0.002;
      discMat.uniforms.uOpacity.value = op;
      discMat.uniforms.uTime.value = S.time;
    }
    // 旋翼桨叶运动模糊：转速>15% 后桨叶渐变半透明（模拟视觉暂留/运动模糊）。
    // 满转速 289 RPM 时桨叶透明度降至 ~0.12——肉眼无法分辨单片桨叶，
    // 与桨盘残影协同形成真实"模糊盘面"观感（旧版桨叶全不透明导致马车轮效应）
    if (apache && apache.bladeMats && apache.bladeMats.length) {
      const bOp = 1 - smoothstep(0.15, 0.55, s) * 0.88;
      for (const m of apache.bladeMats) m.opacity = bOp;
    }
  }

  // 第一人称：相机由 FPView 驱动（机头姿态即视线），环绕控制器让位
  if (fp && fp.active) fp.update(dt);
  else orbit.update(dt);
  _panelShift(rawDt);
  killcamUpdate(rawDt);
  radioTick(rawDt);       // E2 无线电字幕/静音/锁定检测（70-radio.js）   // E1 击毁特写：覆盖本帧相机（70-killcam.js）
  W.skyMat.uniforms.uTime.value = S.time;
  if (W.terrainKey === 'water') W.updateWater(S.time, washfx ? washfx.strength : 0, FLY.alt, apache.root.position.x, apache.root.position.z);

  // 电影镜头包 S2/S3（光晕/体积光/景深/白闪/震屏）+ 慢动作 timeScale：见 70-hud.js
  _tickPostFx(rawDt);   // 慢动作已在帧首作用于 dt

  if (doRender) { composer.render(W.scene, W.camera, S.time); updateLabels(); }

  _tickModeChip();     // P14-B+E 模式/输入状态徽标（70-hud.js）

  _tickHud(rawDt, s, rpm);   // RPM/弹药/FPS/自动降档/首访引导（70-hud.js）；FPS 读数/降档用真实时钟（慢动作期间不误判）

  // NaN 兜底：任何一环算出 NaN 都会污染 FLY 状态并静默黑屏。
  // NaN !== NaN 恒真，用这个特性廉价自检；触发即复位（外部系统写坏状态时的最后防线）
  if (!(FLY.alt === FLY.alt) || !(FLY.x === FLY.x) || !(FLY.z === FLY.z) || !(FLY.yaw === FLY.yaw)) {
    console.error('FLY 状态出现 NaN，已强制复位');
    FLY.alt = 0; FLY.x = 0; FLY.z = 0; FLY.yaw = 0; FLY.pitch = 0; FLY.roll = 0;
    FLY.state = 'ground'; FLY.fp = false;
    if (fp && fp.active) fp.exit();
  }

  if (doRender && shotPending) { shotPending = false; saveShot(); }
}
