// ============================================================
// 70-hud.js — HUD 与后处理帧逻辑（光晕/体积光/景深/白闪、模式徽标、RPM/弹药/FPS/引导）
// ============================================================
// 2026-10-12 自 70-app.js 拆出（纯搬移 + 帧逻辑提成具名函数，行为不变）。
// 同前缀 70-* 文件在拓扑检查里同级（互引不算反向引用），拼接顺序按文件名。

function syncFlyText() {
  const m = { ground: '地面', up: '起飞中', hover: '悬停', down: '降落中' };
  UI('fly-state').textContent = m[FLY.state];
  const b = UI('btn-fly');
  b.textContent = FLY.state === 'ground' ? '起飞 (T)' : FLY.state === 'hover' ? '降落 (T)' : '飞行中…';
  b.classList.toggle('on', FLY.state !== 'ground');
}

  // 电影镜头包 S2/S3：太阳屏幕投影（光晕）+ 白闪/震屏衰减 + 击毁慢动作。
  // timeScale 只作用于 dt（整个模拟放慢），白闪/震屏衰减用原始 rawDt。
// 返回 timeScale（慢动作 0.25，否则 1）；后续模拟的 dt 须乘以它。
// E3：相机看向太阳的视线被多少烟柱挡住（0..0.8）。烟柱近似为残骸上方竖直圆柱
//（半径 2.4u、高 10u；明火期浓、阴燃期淡），只算正在燃烧的残骸。
const _ssD = new THREE.Vector3();
function _smokeSunOcc() {
  if (!targets || !targets.enabled || !W.sun) return 0;
  const C = W.camera.position;
  _ssD.copy(W.sun.position).normalize();
  const hx = _ssD.x, hz = _ssD.z, h2 = hx * hx + hz * hz;
  if (h2 < 1e-4) return 0;
  let occ = 0;
  for (const t of targets.targets) {
    if (t.alive || !(t.burn > 0) || !t.wreck) continue;
    const w = t.wreck.position;
    const s = ((w.x - C.x) * hx + (w.z - C.z) * hz) / h2;   // 视线水平投影上离烟柱最近处
    if (s <= 0) continue;
    const py = C.y + s * _ssD.y;
    if (py < 0 || py > 10) continue;
    const dx = C.x + s * hx - w.x, dz = C.z + s * hz - w.z;
    const dh = Math.sqrt(dx * dx + dz * dz);
    if (dh > 2.4) continue;
    const dens = t.burn > (t.burn0 || 22) * 0.4 ? 0.6 : 0.3;
    occ += dens * (1 - dh / 2.4);
  }
  return Math.min(0.8, occ);
}

function _tickPostFx(rawDt) {
  const ts = S._slowmo > 0 ? 0.25 : 1;
  if (S._slowmo > 0) S._slowmo = Math.max(0, S._slowmo - rawDt);
  if (S._flash > 0) S._flash = Math.max(0, S._flash - rawDt * 2.2);
  if (S._shake > 0) S._shake = Math.max(0, S._shake - rawDt * 2.8);
  // 太阳方向（世界）投影到屏幕：屏内才有光晕（强度随预设天空太阳强度）
  _v.copy(W.sun.position).normalize().multiplyScalar(300).add(W.camera.position).project(W.camera);
  composer.sunPos.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
  const onScreen = _v.z < 1 && composer.sunPos.x > -0.15 && composer.sunPos.x < 1.15
                && composer.sunPos.y > -0.15 && composer.sunPos.y < 1.15;
  composer.flare = onScreen ? clamp(ENV_PRESETS[S.env].skySunI * 0.55, 0.2, 1.0) : 0;
  // M3 体积光：强度随预设天空太阳（黄昏最强/正午中/夜间弱）+ 沙暴尘隙加成；
  // 太阳屏外时 Composer 内部自动跳过光柱 pass（uGod=0）。godCol=太阳光色
  //（W.sun.color 线性域，dusk 暖橙 → 光柱着色自然）
  composer.god = onScreen
    ? clamp(ENV_PRESETS[S.env].skySunI * 0.22 * (S.weather === 'sand' ? 1.8 : 1), 0, 0.9)
    : 0;
  composer.godCol.copy(W.sun.color);
  // E3 浓烟遮日：相机→太阳视线穿过燃烧残骸烟柱时，光晕/光柱减弱、阳光变暗（最多 −45%）
  const occ = _smokeSunOcc();
  S._smokeOcc = lerp(S._smokeOcc || 0, occ, Math.min(1, rawDt * 3));
  const ko = S._smokeOcc;
  composer.flare *= 1 - ko; composer.god *= 1 - ko;
  if (W.sun.intensity !== S._sunSet) S._sunBase = W.sun.intensity;   // 预设/天气改过阳光 → 重取基准
  if (S._sunBase != null) { S._sunSet = S._sunBase * (1 - 0.45 * ko); W.sun.intensity = S._sunSet; }
  // M2 景深：仅 FPV 模式启用——锁定目标时聚焦目标距离（目标清晰/背景散焦），
  // 无锁定聚焦默认 45u（P16 验收修复：原 12u 近焦把 35~48u 交战区靶标环
  // 整片散焦，用户"目标模糊/不能瞄准"——改用战场距离保搜索视野清晰；
  // 锁定后仍精确聚焦目标，lockD 路径不变）；环绕模式关闭。0.75 档由
  // composer.dofOn=false 门控，uDof=0 零开销
  if (composer.dofOn && KC.on) {
    // E1 击毁特写：对焦爆炸点
    composer.focus = Math.max(2, W.camera.position.distanceTo(_v.set(KC.x, KC.gy + 1, KC.z)));
    composer.dof = 0.7;
  } else if (composer.dofOn && fp && fp.active) {
    composer.focus = (fp.lockD && fp.lockD > 1) ? fp.lockD : 45;
    composer.dof = 0.85;
  } else if (composer.dofOn && S._photo) {
    // P4c 摄影模式：对焦机体（相机到机身距离），前后景散焦
    composer.focus = Math.max(2, W.camera.position.distanceTo(apache.root.position));
    composer.dof = 0.9;
  } else {
    composer.dof = 0;
  }
  // P4c：展示模式降低颗粒与色散（游戏模式保持电影质感）；摄影模式再干净一档
  const _show = appState.mode === 'show' || appState.mode === 'menu';
  composer.grain = S._photo ? 0.15 : _show ? 0.35 : 1.0;
  composer.chroma = S._photo ? 0.3 : _show ? 0.45 : 1.0;
  composer.flash = S._flash || 0;
  composer.shake = (S._shake || 0) * 0.012;
  return ts;   // 调用方 dt *= 返回值（慢动作 timeScale）
}

  // P14-B+E：模式/输入状态徽标——每帧只读派生，状态翻转才写 DOM（dataset 缓存
  // 比较）。Phase 19 性能审计 A1：原实现经 HOST.modeState() 每帧新建 2 个对象
  // （modeState 返回对象 + cutscene.state() 返回对象，稳态 ~120 对象/s 进新生代）。
  // 这里改为直接读既有标量（fp.active / cutscene.on / cinema.on / S._mission.phase
  // / S.mode），派生优先级与 modeState() 保持一致（cutscene > cinematic > fp）；
  // modeState() 本体保留给 __dbg 与 P14 测试契约。**注意：首版声称"零行为差异"
  // 与事实不符**——cutscene 活跃态读错属性名，造成两条既有测试回归，已修（见下方注释）。
function _tickModeChip() {
  const fpOn = !!(fp && fp.active);
  const cinOn = !!(HOST.cinemaState && HOST.cinemaState.on);
  // cutscene 活跃态必须与 01-host modeState() 同源：该对象暴露的是 state() 方法，
  // 顶层没有 .on。Phase 19 的"零分配"优化版此处只读了 .on，导致 cutOn 恒为 false、
  // chip 永远显示不出"过场影像"——合并后实测 69/73，test_mode_chip 与
  // test_phase14_feedback 双双卡死超时，且单独跑同样失败（非抖动，是真回归）。
  let cutOn = false;
  if (HOST.cutsceneState && HOST.cutsceneState.state) cutOn = !!HOST.cutsceneState.state().on;
  else if (HOST.cutsceneState) cutOn = !!HOST.cutsceneState.on;
  let label = '';
  let warn = false;
  if (cutOn || cinOn) label = '过场影像';
  else if (fpOn) label = '第一人称';
  else if (S._mission && S._mission.phase === 'briefing') label = '任务·简报';
  else if (S._mission && S._mission.phase === 'active') label = '任务·进行中';
  else if (S._mission && S._mission.phase === 'done') label = '任务·完成';
  else if (S._mission && S._mission.phase === 'failed') label = '任务·失败';
  else if (S.mode === 'mission') label = '任务';
  else if (S.mode === 'train') label = '训练';
  else label = '展示';
  // 输入不可用原因：仅 FPV 模式且指针未锁定
  if (fpOn && !document.pointerLockElement) { label += ' · 指针未锁定'; warn = true; }
  const ch = UI('mode-chip');
  if (ch && (ch.dataset.v !== label || ch.dataset.w !== String(warn))) {
    ch.dataset.v = label; ch.dataset.w = String(warn);
    ch.textContent = label;
    ch.classList.toggle('warn', warn);
  }
}

function _tickHud(dt, s, rpm) {
  // HUD：RPM 变化超过 1 才刷 DOM
  const ri = Math.round(rpm);
  if (ri !== S._rpmShown) {
    S._rpmShown = ri;
    UI('hud-rpm').textContent = String(ri);
    UI('rpm').textContent = String(ri);
    UI('rotor-pct').textContent = (s * 100).toFixed(0);
    UI('rotor-fill').style.width = (s * 100).toFixed(1) + '%';
  }
  // 武器弹药读数（变化才刷 DOM）
  if (rig) {
    if (rig.gunAmmo !== S._ga) { S._ga = rig.gunAmmo; UI('v-gun').textContent = String(rig.gunAmmo); }
    if (rig.rocketAmmo !== S._rk) { S._rk = rig.rocketAmmo; UI('v-rk').textContent = String(rig.rocketAmmo); }
    if (rig.hfAmmo !== S._ha) { S._ha = rig.hfAmmo; UI('v-hf').textContent = String(rig.hfAmmo); }
  }
  S._fa++; S._ft += dt;
  if (S._ft >= 0.5) {
    const fps = S._fa / S._ft;
    UI('hud-fps').textContent = fps.toFixed(0);
    // 自动降档（P0-④ 防抖+滞回+冷却；P2-A1 修死变量 + 开关）：
    //   降档阈值 <38fps / 恢复提示阈值 >48fps（滞回差 10fps 防止阈值附近反复跳档）
    //   连续 3 个采样窗（约 1.5s）低于阈值才触发；冷却 = _qCool 采样窗倒计时
    //   （降档/切场景/切环境/手动选画质时置 10 ≈ 5s，防止切换瞬间的短暂掉帧误触）
    //   用户手动选过档位或勾选"停用自动降档"后彻底让位
    // P4e 自动画质：逐档 低0.75 ↔ 正常1 ↔ 高1.5。降一档后把上限压到降档前的下一档（_qCeil），防止来回跳
    if (!S._qManual && !S._qAutoOff) {
      S._qCool = Math.max(0, S._qCool - 1);   // 冷却倒计时（切场景/环境/画质后短暂豁免）
      S._slow = fps < 38 ? (S._slow || 0) + 1 : 0;
      S._up = fps > 55 ? (S._up || 0) + 1 : 0;
      const STEPS = [0.75, 1, 1.5];
      const cur = STEPS.reduce((b, v) => (S.quality >= v ? v : b), 0.75);
      const i = STEPS.indexOf(cur);
      if (S._qCeil === undefined) S._qCeil = 1.5;
      if (S._qCool <= 0 && S._slow >= 3 && i > 0) {
        S._slow = 0; S._up = 0; S._qAuto = true; S._qCool = 10;
        S._qCeil = STEPS[i - 1];
        UI('sel-quality').value = String(STEPS[i - 1]);
        applyQuality(STEPS[i - 1]);
        toast('画面有点卡，已自动调低画质');
      } else if (S._qCool <= 0 && S._up >= 20 && i < 2 && STEPS[i + 1] <= S._qCeil) {
        S._up = 0; S._slow = 0; S._qCool = 10;
        UI('sel-quality').value = String(STEPS[i + 1]);
        applyQuality(STEPS[i + 1]);
        toast('电脑跑得很顺，已自动调高画质');
      }
    }
    UI('hud-draw').textContent = String(composer.drawCalls || 0);
    UI('hud-alt').textContent = (FLY.alt * 2).toFixed(0);   // 1u ≈ 2m
    // P8：威胁 HUD（节流随 0.5s 刷新块）——等级文字 + 最近受击闪红
    if (targets) {
      const t = targets._threat || 0;
      const tEl = UI('hud-threat');
      const tTxt = ['无', '低', '中', '高'][Math.min(3, t)];
      if (tEl.dataset.v !== tTxt || tEl.dataset.flash !== String(t === 3)) {
        tEl.dataset.v = tTxt; tEl.dataset.flash = String(t === 3);
        tEl.textContent = tTxt;
        tEl.style.color = t === 3 ? 'var(--warn)' : t === 0 ? '' : 'var(--accent2)';
      }
    }
    // Phase 18：分数/连击 HUD（同 0.5s 节流块；dataset 缓存只写变化）
    if (arcade) {
      const sEl = UI('hud-score');
      if (sEl && sEl.dataset.v !== arcade.score) { sEl.dataset.v = arcade.score; sEl.textContent = String(arcade.score); }
      const cEl = UI('hud-combo');
      if (cEl) {
        const on = arcade.combo > 1;
        if (cEl.dataset.v !== String(on ? arcade.combo : '')) {
          cEl.dataset.v = on ? String(arcade.combo) : '';
          cEl.textContent = String(arcade.combo);
          const wrap = cEl.parentElement;
          if (wrap) wrap.style.display = on ? '' : 'none';
        }
      }
    }
    // Phase 19：RWR / 干扰弹 HUD（同 0.5s 节流块；dataset 缓存只写变化）
    if (samwar) {
      const rEl = UI('hud-rwr');
      // Phase 22：SEAD 可读性——雷达已毁（防空致盲）时 idle 态显"压制"而非"安全"，
      // 让玩家看到 SEAD 成果（读 narrative.radarAlive，不改 81）
      const suppressed = samwar.phase === 'idle' && narrative && !narrative.radarAlive();
      const rTxt = samwar.phase === 'launch' ? '来袭' : samwar.phase === 'lock' ? '锁定'
        : samwar.phase === 'track' ? '扫描' : suppressed ? '压制' : '安全';
      if (rEl && rEl.dataset.v !== rTxt) {
        rEl.dataset.v = rTxt;
        rEl.textContent = rTxt;
        rEl.style.color = samwar.phase === 'launch' ? 'var(--warn)'
          : (samwar.phase !== 'idle' || suppressed) ? 'var(--accent2)' : '';
      }
      const fEl = UI('hud-flare');
      if (fEl && fEl.dataset.v !== String(samwar.flares)) {
        fEl.dataset.v = String(samwar.flares);
        fEl.textContent = String(samwar.flares);
      }
    }
    // Phase 19：机务告警 HUD（四系统最高级缩写）+ 航电失效窗口守卫
    if (damageSys) {
      const st = damageSys.state();
      const mxEl = UI('hud-mx');
      if (mxEl) {
        const L = st.levels;
        const AB = { rotor: 'ROT', engine: 'ENG', weapons: 'WPN', avionics: 'AVN' };
        let bk = null, bl = 0;
        for (const k of ['rotor', 'engine', 'weapons', 'avionics']) if (L[k] > bl) { bl = L[k]; bk = k; }
        const mxTxt = (st.hudFail || st.hudDead) ? '---' : bk ? AB[bk] + ' ' + bl : 'OK';
        if (mxEl.dataset.v !== mxTxt) {
          mxEl.dataset.v = mxTxt;
          mxEl.textContent = mxTxt;
          mxEl.style.color = bl >= 3 ? 'var(--warn)' : bl >= 1 ? 'var(--accent2)' : '';
        }
      }
      // 航电失效/重启全黑：姿态/威胁/RWR 读数写 ---（信息战语义）
      if (st.hudFail || st.hudDead) {
        UI('hud-alt').textContent = '---';
        UI('hud-threat').textContent = '---';
        const rEl2 = UI('hud-rwr'); if (rEl2) rEl2.textContent = '---';
      }
    }
    // Phase 20：燃油 HUD（任务局显示；补给窗口内改显进度——dataset 缓存只写变化）
    if (resources) {
      const fw = UI('hud-fuel-wrap'), fb = UI('hud-fuel');
      const inMission = !!(S._mission && !S._mission.frozen);
      const rs = resources.state();
      const show = inMission ? '' : 'none';
      if (fw && fw.style.display !== show) fw.style.display = show;
      if (fb && inMission) {
        const txt = rs.rtbOn ? '补给' + Math.round(rs.rtbP * 100) + '%' : String(Math.round(rs.fuel));
        if (fb.dataset.v !== txt) {
          fb.dataset.v = txt;
          fb.textContent = txt;
          fb.style.color = rs.out ? 'var(--warn)' : rs.warn2 ? 'var(--warn)' : rs.warn1 ? 'var(--accent2)' : '';
        }
      }
    }
    if (FLY.state !== S._fs) { S._fs = FLY.state; syncFlyText(); }
    // 上下文提示条：按状态提示当前可做动作（新体验者零学习成本走完全程）
    let tip = '';
    if (fp && fp.active) tip = '';
    else if (FLY.state === 'ground' && !S.running) tip = '按 空格 启动旋翼';
    else if (FLY.state === 'ground' && S.spin < FLY.MIN_SPIN) tip = '旋翼加速中…转速 92% 后按 T 起飞';
    else if (FLY.state === 'ground') tip = '按 T 起飞 · C 第一人称驾驶 · 环境切夜间看灯光';
    else if (FLY.state === 'up') tip = '爬升中…';
    else if (FLY.state === 'hover') tip = 'C 第一人称驾驶 · T 降落 · 切场地与环境换玩法';
    else tip = '降落中…';
    // Phase 2-A3：首访三步引导——覆盖默认提示，点击画面跳过
    // Phase 11 T2：第三步改为"导览或训练"双入口；引导结束（2→3 完成时）
    // 不再自动消失——给"进入训练/自由探索"的选择 toast（localStorage 键沿用 ah64_seen）
    // Q1：训练关由 73-coach 实时教练接管，首访引导（含「切到训练模式」提示）让位
    const lc = HOST.coachTip ? HOST.coachTip() : '';
    if (lc && S._guide) S._guide = 0;
    if (S._guide) {
      if (S._guide === 1 && S.running) S._guide = 2;                 // ①→②：旋翼已启动
      if (S._guide === 2 && FLY.state === 'hover') {                 // ②→③：已到悬停
        S._guide = 3;
        toast('首访引导完成——切到「训练」模式学习完整操作，或点击画面自由探索', 4000);
      }
      if (S._guide === 1) tip = '① 按 空格 启动旋翼（点击画面跳过引导）';
      else if (S._guide === 2) tip = '② 按 T 起飞至悬停';
      else if (S._guide === 3) tip = '③ 点右上角 ▶ 一键导览，或切到「训练」模式学习操作（点击画面跳过）';
      else tip = '';
    }
    // Phase 11 用户反馈：训练提示只靠 4s toast 会消失、看完就忘——训练
    // 进行中在 #guide 提示条常驻显示当前步操作（完成/跳过/切模式即消失）；
    // 与首访引导互斥（进 train 时已清 S._guide），优先级高于默认上下文提示
    if (S.mode === 'train' && S._train) {
      tip = '训练 ' + TRAIN_NUM[S._train - 1] + '/⑤ ' + TRAIN_STEPS[S._train - 1] + '（按 Esc 跳过）';
    }
    // Q1：训练关（1-1~1-4）实时教练——按关卡状态给「第 n 步」，覆盖通用提示（73-coach）
    if (lc && !(fp && fp.active)) tip = lc;
    const gEl = UI('guide');
    if (gEl.dataset.tip !== tip) { gEl.dataset.tip = tip; gEl.textContent = tip; gEl.style.opacity = tip ? 1 : 0; }
    S._fa = 0; S._ft = 0;
  }
}
