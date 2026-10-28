// ============================================================
// 70-combat.js — 作战子系统帧逻辑（SAM / 机务损伤 / A2A 敌机 / 资源）+ 命中方位换算
// ============================================================
// 2026-10-12 自 70-app.js 拆出（纯搬移 + 帧逻辑提成具名函数，行为不变）。
// 同前缀 70-* 文件在拓扑检查里同级（互引不算反向引用），拼接顺序按文件名。

// Phase 19 scratch：SAM 威胁环境（每帧复用同一对象改写——零每帧分配纪律）
const _swEnv = { dt: 0, aaOn: false, heli: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
  sites: [], siteN: 0, aaRate: 1, aaDmg: 1 };
for (let i = 0; i < 10; i++) _swEnv.sites.push({ x: 0, z: 0 });   // 靶标上限 10
const _swPrev = { x: 0, y: 0, z: 0, has: false };                  // 上帧机体位（速度差分）
// Phase 20 scratch：A2A 敌机环境（87 update 喂入）+ 资源环境（89 喂入）——
// 同一对象逐帧改写（零每帧分配纪律；_eaF 是机头向量的 THREE scratch）
const _eaEnv = { dt: 0, heli: { x: 0, y: 0, z: 0 }, stability: 1,
  aim: { x: 0, y: 0, z: 1 }, aaRate: 1, aaDmg: 1, res: 1 };
const _eaF = new THREE.Vector3();
const _rsEnv = { dt: 0, active: false, strength: 0, homeDist: 0, alt: 0, stability: 1, variant: 'standard' };

// Phase 19：命中方位换算到机体系并喂给 86-damage（确定性扇区分配）。
// 世界向量 → 机体系：绕 Y 反旋 yaw（机头 +Z 为前）；无命中位（测试直调
// onHeliHit 传 null）时用 front 缺省扇区——不炸不猜。dir 字面量是事件级
// 分配（命中频率 ≤1/s），不违"零每帧分配"纪律（与爆炸 _puff opts 同款）。
function _dmgApply(delta, wx, wy, wz) {
  if (!damageSys || !(delta > 0)) return;
  let dx = 0, dy = 0, dz = 1;
  if (apache && wx !== null && wx !== undefined && Number.isFinite(wx)) {
    const hp = apache.root.position;
    const ox = wx - hp.x, oy = wy - hp.y, oz = wz - hp.z;
    const cy = Math.cos(FLY.yaw), sy = Math.sin(FLY.yaw);
    dx = ox * cy - oz * sy;
    dz = ox * sy + oz * cy;
    dy = oy;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
  }
  damageSys.applyHit({ dmg: delta, dir: { x: dx, y: dy, z: dz } });
}

// ---- P5-G1 受击反馈（2026-10-16）----
// 被打中时：屏幕四周红色暗角闪一下 + 指向火力来向的红色弧形标记（绕屏幕中心，
// 上=正前方）+ 机身溅几点火花。全部挂在 onHeliHit 一个入口（防空炮/导弹/敌机共用）。
// DOM 由脚本动态建（不进模板，不占 DOM ID 契约）；CSS 动画自己淡出，无每帧开销。
let _hitEl = null, _hitArc = null;
const _hfV = new THREE.Vector3(), _hfF = new THREE.Vector3();
function _hitFeedback(src) {
  radioSay('hit');   // E2 无线电
  if (!_hitEl) {
    const st = document.createElement('style');
    st.textContent = '#p5-hitvig{position:fixed;inset:0;pointer-events:none;z-index:40;opacity:0;' +
      'background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(170,0,0,.55) 100%)}' +
      '#p5-hitvig.on{animation:p5hv .9s ease-out}' +
      '#p5-hitarc{position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:41;opacity:0}' +
      '#p5-hitarc i{position:absolute;left:-90px;top:-200px;width:180px;height:50px;border-top:8px solid rgba(255,40,30,.9);' +
      'border-radius:50% 50% 0 0/100% 100% 0 0;filter:drop-shadow(0 0 6px rgba(255,0,0,.8))}' +
      '#p5-hitarc.on{animation:p5ha 1.6s ease-out}' +
      '@keyframes p5hv{0%{opacity:1}100%{opacity:0}}@keyframes p5ha{0%,40%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(st);
    _hitEl = document.createElement('div'); _hitEl.id = 'p5-hitvig';
    _hitArc = document.createElement('div'); _hitArc.id = 'p5-hitarc'; _hitArc.appendChild(document.createElement('i'));
    document.body.appendChild(_hitEl); document.body.appendChild(_hitArc);
  }
  const restart = (el) => { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); };
  restart(_hitEl);
  if (apache && src && Number.isFinite(src.x)) {
    const hp = apache.root.position;
    _hfV.set(src.x - hp.x, 0, src.z - hp.z);
    W.camera.getWorldDirection(_hfF); _hfF.y = 0;
    if (_hfV.lengthSq() > 1e-4 && _hfF.lengthSq() > 1e-6) {
      _hfV.normalize(); _hfF.normalize();
      // 屏幕顺时针角：右侧为正（相机右向量 = forward × up 的反向）
      const right = _hfF.z * _hfV.x - _hfF.x * _hfV.z;   // (f × v).y 的相反数
      const ang = Math.atan2(-right, _hfF.x * _hfV.x + _hfF.z * _hfV.z);
      _hitArc.style.transform = 'rotate(' + ang.toFixed(3) + 'rad)';
      restart(_hitArc);
    }
  }
  if (rig && apache) {
    const hp = apache.root.position;
    for (let i = 0; i < 4; i++) {
      rig._puff(hp.x + (rnd() - 0.5) * 1.6, hp.y + 0.6 + rnd() * 0.8, hp.z + (rnd() - 0.5) * 1.6,
        { color: 0xffd27a, s0: 0.08, s1: 0.35, life: 0.18, base: 0.9, add: true });
    }
  }
}

// 以下 _tick* 由 70-loop.js 的 loop() 在 if (apache) 段内按原顺序逐帧调用。
function _tickSamwar(dt) {
  // Phase 19：SAM 威胁（纯逻辑）。组装 scratch 环境 → update → 消费事件；
  // 交战门控与 AA 同语义（靶场启用 + 离地 + 距基地 8~55u），难度系数同源。
  if (samwar) {
    const E = _swEnv, hp = apache.root.position;
    E.dt = dt;
    const bsw = (targets && targets.enabled && targets.baseCenter)
      ? Math.hypot(hp.x - targets.baseCenter.x, hp.z - targets.baseCenter.z) : -1;
    E.aaOn = bsw > 8 && bsw < 55 && hp.y > 2 && !targets.passive;   // P3：训练关靶场不还击
    E.heli.x = hp.x; E.heli.y = hp.y; E.heli.z = hp.z;
    if (_swPrev.has && dt > 1e-5) {
      E.heli.vx = (hp.x - _swPrev.x) / dt; E.heli.vy = (hp.y - _swPrev.y) / dt; E.heli.vz = (hp.z - _swPrev.z) / dt;
    } else { E.heli.vx = 0; E.heli.vy = 0; E.heli.vz = 0; }
    _swPrev.x = hp.x; _swPrev.y = hp.y; _swPrev.z = hp.z; _swPrev.has = true;
    E.siteN = 0;
    if (targets) for (const t of targets.targets) {
      if (t.alive && E.siteN < 10) { const s = E.sites[E.siteN++]; s.x = t.pos.x; s.z = t.pos.z; }
    }
    // Phase 21 SEAD：雷达 = 防空搜索/发射机。摧毁雷达 → 致盲防空 → siteN 置 0
    // → samwar 交战门（84:134 engage=aaOn&&siteN>0）断开，转 idle（RWR 静默、
    // 停止发射）。这是 SEAD 闭环的唯一逻辑改动；84-samwar 零改动。雷达开局存活
    // → 既有 SAM 行为逐位不变（零回归）。
    if (narrative && !narrative.radarAlive()) E.siteN = 0;
    const swd = arcade ? arcade.coeffs(S._mission) : null;
    E.aaRate = swd ? swd.aaRate : 1; E.aaDmg = swd ? swd.aaDmg : 1;
    samwar.update(E);
    // 发射事件 → toast + Betty 播报（RWR 告警链的听觉端）
    if (samwar.launchN !== S._swSeen) {
      S._swSeen = samwar.launchN;
      toast('导弹来袭——转向规避或按 J 投放干扰弹');
      if (betty) betty.warn('MISSILE LAUNCH', 4);
    }
    // 命中事件 → 走 P8 既有损伤链（_heliDmg 累计 / onHeliHit 散布惩罚 /
    // 受损烟 / ≥12 强制返航全部复用，不建第二套状态）
    if (targets && samwar.hitPending) {
      const h = samwar.hitPending;
      samwar.hitPending = null;
      targets._heliDmg += h.dmg;
      targets._threatHitFlash = 3;
      if (targets.onHeliHit) targets.onHeliHit(targets._heliDmg, h);
      S._flash = Math.max(S._flash, 0.5); S._shake = 1.0;
    }
    // 战损→操控惩罚。**必须复制值，不能替换引用**：penaltyFor 返回的是
    // SAM_PENALTY_TABLE 的共享条目（84-samwar.js:304），若把 S._pen 指向它，
    // 下面 damageSys 段的 `S._pen.speedMul = _swp.speedMul * fx.respMul` 就会
    // **写回表里**——respMul 常 < 1（旋翼任一等级受伤即 (1-rL*0.08)），于是每帧
    // 把表条目自乘一遍、惩罚逐帧复利。实测（注入 rotor=30）：speedMul 每 120ms
    // 从 0.659 → 0.311 → 0.160 → … → 0.022，0.7 秒内玩家前进/侧飞/转向全部归零，
    // 直升机变得不可操控。整套 76 项测试都覆盖不到（纯测试只测模块本体，
    // 浏览器测试未断言该值随帧的收敛性）。
    {
      const _swp0 = samwar.penaltyFor(targets ? targets._heliDmg : 0);
      S._pen.speedMul = _swp0.speedMul; S._pen.yawMul = _swp0.yawMul;
    }
  }
}

function _tickDamage(dt) {
  // Phase 19：机务损伤演化 + 事件消费 + 派生量下发（86-damage 纯逻辑）。
  // 注意：_dmgPenalty 不在此处重算（事件驱动在 onHeliHit——保 D2 断言）。
  if (damageSys) {
    // Phase 19-补二：firing = 本帧确在开火（机炮/火箭扳机按住——弹药耗尽
    // 自清；或地狱火在飞）——86-damage 按持续开火时长掷卡壳风险
    damageSys.update({ dt, airborne: FLY.state !== 'ground', alt: FLY.alt,
      firing: !!(rig && (rig.gunOn || rig.rocketOn || rig.flying.length > 0)) });
    const fx = damageSys.fx();
    S._dmgFx = fx;
    if (rig) { rig._jam = fx.jammed; rig._hfOff = !fx.hfOnline; }
    // 配平漂移（旋翼中重损的持续左偏——空中才漂）
    if (fx.trimDrift && FLY.state !== 'ground') FLY.yaw += fx.trimDrift * dt;
    // 操控惩罚合成：SAM 表 × 机务响应系数（持久对象写值，零分配）
    const _swp = samwar ? samwar.penaltyFor(targets ? targets._heliDmg : 0) : null;
    S._pen.speedMul = (_swp ? _swp.speedMul : 1) * fx.respMul;
    S._pen.yawMul = (_swp ? _swp.yawMul : 1) * fx.respMul;
    // 阈值跨级/处置结果/特情播报事件 → Betty 语音 + toast（复用既有链）。
    // 可发现性（Phase 19-补）：U/N/I 此前只在玩家按下后才提示——不知道的人
    // 永远不知道；这里在特情发生瞬间把处置键带进告警（just-in-time）。
    if (damageSys.events.length) {
      const EN = { rotor: '旋翼', engine: '引擎', weapons: '武器', avionics: '航电' };
      const EW = { rotor: 'ROTOR', engine: 'ENGINE', weapons: 'GUNS', avionics: 'AVIONICS' };
      for (const ev of damageSys.events) {
        if (ev.type === 'dmg') {
          if (betty) betty.warn(ev.level >= 4 ? EW[ev.sys] + ' FAILURE'
            : ev.level >= 3 ? EW[ev.sys] + ' DAMAGE' : 'CHECK ' + EW[ev.sys], 6);
          // 航电 Lv.2 起进入取模失效窗口（hudFail）——告警附带处置键。toast
          // 不属信息战黑名单（hudFail 只隐藏 HUD 读数元素：姿态/威胁/RWR/机务）
          const tip = (ev.sys === 'avionics' && ev.level >= 2)
            ? '——读数将间歇失效，按 I 重启（2 秒全黑）' : '';
          toast('机务告警：' + EN[ev.sys] + '损伤 Lv.' + ev.level + tip);
        } else if (ev.type === 'jamStart') {
          // 卡壳发生瞬间（86-damage 翻转检测；处置期自身的锁不算新卡壳）
          if (betty) betty.warn('GUNS JAMMED', 6);
          toast('武器卡壳——按 N 重新上膛');
        } else if (ev.type === 'overheat') {
          // 引擎超温瞬间（overheat 穿越沸腾点 1.0；U 降温回落后复燃会再报）
          if (betty) betty.warn('ENGINE OVERHEAT', 6);
          toast('引擎超温——按 U 降功率（持续降温，功率上限 -15%）');
        } else if (ev.type === 'jam') {
          if (betty) betty.warn(ev.ok ? 'GUNS ARMED' : 'GUNS JAMMED', 6);
          toast(ev.ok ? '重新上膛成功——武器恢复' : '上膛失败——武器仍卡壳（N 可再试）');
        } else if (ev.type === 'reboot') {
          if (betty) betty.warn(ev.ok ? 'AVIONICS RESTORED' : 'REBOOT FAILED', 6);
          toast(ev.ok ? '航电重启成功——读数恢复' : '重启失败——读数仍失效');
        }
      }
      damageSys.events.length = 0;
    }
  }
}

function _tickEnemyAir(dt) {
  // Phase 20：A2A 敌机（87 纯逻辑 + 88 视觉镜像）。env 组装同 SAM scratch
  // 模式；aim=机体机头单位向量（+Z 经 quaternion）——敌机"被持续瞄准"
  // 规避判定的输入。难度系数与 SAM 同源（arcade.coeffs 任务快照）。
  if (enemyAir) {
    const E = _eaEnv, hp = apache.root.position;
    E.dt = dt;
    E.heli.x = hp.x; E.heli.y = hp.y; E.heli.z = hp.z;
    E.stability = S._stability;
    _eaF.set(0, 0, 1).applyQuaternion(apache.root.quaternion);
    E.aim.x = _eaF.x; E.aim.y = _eaF.y; E.aim.z = _eaF.z;
    const cd = arcade ? arcade.coeffs(S._mission) : null;
    E.aaRate = cd ? cd.aaRate : 1; E.aaDmg = cd ? cd.aaDmg : 1;
    E.res = cd ? cd.res : 1;
    enemyAir.update(E);
    if (enemyVis) enemyVis.update(dt);
    // 敌机火力命中 → 走 P8 既有损伤链（与 SAM hitPending 同款单槽消费）
    if (targets && enemyAir.hitPending) {
      const h = enemyAir.hitPending;
      enemyAir.hitPending = null;
      targets._heliDmg += h.dmg;
      targets._threatHitFlash = 3;
      if (targets.onHeliHit) targets.onHeliHit(targets._heliDmg, h);
      S._flash = Math.max(S._flash, 0.5); S._shake = 1.0;
    }
    // 玩家击落敌机 → 计分（83-arcade enemy 分+ace 成就）+ 信息流 + 电影三件套
    if (enemyAir.killEvent) {
      const k = enemyAir.killEvent;
      enemyAir.killEvent = null;
      _kills++;
      // C005：制空作战——敌机击落数记到 mission 字段（loop 的续波/胜利判定读它）。
      // 与计分同门控（仅 active 局计数），简报期击落不计入战果。
      if (S._mission && S._mission.variant === 'air_superiority'
        && S._mission.phase === 'active') {
        S._mission._airKills = (S._mission._airKills || 0) + 1;
      }
      // P2：全变体击落计数（关卡附加目标 shoot_down 读它；与计分同门控）
      if (S._mission && S._mission.phase === 'active') S._mission._airDowns = (S._mission._airDowns || 0) + 1;
      S._slowmo = 0.55; S._flash = 0.5; S._shake = 1.0;
      killFeed(k.label);
      toast(`已击落：${k.label}`);
      if (music) music.brass();
      if (arcade && S._mission && S._mission.phase === 'active') arcade.onKill('enemy', S._mission);
      updateTargetHUD(null);
    }
  }
}

function _tickResources(dt) {
  // Phase 20：资源压力（89 燃油/补给窗）。strength 由飞行状态派生——
  // FPV 用速度合成（前向+侧飞/10+垂直/4，0~1 封顶），环绕模式方向键
  // 平移=满机动、悬停=0；任务 active 局才消耗（show/train 不耗油）。
  if (resources) {
    const R = _rsEnv, hp = apache.root.position;
    R.dt = dt;
    R.active = !!(S._mission && S._mission.phase === 'active' && !S._mission.frozen);
    R.strength = (fp && fp.active)
      ? Math.min(1, (Math.abs(fp.spd) + Math.abs(fp.vSide)) / 10 + Math.abs(fp.vy) / 4)
      : (keys['arrowup'] || keys['arrowdown'] || keys['arrowleft'] || keys['arrowright'] ? 1 : 0);
    R.homeDist = Math.hypot(hp.x, hp.z);
    R.alt = FLY.alt;
    R.stability = S._stability;
    R.variant = S._mission ? S._mission.variant : 'standard';
    resources.update(R);
    // 事件消费：低油告警（Betty+toast）/ 耗尽→迫降失败 / 补给完成→恢复满弹
    for (const ev of resources.events) {
      if (ev.type === 'warn1') { if (betty) betty.warn('LOW FUEL', 6); toast('燃油告急——规划返场补给'); }
      else if (ev.type === 'warn2') { if (betty) betty.warn('FUEL CRITICAL', 6); toast('燃油严重不足——立即返场！'); }
      else if (ev.type === 'fuelOut') { toast('燃油耗尽——迫降'); if (S._mission && !S._mission.frozen && S._mission.phase === 'active') failMission('fuel'); }
      else if (ev.type === 'resupplied') {
        applyVariantAmmo();
        if (targets) targets._heliDmg = Math.max(0, (targets._heliDmg || 0) - 6);
        if (damageSys) damageSys.reset();
        toast('【FARP 野战补给站】弹药满载 · 燃油注满 · 关键机务抢修完成！');
        if (betty) betty.speak('REARM COMPLETE');
      }
    }
    resources.events.length = 0;
  }
}
