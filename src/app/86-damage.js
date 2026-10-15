// ============================================================
// 86-damage.js — Phase 19：机务损伤与特情处置（纯逻辑）
// ============================================================
// 把"被打中之后会发生什么"从单一数值升级为四子系统分级状态机
//（ROTOR/ENGINE/WEAPONS/AVIONICS 各自 0-100 + 五级状态），损伤可感知、
// 可处置、有代价。零 THREE、零 DOM（照 84-samwar 先例）——时间由 70-app
// loop 每帧喂，浏览器层只做薄接线，全部逻辑可用 tools/tests_pure 离线
// TDD（damage_drive.js + test_damage.py）。
//
//   命中分配：applyHit({dmg, dir})——dir 为机体系单位向量（70-app 把世界
//   命中点换算到机体系），按方位扇区确定性分配到子系统；扰动走注入 rng
//   （±10%，同 seed 同结果——测试用 rng=()=>0.5 时扰动恒 1.0，期望值可
//   按原始权重精确计算）。
//   级联：引擎过热（overheat>=1 超温）持续恶化 engine 并以
//   engineLvl*overheat*0.8/s 加速 rotor 疲劳——"降载飞"的物理出处。
//   处置：engine 降功率（持续开关，overheat -0.05/s，代价 powerCap×0.85）/
//   weapons 上膛（3s，成功率 0.75-weaponsLvl*0.1，冷却 8s，成功修 10）/
//   avionics 重启（2s 全黑，成功率 0.85，冷却 6s，成功修 20）/
//   rotor 降载（持续开关：磨损减半 + 机动性再 -20%——无法修复的代价换寿命）。
//   卡壳自然触发：武器 Lv>=2 且持续开火（ctx.firing）时每帧掷
//   rng < JAM_RISK_LV[lvl]×dt——风险随开火时长累积（不按发数：M230 秒射
//   十几发会瞬间必卡）；Lv<2 恒 0 短路不掷；上膛成功后 JAM_IMMUNE 秒免卡壳。
//   HUD 失效：avionicsLvl>=2 时间歇窗口（周期 12-lvl*2 秒、头 1.2s 失效）
//   ——正弦节律换成取模节律，确定性可测；重启期 hudDead 全黑。
//   阈值告警：跨级时 push events（70-app 消费 → Betty 语音 + HUD）。
//   战损得分：bonusMul = 1 + 总伤/400*0.5（带伤完成任务的风险回报），
//   由 70-app 结算时乘进 83-arcade 的结算奖励（onMissionDone 的
//   opts.damageMul，83 侧默认 1 零行为变化）。
//
// 拓扑：本文件（86）不得被低编号模块引用；70-app 经宿主工厂槽
// HOST.makeDamage() 取用。_swMulberry32 复用 84 的实现（86>84 正向）。
// 兼容边界：既有 targets._heliDmg 语义（结构总伤、≥12 强制返航）原样
// 保留——本模块是叠加语义层，不替换不接管（71 项既有测试零影响）。
// ============================================================

// 扇区 → 子系统分配权重（和为 1）。y 主导顶/腹（旋翼传动 vs 挂架短翼），
// 其余按前后分：机头方向是航电（TADS/PNVS/雷达），中后部两侧是发动机舱。
const DMG_SECTORS = {
  top:   { rotor: 0.70, engine: 0.10, weapons: 0.10, avionics: 0.10 },
  belly: { rotor: 0.15, engine: 0.10, weapons: 0.65, avionics: 0.10 },
  front: { rotor: 0.15, engine: 0.20, weapons: 0.10, avionics: 0.55 },
  rear:  { rotor: 0.20, engine: 0.55, weapons: 0.10, avionics: 0.15 },
};
const DMG_SYS_KEYS = ['rotor', 'engine', 'weapons', 'avionics'];

// 处置参数（唯一数值源；测试期望值与此表同源）
const DMGCFG = {
  JAM_TIME: 3.0, JAM_COOL: 8.0, JAM_FIX: 10,        // 武器上膛：时长/冷却/成功修复量
  JAM_P0: 0.75, JAM_P_LVLPEN: 0.10,                  // 成功率 = 0.75 - weaponsLvl*0.10
  JAM_RISK_LV: [0, 0, 0.04, 0.09, 0.16],             // 持续开火卡壳风险/s（按武器等级索引 0-4；Lv<2 恒 0）
  JAM_IMMUNE: 10.0,                                   // 上膛成功后的免卡壳窗口 s（防"卡→修→立刻又卡"）
  REBOOT_TIME: 2.0, REBOOT_COOL: 6.0, REBOOT_FIX: 20, REBOOT_P: 0.85,
  MITIGATE_COOL: 0.05,                                // 降功率降温速率 /s
  OVERHEAT_RATE: 0.006,                               // 引擎每级过热累积率 /s
  CASCADE_RATE: 0.80,                                 // 超温 → rotor 疲劳 = engineLvl*overheat*0.8/s
  ENGINE_WORSEN: 2.0,                                 // 超温自身恶化 /s
  WEAR_RATE: 0.10,                                    // rotor 飞行磨损 = rotorLvl*0.10/s
  WEAR_LOADRED: 0.5,                                  // 降载磨损乘数
  LOADRED_RESP: 0.80,                                 // 降载机动性代价
  MITIGATE_CAP: 0.85,                                 // 降功率功率上限代价
  HUD_FAIL_DUR: 1.2,                                  // 航电失效窗口时长 s
  HUD_FAIL_BASE: 12.0,                                // 失效周期 = 12 - lvl*2
  LV_THRESH: [25, 50, 75, 100],                        // 级边界
};

class DamageSystem {
  constructor(opts = {}) {
    this.sys = { rotor: 0, engine: 0, weapons: 0, avionics: 0 };
    this.rng = opts.rng || _swMulberry32(opts.seed || 20260919);
    this.events = [];            // {type, sys, level?}（70-app 消费后清空）
    this.t = 0;
    this.overheat = 0;           // 引擎过热 0..1
    this.jammed = false;          // 武器卡壳（处置中锁/失败保持）
    this.wcState = null;          // 上膛中 {t}
    this.wcCool = 0;              // 上膛冷却
    this.jamImmune = 0;           // 免卡壳窗口（上膛成功后置 JAM_IMMUNE，逐帧递减）
    this.abState = null;          // 重启中 {t}
    this.abCool = 0;              // 重启冷却
    this.mitigate = false;        // 引擎降功率（持续开关）
    this.loadReduce = false;      // 旋翼降载（持续开关）
    this._hudFail = false;        // 派生：间歇失效窗口
    this._hudDead = false;       // 派生：重启全黑
    this._jamPrev = false;       // 播报锁：卡壳 false→true 翻转检测（一次性事件）
    this._ohLatch = false;        // 播报锁：超温 overheat>=1 穿越检测（一次性事件）
    this.recompute();
  }

  // 级函数：0..4（<25 / <50 / <75 / <100 / >=100）
  level(v) {
    return v >= DMGCFG.LV_THRESH[3] ? 4 : v >= DMGCFG.LV_THRESH[2] ? 3
         : v >= DMGCFG.LV_THRESH[1] ? 2 : v >= DMGCFG.LV_THRESH[0] ? 1 : 0;
  }
  _lvl(k) { return this.level(this.sys[k]); }

  // ---------- 命中分配（确定性：扇区 × 权重 × seed 扰动） ----------
  applyHit(hit) {
    if (!hit || !(hit.dmg > 0)) return;
    const d = hit.dir || { x: 0, y: 0, z: 0 };
    let w;
    if (d.y > 0.45) w = DMG_SECTORS.top;
    else if (d.y < -0.45) w = DMG_SECTORS.belly;
    else if (d.z > 0) w = DMG_SECTORS.front;
    else w = DMG_SECTORS.rear;
    // 扰动 ±10% 后归一（rng=()=>0.5 → 恒 1.0，期望值=原始权重）
    const m = {};
    let sum = 0;
    for (const k of DMG_SYS_KEYS) { m[k] = w[k] * (0.9 + this.rng() * 0.2); sum += m[k]; }
    for (const k of DMG_SYS_KEYS) {
      const before = this.level(this.sys[k]);
      this.sys[k] = Math.min(100, this.sys[k] + hit.dmg * m[k] / sum);
      const after = this.level(this.sys[k]);
      if (after > before) this.events.push({ type: 'dmg', sys: k, level: after });
    }
    this.recompute();
  }

  // ---------- 每帧演化（ctx = {dt, airborne, alt}，全部只读） ----------
  update(ctx) {
    const dt = (ctx && ctx.dt) || 0;
    this.t += dt;
    const engL = this._lvl('engine');

    // 引擎过热：有损伤即累积（随级加速）；降功率处置时净降温
    if (this.mitigate) {
      this.overheat = Math.max(0, this.overheat - DMGCFG.MITIGATE_COOL * dt);
    } else if (engL > 0) {
      this.overheat = Math.min(1, this.overheat + engL * DMGCFG.OVERHEAT_RATE * dt);
    }

    // 级联 1：超温 → 引擎自身恶化 + 旋翼疲劳加速
    if (this.overheat >= 1) {
      this._worsen('engine', DMGCFG.ENGINE_WORSEN * dt);
      this._worsen('rotor', engL * this.overheat * DMGCFG.CASCADE_RATE * dt);
    }
    // 级联 2：旋翼带伤飞行磨损（airborne 才磨损；降载减半）
    if (ctx && ctx.airborne && this.sys.rotor > 0) {
      this._worsen('rotor', this._lvl('rotor') * DMGCFG.WEAR_RATE * dt
        * (this.loadReduce ? DMGCFG.WEAR_LOADRED : 1));
    }

    // 卡壳自然触发：武器 Lv>=2 且本帧确在开火（ctx.firing）时掷
    // rng < JAM_RISK_LV[lvl]×dt——风险按持续开火时长累积（不按发数：M230
    // 秒射十几发会瞬间必卡）；Lv<2 恒 0 短路不掷（rng 流零消耗，确定性
    // 可测）；卡壳中/处置中/免卡壳窗口内均不掷。置 jammed 后由下方翻转
    // 检测同帧发 jamStart（复用既有播报链，不加第二套）。
    if (ctx && ctx.firing && !this.jammed && !this.wcState && this.jamImmune <= 0) {
      const risk = DMGCFG.JAM_RISK_LV[this._lvl('weapons')] || 0;
      if (risk > 0 && this.rng() < risk * dt) this.jammed = true;
    }

    // 特情播报（一次性事件，70-app 消费 → toast/Betty——可发现性挂点）：
    // 卡壳翻转检测排除处置期自身（weaponsCycle 同步置 jammed+wcState，锁不算
    // 新卡壳）；超温在 overheat 穿越沸腾点 1.0 时报一次，U 处置降温回落后
    // 复燃会再报（新一轮超温属实）
    if (this.jammed && !this._jamPrev && !this.wcState) this.events.push({ type: 'jamStart' });
    this._jamPrev = this.jammed;
    const ohNow = this.overheat >= 1;
    if (ohNow && !this._ohLatch) this.events.push({ type: 'overheat' });
    this._ohLatch = ohNow;

    // 处置状态机推进（冷却递减带 1e-9 归零钳制：0.1 的二进制累加误差会让
    // "恰好归零"残留 1e-15 级正数，把冷却后的再触发误拒——TDD 首轮实锤）
    if (this.wcCool > 0) { this.wcCool -= dt; if (this.wcCool < 1e-9) this.wcCool = 0; }
    if (this.abCool > 0) { this.abCool -= dt; if (this.abCool < 1e-9) this.abCool = 0; }
    if (this.jamImmune > 0) { this.jamImmune -= dt; if (this.jamImmune < 1e-9) this.jamImmune = 0; }
    if (this.wcState) {
      this.wcState.t += dt;
      if (this.wcState.t >= DMGCFG.JAM_TIME) {
        const p = DMGCFG.JAM_P0 - this._lvl('weapons') * DMGCFG.JAM_P_LVLPEN;
        this.wcState = null;
        this.wcCool = DMGCFG.JAM_COOL;
        if (this.rng() < p) {
          this.jammed = false;
          this.sys.weapons = Math.max(0, this.sys.weapons - DMGCFG.JAM_FIX);
          this.jamImmune = DMGCFG.JAM_IMMUNE;   // 上膛成功 → 免卡壳窗口（防卡→修→立刻又卡）
          this.events.push({ type: 'jam', ok: true });
        } else {
          this.events.push({ type: 'jam', ok: false });
        }
      }
    }
    if (this.abState) {
      this.abState.t += dt;
      if (this.abState.t >= DMGCFG.REBOOT_TIME) {
        this.abState = null;
        this.abCool = DMGCFG.REBOOT_COOL;
        if (this.rng() < DMGCFG.REBOOT_P) {
          this.sys.avionics = Math.max(0, this.sys.avionics - DMGCFG.REBOOT_FIX);
          this.events.push({ type: 'reboot', ok: true });
        } else {
          this.events.push({ type: 'reboot', ok: false });
        }
      }
    }

    this.recompute();
  }

  // 跨级恶化统一入口（供级联使用，保持告警事件语义）
  _worsen(k, d) {
    if (d <= 0) return;
    const before = this.level(this.sys[k]);
    this.sys[k] = Math.min(100, this.sys[k] + d);
    const after = this.level(this.sys[k]);
    if (after > before) this.events.push({ type: 'dmg', sys: k, level: after });
  }

  // ---------- 处置入口（返回 false = 守卫拒绝：冷却中/进行中） ----------
  // 武器上膛：3s 处置期全程卡壳，成功解卡并修复 10
  weaponsCycle() {
    if (this.wcState || this.wcCool > 0) return false;
    this.wcState = { t: 0 };
    this.jammed = true;                       // 上膛中武器不可用
    return true;
  }
  // 航电重启：2s 全黑，成功修复 20
  avionicsReboot() {
    if (this.abState || this.abCool > 0) return false;
    this.abState = { t: 0 };
    return true;
  }

  // ---------- 派生量重算（写 _fxCache 的字段，返回同一对象引用——零分配） ----------
  recompute() {
    const rL = this._lvl('rotor'), eL = this._lvl('engine'),
          wL = this._lvl('weapons'), aL = this._lvl('avionics');
    // HUD 失效：重启期全黑优先；否则 lvl>=2 的取模窗口（周期 12-lvl*2，头 1.2s）
    const P = DMGCFG.HUD_FAIL_BASE - aL * 2;
    this._hudFail = aL >= 2 && (this.t % P) < DMGCFG.HUD_FAIL_DUR;
    this._hudDead = !!this.abState;
    this._fxCache = {
      vibMul: 1 + rL * 0.45,                                  // 振动
      liftMul: 1 - rL * 0.10,                                  // 升力效率
      respMul: (1 - rL * 0.08) * (this.loadReduce ? DMGCFG.LOADRED_RESP : 1),
      trimDrift: rL >= 2 ? rL * 0.012 : 0,                    // 偏航配平漂移 rad/s
      powerCap: (1 - eL * 0.16) * (this.mitigate ? DMGCFG.MITIGATE_CAP : 1),
      overheat: this.overheat,
      spreadAdd: wL * 0.06,                                    // 武器散布追加
      jammed: this.jammed,                                     // 卡壳（含处置期）
      hfOnline: wL < 4,                                        // 地狱火火控挂架在线
      hudFail: this._hudFail,                                  // 姿态/威胁/RWR 读数间歇失效
      hudDead: this._hudDead,                                  // 重启期全黑
      rwrNoise: aL * 0.20,                                     // RWR 精度下降（84 消费）
    };
    return this._fxCache;
  }
  fx() { return this._fxCache; }

  // 战损得分系数：1.0（零伤）..1.5（全损）——风险回报
  bonusMul() {
    let s = 0;
    for (const k of DMG_SYS_KEYS) s += this.sys[k];
    return Math.min(1.5, 1 + s / 400 * 0.5);
  }

  reset() {
    for (const k of DMG_SYS_KEYS) this.sys[k] = 0;
    this.overheat = 0;
    this.jammed = false;
    this.wcState = null; this.wcCool = 0; this.jamImmune = 0;
    this.abState = null; this.abCool = 0;
    this.mitigate = false; this.loadReduce = false;
    this._jamPrev = false; this._ohLatch = false;
    this.events.length = 0;
    this.t = 0;
    this.recompute();
  }

  // 只读遥测（__dbg.damage.state()；测试断言读此状态源）
  state() {
    return {
      sys: { rotor: +this.sys.rotor.toFixed(2), engine: +this.sys.engine.toFixed(2),
             weapons: +this.sys.weapons.toFixed(2), avionics: +this.sys.avionics.toFixed(2) },
      levels: { rotor: this._lvl('rotor'), engine: this._lvl('engine'),
                weapons: this._lvl('weapons'), avionics: this._lvl('avionics') },
      overheat: +this.overheat.toFixed(3),
      jammed: this.jammed, jamBusy: !!this.wcState, jamCool: +this.wcCool.toFixed(1),
      jamImmune: +this.jamImmune.toFixed(1),
      rebootBusy: !!this.abState, rebootCool: +this.abCool.toFixed(1),
      mitigate: this.mitigate, loadReduce: this.loadReduce,
      hudFail: this._hudFail, hudDead: this._hudDead,
      bonusMul: +this.bonusMul().toFixed(4),
      events: this.events.map(e => ({ type: e.type, sys: e.sys || null, level: e.level || null, ok: e.ok })),
    };
  }
}

// 经 HOST 注册工厂——70-app（低编号）不得反向引用 86 的构造器（拓扑硬规则）
HOST.makeDamage = (opts) => new DamageSystem(opts);
