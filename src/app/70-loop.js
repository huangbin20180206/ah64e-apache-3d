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

function _frame(dt, doRender) {
  const rawDt = dt;                 // 慢动作会缩放 dt，白闪/震屏衰减用原始值
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

    // 机体姿态 = 飞行俯仰 + 高转速下的毫米级高频微颤（幅度收敛，避免拖拉机感）
    let jx = 0, jy = 0, jz = 0, rx = 0, rz = 0;
    if (S.vib && s > 0.02) {
        const a = s * s * 0.0026 * (S._dmgFx ? S._dmgFx.vibMul : 1);   // Phase 19：旋翼损伤振动放大
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
        FLY.x = clamp(FLY.x + (mzF * fs - mxF * fc) * sp, -58, 58);
        FLY.z = clamp(FLY.z + (mzF * fc + mxF * fs) * sp, -58, 58);
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
    if (rig) rig.update(dt, W.camera, S.time, s);
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
    // 机体指示灯：环境亮度淡入淡出 + 信标/频闪节拍（随引擎）
    if (nlights) nlights.searchTerrainMul = W.terrainKey === 'desert' ? 0.45 : 1;   // P4c 沙漠搜索灯过曝
    if (scenery && scenery.sync(W.terrainKey, S.env, S.mode === 'mission') && W.terrainKey === 'desert' && W.duneFar) {
      // P4c 沙漠色调随时段：清晨/黄昏远景沙丘偏暖（明度规则与 32-envpreset 同式）
      const P = ENV_PRESETS[S.env] || ENV_PRESETS.day;
      W.duneFar.material.color.setHex(DUNE_BASE).multiplyScalar(desertEnvDim(P) * 0.78);
      if (S.env === 'dusk' || S.env === 'dawn') W.duneFar.material.color.multiply(_scnWarm);
    }
    if (nlights) nlights.update(dt, S.time, s);
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
      // + 信息流/播报（仿 enemyAir.killEvent 消费，单槽）
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
  W.skyMat.uniforms.uTime.value = S.time;
  if (W.terrainKey === 'water') W.updateWater(S.time, washfx ? washfx.strength : 0, FLY.alt, apache.root.position.x, apache.root.position.z);

  // 电影镜头包 S2/S3（光晕/体积光/景深/白闪/震屏）+ 慢动作 timeScale：见 70-hud.js
  dt *= _tickPostFx(rawDt);

  if (doRender) { composer.render(W.scene, W.camera, S.time); updateLabels(); }

  _tickModeChip();     // P14-B+E 模式/输入状态徽标（70-hud.js）

  _tickHud(dt, s, rpm);   // RPM/弹药/FPS/自动降档/首访引导（70-hud.js）

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
