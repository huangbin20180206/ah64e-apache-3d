// ============================================================
// 70-missiontick.js — 任务每帧 tick（自 70-mission.js 拆出）
// ============================================================
// 2026-11-08 P2-2：纯搬移，函数体一个字节不改。
// 文件名排在 70-mission.js 之后（i > .）且同属 70 段；70-loop.js 在
// loop() 函数体内调用 _tickMission/_tickMissionMaps，无顶层求值 TDZ 风险。
// 依赖由 tools/check_topology.mjs 分析后写入 docs/module-contracts.md。
// ============================================================

// ---------- 帧逻辑（70-loop.js loop() 在 if (apache) 段内调用） ----------
// 任务过场重试 / 接近基地触发 / 面板刷新与胜负判定 / 训练步骤推进
function _isTrainVariant() { return !!(S._mission && /^train_/.test(S._mission.variant || '')); }

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
  // P3：训练关——离地即开始（不靠接近基地触发，且需在过场未占用时）
  const isCutOn = !!(HOST.cutsceneState && (HOST.cutsceneState.isOn ? HOST.cutsceneState.isOn() : (HOST.cutsceneState.state && HOST.cutsceneState.state().on)));
  if (VTr && VTr.train && S._mission.phase === 'briefing' && FLY.state !== 'ground' && !isCutOn) beginMission();
  if (targets && targets.baseCenter && !S._baseFound && S.mode === 'mission' && !(VTr && VTr.train) && !isCutOn) {
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
        if (variantGoalMet(S._mission)) { completeMission(); }
        else if (_airWaveCleared()) { if (enemyAir) enemyAir.spawn(_airSupAnchor()); }
      }
      else if (S._mission.variant === 'endless' && S._mission.phase === 'active') {
        const m = S._mission;
        if (!m.wave) m.wave = 1;
        const groundCleared = targets && targets.aliveCount === 0;
        const airCleared = _airWaveCleared(true);
        if (groundCleared && airCleared) {
          m.wave++;
          // 本地修补 2026-10-29：83-arcade 只暴露 addBonus（无 addScore）。原写法在清波
          // 那一帧抛 TypeError，_tickMission 后半段（波次提示 / 目标重置 / 补新敌机）全部
          // 被跳过，且 0.5s 节流每轮复抛——无尽模式清场后战场永不刷新。
          if (arcade && arcade.addBonus) arcade.addBonus(2000 * (m.wave - 1));
          toast('【第 ' + (m.wave - 1) + ' 波肃清】第 ' + m.wave + ' 波敌军正在从战区外围集结！波次奖分 +' + (2000 * (m.wave - 1)));
          radioSay('done');
          if (betty) betty.speak('WAVE CLEARED');
          if (targets && targets.reset) {
            targets.reset();
            for (const t of targets.targets) {
              // 本地修补 2026-10-30：上游写 t.hpMax，但 16-targets 的血量字段是 hp0
              //（reset() 恢复 hp=hp0），hpMax 全库无定义 → 恒 undefined，"随波次
              // 加厚装甲"是死代码。改以 hp0 为基准按波次加成，上限 6（原公式同帽）。
              if (t.hp0) t.hp = Math.min(6, t.hp0 + Math.floor(m.wave / 2));
            }
          }
          if (air && air.reset) air.reset();
          if (infantry && infantry.reset) infantry.reset();
          if (enemyAir && enemyAir.spawn) {
            enemyAir.spawn(_airSupAnchor());
            if (enemyAir.units) {
              for (const u of enemyAir.units) u._withdrawNoticed = false;
            }
          }
        }
      }
      // P3：首飞/救援训练——完成条件与地面目标无关（全部下场 aliveCount 恒 0）
      const vv = S._mission.variant;
      if (S._mission.phase === 'active') _tickLevelThreat();
      if (vv === 'finale') {
        if (S._mission.phase === 'active') _tickFinale();
        if (S._mission.phase === 'active' && variantGoalMet(S._mission)) completeMission();
        else if (S._mission.phase === 'active' && (S.time - S._mission.t0) > missionTimeout()) failMission('timeout');
        else if (S._mission.phase === 'active' && targets._heliDmg >= 12) failMission('damage');
      }
      else if (vv === 'train_flight' || vv === 'train_rescue') {
        if (S._mission.phase === 'active' && variantGoalMet(S._mission)) completeMission();
        else if (S._mission.phase === 'active' && (S.time - S._mission.t0) > missionTimeout()) failMission('timeout');
      }
      // 本地修补 2026-10-30：①全歼分支补排除 endless——variantGoalMet 对 endless
      // 落 default:true，原写法在"地面清光但敌机还在"的常态下立即 completeMission()，
      // 无尽模式第一波地面清完即被误判通关（波次机制形同虚设）。②超时/损伤/弹药
      // 三条失败判定原是 else-if 链尾——timed_rescue/sead_strike 全歼地面但附加
      // 目标未完成时控制流停进提示分支，时限耗尽也永不判负（任务永久悬挂，违背
      // 411 行"等救援完成或变体时限耗尽失败"的承诺）。改为独立判定块，phase 守卫
      // 防重复结算；finale/train_flight/train_rescue 分支自带判定，维持原语义跳过。
      else if (targets.aliveCount === 0 && S._mission.variant !== 'air_superiority' && S._mission.variant !== 'endless') {
        if (variantGoalMet(S._mission)) { completeMission(); }
        else if (S._mission.variant === 'timed_rescue') {
          if (!S._mission._rescueHint) { S._mission._rescueHint = true; toast('目标已全歼——还需完成救援：放绞车救起并送抵停机坪'); }
        } else if (S._mission.variant === 'sead_strike') {
          // Phase 24：地面全歼但雷达/防空车未清 → 不结算，给 SEAD 指引（仿限时救援）
          if (!S._mission._seadHint) { S._mission._seadHint = true; toast('地面已清剿——还需摧毁敌雷达站与防空发射车完成 SEAD'); }
        }
      }
      if (vv !== 'finale' && vv !== 'train_flight' && vv !== 'train_rescue') {
        if (S._mission.phase === 'active' && (S.time - S._mission.t0) > missionTimeout()) { failMission('timeout'); }
        // P8：损伤过重失败——损伤 ≥12（Lv.3 顶格）强制返航，归因可解释（有分级、有恢复=重试）
        else if (S._mission.phase === 'active' && targets._heliDmg >= 12) { failMission('damage'); }
        // Phase 20-B：弹药耗尽失败——三类弹药全空且目标未全歼（无尽模式支持飞回 FARP 补给，不直接判负）
        else if (S._mission.phase === 'active' && resources
          && resources.ammoDry(rig ? rig.gunAmmo : 0, rig ? rig.rocketAmmo : 0, rig ? rig.hfAmmo : 0)
          && targets.aliveCount > 0) {
          if (vv === 'endless') {
            if (!S._mission._ammoHint) {
              S._mission._ammoHint = true;
              toast('⚠ 弹药已耗尽——请立即飞回 FARP 停机坪 (0,0) 低空悬停补给弹药！');
            }
          } else {
            failMission('ammo');
          }
        }
      }
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
      const inCut = !!(HOST.cutsceneState && HOST.cutsceneState.isOn && HOST.cutsceneState.isOn());
      // 新一局/重试：停在地面时放回峡谷南端（过场期间不抢占 needSpawn）
      if (cy.needSpawn && FLY.state === 'ground' && !inCut) {
        cy.needSpawn = false;
        FLY.x = cy.spawn.x; FLY.z = cy.spawn.z; FLY.yaw = cy.spawn.yaw; FLY.alt = 0;
      }
      // 雷达锁定命中 → 走 P8 既有损伤链（过场期间不产生雷达伤害）
      if (inCut) {
        cy.hitPending = null;
        cy.exposure = 0;
      } else if (cy.hitPending) {
        const h = cy.hitPending;
        cy.hitPending = null;
        const cdm = arcade ? arcade.coeffs(S._mission) : null;
        const hitDmg = h.dmg * (cdm ? cdm.aaDmg : 1);
        targets._heliDmg += hitDmg;
        targets._threatHitFlash = 3;
        targets._hitSrc = 'radar';   // 死因分析：峡谷雷达锁定打击
        if (Number.isFinite(h.sx)) targets._lastHitFrom = new THREE.Vector3(h.sx, 0.8, h.sz);
        if (targets.onHeliHit) targets.onHeliHit(targets._heliDmg, h, hitDmg);
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
