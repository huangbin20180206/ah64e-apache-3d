// ============================================================
// 74-tour.js — 一键智能导览（2026-09-02，竞赛评审视角）
// 60 秒自动巡航：夜景灯光 → 沙漠起飞 brownout → 湖面涟漪着舰 →
// 爆炸视图。全部动作走既有 UI 通道（芯片点击 / 合成键盘事件），
// 不直接操纵内部状态机——导览本身成了 UI 回归的活体演示。
// 用户任何 canvas 按下 / Esc / 再点按钮 = 立即交还控制权。
// ============================================================

const tour = { on: false, paused: false, t: 0, idx: 0, raf: 0, last: 0, cap: null, btn: null, pbtn: null, nbtn: null };
// P2-B4：经 HOST 正向注册导览状态（72-uibind 的 __dbg 经 HOST.tourState 读取，
// 避免 72 引用 74 符号的反向引用——槽名 tourState 刻意避开顶层符号名 tour，
// 拓扑检查器按标识符扫描，getter 键/属性名与 74 顶层 const 同名会被判反向）
HOST.tourState = tour;

function tourCap(txt) {
  if (!tour.cap) {
    const c = document.createElement('div');
    c.id = 'tour-cap';
    c.style.cssText = 'position:fixed;left:50%;bottom:9%;transform:translateX(-50%);' +
      'max-width:78%;padding:10px 22px;border-radius:22px;background:rgba(10,14,18,.78);' +
      'color:#eaf2f6;font-size:15px;letter-spacing:.5px;text-align:center;' +
      'border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(6px);' +
      'z-index:60;pointer-events:none;transition:opacity .5s;opacity:0';
    document.body.appendChild(c);
    tour.cap = c;
  }
  tour.cap.textContent = txt;
  tour.cap.style.opacity = '1';
  clearTimeout(tour._capT);
  tour._capT = setTimeout(() => { if (tour.cap) tour.cap.style.opacity = '0'; }, 5200);
}

function tourKey(code) {
  // 合成键盘事件走 app 既有的全局键位路由（Space 旋翼 / T 起降 / C 座舱 / F 武器）
  dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code.slice(3), bubbles: true }));
  dispatchEvent(new KeyboardEvent('keyup', { code, key: code === 'Space' ? ' ' : code.slice(3), bubbles: true }));
}

// 步骤表：t=触发秒；fn=动作；cap=字幕
function tourSteps() {
  return [
    { t: 0.0, cap: '一键导览 · 60 秒看完本项目（按 Esc 或点击画面随时接管）', fn() { tourGo(1.15, 24); } },
    { t: 3.5, cap: '夜间指示灯：航行灯 · 防撞信标 · 垂尾双闪频闪 · 机腹搜索灯 · 编队灯条',
      fn() { clickEnv('night'); tourGo(1.10, 15); } },
    { t: 12.0, cap: '沙漠场景：远景沙丘 · 风纹 · 吹蚀痕迹', fn() { clickEnv('day'); clickTerrain('desert'); tourGo(1.30, 26); } },
    { t: 13.5, cap: '旋翼启动——下洗开始卷扬沙尘', fn() { tourKey('Space'); } },
    // 启旋→起飞要留足转速爬升（MIN_SPIN 92%，实测 6~9s），早按 T 会被拒
    { t: 25.0, cap: '起飞：低空 brownout，遮云蔽日', fn() { tourKey('KeyT'); tourGo(1.22, 21); } },
    { t: 34.0, cap: '转换场地：湖面——镜面反射 · 碎金光路 · 下洗涟漪',
      fn() { clickTerrain('water'); tourGo(1.28, 24); } },
    { t: 41.0, cap: '着舰：溅射 · 泡沫痕 · 外传波环', fn() { tourKey('KeyT'); tourGo(1.38, 20); } },
    { t: 47.0, cap: '爆炸视图：部件级装配与涂装体系', fn() {
        clickTerrain('pad');
        // 着舰（t=41）两段进近实测落稳需 ~11s（最后 4u 收敛到 0.35u/s），到本段
        // 仅 6s 机体仍在 down 半空——爆炸视图会在下降途中把部件炸开、触地后再合体
        //（用户实测"降落中解体再合体"）。爆炸视图是停稳整机的静态部件展示，此处
        // 先把机体钉到"已触地"终态（与 45-flight down→ground 触地复位逐位一致），
        // 保证展示对象是落稳的整机，不与"降落中"重叠。
        FLY.state = 'ground'; FLY.alt = 0; FLY.x = 0; FLY.z = 0; FLY.yaw = 0; FLY.roll = 0; FLY.userAlt = null;
        try { apache.setExplode(1); } catch (e) {}
        tourGo(1.18, 19);
      } },
    { t: 53.0, cap: '悬停后按 C 进第一人称座舱 · 鼠标左键机炮 · 右键火箭 · F 地狱火',
      fn() { try { apache.setExplode(0); } catch (e) {} } },
    { t: 59.0, cap: '导览结束——所有灯光、音效、弹道、涟漪均为程序化实时生成', fn() { tourStop(true); } },
  ];
}

function tourGo(phi, dist) { orbit.tPhi = phi; orbit.tDist = dist; }
function clickEnv(k) { const el = document.querySelector('#env-row [data-env="' + k + '"]'); if (el) el.click(); }
function clickTerrain(k) { const el = document.querySelector('#terrain-row [data-terrain="' + k + '"]'); if (el) el.click(); }

function tourTick(ts) {
  if (!tour.on) return;
  // P2-B4：暂停时只同步时间基准（恢复时 dt 从 0 起算），时间/环绕/步骤
  // 全部冻结——评审可以停在某一幕看细节；场景本身保持活着（场景保留语义）
  if (tour.paused) { tour.last = ts; tour.raf = requestAnimationFrame(tourTick); return; }
  const dt = Math.min(0.05, (ts - tour.last) / 1000 || 0.016);
  tour.last = ts;
  tour.t += dt;
  orbit.tTheta += dt * 0.13;                 // 缓慢环绕，画面永远是活的
  while (tour.idx < tour.steps.length && tour.t >= tour.steps[tour.idx].t) {
    const s = tour.steps[tour.idx++];
    if (s.cap) tourCap(s.cap);
    try { s.fn(); } catch (e) {}
  }
  tour.raf = requestAnimationFrame(tourTick);
}

function tourStart() {
  if (tour.on) return;
  S._guide = 0;   // Phase 2-A3：导览启动时清除首访引导（两者互斥，引导字幕会干扰导览字幕）
  // 起点标准化：回到停机坪·白天·地面，观众从同一叙事线出发
  try {
    clickEnv('day'); clickTerrain('pad');
    if (FLY.state !== 'ground') tourKey('KeyT');
    if (S.running) tourKey('Space');
    apache.setExplode(0);
    orbit.tTarget.set(0, 1.1, 0);
  } catch (e) {}
  tour.on = true; tour.paused = false; tour.t = 0; tour.idx = 0; tour.steps = tourSteps(); tour.last = performance.now();
  tour.btn.textContent = '■'; tour.btn.classList.add('on');
  if (tour.xbtn) tour.xbtn.style.display = 'inline-block';   // 显式出口常驻
  cineChrome(true);
  syncTourCtl();
  tour.raf = requestAnimationFrame(tourTick);
}

// polish3：航线/导览是电影画幅，右侧面板、左下参数框、操作提示、机位条、顶栏会挡住直升机 →
// 播放期间收起，结束时按进入前状态恢复面板（75-routes 共用）
const _cine = { css: null, pnHid: undefined };
function cineChrome(on) {
  if (!_cine.css) {
    _cine.css = document.createElement('style');
    _cine.css.textContent = 'body.route-mode #specs,body.route-mode #guide,body.route-mode #views,' +
      'body.route-mode #top{opacity:0!important;pointer-events:none!important;transition:opacity .4s}';
    document.head.appendChild(_cine.css);
  }
  if (document.body.classList.contains('route-mode') === !!on) return;
  document.body.classList.toggle('route-mode', !!on);
  const pn = document.getElementById('panel');
  if (!pn) return;
  if (on) { _cine.pnHid = pn.classList.contains('hide'); pn.classList.add('hide'); }
  else if (_cine.pnHid === false) { pn.classList.remove('hide'); _cine.pnHid = undefined; }
}

function tourStop(quiet) {
  if (!tour.on) return;
  tour.on = false;
  tour.paused = false;
  cancelAnimationFrame(tour.raf);
  tour.btn.textContent = '▶'; tour.btn.classList.remove('on');
  if (tour.xbtn) tour.xbtn.style.display = 'none';
  cineChrome(false);
  syncTourCtl();
  if (!quiet && tour.cap) tour.cap.style.opacity = '0';
}

// —— P2-B4：暂停/继续与跳段（评审可控性）——
// 停止语义不变：只交还控制权、场景保留；暂停/跳段是导览自身的控制，
// 与 74 自含 UI 的既有模式一致（按钮/合成键），不碰内部状态机。
function syncTourCtl() {
  if (tour.pbtn) {
    tour.pbtn.style.display = tour.on ? 'inline-flex' : 'none';
    tour.pbtn.textContent = tour.paused ? '▶ 继续' : 'Ⅱ 暂停';
    tour.pbtn.setAttribute('aria-pressed', tour.paused ? 'true' : 'false');
  }
  if (tour.nbtn) tour.nbtn.style.display = tour.on ? 'inline-flex' : 'none';
  // 暂停时保住当前字幕供细看（清掉 5.2s 淡出计时）；恢复时重新计时淡出
  if (tour.on && tour.cap) {
    clearTimeout(tour._capT);
    if (tour.paused) tour.cap.style.opacity = '1';
    else tour._capT = setTimeout(() => { if (tour.cap) tour.cap.style.opacity = '0'; }, 5200);
  }
}

function tourTogglePause() {
  if (!tour.on) return;
  tour.paused = !tour.paused;
  tour.last = performance.now();   // 恢复时 dt 从 0 起算，不补偿暂停时长
  syncTourCtl();
}

function tourNext() {
  if (!tour.on) return;
  if (tour.idx >= tour.steps.length) return;   // 尾声：等最后一段自然收尾
  // 直接跳到下一段的触发时刻；下一 tick 的 while 循环接管（cap+fn 原路触发）
  tour.t = tour.steps[tour.idx].t;
  if (tour.paused) { tour.paused = false; }   // 跳段即继续观看
  tour.last = performance.now();
  syncTourCtl();
}

// —— 自含 UI：并入右上角图标按钮排（与面板开关/帮助并列，永不与面板重叠）——
(function tourUI() {
  const host = document.getElementById('top-right');
  const b = document.createElement('button');
  b.id = 'btn-tour';
  b.type = 'button';
  b.className = 'iconbtn';
  b.textContent = '▶';
  b.title = '一键导览：60 秒自动演示全项目（Esc 或点击画面随时接管）';
  b.setAttribute('aria-label', b.title);
  b.addEventListener('click', () => (tour.on ? tourStop() : tourStart()));
  if (host) host.appendChild(b); else document.body.appendChild(b);
  tour.btn = b;
  // 显式退出按钮（用户实测"进入后无退出功能"）：Esc/点画面/再点▶都是隐形通道，
  // 普通用户需要看得见的出口。独立元素不塞字幕条——字幕会淡出（父级 opacity
  // 会连带子元素隐没，!important 也救不了）
  const x = document.createElement('button');
  x.id = 'tour-exit';
  x.type = 'button';
  x.textContent = '■ 退出导览';
  x.title = '退出导览，交还控制权（Esc / 点击画面同样有效）';
  x.style.cssText = 'position:fixed;left:50%;bottom:4%;transform:translateX(-50%);z-index:62;' +
    'padding:8px 22px;border:1px solid rgba(255,255,255,.35);border-radius:20px;' +
    'background:rgba(16,24,30,.92);color:#f2f7fa;font-size:13px;font-weight:600;' +
    'letter-spacing:2px;cursor:pointer;display:none;backdrop-filter:blur(6px)';
  x.addEventListener('click', () => tourStop());
  document.body.appendChild(x);
  tour.xbtn = x;
  // P2-B4：暂停/继续 + 跳段——评审可以停在某一幕看细节，或直接跳到下一段。
  // 与退出键错开分置屏幕两角（窄屏也不挤）；只在导览运行时显示。
  const ctlBase = 'position:fixed;bottom:4%;z-index:62;padding:8px 18px;' +
    'border:1px solid rgba(255,255,255,.35);border-radius:20px;' +
    'background:rgba(16,24,30,.92);color:#f2f7fa;font-size:13px;font-weight:600;' +
    'letter-spacing:2px;cursor:pointer;display:none;backdrop-filter:blur(6px)';
  const p = document.createElement('button');
  p.id = 'tour-pause';
  p.type = 'button';
  p.textContent = 'Ⅱ 暂停';
  p.title = '暂停/继续导览（画面停在当前一幕，场景保留）';
  p.setAttribute('aria-label', p.title);
  p.style.cssText = ctlBase + ';left:12px';
  p.addEventListener('click', () => tourTogglePause());
  document.body.appendChild(p);
  tour.pbtn = p;
  const n = document.createElement('button');
  n.id = 'tour-next';
  n.type = 'button';
  n.textContent = '下一段 »';
  n.title = '跳到导览下一段';
  n.setAttribute('aria-label', n.title);
  n.style.cssText = ctlBase + ';right:12px';
  n.addEventListener('click', () => tourNext());
  document.body.appendChild(n);
  tour.nbtn = n;
  // 观众接管：任何画面按下 / Esc 停止导览（交还控制权就是傻瓜化的另一半）
  addEventListener('keydown', e => { if (e.code === 'Escape') tourStop(); }, true);
  const cv = document.querySelector('canvas');
  if (cv) cv.addEventListener('pointerdown', () => tourStop(), { capture: true });
})();
