// ============================================================
// 70-mission.js — 任务系统：变体/难度/战役 chip、简报、面板、结算、训练引导
// ============================================================
// 2026-10-12 自 70-app.js 拆出（纯搬移 + 帧逻辑提成具名函数，行为不变）。
// 同前缀 70-* 文件在拓扑检查里同级（互引不算反向引用），拼接顺序按文件名。

// ---------- 任务面板（P2-2：简报→实时战况→结算；P6 统一任务状态机） ----------
// S._mission 唯一任务状态源：phase=briefing|active|done|failed；done 保留（兼容
// 既有断言）；frozen 冻结结算面板（后续时间/切场不漂移）；failedReason 记失败原因。
// 所有进度/统计从 targets/rig 状态源实时推导，不落 DOM 反推。
function fmtMissionTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
}
function missionRating(elapsed, acc) {
  if (elapsed < 150 && acc >= 0.5) return 'S';
  if (elapsed < 240 && acc >= 0.35) return 'A';
  if (elapsed < 420 && acc >= 0.2) return 'B';
  return 'C';
}
// 任务超时（秒）：超过即失败（P6 新增失败路径——此前只有成功无失败）
const MISSION_TIMEOUT = 360;
// Phase 11 C1/C2：任务挑战变体——统一状态机 S._mission 上的 variant 标记，
// 不新建第二套状态机/评级系统（missionRating() 全变体共用一条曲线）。
// 各变体只改：简报文案、弹药初始、时限、完成条件四件事。
const MISSION_VARIANTS = {
  standard:     { name: '标准任务', timeout: 360, goal: '摧毁全部 10 个目标' },
  timed_rescue: { name: '限时救援', timeout: 240, goal: '摧毁全部目标 + 至少完成 1 次救援' },
  limited_ammo: { name: '受限弹药', timeout: 360, goal: '弹药减半下摧毁全部目标' },
  // Phase 24：SEAD 变体——完成条件在标准全歼之上追加「摧毁雷达站+防空发射车」。
  // 不计入 all_variants（MISSION_VARIANT_KEYS 保持 3 核心，既有「全能」成就语义不变）。
  sead_strike:  { name: '压制防空', timeout: 360, goal: '摧毁敌雷达站+防空发射车（SEAD）并清剿全部地面目标' },
  // C005：制空作战——胜利条件与地面目标**完全无关**（击落全部来袭敌机），故其
  // 完成判定不挂在 aliveCount===0 上，而是 loop 内的独立并列判定（见下方注释）。
  // 同样不计入 all_variants（MISSION_VARIANT_KEYS 保持 3 核心，仿 SEAD 先例）。
  air_superiority: { name: '制空作战', timeout: 300, goal: '击落全部来袭敌机' },
  // 玩法批 C（2026-10-12）：城镇突击——基地北侧小城镇（10 栋可炸塌建筑 + 5 辆楼后伏兵）。
  // 完成条件仍是 aliveCount===0（伏兵挂进同一 targets 数组），不计入 all_variants。
  urban_strike: { name: '城镇突击', timeout: 420, goal: '摧毁基地 10 个目标 + 城镇 5 辆伏兵（楼后伏兵会探头开火，楼可炸塌）' },
  // 玩法批 D（2026-10-12）：峡谷突防——从峡谷南端出发贴谷底飞，崖顶雷达盯着高于
  // 崖顶的直升机。完成条件仍是 aliveCount===0（峡谷伏兵挂进同一 targets 数组），不计入 all_variants。
  canyon_run: { name: '峡谷突防', timeout: 480, goal: '摧毁峡谷 6 辆伏兵 + 基地 10 个目标（高于崖顶会被雷达锁定）' },
  // P3（2026-10-13）：训练营 4 关。train=true：靶场不还击（targets.passive）、不放敌机、
  // 起飞即开始计时；bench = targets.applyTraining 的布场方式。旧版 chips 不列出它们
  //（只从游戏模式关卡表进入），all_variants 成就不计。
  // P3（2026-10-13）：终关 4-3 三阶段——①致盲（雷达+防空车）②清场（地面全歼+击退升空拦截的敌机）
  // ③救出被俘飞行员送回停机坪。noAirStart：开局不放敌机（阶段二才升空）；par：评级用时折算系数
  finale: { name: '终关 · 斩首', timeout: 720, noAirStart: true, levelOnly: true, par: 2.6,
    goal: '三阶段：致盲防空 → 清剿基地并击退拦截敌机 → 救出被俘飞行员' },
  train_flight:   { name: '首飞训练', timeout: 600, train: true, bench: 'none', noCombat: true,
    goal: '穿过 3 个航点圈 → 在悬停区稳住 10 秒 → 回停机坪降落' },
  train_weapons:  { name: '武器训练', timeout: 600, train: true, bench: 'static6',
    goal: '用机炮和火箭摧毁 6 个静止靶（靶场不还击）' },
  train_hellfire: { name: '地狱火训练', timeout: 300, train: true, bench: 'tanks3',
    goal: '锁定并摧毁 3 辆移动中的坦克' },
  train_rescue:   { name: '救援训练', timeout: 300, train: true, bench: 'none', noCombat: true,
    goal: '找到幸存者，悬停放下绞车救起，送回停机坪' },
};
// C005 制空作战：波次耐力战（每波 2 架并发 × 3 波 = 总 6 击落）。
// 复用 87 既有 2 单元（ENEMYCFG.N=2 是编队结构，不许改），当前波被打光且未满
// AIRSUP_KILLS 时再调一次 spawn 开下一波——零结构改动、不新增单元。
const AIRSUP_KILLS = 6;
const AIRSUP_WAVES = 3;
// 当前波是否已被"打光"：两架都 phase==='down'（被击落）。
// **撤离退场不算打光**——老黄 2026-09-20 拍板"退场就退场吧，不要再回来了，正常
// 游戏逻辑"：withdraw 出界的敌机（on=false，phase 仍为 'withdraw'）永久退场，
// 不得以"满血新波"的形式回来（否则逃逸等于白逃）。代价：逃逸过多则本局凑不满
// 6 击落，按正常逻辑超时判负；逃机在出界前仍可被追击击落（玩家须咬住）。
// 读注入的 enemyAir 引用（拓扑：70 低编号不得静态引用 87），不反向 import。
function _airWaveCleared() {
  if (!enemyAir || !enemyAir.units || !enemyAir.units.length) return false;
  return enemyAir.units.every(u => u.phase === 'down');
}
// 制空作战续波锚点 = 与首波同一锚点（startMission 时快照靶场 baseCenter，
// 靶场重建也不漂移）。缺失时回退 baseCenter，再回退默认基地坐标。
function _airSupAnchor() {
  const m = S._mission;
  if (m && m._airAnchor) return m._airAnchor;
  if (targets && targets.baseCenter) return targets.baseCenter;
  return { x: BASE_C.x, z: BASE_C.z };
}
// Phase 24：SEAD 变体目标达成判定——雷达与防空发射车均已摧毁（读 81 的 state()
// 公开遥测，不反向引用 81 内部；无叙事层时不阻塞完成）。函数声明会提升，供上方
// loop 完成判定调用。
// P3 终关：阶段推进（只进不退）。1 致盲 → 2 清场（进入时敌机升空）→ 3 救援（进入时
// 被俘飞行员出现在基地西侧）→ 4 完成。阶段 1-2 期间救援目标隐藏且不可作业（rescue.ok=false）。
const FINALE_POW = { x: -14, z: BASE_C.z + 8 };   // 基地西北侧（BASE_C 相对，旧绝对值 (-14,50)=BC+8）
function _placeRescue(x, z) {
  if (!rescue) return;
  rescue._home = { x, z };
  rescue.g.position.set(x, 0, z);
  rescue.smoke.position.set(x, 2.4, z);
  rescue.beacon.position.set(x + 0.45, 0.07, z + 0.3);   // 与 48-rescue 一致：频闪灯在人身旁
}
// P3c：雷达联动防空——雷达活着时基地火力更密，致盲后明显稀疏（3-1）
function _tickLevelThreat() {
  const m = S._mission;
  const LVd = m && m.levelId && HOST.levels ? HOST.levels.byId(m.levelId) : null;
  if (!LVd || !LVd.layout || !targets) return;
  if (LVd.layout.radarFlak) targets.aaRateMul = (narrative && narrative.radarAlive()) ? 1.45 : 0.6;
}
function _tickFinale() {
  const m = S._mission;
  if (!m._fin) m._fin = 1;
  if (rescue && m._fin < 3 && rescue.state === 'idle') {
    rescue.ok = false;
    rescue.g.visible = rescue.smoke.visible = rescue.beacon.visible = false;
  }
  if (m._fin === 1 && _seadObjectiveDone()) {
    m._fin = 2;
    if (enemyAir) { enemyAir.spawn(_airSupAnchor()); m._finAir = true; }
    toast('阶段一完成：防空已致盲——敌机升空拦截！击退敌机并清剿基地');
    if (betty) betty.warn('BANDITS', 3);
    if (music) music.brass();
  } else if (m._fin === 2 && targets.aliveCount === 0 &&
             (!enemyAir || !m._finAir || enemyAir.units.every(u => !u.on))) {
    m._fin = 3;
    if (rescue) { rescue.resetRound('desert'); _placeRescue(FINALE_POW.x, FINALE_POW.z); }
    toast('阶段二完成：基地已肃清——被俘飞行员在基地西侧（看烟柱），救出并送回停机坪');
    if (music) music.brass();
  } else if (m._fin === 3 && rescue && rescue.state === 'delivered') {
    m._fin = 4;
  }
}
function _seadObjectiveDone() {
  if (!narrative) return true;
  const st = narrative.state();
  const sam = st.strikes.find(s => s.key === 'sam');
  return !st.radarAlive && !!sam && !sam.alive;
}
function missionVariant() {
  const m = S._mission;
  return (m && MISSION_VARIANTS[m.variant]) ? MISSION_VARIANTS[m.variant] : MISSION_VARIANTS.standard;
}
function missionTimeout() {
  // Phase 18：变体时限 × 难度时限系数（standard ×1 原值不变；rookie 宽、veteran 紧）。
  // 系数读任务快照 m.difficulty（startMission 时冻结，任务中/结算后不随面板切换）；
  // 快照缺失时回退当前选定难度（coeffs() 内部处理）。
  const mul = arcade ? arcade.timeoutMul(S._mission) : 1;
  return missionVariant().timeout * mul;
}

// Phase 11 T1/T3：训练分步引导（S._train 1..5，0=关）。步骤表 = 提示文案，
// 完成判定全部复用 __dbg 既有状态源（S.running/S.spin/FLY.state/rig.gunAmmo/
// rescue.state），提示走既有 toast 通道（HOST.toast），不新建浮层。
const TRAIN_STEPS = [
  '按 空格 启动旋翼',
  '按 T 起飞至悬停',
  '按 C 进座舱观察（或拖拽画面环绕）',
  '按住 G 机炮射击（或鼠标左键）',
  '切到草地/沙漠场地，飞近幸存者按 K 放绞车',
];
const TRAIN_NUM = '①②③④⑤';
// T4：prefers-reduced-motion 时训练提示停留 8s（正常 4s）；判定推进不受影响
function trainToastMs() {
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  return reduce ? 8000 : 4000;
}
function trainAdvance() {
  S._train++;
  if (S._train === 4) S._trainGun0 = rig ? rig.gunAmmo : 0;   // ④ 弹药基准=进入该步时快照
  toast('训练 ' + TRAIN_NUM[S._train - 1] + '/⑤ ' + TRAIN_STEPS[S._train - 1], trainToastMs());
}
function trainFinish() {
  S._train = 0;
  S._trainFp = S._trainOrbit = S._trainRescue = false;
  try { localStorage.setItem('ah64_train', '5'); } catch (e) {}   // T5：记录已完成（可重入时提示"重新训练"）
  toast('训练完成——可切到任务模式挑战实战', trainToastMs());
}
function showMissionBriefing() {
  const mp = UI('mission');
  // Phase 11 C1：简报阶段允许交互（变体 chip 选择），其余阶段保持
  // pointer-events:none（P4-B 纯只读展示契约——既有断言按非简报态读取不变）
  mp.classList.add('briefing');
  renderCampaignChips();
  renderVariantChips();
  renderDiffChips();
  renderBriefing();
  mp.classList.add('show');
}
// Phase 20-D：战役关卡 chips（旧战役 6 关解锁链，见 90-campaign CAMPAIGN_LEVELS；动态渲染照 renderVariantChips
// 先例自补可访问性——enhanceA11y 静态扫描覆盖不到动态 DOM）。选中关卡经
// startCampaign 快照难度进入对应变体；锁定关卡 disabled+锁标（前关达 B 解锁）。
function renderCampaignChips() {
  const row = UI('mission-campaign'); if (!row) return;
  if (!campaign) { row.innerHTML = ''; return; }
  const st = campaign.state();
  const cur = S._mission && S._mission.levelIdx != null ? S._mission.levelIdx : -1;
  row.innerHTML = '';
  campaign.levels.forEach((L, i) => {
    const c = document.createElement('div');
    const open = campaign.canPlay(i);
    c.className = 'chip' + (i === cur ? ' on' : '') + (open ? '' : ' locked');
    c.dataset.campaign = i;
    c.setAttribute('role', 'radio');
    c.setAttribute('aria-checked', i === cur ? 'true' : 'false');
    c.setAttribute('aria-disabled', open ? 'false' : 'true');
    c.setAttribute('aria-label', (open ? '战役关卡：' : '未解锁关卡：') + L.name);
    c.textContent = (open ? '' : '🔒') + L.name.split(' · ')[0];
    c.tabIndex = open ? 0 : -1;
    if (open) {
      c.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); e.stopPropagation();
        c.click();
      });
      c.onclick = () => startCampaign(i);
    }
    row.appendChild(c);
  });
}
// 变体 chip（role=radio 组，radiogroup 语义 + 方向键切换在 72-uibind 处理；
// 动态渲染的 chip 不在 enhanceA11y 静态扫描范围，这里补全可访问性属性：
// aria-pressed 满足 X4 断言、tabindex/Enter/空格键盘激活满足纯键盘可达）
function renderVariantChips() {
  const row = UI('mission-variants'); if (!row) return;
  const cur = (S._mission && S._mission.variant) || 'standard';
  row.innerHTML = '';
  for (const k of Object.keys(MISSION_VARIANTS)) {
    if (MISSION_VARIANTS[k].train || MISSION_VARIANTS[k].levelOnly) continue;     // P3：训练关/终关只从关卡表进入
    const c = document.createElement('div');
    c.className = 'chip' + (k === cur ? ' on' : '');
    c.dataset.variant = k;
    c.setAttribute('role', 'radio');
    c.setAttribute('aria-checked', k === cur ? 'true' : 'false');
    c.setAttribute('aria-pressed', k === cur ? 'true' : 'false');
    c.setAttribute('aria-label', '任务变体：' + MISSION_VARIANTS[k].name);
    c.textContent = MISSION_VARIANTS[k].name;
    c.tabIndex = 0;
    c.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation();
      c.click();
    });
    c.onclick = () => setMissionVariant(k);
    row.appendChild(c);
  }
}
// 选中变体：标记 S._mission.variant + 应用弹药 + 重绘 chips/简报（唯一入口）
function setMissionVariant(k) {
  const m = S._mission;
  if (!m || !MISSION_VARIANTS[k]) return;
  m.variant = k;
  applyVariantAmmo();
  renderVariantChips();
  renderBriefing();
  toast('任务变体：' + MISSION_VARIANTS[k].name);
}
// Phase 18：难度 chip（仅简报阶段可选；与变体 chip 同渲染/同数据源模式）。
// 难度存 arcade.difficulty，startMission 快照进 S._mission.difficulty 冻结本局；
// 非简报阶段点击 = 选择"下一局生效"（面板 briefing 态 class 已 gate pointer-events）
function renderDiffChips() {
  const row = UI('mission-difficulties'); if (!row) return;
  if (!arcade) return;                  // 工厂槽未就绪（finish 前）不渲染
  const cur = arcade.difficulty || 'standard';
  row.innerHTML = '';
  for (const k of (arcade ? arcade.diffKeys() : ['standard'])) {
    const c = document.createElement('div');
    c.className = 'chip' + (k === cur ? ' on' : '');
    c.dataset.diff = k;
    c.setAttribute('role', 'radio');
    c.setAttribute('aria-checked', k === cur ? 'true' : 'false');
    c.setAttribute('aria-pressed', k === cur ? 'true' : 'false');
    c.setAttribute('aria-label', '难度：' + arcade.diffName(k));
    c.textContent = arcade.diffName(k);
    c.tabIndex = 0;
    c.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation();
      c.click();
    });
    c.onclick = () => setMissionDifficulty(k);
    row.appendChild(c);
  }
}
function setMissionDifficulty(k) {
  if (!arcade || !arcade.setDifficulty(k)) return;
  const m = S._mission;
  if (m && m.phase === 'briefing' && !m.frozen) m.difficulty = k;   // 简报中即时快照本局
  renderDiffChips();
  toast('难度：' + arcade.diffName(k) + (m && m.phase === 'briefing' ? '（本局生效）' : '（下一局生效）'));
}
// 受限弹药：机炮/火箭减半（地狱火不变）。先恢复满弹再按变体减半——
// 重试/切回标准不会把弹药越减越少（startMission 也会先恢复满弹再应用）。
function applyVariantAmmo() {
  if (!rig) return;
  rig.gunAmmo = GUN.AMMO; rig.rocketAmmo = ROCKET.AMMO; rig.hfAmmo = 8;
  const m = S._mission;
  if (m && m.variant === 'limited_ammo') {
    rig.gunAmmo = Math.floor(GUN.AMMO / 2);
    rig.rocketAmmo = Math.floor(ROCKET.AMMO / 2);
  }
  S._ga = -1; S._rk = -1; S._ha = -1;      // HUD 缓存失配，下帧自动刷新
}
// P2：关卡局辅助（HOST.levels 由 91-levels 注册；70 低编号只经宿主取用）
function _missionLevel() {
  const m = S._mission;
  return m && m.levelId && HOST.levels ? HOST.levels.byId(m.levelId) : null;
}
function _levelListHtml(title, arr) {
  if (!arr || !arr.length) return '';
  return '<div class="mobj"><em>' + title + '</em>' + arr.map(o => '<i>□ ' + o.label + '</i>').join('') + '</div>';
}
// 任务内目标清单（勾选式）——判定快照读既有状态源，语义与各 variant 完成判定一致
function _levelProgressHtml() {
  const LV = _missionLevel(); const m = S._mission;
  if (!LV || !m || !targets) return '';
  const snap = { alive: targets.aliveCount, total: targets.totalCount,
    rescued: !!(rescue && rescue.state === 'delivered'), seadDone: _seadObjectiveDone(), airKills: m._airKills || m._airDowns || 0,
    finStage: m.variant === 'finale' ? (m._fin || 1) : 0,
    finAir: m.variant === 'finale' && enemyAir ? enemyAir.units.filter(u => u.on).length : 0,
    course: course && course.active ? { stage: course.stage, hoverT: course.hoverT } : null };
  return '<div class="mobj"><em>目标</em>' + HOST.levels.objectives(LV, snap).map(o =>
    '<i class="' + (o.ok ? 'ok' : '') + '">' + (o.ok ? '■ ' : '□ ') + o.label + (o.prog ? '　' + o.prog : '') + '</i>').join('') + '</div>';
}
// P3：训练关操作提示（简报底部）
const TRAIN_HINT = {
  finale: '阶段推进才会出现下一批威胁：防空没拔掉前别贴近基地；敌机升空后先打飞机；救人前确认基地已清空',
  train_flight: '空格 启动旋翼 · T 起飞/降落 · 方向键 前后左右平移 · A/D 转向 · 金色圈是下一个航点，竖直光柱指示位置',
  train_weapons: 'G 或鼠标左键 机炮（打卡车） · X 火箭（打油桶会殉爆） · 靶场不还击，慢慢瞄',
  train_hellfire: 'F 发射地狱火：先把坦克放进准星锁定框，锁定后再发射 · 坦克在来回机动',
  train_rescue: '跟着烟柱和信标找到幸存者 · 低速悬停在他正上方按 K 放绞车 · 救起后飞回停机坪',
};
function renderBriefing() {
  const V = missionVariant();
  const v = (S._mission && S._mission.variant) || 'standard';
  let extra = '';
  if (v === 'timed_rescue') extra = '<div class="mrow"><span>救援</span><b>至少完成 1 次救援（救起并送抵停机坪）</b></div>';
  else if (v === 'limited_ammo') extra = '<div class="mrow"><span>弹药</span><b>机炮 ' + Math.floor(GUN.AMMO / 2) + ' · 火箭 ' + Math.floor(ROCKET.AMMO / 2) + '（减半）</b></div>';
  else if (v === 'urban_strike') extra = '<div class="mrow"><span>城镇</span><b>基地北侧 · 楼后伏兵锁不上——等它探头，或用火箭/地狱火把楼炸塌</b></div>';
  else if (v === 'canyon_run') extra = '<div class="mrow"><span>峡谷</span><b>从峡谷南端出发，贴谷底飞；高于崖顶会被雷达锁定，用机炮/火箭打掉 2 座崖顶雷达站即可解除</b></div>' +
    '<div class="mrow"><span>操纵</span><b>C 第一人称（W 前进 · R 升 Q 降）· 环绕模式 PageUp/PageDown 升降 · 旋翼别碰岩壁</b></div>';
  const LV = _missionLevel();
  const LO = LV && LV.layout;   // P3c：有独立布场的关卡用自己的目标/完成条件/提示
  UI('mission-title').textContent = LV ? LV.id + ' · ' + LV.name : '作战简报';
  UI('mission-body').innerHTML =
    (LV ? '<div class="mintro">' + LV.intro + '</div>' + _levelListHtml('目标', LV.objectives) + _levelListHtml('附加', LV.bonus) : '') +
    '<div class="mrow"><span>挑战</span><b>' + V.name + '</b></div>' +
    '<div class="mrow"><span>目标</span><b>' + (LO && LO.brief ? LO.brief : v === 'air_superiority'
      ? '来袭敌机 ×' + AIRSUP_KILLS + '（' + AIRSUP_WAVES + ' 波编队，每波 2 架）'
      : v === 'urban_strike' ? '载具 ×15（基地 10 + 城镇伏兵 5）'
      : v === 'canyon_run' ? '载具 ×16（峡谷伏兵 6 + 基地 10）'
      : v === 'finale' ? '雷达站 + 防空车 → 基地 10 目标 + 拦截敌机 → 被俘飞行员'
      : v === 'train_flight' ? '航点圈 ×3 · 悬停区 · 停机坪'
      : v === 'train_rescue' ? '幸存者 ×1（看烟和信标找人）'
      : v === 'train_weapons' ? '静止靶 ×6（4 辆卡车 + 2 个油桶）'
      : v === 'train_hellfire' ? '移动坦克 ×3'
      : '载具 ×10（接近基地后锁定攻击）') + '</b></div>' +
    extra +
    '<div class="mrow"><span>完成条件</span><b>' + (LO && LO.goal ? LO.goal : V.goal) + '</b></div>' +
    '<div class="mrow"><span>失败条件</span><b>' + Math.round(V.timeout / 60) + ' 分钟内未完成' + (V.train ? '' : '（或机体损伤过重）') + '</b></div>' +
    '<div class="mhint">' + ((LO && LO.hint) || TRAIN_HINT[v] || '起飞后沿机头方向前进，接近后锁定并攻击；随时可按 B 重试') + '</div>';
}
function updateMissionPanel() {
  const mp = UI('mission');
  if (!mp.classList.contains('show') || !S._mission || !targets) return;
  // P6：结果冻结——done/failed 后不再被后续时间/行为改写（结算面板只渲染一次）
  if (S._mission.frozen) return;
  // Phase 11 C1：简报阶段保留简报文案（用户在此读任务/选变体），进度面板
  // 仅 active 起渲染——既有"接近触发瞬间 briefing→active"路径不受影响
  // （test_mission 读到的仍是 active 进度面板）
  if (S._mission.phase === 'briefing') return;
  const el = S.time - S._mission.t0;
  const remain = targets.aliveCount;
  // C005 制空作战：进度面板改渲染空战战果——地面目标数与本变体的胜利条件无关，
  // 继续显示"剩余目标/已摧毁"会误导（玩家无需清地面）。其余变体保持原渲染。
  if (S._mission.variant === 'air_superiority') {
    const ak = S._mission._airKills || 0;
    const wave = Math.min(AIRSUP_WAVES, Math.floor(ak / 2) + 1);   // 纯派生：每波 2 架
    UI('mission-body').innerHTML =
      '<div class="mrow"><span>已击落敌机</span><b>' + ak + ' / ' + AIRSUP_KILLS + '</b></div>' +
      '<div class="mrow"><span>当前波次</span><b>第 ' + wave + ' / ' + AIRSUP_WAVES + ' 波</b></div>' +
      '<div class="mrow"><span>用时</span><b>' + fmtMissionTime(el) + '</b></div>' +
      '<div class="mrow"><span>剩余时间</span><b>' + fmtMissionTime(Math.max(0, missionTimeout() - el)) + '</b></div>' + _levelProgressHtml();
    return;
  }
  if (S._mission.variant === 'train_flight' || S._mission.variant === 'train_rescue') {
    UI('mission-body').innerHTML =
      '<div class="mrow"><span>用时</span><b>' + fmtMissionTime(el) + '</b></div>' +
      '<div class="mrow"><span>剩余时间</span><b>' + fmtMissionTime(Math.max(0, missionTimeout() - el)) + '</b></div>' +
      (course && course.active && course.stage === 3 ? '<div class="mrow"><span>悬停计时</span><b>' + course.hoverT.toFixed(1) + ' / 10 s</b></div>' : '') +
      _levelProgressHtml();
    return;
  }
  UI('mission-body').innerHTML =
    '<div class="mrow"><span>剩余目标</span><b>' + remain + '</b></div>' +
    '<div class="mrow"><span>已摧毁</span><b>' + (targets.totalCount - remain) + '</b></div>' +
    '<div class="mrow"><span>用时</span><b>' + fmtMissionTime(el) + '</b></div>' +
    '<div class="mrow"><span>剩余时间</span><b>' + fmtMissionTime(Math.max(0, missionTimeout() - el)) + '</b></div>' + _levelProgressHtml();
  // Phase 11 C2：限时救援——全歼但救援未送抵时面板给出下一步指引（判定在 loop，
  // 未送抵不结算，等救援完成或变体时限耗尽失败）
  if (S._mission.variant === 'timed_rescue' && remain === 0 && (!rescue || rescue.state !== 'delivered')) {
    UI('mission-body').innerHTML += '<div class="mhint">目标已全歼——还需完成救援：飞近幸存者放绞车并送抵停机坪</div>';
  }
  // Phase 24：SEAD 变体——全歼但雷达/防空车未清时面板给出下一步指引（判定在 loop）
  if (S._mission.variant === 'sead_strike' && remain === 0 && !_seadObjectiveDone()) {
    UI('mission-body').innerHTML += '<div class="mhint">地面已清剿——还需摧毁敌雷达站与防空发射车完成 SEAD 压制</div>';
  }
}
function completeMission() {
  const m = S._mission;
  if (!m || m.frozen) return;                    // 冻结/已结算不重复
  // Phase 11 C2：限时救援完成条件 = 全歼 AND 至少完成 1 次救援（delivered）
  if (m.variant === 'timed_rescue' && (!rescue || rescue.state !== 'delivered')) return;
  // Phase 24：SEAD 变体完成条件 = 全歼 AND 雷达+防空车已摧毁（防御式复核，与 loop 判定一致）
  if (m.variant === 'sead_strike' && !_seadObjectiveDone()) return;
  // C005：制空作战完成条件 = 击落数达 AIRSUP_KILLS（防御式复核，与 loop 判定一致）
  if (m.variant === 'air_superiority' && (m._airKills || 0) < AIRSUP_KILLS) return;
  if (m.variant === 'finale' && m._fin !== 4) return;
  if (m.variant === 'train_flight' && !(course && course.done)) return;
  if (m.variant === 'train_rescue' && (!rescue || rescue.state !== 'delivered')) return;
  m.done = true; m.phase = 'done'; m.frozen = true;
  radioSay('done');   // E2 无线电
  const el = S.time - m.t0;
  const shots = (m.gun0 - rig.gunAmmo) + (m.rk0 - rig.rocketAmmo) + (m.hf0 - rig.hfAmmo);
  // P3：非战斗训练关（首飞/救援）没开火 → 命中率按 100% 计，评级只看用时
  const acc = shots > 0 ? Math.round(m.hits / shots * 100) : ((MISSION_VARIANTS[m.variant] || {}).noCombat ? 100 : 0);
  const dmgLv = targets ? targets._heliDmg : 0;
  // Phase 20-C：七输入评级（90-campaign grade）——基础档=旧 missionRating
  // 曲线，只降不升调整（damage 既有语义/燃油<25%/弹药耗尽/rookie 封顶 A）
  // + 连击≥5 保档。兼容性黄金用例（纯 pytest grade_compat）证明既有测试
  // 场景输出与旧公式逐位一致——73 项断言零改动的前提。
  const fuelPct = resources ? resources.state().fuel : 100;
  const ammoDry = resources
    ? resources.ammoDry(rig.gunAmmo, rig.rocketAmmo, rig.hfAmmo) : false;
  const gr = campaign ? campaign.grade({
    elapsed: el / ((MISSION_VARIANTS[m.variant] || {}).par || 1), acc: acc / 100, fuelPct,   // P3：长关按 par 折算用时 ammoDry, damage: dmgLv,
    comboMax: arcade ? arcade.state().comboMax : 1, difficulty: m.difficulty,
  }) : { grade: missionRating(el, acc / 100), drops: [], kept: null, detail: [] };
  let grade = gr.grade;
  const dmgDrop = (gr.drops || []).some(d => d.item === 'damage');
  // Phase 11 C3：结算显示变体名称 + 变体特有数据（限时救援=是否完成救援、
  // 受限弹药=弹药效率）；评级曲线 missionRating() 全变体共用不变
  const V = missionVariant();
  const vExtra = m.variant === 'timed_rescue'
    ? '<div class="mrow"><span>救援完成</span><b>' + (rescue && rescue.state === 'delivered' ? '是' : '否') + '</b></div>'
    : m.variant === 'limited_ammo'
    ? '<div class="mrow"><span>弹药效率</span><b>' + acc + '%</b></div>'
    : m.variant === 'air_superiority'
    ? '<div class="mrow"><span>击落敌机</span><b>' + (m._airKills || 0) + ' / ' + AIRSUP_KILLS + '</b></div>'
    : m.variant === 'urban_strike' && targets && targets.town
    ? '<div class="mrow"><span>炸塌建筑</span><b>' + targets.town.buildings.filter(b => !b.alive).length + ' / ' + targets.town.buildings.length + '</b></div>'
    : m.variant === 'canyon_run' && targets && targets.canyon
    ? '<div class="mrow"><span>崖顶雷达站</span><b>' + (targets.canyon.radars.length - targets.canyon.radarsAlive) + ' / ' + targets.canyon.radars.length + '</b></div>' +
      '<div class="mrow"><span>岩壁擦碰</span><b>' + targets.canyon.strikes + ' 次</b></div>'
    : '';
  // Phase 20-C：逐项明细（label 带 · 前缀——与主体行"用时/命中率"等同名
  // span 区分，值级测试按 span 文本定位提取不受干扰）
  const detailHtml = (gr.detail || []).map(d =>
    '<div class="mrow"><span>·' + d.label + '</span><b>' + d.value + '　' + d.impact + '</b></div>').join('');
  UI('mission-title').textContent = '任务完成';
  UI('mission-body').innerHTML =
    '<div class="mrow"><span>挑战</span><b>' + V.name + '</b></div>' +
    vExtra +
    '<div class="mrow"><span>用时</span><b>' + fmtMissionTime(el) + '</b></div>' +
    '<div class="mrow"><span>命中率</span><b>' + acc + '%</b></div>' +
    '<div class="mrow"><span>机体受损</span><b>' + dmgLv + (dmgDrop ? '（评级-降档）' : '') + '</b></div>' +
    '<div class="mrow"><span>剩余燃油</span><b>' + Math.round(fuelPct) + '%</b></div>' +
    '<div class="mrow"><span>弹药</span><b>机炮 ' + (m.gun0 - rig.gunAmmo) +
    ' · 火箭 ' + (m.rk0 - rig.rocketAmmo) + ' · 地狱火 ' + (m.hf0 - rig.hfAmmo) + '</b></div>' +
    '<div class="mrow"><span>评级</span><b style="color:var(--accent2)">' + grade + '</b></div>' +
    detailHtml +
    '<div class="mhint">按 B 或点重试可再来一次</div>';
  UI('mission').classList.add('show');
  UI('mission').classList.remove('briefing');   // 结算阶段恢复纯只读（pointer-events:none）
  UI('mission').classList.add('result');        // 结算态标记（窄屏字号等）
  if (betty) betty.speak('GOOD EFFECT');
  if (music) music.setMode('victory');                       // Phase 13-S4：胜利旋律
  const rb = UI('btn-mission-retry'); if (rb) rb.style.display = '';   // 结算后显示重试
  // Phase 18：结算奖励 + 成就判定（唯一结算入口；得分/最高分随结果面板展示）。
  // ammoLeftPct = 剩余弹药占任务起始装填百分比（frugal 判定 ≥50 即"用弹不多于一半"）
  if (arcade) {
    const ammoLeft = Math.max(0, rig.gunAmmo) + Math.max(0, rig.rocketAmmo) + Math.max(0, rig.hfAmmo);
    const base = (m.gun0 + m.rk0 + m.hf0) || 1;
    const ammoLeftPct = Math.round(ammoLeft / base * 100);
    const bonus = arcade.onMissionDone({
      difficulty: m.difficulty, damage: dmgLv, elapsed: el, variant: m.variant,
      grade: grade, ammoLeft: ammoLeft, ammoLeftPct: ammoLeftPct,
      missionTimeout: missionTimeout(),
      damageMul: damageSys ? damageSys.bonusMul() : 1,   // Phase 19：战损风险回报系数
    });
    // P5-G4：步兵全歼奖励（基础 150 × 难度得分系数；不改 onMissionDone 既有公式）
    m._infBonus = 0;
    if (infantry && infantry.active && infantry.men.length && infantry.aliveCount() === 0) {
      m._infBonus = arcade.addBonus(150 * arcade.coeffs(m).scoreMul);
      radioSay('inf');
    }
    m._settleBonus = bonus;
    UI('mission-body').insertAdjacentHTML('beforeend',
      '<div class="mrow"><span>得分</span><b>' + bonus + '</b></div>' +
      (m._infBonus > 0 ? '<div class="mrow"><span>步兵全歼奖励</span><b>+' + m._infBonus + '</b></div>' : '') +
      // Phase 23：本局摧毁雷达则单列 SEAD 压制奖励（已含在得分内，此行仅可见化战果）
      (arcade._lastSeadBonus > 0 ? '<div class="mrow"><span>SEAD 压制奖励</span><b>+' + arcade._lastSeadBonus + '</b></div>' : '') +
      '<div class="mrow"><span>总分 / 最高分</span><b>' + arcade.score + ' / ' + arcade.hi(m.difficulty) + '</b></div>' +
      '<div class="mrow"><span>难度</span><b>' + arcade.diffName(m.difficulty) + '</b></div>');
    // Phase 20-D：战役记档——仅关卡局（startCampaign 选关）；自由局（直接
    // startMission 无 levelIdx）不入档。最高分/评级保留最优、成就并集、
    // 累计机务损伤；前关达 B 解锁下一关（90-campaign complete）。
    if (campaign && m.levelIdx != null) {
      campaign.complete(m.levelIdx, {
        score: arcade.score, grade: grade,
        ach: arcade.state().unlocked, dmg: dmgLv,
      });
    }
  }
  // P2：关卡局记档（星级 + 附加目标 + 解锁下一关）——92-progress record
  const LV = _missionLevel();
  const prevBest = LV && progress ? (progress.rec(LV.id).bestScore || 0) : null;   // P5-G4 个人最佳对比（记档前快照）
  _appendDebrief(m, prevBest);                    // 战报放在关卡按钮（下一关/重玩）之前
  if (LV && progress) {
    const r = progress.record(LV.id, grade, arcade ? arcade.score : 0, {
      damage: dmgLv, acc: acc / 100, elapsed: el, fuelPct,
      airKills: m._airKills || m._airDowns || 0,
      wallStrikes: targets && targets.canyon ? targets.canyon.strikes : 0,
      gunUsed: m.gun0 - rig.gunAmmo, rkUsed: m.rk0 - rig.rocketAmmo,
    }, m.difficulty);
    if (r) {
      const starTxt = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
      UI('mission-title').textContent = LV.id + ' · ' + LV.name + ' — 完成';
      UI('mission-body').insertAdjacentHTML('afterbegin',
        '<div class="mstars" data-stars="' + r.stars + '">' + starTxt + '</div>' +
        (r.bonus.length ? '<div class="mobj"><em>附加</em>' + r.bonus.map(b =>
          '<i class="' + (b.ok ? 'ok' : '') + '">' + (b.ok ? '■ ' : '□ ') + b.label + '</i>').join('') + '</div>' : '') +
        (r.unlockedNext ? '<div class="mhint">已解锁 ' + r.next + ' ' + HOST.levels.byId(r.next).name + '</div>' : ''));
    }
    if (HOST.onLevelResult) HOST.onLevelResult(r);
  }
}

// ---- P5-G4 战报（2026-10-16）：结算面板末尾追加——分武器命中、击毁明细、中弹次数、
// 最高连击、得分来源、个人最佳对比。只读展示，不改评级与既有得分公式。
const _KILL_NAMES = { tank: '坦克', truck: '卡车', barrel: '油桶', drone: '无人机', balloon: '热气球', plane: '靶机',
  enemy: '敌直升机', radar: '雷达', sam: '防空导弹车', ammo: '弹药库', infantry: '步兵', moto: '摩托侦察兵' };
function _appendDebrief(m, prevBest) {
  const body = UI('mission-body');
  if (!body || !rig) return;
  const hb = m.hitsBy || { 1: 0, 2: 0, 3: 0 };
  const w = (name, used, hit) => used > 0
    ? '<i>' + name + ' 中 ' + hit + ' / 发 ' + used + '（' + Math.round(Math.min(1, hit / used) * 100) + '%）</i>'
    : '<i class="off">' + name + ' 未使用</i>';
  const gunU = Math.max(0, m.gun0 - rig.gunAmmo), rkU = Math.max(0, m.rk0 - rig.rocketAmmo), hfU = Math.max(0, m.hf0 - rig.hfAmmo);
  const st = arcade ? arcade.stats() : { killsBy: {}, killScore: 0 };
  const kills = Object.entries(st.killsBy).map(([k, n]) => (_KILL_NAMES[k] || k) + ' ×' + n).join(' · ') || '无';
  const as = arcade ? arcade.state() : null;
  const score = arcade ? arcade.score : 0;
  const src = arcade ? '击毁 ' + st.killScore + ' · 结算 ' + (m._settleBonus || 0) + (m._infBonus ? ' · 步兵全歼 ' + m._infBonus : '') +
    (m.civKills ? ' · 误伤平民 −' + m.civKills * CIV_PENALTY : '') : '—';
  let pb = '';
  if (prevBest != null) {
    pb = score > prevBest
      ? '<div class="mrow p5-pb new"><span>最佳</span><b>' + score + '　新纪录！（原 ' + prevBest + '）</b></div>'
      : '<div class="mrow p5-pb"><span>最佳</span><b>' + prevBest + '　本局差 ' + (prevBest - score) + '</b></div>';
  }
  body.insertAdjacentHTML('beforeend',
    '<div class="p5-deb"><div class="p5-deb-h">战报</div>' +
    '<div class="mrow"><span>武器</span><b class="p5-w">' + w('机炮', gunU, hb[1]) + w('火箭', rkU, hb[2]) + w('地狱火', hfU, hb[3]) + '</b></div>' +
    '<div class="mrow"><span>击毁</span><b>' + kills + '</b></div>' +
    '<div class="mrow"><span>中弹</span><b>' + (m.hitsTaken || 0) + ' 次' + ((m.hitsTaken || 0) === 0 ? '　无伤！' : '') + '</b></div>' +
    '<div class="mrow"><span>连击</span><b>×' + (as ? as.comboMax : 1) + '</b></div>' +
    '<div class="mrow"><span>来源</span><b>' + src + '</b></div>' +
    pb + '</div>');
  if (!document.getElementById('p5-deb-css')) {
    const s = document.createElement('style'); s.id = 'p5-deb-css';
    s.textContent = '.p5-deb{margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.15)}' +
      '.p5-deb-h{font-size:12px;letter-spacing:4px;opacity:.7;margin-bottom:2px}' +
      '.p5-deb .mrow span{flex:0 0 auto;white-space:nowrap;margin-right:12px}.p5-deb .mrow b{text-align:right}'+
      '.p5-w i{display:block;font-style:normal;white-space:nowrap}.p5-w i.off{opacity:.45}' +
      '.p5-pb.new b{color:var(--accent2)}';
    document.head.appendChild(s);
  }
}
// P6：失败路径——超时未全歼即失败，结果冻结并给出可重试入口
function failMission(reason) {
  const m = S._mission;
  if (!m || m.frozen) return;
  m.done = true; m.phase = 'failed'; m.frozen = true; m.failedReason = reason;
  radioSay('fail');   // E2 无线电
  const el = S.time - m.t0;
  UI('mission-title').textContent = '任务失败';
  // P8：失败归因可解释——damage=机体损伤过重强制返航；timeout=超时未全歼。
  // Phase 11 C2/C3：超时文案按变体时限（限时救援 240s→4 分钟），结算显示变体名称
  // Phase 20-B：fuel=燃油耗尽迫降；ammo=弹药耗尽未完成（返场补给是唯一补弹途径）
  const reasonTxt = reason === 'timeout' ? '超过 ' + Math.round(missionTimeout() / 60) + ' 分钟未达成目标'
    : reason === 'damage' ? '机体损伤过重（Lv.3）——被迫返航，任务失败'
    : reason === 'fuel' ? '燃油耗尽——迫降失败（下次规划返场补给）'
    : reason === 'ammo' ? '弹药耗尽且目标未清——返场补给窗口是唯一补弹途径'
    : reason;
  UI('mission-body').innerHTML =
    '<div class="mrow"><span>挑战</span><b>' + missionVariant().name + '</b></div>' +
    '<div class="mrow"><span>结果</span><b style="color:var(--warn)">失败</b></div>' +
    '<div class="mrow"><span>原因</span><b>' + reasonTxt + '</b></div>' +
    '<div class="mrow"><span>用时</span><b>' + fmtMissionTime(el) + '</b></div>' +
    '<div class="mrow"><span>已摧毁</span><b>' + (targets.totalCount - targets.aliveCount) + '/' + targets.totalCount + '</b></div>' +
    '<div class="mrow"><span>机体受损</span><b>' + (targets ? targets._heliDmg : 0) + '</b></div>' +
    '<div class="mhint">按 B 或点重试可再来一次</div>';
  UI('mission').classList.add('show');
  UI('mission').classList.remove('briefing');
  UI('mission').classList.add('result');
  if (betty) betty.speak('MISSION FAILED');
  if (music) music.setMode('ambient');                       // Phase 13-S4：失败回落氛围
  const rb = UI('btn-mission-retry'); if (rb) rb.style.display = '';   // 结算后显示重试
  // Phase 18：失败不得分（结算奖励 0），连击清零；本局已得击毁分保留在 HUD
  if (arcade) arcade.onMissionFailed();
  // P2：关卡局失败——标题带关卡名，结算按钮区刷新（不记档）
  const LVf = _missionLevel();
  if (LVf) UI('mission-title').textContent = LVf.id + ' · ' + LVf.name + ' — 失败';
  if (LVf && HOST.onLevelResult) HOST.onLevelResult(null);
}
// P6：任务模式显式入口——标准起点（沙漠+正午+地面）+ 清全部任务相关状态。
// Phase 11 C1：startMission(variant) 接受变体参数（standard/timed_rescue/limited_ammo），
// 变体只标记 S._mission.variant 并影响弹药初始/时限/完成条件，不新建状态机。
// Phase 20-D：levelIdx（可选）= 战役关卡序号——startCampaign 经此进入，
// completeMission 按它记档（最高分/评级/成就/累计损伤+解锁链）；自由局
// 不传（levelIdx=null）→ 不入战役存档。
function startMission(variant, levelIdx, levelId) {
  // 最终闭环修复（唯一相机所有权）：FPV 激活时经 exitNormalized 显式退出并
  // 完整规范化（camera.up/速度/输入累积/userAlt/S._alt/pitch/roll 全清）——
  // 裸 fp.exit 会残留 camera.up 旋转、驾驶速度与高度缓存，下一帧 FPV 改写
  // 高度/相机与任务复位/过场竞争。规范化完成才启动任务过场。
  if (fp && fp.active) fp.exitNormalized();
  // P6 修复批：先固定任务场地（desert），再以最终 W.terrainKey 初始化救援——
  // 旧实现先 rescue.setTerrain(旧场地键) 再切 desert，救援生成依赖 loop 的
  // _rescueTerr 检测在下一帧间接修复（从 pad/grass/water 启动时幸存者/烟/信标
  // 不会立即可见）。顺序：切场地 → 用最终键初始化救援 → 同步 _rescueTerr。
  if (W.setTerrain) W.setTerrain('desert');      // 任务场地固定沙漠（靶场+救援同场）
  if (washfx) washfx.setMedium('sand');
  if (audio) audio.setMedium('sand');
  const tk = W.terrainKey;                        // 最终场地键（desert）
  S._rescueTerr = tk;                             // 同步救援场地检测，防下帧重复触发
  // 清任务相关状态：靶场/空中目标复位、武器瞬态清空、救援重生成、HUD/击毁计数清零
  if (targets) targets.reset();
  if (scenery) scenery.resetTrees();   // 上一关被炸倒/烧焦的树复原
  if (rig && rig.clearImpacts) rig.clearImpacts();   // P5-G1 清弹坑/爆闪
  if (air) air.reset();
  if (infantry) infantry.reset();   // P5-G2 步兵归位复活
  if (life) life.reset();             // 2026-10-18 平民/摩托归位
  resetNightOps();                  // P5-G3 照明弹补满
  if (samwar) samwar.reset();   // Phase 19：新任务清 SAM 状态（干扰弹补满/导弹清空/相位复位）
  if (damageSys) damageSys.reset();   // Phase 19：新任务清机务损伤（系统归零/卡壳过热处置全清）
  if (enemyAir) enemyAir.reset();   // Phase 20：清 A2A 状态（spawn 在下方统一做）
  if (narrative) narrative.resetStrikes();   // Phase 21：清基地设施打击层（hp/alive/雷达停转标记复位，避免跨局残留）
  if (enemyVis) enemyVis.clearVisual();
  if (resources) resources.start();   // Phase 20：满油开局（补给窗计时/告警 latch 复位）
  if (rig) { rig.clearTransient(); rig._dmgPenalty = 0; }   // P8：重置清受损散布惩罚
  // 最终闭环修复（救援状态跨任务泄漏）：用 resetRound 清 delivered/aboard 等
  // 终态并重新生成幸存者——setTerrain 会保留 delivered（同局切地形语义），
  // 但新任务轮次必须真正重置，否则 timed_rescue 上一局 delivered 泄漏使
  // 完成条件在未重新救援时即满足。
  if (rescue) rescue.resetRound(tk);
  _kills = 0; updateTargetHUD(null);
  // P14-A（幂等）：round 递增需在重建前捕获上一任务轮次阶段——简报/进行中
  // 重复点击"开始/重试"属同一轮，不得 roll（否则 cutscene 重排、power 重复播放）。
  // 仅"全新任务 / 上一轮已结算（done/failed）"才递增轮次（retry=新轮合法）。
  const prevPhase = S._mission ? S._mission.phase : null;
  S._mission = { t0: null, gun0: null, rk0: null, hf0: null, hits: 0, done: false,
    phase: 'briefing', failedReason: null, frozen: false, variant: variant || 'standard',
    // Phase 18：难度快照（本局冻结；结算/超时/AA 系数均读此值，任务中切面板不改）
    difficulty: (arcade && arcade.difficulty) || 'standard',
    // Phase 20-D：战役关卡序号（null=自由局不入档）
    levelIdx: (levelIdx == null ? null : levelIdx),
    // P2：游戏模式关卡 id（91-levels；null=非关卡局）。结算按它记星级（92-progress）
    levelId: levelId || null };
  // Phase 18：本局计分/连击/成就状态清零（最高分与跨局变体记录保留）
  if (arcade) arcade.onMissionStart();
  S._baseFound = false;
  // Phase 13-S4：任务开始 → 战斗配乐（鼓点+贝斯；垫乐压低）
  if (music) music.setMode('battle');
  // Phase 13-M6：任务 cutscene（round 制：每新任务轮次最多播一次）；rescue
  // replay 标记复位（新轮次重新具备资格）
  const isNewRound = prevPhase === null || prevPhase === 'done' || prevPhase === 'failed';
  if (isNewRound) S._missionRound = (S._missionRound || 0) + 1;   // 新轮次 ID（round 制）
  S._rescueCut = false;
  if (HOST.cutsceneState) HOST.cutsceneState.maybe('mission', S._missionRound);
  // 弹药恢复满 + 按变体应用（受限弹药减半、切回标准即满弹）——重试不累积
  applyVariantAmmo();
  // Phase 20-A：A2A 敌机编队进场——巡逻锚=敌方基地方位（靶场基地外延环）。
  // spawn 在敌机 reset 之后（startMission 统一入口），2 机从巡逻环就位。
  const VT = MISSION_VARIANTS[S._mission.variant];
  if (VT && VT.train && targets) targets.applyTraining(VT.bench);   // P3：训练关布场（reset 之后）
  // P3c：关卡独立布场 / 救援点 / 威胁（数据在 91-levels 的 level.layout）
  const LVd = S._mission.levelId && HOST.levels ? HOST.levels.byId(S._mission.levelId) : null;
  const LO = LVd && LVd.layout;
  if (LO && LO.units && targets) targets.applyLayout(LO.units);
  if (LO && LO.rescueAt) _placeRescue(LO.rescueAt.x, LO.rescueAt.z);
  if (enemyAir && targets && targets.baseCenter && !(VT && (VT.train || VT.noAirStart)) && !(LO && LO.noAir)) {
    // C005：锚点快照进 mission——制空作战续波必须用与首波同一锚点
    S._mission._airAnchor = (LO && LO.airAnchor) ? { x: LO.airAnchor.x, z: LO.airAnchor.z }
      : { x: targets.baseCenter.x, z: targets.baseCenter.z };   // P3c：关卡可移出基地
    enemyAir.spawn(S._mission._airAnchor);
  }
  // 回到地面停放态，简报先出（规范化全部飞行状态——FPV 退出后的残留一并清零）
  FLY.state = 'ground'; FLY.alt = 0; FLY.x = 0; FLY.z = 0; FLY.yaw = 0;
  FLY.pitch = 0; FLY.roll = 0; FLY.fp = false;
  const rb = UI('btn-mission-retry'); if (rb) rb.style.display = 'none';  // 新一轮开始隐藏重试
  showMissionBriefing();
}
// Phase 20-D：战役关卡入口——按解锁链选关（canPlay 门控），快照难度并进入
// 对应变体；levelIdx 记进 S._mission 供结算记档。
function startCampaign(i) {
  if (!campaign || !campaign.canPlay(i)) { toast('该关卡尚未解锁——前关达 B 评级解锁下一关'); return; }
  const p = campaign.levelParams(i);
  if (!p) return;
  if (arcade) arcade.setDifficulty(p.difficulty);
  startMission(p.variant, i);
  toast('战役 ' + p.name + '——难度 ' + arcade.diffName(p.difficulty));
}
// P6：从简报/结算进入进行中（简报确认按钮/接近触发共用）
function beginMission() {
  const m = S._mission;
  if (!m || m.phase !== 'briefing') return;
  m.phase = 'active';
  radioSay('start');   // E2 无线电开场
  if (m.t0 == null) m.t0 = S.time;
  if (m.gun0 == null) { m.gun0 = rig ? rig.gunAmmo : 0; m.rk0 = rig ? rig.rocketAmmo : 0; m.hf0 = rig ? rig.hfAmmo : 0; }
  // 任务进行中靶场必须启用（直接设状态源；不依赖 72-uibind 闭包内的 syncTargetsVis）
  if (targets) { targets.enabled = true; for (const t of targets.targets) t.group.visible = t.alive; }
  // 2026-10-19：游戏模式开打时切到作战视角（70-camera setView 内按模式取景）；FPV/过场持有镜头时不动
  if (HOST.appMode && HOST.appMode.mode === 'play' && !(HOST.fp && HOST.fp.active) && !(HOST.camSeq && HOST.camSeq.owner)) setView(0);
  updateMissionPanel();
}
// P6：重试——与 startMission 相同清场语义（任务面板由 startMission 重新渲染）。
// Phase 11 C3：重试同一变体（保留当前 variant，不做默认回退）
// Phase 20-D：同时保留战役关卡序号（重试同一关）
function retryMission() {
  const m = S._mission;
  const v = (m && m.variant) || 'standard';
  const li = m ? m.levelIdx : null;
  startMission(v, li, m ? m.levelId : null);
  toast('任务已重置——按 T 起飞出发');
}

// ---------- 帧逻辑（70-loop.js loop() 在 if (apache) 段内调用） ----------
// 任务过场重试 / 接近基地触发 / 面板刷新与胜负判定 / 训练步骤推进
function _tickMission(dt) {
  // 最终闭环修复（mission cutscene owner 冲突闭环）：startMission 时若
  // cinematic 等序列持有 HOST.camSeq，maybe('mission', round) 被拒并保留
  // pendingRound——此处每帧重试，owner 释放后自动取得并播放；幂等（已播
  // 返回 true 零副作用）。同轮最多播一次，retry 新轮重新具备资格。
  if (S._mission && S._missionRound && HOST.cutsceneState) {
    HOST.cutsceneState.maybe('mission', S._missionRound);
  }
  // 接近敌方基地的叙事节点（寻找→锁定→攻击→摧毁）：接近到 30u 内
  // 播报发现并下发作战简报（P2-2 任务系统启动；P6 兼容触发——同 startMission
  // 的统一任务状态，不另起计分系统）。
  // 两种情况：① 无任务 → 新建并进 briefing→active；② 已在 briefing（如刚
  // retry 或 startMission 后）→ 接近即视为"出发确认"，自动进入 active。
  const VTr = S._mission && MISSION_VARIANTS[S._mission.variant];
  // P3：训练关——离地即开始（不靠接近基地触发）
  if (VTr && VTr.train && S._mission.phase === 'briefing' && FLY.state !== 'ground') beginMission();
  if (targets && targets.baseCenter && !S._baseFound && S.mode === 'mission' && !(VTr && VTr.train)) {
    const bd = Math.hypot(apache.root.position.x - targets.baseCenter.x,
                          apache.root.position.z - targets.baseCenter.z);
    if (bd < 30) {
      // Phase 22：进基地扇区——雷达存活时给 SEAD 战术提示（读 narrative.radarAlive，
      // 不改 81），引导先敲雷达压制防空；雷达已毁则回退常规接敌提示（toast 单槽覆盖，
      // 故二选一而非叠两条）
      if (narrative && narrative.radarAlive()) {
        toast('侦测到敌方军事基地——先敲掉雷达站可压制防空（RWR 转“压制”）');
        if (betty) betty.speak('TAKE OUT ENEMY RADAR');
      } else {
        toast('侦测到敌方军事基地——接近并锁定目标');
      }
      S._baseFound = true;
      if (!S._mission) {
        S._mission = { t0: S.time,
          gun0: rig ? rig.gunAmmo : 0, rk0: rig ? rig.rocketAmmo : 0, hf0: rig ? rig.hfAmmo : 0,
          hits: 0, done: false, phase: 'active', failedReason: null, frozen: false,
          variant: 'standard',
          difficulty: (arcade && arcade.difficulty) || 'standard' };   // P18 难度快照
        if (arcade) arcade.onMissionStart();   // 旧触发路径（无任务直接接近）同样计分局
        showMissionBriefing();
      }
      // briefing 态（startMission/retry 后）接近 = 出发确认 → active
      if (S._mission && S._mission.phase === 'briefing') {
        beginMission();
      } else if (S._mission && !S._mission.t0) {
        beginMission();
      }
    }
  }
  // 任务面板实时刷新（0.5s 节流）+ 完成/失败判定（P6：frozen 门控 + 超时失败）
  // Phase 11 C2：限时救援完成条件 = 全歼 AND rescue delivered（未送抵不结算，
  // 面板已给指引；超时仍按变体时限失败）；其余变体判定与标准一致
  if (S._mission && !S._mission.frozen && targets) {
    S._mission._t = (S._mission._t || 0) + dt;
    if (S._mission._t >= 0.5) {
      S._mission._t = 0;
      updateMissionPanel();
      // C005 制空作战：胜利与地面目标无关——**独立并列判定**（严禁并入下方
      // aliveCount===0 块，否则玩家须先清光地面才判空战胜利，违背制空本意）。
      // 同处做续波：当前波被打光（两架皆被击落——**撤离退场不算**，逃机永久
      // 退场不再补波）且未满 AIRSUP_KILLS → 复用既有 2 单元再 spawn 一波
      // （借本 0.5s 节流，不会每帧狂 spawn；且只在未满 6 时续）。
      if (S._mission.variant === 'air_superiority' && S._mission.phase === 'active') {
        const killed = S._mission._airKills || 0;
        if (killed >= AIRSUP_KILLS) { completeMission(); }
        else if (_airWaveCleared()) { if (enemyAir) enemyAir.spawn(_airSupAnchor()); }
      }
      // P3：首飞/救援训练——完成条件与地面目标无关（全部下场 aliveCount 恒 0）
      const vv = S._mission.variant;
      if (S._mission.phase === 'active') _tickLevelThreat();
      if (vv === 'finale') {
        if (S._mission.phase === 'active') _tickFinale();
        if (S._mission.phase === 'active' && S._mission._fin === 4) completeMission();
        else if (S._mission.phase === 'active' && (S.time - S._mission.t0) > missionTimeout()) failMission('timeout');
        else if (S._mission.phase === 'active' && targets._heliDmg >= 12) failMission('damage');
      }
      else if (vv === 'train_flight' || vv === 'train_rescue') {
        if (S._mission.phase === 'active' && (vv === 'train_flight' ? (course && course.done) : (rescue && rescue.state === 'delivered'))) completeMission();
        else if (S._mission.phase === 'active' && (S.time - S._mission.t0) > missionTimeout()) failMission('timeout');
      }
      else if (targets.aliveCount === 0 && S._mission.variant !== 'air_superiority') {
        if (S._mission.variant === 'timed_rescue' && (!rescue || rescue.state !== 'delivered')) {
          if (!S._mission._rescueHint) { S._mission._rescueHint = true; toast('目标已全歼——还需完成救援：放绞车救起并送抵停机坪'); }
        } else if (S._mission.variant === 'sead_strike' && !_seadObjectiveDone()) {
          // Phase 24：地面全歼但雷达/防空车未清 → 不结算，给 SEAD 指引（仿限时救援）
          if (!S._mission._seadHint) { S._mission._seadHint = true; toast('地面已清剿——还需摧毁敌雷达站与防空发射车完成 SEAD'); }
        } else { completeMission(); }
      }
      else if (S._mission.phase === 'active' && (S.time - S._mission.t0) > missionTimeout()) { failMission('timeout'); }
      // P8：损伤过重失败——损伤 ≥12（Lv.3 顶格）强制返航，归因可解释（有分级、有恢复=重试）
      else if (S._mission.phase === 'active' && targets._heliDmg >= 12) { failMission('damage'); }
      // Phase 20-B：弹药耗尽失败——三类弹药全空且目标未全歼（返场补给窗口
      // 是唯一补给途径；limited_ammo 变体无补给窗，打光即败局可解释）
      else if (S._mission.phase === 'active' && resources
        && resources.ammoDry(rig ? rig.gunAmmo : 0, rig ? rig.rocketAmmo : 0, rig ? rig.hfAmmo : 0)
        && targets.aliveCount > 0) { failMission('ammo'); }
    }
  }
  // Phase 11 T1：训练模式分步引导推进（0.5s 节流粒度足够；判定全部复用
  // __dbg 状态源，不新建第二套状态机）。S._train 1..5，0=关；每步完成自动
  // 推进并 toast 下一步，第 ⑤ 步救援完成即训练完成。
  if (S.mode === 'train' && S._train) {
    if (fp && fp.active) S._trainFp = true;                        // ③ 观察：进入过 FPV
    if (rescue && rescue.state !== 'idle') S._trainRescue = true;  // ⑤ 救援：绞车进入过作业
    if (S._train === 1 && S.running && S.spin >= FLY.MIN_SPIN) trainAdvance();
    else if (S._train === 2 && FLY.state === 'hover') trainAdvance();
    else if (S._train === 3 && (S._trainFp || S._trainOrbit)) trainAdvance();
    else if (S._train === 4 && rig && rig.gunAmmo < S._trainGun0) trainAdvance();
    else if (S._train === 5 && S._trainRescue) trainFinish();
  }
}

// 城镇 / 峡谷随任务变体纯派生（激活、落位、雷达命中、峡谷 HUD）
function _tickMissionMaps(dt) {
  // P3：1-1 首飞航线随任务变体纯派生；active 局逐帧判定穿圈/悬停/降落
  if (course) {
    const wantCourse = S.mode === 'mission' && !!S._mission && S._mission.variant === 'train_flight';
    if (course.active !== wantCourse) course.setActive(wantCourse);
    if (course.active) {
      if (S._mission.phase === 'briefing' && course.stage > 0) course.reset();   // 重试回到起点
      if (S._mission.phase === 'active' && !S._mission.frozen) course.step(dt || 0, apache.root.position, FLY.state);
      course.update(dt || 0);
    }
  }
  // 玩法批 C：城镇随任务变体纯派生（简报切换变体即出现/消失；离开任务模式 S._mission=null 自动撤场）
  if (targets && targets.town) {
    const wantTown = (S.mode === 'mission' && !!S._mission && S._mission.variant === 'urban_strike')
      || !!(HOST.routeState && HOST.routeState.on && HOST.routeState.scene === 'town');   // P4b 城镇巡逻航线
    if (targets.town.active !== wantTown) { targets.town.setActive(wantTown); updateTargetHUD(null); }
  }
  // 玩法批 D：峡谷同样随任务变体纯派生；激活时远景沙丘让位、悬停高度压到崖顶以下
  if (targets && targets.canyon) {
    const cy = targets.canyon;
    const wantCanyon = (S.mode === 'mission' && !!S._mission && S._mission.variant === 'canyon_run')
      || !!(HOST.routeState && HOST.routeState.on && HOST.routeState.scene === 'canyon');   // P4b 峡谷穿越航线
    if (cy.active !== wantCanyon) {
      if (S._hover0 == null) S._hover0 = FLY.HOVER;
      cy.setActive(wantCanyon);
      FLY.HOVER = wantCanyon ? CANYON_HOVER : S._hover0;
      if (!wantCanyon && FLY.state === 'ground') { FLY.x = 0; FLY.z = 0; FLY.yaw = 0; }
      if (W.duneFar) W.duneFar.visible = !wantCanyon && W.terrainKey === 'desert';
      updateTargetHUD(null);
    }
    if (cy.active) {
      if (W.duneFar) W.duneFar.visible = false;
      // 新一局/重试：停在地面时放回峡谷南端（startMission 先把 FLY 归零，这里再落位）
      if (cy.needSpawn && FLY.state === 'ground') {
        cy.needSpawn = false;
        FLY.x = cy.spawn.x; FLY.z = cy.spawn.z; FLY.yaw = cy.spawn.yaw; FLY.alt = 0;
      }
      // 雷达锁定命中 → 走 P8 既有损伤链（同 SAM hitPending 单槽消费）
      if (cy.hitPending) {
        const h = cy.hitPending;
        cy.hitPending = null;
        const cdm = arcade ? arcade.coeffs(S._mission) : null;
        targets._heliDmg += h.dmg * (cdm ? cdm.aaDmg : 1);
        targets._threatHitFlash = 3;
        if (targets.onHeliHit) targets.onHeliHit(targets._heliDmg, h);
        S._flash = Math.max(S._flash, 0.5); S._shake = 1.0;
      }
    }
    const ch = UI('canyon-hud');
    if (ch) {
      ch.classList.toggle('show', cy.active);
      if (cy.active) {
        ch.querySelector('b').style.width = Math.round(cy.exposure * 100) + '%';
        ch.classList.toggle('lock', cy.exposure >= 1);
        ch.querySelector('em').textContent = cy.radarsAlive > 0 ? '雷达 ' + cy.radarsAlive + '/' + cy.radars.length : '雷达已致盲';
      }
    }
  }
}
