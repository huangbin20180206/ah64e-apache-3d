// ============================================================
// 82-cutscene.js — 关卡战术目标导览与基地起飞转场系统
// ============================================================
// 职责：
//   1. mission 关卡开场战术目标导览（Briefing Tour）：
//      进入关卡任务时，动态提取并展示该关卡全部战术目标（靶标/车队/SAM雷达/敌机/幸存者/航点圈等）
//      的快速特写运镜；每个目标 2.0 秒战术特写镜头，伴随平滑运镜与战术目标标签说明；
//   2. 导览结束交互弹窗（Briefing Modal）：
//      导览结束后定格全景战术视角，弹出“再看一次”与“开始任务”交互浮窗；
//   3. 基地起飞与转场进场（Transit Ingress）：
//      点击“开始任务”后，直升机从后方基地起飞，切 2 段高速掠地与战术转场镜头，随后抵达交战空域 (AO)；
//      抵达后保持战术防区外距离（~45u，14m 空中悬停就位），正式交接控制权给玩家；
//   4. rescue 救援成功 replay：幸存者 delivered 后短回放；
//   5. 兼容测试通道（?nocut=1 全局跳过，Esc 任意时刻快速就位开打）。
// ============================================================

const CUT_PRESETS = {
  mission: {
    dur: 10,
    kf: [
      { t: 0.0, tgt: [0, 1, BASE_C.z],  phi: 0.50, dist: 52, theta: 0.40 },
      { t: 4.5, tgt: [0, 1, BASE_C.z - 2],  phi: 0.92, dist: 22, theta: 0.55 },
      { t: 8.0, tgt: [0, 1.2, 0], phi: 1.10, dist: 13, theta: 2.55 },
    ],
    sub: [[0.8, '作战简报已下发 · 目标导览中'], [4.8, '接近敌方基地后锁定开火'], [8.2, '祝好运']],
  },
  rescue: {
    dur: 8,
    kf: [
      { t: 0.0, tgt: [0, 1.5, 0],  phi: 1.28, dist: 16, theta: 2.0 },
      { t: 3.5, tgt: [0, 0.5, 26], phi: 1.00, dist: 12, theta: 1.2 },
      { t: 6.5, tgt: [0, 1.2, 0],  phi: 1.18, dist: 10, theta: 2.4 },
    ],
    sub: [[0.8, '救援成功'], [4.0, '幸存者已救起'], [6.7, '信标熄灭 · 撤离']],
  },
};

const cutscene = {
  on: false,
  t: 0,
  raf: 0,
  last: 0,
  bars: null,
  sub: null,
  preset: null,
  dur: 0,
  reason: '',
  _playedRound: null,
  _pendingRound: null,
  step: 'idle',
  tourInfo: null,
  tourIdx: 0,
  targetT: 0,
  targetDur: 2.0,
  transitT: 0,
  transitDur: 4.6,
  basePos: null,
  ingressPos: null,
};

// 注入 cutscene 专用样式（letterbox / 字幕 / 沉浸隐藏）
(function cutStyle() {
  const st = document.createElement('style');
  st.textContent =
    '#cut-bar-t,#cut-bar-b{position:fixed;left:0;right:0;height:0;background:#000;' +
    'z-index:70;transition:height .9s cubic-bezier(.6,0,.3,1);pointer-events:none}' +
    '#cut-bar-t{top:0}#cut-bar-b{bottom:0}' +
    '#cut-bar-t.show,#cut-bar-b.show{height:9vh}' +
    '#cut-sub{position:fixed;left:50%;bottom:12%;transform:translateX(-50%);' +
    'color:#e3eaf1;font-size:15px;letter-spacing:.42em;white-space:nowrap;' +
    'text-shadow:0 2px 14px rgba(0,0,0,.9);opacity:0;transition:opacity .7s ease;' +
    'z-index:71;pointer-events:none;font-family:var(--sans)}' +
    '#cut-sub.show{opacity:1}' +
    'body.cut-mode #top,body.cut-mode #views,body.cut-mode #specs,' +
    'body.cut-mode #guide,body.cut-mode #mission,body.cut-mode #labels{opacity:0!important;pointer-events:none!important}' +
    'body.cut-mode #toast{display:none!important}';
  document.head.appendChild(st);
})();

// 计算各关卡出生成像与进场坐标
function computeMissionCoords() {
  const m = S._mission || {};
  const levelId = m.levelId;
  const variant = m.variant || 'standard';

  // 1-1 训练关：原点停机坪
  if (levelId === '1-1' || variant === 'train_flight') {
    return {
      base: { x: 0, z: 0, yaw: 0, alt: 0 },
      ingress: { x: 0, z: 0, yaw: 0, alt: 0, isTutorial: true },
    };
  }

  // 4-1 峡谷突防：南入口超低空走廊
  if (levelId === '4-1' || variant === 'canyon_run') {
    const yaw = 0.142;
    return {
      base: { x: 36, z: -106, yaw, alt: 0.8 },
      ingress: { x: 36, z: -56, yaw, alt: 4.5, isCanyon: true },
    };
  }

  // 计算目标重心
  const tInfo = cutscene.tourInfo || buildMissionTour();
  let cx = 0, cz = 0, count = 0;
  for (const item of (tInfo && tInfo.list) || []) {
    if (Math.hypot(item.pos[0], item.pos[2]) > 4) {
      cx += item.pos[0]; cz += item.pos[2]; count++;
    }
  }
  if (!count) { cx = 0; cz = BASE_C.z; count = 1; }
  cx /= count; cz /= count;

  const distToCenter = Math.hypot(cx, cz) || 1;
  const ux = cx / distToCenter;
  const uz = cz / distToCenter;
  const standoff = 45;
  const arrX = cx - ux * standoff;
  const arrZ = cz - uz * standoff;
  const arrYaw = Math.atan2(cx - arrX, cz - arrZ);

  const baseX = arrX - ux * 60;
  const baseZ = arrZ - uz * 60;

  return {
    base: { x: baseX, z: baseZ, yaw: arrYaw, alt: 0.8 },
    ingress: { x: arrX, z: arrZ, yaw: arrYaw, alt: 14 },
  };
}

// 快速就位直升机
function applyMissionSpawn() {
  const m = S._mission || {};
  if (m.levelId === '1-1' || m.variant === 'train_flight' || m.variant === 'endless') {
    FLY.state = 'ground'; FLY.alt = 0; FLY.x = 0; FLY.z = 0; FLY.yaw = 0;
    FLY.pitch = 0; FLY.roll = 0;
    return;
  }
  const coords = computeMissionCoords();
  const iPos = coords.ingress;
  FLY.state = 'hover';
  FLY.alt = iPos.alt || 14;
  FLY.x = iPos.x;
  FLY.z = iPos.z;
  FLY.yaw = iPos.yaw;
  FLY.pitch = 0;
  FLY.roll = 0;
  S.running = true;
  S.spin = 1;
}


// 2026-11-08 P2-2：buildMissionTour() 已拆到更早加载的 81-cutscene-tour.js，
// 本文件只保留导览状态机 / 弹窗 / 转场运镜（见模块契约）。

// 导览手动翻页与暂停检视控制
function tourStep(delta) {
  if (!cutscene.on || cutscene.step !== 'tour' || !cutscene.tourInfo || !cutscene.tourInfo.list.length) return;
  const list = cutscene.tourInfo.list;
  cutscene.tourIdx = (cutscene.tourIdx + delta + list.length) % list.length;
  cutscene.targetT = 0;
}

function missionTourTogglePause() {
  if (!cutscene.on || cutscene.step !== 'tour') return;
  cutscene.tourPaused = !cutscene.tourPaused;
  const pb = UI('btn-tour-pause');
  if (pb) pb.textContent = cutscene.tourPaused ? '▶ 继续轮播 (P)' : '⏸ 暂停检视 (P)';
}

// 导览结束任务确认浮窗
function showBriefingModal(info) {
  const modal = UI('briefing-modal');
  if (!modal) return;
  const m = S._mission || {};
  const L = (HOST.levels && m.levelId) ? HOST.levels.byId(m.levelId) : null;
  const title = L ? (L.id + ' ' + L.name) : '作战任务';
  const goal = (info && info.goal) || '摧毁战区内敌方全部目标';

  const tEl = UI('bm-title'); if (tEl) tEl.textContent = title;
  const gEl = UI('bm-goal'); if (gEl) gEl.textContent = '本关任务：' + goal;
  const objsEl = UI('bm-objs');
  if (objsEl) {
    objsEl.innerHTML = '';
    if (L && L.objectives) {
      L.objectives.forEach((o, i) => {
        const row = document.createElement('div');
        row.className = 'bm-obj-item';
        row.innerHTML = '<span>目标 ' + (i + 1) + '</span> ' + o.label;
        objsEl.appendChild(row);
      });
    } else if (info && info.list) {
      info.list.forEach(t => {
        const row = document.createElement('div');
        row.className = 'bm-obj-item';
        row.innerHTML = '<span>' + t.tag + '</span> ' + t.title + ' — ' + t.desc;
        objsEl.appendChild(row);
      });
    }
  }
  modal.style.display = 'flex';
  modal.classList.add('show');
}

function hideBriefingModal() {
  const modal = UI('briefing-modal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
}

// 重新播放导览
function replayMissionTour() {
  hideBriefingModal();
  cutscene.step = 'tour';
  cutscene.tourIdx = 0;
  cutscene.targetT = 0;
  cutscene.tourPaused = false;
  cutscene.t = 0;
  const pb = UI('btn-tour-pause');
  if (pb) pb.textContent = '⏸ 暂停检视 (P)';
  const tourEl = UI('briefing-tour');
  if (tourEl) tourEl.style.display = 'flex';
  if (cutscene.tourInfo && cutscene.tourInfo.list && cutscene.tourInfo.list.length) {
    const p0 = cutscene.tourInfo.list[0];
    const pos = p0.liveGetter ? p0.liveGetter() : p0.pos;
    const yOff = p0.yOff != null ? p0.yOff : 0.8;
    orbit.tTarget.set(pos[0], pos[1] + yOff, pos[2]);
    orbit.target.copy(orbit.tTarget);
    orbit.tPhi = p0.cam ? p0.cam.phi : 1.22;
    orbit.tDist = p0.cam ? p0.cam.dist : 5.0;
    orbit.tTheta = 0.5;
  }
}

// 切换到“再看一次 / 开始任务”确认弹窗
function transitionToPrompt() {
  cutscene.step = 'prompt';
  const tourEl = UI('briefing-tour');
  if (tourEl) tourEl.style.display = 'none';
  if (cutscene.sub) cutscene.sub.classList.remove('show');
  showBriefingModal(cutscene.tourInfo);
}

// 开始从基地起飞并进场转场
function startTransitIngress() {
  hideBriefingModal();
  const tourEl = UI('briefing-tour');
  if (tourEl) tourEl.style.display = 'none';
  if (cutscene.sub) cutscene.sub.classList.remove('show');

  const m = S._mission || {};
  const levelId = m.levelId;

  // 1-1 训练关与无尽模式：直接停机坪起飞
  if (levelId === '1-1' || m.variant === 'train_flight' || m.variant === 'endless') {
    FLY.state = 'ground'; FLY.alt = 0; FLY.x = 0; FLY.z = 0; FLY.yaw = 0;
    FLY.pitch = 0; FLY.roll = 0;
    cutEnd(false);
    beginMission();
    setView(0);
    toast(m.variant === 'endless' ? '无尽生存启动——按 T 起飞迎击敌军进犯波次' : '1-1 首飞——按 T 起飞，依次穿过航点圈');
    return;
  }

  const coords = computeMissionCoords();
  cutscene.step = 'transit';
  cutscene.transitT = 0;
  cutscene.transitDur = 4.6;
  cutscene.basePos = coords.base;
  cutscene.ingressPos = coords.ingress;

  FLY.state = 'hover';
  FLY.x = coords.base.x;
  FLY.z = coords.base.z;
  FLY.alt = coords.base.alt || 0.5;
  FLY.yaw = coords.base.yaw;
  FLY.pitch = 0.18;
  S.running = true;
  S.spin = 1;
  if (washfx) washfx.setMedium('sand');

  orbit.tTarget.set(coords.base.x, 1.5, coords.base.z);
  orbit.tDist = 14;
  orbit.tPhi = 1.32;
  orbit.tTheta = coords.base.yaw + 2.7;
}

// 抵达任务空域，交接控制权
function finishTransitIngress() {
  const coords = computeMissionCoords();
  const iPos = cutscene.ingressPos || coords.ingress;
  FLY.state = 'hover';
  FLY.alt = iPos.alt || 14;
  FLY.x = iPos.x;
  FLY.z = iPos.z;
  FLY.yaw = iPos.yaw;
  FLY.pitch = 0;
  FLY.roll = 0;
  S.running = true;
  S.spin = 1;

  cutEnd(false);
  beginMission();
  toast(iPos.isCanyon ? '已进入峡谷走廊！低空突防，雷达已启动' : '已抵达交战空域！保持悬停机动，锁定目标开火');
  setView(0);
}

// 启动过场
function cutStart(key) {
  if (cutscene.on) return false;
  if (HOST.camSeq && !HOST.camSeq.request('cutscene')) return false;

  if (HOST.fp && HOST.fp.active) {
    HOST.fp.exit();
  }

  cutscene.on = true;
  cutscene.t = 0;
  cutscene.last = performance.now();
  cutscene.preset = key;
  cutscene.reason = 'start=' + key;

  document.body.classList.add('cut-mode');
  const p = document.getElementById('panel');
  if (p && !p.classList.contains('hide')) p.classList.add('hide');

  if (!cutscene.bars) {
    const top = document.createElement('div'); top.id = 'cut-bar-t';
    const bot = document.createElement('div'); bot.id = 'cut-bar-b';
    const sub = document.createElement('div'); sub.id = 'cut-sub';
    document.body.append(top, bot, sub);
    cutscene.bars = [top, bot];
    cutscene.sub = sub;
  }
  for (const b of cutscene.bars) b.classList.add('show');

  // 绑定导览与浮窗按钮点击事件
  const prevBtn = UI('btn-tour-prev');
  if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); tourStep(-1); };
  const pauseBtn = UI('btn-tour-pause');
  if (pauseBtn) {
    pauseBtn.textContent = '⏸ 暂停检视 (P)';
    pauseBtn.onclick = (e) => { e.stopPropagation(); missionTourTogglePause(); };
  }
  const nextBtn = UI('btn-tour-next');
  if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); tourStep(1); };
  const skipBtn = UI('btn-tour-skip');
  if (skipBtn) skipBtn.onclick = (e) => { e.stopPropagation(); startTransitIngress(); };

  const repBtn = UI('btn-tour-replay');
  if (repBtn) repBtn.onclick = (e) => { e.stopPropagation(); replayMissionTour(); };
  const startBtn = UI('btn-tour-start');
  if (startBtn) startBtn.onclick = (e) => { e.stopPropagation(); startTransitIngress(); };

  if (key === 'mission') {
    cutscene.step = 'tour';
    cutscene.tourInfo = buildMissionTour();
    cutscene.tourIdx = 0;
    cutscene.targetT = 0;
    cutscene.targetDur = 2.4;
    cutscene.tourPaused = false;

    const tourEl = UI('briefing-tour');
    if (tourEl) tourEl.style.display = 'flex';
    hideBriefingModal();

    if (cutscene.tourInfo.list.length) {
      const p0 = cutscene.tourInfo.list[0];
      const pos = p0.liveGetter ? p0.liveGetter() : p0.pos;
      const yOff = p0.yOff != null ? p0.yOff : 0.8;
      orbit.tTarget.set(pos[0], pos[1] + yOff, pos[2]);
      orbit.target.copy(orbit.tTarget);
      orbit.tPhi = p0.cam ? p0.cam.phi : 1.22;
      orbit.tDist = p0.cam ? p0.cam.dist : 5.0;
      orbit.tTheta = 0.5;
    }

    // 满足既有简报测试契约
    if (cutscene.sub) {
      cutscene.sub.textContent = '作战简报已下发 · 目标导览中';
      cutscene.sub.classList.add('show');
    }
  } else {
    // legacy preset (e.g. rescue)
    cutscene.step = 'preset';
    const P = CUT_PRESETS[key];
    cutscene.dur = (P && P.dur) || 8;
    if (P && P.kf && P.kf[0]) {
      const k0 = P.kf[0];
      orbit.tTarget.set(k0.tgt[0], k0.tgt[1], k0.tgt[2]);
      orbit.target.copy(orbit.tTarget);
      orbit.tPhi = k0.phi; orbit.tDist = k0.dist; orbit.tTheta = k0.theta;
    }
  }

  cutscene.raf = requestAnimationFrame(cutTick);
  return true;
}

// 静默取消过场（用于切换关卡或重置靶场，不自动触发 beginMission）
function cutCancel() {
  if (!cutscene.on) return;
  cutscene.reason += '|cancelled t=' + cutscene.t.toFixed(2);
  cutscene.on = false;
  cutscene.step = 'idle';
  cutscene.tourPaused = false;
  cancelAnimationFrame(cutscene.raf);

  document.body.classList.remove('cut-mode');
  for (const b of cutscene.bars || []) b.classList.remove('show');
  if (cutscene.sub) cutscene.sub.classList.remove('show');

  hideBriefingModal();
  const tourEl = UI('briefing-tour');
  if (tourEl) tourEl.style.display = 'none';

  if (HOST.camSeq) HOST.camSeq.release('cutscene');
  if (!(HOST.camSeq && HOST.camSeq.owner)) setView(0);
}

// 结束过场
function cutEnd(skipped) {
  if (!cutscene.on) return;
  const isMission = cutscene.preset === 'mission';
  cutscene.reason += (skipped ? '|skipped' : '|done') + ' t=' + cutscene.t.toFixed(2);
  cutscene.on = false;
  cutscene.step = 'idle';
  cutscene.tourPaused = false;
  cancelAnimationFrame(cutscene.raf);

  document.body.classList.remove('cut-mode');
  for (const b of cutscene.bars || []) b.classList.remove('show');
  if (cutscene.sub) cutscene.sub.classList.remove('show');

  hideBriefingModal();
  const tourEl = UI('briefing-tour');
  if (tourEl) tourEl.style.display = 'none';

  if (HOST.camSeq) HOST.camSeq.release('cutscene');
  if (!(HOST.camSeq && HOST.camSeq.owner)) setView(0);

  // 若在战役关卡或无尽模式中跳过任务导览/转场，确保直升机进入就位态并启动任务；
  // 自由沙盒/测试无参 startMission() 跳过时不强改 S.running（保持 F7 测试断言一致）
  const m = S._mission;
  if (isMission && m && m.phase === 'briefing' && (!skipped || m.levelId || m.levelIdx != null || m.variant === 'endless')) {
    applyMissionSpawn();
    beginMission();
  }
}

// 帧循环
function cutTick(now) {
  if (!cutscene.on) return;
  const dt = Math.min(0.05, (now - cutscene.last) / 1000 || 0.016);
  cutscene.last = now;
  cutscene.t += dt;

  // 1. 目标特写导览阶段
  if (cutscene.step === 'tour') {
    const info = cutscene.tourInfo;
    const list = info && info.list;
    if (!list || !list.length) {
      transitionToPrompt();
      cutscene.raf = requestAnimationFrame(cutTick);
      return;
    }

    if (!cutscene.tourPaused) {
      cutscene.targetT += dt;
    }
    const idx = cutscene.tourIdx;
    const cur = list[idx];
    const pos = cur.liveGetter ? cur.liveGetter() : cur.pos;

    // 相机对准当前目标（实时追踪移动目标），平滑近距离特写环绕（4.2~6.0m 高清近景特写）
    const yOff = cur.yOff != null ? cur.yOff : 0.8;
    orbit.tTarget.lerp(new THREE.Vector3(pos[0], pos[1] + yOff, pos[2]), 0.14);
    orbit.tDist = lerp(orbit.tDist, cur.cam ? cur.cam.dist : 5.0, 0.10);
    orbit.tPhi = lerp(orbit.tPhi, cur.cam ? cur.cam.phi : 1.22, 0.10);
    orbit.tTheta += dt * 0.42;

    // 更新 HUD 目标特写说明
    const bBadge = UI('briefing-badge');
    const bName = UI('briefing-name');
    const bFeat = UI('briefing-feat');
    const bDesc = UI('briefing-desc');
    const bDist = UI('briefing-dist');
    const bGoal = UI('briefing-goal');

    if (bBadge) bBadge.textContent = cur.tag;
    if (bName) bName.textContent = cur.title;
    if (bFeat) {
      bFeat.textContent = cur.feat || '';
      bFeat.style.display = cur.feat ? 'block' : 'none';
    }
    if (bDesc) bDesc.textContent = cur.desc;

    if (bDist) {
      const dx = pos[0] - (FLY.x || 0);
      const dz = pos[2] - (FLY.z || 0);
      const distM = Math.round(Math.hypot(dx, dz) * 2.25);
      const az = Math.round((Math.atan2(dx, dz) * 180 / Math.PI + 360) % 360);
      const pauseTag = cutscene.tourPaused ? ' · [已暂停检视]' : '';
      bDist.textContent = `[目标序号 ${idx + 1}/${list.length}] · 战区方位 ${String(az).padStart(3, '0')}° · 距离出发点约 ${distM}m${pauseTag}`;
    }

    if (bGoal) {
      const m = S._mission || {};
      const L = (HOST.levels && m.levelId) ? HOST.levels.byId(m.levelId) : null;
      bGoal.textContent = (L ? (L.id + ' ' + L.name + ' · ') : '') + info.goal;
    }

    // 作战简报字幕（开场前 2 秒显示，契约检查）
    if (cutscene.t > 2.2 && cutscene.sub) {
      cutscene.sub.classList.remove('show');
    }

    // 本目标镜头结束，切下一个
    if (!cutscene.tourPaused && cutscene.targetT >= cutscene.targetDur) {
      cutscene.targetT = 0;
      cutscene.tourIdx++;
      if (cutscene.tourIdx >= list.length) {
        transitionToPrompt();
      }
    }
    cutscene.raf = requestAnimationFrame(cutTick);
    return;
  }

  // 2. 导览结束弹窗等待阶段（背景缓慢战术盘旋）
  if (cutscene.step === 'prompt') {
    orbit.tDist = lerp(orbit.tDist, 46, 0.04);
    orbit.tPhi = lerp(orbit.tPhi, 0.90, 0.04);
    orbit.tTheta += dt * 0.06;
    cutscene.raf = requestAnimationFrame(cutTick);
    return;
  }

  // 3. 基地起飞与转场进场阶段
  if (cutscene.step === 'transit') {
    cutscene.transitT += dt;
    const tt = cutscene.transitT;
    const bPos = cutscene.basePos;
    const iPos = cutscene.ingressPos;
    const progress = clamp(tt / cutscene.transitDur, 0, 1);
    const ep = easeInOut(progress);

    const hx = lerp(bPos.x, iPos.x, ep);
    const hz = lerp(bPos.z, iPos.z, ep);
    const targetAlt = iPos.alt || 14;
    const halt = lerp(bPos.alt || 0.8, targetAlt, smoothstep(progress, 0, 0.45));
    FLY.x = hx;
    FLY.z = hz;
    FLY.alt = halt;
    FLY.yaw = bPos.yaw;

    // Shot 1: 基地起飞 & 掠地冲刺 (0 ~ 1.8s)
    if (tt < 1.8) {
      FLY.pitch = 0.22;
      orbit.tTarget.set(hx, halt * 0.7 + 0.8, hz);
      orbit.tDist = 14;
      orbit.tPhi = 1.34;
      orbit.tTheta = bPos.yaw + 2.6 - (tt / 1.8) * 0.4;
      if (cutscene.sub) {
        cutscene.sub.textContent = '【基地起飞】旋翼全功率推进 · 航向交战空域';
        cutscene.sub.classList.add('show');
      }
    }
    // Shot 2: 低空大机动转场 (1.8 ~ 3.6s)
    else if (tt < 3.6) {
      FLY.pitch = 0.14;
      const p2 = (tt - 1.8) / 1.8;
      orbit.tTarget.set(hx, halt * 0.6 + 1.2, hz);
      orbit.tDist = 22;
      orbit.tPhi = 1.14;
      orbit.tTheta = bPos.yaw - 0.7 + p2 * 0.5;
      if (cutscene.sub) {
        cutscene.sub.textContent = iPos.isCanyon
          ? '【峡谷突防】接近深谷南入口 · 压低航线规避雷达'
          : '【战术转场】超低空突防 · 航线大机动突进';
        cutscene.sub.classList.add('show');
      }
    }
    // Shot 3: 抵达交战空域 AO (3.6 ~ 4.6s)
    else {
      FLY.pitch = lerp(0.14, 0, (tt - 3.6) / 1.0);
      orbit.tTarget.set(hx, halt * 0.65 + 1.2, hz);
      orbit.tDist = 18;
      orbit.tPhi = 1.22;
      orbit.tTheta = bPos.yaw + Math.PI;
      if (cutscene.sub) {
        cutscene.sub.textContent = iPos.isCanyon
          ? '【抵达入口】已进入峡谷走廊 · 保持高度在岩壁之下！'
          : '【交战空域】已抵达任务空域 · 武器解除保险 · 自由交火！';
        cutscene.sub.classList.add('show');
      }
    }

    if (tt >= cutscene.transitDur) {
      finishTransitIngress();
      return;
    }
    cutscene.raf = requestAnimationFrame(cutTick);
    return;
  }

  // 4. legacy preset 播放（如 rescue 救援短回放）
  const P = CUT_PRESETS[cutscene.preset];
  if (!P || !P.kf) { cutEnd(false); return; }
  const t = cutscene.t;
  let i = 0;
  while (i < P.kf.length - 1 && t > P.kf[i + 1].t) i++;
  const k0 = P.kf[i], k1 = P.kf[Math.min(i + 1, P.kf.length - 1)];
  const span = Math.max(0.001, k1.t - k0.t);
  const e = easeInOut(clamp((t - k0.t) / span, 0, 1));
  orbit.tTarget.set(
    k0.tgt[0] + (k1.tgt[0] - k0.tgt[0]) * e,
    k0.tgt[1] + (k1.tgt[1] - k0.tgt[1]) * e,
    k0.tgt[2] + (k1.tgt[2] - k0.tgt[2]) * e);
  orbit.tPhi = k0.phi + (k1.phi - k0.phi) * e;
  orbit.tDist = k0.dist + (k1.dist - k0.dist) * e;
  orbit.tTheta = k0.theta + (k1.theta - k0.theta) * e;
  if (cutscene.sub && P.sub) {
    let st = '';
    for (const [t0, txt] of P.sub) if (t >= t0 && t < t0 + 3.6) st = txt;
    if (cutscene.sub.dataset.txt !== st) {
      cutscene.sub.dataset.txt = st;
      cutscene.sub.textContent = st;
      cutscene.sub.classList.toggle('show', !!st);
    }
  }
  if (t >= cutscene.dur) { cutEnd(false); return; }
  cutscene.raf = requestAnimationFrame(cutTick);
}

// 键盘与交互事件监听
addEventListener('keydown', e => {
  if (!cutscene.on) return;

  // 弹窗状态下：
  if (cutscene.step === 'prompt') {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      startTransitIngress();
      return;
    }
    if (e.code === 'KeyR') {
      e.preventDefault();
      e.stopImmediatePropagation();
      replayMissionTour();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      cutEnd(true);
      return;
    }
  }

  // 导览阶段交互快捷键：左右键切目标、P 暂停检视、空格/回车推进
  if (cutscene.step === 'tour') {
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      e.stopImmediatePropagation();
      tourStep(-1);
      return;
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      e.stopImmediatePropagation();
      tourStep(1);
      return;
    }
    if (e.code === 'KeyP') {
      e.preventDefault();
      e.stopImmediatePropagation();
      missionTourTogglePause();
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const m = S._mission;
      if (m && (m.levelId || m.levelIdx != null || m.variant === 'endless')) {
        transitionToPrompt();
      } else {
        cutEnd(true);
      }
      return;
    }
  }

  // 转场阶段按空格/回车：快速就位直接开火
  if (cutscene.step === 'transit' && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    finishTransitIngress();
    return;
  }

  // Escape 或其他键（自动化测试输入穿透保护）：立即退出过场
  e.preventDefault();
  e.stopImmediatePropagation();
  cutEnd(true);
}, true);

addEventListener('pointerdown', e => {
  if (!cutscene.on) return;
  // 点击导览卡片控制按钮或任务准备弹窗内部由按钮自身处理
  const tourCard = document.querySelector('#briefing-tour .briefing-card');
  if (tourCard && tourCard.contains(e.target)) return;
  if (cutscene.step === 'prompt') {
    const modal = UI('briefing-modal');
    if (modal && modal.contains(e.target)) return;
  }
  // 开场 0.4s 内忽略鼠标点击，防止关卡选关点击穿透直接跳过导览
  if (cutscene.step === 'tour' && cutscene.t < 0.4) return;
  if (cutscene.step === 'tour') {
    e.preventDefault();
    e.stopImmediatePropagation();
    transitionToPrompt();
    return;
  }
  if (cutscene.step === 'transit') {
    e.preventDefault();
    e.stopImmediatePropagation();
    finishTransitIngress();
    return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  cutEnd(true);
}, true);

// 宿主接口暴露
HOST.cutsceneState = {
  maybe(key, round) {
    if (cutscene.on) return false;
    if (key === 'mission') {
      if (cutscene._playedRound === round) return true;
      if (cutscene._pendingRound === round) {
        if (cutStart(key)) { cutscene._pendingRound = null; cutscene._playedRound = round; return true; }
        return false;
      }
      if (cutStart(key)) {
        cutscene._playedRound = round;
        return true;
      }
      cutscene._pendingRound = round;
      return false;
    }
    if (key === 'rescue') {
      return cutStart(key);
    }
    return cutStart(key);
  },
  start: cutStart,
  cancel: cutCancel,
  // 本地优化 2026-10-30：HUD 每帧读活跃态的标量通道——state() 每次新建对象，isOn() 零分配
  isOn() { return !!cutscene.on; },
  state() {
    return {
      on: cutscene.on,
      preset: cutscene.preset || null,
      t: +cutscene.t.toFixed(2),
      reason: cutscene.reason || '',
      step: cutscene.step,
      playedRound: cutscene._playedRound,
      pendingRound: cutscene._pendingRound,
    };
  },
};

// ?nocut=1 自动化测试通道
(function initCut() {
  if (/[?&]nocut=1/.test(location.search)) {
    HOST.cutsceneState = {
      maybe() { return true; },
      start() { return false; },
      cancel() {},
      isOn() { return false; },
      state: HOST.cutsceneState.state,
    };
  }
})();