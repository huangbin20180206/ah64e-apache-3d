// ============================================================
// resources_drive.js — 89-resources.js 纯逻辑测试驱动器（node 桩，无浏览器）
// ============================================================
// 用法：node resources_drive.js <case>
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '89-resources.js'), 'utf8');
const HOST = {};
new Function('HOST', SRC + '\n;void HOST;')(HOST);
const makeResources = HOST.makeResources;

function mkEnv(over) {
  return Object.assign({
    dt: 0.05, active: true, strength: 0,
    homeDist: 50, alt: 14, stability: 1, variant: 'standard',
  }, over || {});
}
// 驱动 N 步并收集 events
function drive(mod, env, steps) {
  const ev = [];
  for (let i = 0; i < steps; i++) {
    mod.update(env);
    while (mod.events.length) ev.push(mod.events.shift());
  }
  return ev;
}

const CASES = {
  // 悬停消耗：0.22%/s × 100s = 22（fuel=78 恰值）
  fuel_hover() {
    const mod = makeResources();
    drive(mod, mkEnv(), 2000);   // 100s
    return { fuel: mod.fuel, events: mod.state().events };
  },
  // 满机动消耗：1.0%/s × 60s = 60（fuel=40 恰值）
  fuel_maneuver() {
    const mod = makeResources();
    drive(mod, mkEnv({ strength: 1 }), 1200);   // 60s
    return { fuel: mod.fuel };
  },
  // 半机动混合：rate=0.22+0.78×0.5=0.61 → 100s 耗 61（fuel=39）
  fuel_mixed() {
    const mod = makeResources();
    drive(mod, mkEnv({ strength: 0.5 }), 2000);
    return { fuel: +mod.fuel.toFixed(4) };
  },
  // 告警+耗尽事件链：fuel 从 100 烧到 0，warn1/warn2/fuelOut 各恰一次且有序
  fuel_out() {
    const mod = makeResources();
    const ev = drive(mod, mkEnv({ strength: 1 }), 2200);   // 110s > 100s 烧空
    const types = ev.map(e => e.type);
    const cnt = t => types.filter(x => x === t).length;
    const idx = t => types.indexOf(t);
    return {
      types, n1: cnt('warn1'), n2: cnt('warn2'), nOut: cnt('fuelOut'),
      order: idx('warn1') < idx('warn2') && idx('warn2') < idx('fuelOut'),
      fuel: mod.fuel, outFlag: mod.state().out,
    };
  },
  // 非任务局不耗油（show/train 保护）
  inactive() {
    const mod = makeResources();
    drive(mod, mkEnv({ active: false, strength: 1 }), 2000);
    return { fuel: mod.fuel, events: mod.state().events };
  },
  // 返场补给全链：先耗油 10% → 窗口 3s → resupplied + fuel 满
  rtb() {
    const mod = makeResources();
    drive(mod, mkEnv({ strength: 1 }), 200);            // 10s 耗 10 → fuel 90
    const fuelMid = mod.fuel;
    const ev = drive(mod, mkEnv({ strength: 0, homeDist: 3, alt: 2, stability: 1 }), 60);   // 3s
    const types = ev.map(e => e.type);
    return { fuelMid, fuelAfter: mod.fuel, resupplied: types.includes('resupplied'),
      ticks: types.filter(t => t === 'rtbTick').length };
  },
  // 窗口中途离开：进度清零，必须一次完成
  rtb_leave() {
    const mod = makeResources();
    drive(mod, mkEnv({ strength: 0, homeDist: 3, alt: 2 }), 40);        // 2s（进度 2/3）
    const p1 = mod.rtbT;
    drive(mod, mkEnv({ strength: 0, homeDist: 50, alt: 14 }), 20);      // 离开 1s → 清零
    const p2 = mod.rtbT;
    drive(mod, mkEnv({ strength: 0, homeDist: 3, alt: 2 }), 40);        // 回来 2s → 只 2s 累计
    const p3 = mod.rtbT;
    return { p1, p2, p3, resupplied: mod.state().resupplied };
  },
  // limited_ammo 变体禁用补给窗口（frugal 成就保护）
  rtb_limited() {
    const mod = makeResources();
    const ev = drive(mod, mkEnv({ strength: 0, homeDist: 3, alt: 2, variant: 'limited_ammo' }), 100);
    return { rtbOn: mod.rtbOn, rtbT: mod.rtbT, events: ev.map(e => e.type) };
  },
  // 稳定度不足窗口不计时
  rtb_stab() {
    const mod = makeResources();
    drive(mod, mkEnv({ strength: 0, homeDist: 3, alt: 2, stability: 0.89 }), 100);
    return { rtbOn: mod.rtbOn, rtbT: mod.rtbT };
  },
  // 弹药耗尽谓词边界
  ammo_dry() {
    const mod = makeResources();
    return {
      allZero: mod.ammoDry(0, 0, 0),
      gunLeft: mod.ammoDry(1, 0, 0),
      hfLeft: mod.ammoDry(0, 0, 1),
      negative: mod.ammoDry(-1, -1, -1),
    };
  },
  // cfg 权重注入：FUEL_HOVER 覆盖 0.5 → 悬停 100s 耗 50
  cfg_inject() {
    const mod = makeResources({ cfg: { FUEL_HOVER: 0.5 } });
    drive(mod, mkEnv(), 2000);
    return { fuel: +mod.fuel.toFixed(4) };
  },
  // start() 复位：耗到告急后 start → 满油+latch 复位
  start_reset() {
    const mod = makeResources();
    drive(mod, mkEnv({ strength: 1 }), 2200);
    const before = mod.state();
    mod.start();
    const after = mod.state();
    return { wasOut: before.out, fuel: after.fuel, warnReset: !after.warn1 && !after.warn2 && !after.out };
  },
};

const name = process.argv[2];
if (!name || !CASES[name]) {
  console.error('usage: node resources_drive.js <' + Object.keys(CASES).join('|') + '>');
  process.exit(2);
}
console.log(JSON.stringify(CASES[name]()));
