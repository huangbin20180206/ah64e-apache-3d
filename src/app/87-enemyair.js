// ============================================================
// 87-enemyair.js — 敌方空中力量 AI（Phase 20-A：A2A 武装直升机编队）
// ============================================================
// 纯逻辑模块（84-samwar 同款纪律）：零 THREE、零 DOM、零 localStorage——
// 全部状态为普通对象与数字，坐标用普通 {x,y,z}，时间由 70-app loop 每帧
// 喂 update(env)。渲染薄层（88-enemyvis，浏览器接线批）只读 state() 把
// 数字同步到 mesh；命中入口 hitTest(pos,dmg,margin) 由 65-weapons 对空
// 链经渲染层桥接调用（pos 为普通对象 {x,y,z}，不要求 THREE.Vector3）。
//
//   编队与状态机（任务 §A 全链）：
//     patrol  —— 绕任务锚点环形巡逻（僚机相位差+高度差跟随长机）
//     search  —— 视距/视锥内发现玩家：0.8s 转向确认（脱离视距即回巡逻）
//     attack  —— 保持 24~32u 攻击站位（僚机侧翼分散），机炮+火箭按节奏
//                 开火；命中概率随距离衰减、随玩家机动稳定度减半——
//                 玩家侧的规避手段是机动（与 SAM 的干扰弹互补）。
//     evade   —— 被玩家持续瞄准（LOCKED_T）或受损超阈：对角侧向蛇形
//                 （两机反向=编队分散），期间仍以半概率还击。
//     withdraw — 弹药耗尽或损伤超阈：向锚点外爬升撤离，出界即退场。
//     down    —— 被击落：killEvent 交消费方计分/坠毁动画（纯逻辑退场）。
//
//   事件（消费后置 null，84 hitPending 同款单槽约定）：
//     hitPending —— 敌机火力命中玩家 {x,y,z,dmg}（70-app 走 _heliDmg 链）
//     killEvent  —— 玩家击落敌机 {i,type:'enemy',label,x,y,z}（计分挂
//                   83-arcade TARGET_SCORES.enemy + ace 成就）
//
//   随机性全部走注入 rng（缺省 _swMulberry32 固定种子——可复现纪律）。
//
// 拓扑：本文件（87）顶层符号不得被低编号模块引用；70-app 经宿主工厂槽
// HOST.makeEnemyAir() 取用（79/80/81/83/84/86 先例）。
// ============================================================

// 参数表（唯一数值源；纯 pytest 期望值与此表同源）
const ENEMYCFG = {
  N: 2,                 // 编队机数
  HP: 8,                // 每机血量（机炮 8 发；地狱火 3 发）
  HIT_R: 2.2,           // 被命中判定半径 u（对机身中心；旋翼尺度放宽）
  SPEED: 12,            // 巡航速度 u/s（低于玩家 FPV 上限 16——追不上满速玩家）
  PATROL_W: 0.10,       // 巡逻角速度 rad/s
  PATROL_R: 30,         // 巡逻半径 u（绕任务锚点）
  PATROL_H: 18,         // 巡逻高度 u
  WING_DH: 2.5,         // 僚机高度差 u（编队立体疏散）
  WING_DPH: 0.6,        // 巡逻相位差 rad
  VISION: 55,           // 索敌视距 u
  VISION_LOSE: 66,      // 失去接触视距（>VISION 宽 20% 防边界抖动）
  FOV: 0.80,            // 索敌视锥半角 rad（巡逻机头向为轴）
  SEARCH_T: 0.8,        // 索敌确认时长 s
  ATK_NEAR: 24, ATK_FAR: 32,   // 攻击站位保持带 u（<近拉远、>远逼近）
  ATK_FLANK: 10,        // 攻击态僚机侧翼偏移 u（编队分散）
  GUN_DMG: 1,           // 敌机机炮单发伤害（×难度 aaDmg，与 AA 单发同量级）
  GUN_RATE: 0.35,       // 机炮开火间隔 s
  GUN_N: 40,            // 机炮弹数（耗尽转火箭打光即撤出条件的一半）
  GUN_HIT_P: 0.22,      // 机炮命中概率（×距离衰减 ×玩家稳定度因子）
  RK_DMG: 3,            // 敌机火箭单发伤害
  RK_RATE: 4.0,         // 火箭开火间隔 s
  RK_N: 4,              // 火箭弹数
  RK_HIT_P: 0.30,       // 火箭命中概率
  P_DIST0: 40,          // 命中概率的距离衰减基准（p_dist = 0.5+0.5×min(1,d/P_DIST0)）
  P_STAB0: 0.5,         // 玩家稳定度因子底（=P_STAB0+(1-P_STAB0)×stability；机动规避收益）
  EVADE_T: 3.5,         // 规避持续时长 s
  EVADE_DMG: 3,         // 受损规避阈值（累计）
  WITHDRAW_DMG: 6,      // 撤出损伤阈值
  EVADE_VY: 5,          // 规避垂直机动速度 u/s
  EVADE_SIN: 6,         // 蛇形频率
  LOCKED_ARC: 0.35,     // 玩家瞄准角窗 rad（|敌-机头夹角|<此值算被瞄准）
  LOCKED_T: 1.2,        // 被持续瞄准触发规避的秒数
  EXIT_R: 70,           // 撤出离场距离（超此值退场）
  CLAMP_R: 60,          // 位置边界（与玩家活动区一致 58+余量）
};

// 敌机单元工厂（普通对象，预分配复用——零每帧分配纪律）
function _enemyUnit(i) {
  return {
    i, on: false,               // i=0 长机 / 1 僚机
    x: 0, y: 0, z: 0,           // 位置（世界系普通数）
    hx: 0, hy: 0, hz: 1,        // 机头单位向量
    ang: 0,                     // 巡逻相位
    phase: 'patrol',
    pt: 0,                      // 状态内计时
    hp: ENEMYCFG.HP,
    gunN: ENEMYCFG.GUN_N, rkN: ENEMYCFG.RK_N,
    gunT: 0, rkT: 0,            // 开火节奏钟
    aimT: 0,                   // 被玩家持续瞄准时长
    dmg: 0,                    // 累计受伤（EVADE/WITHDRAW 判定源）
    kills: 0,
  };
}

class EnemyAirModule {
  constructor(opts = {}) {
    this.units = [_enemyUnit(0), _enemyUnit(1)];
    this.active = false;         // 任务局门控（spawn 置 true）
    this.anchor = { x: 0, z: 42 };   // 巡逻锚（任务锚点；spawn 传入）
    this.hitPending = null;      // 敌机→玩家命中事件（消费后置 null）
    // opt1（2026-10-20）：killEvent 改为事件队列——同一帧连毁两个时第二个不再被覆盖丢分。
    // 对外语义不变：读 killEvent = 队首（无则 null）；消费方写 null = 出队一个；写对象 = 入队。
    this._kq = [];
    Object.defineProperty(this, 'killEvent', {
      get() { return this._kq.length ? this._kq[0] : null; },
      set(v) { if (v == null) this._kq.shift(); else this._kq.push(v); },
      configurable: true,
    });
    this.fireEvent = null;       // 敌机开火事件（渲染层曳光；消费后置 null）
    this._res = 1;               // 难度抗打击系数缓存（env 喂入）
    this._env = null;            // 上次 env 引用
    this._rng = opts.rng || _swMulberry32(opts.seed || 20260918);
  }

  // ---------- 任务生命周期：spawn（startMission 调）/ reset（清场调） ----------
  // anchor：巡逻锚点（任务锚=敌方基地方位；由接线层传 baseCenter 侧翼）
  spawn(anchor) {
    this.active = true;
    this.anchor = { x: anchor ? anchor.x : 0, z: anchor ? anchor.z : 42 };
    this.hitPending = null;
    this._kq.length = 0;          // 清空击落事件队列
    this.fireEvent = null;
    const r = ENEMYCFG.PATROL_R, h = ENEMYCFG.PATROL_H;
    for (const u of this.units) {
      u.on = true;
      u.ang = u.i * ENEMYCFG.WING_DPH;
      u.x = this.anchor.x + Math.cos(u.ang) * (r + u.i * 4);
      u.z = this.anchor.z + Math.sin(u.ang) * (r + u.i * 4);
      u.y = h + u.i * ENEMYCFG.WING_DH;
      u.phase = 'patrol'; u.pt = 0;
      u.hp = ENEMYCFG.HP; u.dmg = 0; u.kills = 0;
      u.gunN = ENEMYCFG.GUN_N; u.rkN = ENEMYCFG.RK_N;
      u.gunT = -u.i * 0.4; u.rkT = -u.i;   // 僚机错开节奏（编队火力分配）
      u.aimT = 0;
      this._facePatrol(u);
    }
  }
  reset() {
    this.active = false;
    this.hitPending = null;
    this._kq.length = 0;          // 清空击落事件队列
    this.fireEvent = null;
    for (const u of this.units) { u.on = false; u.phase = 'patrol'; u.pt = 0; u.aimT = 0; }
  }
  _facePatrol(u) {
    // 巡逻机头 = 环切线方向（角速度正向）
    u.hx = -Math.sin(u.ang); u.hy = 0; u.hz = Math.cos(u.ang);
  }
  _faceTo(u, tx, ty, tz) {
    const dx = tx - u.x, dy = ty - u.y, dz = tz - u.z;
    const l = Math.max(1e-4, Math.hypot(dx, dy, dz));
    u.hx = dx / l; u.hy = dy / l; u.hz = dz / l;
  }

  // ---------- 主更新（每帧；env 全部只读） ----------
  // env = { dt, heli:{x,y,z}, stability, aim:{x,y,z}|null,  // 玩家机头单位向量
  //         aaRate, aaDmg, res }                            // 难度系数（缺省 1）
  update(env) {
    const dt = env.dt || 0;
    this._env = env;
    this._res = env.res || 1;
    if (!this.active) return;
    for (const u of this.units) {
      if (!u.on || u.phase === 'down') continue;
      this._updateUnit(u, env, dt);
    }
  }

  _updateUnit(u, env, dt) {
    const C = ENEMYCFG;
    const hx = env.heli.x, hy = env.heli.y, hz = env.heli.z;
    const dist = Math.hypot(hx - u.x, hy - u.y, hz - u.z);
    u.pt += dt;

    // 被玩家持续瞄准检测（aim=玩家机头单位向量；缺席视为未瞄准）
    let aimed = false;
    if (env.aim) {
      const dx = u.x - hx, dy = u.y - hy, dz = u.z - hz;
      const l = Math.max(1e-4, Math.hypot(dx, dy, dz));
      const dot = (dx * env.aim.x + dy * env.aim.y + dz * env.aim.z) / l;
      if (dot > Math.cos(C.LOCKED_ARC)) aimed = true;
    }
    u.aimT = aimed ? u.aimT + dt : Math.max(0, u.aimT - dt * 2);

    if (u.phase === 'patrol') {
      u.ang += C.PATROL_W * dt;
      const r = C.PATROL_R + u.i * 4;
      u.x = this.anchor.x + Math.cos(u.ang) * r;
      u.z = this.anchor.z + Math.sin(u.ang) * r;
      u.y = C.PATROL_H + u.i * C.WING_DH;
      this._facePatrol(u);
      // 索敌：视距 + 视锥（巡逻机头向为轴）——敌方视角的目标搜索
      if (dist < C.VISION) {
        const dx = hx - u.x, dy = hy - u.y, dz = hz - u.z;
        const l = Math.max(1e-4, Math.hypot(dx, dy, dz));
        const dot = (dx * u.hx + dy * u.hy + dz * u.hz) / l;
        if (dot > Math.cos(C.FOV)) { u.phase = 'search'; u.pt = 0; }
      }
      return;
    }
    if (u.phase === 'search') {
      this._faceTo(u, hx, hy, hz);
      this._advance(u, dt);
      if (dist > C.VISION_LOSE) {
        // 回巡逻前用当前实际位置反算相位——search 期 _advance 已偏离巡逻圆，
        // 若沿用冻结的旧 ang，下一帧 patrol 重算会把单元瞬移弹回旧相位点。
        u.ang = Math.atan2(u.z - this.anchor.z, u.x - this.anchor.x);
        u.phase = 'patrol'; u.pt = 0; return;
      }
      if (u.pt >= C.SEARCH_T) { u.phase = 'attack'; u.pt = 0; }
      return;
    }
    if (u.phase === 'attack') {
      // 站位保持：远逼近/近拉远（僚机侧翼分散=编队协同）
      const dx = hx - u.x, dy = hy - u.y, dz = hz - u.z;
      const l = Math.max(1e-4, Math.hypot(dx, dy, dz));
      const sgn = dist > C.ATK_FAR ? 1 : dist < C.ATK_NEAR ? -1 : 0;
      const flank = (u.i === 0 ? 1 : -1) * C.ATK_FLANK;
      const tx = hx + dx / l * sgn * 8 - dz / l * flank;
      const tz = hz + dz / l * sgn * 8 + dx / l * flank;
      const ty = hy + 2 + u.i * 1.5;
      this._faceTo(u, hx, hy, hz);
      if (sgn !== 0) this._advanceToward(u, tx, ty, tz, dt);
      this._fire(u, env, dist, 1);
      // 转移：受损超阈/被持续锁定 → 规避；弹药耗尽或重损 → 撤出
      if (u.dmg >= C.WITHDRAW_DMG || (u.gunN <= 0 && u.rkN <= 0)) { u.phase = 'withdraw'; u.pt = 0; return; }
      if (u.dmg >= C.EVADE_DMG || u.aimT >= C.LOCKED_T) { u.phase = 'evade'; u.pt = 0; }
      return;
    }
    if (u.phase === 'evade') {
      // 对角蛇形：垂直正弦 + 水平垂直于敌我连线（两机符号相反=分散）
      const dx = hx - u.x, dz = hz - u.z;
      const l = Math.max(1e-4, Math.hypot(dx, dz));
      const px = -dz / l, pz = dx / l;
      const sgn = u.i === 0 ? 1 : -1;
      const w = Math.sin(u.pt * C.EVADE_SIN);
      u.x += px * sgn * C.SPEED * dt * 0.8;
      u.z += pz * sgn * C.SPEED * dt * 0.8;
      u.y += w * C.EVADE_VY * dt;
      u.y = Math.max(4, Math.min(40, u.y));
      u.x = Math.max(-C.CLAMP_R, Math.min(C.CLAMP_R, u.x));
      u.z = Math.max(-C.CLAMP_R, Math.min(C.CLAMP_R, u.z));
      this._faceTo(u, hx, hy, hz);
      this._fire(u, env, dist, 0.5);          // 规避中仍以半概率还击（威胁性）
      if (u.pt >= C.EVADE_T) {
        u.phase = (u.dmg >= C.WITHDRAW_DMG || (u.gunN <= 0 && u.rkN <= 0)) ? 'withdraw' : 'attack';
        u.pt = 0;
      }
      return;
    }
    if (u.phase === 'withdraw') {
      // 撤离：背对锚点外爬升，出界退场（不再回来——本局威胁解除）
      const ax = u.x - this.anchor.x, az = u.z - this.anchor.z;
      const l = Math.max(1e-4, Math.hypot(ax, az));
      u.x += ax / l * C.SPEED * dt;
      u.z += az / l * C.SPEED * dt;
      u.y = Math.min(45, u.y + 6 * dt);
      u.hx = ax / l; u.hy = 0.15; u.hz = az / l;
      const hl = Math.max(1e-4, Math.hypot(u.hx, u.hy, u.hz));
      u.hx /= hl; u.hy /= hl; u.hz /= hl;
      const dA = Math.hypot(u.x - this.anchor.x, u.z - this.anchor.z);
      if (dA > C.EXIT_R) u.on = false;
      return;
    }
  }

  _advance(u, dt) { this._advanceToward(u, u.x + u.hx * 8, u.y + u.hy * 8, u.z + u.hz * 8, dt); }
  _advanceToward(u, tx, ty, tz, dt) {
    const dx = tx - u.x, dy = ty - u.y, dz = tz - u.z;
    const l = Math.max(1e-4, Math.hypot(dx, dy, dz));
    const s = Math.min(l, ENEMYCFG.SPEED * dt);
    u.x += dx / l * s; u.y += dy / l * s; u.z += dz / l * s;
    u.x = Math.max(-ENEMYCFG.CLAMP_R, Math.min(ENEMYCFG.CLAMP_R, u.x));
    u.z = Math.max(-ENEMYCFG.CLAMP_R, Math.min(ENEMYCFG.CLAMP_R, u.z));
  }

  // 开火（rateMul：attack=1 / evade=0.5）：命中概率 = 基础 × 距离衰减 × 玩家稳定度因子
  _fire(u, env, dist, rateMul) {
    const C = ENEMYCFG;
    const aaRate = env.aaRate || 1;
    const pDist = 0.5 + 0.5 * Math.min(1, dist / C.P_DIST0);
    const pStab = C.P_STAB0 + (1 - C.P_STAB0) * Math.max(0, Math.min(1, env.stability == null ? 1 : env.stability));
    const aaDmg = env.aaDmg || 1;
    u.gunT += (env.dt || 0) * rateMul * aaRate;
    u.rkT += (env.dt || 0) * rateMul * aaRate;
    if (u.gunN > 0 && u.gunT >= C.GUN_RATE) {
      u.gunT = 0; u.gunN--;
      const hit = this._rng() < C.GUN_HIT_P * pDist * pStab;
      // 开火事件（渲染层曳光/枪口焰视觉；单槽——两机同帧开火概率极低，
      // 视觉层丢一帧曳光无感，84 hitPending 同款约定）
      this.fireEvent = { i: u.i, x: u.x, y: u.y, z: u.z, hit, big: false };
      if (hit) this._hitPlayer(env, C.GUN_DMG * aaDmg);
    }
    if (u.rkN > 0 && u.rkT >= C.RK_RATE) {
      u.rkT = 0; u.rkN--;
      const hit = this._rng() < C.RK_HIT_P * pDist * pStab;
      this.fireEvent = { i: u.i, x: u.x, y: u.y, z: u.z, hit, big: true };
      if (hit) this._hitPlayer(env, C.RK_DMG * aaDmg);
    }
  }
  _hitPlayer(env, dmg) {
    // 单槽事件（84 hitPending 同款约定）：同帧双机命中的后发覆盖先发——
    // 命中频率 ≤2/s 量级，覆盖窗口可忽略（REPORT 已声明）
    this.hitPending = {
      x: env.heli.x + (this._rng() - 0.5) * 2,
      y: env.heli.y + (this._rng() - 0.5),
      z: env.heli.z + (this._rng() - 0.5) * 2,
      dmg: Math.round(dmg),
    };
  }

  // ---------- 玩家武器命中入口（渲染层桥接 65-weapons 对空链） ----------
  // pos：普通对象 {x,y,z}（Vector3 也可——只读三个分量）；dmg：武器威力；
  // margin：判定余量（与 airtargets.hitTest 同语义）。命中扣 hp/累加 dmg，
  // 击落产 killEvent（type='enemy'——83-arcade 计分与 ace 成就判定源）。
  hitTest(pos, dmg, margin = 0) {
    if (!this.active) return null;
    for (const u of this.units) {
      if (!u.on || u.phase === 'down') continue;
      const d = Math.hypot(pos.x - u.x, pos.y - u.y, pos.z - u.z);
      if (d > ENEMYCFG.HIT_R + margin) continue;
      const eff = (dmg || 0) / (this._res || 1);   // 难度抗打击（res 大更耐打）
      u.hp -= eff; u.dmg += eff;
      if (u.hp <= 0) {
        u.phase = 'down'; u.on = false;
        this.killEvent = { i: u.i, type: 'enemy', label: '敌方武装直升机', x: u.x, y: u.y, z: u.z };
      }
      return u;
    }
    return null;
  }

  // 只读遥测（__dbg.enemyAir.state()；测试断言一律读此状态源，不解析截图）
  state() {
    let live = 0, attacking = 0;
    const arr = [];
    for (const u of this.units) {
      if (!u.on && u.phase !== 'down') continue;
      arr.push({
        i: u.i, on: u.on, phase: u.phase, hp: +u.hp.toFixed(2),
        x: +u.x.toFixed(1), y: +u.y.toFixed(1), z: +u.z.toFixed(1),
        gunN: u.gunN, rkN: u.rkN, dmg: +u.dmg.toFixed(2),
      });
      if (u.on) { live++; if (u.phase === 'attack' || u.phase === 'evade') attacking++; }
    }
    return { active: this.active, live, attacking, units: arr,
      hitPending: !!this.hitPending, killEvent: !!this.killEvent };
  }
}

// 经 HOST 注册工厂——70-app（低编号）不得反向引用 87 的构造器（拓扑硬规则），
// 经宿主槽位取用（与 79/80/81/83/84/86 同款模式）。
HOST.makeEnemyAir = (opts) => new EnemyAirModule(opts);
