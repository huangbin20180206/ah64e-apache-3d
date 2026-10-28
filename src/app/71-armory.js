// ============================================================
// 71-armory.js — 装备图鉴全屏界面（2026-10-17）
// ============================================================
// 左：只露出半边的旋转轮盘（拖动 / 滚轮 / 方向键 / 点条目选择，松手带惯性并吸附到最近条目）；
// 右：所选条目的高清照片（扫描式切换 + 缓慢推镜）+ 参数读数 + 打字机正文。
// 竖屏（手机）时轮盘移到底部、露出上半圆，指针朝上。
// 纯 DOM + Canvas 2D，不用 WebGL：打开期间 S.armoryOpen=true，70-loop 暂停 3D 渲染，
// 低配电脑 / 手机也流畅。数据与轮盘数学在 35-armorydata.js。
// 入口：主菜单第 3 张卡（70-appmode，按 3）、展示「知识」页按钮 #btn-armory、URL #armory。
// 对外：HOST.armory（open / close / go / isOpen / sel / typed），测试也走这里。

const ARM = {
  el: null, built: false, open: false,
  rot: 0, vel: 0, target: null, sel: -1, shown: -1,
  drag: null, raf: 0, last: 0, settleT: 0,
  typeTimer: 0, typed: 0, full: '',
  geo: null, front: 0, opener: null,
};
const ARM_N = ARMORY_ITEMS.length;
const ARM_DIR = 'assets/armory/';
const ARM_CSS = `
#armory{position:fixed;inset:0;z-index:60;display:none;color:#e8efe9;background:#05080a;overflow:hidden;
  font-family:inherit;user-select:none;-webkit-user-select:none;touch-action:none}
#armory.on{display:block;animation:armIn .45s ease both}
@keyframes armIn{from{opacity:0}to{opacity:1}}
#armory .arm-bg{position:absolute;inset:-20px;background:#05080a center/cover no-repeat;opacity:.22;filter:blur(14px) saturate(.6)}
#armory .arm-grid{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(rgba(159,212,184,.05) 1px,transparent 1px) 0 0/48px 48px,
             linear-gradient(90deg,rgba(159,212,184,.05) 1px,transparent 1px) 0 0/48px 48px,
             radial-gradient(ellipse at 30% 50%,rgba(5,8,10,0) 0%,rgba(5,8,10,.85) 75%)}
#armory .arm-top{position:absolute;left:0;right:0;top:0;height:56px;display:flex;align-items:center;gap:16px;padding:0 20px;
  border-bottom:1px solid rgba(159,212,184,.16);background:linear-gradient(180deg,rgba(3,5,6,.9),rgba(3,5,6,.4))}
#armory .arm-brand{display:flex;flex-direction:column;line-height:1.15}
#armory .arm-brand i{font-style:normal;font-family:var(--mono);font-size:9px;letter-spacing:.36em;color:#6f8a7d}
#armory .arm-brand b{font-size:17px;letter-spacing:.3em}
#armory .arm-count{margin-left:auto;font-family:var(--mono);font-size:12px;letter-spacing:.2em;color:#9fd4b8}
#armory .arm-x{width:36px;height:36px;border:1px solid rgba(159,212,184,.3);background:rgba(255,255,255,.03);color:#cfe3d8;
  font-size:16px;cursor:pointer;border-radius:3px}
#armory .arm-x:hover,#armory .arm-x:focus-visible{border-color:#9fd4b8;color:#fff;outline:none}
#armory .arm-wheel{position:absolute;left:0;top:56px;bottom:0;width:min(40vw,560px);cursor:grab;touch-action:none}
#armory .arm-wheel.drag{cursor:grabbing}
#armory .arm-wheel canvas{position:absolute;inset:0;width:100%;height:100%}
#armory .arm-item{position:absolute;left:0;top:0;display:flex;align-items:center;gap:8px;white-space:nowrap;
  transform-origin:0 0;cursor:pointer;color:#a9b8b0;font-size:14px;letter-spacing:.12em;will-change:transform,opacity}
#armory .arm-item i{font-style:normal;font-family:var(--mono);font-size:10px;color:#6f8a7d;letter-spacing:.1em}
#armory .arm-item.w i{color:#a8885a}
#armory .arm-item.on{color:#fff;font-weight:700;text-shadow:0 0 12px rgba(159,212,184,.45)}
#armory .arm-item.on i{color:#9fd4b8}
#armory .arm-item.w.on i{color:#f0b45a}
#armory .arm-hub{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;
  transform:translate(-50%,-50%);text-align:center}
#armory .arm-hub b{font-size:20px;letter-spacing:.3em;padding-left:.3em}
#armory .arm-hub i{font-style:normal;font-family:var(--mono);font-size:9px;letter-spacing:.32em;color:#6f8a7d;margin-top:4px}
#armory .arm-hint{position:absolute;left:18px;bottom:16px;font-size:11px;color:#6f8a7d;letter-spacing:.12em;pointer-events:none}
#armory .arm-view{position:absolute;top:76px;right:clamp(16px,3vw,48px);bottom:20px;left:calc(min(40vw,560px) + 12px);
  display:flex;flex-direction:column;gap:12px;min-width:0}
#armory .arm-frame{position:relative;flex:0 0 auto;width:100%;aspect-ratio:16/10;max-height:58vh;overflow:hidden;background:#0a0f10;
  border:1px solid rgba(159,212,184,.22)}
#armory .arm-frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;
  filter:var(--armg)}
#armory{--armg:brightness(.8) contrast(1.12) saturate(.72)}  /* 统一调色：压暗、提对比、降饱和，白天空不再刺眼 */
#armory .arm-frame img.cur{opacity:1;animation:armKen 14s ease-out both}
#armory .arm-frame img.in{opacity:1;animation:armWipe .7s cubic-bezier(.2,.7,.2,1) both,armKen 14s ease-out both}
@keyframes armWipe{from{clip-path:inset(0 100% 0 0);filter:brightness(1.8) saturate(.2)}to{clip-path:inset(0 0 0 0);filter:var(--armg)}}
@keyframes armKen{from{transform:scale(1.06)}to{transform:scale(1)}}
#armory .arm-scan{position:absolute;top:0;bottom:0;width:3px;left:-4px;background:#9fd4b8;box-shadow:0 0 18px 4px rgba(159,212,184,.55);opacity:0;pointer-events:none}
#armory .arm-scan.go{animation:armScan .7s cubic-bezier(.2,.7,.2,1) both}
#armory .arm-frame.arm-img-fallback::before{content:'【 战术装备图像档案归档调取中 】';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;letter-spacing:.3em;color:#9fd4b8;background:radial-gradient(ellipse at center,rgba(18,52,60,.4) 0%,rgba(5,8,10,.9) 70%);z-index:1}
@keyframes armScan{0%{left:0;opacity:1}90%{opacity:1}100%{left:100%;opacity:0}}
#armory .arm-frame::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(0deg,rgba(3,6,7,.88) 0%,rgba(3,6,7,0) 42%),
             linear-gradient(180deg,rgba(3,6,7,.45) 0%,rgba(3,6,7,0) 32%),
             radial-gradient(ellipse 75% 70% at 50% 45%,rgba(3,6,7,0) 55%,rgba(3,6,7,.7) 100%),
             linear-gradient(rgba(18,52,60,.22),rgba(18,52,60,.22)),
             repeating-linear-gradient(0deg,rgba(0,0,0,.08) 0 1px,transparent 1px 3px)}
#armory .arm-cn{position:absolute;width:18px;height:18px;border:2px solid #9fd4b8;z-index:2;pointer-events:none}
#armory .arm-cn.a{left:8px;top:8px;border-right:0;border-bottom:0}
#armory .arm-cn.b{right:8px;top:8px;border-left:0;border-bottom:0}
#armory .arm-cn.c{left:8px;bottom:8px;border-right:0;border-top:0}
#armory .arm-cn.d{right:8px;bottom:8px;border-left:0;border-top:0}
#armory .arm-cap{position:absolute;left:22px;right:22px;bottom:16px;z-index:2}
#armory .arm-cap i{font-style:normal;font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:#9fd4b8}
#armory .arm-cap.w i{color:#f0b45a}
#armory .arm-cap h2{margin:4px 0 0;font-size:clamp(22px,3vw,38px);letter-spacing:.12em;line-height:1.15}
#armory .arm-cap em{font-style:normal;font-family:var(--mono);font-size:11px;letter-spacing:.28em;color:#9aa7a0}
#armory .arm-params{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:0}
#armory .arm-params div{border-left:2px solid rgba(159,212,184,.5);padding:4px 8px;background:rgba(255,255,255,.025);
  opacity:0;transform:translateY(6px);transition:opacity .35s ease,transform .35s ease}
#armory .arm-params.w div{border-left-color:rgba(240,180,90,.6)}
#armory .arm-params div.on{opacity:1;transform:none}
#armory .arm-params dt{font-size:10px;color:#7d8a83;letter-spacing:.14em}
#armory .arm-params dd{margin:2px 0 0;font-size:13px;color:#e8efe9;line-height:1.35}
#armory .arm-body{margin:0;font-size:14.5px;line-height:1.85;color:#cfd9d3;letter-spacing:.04em;flex:1 1 auto;overflow:auto;min-height:0;cursor:pointer}
#armory .arm-caret{display:inline-block;width:8px;height:1.05em;margin-left:2px;vertical-align:-2px;background:#9fd4b8;animation:armBlink 1s steps(1) infinite}
@keyframes armBlink{50%{opacity:0}}
#armory .arm-credit{font-size:10px;color:#5f6f67;letter-spacing:.06em}
@media (max-width:1100px){#armory .arm-params{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* 竖屏：轮盘到底部露出上半圆，内容在上方 */
#armory.v .arm-wheel{left:0;right:0;top:auto;bottom:0;width:auto;height:min(34vh,72vw)}
#armory.v .arm-item{transform-origin:0 0;font-size:13px;flex-direction:column;gap:2px;letter-spacing:.06em}
#armory.v .arm-hint{display:none}
#armory.v .arm-view{left:12px;right:12px;top:64px;bottom:calc(min(34vh,72vw) + 4px);gap:8px}
#armory.v .arm-frame{max-height:32vh}
#armory.v .arm-body{font-size:13.5px;line-height:1.7}
#armory.v .arm-params dd{font-size:12px}
@media (prefers-reduced-motion:reduce){#armory .arm-frame img.in,#armory .arm-frame img.cur{animation:none}#armory .arm-scan.go{animation:none}}
`;

function _armBuild() {
  if (ARM.built) return;
  ARM.built = true;
  const st = document.createElement('style');
  st.textContent = ARM_CSS;
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'armory';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '装备图鉴');
  el.tabIndex = -1;
  el.innerHTML =
    '<div class="arm-bg"></div><div class="arm-grid"></div>' +
    '<div class="arm-top"><div class="arm-brand"><i>AH-64E APACHE GUARDIAN</i><b>装备图鉴</b></div>' +
    '<div class="arm-count"></div><button class="arm-x" type="button" aria-label="关闭图鉴（Esc）" title="关闭（Esc）">✕</button></div>' +
    '<div class="arm-wheel" role="listbox" aria-label="拖动转盘选择部件或武器"><canvas></canvas><div class="arm-items"></div>' +
    '<div class="arm-hub"><b></b><i></i></div><div class="arm-hint">拖动转盘 · 滚轮 / 方向键也能切换</div></div>' +
    '<div class="arm-view"><div class="arm-frame"><img alt=""><img alt=""><div class="arm-scan"></div>' +
    '<span class="arm-cn a"></span><span class="arm-cn b"></span><span class="arm-cn c"></span><span class="arm-cn d"></span>' +
    '<div class="arm-cap" aria-live="polite"><i></i><h2></h2><em></em></div></div>' +
    '<dl class="arm-params"></dl><p class="arm-body" title="点击直接显示全文"><span></span><i class="arm-caret"></i></p>' +
    '<small class="arm-credit"></small></div>';
  document.body.appendChild(el);
  ARM.el = el;
  el.querySelector('.arm-bg').style.backgroundImage = 'url(' + ARM_DIR + 'hero.webp)';
  const box = el.querySelector('.arm-items');
  ARMORY_ITEMS.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'arm-item ' + it.cat;
    d.setAttribute('role', 'option');
    d.innerHTML = '<i></i><span></span>';
    d.firstChild.textContent = String(i + 1).padStart(2, '0');
    d.lastChild.textContent = it.title;
    d.dataset.i = String(i);
    box.appendChild(d);
  });
  el.querySelector('.arm-x').onclick = armClose;
  el.querySelector('.arm-body').onclick = _armTypeFinish;
  const imgs = el.querySelectorAll('.arm-frame img');
  imgs[0].onload = imgs[1].onload = e => _armImgLoaded(e.target);
  _armBindWheel(el.querySelector('.arm-wheel'));
  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (Math.abs(e.deltaY) < 4) return;
    armGo(ARM.sel + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  addEventListener('resize', () => { if (ARM.open) { _armLayout(); _armDraw(); } });
}

// —— 布局：横屏轮盘在左（指针朝右），竖屏在下（指针朝上）——
function _armLayout() {
  const v = innerHeight > innerWidth * 1.05;
  ARM.el.classList.toggle('v', v);
  const w = ARM.el.querySelector('.arm-wheel');
  const W = w.clientWidth, H = w.clientHeight;
  const cv = w.querySelector('canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  // 轮盘半径故意比可见区大、圆心压在屏幕边外，露出来的是一段大弧，条目间距更舒展
  let cx, cy, R, base;
  if (v) { R = Math.min(W * 0.66, H * 1.15); cx = W / 2; cy = H + R * 0.2; base = -Math.PI / 2; }
  else { R = Math.min(H * 0.58, W * 1.05); cx = -R * 0.16; cy = H / 2; base = 0; }
  ARM.geo = { W, H, cx, cy, R, base, v, dpr, ri: R * (v ? 0.72 : 0.55) };
  const hub = w.querySelector('.arm-hub');
  const hr = R * 0.34;
  // 轴心文字放在轴心圆露出部分的中间
  if (v) { hub.style.left = cx + 'px'; hub.style.top = ((cy - hr) + Math.min(H, cy)) / 2 + 'px'; }
  else { hub.style.left = Math.max(58, (Math.max(0, cx) + cx + hr) / 2) + 'px'; hub.style.top = cy + 'px'; }
}

function _armDraw() {
  const g = ARM.geo;
  if (!g) return;
  const w = ARM.el.querySelector('.arm-wheel');
  const ctx = w.querySelector('canvas').getContext('2d');
  const { cx, cy, R, base, dpr } = g;
  const step = armoryStep(ARM_N);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, g.W, g.H);
  const off = -ARM.rot * step;               // 轮盘整体转角
  // 底盘
  const grd = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 1.02);
  grd.addColorStop(0, 'rgba(14,22,20,.92)'); grd.addColorStop(0.8, 'rgba(9,14,14,.75)'); grd.addColorStop(1, 'rgba(9,14,14,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2); ctx.fill();
  // 外圈刻度（随轮盘转）
  ctx.strokeStyle = 'rgba(159,212,184,.28)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 144; k++) {
    const a = base + off + k * Math.PI * 2 / 144;
    const long = k % 6 === 0;
    const r0 = R * (long ? 0.93 : 0.96);
    ctx.strokeStyle = long ? 'rgba(159,212,184,.55)' : 'rgba(159,212,184,.22)';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();
  }
  // 扇区：只画当前项和前后各 2 项（再往外淡出），每项一块环形扇区跟着轮盘转；
  // 越接近指针越亮，并整体向外凸出（rOut 变大 + 沿径向外移），选中项最明显
  const VIS = 2, FADE = 0.6, rIn = R * 0.52;
  const vis = [];
  for (let i = 0; i < ARM_N; i++) {
    const rel = armoryRel(i, ARM.rot, ARM_N), ar = Math.abs(rel);
    if (ar > VIS + FADE) continue;
    vis.push({ i, rel, ar, a: base + rel * step, near: Math.max(0, 1 - ar), f: Math.min(1, (VIS + FADE - ar) / FADE) });
  }
  vis.sort((p, q) => q.ar - p.ar);          // 选中项最后画，压在邻居上面
  for (const v of vis) {
    const c = ARMORY_ITEMS[v.i].cat === 'w' ? '240,180,90' : '159,212,184';
    const pop = R * 0.06 * v.near, ox = Math.cos(v.a) * pop, oy = Math.sin(v.a) * pop;
    const rOut = R * (0.86 + 0.07 * v.near), half = step * 0.42;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, rOut, v.a - half, v.a + half);
    ctx.arc(cx + ox, cy + oy, rIn, v.a + half, v.a - half, true);
    ctx.closePath();
    const sg = ctx.createRadialGradient(cx + ox, cy + oy, rIn, cx + ox, cy + oy, rOut);
    sg.addColorStop(0, 'rgba(' + c + ',' + (0.01 + 0.04 * v.near) * v.f + ')');
    sg.addColorStop(1, 'rgba(' + c + ',' + (0.03 + 0.17 * v.near) * v.f + ')');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.lineWidth = 1 + v.near;
    ctx.strokeStyle = 'rgba(' + c + ',' + (0.18 + 0.67 * v.near) * v.f + ')';
    ctx.stroke();
    // 外缘亮边
    ctx.lineWidth = Math.max(2, R * 0.01) * (0.5 + v.near);
    ctx.strokeStyle = 'rgba(' + c + ',' + (0.3 + 0.7 * v.near) * v.f + ')';
    ctx.shadowColor = 'rgba(' + c + ',.9)'; ctx.shadowBlur = 16 * v.near;   // 选中项外缘发光
    ctx.beginPath(); ctx.arc(cx + ox, cy + oy, rOut, v.a - half, v.a + half); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  // 内圈：虚线环（反向慢转）+ 实心轴心
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = 'rgba(159,212,184,.3)';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.42, -off * 0.5, -off * 0.5 + Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(6,10,10,.95)';
  ctx.strokeStyle = 'rgba(159,212,184,.45)';
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // 指针：从轴心指向所选条目，外缘一个三角
  const pc = ARMORY_ITEMS[Math.max(0, ARM.sel)].cat === 'w' ? '240,180,90' : '159,212,184';
  const ux = Math.cos(base), uy = Math.sin(base);
  ctx.strokeStyle = 'rgba(' + pc + ',.5)';
  ctx.beginPath(); ctx.moveTo(cx + ux * R * 0.34, cy + uy * R * 0.34); ctx.lineTo(cx + ux * R * 0.62, cy + uy * R * 0.62); ctx.stroke();
  ctx.fillStyle = 'rgb(' + pc + ')';
  const tx = cx + ux * R * 1.07, ty = cy + uy * R * 1.07, px = -uy, py = ux;
  ctx.beginPath();
  ctx.moveTo(tx - ux * 12 + px * 7, ty - uy * 12 + py * 7);
  ctx.lineTo(tx + ux * 2, ty + uy * 2);
  ctx.lineTo(tx - ux * 12 - px * 7, ty - uy * 12 - py * 7);
  ctx.closePath(); ctx.fill();
  // 条目文字：跟扇区一起转（横屏沿半径方向、竖屏沿切线方向），只显示可见的 5 项
  const items = ARM.el.querySelectorAll('.arm-item');
  const on = {};
  for (const v of vis) on[v.i] = v;
  for (let i = 0; i < ARM_N; i++) {
    const d = items[i], v = on[i];
    d.classList.toggle('on', i === ARM.sel);
    d.setAttribute('aria-selected', i === ARM.sel ? 'true' : 'false');
    if (!v) { d.style.opacity = '0'; d.style.pointerEvents = 'none'; continue; }
    const pop = R * 0.06 * v.near;
    const x = cx + Math.cos(v.a) * (g.ri + pop), y = cy + Math.sin(v.a) * (g.ri + pop);
    let sc = (g.v ? 0.84 : 0.88) + 0.32 * v.near;
    // polish3：横屏时文字沿半径排，长名字（串列双座座舱 / 机身与生存性）放大后会冲出扇区外沿 → 按扇区宽度封顶
    if (!g.v) {
      if (!d._w) d._w = d.offsetWidth;
      const room = (R - g.ri) - 18;
      if (d._w > 0 && d._w * sc > room) sc = room / d._w;
    }
    const op = (v.ar <= 1 ? 1 - 0.35 * v.ar : 0.65 - 0.2 * (v.ar - 1)) * v.f;
    d.style.opacity = String(Math.max(0, op));
    d.style.pointerEvents = op > 0.15 ? 'auto' : 'none';
    const rot = (v.a - base) * 180 / Math.PI;
    d.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + rot + 'deg) scale(' + sc + ')'
      + (g.v ? ' translate(-50%,-50%)' : ' translateY(-50%)');
  }
}

// —— 拖动：按指针绕轴心转过的角度转动轮盘；松手带惯性，慢下来后吸附 ——
function _armBindWheel(w) {
  w.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const g = ARM.geo, r = w.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    ARM.drag = { id: e.pointerId, a: Math.atan2(y - g.cy, x - g.cx), t: performance.now(), moved: 0, x0: x, y0: y, hit: e.target.closest('.arm-item') };
    ARM.vel = 0; ARM.target = null;
    try { w.setPointerCapture(e.pointerId); } catch (err) {}
    w.classList.add('drag');
  });
  w.addEventListener('pointermove', e => {
    const d = ARM.drag;
    if (!d || d.id !== e.pointerId) return;
    const g = ARM.geo, r = w.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const a = Math.atan2(y - g.cy, x - g.cx);
    let da = a - d.a;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    d.a = a;
    d.moved = Math.max(d.moved, Math.hypot(x - d.x0, y - d.y0));
    if (d.moved < 4) return;
    const di = -da / armoryStep(ARM_N);
    const now = performance.now(), dt = Math.max(1, now - d.t) / 1000;
    d.t = now;
    ARM.rot += di;
    ARM.vel = ARM.vel * 0.6 + (di / dt) * 0.4;
    _armSelUpdate();
    _armDraw();
  });
  const up = e => {
    const d = ARM.drag;
    if (!d || d.id !== e.pointerId) return;
    ARM.drag = null;
    w.classList.remove('drag');
    if (d.moved < 4 && d.hit) { armGo(+d.hit.dataset.i); return; }
    if (performance.now() - d.t > 120) ARM.vel = 0;   // 停住再松手：不甩
    ARM.vel = Math.max(-12, Math.min(12, ARM.vel));
    _armKick();
  };
  w.addEventListener('pointerup', up);
  w.addEventListener('pointercancel', up);
}

function _armKick() {
  if (ARM.raf) return;
  ARM.last = performance.now();
  ARM.raf = requestAnimationFrame(_armTick);
}
function _armTick(now) {
  ARM.raf = 0;
  if (!ARM.open) return;
  const dt = Math.min(0.05, (now - ARM.last) / 1000);
  ARM.last = now;
  if (ARM.drag) return;
  if (ARM.target === null) {
    ARM.rot += ARM.vel * dt;
    ARM.vel *= Math.exp(-dt * 3.2);
    if (Math.abs(ARM.vel) < 1.2) ARM.target = Math.round(ARM.rot);
  } else {
    const k = 1 - Math.exp(-dt * 6.5);   // 吸附/切换稍慢一点，转动过程看得见
    ARM.rot += (ARM.target - ARM.rot) * k;
    if (Math.abs(ARM.target - ARM.rot) < 0.002) { ARM.rot = ARM.target; ARM.target = null; ARM.vel = 0; }
  }
  _armSelUpdate();
  _armDraw();
  // 快转到位（剩不到 0.12 格）就先换照片和正文，不等最后那段慢慢吸附
  if (ARM.target !== null && !ARM.drag && Math.abs(ARM.target - ARM.rot) < 0.12) _armShow(ARM.sel);
  if (ARM.target === null && ARM.vel === 0) { _armShow(ARM.sel); return; }
  ARM.raf = requestAnimationFrame(_armTick);
}

// 指针下的条目变了：只更新轻量文字（顶栏计数、轴心分类）；照片和正文等转盘停稳再换
function _armSelUpdate() {
  const s = armoryNearest(ARM.rot, ARM_N);
  if (s === ARM.sel) return;
  ARM.sel = s;
  const it = ARMORY_ITEMS[s], c = ARMORY_CATS[it.cat];
  ARM.el.querySelector('.arm-count').textContent = String(s + 1).padStart(2, '0') + ' / ' + String(ARM_N).padStart(2, '0');
  ARM.el.querySelector('.arm-hub b').textContent = c.name;
  ARM.el.querySelector('.arm-hub i').textContent = c.en;
}

function _armShow(i) {
  if (i === ARM.shown) return;
  ARM.shown = i;
  const it = ARMORY_ITEMS[i], c = ARMORY_CATS[it.cat];
  const el = ARM.el;
  // 照片：载入到后层，载好后扫描式切入
  const imgs = el.querySelectorAll('.arm-frame img');
  const back = imgs[1 - ARM.front];
  back.dataset.i = String(i);
  back.alt = it.title;
  const src = ARM_DIR + it.img + '.webp';
  const fr = el.querySelector('.arm-frame');
  back.onerror = () => {
    if (fr) fr.classList.add('arm-img-fallback');
  };
  back.onload = () => {
    if (fr) fr.classList.remove('arm-img-fallback');
    _armImgLoaded(back);
  };
  if (back.getAttribute('src') === src && back.complete) _armImgLoaded(back);
  else back.src = src;
  // 标题
  const cap = el.querySelector('.arm-cap');
  cap.classList.toggle('w', it.cat === 'w');
  cap.querySelector('i').textContent = c.name + ' · ' + c.en + ' ' + String(i + 1).padStart(2, '0');
  cap.querySelector('h2').textContent = it.title;
  cap.querySelector('em').textContent = it.en;
  // 参数：逐个淡入
  const dl = el.querySelector('.arm-params');
  dl.classList.toggle('w', it.cat === 'w');
  dl.innerHTML = '';
  it.params.forEach(([k, v], n) => {
    const d = document.createElement('div');
    d.innerHTML = '<dt></dt><dd></dd>';
    d.firstChild.textContent = k; d.lastChild.textContent = v;
    dl.appendChild(d);
    setTimeout(() => d.classList.add('on'), 120 + n * 90);
  });
  el.querySelector('.arm-credit').textContent = '图片：' + it.credit;
  _armType(it.body);
  // 预载相邻两张，转过去时不用等
  for (const j of [i + 1, i - 1]) { const n = ARMORY_ITEMS[(j + ARM_N) % ARM_N]; const im = new Image(); im.src = ARM_DIR + n.img + '.webp'; }
}

function _armImgLoaded(img) {
  if (+img.dataset.i !== ARM.shown) return;
  const imgs = ARM.el.querySelectorAll('.arm-frame img');
  const old = imgs[ARM.front];
  if (img === old) return;
  old.className = '';
  img.className = '';
  void img.offsetWidth;          // 重启动画
  img.className = 'in';
  ARM.front = 1 - ARM.front;
  const sc = ARM.el.querySelector('.arm-scan');
  sc.classList.remove('go'); void sc.offsetWidth; sc.classList.add('go');
}

// —— 打字机：约 30 字/秒；点正文直接出全文；系统设了“减少动态效果”则直接显示 ——
function _armType(text) {
  clearInterval(ARM.typeTimer);
  ARM.full = text; ARM.typed = 0;
  const span = ARM.el.querySelector('.arm-body span');
  const caret = ARM.el.querySelector('.arm-caret');
  span.textContent = '';
  caret.style.display = '';
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce) { _armTypeFinish(); return; }
  let wait = 9;                   // 先等照片切入（约 0.3 秒）再开始打字
  ARM.typeTimer = setInterval(() => {
    if (wait-- > 0) return;
    ARM.typed++;
    span.textContent = text.slice(0, ARM.typed);
    if (ARM.typed >= text.length) _armTypeFinish();
  }, 33);
}
function _armTypeFinish() {
  clearInterval(ARM.typeTimer);
  ARM.typeTimer = 0;
  ARM.typed = ARM.full.length;
  ARM.el.querySelector('.arm-body span').textContent = ARM.full;
  ARM.el.querySelector('.arm-caret').style.display = 'none';
}

function armGo(i) {
  if (!ARM.open) return;
  const n = ((Math.round(i) % ARM_N) + ARM_N) % ARM_N;
  ARM.vel = 0;
  ARM.target = armoryTarget(n, ARM.target === null ? ARM.rot : ARM.target, ARM_N);
  _armKick();
}

function armOpen() {
  _armBuild();
  if (ARM.open) return;
  ARM.open = true;
  ARM.opener = document.activeElement;
  S.armoryOpen = true;            // 70-loop：暂停 3D 渲染
  ARM.el.classList.add('on');
  _armLayout();
  if (ARM.sel < 0) ARM.rot = 0;
  ARM.sel = -1; ARM.shown = -1;
  _armSelUpdate();
  _armDraw();
  _armShow(ARM.sel);
  setTimeout(() => { if (ARM.open) ARM.el.focus(); }, 0);
}

function armClose() {
  if (!ARM.open) return;
  ARM.open = false;
  S.armoryOpen = false;
  clearInterval(ARM.typeTimer);
  if (ARM.raf) { cancelAnimationFrame(ARM.raf); ARM.raf = 0; }
  ARM.drag = null; ARM.target = null; ARM.vel = 0;
  ARM.rot = Math.round(ARM.rot);
  ARM.el.classList.remove('on');
  if (/^#armory/.test(location.hash)) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  const o = ARM.opener;
  if (o && o.focus && document.contains(o)) o.focus();
}

// 图鉴打开时吞掉全部键盘（capture 先于 70-appmode / 72-uibind 注册），只认浏览与关闭键
addEventListener('keydown', e => {
  if (!ARM.open) return;
  e.stopImmediatePropagation();
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); armClose(); }
  else if (k === 'ArrowDown' || k === 'ArrowRight' || k === 's' || k === 'd' || k === 'PageDown') { e.preventDefault(); armGo(ARM.sel + 1); }
  else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'w' || k === 'a' || k === 'PageUp') { e.preventDefault(); armGo(ARM.sel - 1); }
  else if (k === 'Home') { e.preventDefault(); armGo(0); }
  else if (k === 'End') { e.preventDefault(); armGo(ARM_N - 1); }
  else if (k === ' ' || k === 'Enter') { if (e.target === ARM.el.querySelector('.arm-x')) return; e.preventDefault(); _armTypeFinish(); }
  else if (k !== 'Tab') e.preventDefault();
}, true);
addEventListener('keyup', e => { if (ARM.open) e.stopImmediatePropagation(); }, true);

HOST.armory = {
  open: armOpen,
  close: armClose,
  go: armGo,
  get isOpen() { return ARM.open; },
  get sel() { return ARM.sel; },
  get shown() { return ARM.shown; },
  get typed() { return ARM.typed; },
  get total() { return ARM_N; },
  finishType: () => ARM.open && _armTypeFinish(),
};
