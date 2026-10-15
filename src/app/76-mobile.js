// ============================================================
// 76-mobile.js — P4-A 移动端虚拟驾驶摇杆（环绕模式）
// ============================================================
// 盘点结论驱动的最小方案：启旋/起降/第一人称/武器/装填/重置全部复用
// 面板既有按钮（#btn-start/#btn-fly/#btn-fp/#btn-hf/#btn-rk/#btn-gun/
// #btn-v/#btn-reset-targets），本模块零新增按钮、零合成键盘事件。
// 只补三个真缺口：
//   左摇杆 = 悬停平移（写 46-fpview 的 keys 表 arrowup/down/left/right，
//            与键盘方向键同一条通路，70-app 悬停平移分支零改动）；
//   右摇杆 X = 偏航（写 keys a/d——与 A/D 蹬舵同通路）；
//   右摇杆 Y = 升降（FLY.userAlt 新状态通道：45-flight hover 分支在
//            userAlt≠null 时钉在用户高度；仅 hover 且非 FPV 时写入，
//            从当前高度起算，触地自动解除、FPV 退出自动同步）。
// 输入实现：Pointer Events 单套状态，每摇杆 setPointerCapture 且只认
// 一个 pointerId（多指隔离：第二根手指落在同一摇杆被忽略，落在另一
// 摇杆各走各的捕获）；pointercancel/lostpointercapture/blur/页面隐藏
// 全部清零自己按下的键并归中（触摸屏失焦时不会有配对 keyup/pointerup）。
// 可见性：CSS 控制——@media(pointer:coarse) 显示；#panel 打开
// （#panel:not(.hide) ~ #mstick）或 FPV 激活（body.fp-mode）时隐藏，
// FPV 内由 #fp-touch 方向键接管。FP 态用 MutationObserver 观察
// #fp-hud 的 style 属性翻转 body 类，零轮询零逐帧 DOM 写入。
// 无障碍：两摇杆 tabindex=0 + aria-label；右摇杆聚焦时 ↑/↓ 直接升降
// （stopPropagation 防 46-fpview 全局键表把 ↑↓ 记成平移键）；左摇杆
// 聚焦时方向键自然冒泡走全局键表，与键盘完全同效。
// ============================================================

class MobileSticks {
  constructor() {
    this.l = UI('mstick-l'); this.lk = UI('mstick-lk');
    this.r = UI('mstick-r'); this.rk = UI('mstick-rk');
    this.R = 34;                 // knob 中心活动半径（px，越界钳制用）
    this._pl = -1; this._pr = -1;   // 活动指针 id（-1=空闲；只认一个/摇杆）
    this._lk = { x: 0, y: 0 };  // knob 当前偏移（遥测/归中判断）
    this._rk = { x: 0, y: 0 };
    this._lOn = []; this._rOn = [];  // 因摇杆而按下的键（释放只清自己的）
    this._bind(this.l, this.lk, '_pl', this._lk, this._lOn, e => this._lMove(e));
    this._bind(this.r, this.rk, '_pr', this._rk, this._rOn, e => this._rMove(e));
    // 键盘降级入口：右摇杆聚焦时 ↑↓=升降（拦截冒泡，防全局键表误记平移）
    this.l.tabIndex = 0; this.r.tabIndex = 0;
    this.r.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        this._altStep(e.key === 'ArrowUp' ? 0.8 : -0.8);
      }
    });
    // 失焦/页面隐藏：触摸屏没有配对的 keyup/pointerup，必须主动清零
    addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    // FPV 激活 → body.fp-mode（fp.enter/exit 改 #fp-hud 的 inline display）
    const fpHud = UI('fp-hud');
    if (fpHud) {
      this._fpObs = new MutationObserver(() => {
        document.body.classList.toggle('fp-mode', fpHud.style.display === 'block');
      });
      this._fpObs.observe(fpHud, { attributes: true, attributeFilter: ['style'] });
    }
  }

  // 单摇杆输入绑定：down 即捕获+取偏移，move 只认自己的 pointerId，
  // up/cancel/丢捕获三路收尾同一清理
  _bind(base, knob, pid, st, on, move) {
    base.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (this[pid] !== -1) return;      // 已有手指占用（多指隔离）
      this[pid] = e.pointerId;
      // 合成 pointerdown（无活跃指针）会在这里抛异常——真实触控不可能，
      // 但测试/辅助技术可能派发合成事件，捕获后继续跟踪（pid 已认领，
      // 后续 move/up 事件照常处理，只是没有系统级捕获兜底）
      try { base.setPointerCapture(e.pointerId); } catch (err) { /* 见上 */ }
      base.classList.add('on');
      knob.style.transition = 'none';    // 拖动中不做归中缓动
      move(e);                            // 按下即从指下位置起控
    });
    base.addEventListener('pointermove', e => {
      if (e.pointerId !== this[pid]) return;
      e.preventDefault();
      move(e);
    });
    const end = e => {
      if (e.pointerId !== this[pid]) return;
      this._rel(base, knob, pid, st, on);
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    base.addEventListener('lostpointercapture', end);
  }

  // 释放：清自己按下的键 + knob/遥测归中（60ms 缓动由 CSS transition 承担）
  _rel(base, knob, pid, st, on) {
    this[pid] = -1;
    base.classList.remove('on');
    knob.style.transition = '';
    knob.style.transform = '';
    st.x = 0; st.y = 0;
    for (const k of on) keys[k] = false;
    on.length = 0;
  }

  // 通用：指下偏移（越界钳制到 R）+ knob 跟随（拖动期间才有 DOM 写入）
  _off(base, knob, st, e) {
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > this.R) { dx = dx / m * this.R; dy = dy / m * this.R; }
    st.x = dx; st.y = dy;
    knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    return [dx, dy];
  }

  // 键位增减（只动自己 on 列表里的键，避免误清键盘用户的按住态）
  _key(on, k, v) {
    const i = on.indexOf(k);
    if (v && i < 0) { on.push(k); keys[k] = true; }
    else if (!v && i >= 0) { on.splice(i, 1); keys[k] = false; }
  }

  // 左摇杆：8 向阈值（偏移超 35% 半径即按下，双轴同过=斜向）
  _lMove(e) {
    const [dx, dy] = this._off(this.l, this.lk, this._lk, e);
    const T = this.R * 0.35;
    this._key(this._lOn, 'arrowup', dy < -T);
    this._key(this._lOn, 'arrowdown', dy > T);
    this._key(this._lOn, 'arrowleft', dx < -T);
    this._key(this._lOn, 'arrowright', dx > T);
  }

  // 右摇杆：X=偏航（a/d 蹬舵同通路）Y=升降（userAlt 事件驱动增量）
  _rMove(e) {
    const [dx, dy] = this._off(this.r, this.rk, this._rk, e);
    const T = this.R * 0.35;
    this._key(this._rOn, 'a', dx < -T);
    this._key(this._rOn, 'd', dx > T);
    if (FLY.state === 'hover' && !FLY.fp) this._altStep(-dy * 0.05);
  }

  _altStep(d) {
    // 从当前高度起算（首次接管不跳变）；下限 2u 保持明显离地
    FLY.userAlt = clamp((FLY.userAlt != null ? FLY.userAlt : FLY.alt) + d, 2, 40);
  }

  // 触控取消/失焦/页面隐藏的总清零
  reset() {
    this._rel(this.l, this.lk, '_pl', this._lk, this._lOn);
    this._rel(this.r, this.rk, '_pr', this._rk, this._rOn);
  }

  // 测试遥测：只读数值/键名，不解析中文，不依赖单帧截图
  state() {
    return {
      l: { x: this._lk.x, y: this._lk.y, on: this._lOn.slice() },
      r: { x: this._rk.x, y: this._rk.y, on: this._rOn.slice() },
      userAlt: FLY.userAlt, fpMode: document.body.classList.contains('fp-mode'),
    };
  }
}

const mobileSticks = new MobileSticks();

// __dbg 在 72-uibind 的 bindUI（GLB 载入完成）时才创建——轻量轮询挂上
// 遥测后自清（页面正常启动必然命中；挂不上也不影响摇杆功能本身）
const _msIv = setInterval(() => {
  if (window.__dbg) { window.__dbg.mobile = mobileSticks; clearInterval(_msIv); }
}, 250);
