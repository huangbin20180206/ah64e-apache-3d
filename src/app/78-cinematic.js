// ============================================================
// 78-cinematic.js — 电影开场镜头（手动反馈"大片即视感"第 1 阶段 S1）
// ============================================================
// 首次访问自动播放 14s 开场序列：letterbox 画幅 + 三段运镜（高空俯冲→
// 贴地掠过尾梁→绕机定格英雄机位）+ 底部字幕；Esc/点击画面/任意键跳过。
// 结束后交还控制权并衔接首访三步引导（S._guide=1）。
// 仅首访播放（ah64_seen 联动，隐私模式不播）；结束后正常游玩不受影响。
// 复用 orbit 的缓动参数直写（tTarget/tPhi/tDist/tTheta），不加第二套相机。
// ============================================================

const cinema = { on: false, t: 0, raf: 0, last: 0, bars: null, sub: null, style: null };

// Phase 14-A：cinema 状态对象注册进 HOST（01-host modeState 只读取用，无反向引用）
HOST.cinemaState = cinema;

// 开场关键帧：目标点 / 极角 / 距离 / 方位角（orbit 缓动参数直写）
const CINE_KF = [
  { t: 0.0, tgt: [0, 8, 0],      phi: 0.30, dist: 62,  theta: 0.70 },  // 高空云层俯冲
  { t: 4.5, tgt: [0, 3, -4],     phi: 0.78, dist: 28,  theta: 1.35 },  // 俯冲压低
  { t: 8.5, tgt: [0, 1.4, -2.4], phi: 1.42, dist: 9.5, theta: 2.45 },  // 贴地掠过尾梁
  { t: 12.0, tgt: [0, 1.25, 0.2], phi: 1.19, dist: 12.6, theta: 0.78 },  // 定格英雄机位
];
const CINE_SUB = [
  [0.6, 'AH-64E APACHE · LONGBOW'],
  [5.0, '全程序化 · 零依赖 · 一页即战场'],
  [9.2, '这次，坐进驾驶舱'],
];
const CINE_DUR = 14.0;

// 注入开场专用 CSS（letterbox / 字幕 / 沉浸模式隐藏 HUD）
(function cineStyle() {
  const st = document.createElement('style');
  st.textContent =
    '#cinema-bar-t,#cinema-bar-b{position:fixed;left:0;right:0;height:0;background:#000;' +
    'z-index:70;transition:height .9s cubic-bezier(.6,0,.3,1);pointer-events:none}' +
    '#cinema-bar-t{top:0}#cinema-bar-b{bottom:0}' +
    '#cinema-bar-t.show,#cinema-bar-b.show{height:9vh}' +
    '#cinema-sub{position:fixed;left:50%;bottom:12%;transform:translateX(-50%);' +
    'color:#e3eaf1;font-size:15px;letter-spacing:.42em;white-space:nowrap;' +
    'text-shadow:0 2px 14px rgba(0,0,0,.9);opacity:0;transition:opacity .7s ease;' +
    'z-index:71;pointer-events:none;font-family:var(--sans)}' +
    '#cinema-sub.show{opacity:1}' +
    'body.cinema-mode #top,body.cinema-mode #views,body.cinema-mode #specs,' +
    'body.cinema-mode #guide{opacity:0!important;pointer-events:none!important}' +
    'body.cinema-mode #toast{display:none!important}';
  document.head.appendChild(st);
})();

function cineStart() {
  if (cinema.on) return;
  // 唯一镜头所有权：若已有其他活跃序列（任务过场/救援回放），拒绝并发开场
  if (HOST.camSeq && !HOST.camSeq.request('cinematic')) return;
  // P14-A(R1)：开场取得相机前 FPV 让位（与 cutscene 同规则；cinema 通常首访
  // 触发时 FPV 不可能 active，但 ?nocut 重播/开发调用路径下需保证单 owner）
  if (HOST.fp && HOST.fp.active) {
    HOST.fp.exit();
  }
  cinema.on = true; cinema.t = 0;
  cinema.last = performance.now();
  // 开场期间静默首访引导（-1 占位：loop 的 guide 分支对 -1 落入空 tip）
  S._guide = -1;
  document.body.classList.add('cinema-mode');
  const p = document.getElementById('panel');
  if (p && !p.classList.contains('hide')) p.classList.add('hide');
  if (!cinema.bars) {
    const top = document.createElement('div'); top.id = 'cinema-bar-t';
    const bot = document.createElement('div'); bot.id = 'cinema-bar-b';
    const sub = document.createElement('div'); sub.id = 'cinema-sub';
    document.body.append(top, bot, sub);
    cinema.bars = [top, bot]; cinema.sub = sub;
  }
  for (const b of cinema.bars) b.classList.add('show');
  // 起点参数直写（orbit 缓动追上即成开场第一镜）
  orbit.tTarget.set(0, 8, 0); orbit.target.copy(orbit.tTarget);
  orbit.tPhi = CINE_KF[0].phi; orbit.tDist = CINE_KF[0].dist; orbit.tTheta = CINE_KF[0].theta;
  cinema.raf = requestAnimationFrame(cineTick);
}

function cineEnd(skipped) {
  if (!cinema.on) return;
  cinema.endReason = 'skipped=' + skipped + ' t=' + cinema.t.toFixed(2) + ' @ ' + (new Error().stack.split('\n')[2] || '').trim().slice(0, 80);
  cinema.on = false;
  cancelAnimationFrame(cinema.raf);
  document.body.classList.remove('cinema-mode');
  for (const b of cinema.bars || []) b.classList.remove('show');
  if (cinema.sub) cinema.sub.classList.remove('show');
  if (HOST.camSeq) HOST.camSeq.release('cinematic');
  // 仅当没有其他有效 owner 时才恢复机位（防止覆盖另一活跃序列的镜头）
  if (!(HOST.camSeq && HOST.camSeq.owner)) setView(0);
  S._guide = 1;
  if (!skipped) toast('开场完毕——按 空格 启动旋翼开始体验', 4000);
}

function cineTick(now) {
  if (!cinema.on) return;
  const dt = Math.min(0.05, (now - cinema.last) / 1000 || 0.016);
  cinema.last = now;
  cinema.t += dt;
  const t = cinema.t;
  // 关键帧插值（smoothstep 平滑：运镜加速-减速）
  let i = 0;
  while (i < CINE_KF.length - 1 && t > CINE_KF[i + 1].t) i++;
  const k0 = CINE_KF[i], k1 = CINE_KF[Math.min(i + 1, CINE_KF.length - 1)];
  const span = Math.max(0.001, k1.t - k0.t);
  const e = easeInOut(clamp((t - k0.t) / span, 0, 1));
  const tgt = [k0.tgt[0] + (k1.tgt[0] - k0.tgt[0]) * e,
               k0.tgt[1] + (k1.tgt[1] - k0.tgt[1]) * e,
               k0.tgt[2] + (k1.tgt[2] - k0.tgt[2]) * e];
  orbit.tTarget.set(tgt[0], tgt[1], tgt[2]);
  orbit.tPhi = k0.phi + (k1.phi - k0.phi) * e;
  orbit.tDist = k0.dist + (k1.dist - k0.dist) * e;
  orbit.tTheta = k0.theta + (k1.theta - k0.theta) * e;
  // 字幕（变化才写 DOM）
  if (cinema.sub) {
    let st = '';
    for (const [t0, txt] of CINE_SUB) if (t >= t0 && t < t0 + 4.2) st = txt;
    if (cinema.sub.dataset.txt !== st) {
      cinema.sub.dataset.txt = st;
      cinema.sub.textContent = st;
      cinema.sub.classList.toggle('show', !!st);
    }
  }
  if (t >= CINE_DUR) { cineEnd(false); return; }
  cinema.raf = requestAnimationFrame(cineTick);
}

// —— 跳过：Esc / 点击画面 / 任意键（capture 阶段，先于功能键路由）——
// 最终闭环修复（输入穿透）：跳过事件必须被消费（preventDefault +
// stopImmediatePropagation），否则同一事件继续进入全局输入逻辑——空格
// 同时启停旋翼、C 同时切换 FPV、T 同时起降、pointerdown 被 Orbit 接收
// 取消返回镜头。仅在过场激活时拦截，非过场状态零干预。
addEventListener('keydown', e => {
  if (!cinema.on) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  cineEnd(true);
}, true);
addEventListener('pointerdown', e => {
  if (!cinema.on) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  cineEnd(true);
}, true);

// —— 首访自动播放：loading 完成且从未看过（ah64_seen 未写）时启动 ——
// 78 在脚本求值期执行，早于 bindUI 写入 ah64_seen，判定准确
(function initCinematic() {
  let pending = false;
  // ?nocine=1：自动化测试通道——跳过开场直接进入可交互状态（真实用户无参数正常播放）
  try { pending = !localStorage.getItem('ah64_seen') && !/[?&]nocine=1/.test(location.search); } catch (e) { return; }
  if (!pending) return;
  const iv = setInterval(() => {
    const ld = document.getElementById('loading');
    if (!(ld && ld.classList.contains('done') && window.__dbg)) return;
    // P1：主菜单期间不播（等用户选入口）；直接进游戏则跳过开场——只在进入展示时播一次
    const bc = document.body.classList;
    if (bc.contains('app-menu')) return;
    clearInterval(iv);
    if (bc.contains('app-play')) return;
    cineStart();
  }, 200);
})();

// __dbg 在 72-uibind 的 bindUI（GLB 载入完）时才创建——轻量轮询挂上遥测后自清
// （76-mobile.mobileSticks 挂载同款先例；72 低编号不可反向引用 78 的符号）
const _cineIv = setInterval(() => {
  if (window.__dbg) { window.__dbg.cinema = cinema; clearInterval(_cineIv); }
}, 250);
