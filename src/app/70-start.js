// ============================================================
// 70-start.js — 载入与装配：进度条 / boot 载 GLB / finish 装配子系统；文件末尾启动
// ============================================================
// 2026-10-12 自 70-app.js 拆出（纯搬移 + 帧逻辑提成具名函数，行为不变）。
// 同前缀 70-* 文件在拓扑检查里同级（互引不算反向引用），拼接顺序按文件名。

// ---------- 载入 ----------
const loadFill = UI('load-fill'), loadTxt = UI('load-txt'), loading = UI('loading');
function prog(p, msg) {
  loadFill.style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%';
  loading.setAttribute('aria-valuenow', (clamp(p, 0, 1) * 100).toFixed(0));   // Phase 2-A6：读屏进度
  if (msg) loadTxt.textContent = msg;
}

function boot() {
  // file:// 模式：浏览器禁止 fetch 本地相对资源（GLB 请求必然失败）。早期脚本
  // 已给出"运行 start-demo.bat / 本地 HTTP 服务"指引，这里不再发起注定失败的
  // 请求（避免 console.error 与提示被覆盖，P15-B）。
  if (location.protocol === 'file:') return;
  prog(0.05, '构建停机坪贴图…');
  applyPreset(W, renderer, 'day');
  applyQuality(S.quality);          // washfx 尚未创建，特效档位在 finish() 里补齐
  prog(0.18, '载入机体模型…');

  const loader = new THREE.GLTFLoader();
  loader.load('assets/apache_v2.glb',
    gltf => {
      prog(0.82, '绑定动画部件…');
      apache = new Apache().bind(gltf);
      W.scene.add(apache.root);

      // 桨盘残影：挂在主旋翼枢轴上，随枢轴一起转（残影本身靠着色器动）
      disc = makeRotorDisc(AC.rotorRadius);
      discMat = disc.material;
      disc.userData.noRefl = true;        // 湖面倒影克隆体中隐藏（实心盘会穿帮）
      if (apache.mainRotor) apache.mainRotor.add(disc);

      countScene(apache.root);
      UI('hud-tri').textContent = fmtK(STATS.tris);
      UI('hud-mesh').textContent = String(STATS.meshes);

      prog(0.9, '载入美军绿蒙皮…');
      new THREE.TextureLoader().load('assets/skin_army.jpg',
        t => { apache.setArmySkin(t); finish(); },
        undefined,
        () => { loadTxt.textContent = '蒙皮缺失，仅低可视灰可用'; finish(); });
    },
    e => {
      if (e && e.total) prog(0.18 + 0.62 * (e.loaded / e.total), '载入机体模型…');
    },
    err => window.__showErr('GLB 载入失败：' + (err && err.message || err))
  );
}

function finish() {
  prog(1, '就绪');
  rig = new WeaponRig(W.scene, apache);
  HOST.rig = rig;                       // Phase 1-A：47-betty 弹药告警经 HOST 取用
  rig.onToast = toast;
  targets = new TargetRange(W.scene);
  targets.onHit = updateTargetHUD;
  // 玩法批 B2：基地警报 → 播报 + 敌方反击提速一档（AA 冷却立即缩短，"捅了马蜂窝"）
  targets.onAlert = n => {
    toast(n > 0 ? `⚠ 敌方基地拉响警报：${n} 辆卡车正在疏散` : '⚠ 敌方基地拉响警报');
    targets._aaCool = Math.min(targets._aaCool, 0.6);
  };
  // 玩法批 C：城镇地图（仅 urban_strike 变体激活——loop 每帧派生 setActive）
  targets.town = new TownDistrict(W.scene, targets);
  targets.town.onCollapse = b => {
    toast('🏚 ' + b.label + '被炸塌');
    S._shake = Math.max(S._shake || 0, 0.8);
  };
  // 玩法批 D：峡谷地图（仅 canyon_run 变体激活——loop 每帧派生 setActive）
  targets.canyon = new CanyonRun(W.scene, targets);
  // P3：1-1 首飞航线（航点圈/悬停区/降落标；仅 train_flight 局激活）
  course = new FlightCourse(W.scene);
  course.onStage = st => {
    const msg = ['', '航点 1 通过——飞向航点 2', '航点 2 通过——飞向最后一个航点',
      '三个航点全部通过——飞进绿色悬停区，稳住 10 秒', '悬停完成——回停机坪，按 T 降落', '降落完成'][st];
    if (msg) toast(msg);
    if (music && st < 5) music.brass();
  };
  targets.canyon.onRadarDown = (r, n) => {
    toast(n > 0 ? '📡 崖顶雷达站被摧毁（还剩 ' + n + ' 座）' : '📡 雷达网已致盲——可以拉高飞了');
    S._shake = Math.max(S._shake || 0, 0.5);
  };
  targets.canyon.onLock = () => {
    toast('⚠ 被雷达锁定——压低到崖顶以下！');
    if (betty) betty.warn('MISSILE LAUNCH', 4);
  };
  rig.targets = targets;
  window.__rigFx = rig;   // 靶标爆炸特效借用武器烟尘池
  washfx = new WashFX(W.scene, W);
  audio = new RotorAudio();
  // Phase 13-M4：动态天气（沙暴/夜雷暴）——先建 audio（雷声/风声走样本层）。
  // 构造器经 HOST 工厂取用（79 高编号不得被 70 反向引用，拓扑硬规则）
  weather = HOST.makeWeather(renderer, W, audio);
  // Phase 13-S4：电影配乐（战斗鼓点/击毁铜管/胜利旋律/氛围垫乐）——共享音频上下文与样本
  music = HOST.makeMusic(audio);
  // Phase 13-M5：环境叙事（基地旋转雷达/防空车/探照灯/弹药堆/巡逻编队/远烟柱）
  narrative = HOST.makeNarrative(W.scene, W);
  // Phase 18：轻街机层（难度/分数/成就）——纯逻辑模块，经 HOST 工厂注册
  // （83 高编号，70 经槽位取用，拓扑同 79/80/81 先例）
  arcade = HOST.makeArcade();
  HOST.arcade = arcade;   // P18: 注册_arcade，供 16-targets 等槽位访问
  // Phase 19：敌方反击与生存（SAM/RWR/干扰弹/战损操控）——84 纯逻辑 +
  // 85 渲染薄层，经宿主工厂取用（拓扑同 79/80/81/83 先例）
  samwar = HOST.makeSamWar();
  samvis = HOST.makeSamVis(W.scene, samwar);
  // Phase 19：机务损伤与特情处置（86-damage 纯逻辑）——AA/SAM 命中经
  // _dmgApply 按方位分配到四子系统，派生量（振动/漂移/卡壳/散布/HUD 失效）
  // 逐帧下发既有通道
  damageSys = HOST.makeDamage();
  // Phase 20：可玩纵切片——A2A 敌机（87 纯逻辑 + 88 渲染薄层：敌机只做
  // 视觉镜像与武器链桥接，fx 复用 rig 爆炸/烟尘池）；资源压力（89 燃油/
  // 补给窗）；战役存档与评级（90）。全部经 HOST 工厂取用（拓扑同款）。
  enemyAir = HOST.makeEnemyAir();
  enemyVis = HOST.makeEnemyVis(W.scene, enemyAir, rig);
  rig.enemyAir = enemyVis;            // 65-weapons 5 处对空链经此桥接敌机
  rig.narrative = narrative;          // Phase 21：65-weapons 命中链桥接基地设施打击层（运行时注入，拓扑安全）
  resources = HOST.makeResources();
  campaign = HOST.makeCampaign();
  progress = HOST.makeProgress();   // P2：游戏模式存档 v2（关卡星级/解锁；首建时迁移 v1 战役档）
  // 空中打击目标（P4）：无人机/热气球/靶机，机炮可对空射击
  air = new AirTargets(W.scene, W);
  air.fx = rig;
  air.onToast = toast;
  rig.airTargets = air;
  // 打击反馈闭环：音效回调 + 命中标记 + 击杀确认（统一计数+信息流）
  rig.onSfx = (t, p) => audio.playSfx(t, p);
  // P5-G2 敌方步兵小队（27-infantry）：机炮逐弹检测 + 爆炸波及 + 击毙计分
  infantry = new Infantry(W.scene);
  infantry.range = targets; infantry.fx = rig; infantry.onToast = toast;
  infantry.onKill = (label) => {
    killFeed(label);
    if (arcade && S._mission && S._mission.phase === 'active') arcade.onKill('infantry', S._mission);
  };
  rig.onInfantryHit = (p) => {
    const h = infantry.bulletHit(p);
    const m = S._mission;
    if (h && m && !m.done) { const hb = m.hitsBy || (m.hitsBy = { 1: 0, 2: 0, 3: 0 }); hb[1]++; m.infHits = (m.infHits || 0) + 1; }   // P5-G4：步兵命中只进分武器统计，不改命中率口径
    return h;
  };
  rig.onBlast = (x, y, z, t) => { scenery.blast(x, y, z, t); infantry.blast(x, y, z, t); };   // 爆炸波及远景树（31-scenery）+ 步兵
  rig.onTreeHit = (p, d) => scenery.bulletHit(p, d);         // 机炮打树：飞叶/打断
  rig.onHitMark = () => hitMark();
  targets.onSfx = rig.onSfx;
  targets.onHitFx = () => {
    rig.onHitMark();
    const m = S._mission;
    if (m && !m.done) {
      m.hits++;
      const hb = m.hitsBy || (m.hitsBy = { 1: 0, 2: 0, 3: 0 });   // P5-G4 战报：分武器命中
      const pw = targets._hitPow >= 3 ? 3 : targets._hitPow === 2 ? 2 : 1;
      hb[pw]++;
    }
  };
  // P8：机体受击反馈——损伤分级 toast + 受损后果（散布惩罚/武器卡壳）在此派生
  targets.onHeliHit = (dmg, hitPos) => {
    toast(`机体受损（Lv.${Math.min(3, Math.ceil(dmg / 4))}）——注意规避反击`);
    if (rig) rig._dmgPenalty = Math.min(0.5, dmg * 0.06)   // 散布惩罚：每伤 0.06，上限 +50%
      + (damageSys ? damageSys.fx().spreadAdd : 0);   // Phase 19：武器系统散布追加（事件驱动，保 D2 断言语义）
    if (audio) audio.playSfx('hit');
    // P5-G1 受击反馈：红色暗角 + 来向弧标 + 火花（来向优先用曳光反推点）
    _hitFeedback(targets._lastHitFrom || hitPos);
    if (S._mission && !S._mission.done) S._mission.hitsTaken = (S._mission.hitsTaken || 0) + 1;   // P5-G4 战报：中弹次数
    targets._lastHitFrom = null;
    // Phase 19：命中方位 → 四子系统确定性分配（86-damage 纯逻辑）
    _dmgApply(dmg, hitPos ? hitPos.x : null, hitPos ? hitPos.y : null, hitPos ? hitPos.z : null);
  };
  air.onKill = (label, type) => { _kills++; S._slowmo = 0.55; S._flash = 0.5; S._shake = 1.0; killFeed(label); updateTargetHUD(null); if (arcade && S._mission && S._mission.phase === 'active') { arcade.onKill(type, S._mission); } };
  // 机体夜间指示灯（航行灯/信标/频闪）：先建灯再绑倒影，灯珠才能进镜像
  nlights = new NightLights(apache);
  nlights.syncEnv(S.env);
  // P5-A(C)：机体环境反射强度按当前环境预设初始化（boot 的 applyPreset 时
  // apache 尚未建成触达不到；此后切换由 setEnv 事件驱动）
  apache.setEnvIntensity(ENV_PRESETS[S.env]);
  // 湖面倒影（P3-⑦）：镜像克隆整机，仅湖面场地启用
  refl = new WaterReflection(W.scene, WATER_Y);
  // PERF-AUDIT C1：夜航灯组/搜索灯/仪表光斑必须进动态名单——24-navlights
  // 的 bindMirror 靠 _pairs 找灯珠镜像恢复自发光材质，静态烘焙会吞掉它们
  refl.bind(apache, nlights ? [nlights.g, nlights.search, nlights.dash] : null);
  nlights.bindMirror(refl);              // 灯珠镜像恢复自发光（夜水倒影可见闪烁）
  // 批 E：机体阴影代理（静态 mesh 合并投影；须在 refl.bind 深拷贝之后）
  apache.buildShadowProxy(nlights ? [nlights.g, nlights.search, nlights.dash] : null);
  refl.syncLighting(ENV_PRESETS[S.env]);
  // 特效密度按当前画质档位补齐（washfx 在 boot 的 applyQuality 之后才存在）
  washfx.setQualityEffects(qualityPreset(S.quality).effects);
  // 第一人称驾驶 + 瞄准（悬停时按 C 进入）
  fp = new FPView({ apache, W, orbit, canvas, rig, targets, airTargets: air, enemyAir: enemyVis });
  fp.onSfx = t => audio.playSfx(t);
  HOST.fp = fp;                       // Phase 14-A：FPV 实例注册（01-host modeState 取用）
  // 浏览器自动播放策略：首次任意手势后启动音频上下文。
  // 两个入口都要在成功后摘掉——旧实现只摘了 pointerdown，keydown 会一直挂着，
  // 之后每次按键都白跑一次 ensureStarted + setMedium（驾驶时按键极密集）。
  const audioKick = () => {
    audio.ensureStarted();
    audio.setMedium(W.terrainKey === 'pad' ? 'dust' : W.terrainKey === 'grass' ? 'grass'
      : W.terrainKey === 'water' ? 'spray' : 'sand');
    // Phase 13-S4：配乐随音频上下文启动（幂等），默认展示氛围垫乐
    if (music) { music.start(); if (music.mode === 'idle') music.setMode('ambient'); }
    // 最终闭环修复（挂起恢复）：仅确认上下文 running 后才移除重量级首次启动
    // 监听器；并永久保留轻量恢复路径（resumeKick 只做 resume，不重建节点——
    // 浏览器切后台/设备切换致 suspended/interrupted 后，手势即可恢复）
    if (audio.ctx && audio.ctx.state === 'running') {
      removeEventListener('pointerdown', audioKick);
      removeEventListener('keydown', audioKick);
      const resumeKick = () => audio.ensureStarted();   // ctx 已有：running 时零开销
      addEventListener('pointerdown', resumeKick);
      addEventListener('keydown', resumeKick);
    }
  };
  addEventListener('pointerdown', audioKick);
  addEventListener('keydown', audioKick);
  buildViewBar();
  HOST.bindUI();   // Phase 1-A：经宿主调用（72-uibind 注册，消除反向引用）
  appModeInit();   // P1：主菜单 / 展示 / 游戏（须在 bindUI 之后：依赖 HOST.setPlayMode）
  // P10：重点部件细节件（受控低模增量）。低压档下 setQuality(<1) 不加载；
  // 异步加载失败自动回退（fallback 报告），不影响场景。
  dp = new DetailParts(apache);
  dp.setQuality(S.quality);
  rescue = new Rescue(W.scene);
  rescue.onToast = toast;
  rescue.setTerrain(W.terrainKey);
  orbit.flyTo(VIEWS[0], 0.01);
  setTimeout(() => loading.classList.add('done'), 260);
  requestAnimationFrame(loop);
}

// ---------- UI 绑定 ----------

// bindUI 及全部事件绑定见 72-uibind.js（P0 拆分）

// 启动必须位于全部 70-* 文件之后（拼接顺序按文件名，70-start.js 为该组最后一个）：
// boot() 同步段会调 applyQuality 等，要求 70-* 顶层 const 均已初始化。
boot();
