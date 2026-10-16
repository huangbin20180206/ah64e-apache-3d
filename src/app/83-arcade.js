// ============================================================
// 83-arcade.js — 轻街机层（Phase 18：难度 / 分数 / 成就）
// ============================================================
// 在既有 S._mission 统一任务状态机上叠加三层游戏性（用户拍板"轻街机化"，
// 不做多关卡战役）。本模块零 WebGL 新增——纯逻辑 + 少量 DOM，tri/draws
// 与上一批必须逐项全等。
//
//   G1 难度三档（rookie / standard / veteran）：
//      系数表 DIFFICULTIES 是唯一数值源；16-targets（AA 开火率/单发伤害/目标抗打击）
//      与 70-app（时限/得分）经 HOST.arcade 读系数派生，禁止各自内置表。
//      默认 standard 全 1.0 ⇒ 既有 67 项门禁行为零变化。
//   G2 分数：击毁基础分（按目标类型）× 难度系数 × 连击系数（6s 窗口，
//      1 + 0.15×min(combo-1,5) 封顶 ×1.75）+ 任务结算奖励；HUD 实时显示；
//      最高分 localStorage ah64_arcade_hi_<难度>（隐私模式静默降级内存）。
//   G3 成就 10 项：first_blood/combo5/wipeout 游玩中即时 toast（S2）；
//      ghost/speedrun/frugal/veteran_s 在结算时授予（依赖最终时长/损伤/评级）；
//      all_variants 跨局持久（重启不重弹）。单局内解锁随 startMission 清零
//      （除 all_variants 与最高分外）。
//
// 拓扑：本文件（83）顶层符号 ARCade/DIFFICULTIES/ACHIEVEMENTS/ArcadeModule/
// MISSION_VARIANT_KEYS 不得被低编号模块直接引用——70-app（低编号）经宿主
// 工厂槽 HOST.arcade = HOST.makeArcade() 取用（79/80/81 先例）。
// 时间源：本模块不自带时钟，70-app loop 每帧喂 update(S.time, dt)；
// 连击窗口据此衰减（帧率无关）。
// ============================================================

// 三任务变体键（all_variants 判定）。与 70-app MISSION_VARIANTS 的键保持
// 同源语义——此处独立列出，避免 83 反向读 70-app 顶层符号（拓扑硬规则）；
// 变体键一旦新增须两处同步（test_arcade 断言数量一致）。
const MISSION_VARIANT_KEYS = ['standard', 'timed_rescue', 'limited_ammo'];

// 难度系数表（唯一数值源）。standard 全 1.0：既有行为不变（回归铁律）。
//   res        目标抗打击系数（大=目标更耐打，玩家命中造成的有效损伤 = 武器威力/此值；
//              只作用于 hitTest 对目标 HP 的扣减，不改武器弹道/伤害数值本身——规格 §四边界）
//   aaRate     敌方 AA 开火频率系数（大=敌方打得勤；命中概率按规格**不**随难度派生，
//              保持标准公式——避免"命中概率也被缩放+钳制"导致入射 DPS 实际摆幅超标）
//   aaDmg      敌方单发伤害系数（1.4 非整数——按系数累加小数损伤，
//              受损分级/失败阈值读同一累计值，语义不变）
//   timeoutMul 任务时限系数（70-app missionTimeout 乘进变体时限）
//   scoreMul   得分系数（越难越赚）
const DIFFICULTIES = {
  // 2026-10-14 用户反馈“降低点难度”：新手、标准两档整体放宽（老兵不变）
  rookie:   { name: '新手', res: 0.5, aaRate: 0.35, aaDmg: 0.35, timeoutMul: 1.5,  scoreMul: 0.8 },
  standard: { name: '标准', res: 0.85, aaRate: 0.75, aaDmg: 0.7, timeoutMul: 1.2,  scoreMul: 1.0 },
  veteran:  { name: '老兵', res: 1.4, aaRate: 1.5, aaDmg: 1.4,  timeoutMul: 0.85, scoreMul: 1.5 },
};

// 目标基础分（类型 → 分）。地面（16-targets）与空中（26-airtargets）共用：
// 地面类型键 = targets.type（tank/truck/barrel），空中 = air t.type
// （drone/balloon/plane）。Phase 20-A：enemy = 87-enemyair 的 A2A 武装
// 直升机（击落分最高——空战难度与 SAM/AA 威胁并存）。
const TARGET_SCORES = {
  truck: 100, tank: 150, barrel: 80,
  drone: 300, balloon: 200, plane: 400,
  enemy: 500,
  // Phase 21：敌方基地设施（高价值，介于载具与敌机之间；雷达联动 SEAD 压制）
  radar: 200, sam: 250, ammo: 120,
  infantry: 50,   // P5-G2 敌方步兵（RPG 兵同分）
};

// 成就定义（10 项）。击杀类（first_blood/combo5/wipeout/ace/sead）经 _grantImmediate
// 在游玩中即时授予（S2）；结果判定类（ghost/speedrun/frugal/veteran_s/
// all_variants）依赖最终时长/损伤/评级，在 completeMission 结算时依据 ctx
// 授予（ctx 由 70-app 组装）。
const ACHIEVEMENTS = [
  { id: 'first_blood',  name: '首杀',     desc: '首次击毁任一目标' },
  { id: 'combo5',       name: '火力压制', desc: '单局连击达到 ×5' },
  { id: 'wipeout',      name: '清场',     desc: '单局全歼 10 个目标' },
  { id: 'ace',          name: '空战王牌', desc: '击落敌方武装直升机' },
  { id: 'sead',         name: '压制防空', desc: '摧毁敌雷达站致盲防空' },
  { id: 'ghost',        name: '幽灵',     desc: 'standard 难度完成且损伤 <4' },
  { id: 'speedrun',     name: '闪电战',   desc: 'standard 难度 120s 内完成' },
  { id: 'frugal',       name: '省弹家',   desc: '受限弹药变体以剩余弹药 ≥50% 完成' },
  { id: 'veteran_s',    name: '老兵 S 级', desc: 'veteran 难度获得 S 评级' },
  { id: 'all_variants', name: '全能',     desc: '三种任务变体各完成 1 次（跨局累计）' },
];

// 跨局持久成就（其余单局制，重启不保留——规格 G3「除 all_variants 与最高分外」）。
const ACH_PERSIST = ['all_variants'];

// 连击窗口与系数：COMBO_WINDOW 秒内再击递增，系数 = 1 + 0.15×min(combo-1,5)
// 封顶 COMBO_CAP（combo=6 起恒 1.75）。
const COMBO_WINDOW = 6;
const COMBO_STEP = 0.15;
const COMBO_CAP = 1.75;

class ArcadeModule {
  constructor() {
    this.difficulty = 'standard';   // 当前选定难度（startMission 快照进 S._mission.difficulty）
    this._time = 0;                 // 70-app loop 每帧喂 S.time（本模块不自带时钟）
    this._score = 0;                // 本局得分（onMissionStart 清零）
    this._combo = 1;               // 连击计数（1=无连击；窗口超时归 1）
    this._comboMax = 1;            // 本局最高连击（combo5 判定源）
    this._comboExpire = -1;        // 连击窗口到期（_time 基准）
    this._kills = 0;               // 本局击毁数（first_blood/wipeout 判定源）
    this._enemyKills = 0;          // 本局 A2A 击落数（ace 判定源；Phase 20-A）
    this._radarKilled = false;     // 本局雷达是否已摧毁（sead 判定源；Phase 21）
    this._lastSeadBonus = 0;       // 上次结算的 SEAD 压制奖励（结算面板展示；Phase 23）
    this._achUnlocked = {};        // 单局内已解锁（id→true；startMission 清零）
    this._achUnlockedAll = {};     // 跨局累计（变体完成记录，持久化）
    this._achPersist = {};         // 跨局持久成就解锁（ACH_PERSIST 表；重启不重弹）
    this._hi = {};                 // 内存最高分（localStorage 不可用时降级）
    this._loadPersisted();
  }

  // ---------- G1 难度 ----------
  // 简报阶段切换难度（简报面板/成就面板的 chips 共用此唯一入口）：
  // 更新 S.difficulty 并在 S._mission 处于 briefing 时同步快照。
  // 任务进行中（active/done/failed）切换无效——必须重试（公平性边界）。
  setDifficulty(key) {
    if (!DIFFICULTIES[key]) return false;
    this.difficulty = key;
    const S = HOST.S;
    const m = S && S._mission;
    if (m && m.phase === 'briefing' && !m.frozen) m.difficulty = key;
    return true;
  }
  // 读任务生效难度。难度唯一事实源 = 任务快照 S._mission.difficulty
  // （startMission 时冻结本局；结算/AA/计分/最高分归属均读此值，任务中切面板不改档）。
  // 无任务/简报阶段回退当前选定档 this.difficulty（面板选项）；未知键回退 standard 全 1.0。
  // m 可显式传入（性能/测试路径）；缺省时经 HOST.S 正向引用读宿主槽位（83 高编号不受拓扑禁）。
  coeffs(m) {
    const mm = m || (HOST.S && HOST.S._mission);
    const d = (mm && mm.difficulty) || this.difficulty || 'standard';
    return DIFFICULTIES[d] || DIFFICULTIES.standard;
  }
  // —— 16-targets 系数读取口（每帧/结算时经 HOST.arcade 调，非逐帧扫描）——
  aaIntervalMul(m) { return this.coeffs(m).aaRate; }      // AA 开火间隔除以此值
  aaDamageMul(m)   { return this.coeffs(m).aaDmg; }       // 单发伤害乘以此值
  targetResMul(m)  { return this.coeffs(m).res; }         // 目标抗打击系数（hitTest 扣减用）
  timeoutMul(m)    { return this.coeffs(m).timeoutMul; }  // 70-app missionTimeout 读
  // 简报/面板难度 chips 渲染数据源（70/72 经此取键与名称——83 顶层表不跨文件引用）
  diffKeys()      { return Object.keys(DIFFICULTIES); }
  diffName(k)     { return (DIFFICULTIES[k] || DIFFICULTIES.standard).name; }
  // 成就定义表读取口（72 成就抽屉渲染；低编号模块不得直接引用 ACHIEVEMENTS）
  achList()       { return ACHIEVEMENTS; }
  get score()     { return this._score; }
  get combo()     { return this._combo; }

  // ---------- G2 任务生命周期钩子（70-app 调用） ----------
  onMissionStart() {
    this._score = 0; this._combo = 1; this._comboMax = 1;
    this._kills = 0; this._enemyKills = 0; this._achUnlocked = {};
    this._radarKilled = false;   // Phase 21：sead 判定源清零
    this._lastSeadBonus = 0;     // Phase 23：SEAD 结算奖励展示值清零
    this._comboExpire = -1;
  }
  // 击毁计分：typeKey = 目标 type 键（TARGET_SCORES 键表）；返回本次得分
  onKill(typeKey, m = null) {
    this._kills++;
    if (typeKey === 'enemy') this._enemyKills++;   // Phase 20-A：空战击落单独计数（ace 判定源）
    if (typeKey === 'radar') this._radarKilled = true;   // Phase 21：雷达摧毁（sead 判定源）
    // 窗口超时重置连击为 1（表示新的连击起点），否则 +1
    if (this._time >= this._comboExpire) {
      this._combo = 1;
    } else {
      this._combo++;
    }
    this._comboExpire = this._time + COMBO_WINDOW;
    const base = TARGET_SCORES[typeKey] || 100;
    const comboMul = Math.min(1 + COMBO_STEP * Math.min(this._combo - 1, 5), COMBO_CAP);
    // 使用传入的任务难度 m (可能为 null) 来读取系数；若 m 为 null，则回退到当前选定难度
    const gain = Math.round(base * this.coeffs(m).scoreMul * comboMul);
    this._score += gain;
    if (this._combo > this._comboMax) this._comboMax = this._combo;
    this._grantImmediate();          // S2：击杀类成就（首杀/连击/清场）即时 toast
    return gain;
  }
  // 任务结算（completeMission 调用）：
  // 基础 500 + 剩余弹药×5（受限变体 ×10）+ 无损伤(损伤<4) 200
  // + 快打(用时 < 时限 60%) 300，总 × 难度得分系数。failMission 不得分。
  onMissionDone(opts) {
    // 结算分值读本局快照难度（opts.difficulty 由 70-app 从 m.difficulty 组装），
    // 不得用全局当前档——任务中/结算后切面板不得改写本局结算结果。
    const c = this.coeffs(opts);
    let bonus = 500;
    bonus += (opts.ammoLeft || 0) * (opts.variant === 'limited_ammo' ? 10 : 5);
    if ((opts.damage || 0) < 4) bonus += 200;
    if (opts.elapsed < opts.missionTimeout * 0.6) bonus += 300;
    // Phase 23：SEAD 压制结算奖励——本局摧毁敌雷达（致盲防空）额外 +300，与其它
    // 奖励一并乘难度/风险系数。_radarKilled 由 onKill('radar') 置位、onMissionStart 清零
    const seadBase = this._radarKilled ? 300 : 0;
    bonus += seadBase;
    bonus = Math.round(bonus * c.scoreMul * (opts.damageMul || 1));   // Phase 19：战损风险回报系数（缺省 1 零变化）
    this._lastSeadBonus = Math.round(seadBase * c.scoreMul * (opts.damageMul || 1));   // 结算面板单列展示（0=未压制）
    this._score += bonus;
    this.noteVariant(opts.variant);
    this._maybePersistHi(opts.difficulty);
    this._checkAchievements(opts);
    return bonus;
  }
  // 失败：不得分、连击清零（本局已得击毁分保留）
  onMissionFailed() {
    this._combo = 1; this._comboExpire = -1;
  }
  // 70-app loop 每帧喂时间（连击窗口衰减；update 在 arcade 存在时调用）
  update(t) { this._time = t; }

  // ---------- G3 成就 ----------
  // 统一授予：cond 满足且本局未解锁则置位 + toast。单局制语义——成就可跨局重复解锁，
  // 故只查本局 _achUnlocked（不查 _achUnlockedAll；后者仅存跨局变体记录，非成就表，见 M2 修正）。
  _grant(id, cond) {
    if (!cond || this._achUnlocked[id]) return;
    this._achUnlocked[id] = true;
    if (ACH_PERSIST.includes(id)) this._persistAchUnlock(id);   // 跨局持久成就落盘
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a) toast('成就解锁：' + a.name);
  }
  _persistAchUnlock(id) {
    this._achPersist[id] = true;
    try {
      const keys = Object.keys(this._achPersist).filter(k => ACH_PERSIST.includes(k));
      localStorage.setItem('ah64_arcade_achv_persist', JSON.stringify(keys));
    } catch (e) { /* 隐私模式：内存降级 */ }
  }
  // 击杀时即时授予（S2）：首杀/连击×5/清场/空战王牌——这几项在游玩中即可判定，即时 toast；
  // 结算时 _checkAchievements 再幂等复核（防遗漏，已解锁不重复弹）。
  _grantImmediate() {
    this._grant('first_blood', this._kills > 0);
    this._grant('combo5', this._comboMax >= 5);
    this._grant('wipeout', this._kills >= 10);
    this._grant('ace', this._enemyKills > 0);   // Phase 20-A：击落 A2A 敌机
    this._grant('sead', !!this._radarKilled);   // Phase 21：摧毁敌雷达站
  }
  _checkAchievements(ctx) {
    // ctx（70-app completeMission 组装）：difficulty/damage/elapsed/variant/
    // grade/ammoLeftPct；kills 与 comboMax 用本局内部遥测（唯一事实源）
    const ctx2 = Object.assign({}, ctx, { kills: this._kills, comboMax: this._comboMax });
    this._grantImmediate();   // 幂等：击杀类结算时复核
    // 结果判定类（依赖最终时长/损伤/评级/弹药，游玩中不可预知）在结算时一次性授予
    this._grant('ghost', ctx2.difficulty === 'standard' && ctx2.damage < 4);
    this._grant('speedrun', ctx2.difficulty === 'standard' && ctx2.elapsed < 120);
    this._grant('frugal', ctx2.variant === 'limited_ammo' && ctx2.ammoLeftPct >= 50);
    this._grant('veteran_s', ctx2.difficulty === 'veteran' && ctx2.grade === 'S');
    this._grant('all_variants', this.allVariantsDone);
  }
  // 记录本局完成的变体（跨局累计；all_variants 判定源）
  noteVariant(variantKey) {
    if (!variantKey || this._achUnlockedAll[variantKey]) return;
    this._achUnlockedAll[variantKey] = true;
    this._persistAllVariants();
  }
  _loadPersisted() {
    try {
      const raw = localStorage.getItem('ah64_arcade_achv');
      if (raw) for (const k of JSON.parse(raw)) if (MISSION_VARIANT_KEYS.includes(k)) this._achUnlockedAll[k] = true;
      const p = JSON.parse(localStorage.getItem('ah64_arcade_achv_persist') || '[]');
      for (const id of p) if (ACH_PERSIST.includes(id)) { this._achPersist[id] = true; this._achUnlocked[id] = true; }
      for (const k of Object.keys(DIFFICULTIES)) {
        const v = parseInt(localStorage.getItem('ah64_arcade_hi_' + k) || '0', 10) || 0;
        if (v > 0) this._hi[k] = v;
      }
    } catch (e) { /* 隐私模式：内存降级（_hi 起步为 0） */ }
  }
  _persistAllVariants() {
    try {
      const keys = MISSION_VARIANT_KEYS.filter(k => this._achUnlockedAll[k]);
      localStorage.setItem('ah64_arcade_achv', JSON.stringify(keys));
    } catch (e) { /* 隐私模式静默降级内存 */ }
  }
  get allVariantsDone() {
    return MISSION_VARIANT_KEYS.every(k => this._achUnlockedAll[k]);
  }

  // ---------- 最高分（读合并内存与持久化两侧） ----------
  _maybePersistHi(diffKey) {
    const k = diffKey || this.difficulty;       // 本局快照难度决定最高分归属桶
    const key = 'ah64_arcade_hi_' + k;
    if (this._score <= this.hi(k)) return;
    this._hi[k] = this._score;
    try {
      const prev = parseInt(localStorage.getItem(key) || '0', 10) || 0;
      if (this._score > prev) localStorage.setItem(key, String(this._score));
    } catch (e) { /* 隐私模式：内存降级 */ }
  }
  hi(diffKey) {
    let v = this._hi[diffKey] || 0;
    try {
      const s = localStorage.getItem('ah64_arcade_hi_' + diffKey);
      if (s) v = Math.max(v, parseInt(s, 10) || 0);
    } catch (e) { /* 内存降级 */ }
    return v;
  }

  // 只读遥测（测试/调试出口；经 72-uibind __dbg.arcade 暴露；
  // 测试断言一律读此状态源，不解析截图）
  state() {
    return {
      difficulty: this.difficulty,
      score: this._score,
      combo: this._combo,
      comboMax: this._comboMax,
      kills: this._kills,
      enemyKills: this._enemyKills,
      hi: Object.assign({}, this._hi),
      unlocked: Object.keys(this._achUnlocked),
      unlockedAll: Object.keys(this._achUnlockedAll),
      allVariants: this.allVariantsDone,
      seadBonus: this._lastSeadBonus,   // Phase 23：上次结算 SEAD 压制奖励（0=未压制）
    };
  }
}

// 经 HOST 注册工厂——70-app（低编号）不得反向引用 83 的构造器（拓扑检查
// 硬规则），经宿主槽位取用（与 79/80/81 同款模式）。
HOST.makeArcade = () => new ArcadeModule();
