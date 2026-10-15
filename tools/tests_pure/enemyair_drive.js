// ============================================================
// enemyair_drive.js — 87-enemyair.js 纯逻辑测试驱动器（node 桩，无浏览器）
// ============================================================
// 加载 84（rng 工厂源）+ 87 源码（同 dist IIFE 拼接语义），按用例驱动
// update()/hitTest() 若干步，结果 JSON 打到 stdout 供 pytest 断言。
// 概率分支全部走 rng 注入（0.01 必中 / 0.99 必不中 / 0.12 落在两个命中
// 概率之间做"稳定度开关"）——不 mock 被测对象，只注入构造参数。
// 用法：node enemyair_drive.js <case>
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const SRC84 = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '84-samwar.js'), 'utf8');
const SRC87 = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '87-enemyair.js'), 'utf8');
const HOST = {};
new Function('HOST', SRC84 + '\n' + SRC87 + '\n;void HOST;')(HOST);
const makeEnemyAir = HOST.makeEnemyAir;

// ---------- 测试环境工厂 ----------
// 锚点 (0,42)（任务锚=敌方基地方位）；玩家悬停 (30,14,60)——恰在长机
// spawn 时刻的巡逻机头正前方（视距 18.4u < VISION 55、视锥 dot 0.976）。
function mkEnv(over) {
  const env = {
    dt: 0.05, heli: { x: 30, y: 14, z: 60 }, stability: 1.0,
    aim: null, aaRate: 1, aaDmg: 1, res: 1,
  };
  return Object.assign(env, over || {});
}
// 驱动到长机进入指定相位（先经历 search 0.8s）——写死步数上限防死循环
function driveTo(mod, env, phase, maxSteps) {
  for (let i = 0; i < (maxSteps || 400); i++) {
    mod.update(env);
    const u = mod.units[0];
    if (u.phase === phase) return i;
  }
  return -1;
}

const CASES = {
  // 状态链：spawn 巡逻 → 玩家入视距视锥 → search → attack（依序出现）
  chain() {
    const mod = makeEnemyAir({ seed: 20260918 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    const st0 = mod.state();
    // 玩家先在远处（不触发索敌）巡逻 10 步——相位推进
    env.heli = { x: 30, y: 14, z: 200 };
    for (let i = 0; i < 10; i++) mod.update(env);
    const patrolOk = mod.units[0].phase === 'patrol';
    // 玩家进入视距+视锥 → search → attack
    env.heli = { x: 30, y: 14, z: 60 };
    const s1 = driveTo(mod, env, 'search', 40);
    const s2 = driveTo(mod, env, 'attack', 60);
    return {
      spawnLive: st0.live === 2, spawnPhase: st0.units.every(u => u.phase === 'patrol'),
      patrolOk, sawSearch: s1 >= 0, sawAttack: s2 >= 0,
      searchStep: s1, attackStep: s2,
    };
  },

  // 攻击命中链：rng=0.01 必中 → hitPending dmg=1（GUN_DMG×aaDmg）；命中点近玩家；
  // fireEvent（渲染层曳光视觉通道）每次开火产生、hit 标志与命中一致
  attack_hit() {
    const mod = makeEnemyAir({ rng: () => 0.01, seed: 1 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    driveTo(mod, env, 'attack', 200);
    let hit = null, fires = 0, fireHits = 0;
    for (let i = 0; i < 200 && !hit; i++) {
      mod.update(env);
      if (mod.fireEvent) {
        fires++;
        if (mod.fireEvent.hit) fireHits++;
        mod.fireEvent = null;   // 消费（渲染层语义）
      }
      if (mod.hitPending) { hit = mod.hitPending; mod.hitPending = null; }
    }
    const near = hit ? Math.hypot(hit.x - env.heli.x, hit.y - env.heli.y, hit.z - env.heli.z) : -1;
    return { hit: !!hit, dmg: hit ? hit.dmg : 0, near: +near.toFixed(2), fires, fireHits };
  },

  // 稳定度开关（机动规避收益）：rng=0.12 恰落在 stab=1（p≈0.16）与
  // stab=0.25（p≈0.10）的命中概率之间——悬停必中、机动必不中（确定性）
  stability() {
    const run = (stab) => {
      const mod = makeEnemyAir({ rng: () => 0.12, seed: 1 });
      const env = mkEnv({ stability: stab });
      mod.spawn({ x: 0, z: 42 });
      driveTo(mod, env, 'attack', 200);
      let hits = 0;
      for (let i = 0; i < 400; i++) {
        mod.update(env);
        if (mod.hitPending) { hits++; mod.hitPending = null; }
      }
      return hits;
    };
    return { hoverHits: run(1.0), maneuverHits: run(0.25) };
  },

  // 被持续锁定规避：aim 每步跟踪长机（持续瞄准语义——敌机站位移动时
  // 固定向量会偏出 0.35rad 瞄准窗）持续 >LOCKED_T → evade
  evade_locked() {
    const mod = makeEnemyAir({ rng: () => 0.99, seed: 1 });   // 0.99 必不中（隔离命中通道）
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    driveTo(mod, env, 'attack', 200);
    let sawEvade = false;
    for (let i = 0; i < 100; i++) {
      const u = mod.units[0];           // 每步重取位置（跟踪瞄准）
      const dx = u.x - env.heli.x, dy = u.y - env.heli.y, dz = u.z - env.heli.z;
      const l = Math.hypot(dx, dy, dz);
      env.aim = { x: dx / l, y: dy / l, z: dz / l };
      mod.update(env);
      if (mod.units[0].phase === 'evade') { sawEvade = true; break; }
    }
    return { sawEvade };
  },

  // 受损规避：hitTest 注入 3 点（≥EVADE_DMG）→ 下帧 evade
  evade_dmg() {
    const mod = makeEnemyAir({ rng: () => 0.99, seed: 1 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    driveTo(mod, env, 'attack', 200);
    const u = mod.units[0];
    const hit = mod.hitTest({ x: u.x, y: u.y, z: u.z }, 3);
    mod.update(env);   // 受损判定在 update 的 attack 分支
    return { hitUnit: !!hit, phase: mod.units[0].phase, dmg: +mod.units[0].dmg.toFixed(2), hp: +mod.units[0].hp.toFixed(2) };
  },

  // 重损撤出：一发 6 点（≥WITHDRAW_DMG）→ withdraw → 驱动到退场 off
  withdraw_dmg() {
    const mod = makeEnemyAir({ rng: () => 0.99, seed: 1 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    driveTo(mod, env, 'attack', 200);
    const u = mod.units[0];
    mod.hitTest({ x: u.x, y: u.y, z: u.z }, 6);
    mod.update(env);
    const w0 = mod.units[0].phase === 'withdraw';
    let off = false;
    for (let i = 0; i < 400; i++) {
      mod.update(env);
      if (!mod.units[0].on) { off = true; break; }
    }
    return { withdrew: w0, exited: off };
  },

  // 弹药耗尽撤出：真实驱动打空 40 机炮 + 4 火箭（rng=0.99 隔离命中）→ withdraw
  withdraw_ammo() {
    const mod = makeEnemyAir({ rng: () => 0.99, seed: 1 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    driveTo(mod, env, 'attack', 200);
    let sawWithdraw = false, steps = 0;
    for (let i = 0; i < 2000; i++) {
      mod.update(env);
      steps++;
      if (mod.units[0].phase === 'withdraw') { sawWithdraw = true; break; }
    }
    return { sawWithdraw, steps, gunN: mod.units[0].gunN, rkN: mod.units[0].rkN };
  },

  // 击落链：8 点一发击落 → killEvent{type:'enemy'} + off + hitTest 命中返回
  kill() {
    const mod = makeEnemyAir({ rng: () => 0.99, seed: 1 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    const u = mod.units[0];
    const hit1 = mod.hitTest({ x: u.x + 1, y: u.y, z: u.z }, 8, 0);   // 界内（HIT_R 2.2）
    const ev = mod.killEvent;
    const miss = mod.hitTest({ x: u.x + 10, y: u.y, z: u.z }, 8, 0);  // 界外 miss
    const st = mod.state();
    return {
      hitUnit: !!hit1, killed: !!ev && ev.type === 'enemy', label: ev ? ev.label : '',
      off: !mod.units[0].on, missNull: miss === null, live: st.live,
    };
  },

  // 难度抗打击（res）：veteran res=1.4 下同弹扣血更少（8 发不致死）
  res() {
    const mod = makeEnemyAir({ rng: () => 0.99, seed: 1 });
    const env = mkEnv({ res: 1.4 });
    mod.spawn({ x: 0, z: 42 });
    mod.update(env);              // env.res 进缓存
    const u = mod.units[0];
    mod.hitTest({ x: u.x, y: u.y, z: u.z }, 8);
    const std = makeEnemyAir({ rng: () => 0.99, seed: 1 });
    std.spawn({ x: 0, z: 42 });
    std.update(mkEnv());
    const u2 = std.units[0];
    std.hitTest({ x: u2.x, y: u2.y, z: u2.z }, 8);
    return { vetHp: +u.hp.toFixed(2), stdDead: !u2.on, vetAlive: !!u.on };
  },

  // 编队协同：巡逻位差（不重叠）+ 攻击态侧翼分散（两机拉开 >8u）
  wing() {
    const mod = makeEnemyAir({ rng: () => 0.99, seed: 1 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    const patrolDist = Math.hypot(
      mod.units[0].x - mod.units[1].x, mod.units[0].y - mod.units[1].y, mod.units[0].z - mod.units[1].z);
    const dh = Math.abs(mod.units[0].y - mod.units[1].y);
    driveTo(mod, env, 'attack', 200);
    for (let i = 0; i < 120; i++) mod.update(env);   // 站位收敛
    const atkDist = Math.hypot(
      mod.units[0].x - mod.units[1].x, mod.units[0].y - mod.units[1].y, mod.units[0].z - mod.units[1].z);
    return { patrolDist: +patrolDist.toFixed(1), atkDist: +atkDist.toFixed(1), dh: +dh.toFixed(2) };
  },

  // 复位语义：交战进行中 reset → 全清（active/live/事件）
  reset() {
    const mod = makeEnemyAir({ rng: () => 0.01, seed: 1 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    driveTo(mod, env, 'attack', 200);
    mod.update(env);
    mod.reset();
    const st = mod.state();
    return {
      active: st.active, live: st.live, hitNull: mod.hitPending === null,
      killNull: mod.killEvent === null, phases: mod.units.map(u => u.phase),
    };
  },

  // search→patrol 位置连续性：search 阶段单元用 _advance 离开巡逻圆去追玩家，
  // 但全程不更新 u.ang；玩家脱离 VISION_LOSE 后回 patrol，下一帧用冻结的旧
  // u.ang 重算位置 → 单元瞬移弹回巡逻环。量"回 patrol 那一帧"的位置跳变。
  search_teleport() {
    const mod = makeEnemyAir({ seed: 20260918 });
    const env = mkEnv();
    mod.spawn({ x: 0, z: 42 });
    // 只驱动长机（i=0）；玩家在视距视锥内 → search
    const u = mod.units[0];
    driveTo(mod, env, 'search', 40);
    // search 阶段追玩家若干步，让单元明显偏离巡逻圆（不进 attack：SEARCH_T=0.8s=16步内拉远）
    for (let i = 0; i < 12; i++) mod.update(env);
    // 玩家瞬间拉到远处（> VISION_LOSE 66u）。第 190 行回 patrol 那帧直接 return
    // 不重算位置；瞬移发生在再下一帧（phase 已是 patrol，走重算分支用旧 ang）。
    env.heli = { x: 500, y: 14, z: 500 };
    mod.update(env);                 // 这帧：search 分支检测 dist>LOSE → 置 patrol 并 return
    const midPhase = u.phase;
    const beforeX = u.x, beforeZ = u.z;   // 重算前的真实追击位置
    mod.update(env);                 // 这帧：patrol 分支用冻结旧 ang 重算位置 → 瞬移点
    const afterX = u.x, afterZ = u.z, afterPhase = u.phase;
    const jump = Math.hypot(afterX - beforeX, afterZ - beforeZ);
    return {
      midPhase, afterPhase,
      jump: +jump.toFixed(2),          // patrol 重算帧的位置跳变（u）
      // 修复前（沿用冻结旧 ang）此值 ~7.3u——粗暴瞬移闪现；
      // 修复后（回 patrol 前按当前位置反算 ang）降到 ~1.37u，仅剩半径回归残差。
      bounded: jump < 2.0,             // 有界（无粗暴瞬移）；残差=偏离巡逻圆半径的回位
    };
  },
};

const name = process.argv[2];
if (!name || !CASES[name]) {
  console.error('usage: node enemyair_drive.js <' + Object.keys(CASES).join('|') + '>');
  process.exit(2);
}
console.log(JSON.stringify(CASES[name]()));
