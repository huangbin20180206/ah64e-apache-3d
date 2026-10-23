// ============================================================
// 91-levels.js — 游戏模式关卡表 + 目标/星级判定（P2，2026-10-13）
// ============================================================
// 纯数据 + 纯函数：零 THREE、零 DOM（tests_pure 直接 new Function 求值）。
// 设计见 docs/design/2026-10-13-showcase-game-split.md §5。
//   · 4 章 13 关，id '章-序'。ready:false = P3 制作中（地图上显示、不可进入）。
//   · variant：落到 70-mission 的既有玩法（MISSION_VARIANTS 键）；关卡只描述
//     挑战参数，真正开局仍走 startMission(variant)——不复制第二套任务状态机。
//   · objectives：任务内目标清单（显示 + 判定快照）；完成判定仍由各 variant 的
//     既有逻辑负责，二者语义一一对应（test_levels 守护）。
//   · bonus：附加目标（结算时判定，决定是否能拿第三颗星）。
//   · stars：★ 通关；★★ 评级 ≥ stars.two；★★★ 评级 ≥ stars.three 且 bonus 全部完成。
// 拓扑：90+ 顶层符号不得被低编号引用——70 层经 HOST.levels 取用。
// ============================================================

const LEVEL_CHAPTERS = [
  { n: 1, name: '训练营', en: 'BOOT CAMP' },
  { n: 2, name: '基地防线', en: 'BASE DEFENSE' },
  { n: 3, name: '纵深打击', en: 'DEEP STRIKE' },
  { n: 4, name: '精英', en: 'ELITE' },
];

const LEVELS = [
  // —— 第一章 · 训练营（P3：每关只教一件事；靶场不还击，没有敌机） ——
  { id: '1-1', chapter: 1, name: '首飞', ready: true, variant: 'train_flight', mech: '飞行基础',
    scene: { env: 'day', weather: 'none' }, timeout: 600,
    intro: '第一次上机。启动旋翼、起飞，依次穿过三个航点圈，在悬停区稳住 10 秒，再回停机坪降落。',
    objectives: [{ type: 'rings', label: '依次穿过 3 个航点圈' },
                 { type: 'hover', label: '在悬停区稳住 10 秒' },
                 { type: 'land', label: '返回停机坪降落' }],
    bonus: [{ type: 'time_under', v: 120, label: '2 分钟内完成' }],
    stars: { two: 'A', three: 'S' } },
  { id: '1-2', chapter: 1, name: '机炮与火箭', ready: true, variant: 'train_weapons', mech: '两种武器',
    scene: { env: 'day', weather: 'none' }, timeout: 600,
    intro: '靶场里停着 4 辆卡车和 2 个油桶，不会还击。用 30mm 链炮打卡车，用 70mm 火箭打油桶。',
    objectives: [{ type: 'destroy_all', label: '摧毁 6 个静止靶' }],
    bonus: [{ type: 'min_acc', v: 0.35, label: '命中率不低于 35%' }],
    stars: { two: 'B', three: 'A' } },
  { id: '1-3', chapter: 1, name: '地狱火', ready: true, variant: 'train_hellfire', mech: '锁定 · 动目标',
    scene: { env: 'day', weather: 'none' }, timeout: 300,
    intro: '三辆坦克在靶场里来回机动。把它们放进准星锁定，用地狱火逐一点名。',
    objectives: [{ type: 'destroy_all', label: '摧毁 3 辆移动坦克' }],
    bonus: [{ type: 'hellfire_only', label: '只用地狱火（不开机炮和火箭）' }],
    stars: { two: 'B', three: 'A' } },
  { id: '1-4', chapter: 1, name: '绞车救援', ready: true, variant: 'train_rescue', mech: '绞车 · 扬尘',
    scene: { env: 'day', weather: 'none' }, timeout: 300,
    intro: '一名飞行员在沙漠里等待救援。顺着烟柱找到他，在扬尘里稳住悬停放下绞车，把他送回停机坪。',
    objectives: [{ type: 'rescue', label: '救起幸存者并送抵停机坪' }],
    bonus: [{ type: 'time_under', v: 150, label: '2 分 30 秒内完成' }],
    stars: { two: 'A', three: 'S' } },

  // —— 第二章 · 基地防线 ——
  { id: '2-1', chapter: 2, name: '初次出击', ready: true, variant: 'standard', mech: '完整任务',
    unlockAfter: '1-1',   // 首飞通过即可进实战——其余训练关可跳过
    scene: { env: 'day', weather: 'none' }, timeout: 360,
    intro: '敌军在停机坪侧前方约 25u 建了一个前哨：两辆坦克守着，两辆补给卡车在前哨和公路之间来回跑。跟着目标指示找过去，清掉全部 8 个目标。',
    objectives: [{ type: 'destroy_all', label: '摧毁前哨与补给车队' }],
    // P3c：独立布场——西侧前哨（坦克 2/卡车 2/油桶 2）+ 公路环线补给车 2；不出敌机
    layout: { noAir: true, brief: '前哨 6 个（坦克 2 · 卡车 2 · 油桶 2）+ 公路补给卡车 2', goal: '摧毁前哨与补给车队全部 8 个目标',
      hint: '先打公路上来回跑的补给车，免得它们跑远；前哨坦克会还击，保持 20u 以上距离用火箭和地狱火', units: [
      { type: 'tank', x: -24, z: 10 },
      { type: 'tank', x: -18, z: 16, mov: { kind: 'line', a: 0, half: 4, v: 1.3 } },
      { type: 'truck', x: -27, z: 15, ry: 2.2 },
      { type: 'truck', x: -21, z: 6, ry: 1.4 },
      { type: 'truck', x: -14, z: 22, mov: { kind: 'path', loop: [[-4, 29], [8, 27], [2, 14], [-14, 22]], vmax: 2.2 } },
      { type: 'truck', x: 2, z: 14, mov: { kind: 'path', loop: [[-14, 22], [-4, 29], [8, 27], [2, 14]], vmax: 2.2 } },
      { type: 'barrel', x: -26, z: 7 }, { type: 'barrel', x: -23, z: 19 },
    ] },
    bonus: [{ type: 'max_damage', v: 3, label: '机体损伤不超过 3' }],
    stars: { two: 'B', three: 'A' } },
  { id: '2-2', chapter: 2, name: '黄金时段', ready: true, variant: 'timed_rescue', mech: '双目标',
    scene: { env: 'dusk', weather: 'none' }, timeout: 240,
    intro: '友军飞行员跳伞落在停机坪侧方，三辆敌军卡车正绕着他搜捕，两辆坦克在外围封锁。天黑前清掉搜捕部队，把他救回停机坪。',
    objectives: [{ type: 'destroy_all', label: '摧毁搜捕部队' },
                 { type: 'rescue', label: '救起幸存者并送抵停机坪' }],
    bonus: [{ type: 'time_under', v: 180, label: '3 分钟内完成' }],
    // P3c：幸存者改到 (22,8)；卡车 3 辆绕他搜捕（r7，相位错开），坦克 2 辆外围折返封锁；不出敌机
    layout: { noAir: true, brief: '搜捕卡车 3（绕着幸存者转）· 外围坦克 2 · 油桶 1', goal: '摧毁全部 6 个搜捕目标 + 救起幸存者送回停机坪',
      hint: '卡车绕着幸存者转圈，开火时别把炮口对着人；先清卡车再下去放绞车', rescueAt: { x: 22, z: 8 }, units: [
      { type: 'truck', x: 29, z: 8, mov: { kind: 'circle', cx: 22, cz: 8, r: 7, w: 0.32, ph: 0 } },
      { type: 'truck', x: 22, z: 15, mov: { kind: 'circle', cx: 22, cz: 8, r: 7, w: 0.32, ph: 2.1 } },
      { type: 'truck', x: 15, z: 8, mov: { kind: 'circle', cx: 22, cz: 8, r: 7, w: 0.32, ph: 4.2 } },
      { type: 'tank', x: 34, z: 3, mov: { kind: 'line', a: 0.3, half: 5, v: 1.2 } },   // game5：原 (10,2) 折返时离停机坪只剩 ~5u，移到幸存者外侧
      { type: 'tank', x: 14, z: 20, mov: { kind: 'line', a: 1.9, half: 4, v: 1.0 } },
      { type: 'barrel', x: 18, z: 15 },
    ] },
    stars: { two: 'B', three: 'A' } },
  { id: '2-3', threat: 0.9, chapter: 2, name: '精打细算', ready: true, variant: 'limited_ammo', mech: '弹药 · 燃油管理',
    scene: { env: 'day', weather: 'none' }, timeout: 360,
    intro: '补给线被切断，机炮和火箭只有一半。敌方油料车队挤在一处加油，三辆坦克却分散布防。每一发都要算清楚。',
    objectives: [{ type: 'destroy_all', label: '弹药减半下摧毁全部目标' }],
    bonus: [{ type: 'min_acc', v: 0.4, label: '命中率不低于 40%' }],
    // P3c：效率关——加油点 5 个目标挤在 2.5u 内（火箭溅射 2.8u + 油桶殉爆连锁），
    // 3 辆坦克分散在三个方向（逼你留地狱火），2 辆卡车往返巡逻（考验机炮点射）
    layout: { brief: '加油点（卡车 2 · 油桶 3，挤在一起）· 分散坦克 3 · 巡逻卡车 2', goal: '弹药减半下摧毁全部 10 个目标',
      hint: '先用一发火箭打加油点中心，溅射加油桶殉爆能一次清掉一片；地狱火留给三辆坦克', units: [
      { type: 'barrel', x: 17, z: 17 }, { type: 'barrel', x: 19, z: 18.2 }, { type: 'barrel', x: 17.8, z: 19.6 },
      { type: 'truck', x: 15.6, z: 19.2, ry: 0.9 }, { type: 'truck', x: 20.2, z: 16.2, ry: -2.3 },
      { type: 'tank', x: -20, z: 6 }, { type: 'tank', x: -6, z: 27 }, { type: 'tank', x: 26, z: 4 },
      { type: 'truck', x: -14, z: 18, mov: { kind: 'line', a: 1.2, half: 6, v: 1.6 } },
      { type: 'truck', x: 4, z: 22, mov: { kind: 'line', a: -0.4, half: 5, v: 1.3 } },
    ] },
    stars: { two: 'B', three: 'A' } },

  // —— 第三章 · 纵深打击 ——
  { id: '3-1', threat: 1.1, chapter: 3, name: '压制防空', ready: true, variant: 'sead_strike', mech: 'SAM · RWR · 干扰弹',
    scene: { env: 'day', weather: 'none' }, timeout: 360,
    intro: '雷达站在给整片阵地的防空火力做引导，雷达活着时地面火力明显更密。先打瞎雷达和防空发射车，再清剿护卫坦克和补给车队。',
    // P3c：护卫坦克各守雷达/防空车 + 一辆中线折返；补给卡车 2 辆绕阵地环线、2 辆停在防空车旁；
    // 油桶围着弹药库（殉爆连锁）。2026-10-15 基地 z 42→75（05-config BASE_C），本关坐标同步 +33。radarFlak：雷达存活时 AA 频率 ×1.45，致盲后 ×0.6
    layout: { radarFlak: true, brief: '雷达站 · 防空车 · 弹药库 + 护卫坦克 3 · 补给卡车 4 · 油桶 3', goal: '摧毁雷达站与防空发射车，并清剿全部 10 个地面目标',
      hint: '雷达活着时地面火力更密，先从侧面打雷达；油桶围着弹药库，一发火箭能连锁殉爆', units: [
      { type: 'tank', x: 14, z: 65 }, { type: 'tank', x: -19, z: 76 },
      { type: 'tank', x: 0, z: 69, mov: { kind: 'line', a: Math.PI / 2, half: 8, v: 1.4 } },
      { type: 'truck', x: -12, z: 69, mov: { kind: 'path', loop: [[4, 63], [20, 63], [20, 77], [-8, 83], [-12, 69]], vmax: 2.0 } },
      { type: 'truck', x: 20, z: 77, mov: { kind: 'path', loop: [[-8, 83], [-12, 69], [4, 63], [20, 63], [20, 77]], vmax: 2.0 } },
      { type: 'truck', x: 16, z: 70 }, { type: 'truck', x: 8, z: 73 },
      { type: 'barrel', x: -8, z: 74 }, { type: 'barrel', x: -13, z: 70 }, { type: 'barrel', x: -9, z: 69 },
    ] },
    objectives: [{ type: 'sead', label: '摧毁雷达站与防空发射车' },
                 { type: 'destroy_all', label: '清剿全部地面目标' }],
    bonus: [{ type: 'max_damage', v: 3, label: '机体损伤不超过 3' }],
    stars: { two: 'B', three: 'A' } },
  { id: '3-2', chapter: 3, name: '制空作战', ready: true, variant: 'air_superiority', mech: '空战',
    scene: { env: 'dusk', weather: 'none' }, timeout: 300,
    intro: '敌方武装直升机分三波来袭，巡逻圈在停机坪侧前方，下面还有两辆防空车会在你缠斗时打冷枪。咬住敌机，一架都别放跑。',
    objectives: [{ type: 'shoot_down', v: 6, label: '击落来袭敌机 6 架' }],
    bonus: [{ type: 'max_damage', v: 2, label: '机体损伤不超过 2' }],
    // P3c：空战关——敌机巡逻锚点移出基地到 (-16,22)；地面只剩 2 辆防空卡车在锚点下方
    //（不计完成条件，可打可不打），其余目标下场
    layout: { airAnchor: { x: -16, z: 22 }, brief: '来袭敌机 6 架（3 波）· 地面防空车 2（可选）', goal: '击落 6 架来袭敌机',
      hint: '先俯冲拔掉两辆防空车再上去缠斗会轻松很多；敌机绕圈时从它外侧切进去', units: [
      { type: 'truck', x: -20, z: 18, ry: 0.6 },
      { type: 'truck', x: -11, z: 26, mov: { kind: 'circle', cx: -14, cz: 23, r: 4, w: 0.3, ph: 0.8 } },
    ] },
    stars: { two: 'B', three: 'A' } },
  { id: '3-3', threat: 0.9, chapter: 3, name: '城镇突击', ready: true, variant: 'urban_strike', mech: '遮挡 · 可摧毁建筑',
    scene: { env: 'day', weather: 'none' }, timeout: 420,
    intro: '残敌退进基地北侧的小镇，躲在楼后伺机探头。等它露头，或者把楼一起炸塌。',
    objectives: [{ type: 'destroy_all', label: '摧毁基地 10 目标与城镇 5 辆伏兵' }],
    bonus: [{ type: 'max_damage', v: 3, label: '机体损伤不超过 3' }],
    stars: { two: 'B', three: 'A' } },

  // —— 第四章 · 精英 ——
  { id: '4-1', chapter: 4, name: '峡谷突防', ready: true, variant: 'canyon_run', mech: '贴地飞行 · 雷达暴露',
    scene: { env: 'dusk', weather: 'none' }, timeout: 480,
    intro: '从峡谷南端潜入，贴着谷底飞。高过崖顶就会被雷达盯上。',
    objectives: [{ type: 'destroy_all', label: '摧毁峡谷 6 辆伏兵与基地 10 目标' }],
    bonus: [{ type: 'no_wall_strike', label: '旋翼零擦碰岩壁' }],
    stars: { two: 'A', three: 'S' } },
  { id: '4-2', threat: 1.6, chapter: 4, name: '夜幕雷暴', ready: true, variant: 'standard', mech: '夜战 · 复合威胁',
    scene: { env: 'night', weather: 'storm' }, timeout: 360,
    intro: '雷暴夜，一支装甲纵队借着雨幕在东侧环线上机动，西侧是它们的宿营地。敌机在云下巡逻。靠夜视和闪电的间隙把纵队和营地一起端掉。',
    objectives: [{ type: 'destroy_all', label: '摧毁装甲纵队与宿营地' }],
    // P3c：夜战关——3 辆坦克沿东侧环线成纵队机动（同一条路、错开入口）；西侧宿营地卡车 4 + 油桶 3
    layout: { brief: '移动装甲纵队 3（东侧环线）· 宿营地卡车 4 · 油桶 3 · 巡逻敌机', goal: '摧毁纵队与宿营地全部 10 个目标',
      hint: '纵队一直在动，用地狱火锁定最稳；营地油桶会殉爆，闪电亮起时最好找目标', units: [
      { type: 'tank', x: 10, z: 10, mov: { kind: 'path', loop: [[25, 14], [21, 27], [5, 25], [10, 10]], vmax: 1.5 } },
      { type: 'tank', x: 25, z: 14, mov: { kind: 'path', loop: [[21, 27], [5, 25], [10, 10], [25, 14]], vmax: 1.5 } },
      { type: 'tank', x: 21, z: 27, mov: { kind: 'path', loop: [[5, 25], [10, 10], [25, 14], [21, 27]], vmax: 1.5 } },
      { type: 'truck', x: -22, z: 12, ry: 0.3 }, { type: 'truck', x: -18, z: 15, ry: 1.1 },
      { type: 'truck', x: -24, z: 17, ry: 2.0 }, { type: 'truck', x: -16, z: 10, ry: -0.4 },
      { type: 'barrel', x: -20, z: 13.5 }, { type: 'barrel', x: -21.5, z: 15 }, { type: 'barrel', x: -19, z: 11.5 },
    ] },
    bonus: [{ type: 'shoot_down', v: 2, label: '顺手击落 2 架巡逻敌机' }],
    stars: { two: 'A', three: 'S' } },
  { id: '4-3', threat: 1.6, chapter: 4, name: '终关 · 斩首', ready: true, variant: 'finale', mech: '多阶段任务',
    scene: { env: 'dusk', weather: 'none' }, timeout: 720,
    intro: '最后一仗。先敲掉雷达站和防空发射车致盲基地，敌机会随即升空拦截；清剿基地后，把被俘的飞行员救出来带回家。',
    objectives: [{ type: 'phase', n: 1, label: '阶段一：摧毁雷达站和防空发射车' },
                 { type: 'phase', n: 2, label: '阶段二：清剿基地，击退拦截敌机' },
                 { type: 'phase', n: 3, label: '阶段三：救出被俘飞行员送回停机坪' }],
    bonus: [{ type: 'max_damage', v: 4, label: '机体损伤不超过 4' },
            { type: 'shoot_down', v: 2, label: '击落 2 架敌机' }],
    stars: { two: 'B', three: 'A' } },
];

const GRADE_RANK = { S: 0, A: 1, B: 2, C: 3 };

function levelById(id) { return LEVELS.find(L => L.id === id) || null; }
function levelsReady() { return LEVELS.filter(L => L.ready); }
// 关卡在统一序列里的前一个可玩关（解锁链只沿 ready 关前进）
function levelPrevReady(id) {
  const self = levelById(id);
  if (self && self.unlockAfter) return levelById(self.unlockAfter);
  const R = levelsReady();
  const i = R.findIndex(L => L.id === id);
  return i > 0 ? R[i - 1] : null;
}

// 结算附加目标判定。ctx = { damage, acc(0..1), elapsed, fuelPct, airKills, wallStrikes }
function levelBonus(L, ctx) {
  const c = ctx || {};
  return (L && L.bonus ? L.bonus : []).map(b => {
    let ok = false;
    if (b.type === 'max_damage') ok = (c.damage || 0) <= b.v;
    else if (b.type === 'min_acc') ok = (c.acc || 0) >= b.v;
    else if (b.type === 'time_under') ok = (c.elapsed == null ? Infinity : c.elapsed) < b.v;
    else if (b.type === 'shoot_down') ok = (c.airKills || 0) >= b.v;
    else if (b.type === 'no_wall_strike') ok = (c.wallStrikes || 0) === 0;
    else if (b.type === 'hellfire_only') ok = (c.gunUsed || 0) === 0 && (c.rkUsed || 0) === 0;
    else if (b.type === 'min_fuel') ok = (c.fuelPct == null ? 100 : c.fuelPct) >= b.v;
    return { label: b.label, ok };
  });
}

// 星级：通关即 1 星；评级达门槛 2 星；评级达三星门槛且 bonus 全完成 3 星
function levelStars(L, grade, bonusAllOk) {
  if (!L || !(grade in GRADE_RANK)) return 0;
  const st = L.stars || { two: 'B', three: 'A' };
  let n = 1;
  if (GRADE_RANK[grade] <= GRADE_RANK[st.two]) n = 2;
  if (n === 2 && GRADE_RANK[grade] <= GRADE_RANK[st.three] && bonusAllOk) n = 3;
  return n;
}

// 任务内目标清单快照。snap = { alive, total, rescued, seadDone, airKills }
function levelObjectives(L, snap) {
  const s = snap || {};
  return (L && L.objectives ? L.objectives : []).map(o => {
    let ok = false, prog = '';
    if (o.type === 'destroy_all') { ok = s.total > 0 && s.alive === 0; prog = (s.total - s.alive) + '/' + s.total; }
    else if (o.type === 'rescue') ok = !!s.rescued;
    else if (o.type === 'sead') ok = !!s.seadDone;
    else if (o.type === 'phase') {
      const st = s.finStage || 0; ok = st > o.n;
      if (st === o.n && o.n === 2) prog = '地面 ' + (s.alive || 0) + ' · 敌机 ' + (s.finAir || 0);
      else if (st < o.n) prog = '未开始';
    }
    else if (o.type === 'rings') { const st = s.course ? s.course.stage : 0; ok = st >= 3; prog = Math.min(3, st) + '/3'; }
    else if (o.type === 'hover') { const st = s.course ? s.course.stage : 0; ok = st >= 4; if (st === 3) prog = s.course.hoverT.toFixed(0) + '/10s'; }
    else if (o.type === 'land') ok = !!(s.course && s.course.stage >= 5);
    else if (o.type === 'shoot_down') { ok = (s.airKills || 0) >= o.v; prog = Math.min(o.v, s.airKills || 0) + '/' + o.v; }
    return { label: o.label, ok, prog };
  });
}

// 经 HOST 暴露（70 层低编号只能经宿主取用）
HOST.levels = { chapters: LEVEL_CHAPTERS, list: LEVELS, byId: levelById, ready: levelsReady,
  prevReady: levelPrevReady, bonus: levelBonus, stars: levelStars, objectives: levelObjectives };
