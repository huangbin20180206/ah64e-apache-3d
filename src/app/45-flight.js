// ============================================================
// 45-flight.js — 起飞 / 悬停 / 降落 状态机
// 规则：旋翼转速不足禁止起飞；空中禁止关停发动机（app 里拦截）
// ============================================================

const FLY = {
  state: 'ground',      // ground | up | hover | down
  alt: 0,               // 离地高度（模型单位，1u ≈ 2m）
  x: 0, z: 0,           // 世界平移（第一人称驾驶写入；环绕模式恒 0）
  pitch: 0,             // 飞行俯仰（叠加到机体姿态上）
  yaw: 0,               // 航向（第一人称驾驶写入；环绕模式恒 0）
  roll: 0,              // 侧倾（同上）
  auto: false,          // P4b 航线自动驾驶中（75-routes）：hover 沉浮让位
  fp: false,            // 第一人称接管中：hover 沉浮让位，高度由 FP 驱动
  userAlt: null,        // P4-A 移动端右摇杆接管的高度（null=未接管，悬停钉回 HOVER+沉浮；
                        // 触地/FPV 退出同步——见 46-fpview exit）
  comp: 0,              // 停放俯仰带来的 root 高度补偿（地面时非零）
  vrs: false,           // 涡环状态（Vortex Ring State）失速标志
  vrsBuffet: 0,         // VRS 剧烈抖动量
  ige: 1.0,             // 地面效应（In-Ground Effect）升力增益系数
  HOVER: 14,            // 悬停高度 u
  VY: 2.3,              // 垂直速度 u/s
  MIN_SPIN: 0.92,       // 起飞所需转速比（额定 289 RPM 的 92%）
};

function flyUpdate(dt) {
  const F = FLY;
  // P5-A：起降姿态连续化——各状态只给出"目标俯仰"，FLY.pitch 用 damp 向目标
  // 收敛（状态切换瞬间姿态保持当前值继续过渡，不再硬跳变）。收敛速率：
  // up/down 快（爬升/进近约 1s 到位），ground 慢（触地后缓摆回停放角约 2s），
  // hover 保持既有慢沉浮语义。触地/到顶的最终值语义不变（GROUND_PITCH / 0），
  // comp 仍由收敛后的 F.pitch 派生，无独立高度源。
  if (F.state === 'up') {
    // Phase 19：爬升效率乘战损系数（旋翼升力 × 引擎功率；HOST.S._dmgFx 是
    // 70-app 写入的运行时槽，无损伤时缺省 1——既有升降测试零变化）
    const _dmfx = (HOST.S && HOST.S._dmgFx) || null;
    F.alt += F.VY * (_dmfx ? _dmfx.liftMul * _dmfx.powerCap : 1) * dt;
    F.pitch += (-0.045 - F.pitch) * Math.min(1, dt * 1.8);   // 抬头姿态（连续收敛）
    if (F.alt >= F.HOVER) {                  // 到顶转悬停
      F.alt = F.HOVER; F.state = 'hover';
    }
  } else if (F.state === 'down') {
    // 两段进近：远端 1.6 u/s 平稳下降，最后 4u 收敛到 0.35 u/s 轻柔触地
    const vy = F.alt > 4 ? 1.6 : lerp(0.35, 1.6, F.alt / 4);
    F.alt -= vy * dt;
    F.pitch += (0.03 - F.pitch) * Math.min(1, dt * 1.8);      // 轻微低头进近（连续收敛）
    if (F.alt <= 0) {                        // 触地复位
      F.alt = 0; F.state = 'ground';
      F.x = 0; F.z = 0; F.yaw = 0; F.roll = 0;
      F.userAlt = null;                     // P4-A：接地即解除摇杆高度接管
      if (HOST.orbit) {                    // Phase 1-A：经宿主取用（01-host.js）
        HOST.orbit.tTarget.set(0, 1.25, 0.2);
        HOST.orbit.target.copy(HOST.orbit.tTarget);
      }
    }
  } else if (F.state === 'hover') {
    // 第一人称接管时沉浮/俯仰让位（高度/姿态由 46-fpview 驱动），只保留极轻微呼吸感
    if (F.auto) {
      // P4b 航线自动驾驶（75-routes）接管：高度/俯仰由航线写入，这里不动
    } else if (F.fp) {
      F.pitch += (0 - F.pitch) * Math.min(1, dt * 2);
    } else if (F.userAlt != null) {
      // P4-A 移动端右摇杆高度接管：钉在用户高度，无沉浮（与 fp 分支同样收敛俯仰）
      F.alt = F.userAlt;
      F.pitch += (0 - F.pitch) * Math.min(1, dt * 2);
    } else {
      const t = performance.now() / 1000;
      F.alt = F.HOVER + Math.sin(t * 0.9) * 0.12;   // 慢速沉浮
      // 沉浮俯仰：既有 sin 微动作为目标，继续 damp 消除 up→hover 的残留跳变
      F.pitch += (Math.sin(t * 0.45) * 0.012 - F.pitch) * Math.min(1, dt * 2);
    }
  } else {
    // 地面：停放俯仰（尾轮着地的 nose-up 姿态）——触地后从进近低头缓摆回位
    F.alt = 0;
    F.pitch += (GROUND_PITCH - F.pitch) * Math.min(1, dt * 2.2);
  }
  // root 高度补偿随俯仰线性过渡：地面全量，空中归零（FP 接管时强制归零，
  // 防止机头下俯被误当成停放姿态把整机抬起）
  F.comp = F.fp ? 0 : (F.pitch < 0 ? (F.pitch / GROUND_PITCH) * GROUND_PITCH_COMP : 0);
}
