// ============================================================
// 90-campaign.js — 结算评级算法 + 战役存档（Phase 20-C/D）
// ============================================================
// 纯逻辑模块（84/86/87/89 同款纪律）：零 THREE、零 DOM。storage 是唯一
// 可注入依赖（缺省取 globalThis.localStorage，读不到/抛异常一律内存降级
// ——隐私模式与 node 桩同一条路径，83-arcade _loadPersisted 同款容错）。
//
//   C 评级（grade）——兼容性是硬约束：
//     基础档 = 既有 missionRating 曲线（elapsed/acc 两输入，S/A/B/C 四级）。
//     完整档在基础档之上叠"只降不升"的调整项 + 一项"保档"：
//       · damage：≥8 降 2 档、≥4 降 1 档（既有语义，P8 不变）
//       · fuel：结算剩余 <FUEL_DROP(25%) 降 1 档（返场规划的回报）
//       · ammoDry：三类弹药全耗尽降 1 档（火力管理失当）
//       · rookie 难度封顶 A（S 是 standard/veteran 的荣誉——rookie 目标
//         抗打击 0.6、时限 ×1.25，拿 S 说服力不足）
//       · comboMax ≥COMBO_KEEP(5)：保档——抵消一次降档（火力压制弥补
//         损失）。保档不升档：任何既有场景（无降档）行为零变化。
//     ⇒ 旧公式全部既有测试场景（elapsed 短/命中高/损伤<4/油充足/standard）
//       的输出与 missionRating 逐位一致——test_mobile_mission 的页面内
//       复算断言不破。逐项明细 detail 结构化输出（7 项输入各自影响）。
//     权重可配置：GRADECFG 可经构造 opts.cfg 覆盖（纯 pytest 注入验证）。
//
//   D 战役存档：
//     6 关解锁链（CAMPAIGN_LEVELS）：每关 = 变体×难度组合；前关 bestGrade
//     达 B 即解锁下一关。每关记最高分/最高评级/成就并集/累计机务损伤。
//     schema_version:1；migrate() 处理 v0（无版本号）/缺字段；损坏 JSON
//     一律回退全新档（绝不炸页面）；storage 不可用内存降级。
//
// 拓扑：90 顶层符号不得被低编号模块引用；70-app 经 HOST.makeCampaign() 取用。
// ============================================================

// 评级基础曲线（与 70-app missionRating 同式——唯一数值源，两处同步注释）
const GRADE_BASE = [
  { t: 150, acc: 0.50, g: 'S' },
  { t: 240, acc: 0.35, g: 'A' },
  { t: 420, acc: 0.20, g: 'B' },
];
const GRADE_ORDER = ['S', 'A', 'B', 'C'];

// 评级调整配置（权重可注入：constructor opts.cfg 覆盖）
const GRADECFG = {
  FUEL_DROP: 25,     // 剩余燃油低于此 % 降一档
  DMG_T2: 8, DMG_T1: 4,   // 机体损伤降档阈值（既有 P8 语义）
  COMBO_KEEP: 5,     // 最高连击达此值保档（抵一次降档）
};

// 战役关卡定义（6 关解锁链；variant/difficulty 组合递进——
// 关卡只描述"挑战参数"，实际开始由接线层 startMission(variant)+难度快照）
const CAMPAIGN_LEVELS = [
  { name: '第一关 · 初次出击', variant: 'standard',     difficulty: 'standard' },
  { name: '第二关 · 黄金时段', variant: 'timed_rescue', difficulty: 'standard' },
  { name: '第三关 · 精打细算', variant: 'limited_ammo', difficulty: 'standard' },
  { name: '第四关 · 老兵试炼', variant: 'standard',     difficulty: 'veteran' },
  { name: '第五关 · 全面战争', variant: 'timed_rescue', difficulty: 'veteran' },
  // Phase 26：SEAD 压制作为战役收官（最硬——老兵难度下先致盲防空再清场）。
  // 存档 schema 关卡数驱动、向后兼容（_migrate 按 levels.length 补齐旧档）。
  { name: '终关 · 斩首压制', variant: 'sead_strike',  difficulty: 'veteran' },
];
const CAMPAIGN_KEY = 'ah64_campaign';
const CAMPAIGN_SCHEMA = 1;

// 工具：评级比大小（S>A>B>C）
function _gradeIdx(g) { return GRADE_ORDER.indexOf(g); }

class CampaignModule {
  constructor(opts = {}) {
    this.cfg = Object.assign({}, GRADECFG, opts.cfg || {});
    this.levels = CAMPAIGN_LEVELS;
    this.storage = opts.storage !== undefined ? opts.storage
      : (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined);
    this._mem = null;                 // 内存降级档（storage 不可用/损坏时）
    this._load();
  }

  // ---------- C：结算评级（纯函数化：读入 ctx，不碰任何外部状态） ----------
  // ctx = { elapsed, acc(0..1), fuelPct(0..100), ammoDry(bool),
  //         damage(num), comboMax(num), difficulty('rookie'|'standard'|'veteran') }
  grade(ctx) {
    const C = this.cfg;
    const elapsed = ctx.elapsed, acc = ctx.acc;
    // 基础档：旧曲线（越界即落 C）
    let base = 'C';
    for (const b of GRADE_BASE) if (elapsed < b.t && acc >= b.acc) { base = b.g; break; }
    // 调整链（只降不升）
    const drops = [];
    const dmg = ctx.damage || 0;
    if (dmg >= C.DMG_T2) drops.push({ item: 'damage', n: 2 });
    else if (dmg >= C.DMG_T1) drops.push({ item: 'damage', n: 1 });
    if ((ctx.fuelPct == null ? 100 : ctx.fuelPct) < C.FUEL_DROP) drops.push({ item: 'fuel', n: 1 });
    if (ctx.ammoDry) drops.push({ item: 'ammoDry', n: 1 });
    let n = drops.reduce((a, d) => a + d.n, 0);
    // 保档：连击达标抵一次降档（不升档——无降档时零影响）
    let kept = null;
    if (n > 0 && (ctx.comboMax || 0) >= C.COMBO_KEEP) {
      n -= 1; kept = { item: 'combo', by: drops[drops.length - 1].item };
    }
    let g = GRADE_ORDER[Math.min(3, _gradeIdx(base) + n)];
    // rookie 封顶 A
    if (ctx.difficulty === 'rookie' && _gradeIdx(g) < _gradeIdx('A')) {
      g = 'A'; drops.push({ item: 'rookieCap', cap: 'A' });
    }
    // 逐项明细（7 项输入——结构化，接线层渲染进结算面板）
    const detail = [
      { label: '用时', value: Math.round(elapsed) + 's',
        impact: base === 'C' ? '超时偏慢' : '达标（基础档 ' + base + '）' },
      { label: '命中率', value: Math.round(acc * 100) + '%',
        impact: acc >= 0.5 ? '精准' : acc >= 0.35 ? '良好' : acc >= 0.2 ? '及格' : '偏低' },
      { label: '剩余燃油', value: Math.round(ctx.fuelPct == null ? 100 : ctx.fuelPct) + '%',
        impact: (ctx.fuelPct == null ? 100 : ctx.fuelPct) < C.FUEL_DROP ? '告急（评级-1档）' : '充足' },
      { label: '弹药', value: ctx.ammoDry ? '耗尽' : '有余',
        impact: ctx.ammoDry ? '火力管理失当（评级-1档）' : '正常' },
      { label: '机体损伤', value: String(dmg),
        impact: dmg >= C.DMG_T2 ? '重损（评级-2档）' : dmg >= C.DMG_T1 ? '受损（评级-1档）' : '完好' },
      { label: '最高连击', value: '×' + (ctx.comboMax || 1),
        impact: kept ? '火力压制（保档：抵消 ' + kept.item + ' 降档）' : (ctx.comboMax || 0) >= C.COMBO_KEEP ? '火力压制（无降档可抵）' : '常规' },
      { label: '难度', value: ctx.difficulty || 'standard',
        impact: ctx.difficulty === 'rookie' ? '新手（封顶 A）' : ctx.difficulty === 'veteran' ? '老兵' : '标准' },
    ];
    return { grade: g, base, drops, kept, detail };
  }

  // ---------- D：存档（版本化 + 迁移 + 容错 + 降级） ----------
  // 全新 v1 档
  _fresh() {
    return {
      schema_version: CAMPAIGN_SCHEMA,
      unlocked: 1,                                     // 已解锁关数（1=仅第一关）
      levels: this.levels.map(() => ({ bestScore: 0, bestGrade: '', ach: [], totalDmg: 0 })),
    };
  }
  // 迁移：v0（无 schema_version）→ v1；缺字段补默认。损坏输入（非对象/
  // 数组长度不符等）一律回退全新档——存档坏不炸页面是硬约束。
  migrate(raw) {
    const fresh = this._fresh();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fresh;
    const v = raw.schema_version;
    let o = raw;
    if (typeof v !== 'number') {
      // v0：无版本号——保留可读的 unlocked/levels（字段名兼容），补版本
      o = { schema_version: 1, unlocked: raw.unlocked, levels: raw.levels };
    } else if (v > CAMPAIGN_SCHEMA) {
      return fresh;    // 未来版本：无法理解，全新档（向前容错）
    }
    const out = this._fresh();
    const u = parseInt(o.unlocked, 10);
    if (Number.isFinite(u) && u >= 1 && u <= this.levels.length) out.unlocked = u;
    if (Array.isArray(o.levels)) {
      o.levels.slice(0, this.levels.length).forEach((L, i) => {
        if (!L || typeof L !== 'object') return;
        const s = parseInt(L.bestScore, 10);
        if (Number.isFinite(s) && s > 0) out.levels[i].bestScore = s;
        if (GRADE_ORDER.includes(L.bestGrade)) out.levels[i].bestGrade = L.bestGrade;
        if (Array.isArray(L.ach)) out.levels[i].ach = L.ach.filter(x => typeof x === 'string');
        const d = Number(L.totalDmg);
        if (Number.isFinite(d) && d > 0) out.levels[i].totalDmg = d;
      });
    }
    return out;
  }
  _load() {
    let raw = null;
    try {
      const s = this.storage && this.storage.getItem && this.storage.getItem(CAMPAIGN_KEY);
      if (s) raw = JSON.parse(s);
    } catch (e) { raw = null; }      // 损坏 JSON / storage 抛异常 → 全新档
    this._mem = this.migrate(raw);
  }
  _persist() {
    try {
      if (this.storage && this.storage.setItem) {
        this.storage.setItem(CAMPAIGN_KEY, JSON.stringify(this._mem));
      }
    } catch (e) { /* 隐私模式：内存降级（_mem 即真值） */ }
  }
  get save_data() { return JSON.parse(JSON.stringify(this._mem)); }   // 深拷贝只读出口

  // 关卡完成：并入存档（最高分/最高评级保留最优、成就并集、损伤累加）；
  // 达 B 解锁下一关。grade 用本模块 grade() 的输出（接线层传结算 ctx）。
  complete(levelIdx, rec) {
    const L = this._mem.levels[levelIdx];
    if (!L) return this.save_data;
    if ((rec.score || 0) > L.bestScore) L.bestScore = Math.round(rec.score || 0);
    if (_gradeIdx(rec.grade) < (L.bestGrade ? _gradeIdx(L.bestGrade) : 99)) L.bestGrade = rec.grade;
    if (Array.isArray(rec.ach)) {
      const set = new Set(L.ach);
      for (const a of rec.ach) if (typeof a === 'string') set.add(a);
      L.ach = [...set];
    }
    L.totalDmg = Math.round(((L.totalDmg || 0) + (rec.dmg || 0)) * 10) / 10;   // 累计机务损伤
    // 解锁链：本关评级达 B（S>A>B）→ 解锁下一关
    if (_gradeIdx(L.bestGrade) <= _gradeIdx('B')) {
      this._mem.unlocked = Math.max(this._mem.unlocked, Math.min(this.levels.length, levelIdx + 2));
    }
    this._persist();
    return this.save_data;
  }
  // 关卡入口参数（接线层 startMission 用——纯逻辑只出参数）
  levelParams(i) {
    const L = this.levels[i];
    return L ? { name: L.name, variant: L.variant, difficulty: L.difficulty } : null;
  }
  unlockedCount() { return this._mem.unlocked; }
  // 判定某关是否可开（i 从 0 起；unlocked=1 → 仅 i=0 可开）
  canPlay(i) { return Number.isInteger(i) && i >= 0 && i < this._mem.unlocked && i < this.levels.length; }

  // 只读遥测（__dbg.campaign.state()；测试断言一律读此状态源）
  state() {
    return { unlocked: this._mem.unlocked, schema: CAMPAIGN_SCHEMA,
      levels: this._mem.levels, levelCount: this.levels.length };
  }
}

// 经 HOST 注册工厂——70-app（低编号）经宿主槽位取用（拓扑同款模式）。
HOST.makeCampaign = (opts) => new CampaignModule(opts);
