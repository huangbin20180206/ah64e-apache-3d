// ============================================================
// 89-resources.js — 资源与压力模型（Phase 20-B：燃油 / 补给窗口）
// ============================================================
// 纯逻辑模块（84/86/87 同款纪律）：零 THREE、零 DOM、零 localStorage。
// 弹药本体仍由 WeaponRig 持有（rig.gunAmmo/rocketAmmo/hfAmmo——单一事实
// 源纪律，本模块不复制第二套弹药数）；本模块持有燃油与补给窗口状态，
// 弹药侧只提供 ammoDry 谓词（接线层把 rig 三值传入判定失败条件）。
//
//   燃油（任务局资源压力）：
//     只在任务 active 局消耗（show/train 展示模式不耗——非任务玩家不会
//     "莫名没油"）；消耗率 = HOVER + (MAX-HOVER) × strength，strength 由
//     接线层从飞行状态派生（0=悬停静止，1=满机动——FPV 前向/侧飞/升降或
//     环绕平移），"悬停省、大机动费"的物理出处。
//     容量按标准时限 360s 设计：满油悬停 454s > 360s——挂机悬停会先被
//     超时失败判负，但真打满全场+机动必须规划返场；两档低油告警事件
//     （30%/12%——Betty/toast 由接线层消费）一次性 latch；耗尽产 fuelOut
//     事件（接线层 failMission('fuel')——迫降失败）。
//   返场补给窗口（与时间压力联动——补给耗时本身占用任务时限）：
//     停机坪 RTB_DIST 内、低空、悬停稳定度 ≥0.9，持续 RTB_TIME 秒 →
//     resupplied 事件（接线层恢复满弹+满油）。离开窗口进度清零（返场
//     补给必须一次完成——时间压力的另一面）。limited_ammo 变体禁用窗口
//     （"受限弹药"挑战语义；同时保护 frugal 成就"剩余≥50%"不可刷）。
//
//   事件（events 数组，接线层消费后清空；一次性 latch 语义在模块内保证）：
//     {type:'warn1'|'warn2'|'fuelOut'|'rtbTick'|'resupplied', p?}
//
// 拓扑：89 顶层符号不得被低编号模块引用；70-app 经 HOST.makeResources() 取用。
// ============================================================

// 参数表（唯一数值源；纯 pytest 期望值与此表同源）
const RESCFG = {
  FUEL_MAX: 100,        // 满油 %
  FUEL_HOVER: 0.22,     // 悬停消耗 %/s（满油 454s > 时限 360s——超时先判负）
  FUEL_MAXRATE: 1.0,    // 满机动消耗 %/s（大机动局油压显著）
  WARN1: 30,            // 低油告警一档 %（"LOW FUEL"）
  WARN2: 12,            // 低油告警二档 %（"FUEL CRITICAL"）
  RTB_DIST: 8,          // 停机坪补给半径 u（homeDist 判定）
  RTB_ALT: 4,           // 补给窗口高度上限 u
  RTB_STAB: 0.9,        // 悬停稳定度下限（rescue 作业窗同参数——低空稳定悬停）
  RTB_TIME: 3.0,        // 补给窗口时长 s（与时间压力联动：耗时计入任务用时）
  RTB_TICK: 0.5,        // 补给进度播报节拍 s
};

class ResourcesModule {
  constructor(opts = {}) {
    this.cfg = Object.assign({}, RESCFG, opts.cfg || {});   // 权重可注入（纯 pytest 可测）
    this.fuel = this.cfg.FUEL_MAX;
    this.rtbT = 0;            // 当前补给窗口累计 s
    this.rtbOn = false;       // 窗口进行中标志（HUD 显示用）
    this.events = [];         // 待消费事件
    this._warn1 = false;      // 一次性 latch
    this._warn2 = false;
    this._out = false;
    this._tick = 0;
    this._resupplied = false;  // 本局已补给次数（遥测；多周目策略可见）
  }

  // ---------- 任务生命周期 ----------
  start() {   // beginMission/接线层调用：满油开局（弹药恢复由 applyVariantAmmo 既有链负责）
    this.fuel = this.cfg.FUEL_MAX;
    this.rtbT = 0; this.rtbOn = false;
    this._warn1 = this._warn2 = this._out = false;
    this._tick = 0; this._resupplied = false;
    this.events.length = 0;
  }
  reset() { this.start(); }

  // ---------- 主更新（每帧；env 全部只读） ----------
  // env = { dt, active,           // active=任务进行中（S._mission.phase==='active'）
  //         strength,             // 机动强度 0..1（接线层派生，见文件头注释）
  //         homeDist, alt,        // 距停机坪原点距离 / 离地高度 u
  //         stability,            // 悬停稳定度 0..1（S._stability 既有派生量）
  //         variant }             // 任务变体（limited_ammo 禁补给窗口）
  update(env) {
    const dt = env.dt || 0, C = this.cfg;
    if (env.active) {
      const s = Math.max(0, Math.min(1, env.strength == null ? 0 : env.strength));
      const rate = C.FUEL_HOVER + (C.FUEL_MAXRATE - C.FUEL_HOVER) * s;
      this.fuel = Math.max(0, this.fuel - rate * dt);
      // 低油两档告警（一次性 latch——事件只在跨越阈值那一次产生）
      if (!this._warn1 && this.fuel < C.WARN1) { this._warn1 = true; this.events.push({ type: 'warn1', p: Math.round(this.fuel) }); }
      if (!this._warn2 && this.fuel < C.WARN2) { this._warn2 = true; this.events.push({ type: 'warn2', p: Math.round(this.fuel) }); }
      if (!this._out && this.fuel <= 0) { this._out = true; this.events.push({ type: 'fuelOut' }); }
    }
    // 返场补给窗口（active 才可用；limited_ammo 禁用——挑战语义+frugal 成就保护）
    const canRtb = !!(env.active && env.variant !== 'limited_ammo'
      && env.homeDist < C.RTB_DIST && env.alt < C.RTB_ALT
      && (env.stability == null ? 1 : env.stability) >= C.RTB_STAB);
    if (canRtb) {
      this.rtbOn = true;
      this.rtbT += dt;
      this._tick += dt;
      if (this._tick >= C.RTB_TICK) { this._tick = 0; this.events.push({ type: 'rtbTick', p: Math.min(1, this.rtbT / C.RTB_TIME) }); }
      if (this.rtbT >= C.RTB_TIME - 1e-9) {   // 浮点累加钳制：60×0.05 名义 3s 实为 2.9999…（86-damage 冷却同款教训）
        this.rtbT = 0; this.rtbOn = false;
        this._resupplied = true;
        this.fuel = C.FUEL_MAX;                     // 油补给（弹药恢复由接线层走 applyVariantAmmo）
        this._warn1 = this._warn2 = this._out = false;   // 油已满，告警 latch 复位
        this.events.push({ type: 'resupplied' });
      }
    } else {
      // 离开窗口进度清零：返场补给必须一次完成（时间压力——中途接敌/漂移即作废）
      this.rtbOn = false;
      if (this.rtbT > 0) this.rtbT = 0;
      this._tick = 0;
    }
  }

  // 弹药耗尽谓词（失败条件判定用；弹药真值在 rig——本模块只做纯判定）
  ammoDry(gun, rk, hf) { return (gun | 0) <= 0 && (rk | 0) <= 0 && (hf | 0) <= 0; }

  // 只读遥测（__dbg.resources.state()；测试断言一律读此状态源）
  state() {
    return {
      fuel: +this.fuel.toFixed(1),
      warn1: this._warn1, warn2: this._warn2, out: this._out,
      rtbOn: this.rtbOn, rtbP: +Math.min(1, this.rtbT / this.cfg.RTB_TIME).toFixed(2),
      resupplied: this._resupplied,
      events: this.events.map(e => e.type),
    };
  }
}

// 经 HOST 注册工厂——70-app（低编号）经宿主槽位取用（拓扑同款模式）。
HOST.makeResources = (opts) => new ResourcesModule(opts);
