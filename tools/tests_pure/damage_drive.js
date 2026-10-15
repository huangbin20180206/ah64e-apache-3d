// ============================================================
// damage_drive.js — 86-damage.js 纯逻辑测试驱动器（node 桩，无浏览器）
// 用法：node damage_drive.js <case>   输出 JSON 供 pytest 精确断言。
// 设计口径（与 86-damage.js 的参数表同源，测试期望值全部按公式写死）：
//   级边界：level(v) = v>=100?4 : v>=75?3 : v>=50?2 : v>=25?1 : 0
//   扇区权重（rng=()=>0.5 时扰动恒 1.0，期望值=原始权重×伤害量）：
//     top   (y> 0.45): rotor .70 engine .10 weapons .10 avionics .10
//     belly (y<-0.45): rotor .15 engine .10 weapons .65 avionics .10
//     front (z>0):    rotor .15 engine .20 weapons .10 avionics .55
//     rear  (z<=0):   rotor .20 engine .55 weapons .10 avionics .15
//   级联：overheat>=1 时 rotor 疲劳 = engineLvl*overheat*0.8/s
//   处置：降功率 overheat -0.05/s + powerCap×0.85；
//         上膛 3s、成功率 0.75-weaponsLvl*0.1、冷却 8s、成功修 10；
//         重启 2s、成功率 0.85、冷却 6s、成功修 20；
//   HUD 失效（avionicsLvl>=2）：周期 P=12-lvl*2 秒，头 1.2s 失效
//   磨损：airborne 且 rotor>0 时 rotor += rotorLvl*0.10/s（降载 ×0.5）
//   得分：bonusMul = 1 + sum(sys)/400*0.5（clamp 1..1.5）
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_84 = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'app', '84-samwar.js'), 'utf8');
const SRC_86 = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'app', '86-damage.js'), 'utf8');
const HOST = {};
// 86 复用 84 的 _swMulberry32（拼接产物中两文件同 IIFE 作用域）——
// 桩里先加载 84 再加载 86，与 dist 语义一致
new Function('HOST', SRC_84 + '\n' + SRC_86 + '\n;void HOST;')(HOST);
const mk = HOST.makeDamage;

// 数值归整到 1e-6（浮点尾差消除；期望值在断言精度内仍精确写死）
const R = (o) => JSON.parse(JSON.stringify(o, (k, v) =>
  typeof v === 'number' ? +v.toFixed(6) : v));

const ENV = { dt: 0.1, airborne: true, alt: 14 };

function steps(mod, n, ctx) {
  for (let i = 0; i < n; i++) mod.update(ctx || ENV);
}

const CASES = {
  // ① 方位×伤害量 → 子系统分配（rng=0.5 扰动无效，期望值精确）
  alloc() {
    const m = mk({ rng: () => 0.5 });
    m.applyHit({ dmg: 10, dir: { x: 0, y: 1, z: 0 } });      // top
    const top = Object.assign({}, m.sys);
    m.applyHit({ dmg: 10, dir: { x: 0, y: -1, z: 0 } });     // belly
    const belly = Object.assign({}, m.sys);
    m.reset();
    m.applyHit({ dmg: 20, dir: { x: 0, y: 0, z: 1 } });      // front
    const front = Object.assign({}, m.sys);
    m.reset();
    m.applyHit({ dmg: 20, dir: { x: 1, y: 0, z: -0.2 } });   // rear
    const rear = Object.assign({}, m.sys);
    return { top: R(top), belly: R(belly), front: R(front), rear: R(rear) };
  },

  // ② 同 seed 同序列同结果；异 seed 分配不同（确定性/可复现）
  alloc_seed() {
    const seq = (seed) => {
      const m = mk({ seed });
      for (let i = 0; i < 3; i++) m.applyHit({ dmg: 7, dir: { x: 0.3, y: 0.2, z: 0.9 } });
      return m.sys;
    };
    const a1 = JSON.stringify(seq(1)), a2 = JSON.stringify(seq(1)), b = JSON.stringify(seq(2));
    return { same: a1 === a2, diff: a1 !== b, a1: JSON.parse(a1) };
  },

  // ③ 级函数边界：每级上下各一条
  levels() {
    const m = mk({});
    const probe = [0, 24.99, 25, 49.99, 50, 74.99, 75, 99.99, 100];
    return { lv: probe.map(v => m.level(v)) };
  },

  // ④ 级联：引擎超温 → 旋翼疲劳；降功率处置降温（engine=60 恒 lvl2：
  //    恶化 2/s × 5s = 70 仍 lvl2，疲劳率全程 2*0.8=1.6/s）
  cascade() {
    const m = mk({ rng: () => 0.5 });
    m.sys.engine = 60; m.overheat = 1.0;
    const rotor0 = m.sys.rotor;
    steps(m, 50);                       // 5s：疲劳 1.6*5 = 8.0
    const rotorGain = +(m.sys.rotor - rotor0).toFixed(2);
    const overheat5 = +m.overheat.toFixed(3);
    m.mitigate = true;
    steps(m, 50);                       // 再 5s：overheat -0.05/s → 0.75
    return { rotorGain, overheat5, overheat10: +m.overheat.toFixed(3), engineWorse: m.sys.engine > 60 };
  },

  // ⑤ 引擎降功率处置：overheat 回落 + powerCap×0.85 代价
  mitigate() {
    const m = mk({ rng: () => 0.5 });
    m.overheat = 0.6; m.sys.engine = 30;
    m.mitigate = true;
    steps(m, 100);                      // 10s → overheat -0.5
    return { overheat: +m.overheat.toFixed(3),
             powerCap: +m.fx().powerCap.toFixed(3),   // (1-0.16*1)*0.85
             offCap: +(() => { m.mitigate = false; m.recompute(); return m.fx().powerCap; })().toFixed(3) };
  },

  // ⑥ 武器上膛：成功/失败/冷却三路径
  weapons_ok() {
    const m = mk({ rng: () => 0.1 });    // 0.1 < 0.65 必成功
    m.jammed = true; m.sys.weapons = 20; // lvl1 → 成功率 0.65
    const c1 = m.weaponsCycle();
    const during = [];
    for (let i = 0; i < 25; i++) { m.update(ENV); during.push(m.jammed); if (i === 24) break; }
    const at3s = m.jammed;               // 2.5s：处置中仍卡
    steps(m, 5);                          // 0.5s → 3.0s 完成
    const after = m.jammed, weapons = m.sys.weapons, cool = m.wcCool;
    const againDuringCool = m.weaponsCycle();
    steps(m, 80);                         // 8s 冷却走完
    const againAfterCool = m.weaponsCycle();
    return { c1, at3s, after, weapons, cool, againDuringCool, againAfterCool,
             duringAllJammed: during.every(v => v) };
  },
  weapons_fail() {
    const m = mk({ rng: () => 0.99 });   // 必失败
    m.jammed = true; m.sys.weapons = 40;
    m.weaponsCycle();
    steps(m, 30);                        // 3s
    return { jammed: m.jammed, cool: m.wcCool, events: m.events.filter(e => e.type === 'jam').length };
  },

  // ⑦ 航电重启：成功修 20 / 失败不减 / 重启期全黑 / 冷却
  avionics_ok() {
    const m = mk({ rng: () => 0.1 });
    m.sys.avionics = 60;
    const r1 = m.avionicsReboot();
    let darkDuring = true;
    for (let i = 0; i < 15; i++) { m.update(ENV); if (!m.fx().hudDead) darkDuring = false; }
    steps(m, 5);                          // 2.0s 完成
    const av = m.sys.avionics, againDuringCool = m.avionicsReboot();
    steps(m, 60);
    return { r1, darkDuring, av, againDuringCool, afterCool: m.avionicsReboot() };
  },
  avionics_fail() {
    const m = mk({ rng: () => 0.99 });
    m.sys.avionics = 60;
    m.avionicsReboot();
    steps(m, 20);
    return { av: m.sys.avionics };
  },

  // ⑧ 航电失效 HUD 窗口：avionics=60（lvl2，P=8s，头 1.2s 失效）。
  //    0.1 步进的浮点累加让窗口边界确定性地偏一步（t 在 i=79 实为
  //    7.9999999999999xx → %8=7.9999 不入窗；i=91 t%8=1.1999<1.2 仍在窗）
  //    ——期望值按浮点真值写死（诊断 v3 实测），窗口 2 = i∈[80,91]
  hudfail() {
    const m = mk({ rng: () => 0.5 });
    m.sys.avionics = 60;
    m.recompute();
    const seq = [];
    for (let i = 0; i < 95; i++) { m.update(ENV); seq.push(m.fx().hudFail ? 1 : 0); }
    const w1 = seq.slice(0, 11).every(v => v === 1);      // t=0.1..1.1 失效（12 步
                                                          // 浮点和=1.2000000000000002 ≥1.2 出窗）
    const gap = seq.slice(11, 80).every(v => v === 0);     // t=1.2..7.9999 正常
    const w2start = seq[80] === 1 && seq[92] === 0;       // t=8.0999 失效起、t=9.2999 恢复
    const w2 = seq.slice(80, 92).every(v => v === 1);     // t=8.0999..9.1999 失效
    return { w1, gap, w2start, w2 };
  },

  // ⑨ 战损得分系数边界
  bonus() {
    const m = mk({});
    const zero = m.bonusMul();
    m.sys.rotor = m.sys.engine = m.sys.weapons = m.sys.avionics = 100;
    const full = m.bonusMul();
    m.reset(); m.sys.engine = 50;
    const halfEngine = m.bonusMul();
    return { zero, full, halfEngine };
  },

  // ⑩ 旋翼磨损与降载：airborne 磨损 0.10*lvl/s；降载减半
  rotor_wear() {
    const m = mk({ rng: () => 0.5 });
    m.sys.rotor = 30;                    // lvl1
    steps(m, 50);                        // 5s → +0.5
    const gain1 = +(m.sys.rotor - 30).toFixed(3);
    m.reset(); m.sys.rotor = 30; m.loadReduce = true;
    steps(m, 50);
    const gain2 = +(m.sys.rotor - 30).toFixed(3);
    m.reset(); m.sys.rotor = 30;         // 地面不磨损
    steps(m, 50, { dt: 0.1, airborne: false, alt: 0 });
    const gain3 = +(m.sys.rotor - 30).toFixed(3);
    return { gain1, gain2, gain3 };
  },

  // ⑪ 阈值告警事件：跨级才发（lvl1 从 25 起：dmg40 → rotor 28=lvl1；
  //     dmg45 → +31.5 → 59.5=lvl2；小伤不跨级无事件）
  events() {
    const m = mk({ rng: () => 0.5 });
    m.applyHit({ dmg: 40, dir: { x: 0, y: 1, z: 0 } });
    m.applyHit({ dmg: 45, dir: { x: 0, y: 1, z: 0 } });
    m.applyHit({ dmg: 1, dir: { x: 0, y: 1, z: 0 } });     // 未跨级 → 无事件
    return { events: m.events.map(e => ({ sys: e.sys, level: e.level })) };
  },

  // ⑫ 复位语义（state() 字段名：jamCool/rebootCool）
  reset() {
    const m = mk({ rng: () => 0.1 });
    m.applyHit({ dmg: 40, dir: { x: 0, y: 1, z: 0 } });
    m.jammed = true; m.overheat = 0.7; m.wcCool = 5; m.abCool = 3;
    m.mitigate = true; m.loadReduce = true;
    m.reset();
    const st = m.state();
    return { clean: st.sys.rotor === 0 && st.overheat === 0 && !st.jammed &&
                   st.jamCool === 0 && st.rebootCool === 0 && !st.mitigate && !st.loadReduce,
             events: m.events.length };
  },

  // ⑬ 卡壳自然触发（Phase 19-补二）：Lv<2 恒 0——rng=()=>0 是"必卡档"
  //     （0 < 一切正阈值），lv1 持续开火 10s 仍不卡即证明风险恒 0（短路不掷）
  jam_nolow() {
    const m = mk({ rng: () => 0 });
    m.sys.weapons = 30;                    // lvl1
    steps(m, 100, { dt: 0.1, airborne: true, alt: 14, firing: true });
    return { jammed: m.jammed };
  },

  // ⑭ 各等级风险率判别 + firing 短路。dt=0.1 → 单帧阈值 = 率×0.1：
  //     lvl2 0.004 / lvl3 0.009 / lvl4 0.016。rng=0.005 卡在 lvl2 与 lvl3
  //     阈值之间——lvl2 十秒不卡、lvl3/lvl4 首帧即卡（率随级升的确定性证据）
  jam_levels() {
    const F = { dt: 0.1, airborne: true, alt: 14, firing: true };
    const m2 = mk({ rng: () => 0.003 });   // 0.003 < 0.004 → lvl2 即卡
    m2.sys.weapons = 50;
    steps(m2, 1, F);
    const lvl2Jam = m2.jammed;
    const m2b = mk({ rng: () => 0.005 });  // 0.005 > 0.004 → lvl2 不卡
    m2b.sys.weapons = 50;
    steps(m2b, 100, F);
    const lvl2NoJam = !m2b.jammed;
    const m3 = mk({ rng: () => 0.005 });   // 0.005 < 0.009 → lvl3 即卡
    m3.sys.weapons = 75;
    steps(m3, 10, F);
    const lvl3Jam = m3.jammed;
    const m4 = mk({ rng: () => 0.005 });   // 0.005 < 0.016 → lvl4 即卡
    m4.sys.weapons = 100;
    steps(m4, 10, F);
    const lvl4Jam = m4.jammed;
    const m0 = mk({ rng: () => 0 });       // 必卡档但不开火 → 永不卡
    m0.sys.weapons = 100;
    steps(m0, 10, { dt: 0.1, airborne: true, alt: 14, firing: false });
    const noFireNoJam = !m0.jammed;
    return { lvl2Jam, lvl2NoJam, lvl3Jam, lvl4Jam, noFireNoJam };
  },

  // ⑮ 免卡壳窗口全链：自然卡（rng=0 必卡档）→ N 上膛（rng=0 < p=0.55 必成功）
  //     → 解卡 + 免疫恰 10s → 窗口内持续开火 9.5s 不卡 → 窗口耗尽后再开火再卡。
  //     weapons 初始 60：修 10 后 =50 仍 lvl2——否则跌回 lvl1 风险恒 0 就测不到再卡
  jam_immune() {
    const F = { dt: 0.1, airborne: true, alt: 14, firing: true };
    const m = mk({ rng: () => 0 });
    m.sys.weapons = 60;                    // lvl2：风险阈 0.004、上膛成功率 0.55
    steps(m, 1, F);                        // 第一帧即自然卡
    const jam1 = m.jammed;
    const c1 = m.weaponsCycle();           // N 处置受理
    steps(m, 30, F);                       // 3s 完成 → 解卡 + 免疫 10s
    const cleared = !m.jammed && m.jamImmune === 10;
    steps(m, 95, F);                       // 免疫窗内持续开火 9.5s
    const immuneHeld = !m.jammed && m.jamImmune > 0;
    steps(m, 8, F);                        // 跨过剩余窗口（~0.5s）→ 再卡
    const reJam = m.jammed;
    const resetClears = (m.reset(), m.jamImmune === 0 && !m.jammed);
    return { jam1, c1, cleared, immuneHeld, reJam, resetClears };
  },
};

const name = process.argv[2];
if (!name || !CASES[name]) {
  console.error('usage: node damage_drive.js <' + Object.keys(CASES).join('|') + '>');
  process.exit(2);
}
console.log(JSON.stringify(CASES[name]()));
