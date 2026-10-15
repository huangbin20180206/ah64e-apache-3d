// ============================================================
// campaign_drive.js — 90-campaign.js 纯逻辑测试驱动器（node 桩，无浏览器）
// ============================================================
// 用法：node campaign_drive.js <case>
// storage 全部注入桩对象（依赖注入，非 mock 被测对象）。
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '90-campaign.js'), 'utf8');
const HOST = {};
// 关卡数从源码的 CAMPAIGN_LEVELS 派生（不写死）：加/减关卡时测试自动跟随，
// 只守护"迁移按 levels.length 补齐 / levelCount 与声明表一致"的语义
new Function('HOST', SRC + '\n;HOST.__LEVEL_N = CAMPAIGN_LEVELS.length;')(HOST);
const makeCampaign = HOST.makeCampaign;
const LEVEL_N = HOST.__LEVEL_N;

// MapStorage 桩（getItem/setItem 语义同 localStorage）
function mapStorage(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    _dump: () => m,
  };
}
// 标准结算 ctx 工厂（全绿场景——只覆盖被测维度）
function mkCtx(over) {
  return Object.assign({
    elapsed: 100, acc: 0.6, fuelPct: 90, ammoDry: false,
    damage: 0, comboMax: 1, difficulty: 'standard',
  }, over || {});
}

const CASES = {
  // 基础曲线边界（每级阈值上下各一条，期望写死）：
  //   S 恰达 (149.9,0.5) / S 越时长侧 (150,0.5)→A / S 越命中侧 (100,0.4999)→A / 命中恰达 (100,0.5)→S
  //   A 恰达 (239.9,0.35) / A 越时长 (240,0.35)→B / B 恰达 (419.9,0.2) / B 越 (420,0.2)→C
  grade_edges() {
    const c = makeCampaign({ storage: mapStorage() });
    const g = ctx => c.grade(ctx).grade;
    return {
      s_in_time: g(mkCtx({ elapsed: 149.9, acc: 0.5 })),
      s_out_time: g(mkCtx({ elapsed: 150, acc: 0.5 })),
      s_out_acc: g(mkCtx({ elapsed: 100, acc: 0.4999 })),
      s_in_acc: g(mkCtx({ elapsed: 100, acc: 0.5 })),
      a_in_time: g(mkCtx({ elapsed: 239.9, acc: 0.35 })),
      a_out_time: g(mkCtx({ elapsed: 240, acc: 0.35 })),
      b_in_time: g(mkCtx({ elapsed: 419.9, acc: 0.2 })),
      b_out_time: g(mkCtx({ elapsed: 420, acc: 0.2 })),
    };
  },
  // 调整项边界：damage 4/8（既有 P8 语义）、fuel 25 恰不降/24.9 降、ammoDry 降
  grade_drops() {
    const c = makeCampaign({ storage: mapStorage() });
    const g = ctx => c.grade(ctx).grade;
    return {
      dmg0: g(mkCtx({ damage: 0 })),
      dmg4: g(mkCtx({ damage: 4 })),
      dmg8: g(mkCtx({ damage: 8 })),
      fuel25: g(mkCtx({ fuelPct: 25 })),
      fuel249: g(mkCtx({ fuelPct: 24.9 })),
      ammoDry: g(mkCtx({ ammoDry: true })),
      dmg4_fuel249: g(mkCtx({ damage: 4, fuelPct: 24.9 })),   // 双降 S→B
      dmg8_fuel249_ammo: g(mkCtx({ damage: 8, fuelPct: 24.9, ammoDry: true })),   // 三降 S→C
    };
  },
  // 保档：combo>=5 抵一次降档；不足 5 不抵
  grade_combo_keep() {
    const c = makeCampaign({ storage: mapStorage() });
    const r5 = c.grade(mkCtx({ fuelPct: 10, comboMax: 5 }));
    const r4 = c.grade(mkCtx({ fuelPct: 10, comboMax: 4 }));
    const r0 = c.grade(mkCtx({ comboMax: 5 }));
    return {
      keep5: r5.grade, keptBy: r5.kept ? r5.kept.item : null,
      noKeep4: r4.grade,
      noDropNoKeep: r0.grade, kept0: r0.kept === null,
    };
  },
  // rookie 封顶 A / veteran 不封顶
  grade_rookie_cap() {
    const c = makeCampaign({ storage: mapStorage() });
    return {
      rookie: c.grade(mkCtx({ difficulty: 'rookie' })).grade,
      veteran: c.grade(mkCtx({ difficulty: 'veteran' })).grade,
      rookie_dropped: c.grade(mkCtx({ difficulty: 'rookie', damage: 8 })).grade,   // A-2 → B
    };
  },
  // 兼容性黄金用例：既有浏览器测试场景（mobile_mission/arcade A9）在新公式下
  // 输出与旧 missionRating 逐位一致——73 项断言零改动的硬前提
  grade_compat() {
    const c = makeCampaign({ storage: mapStorage() });
    const g = ctx => c.grade(ctx).grade;
    return {
      // mobile_mission ③：短局+高命中+低损（acc 129%/elapsed<150s/damage<4）
      mobile: g(mkCtx({ elapsed: 30, acc: 1.29, damage: 0, fuelPct: 93, comboMax: 3 })),
      // arcade A9：全歼局 elapsed≈0.5s、damage 0
      a9: g(mkCtx({ elapsed: 1, acc: 1.0, fuelPct: 100, comboMax: 10 })),
      // 边界恰达 S（149.9s）在 dmg 3.9/油 67 下仍 S
      edge_s: g(mkCtx({ elapsed: 149.9, acc: 0.5, damage: 3.9, fuelPct: 67 })),
    };
  },
  // 逐项明细：7 项输入各有一条且 label 固定
  grade_detail() {
    const c = makeCampaign({ storage: mapStorage() });
    const d = c.grade(mkCtx({})).detail;
    return { labels: d.map(x => x.label), n: d.length, hasImpact: d.every(x => typeof x.impact === 'string' && x.impact.length > 0) };
  },

  // 存档往返：complete → 新实例读同一 storage → 逐字段一致 + B 解锁下关
  save_roundtrip() {
    const st = mapStorage();
    const c1 = makeCampaign({ storage: st });
    c1.complete(0, { score: 1200, grade: 'A', ach: ['first_blood', 'ace'], dmg: 3.5 });
    const c2 = makeCampaign({ storage: st });   // 重新加载（往返）
    const L = c2.state().levels[0];
    return {
      score: L.bestScore, grade: L.bestGrade, ach: L.ach.slice().sort(), dmg: L.totalDmg,
      unlocked: c2.state().unlocked, schema: c2.state().schema,
    };
  },
  // 最优保留：二周目低分低评级不覆盖；成就并集；损伤累加
  save_best() {
    const st = mapStorage();
    const c = makeCampaign({ storage: st });
    c.complete(0, { score: 1200, grade: 'A', ach: ['first_blood'], dmg: 3.5 });
    c.complete(0, { score: 800, grade: 'C', ach: ['ace'], dmg: 1.2 });
    const L = c.state().levels[0];
    return { score: L.bestScore, grade: L.bestGrade, ach: L.ach.slice().sort(), dmg: L.totalDmg };
  },
  // 解锁链边界：B 恰解锁 / C 不解锁（前关达 B 解锁下一关）
  unlock_boundary() {
    const run = (grade) => {
      const st = mapStorage();
      const c = makeCampaign({ storage: st });
      c.complete(0, { score: 100, grade, ach: [], dmg: 0 });
      return c.state().unlocked;
    };
    return { bUnlocks: run('B'), cNot: run('C'), sUnlocks: run('S') };
  },
  // 迁移 v0（无版本号）：保留可读字段 + 补全
  migrate_v0() {
    const c = makeCampaign({ storage: mapStorage() });
    const m = c.migrate({ unlocked: 2, levels: [{ bestScore: 500, bestGrade: 'A', ach: ['x'], totalDmg: 2 }] });
    return { schema: m.schema_version, unlocked: m.unlocked, n: m.levels.length, expected: LEVEL_N,
      kept: m.levels[0], def1: m.levels[1] };
  },
  // 迁移容错：缺字段/垃圾/数组/null 全部不炸回全新档
  migrate_bad() {
    const c = makeCampaign({ storage: mapStorage() });
    const empty = c.migrate({});
    const garbage = c.migrate('garbage');
    const nullIn = c.migrate(null);
    const arr = c.migrate([1, 2]);
    const future = c.migrate({ schema_version: 99 });
    return {
      emptyOk: empty.schema_version === 1 && empty.unlocked === 1 && empty.levels.length === LEVEL_N,
      garbageOk: garbage.schema_version === 1,
      nullOk: nullIn.schema_version === 1,
      arrOk: arr.schema_version === 1,
      futureOk: future.schema_version === 1,
    };
  },
  // 损坏 JSON：storage 里的字符串解析失败 → 构造不炸、全新档
  corrupt_json() {
    const st = mapStorage();
    st.setItem('ah64_campaign', '{broken json!!!');
    let c = null;
    try { c = makeCampaign({ storage: st }); } catch (e) { return { threw: true }; }
    return { threw: false, schema: c.state().schema, unlocked: c.state().unlocked };
  },
  // storage 不可用降级：getItem/setItem 抛异常 → 内存降级不炸
  degrade() {
    const throwing = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    let c = null;
    try { c = makeCampaign({ storage: throwing }); } catch (e) { return { threw: true }; }
    let okComplete = true;
    try { c.complete(0, { score: 5, grade: 'S', ach: [], dmg: 0 }); } catch (e) { okComplete = false; }
    const st = c.state();
    return { threw: false, okComplete, memScore: st.levels[0].bestScore, memUnlocked: st.unlocked };
  },
  // cfg 权重注入：FUEL_DROP 覆盖为 50 → 49 降档/50 不降（阈值行为随配置变化）
  cfg_weights() {
    const c = makeCampaign({ storage: mapStorage(), cfg: { FUEL_DROP: 50 } });
    const g = ctx => c.grade(ctx).grade;
    return { f49: g(mkCtx({ fuelPct: 49 })), f50: g(mkCtx({ fuelPct: 50 })) };
  },
  // 关卡参数与解锁判定
  levels() {
    const c = makeCampaign({ storage: mapStorage() });
    return {
      n: c.state().levelCount, expected: LEVEL_N,
      p0: c.levelParams(0), p4: c.levelParams(4), pBad: c.levelParams(9),
      canPlay0: c.canPlay(0), canPlay1: c.canPlay(1), canPlayNeg: c.canPlay(-1),
    };
  },
};

const name = process.argv[2];
if (!name || !CASES[name]) {
  console.error('usage: node campaign_drive.js <' + Object.keys(CASES).join('|') + '>');
  process.exit(2);
}
console.log(JSON.stringify(CASES[name]()));
