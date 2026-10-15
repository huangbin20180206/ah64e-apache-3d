// ============================================================
// samwar_drive.js — 84-samwar.js 纯逻辑测试驱动器（node 桩，无浏览器）
// ============================================================
// 加载 src/app/84-samwar.js 源码（本模块纯逻辑：只引用 HOST 桩与标准 JS），
// 按用例驱动 update() 若干步，把结果以 JSON 打到 stdout 供 pytest 断言。
// 用法：node samwar_drive.js <case>   （case 见 CASES 表）
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'app', '84-samwar.js'), 'utf8');

// 桩：本模块对宿主的唯一依赖是 HOST 工厂槽（与 83-arcade 同模式）
const HOST = {};
new Function('HOST', SRC + '\n;void HOST;')(HOST);
const makeSamWar = HOST.makeSamWar;

// ---------- 测试环境工厂：基地一个发射位，机体悬停 (0,14,0) ----------
function mkEnv(over) {
  const env = {
    dt: 0.05,
    aaOn: true,
    heli: { x: 0, y: 14, z: 0, vx: 0, vy: 0, vz: 0 },
    sites: [{ x: 0, z: 42 }, { x: 6.5, z: 38 }, { x: -6.5, z: 38 },
            { x: -3, z: 47 }, { x: 2, z: 47.5 }, { x: 7, z: 47 },
            { x: -9, z: 39 }, { x: -7, z: 43 }, { x: -11, z: 42 }, { x: 12, z: 46.5 }],
    siteN: 1,
    aaRate: 1, aaDmg: 1,
  };
  return Object.assign(env, over || {});
}

// 驱动 N 步；stepFn 可在每步前改 env（机动注入）
function drive(mod, env, steps, stepFn) {
  for (let i = 0; i < steps; i++) {
    if (stepFn) stepFn(i, env);
    mod.update(env);
    if (mod.hitPending) break;   // 命中即止（消费方语义同 70-app）
  }
}

const CASES = {
  // RWR 状态链：idle→track→lock→launch 依序出现，发射时刻有界
  chain() {
    const mod = makeSamWar({ seed: 20260917 });
    const env = mkEnv();
    const seen = [];
    let last = 'idle', launchAt = -1;
    for (let i = 0; i < 1200 && mod.launchN === 0; i++) {
      mod.update(env);
      if (mod.phase !== last) { seen.push(mod.phase); last = mod.phase; }
    }
    if (mod.launchN > 0) {
      launchAt = +(env.dt * 0).toFixed(0); // 占位（下方用 i 换算）
    }
    // 重算发射时刻（上面 i 不可达——直接用 state 时间换算）
    const steps = 0; // 已在上面循环退出
    return {
      launched: mod.launchN > 0,
      order: seen,
      launchN: mod.launchN,
      missiles: mod.state().missiles,
      // 发射必然经过 track→lock（状态机无捷径）
      passedTrack: seen.includes('track'),
      passedLock: seen.includes('lock'),
    };
  },

  // 直飞悬停必被命中：静止机体、无干扰弹、无机动 → 命中 + 损伤 4 + 爆点半径
  hit() {
    const mod = makeSamWar({ seed: 20260917 });
    const env = mkEnv();
    drive(mod, env, 1600);   // 80s 模拟上限（发射 ≤14s + 飞行 ~2s，绰绰有余）
    const h = mod.hitPending;
    return {
      hit: !!h,
      dmg: h ? h.dmg : 0,
      withinRadius: h ? Math.hypot(h.x - env.heli.x, h.y - (env.heli.y + 0.6), h.z - env.heli.z) : -1,
      missiles: mod.state().missiles,
    };
  },

  // 机动规避（机制级断言）：发射后立即环形机动（4u 半径 12u/s）——
  // 首枚导弹必然被甩出导引头视场（lost=true）且未命中；只跟踪首枚
  // （RWR 链会再发射，后续枚的几何相位可能顺弹命中——那是合理的威胁性，
  // 不在本用例断言范围）
  evade() {
    const mod = makeSamWar({ seed: 20260917 });
    const env = mkEnv();
    let t = 0;
    for (let i = 0; i < 1200 && mod.launchN === 0; i++) { mod.update(env); t += env.dt; }
    let sawLost = false, hit = false;
    for (let i = 0; i < 600; i++) {
      const a = t * 3;
      env.heli.x = 4 * Math.sin(a);
      env.heli.z = 4 * (1 - Math.cos(a));
      env.heli.vx = 12 * Math.cos(a);
      env.heli.vz = 12 * Math.sin(a);
      const prevOn = mod.state().missiles;
      mod.update(env);
      const st = mod.state();
      if (st.lost) sawLost = true;
      if (mod.hitPending) { hit = true; break; }
      // 首枚终结：在场数 1→0，或第二枚已发射（首枚寿命已尽）
      if ((prevOn >= 1 && st.missiles === 0) || mod.launchN >= 2) break;
      t += env.dt;
    }
    return {
      launched: mod.launchN > 0,
      hit: hit,
      lost: sawLost,                 // 硬机制实证：导引头被机动甩出视场
    };
  },

  // 干扰弹诱骗：注入 rng=0.1（<FLARE_P 恒真）→ 必被拐走、不命中
  flare() {
    const mod = makeSamWar({ seed: 20260917, rng: () => 0.1 });
    const env = mkEnv();
    for (let i = 0; i < 1200 && mod.launchN === 0; i++) mod.update(env);
    // 导弹逼近到 25u 内投放干扰弹
    let dispensed = false, decoyed = false;
    for (let i = 0; i < 600; i++) {
      mod.update(env);
      const st = mod.state();
      if (!dispensed && st.missiles > 0 && st.nearest > 0 && st.nearest < 25) {
        dispensed = mod.dispenseFlare();
      }
      if (st.decoyed) decoyed = true;
      if (st.missiles === 0 && dispensed) break;
    }
    const st = mod.state();
    return {
      dispensed: dispensed,
      flaresLeft: mod.flares,
      decoyed: decoyed,
      hit: !!mod.hitPending,
      missiles: st.missiles,
    };
  },

  // 战损→操控惩罚映射表：精确边界
  penalty() {
    const mod = makeSamWar({});
    const probe = (d) => JSON.stringify(mod.penaltyFor(d));
    return {
      d0: probe(0), d3: probe(3.99), d4: probe(4), d7: probe(7.99),
      d8: probe(8), d11: probe(11.99), d12: probe(12), d20: probe(20),
    };
  },

  // 干扰弹弹药与冷却：冷却是设计语义（防一秒连投 6 发）——每次隔冷却投，
  // 6 发全部成功、第 7 发耗尽拒绝；冷却内立即再投拒绝、冷却过可用
  ammo() {
    const mod = makeSamWar({ seed: 20260917 });
    const env = mkEnv();
    mod.update(env);   // 建立 _env（dispenseFlare 依赖）
    const six = [];
    for (let i = 0; i < 6; i++) {
      six.push(mod.dispenseFlare());
      for (let j = 0; j < 30; j++) mod.update(env);   // 1.5s > 冷却 1.1s
    }
    const seventh = mod.dispenseFlare();             // 耗尽 → false
    // 冷却拒绝：重置后首投 true、立即再投 false、1.5s 后 true
    mod.reset(); mod.update(env);
    const a1 = mod.dispenseFlare();
    const a2 = mod.dispenseFlare();          // 冷却 1.1s 内 → false
    for (let i = 0; i < 30; i++) mod.update(env);   // 1.5s
    const a3 = mod.dispenseFlare();          // 冷却已过 → true
    return { six, seventh, a1, a2, a3, flares: mod.flares };
  },

  // 复位语义：交战进行中 reset → 全部归零（launchN 单调保留）
  reset() {
    const mod = makeSamWar({ seed: 20260917 });
    const env = mkEnv();
    for (let i = 0; i < 1200 && mod.launchN === 0; i++) mod.update(env);
    mod.dispenseFlare();
    const before = mod.state();
    mod.reset();
    const after = mod.state();
    return {
      wasLaunched: before.launchN > 0,
      launchNKept: after.launchN === before.launchN,
      phaseIdle: after.phase === 'idle',
      flaresFull: after.flares === 6,
      missilesZero: after.missiles === 0,
      hitCleared: mod.hitPending === null,
      flareFxCleared: mod.flareFx === null,
    };
  },

  // 导弹池 slot 复用：一枚导弹失锁(lost=true)退场后，复用同 slot 再发射的
  // 新导弹必须清除 lost 标志（否则新导弹一出膛即带残留 lost→导引全跳过→哑弹）。
  relaunch_lost() {
    const mod = makeSamWar({ seed: 20260917 });
    const env = mkEnv();
    mod.update(env);   // 建立 _env
    // 模拟一枚已失锁并退场的导弹占住池 slot 0（gimbal 甩脱后直飞自毁的残留态）
    const m0 = mod.missiles[0];
    m0.on = false; m0.lost = true; m0.decoyed = true; m0.hasLos = true;
    // 从池复用同 slot 再发射（_fireFrom 取第一个 !on）
    mod._fireFrom({ x: 0, z: 42 }, env);
    // 新发射的导弹（占回 slot 0）应是干净可导引态
    const nm = mod.missiles[0];
    return {
      fired: nm.on === true,
      lostCleared: nm.lost === false,       // 缺陷点：_fireFrom 漏清 lost
      decoyedCleared: nm.decoyed === false, // 对照：decoyed 已被清（证明只是漏了 lost）
      hasLosCleared: nm.hasLos === false,
    };
  },

  // 非交战门控：aaOn=false 不建锁；已发射导弹继续飞完（不因脱离而消失）
  noengage() {
    const mod = makeSamWar({ seed: 20260917 });
    const env = mkEnv({ aaOn: false });
    const idleSeen = [];
    for (let i = 0; i < 400; i++) { mod.update(env); idleSeen.push(mod.phase); }
    // 发射一枚后关 aaOn：导弹应继续飞行直至自然终结
    const env2 = mkEnv();
    for (let i = 0; i < 1200 && mod.launchN === 0; i++) mod.update(env2);
    env2.aaOn = false;
    let resolved = false, hitOn = false;
    for (let i = 0; i < 600; i++) {
      mod.update(env2);
      if (mod.hitPending) { hitOn = true; resolved = true; break; }
      if (mod.state().missiles === 0) { resolved = true; break; }
    }
    return {
      neverEngaged: idleSeen.every(p => p === 'idle'),
      missileResolved: resolved,
      hitOrGone: hitOn || mod.state().missiles === 0,
    };
  },
};

const name = process.argv[2];
if (!name || !CASES[name]) {
  console.error('usage: node samwar_drive.js <' + Object.keys(CASES).join('|') + '>');
  process.exit(2);
}
console.log(JSON.stringify(CASES[name]()));
