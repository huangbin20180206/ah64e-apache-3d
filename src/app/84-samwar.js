// ============================================================
// 84-samwar.js — 敌方反击与生存（Phase 19：SAM / RWR / 干扰弹 / 战损操控）
// ============================================================
// 纯逻辑模块（照 83-arcade 先例）：零 THREE、零 DOM、零 localStorage——
// 全部状态为普通对象与数字，输入输出均为 plain object，时间由 70-app loop
// 每帧喂（本模块不自带时钟）。因此可以用 node 桩直接驱动做纯 pytest，
// 不需要浏览器（tools/tests_pure/）。
//
//   玩法闭环（任务 §1B 方向 a）：
//     RWR 三态告警（被扫描→被锁定→导弹来袭）
//       → 玩家两种反制：J 投放干扰弹（诱骗）/ 连续机动（转向+侧移甩导引）
//       → 命中分级损伤（走既有 targets._heliDmg 统一损伤链，失败阈值/受损烟/
//         散布惩罚全部复用 P8 既有通道）
//       → 战损影响操控（penaltyFor 纯映射：速度/航向系数，由 70-app 应用到
//         环绕平移与 46-fpview 前向/侧飞积分）
//
//   模块边界纪律：
//     - 导弹不做"必中"：锁定告警 2.6s 是玩家的反应窗口；干扰弹与机动都能
//       实证规避（tools/tests_pure 断言直飞命中 / 机动脱靶 / 干扰弹诱骗）。
//     - 随机性全部走本模块自带的 _swMulberry32（固定种子，可复现——项目
//       "可复现随机"纪律）；测试可注入 rng 覆盖（概率分支确定性验证）。
//     - update(env) 不持有 env 之外的任何外部状态；env 由 70-app 复用同一
//       个 scratch 对象逐帧改写（零每帧分配），本模块只读。
//
// 拓扑：本文件（84）顶层符号 SAMCFG/SamWarModule 不得被低编号模块引用；
// 70-app 经宿主工厂槽 HOST.makeSamWar() 取用（79/80/81/83 先例）。
// ============================================================

// 参数表（唯一数值源）。平衡目标：锁定告警给足反应时间、导弹可目视可规避、
// 干扰弹稀缺（6 发）但高可靠（诱骗角窗内 80%）。
const SAMCFG = {
  TRACK: 2.2,        // 「被扫描」告警时长（s）——雷达照射的软告警段
  LOCK: 2.6,         // 「被锁定」告警时长（s）——发射前的最后反应窗口
  RELAUNCH: 6.0,     // 首发后的再装填窗口（s）——窗口过后可再次进入锁定链
  SCAN_MIN: 4.0,     // 进入交战后首次建锁的最短延迟（s，实际 = MIN + rng*RANGE）
  SCAN_RANGE: 5.0,   // 建锁延迟的随机段宽度（s）；总延迟按 1/aaRate 缩放（老兵更凶）
  MSL_V: 21,         // 巡航速度 u/s（1u≈2m → 42m/s，肉眼可跟踪；与机体机动
                     //   上限（FPV 16u/s）保持"可追但甩得开"的比例）
  MSL_V0: 12,        // 出膛初速（发射段加速感）
  MSL_ACC: 2.0,      // 加速收敛率
  MSL_LIFE: 10.0,    // 寿命 s（≈航程 210u，超出交战包线自毁）
  TURN: 1.1,         // 导引收敛率（一阶跟踪增益 rad/s 等效）——故意偏低：
                     //   追踪静止/慢目标绰绰有余，跟踪误差 = LOS角速度/增益，
                     //   连续机动（FPV 12u/s 级）把误差顶出视场即失锁（可规避的物理出处）
  GIMBAL: 0.55,      // 导引头视场半锥角 rad（≈32°）——弹目线甩出视场即永久失锁，
                     //   连续大机动可实证甩掉（evade 用例硬断言）
  HIT_R: 1.4,        // 近炸判定半径 u（对机身中心）
  DMG: 4,            // 命中损伤（再乘难度 aaDmg——与 AA 单发同通道）
  EVADE_RATE: 0.40,   // 触发"导引跟不上"的弹目线角速度阈值 rad/s（12u/s 横移在 30u 外即触发）
  EVADE_ON: 0.25,     // 机动脱锁需累计的规避时间（s）——早触发，给末段留出脱靶裕度
  EVADE_TURN: 0.20,   // 机动中导引收敛率乘数（20%——甩得开；纯 pytest evade 用例实证）
  FLARE_ARC: 0.55,   // 干扰弹诱骗角窗（弹轴与"弹→干扰弹"向夹角上限，rad≈32°）
  FLARE_P: 0.80,     // 角窗内单帧诱骗概率（每帧重掷，靠近越久越可能被拐走）
  FLARE_RANGE: 28,   // 干扰弹起效距离 u
  FLARE_COOL: 1.1,   // 投放冷却 s
  FLARE_FALL: 4.0,   // 干扰弹下落重力（半重力，视觉飘落）
  FLARE_LIFE: 2.2,   // 干扰弹滞空寿命 s
  FLARES: 6,         // 携带数
  MAX_MSL: 2,        // 并发导弹上限（池 3，同时在场 2——第二发走再装填链）
  LEAD_K: 0.5,       // 前置量系数（半前置追击：0=纯追踪 1=全前置）
  LEAD_CAP: 2.0,     // 前置量上限 u——廉价导引头的预测极限：无上限的半前置
                     //   对环机动目标几何自洽（目标永远坐在弹轴固定锥角内），
                     //   封顶后近距转为追尾式追踪，机动目标的提前量吃不满
};

// 自带可复现 PRNG（mulberry32 同式；独立命名避免与 00-utils 顶层符号冲突）
function _swMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 导弹池单元工厂（普通对象，预分配复用——零每帧分配纪律）
function _swMissile() {
  return {
    on: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1,   // 位置与单位方向
    v: 0, t: 0, decoyed: false, lost: false,              // decoyed=被干扰弹拐走；lost=导引头失锁
    lx: 0, ly: 0, lz: 0, hasLos: false,                  // 上一帧弹目线（机动检测）
  };
}

// 战损→操控惩罚表（与 P8 既有分级对齐：<4 无感；4~8 轻（-15%）；8~12 重
//（-30%）；≥12 濒坠（-45%））。penaltyFor 返回表条目引用（不新建对象）——
// 70-app 每帧调用零分配，直接存 S._pen 供环绕平移与 46-fpview 读取。
const SAM_PENALTY_TABLE = [
  { speedMul: 1.00, yawMul: 1.00 },   // dmg < 4
  { speedMul: 0.85, yawMul: 0.85 },   // 4 ≤ dmg < 8
  { speedMul: 0.70, yawMul: 0.70 },   // 8 ≤ dmg < 12
  { speedMul: 0.55, yawMul: 0.60 },   // dmg ≥ 12
];

class SamWarModule {
  constructor(opts = {}) {
    this.flares = SAMCFG.FLARES;
    this._flareCool = 0;
    this.phase = 'idle';          // idle | track | lock | launch
    this._phaseT = 0;
    this._scanT = 2.0;            // 首次交战前的缓冲（防起飞瞬间立刻被锁）
    this.site = null;             // 当前锁定我的发射位快照 {x,z}
    this.missiles = [_swMissile(), _swMissile(), _swMissile()];
    this._flare = null;           // 空中干扰弹状态 {on,x,y,z,vx,vy,vz,t}
    this.hitPending = null;       // 命中事件（70-app 消费后置 null）：{x,y,z,dmg}
    this.flareFx = null;          // 干扰弹投放事件（渲染层消费后置 null）
    this.launchN = 0;              // 发射计数（单调递增；70-app 跟踪增量播报）
    this._evade = 0;               // 全局机动累计（最近一枚导弹的弹目线角速度）
    this._env = null;              // 上次 update 的 env 引用（dispenseFlare 用）
    this._rng = opts.rng || _swMulberry32(opts.seed || 20260917);
  }

  // ---------- 主更新（每帧；env 见下方字段约定，全部只读） ----------
  // env = { dt, aaOn,                      // dt 秒；aaOn=交战门控（在反击区且离地）
  //         heli: {x,y,z, vx,vy,vz},       // 机体位置与速度（世界系，u/s）
  //         sites: [{x,z} ×N 预分配], siteN,  // 存活发射位（plain 对象，可复用）
  //         aaRate, aaDmg }                // 难度系数（缺省 1）
  update(env) {
    const dt = env.dt || 0;
    this._env = env;
    if (this._flareCool > 0) this._flareCool = Math.max(0, this._flareCool - dt);

    // 干扰弹：自由落体 + 寿命
    const fl = this._flare;
    if (fl && fl.on) {
      fl.t += dt;
      fl.x += fl.vx * dt; fl.y += fl.vy * dt; fl.z += fl.vz * dt;
      fl.vy -= SAMCFG.FLARE_FALL * dt;
      if (fl.t >= SAMCFG.FLARE_LIFE || fl.y < 0.05) fl.on = false;
    }

    // RWR 状态机（交战门控与 AA 同语义：脱离反击区/落地即休眠）
    const engage = !!(env.aaOn && env.siteN > 0);
    const rate = env.aaRate || 1;
    if (this.phase === 'idle') {
      if (engage) {
        this._scanT -= dt * rate;
        if (this._scanT <= 0) {
          const i = (this._rng() * env.siteN) | 0;
          const s = env.sites[Math.min(i, env.siteN - 1)];
          this.site = { x: s.x, z: s.z };
          this.phase = 'track'; this._phaseT = SAMCFG.TRACK;
        }
      } else {
        this._scanT = Math.min(this._scanT, 1.5);
      }
    } else if (this.phase === 'track') {
      if (!engage) { this.phase = 'idle'; this._scanT = 1.5; }
      else {
        this._phaseT -= dt;
        if (this._phaseT <= 0) { this.phase = 'lock'; this._phaseT = SAMCFG.LOCK; }
      }
    } else if (this.phase === 'lock') {
      if (!engage) { this.phase = 'idle'; this._scanT = 1.5; }
      else {
        this._phaseT -= dt;
        if (this._phaseT <= 0) { this._fireFrom(this.site, env); this.phase = 'launch'; this._phaseT = SAMCFG.RELAUNCH; }
      }
    } else { // launch：导弹在场。再装填窗口过后可再次进入锁定（并发上限内）
      let live = 0;
      for (const m of this.missiles) if (m.on) live++;
      if (live === 0) {
        if (engage) { this.phase = 'track'; this._phaseT = SAMCFG.TRACK; }
        else { this.phase = 'idle'; this._scanT = SAMCFG.SCAN_MIN + this._rng() * SAMCFG.SCAN_RANGE; this.site = null; }
      } else if (engage && live < SAMCFG.MAX_MSL) {
        this._phaseT -= dt * rate;
        if (this._phaseT <= 0) {
          const i = (this._rng() * env.siteN) | 0;
          const s = env.sites[Math.min(i, env.siteN - 1)];
          this.site = { x: s.x, z: s.z };
          this.phase = 'lock'; this._phaseT = SAMCFG.LOCK;
        }
      }
    }

    // 机动脱锁检测（最近一枚在飞导弹的弹目线角速度）
    this._evade = Math.max(0, this._evade - dt * 1.5);
    // 导弹飞行（分段推进防穿隧：单帧步长 > 0.6u 时切片，同 65-weapons 曳光纪律）
    for (const m of this.missiles) {
      if (!m.on) continue;
      m.t += dt;
      if (m.t >= SAMCFG.MSL_LIFE) { m.on = false; continue; }
      m.v += (SAMCFG.MSL_V - m.v) * Math.min(1, dt * SAMCFG.MSL_ACC);

      const hx = env.heli.x, hy = env.heli.y + 0.6, hz = env.heli.z;   // 机身中心
      const flLive = fl && fl.on;

      // 导引头跟踪（失锁/被诱骗后不再导引，直线飞到自毁/触地）：
      //   ① 视场失锁（硬机制）：弹目线甩出视场锥（GIMBAL）即永久失锁——
      //      连续大机动让导引头跟不住，这是"机动规避"的物理出处；
      //   ② 机动软降级：弹目线角速度持续超阈值 → 导引收敛率降到 20%。
      if (!m.decoyed && !m.lost) {
        const lx2 = hx - m.x, ly2 = hy - m.y, lz2 = hz - m.z;
        const ll = Math.max(1e-4, Math.hypot(lx2, ly2, lz2));
        const cosLos = (lx2 * m.dx + ly2 * m.dy + lz2 * m.dz) / ll;
        if (m.hasLos && cosLos < Math.cos(SAMCFG.GIMBAL)) {
          m.lost = true;
        } else {
          if (m.hasLos) {
            const dot = Math.max(-1, Math.min(1, (lx2 * m.lx + ly2 * m.ly + lz2 * m.lz) / ll));
            const dAng = Math.acos(dot);
            if (dAng / Math.max(dt, 1e-4) > SAMCFG.EVADE_RATE) this._evade = Math.min(1.2, this._evade + dt);
          }
          m.lx = lx2 / ll; m.ly = ly2 / ll; m.lz = lz2 / ll; m.hasLos = true;
        }
      }

      if (!m.decoyed && !m.lost) {
        // 前置追击目标点：半前置追机体（LEAD_CAP 封顶——见参数表注释）
        const ddx = hx - m.x, ddy = hy - m.y, ddz = hz - m.z;
        const dd = Math.max(1e-4, Math.hypot(ddx, ddy, ddz));
        const tof = dd / Math.max(1, m.v);
        const lv = Math.hypot(env.heli.vx || 0, env.heli.vy || 0, env.heli.vz || 0);
        const lk = Math.min(SAMCFG.LEAD_K * lv * tof, SAMCFG.LEAD_CAP) / Math.max(1e-4, lv * tof);
        const tx = hx + (env.heli.vx || 0) * tof * lk;
        const ty = hy + (env.heli.vy || 0) * tof * lk;
        const tz = hz + (env.heli.vz || 0) * tof * lk;
        // 比例导引：机动累计越高收敛率越低（软降级层）
        const turn = SAMCFG.TURN * (this._evade > SAMCFG.EVADE_ON ? SAMCFG.EVADE_TURN : 1);
        let gx = tx - m.x, gy = ty - m.y, gz = tz - m.z;
        const gl = Math.max(1e-4, Math.hypot(gx, gy, gz));
        gx /= gl; gy /= gl; gz /= gl;
        const k = Math.min(1, dt * turn);
        m.dx += (gx - m.dx) * k; m.dy += (gy - m.dy) * k; m.dz += (gz - m.dz) * k;
        const dl = Math.max(1e-4, Math.hypot(m.dx, m.dy, m.dz));
        m.dx /= dl; m.dy /= dl; m.dz /= dl;

        // 干扰弹诱骗判定（角窗内 + 每帧重掷概率）
        if (flLive) {
          const fx = fl.x - m.x, fy = fl.y - m.y, fz = fl.z - m.z;
          const fd = Math.hypot(fx, fy, fz);
          if (fd < SAMCFG.FLARE_RANGE) {
            const dot = (fx * m.dx + fy * m.dy + fz * m.dz) / Math.max(1e-4, fd);
            if (dot > Math.cos(SAMCFG.FLARE_ARC) && this._rng() < SAMCFG.FLARE_P) m.decoyed = true;
          }
        }
      } else if (m.decoyed && flLive) {
        // 已被诱骗：导引改咬干扰弹（诱骗成功后不再看机体——这正是诱骗的意义）
        let gx = fl.x - m.x, gy = fl.y - m.y, gz = fl.z - m.z;
        const gl = Math.max(1e-4, Math.hypot(gx, gy, gz));
        gx /= gl; gy /= gl; gz /= gl;
        const k = Math.min(1, dt * SAMCFG.TURN);
        m.dx += (gx - m.dx) * k; m.dy += (gy - m.dy) * k; m.dz += (gz - m.dz) * k;
        const dl = Math.max(1e-4, Math.hypot(m.dx, m.dy, m.dz));
        m.dx /= dl; m.dy /= dl; m.dz /= dl;
      }

      // 分段推进 + 命中/诱骗终点判定
      const step = m.v * dt;
      const segN = Math.min(10, Math.max(1, Math.ceil(step / 0.6)));
      let done = false;
      for (let si = 0; si < segN && !done; si++) {
        m.x += m.dx * step / segN; m.y += m.dy * step / segN; m.z += m.dz * step / segN;
        if (!m.decoyed) {
          const hr = Math.hypot(m.x - hx, m.y - hy, m.z - hz);
          if (hr < SAMCFG.HIT_R) {
            m.on = false;
            this.hitPending = { x: m.x, y: m.y, z: m.z, dmg: Math.round(SAMCFG.DMG * (env.aaDmg || 1)) };
            done = true;
          }
        } else if (flLive && Math.hypot(m.x - fl.x, m.y - fl.y, m.z - fl.z) < 1.2) {
          m.on = false; done = true;   // 被拐到干扰弹上自毁
        }
        if (m.y <= 0.05) { m.on = false; done = true; }   // 触地
      }
      if (!m.on) continue;
    }
  }

  // 发射一枚（从发射位快照；初速段朝机体当前前置点）
  _fireFrom(site, env) {
    if (!site) return;
    let m = null;
    for (const c of this.missiles) if (!c.on) { m = c; break; }
    if (!m) return;
    const hx = env.heli.x, hy = env.heli.y + 0.6, hz = env.heli.z;
    const ddx = hx - site.x, ddz = hz - site.z, ddy = hy - 0.8;
    const dd = Math.max(1e-4, Math.hypot(ddx, ddy, ddz));
    m.on = true; m.t = 0; m.v = SAMCFG.MSL_V0; m.decoyed = false; m.lost = false; m.hasLos = false;
    m.x = site.x; m.y = 0.8; m.z = site.z;
    m.dx = ddx / dd; m.dy = ddy / dd; m.dz = ddz / dd;
    this.launchN++;
  }

  // ---------- 玩家动作：投放干扰弹（J；一次性操作，无 repeat 需求） ----------
  // 返回 false = 无弹或冷却中（70-app 播 toast）。位置取上次 env 的机体位。
  dispenseFlare() {
    if (this.flares <= 0 || this._flareCool > 0 || !this._env) return false;
    const e = this._env;
    this.flares--;
    this._flareCool = SAMCFG.FLARE_COOL;
    this._flare = {
      on: true, t: 0,
      x: e.heli.x, y: e.heli.y - 0.3, z: e.heli.z,
      vx: (e.heli.vx || 0) * 0.6, vy: -1.2, vz: (e.heli.vz || 0) * 0.6,
    };
    this.flareFx = { x: this._flare.x, y: this._flare.y, z: this._flare.z,
                     vx: this._flare.vx, vy: this._flare.vy, vz: this._flare.vz };
    return true;
  }

  // ---------- 战损 → 操控惩罚（返回 SAM_PENALTY_TABLE 条目引用，零分配） ----------
  penaltyFor(dmg) {
    return SAM_PENALTY_TABLE[dmg >= 12 ? 3 : dmg >= 8 ? 2 : dmg >= 4 ? 1 : 0];
  }

  // 复位（startMission / resetRange 调用；launchN 单调保留——消费方按增量跟踪）
  reset() {
    this.flares = SAMCFG.FLARES;
    this._flareCool = 0;
    this.phase = 'idle';
    this._phaseT = 0;
    this._scanT = 2.0;
    this.site = null;
    this._flare = null;
    this.hitPending = null;
    this.flareFx = null;
    this._evade = 0;
    for (const m of this.missiles) { m.on = false; m.decoyed = false; m.lost = false; m.hasLos = false; }
  }

  // 只读遥测（__dbg.samwar.state()；测试断言一律读此状态源）
  state() {
    let live = 0, nearest = -1;
    const e = this._env;
    for (const m of this.missiles) {
      if (!m.on) continue;
      live++;
      if (e) {
        const d = Math.hypot(m.x - e.heli.x, m.y - (e.heli.y + 0.6), m.z - e.heli.z);
        if (nearest < 0 || d < nearest) nearest = d;
      }
    }
    return {
      phase: this.phase,
      flares: this.flares,
      missiles: live,
      nearest: +(nearest >= 0 ? nearest.toFixed(1) : -1),
      decoyed: this.missiles.some(m => m.on && m.decoyed),
      lost: this.missiles.some(m => m.on && m.lost),
      evade: +this._evade.toFixed(2),
      site: this.site ? { x: +this.site.x.toFixed(1), z: +this.site.z.toFixed(1) } : null,
      flareOn: !!(this._flare && this._flare.on),
      launchN: this.launchN,
    };
  }
}

// 经 HOST 注册工厂——70-app（低编号）不得反向引用 84 的构造器（拓扑硬规则），
// 经宿主槽位取用（与 79/80/81/83 同款模式）。
HOST.makeSamWar = (opts) => new SamWarModule(opts);
