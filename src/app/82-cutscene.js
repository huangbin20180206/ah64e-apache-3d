// ============================================================
// 82-cutscene.js — 过场叙事（Phase 13-M6）
// ============================================================
// 两段过场，复用 78-cinematic 的 orbit 参数直写 + letterbox + 字幕框架：
//   mission  任务 cutscene：startMission 后首次进入任务播放（基地远景 →
//            目标区推近 → 回机体），字幕提示简报要点；
//   rescue   救援成功 replay：幸存者 delivered 后短回放（机体侧上 →
//            绞车/幸存者区 → 收尾定格），字幕"救援成功"。
// 复用 cinema-mode 的沉浸体验（隐藏 HUD/面板），独立 id（cut-bar-*/cut-sub），
// 与开场互不干扰；Esc / 点击画面 / 任意键跳过。
// 测试通道：URL ?nocut=1 全局跳过（自动化默认带参，真实用户无参数正常播放）。
// ============================================================

const CUT_PRESETS = {
  mission: {
    dur: 10,
    kf: [
      { t: 0.0, tgt: [0, 1, BASE_C.z],  phi: 0.50, dist: 52, theta: 0.40 },   // 基地远景
      { t: 4.5, tgt: [0, 1, BASE_C.z - 2],  phi: 0.92, dist: 22, theta: 0.55 },   // 目标区推近
      { t: 8.0, tgt: [0, 1.2, 0], phi: 1.10, dist: 13, theta: 2.55 },   // 回机体
    ],
    sub: [[0.8, '作战简报已下发'], [4.8, '接近敌方基地后锁定开火'], [8.2, '祝好运']],
  },
  rescue: {
    dur: 8,
    kf: [
      { t: 0.0, tgt: [0, 1.5, 0],  phi: 1.28, dist: 16, theta: 2.0 },   // 机体侧上
      { t: 3.5, tgt: [0, 0.5, 26], phi: 1.00, dist: 12, theta: 1.2 },   // 绞车/幸存者区
      { t: 6.5, tgt: [0, 1.2, 0],  phi: 1.18, dist: 10, theta: 2.4 },   // 收尾定格
    ],
    sub: [[0.8, '救援成功'], [4.0, '幸存者已救起'], [6.7, '信标熄灭 · 撤离']],
  },
};

const cutscene = {
  on: false, t: 0, raf: 0, last: 0,
  bars: null, sub: null,
  preset: null, dur: 0, reason: '',
  _playedRound: null,      // 已播放 mission cutscene 的任务轮次（round 制，修复六）
};

// 注入 cutscene 专用 CSS（letterbox / 字幕 / 沉浸隐藏——独立 id 不与开场冲突）
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
    'body.cut-mode #guide{opacity:0!important;pointer-events:none!important}' +
    'body.cut-mode #toast{display:none!important}';
  document.head.appendChild(st);
})();

function cutStart(key) {
  if (cutscene.on) return;
  const P = CUT_PRESETS[key];
  if (!P) return;
  // 唯一镜头所有权：与其他活跃序列（开场 cinematic）互斥——被拒则不播
  if (HOST.camSeq && !HOST.camSeq.request('cutscene')) return false;
  // P14-A(R1)：过场取得相机前 FPV 必须让位——否则 loop 仍每帧 fp.update 覆盖
  // 过场驱动 orbit 写出的相机（FPV 飞行中完成救援触发 replay 的真实场景）。
  // 走 exit()（保留 FLY 飞行/悬停状态；过场结束由 setView 恢复 Orbit，不自动
  // 重进 FPV——"过场结束只恢复合法模式"，用户可再按 C 重进）。
  if (HOST.fp && HOST.fp.active) {
    HOST.fp.exit();
  }
  cutscene.on = true; cutscene.t = 0; cutscene.last = performance.now();
  cutscene.preset = key; cutscene.dur = P.dur;
  cutscene.reason = 'start=' + key;
  document.body.classList.add('cut-mode');
  const p = document.getElementById('panel');
  if (p && !p.classList.contains('hide')) p.classList.add('hide');
  if (!cutscene.bars) {
    const top = document.createElement('div'); top.id = 'cut-bar-t';
    const bot = document.createElement('div'); bot.id = 'cut-bar-b';
    const sub = document.createElement('div'); sub.id = 'cut-sub';
    document.body.append(top, bot, sub);
    cutscene.bars = [top, bot]; cutscene.sub = sub;
  }
  for (const b of cutscene.bars) b.classList.add('show');
  const k0 = P.kf[0];
  orbit.tTarget.set(k0.tgt[0], k0.tgt[1], k0.tgt[2]);
  orbit.target.copy(orbit.tTarget);
  orbit.tPhi = k0.phi; orbit.tDist = k0.dist; orbit.tTheta = k0.theta;
  cutscene.raf = requestAnimationFrame(cutTick);
  return true;
}

function cutEnd(skipped) {
  if (!cutscene.on) return;
  cutscene.reason += (skipped ? '|skipped' : '|done') + ' t=' + cutscene.t.toFixed(2);
  cutscene.on = false;
  cancelAnimationFrame(cutscene.raf);
  document.body.classList.remove('cut-mode');
  for (const b of cutscene.bars || []) b.classList.remove('show');
  if (cutscene.sub) cutscene.sub.classList.remove('show');
  if (HOST.camSeq) HOST.camSeq.release('cutscene');
  // 仅当没有其他有效 owner 时才恢复机位（防止覆盖另一活跃序列的镜头）
  if (!(HOST.camSeq && HOST.camSeq.owner)) setView(0);
}

function cutTick(now) {
  if (!cutscene.on) return;
  const dt = Math.min(0.05, (now - cutscene.last) / 1000 || 0.016);
  cutscene.last = now;
  cutscene.t += dt;
  const t = cutscene.t;
  const P = CUT_PRESETS[cutscene.preset];
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
  if (cutscene.sub) {
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

// —— 跳过：Esc / 点击画面 / 任意键（capture 阶段，先于功能键路由）——
// 最终闭环修复（输入穿透）：跳过事件必须被消费（preventDefault +
// stopImmediatePropagation），否则同一事件继续进入全局输入逻辑——空格
// 同时启停旋翼、C 同时切换 FPV、T 同时起降、F/G/X 同时开火、B 同时重置
// 靶场、pointerdown 被 Orbit 接收取消返回镜头。仅在过场激活时拦截。
addEventListener('keydown', e => {
  if (!cutscene.on) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  cutEnd(true);
}, true);
addEventListener('pointerdown', e => {
  if (!cutscene.on) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  cutEnd(true);
}, true);

// —— 入口（经 HOST 供 70-app 调；?nocut=1 全集跳过）——
// 槽位名 cutsceneState 避开顶层符号 cutscene（2-B4 教训：HOST 槽名不撞符号名）
// 生命周期修复（六）：maybe 返回 accepted boolean——
//   mission：round 制（每新任务轮次最多播一次，同轮重复调用返回 true 幂等）
//   rescue：其他活跃序列时返回 false（调用方不提交 _rescueCut，下帧可重试），
//           真正开始播放才返回 true——被拒不消费标记，replay 不永久丢失
HOST.cutsceneState = {
  maybe(key, round) {
    if (cutscene.on) return false;                     // 自己已在播：拒绝新请求
    if (key === 'mission') {
      if (cutscene._playedRound === round) return true;   // 本轮已播：幂等
      // 修复三（owner 冲突永久丢失）：cinematic 等其他序列持有 HOST.camSeq 时，
      // cutStart 会拒绝——此处保留 pendingMissionRound 请求，70-app loop 每帧
      // 重试；owner 释放后自动取得并播放。真正开始播放才提交 playedRound
      if (cutscene._pendingRound === round) {
        // 已 pending 且仍未播放：尝试取得 owner（可能此刻已释放）
        if (cutStart(key)) { cutscene._pendingRound = null; cutscene._playedRound = round; return true; }
        return false;                                  // 仍被占用：下帧再试
      }
      if (cutStart(key)) {
        cutscene._playedRound = round;                 // 真正开播才记轮次
        return true;
      }
      cutscene._pendingRound = round;                  // 冲突：保留请求（不记 playedRound）
      return false;
    }
    if (key === 'rescue') {
      return cutStart(key);                            // 失败（被拒）返回 false
    }
    return cutStart(key);
  },
  start: cutStart,
  state() {
    return { on: cutscene.on, preset: cutscene.preset || null,
      t: +cutscene.t.toFixed(2), reason: cutscene.reason || '',
      playedRound: cutscene._playedRound,
      pendingRound: cutscene._pendingRound };
  },
};
// ?nocut=1：自动化测试通道——maybe 视为已接受但不播放（真实用户无参数正常播放）
(function initCut() {
  if (/[?&]nocut=1/.test(location.search)) {
    HOST.cutsceneState = {
      maybe() { return true; },            // 测试通道：请求"已处理"（调用方安心提交标记）
      start() { return false; },
      state: HOST.cutsceneState.state,
    };
  }
})();