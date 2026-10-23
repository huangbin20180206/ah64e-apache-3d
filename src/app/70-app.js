// ============================================================
// 70-app.js — 入口核心：渲染器 / 世界 / 状态源 S / 子系统槽 / 靶场 HUD / 画质
// ============================================================
// 2026-10-12 拆分：载入装配 → 70-start.js；帧循环 → 70-loop.js；任务系统 →
// 70-mission.js；作战子系统帧逻辑 → 70-combat.js；HUD/后处理帧逻辑 → 70-hud.js；
// 部件标签 → 70-labels.js；机位/截图 → 70-camera.js。boot() 在 70-start.js 末尾调用。

// UI / toast 已前移至 01-host.js（Phase 1-A：宿主层，低编号模块正向引用）
const canvas = UI('gl');

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, alpha: false, stencil: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: false,
});
// 后处理链末端手动做 sRGB 编码，渲染器这里保持线性输出，避免转换两次
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x07090c, 1);

// WebGL 上下文丢失（切换显卡/驱动重置/长时间后台）默认表现是画面永久冻结、
// 控制台一句警告——用户只看到"卡死"。这里显式接住：阻止默认行为让浏览器
// 有机会恢复，并把状态说清楚；恢复后 three 会重建资源，只需重新 resize。
let _ctxLost = false;
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  _ctxLost = true;
  window.__showErr('显卡上下文丢失，正在尝试恢复（若长时间无响应请刷新页面）');
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  _ctxLost = false;
  const l = UI('loading');
  if (l) l.classList.add('done');
  resize();
}, false);

const W = buildWorld(renderer);
const scenery = buildWorldScenery(W);   // P4c 远山/树线/湖岸/停机坪设施（31-scenery）
const composer = new Composer(renderer, W);
const orbit = new Orbit(W.camera, canvas);

const S = {
  quality: 1,
  running: false,      // 旋翼开关
  spin: 0,             // 0..1 转速比
  angle: 0,            // 主旋翼累积角
  tailAngle: 0,
  radarPhase: 0,
  disc: true, vib: true, scan: true,
  labels: false,
  env: 'day', scheme: 'lowvis',
  time: 0, view: 0,
  _fa: 0, _ft: 0, _rpmShown: -1,
  _slow: 0, _qManual: false, _qAuto: false, _qCool: 0, _qAutoOff: false,   // 自动降档：连续低帧计数 / 手动选档 / 已自动降档 / 冷却倒计时 / 用户停用
  _alt: 0, _ga: -1, _ha: -1, _rk: -1, _fs: '', _guide: 0, _autoTO: false,   // 首访引导步骤（0=关）
  _slowmo: 0, _flash: 0, _shake: 0,   // 电影镜头包 S3：击毁慢动作计时/白闪/震屏
  _train: 0, _trainFp: false, _trainOrbit: false, _trainRescue: false, _trainGun0: 0,
  // Phase 11 训练引导步骤（1..5，0=关）：与首访引导 S._guide 同属 S 状态源但互不混用
  // （首访任意模式触发，训练仅 train 模式触发）；判定复用 __dbg 既有状态源，
  // 不另起独立步骤管理器。_trainFp/_trainOrbit/_trainRescue 为"进入过"的一次性标记，
  // _trainGun0 是第 ④ 步弹药基准快照（该步进入时记录，弹药减少即算开过火）。
  mode: 'show',                // P6：展示|训练|任务（show=自由演示零污染；train=提示条；mission=统一任务）
  weather: 'none',             // Phase 13-M4：天气 none|sand（沙暴）|storm（夜雷暴）——chip 驱动
  _swSeen: 0,                  // Phase 19：已播报的 SAM 发射计数（增量跟踪）
  _pen: { speedMul: 1, yawMul: 1 },   // Phase 19：操控惩罚合成（持久对象逐帧写值，零分配；SAM 表 × 机务 respMul）
  _dmgFx: null,                // Phase 19：机务派生量引用（86-damage fx() 复用对象）
};

// Phase 1-A：宿主注册（01-host.js）——低编号消费者（30-world / 45-flight /
// 46-fpview / 47-betty）经 HOST 取用，不再依赖"恰好此处先声明了同名 const"
HOST.renderer = renderer; HOST.orbit = orbit; HOST.S = S;

let apache = null, disc = null, discMat = null, shotPending = false, rig = null, targets = null, washfx = null, audio = null, refl = null, air = null, nlights = null, fp = null, rescue = null, dp = null, weather = null, music = null, narrative = null, arcade = null, samwar = null, samvis = null, damageSys = null, enemyAir = null, enemyVis = null, resources = null, campaign = null, progress = null, course = null, infantry = null, life = null;

// 靶场 HUD：存活/击毁计数
let _kills = 0;
// 玩法批 B3：多杀播报——2.2s 窗口内连续击毁累计（真实时钟：慢动作期间的
// 连锁殉爆不会因为模拟变慢而被拆成两段）
let _streak = 0, _streakAt = -1e9;
const STREAK_NAMES = ['', '', '双杀', '三杀', '四杀', '暴风扫荡'];
function updateTargetHUD(hit) {
  if (hit) {
    _kills++;
    const now = performance.now();
    _streak = (now - _streakAt < 2200) ? _streak + 1 : 1;
    _streakAt = now;
    // 电影镜头包 S3：击毁慢动作 + 白闪 + 震屏（连续击毁不叠加，取峰值语义）
    S._slowmo = 0.55; S._flash = 0.5; S._shake = 1.0;
    // B3 终结镜头：任务局清掉最后一个地面目标 → 慢动作拉长到 1.3s、震屏加重
    const _final = !!(targets && targets.aliveCount === 0 && S._mission && S._mission.phase === 'active');
    if (_final) {
      S._slowmo = 1.3; S._flash = 0.7; S._shake = 1.4;
    }
    // E1 击毁特写：切侧面低机位慢镜头（条件/频率见 70-killcam.js）
    killcamTry(hit, _final);
    if (!_final) radioSay(_streak >= 2 ? 'multi' : 'kill');   // E2 无线电（最后一个由任务完成台词接）
    toast(`已击毁：${hit.label}（第 ${_kills} 个）`);
    killFeed(hit.label, hit._chain);
    if (_streak >= 2) streakBanner(STREAK_NAMES[Math.min(_streak, STREAK_NAMES.length - 1)]);
    // Phase 13-S4：击毁铜管 cue（战斗配乐的打击反馈）
    if (music) music.brass();
    // Phase 18：击毁计分（类型基础分 × 难度系数 × 连击系数；仅进行中任务局计入，
    // done/frozen 后的击毁不计——旧局已结算，下局 startMission 清零重计）
    if (arcade && S._mission && S._mission.phase === 'active') { arcade.onKill(hit.type, S._mission); }
  }
  if (!targets) return;
  UI('v-targets').textContent = String(targets.aliveCount);
  UI('v-kills').textContent = String(_kills);
  UI('chk-targets').nextSibling.textContent = `显示攻击靶标 ×${targets.totalCount}`;
}

// 击杀信息流：右侧滑入条目，3s 后淡出移除（FPV/环绕模式都可见）
function killFeed(label, chain = false) {
  const box = UI('killfeed');
  if (!box) return;
  const el = document.createElement('div');
  el.className = chain ? 'kf kf-chain' : 'kf';
  el.textContent = (chain ? '✹ 连锁殉爆 ' : '✓ 已击毁 ') + label;
  box.prepend(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, 3000);
  while (box.children.length > 4) box.lastChild.remove();   // 最多保留 4 条
}

// B3 多杀横幅：屏幕上方居中弹出（1.4s 后淡出；连续触发重启动画，不堆叠）
function streakBanner(text) {
  const el = UI('streak');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(streakBanner._t);
  streakBanner._t = setTimeout(() => el.classList.remove('show'), 1400);
}

// FPV 命中标记：十字线收缩闪白 180ms（加色感，不遮挡瞄准）
function hitMark() {
  const r = UI('fp-reticle');
  if (!r) return;
  r.classList.remove('hit');
  void r.offsetWidth;                       // 重排触发动画重启
  r.classList.add('hit');
  setTimeout(() => r.classList.remove('hit'), 180);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  // 画质档位统一走 QUALITY_PRESETS.scale：低档位不只是降分辨率，
  // 还要同步降 bloom 级数与特效粒子上限，否则"性能档"只减了像素、
  // CPU 侧粒子更新和 draw call 一点没省（这是旧实现的空档）。
  const dpr = Math.min(devicePixelRatio || 1, 2) * qualityPreset(S.quality).scale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  W.camera.aspect = w / h;
  // polish3c：竖屏（宽<高）时相机只按竖向视角取景，左右太窄——直升机被切掉一半。
  // 竖屏把镜头拉广，让横向看到的范围约等于方屏（横屏/桌面 zoom 恒为 1，不受影响）
  W.camera.zoom = w < h ? Math.max(0.4, w / h) : 1;
  W.camera.updateProjectionMatrix();
  composer.setSize(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)));
}
addEventListener('resize', resize);

// 画质档位唯一入口：分辨率 + bloom 级数 + 特效密度三处联动。
// UI 下拉、启动初始化、以及未来的自动降档都必须走这里。
function applyQuality(q) {
  S.quality = q;
  if (S._qSync) S._qSync();
  const P = qualityPreset(q);
  composer.setQuality(q);
  if (washfx) washfx.setQualityEffects(P.effects);
  // P0-② 阴影/倒影/各向异性按质量档统一下发
  if (W.setShadowQuality) W.setShadowQuality(P.shadow, P.shadowRadius);
  if (refl) refl.setUpdateRate(P.reflect);
  // P10：重点部件细节件跟随质量档（低档加载路径降级——不加载；切档联动显隐）
  if (dp) dp.setQuality(q);
  resize();
  return P;
}
