// ============================================================
// 75-routes.js — P4b 飞行展示航线运行时（自动驾驶 + 电影机位）
// ============================================================
// 数据与轨迹采样在 34-routes.js。本文件：
//   - 展示面板「飞行」页的航线卡（#route-list）：6 条航线 + 精选 60 秒（原一键导览）
//   - 自动驾驶：FLY.auto=true 时 45-flight 的 hover 分支让位，本文件每帧写
//     FLY.x/z/alt/yaw/pitch/roll（loop 照常据此重建 root）
//   - 电影机位：直写 orbit 的 tTarget/tTheta/tPhi/tDist（fixed 机位直接同步）
//   - 接管：任意键 / 点画面 → 立即交还（原地悬停，FLY.userAlt 钉住当前高度）；
//     Esc → 交还并回到航线菜单
// 状态经 HOST.routeState 暴露（70-mission 据 scene 派生城镇/峡谷，70-loop 据 on 跳过峡谷碰撞）。
// 拓扑：只读 ≤75 的符号（34 ROUTES/routeSample/routeVel/routeShot，74 tourCap/tourKey/
// clickEnv/clickTerrain/tourStop/tourStart，46 shortestAngle）。
// ============================================================

const route = { on: false, r: null, t: 0, raf: 0, last: 0, synth: false, yaw: 0, pitch: 0,
  shotKey: null, bars: null, xbtn: null, hud: null };
HOST.routeState = route;
HOST.routeStart = (id) => routeStart(id);
HOST.routeStep = (dt) => routeStep(dt);
HOST.routeStop = (q, m) => routeStop(q, m);

function routeKey(code) {
  route.synth = true;
  try { tourKey(code); } finally { route.synth = false; }
}

function routeBars(on) {
  if (!route.bars) {
    const mk = (pos) => {
      const d = document.createElement('div');
      d.className = 'route-bar';
      d.style.cssText = 'position:fixed;left:0;right:0;' + pos + ':0;height:0;background:#000;z-index:55;' +
        'pointer-events:none;transition:height .6s ease';
      document.body.appendChild(d);
      return d;
    };
    route.bars = [mk('top'), mk('bottom')];
  }
  for (const b of route.bars) b.style.height = on ? '7vh' : '0';
}

function routeStart(id) {
  const r = ROUTES.find(x => x.id === id);
  if (!r) return false;
  if (route.on) routeStop(true);
  try { tourStop(true); } catch (e) {}
  try { if (fp && fp.active) fp.exit(); } catch (e) {}
  if (S.mode !== 'show' && HOST.setPlayMode) HOST.setPlayMode('show');
  S._guide = 0;
  clickEnv(r.env); clickTerrain(r.terrain);
  try { apache.setExplode(0); } catch (e) {}
  route.r = r; route.t = 0; route.on = true; route.shotKey = null;
  route.scene = r.scene || null;
  S.scan = !!r.scan;
  if (targets) { route._pas = targets.passive; targets.passive = true; }   // 航线中靶场不还击
  const p0 = routeSample(r, r.start === 'ground' ? r.auto : 0);
  const v0 = routeVel(r, (r.start === 'ground' ? r.auto : 0) + 0.3);
  route.yaw = Math.hypot(v0.vx, v0.vz) > 0.3 ? Math.atan2(v0.vx, v0.vz) : 0;
  route.pitch = 0;
  FLY.userAlt = null;
  if (r.start === 'ground') {
    // 从地面冷启动：停放到原点，旋翼停转，按时间轴启旋/起飞
    if (S.running) routeKey('Space');
    FLY.state = 'ground'; FLY.alt = 0; FLY.x = 0; FLY.z = 0; FLY.yaw = 0; FLY.roll = 0; FLY.auto = false;
    route.ev = [[1.5, () => { if (!S.running) routeKey('Space'); }],
                [10.5, () => { S.spin = Math.max(S.spin, FLY.MIN_SPIN); if (FLY.state === 'ground') routeKey('KeyT'); }]];
  } else {
    // 空中开场：旋翼满转、直接置于首航点悬停
    if (!S.running) routeKey('Space');
    S.spin = 1;
    FLY.state = 'hover'; FLY.auto = true;
    FLY.x = p0.x; FLY.z = p0.z; FLY.alt = p0.alt; FLY.yaw = route.yaw; FLY.pitch = 0; FLY.roll = 0;
    S._alt = FLY.alt;
    route.ev = [];
  }
  route.capI = 0; route.evI = 0;
  routeBars(true);
  if (route.xbtn) { route.xbtn.style.display = 'inline-block'; route.xbtn.textContent = '■ 退出航线 · ' + r.name; }
  orbit.fly = null; orbit.auto = false;
  route.last = performance.now();
  cancelAnimationFrame(route.raf);
  route.raf = requestAnimationFrame(routeTick);
  routeMark();
  return true;
}

// 交还控制：原地悬停（userAlt 钉高度，避免 hover 分支把高度拉回 HOVER）
function routeStop(quiet, toMenu) {
  if (!route.on) return;
  route.on = false;
  cancelAnimationFrame(route.raf);
  FLY.auto = false;
  if (FLY.state === 'hover') FLY.userAlt = FLY.alt;
  FLY.roll = 0;
  S.scan = false;
  route.scene = null;
  if (targets && route._pas !== undefined) { targets.passive = route._pas; route._pas = undefined; }
  routeBars(false);
  if (route.xbtn) route.xbtn.style.display = 'none';
  if (!quiet) toast(toMenu ? '已退出航线' : '已交还驾驶：方向键平移 · A/D 转向 · C 第一人称');
  if (toMenu && typeof setShowTab === 'function') { try { setShowTab('fly'); } catch (e) {} }
  routeMark();
}

function routeMark() {
  for (const c of document.querySelectorAll('#route-list .rcard')) {
    c.classList.toggle('on', route.on && route.r && c.dataset.route === route.r.id);
  }
}

// 每帧（固定步长可由测试经 routeStep 同步推进）
function routeStep(dt) {
  if (!route.on) return;
  const r = route.r;
  route.t += dt;
  const t = route.t;
  while (route.evI < route.ev.length && t >= route.ev[route.evI][0]) { try { route.ev[route.evI++][1](); } catch (e) {} }
  while (route.capI < r.caps.length && t >= r.caps[route.capI][0]) tourCap(r.caps[route.capI++][1]);
  // 自动驾驶
  const autoOn = r.start !== 'ground' || t >= r.auto;
  if (autoOn) {
    if (!FLY.auto) {                                   // 地面起飞航线：爬升中/悬停后接管
      FLY.auto = true;
      if (FLY.state !== 'hover') FLY.state = 'hover';
    }
    const p = routeSample(r, t), v = routeVel(r, t);
    const sp = Math.hypot(v.vx, v.vz);
    // 接管瞬间位置衔接：首 1.5s 从当前位置缓入航线
    const k = r.start === 'ground' ? Math.min(1, (t - r.auto) / 1.5) : 1;
    FLY.x = lerp(FLY.x, p.x, k); FLY.z = lerp(FLY.z, p.z, k); FLY.alt = lerp(FLY.alt, p.alt, k);
    const yawBefore = FLY.yaw;
    if (sp > 0.6) {
      const want = Math.atan2(v.vx, v.vz);
      const d = shortestAngle(FLY.yaw, want);
      FLY.yaw += clamp(d, -1.3 * dt, 1.3 * dt);         // 航向角速度上限 1.3 rad/s
    }
    const yawRate = (FLY.yaw - yawBefore) / Math.max(dt, 1e-4);
    // 前飞低头：速度越快机头越低（≤ 0.22），减速时抬头
    const want = clamp(sp * 0.022, 0, 0.22) - clamp(v.vy * 0.02, -0.08, 0.08);
    route.pitch = lerp(route.pitch, want, Math.min(1, dt * 2.5));
    FLY.pitch = route.pitch;
    FLY.roll = lerp(FLY.roll, clamp(-yawRate * 0.30, -0.35, 0.35), Math.min(1, dt * 3));
    S._alt = FLY.alt;                                    // 避免 loop 把高度差再叠一次到相机目标
  }
  routeCamera(dt);
  if (t >= r.dur + 2) routeFinish();
}

function routeFinish() {
  const r = route.r;
  routeStop(true);
  tourCap(r.name + ' 结束｜原地悬停，可直接接管驾驶或选择下一条航线');
}

// 电影机位
function routeCamera(dt) {
  const r = route.r, t = route.t;
  const s = routeShot(r, t);
  const kind = s[1], o = s[2] || {};
  const hp = apache.root.position;
  const key = s[0] + kind;
  const cut = key !== route.shotKey;
  route.shotKey = key;
  const tgtY = hp.y + 0.6;
  if (kind === 'fixed') {
    // 固定机位：摄影机钉在世界点，镜头跟着飞机转（瞬切，无阻尼）
    const dx = o.x - hp.x, dy = o.y - tgtY, dz = o.z - hp.z;
    const dist = Math.max(0.5, Math.hypot(dx, dy, dz));
    orbit.tTarget.set(hp.x, tgtY, hp.z); orbit.target.copy(orbit.tTarget);
    orbit.tDist = orbit.dist = dist;
    orbit.tPhi = orbit.phi = Math.acos(clamp(dy / dist, -1, 1));
    orbit.tTheta = orbit.theta = Math.atan2(dx, dz);
    return;
  }
  orbit.tTarget.set(hp.x, tgtY, hp.z);
  let theta = orbit.tTheta, phi = o.phi || 1.2, dist = o.dist || 16;
  if (kind === 'chase') theta = FLY.yaw + Math.PI;
  else if (kind === 'front') theta = FLY.yaw;
  else if (kind === 'side') theta = FLY.yaw + (o.sign || 1) * Math.PI / 2;
  else if (kind === 'high') { theta = FLY.yaw + Math.PI * 0.75; phi = 0.55; }
  else if (kind === 'orbit') theta = (cut ? orbit.theta : orbit.tTheta) + (o.rate || 0.12) * dt;
  // 角度连续：取与当前值最近的等价角
  orbit.tTheta = orbit.theta + shortestAngle(orbit.theta, theta);
  orbit.tPhi = phi; orbit.tDist = dist;
  if (cut) {                                            // 换机位：瞬切（电影剪辑感）
    orbit.target.copy(orbit.tTarget);
    orbit.theta = orbit.tTheta; orbit.phi = phi; orbit.dist = dist;
  }
}

function routeTick(ts) {
  if (!route.on) return;
  // rAF 时间戳可能早于 start 时记录的 performance.now()——负 dt 会让时间轴倒退，钳到 ≥0
  const dt = clamp((ts - route.last) / 1000 || 0.016, 0, 0.05);
  route.last = Math.max(route.last, ts);
  if (!route.manual) routeStep(dt);   // 测试经 HOST.routeStep 同步推进时置 manual
  if (route.on) route.raf = requestAnimationFrame(routeTick);
}

// —— 面板 UI：飞行页航线卡 + 退出按钮 + 接管 —— 
(function routeUI() {
  const box = document.getElementById('route-list');
  if (box) {
    const mk = (id, name, desc, dur, fn) => {
      const c = document.createElement('div');
      c.className = 'rcard';
      c.dataset.route = id;
      c.setAttribute('role', 'button'); c.tabIndex = 0;
      c.innerHTML = '<b>' + name + '</b><span class="rdur">' + dur + 's</span><small>' + desc + '</small>';
      c.addEventListener('click', fn);
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } });
      box.appendChild(c);
    };
    for (const r of ROUTES) mk(r.id, r.name, r.desc, Math.round(r.dur), () => routeStart(r.id));
    mk('best60', '精选 60 秒', '原一键导览：夜灯 · 沙漠起飞 · 湖面着舰 · 分解', 60, () => { routeStop(true); tourStart(); });
  }
  const x = document.createElement('button');
  x.id = 'route-exit'; x.type = 'button';
  x.textContent = '■ 退出航线';
  x.title = '退出航线并回到航线菜单（Esc）；任意键或点击画面 = 原地接管驾驶';
  x.style.cssText = 'position:fixed;left:50%;bottom:calc(7vh + 10px);transform:translateX(-50%);z-index:62;' +
    'padding:7px 20px;border:1px solid rgba(120,255,170,.45);border-radius:18px;' +
    'background:rgba(10,18,14,.88);color:#cfe;font-size:12.5px;letter-spacing:1.5px;cursor:pointer;display:none';
  x.addEventListener('click', e => { e.stopPropagation(); routeStop(false, true); });
  document.body.appendChild(x);
  route.xbtn = x;
  // 接管：Esc 回菜单；其他任意键原地接管（合成键与修饰键除外）
  addEventListener('keydown', e => {
    if (!route.on || route.synth) return;
    if (e.key === 'Escape') { routeStop(false, true); return; }
    if (['Shift', 'Control', 'Alt', 'Meta'].indexOf(e.key) >= 0) return;
    routeStop(false);
  }, true);
  const cv = document.querySelector('canvas');
  if (cv) cv.addEventListener('pointerdown', () => { if (route.on) routeStop(false); }, { capture: true });

  // —— P4c 摄影模式：隐藏界面 + 景深（70-hud 据 S._photo 对焦机体）——
  const px = document.createElement('button');
  px.id = 'photo-exit'; px.type = 'button';
  px.textContent = '退出摄影模式（Esc）';
  px.style.cssText = 'position:fixed;right:14px;top:14px;z-index:63;padding:6px 14px;border-radius:16px;' +
    'border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.45);color:#dde;font-size:12px;cursor:pointer;display:none';
  document.body.appendChild(px);
  const setPhoto = (on) => {
    S._photo = !!on;
    document.body.classList.toggle('photo-mode', S._photo);
    px.style.display = S._photo ? 'inline-block' : 'none';
    if (!route.on) routeBars(S._photo);
  };
  HOST.setPhoto = setPhoto;
  px.addEventListener('click', () => setPhoto(false));
  const pb = document.getElementById('photo-btn');
  if (pb) {
    pb.addEventListener('click', () => setPhoto(!S._photo));
    pb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setPhoto(!S._photo); } });
  }
  addEventListener('keydown', e => { if (e.key === 'Escape' && S._photo) setPhoto(false); }, true);

  // —— P4d 一键场景：依次点 场地 → 时段 → 天气 芯片（走既有 setEnv/setTerrain/天气逻辑，零新路径）——
  const applyCombo = (el) => {
    const q = (row, attr, v) => document.querySelector('#' + row + ' [' + attr + '="' + v + '"]');
    for (const [row, attr, v] of [['terrain-row', 'data-terrain', el.dataset.cTer], ['env-row', 'data-env', el.dataset.cEnv],
      ['weather-row', 'data-weather', el.dataset.cWx]]) {
      const c = q(row, attr, v);
      if (c && !c.classList.contains('on')) c.click();
    }
    document.querySelectorAll('#combo-row .chip').forEach(c => c.classList.toggle('on', c === el));
  };
  HOST.applyCombo = (id) => { const el = document.querySelector('#combo-row [data-combo="' + id + '"]'); if (el) applyCombo(el); };
  document.querySelectorAll('#combo-row .chip').forEach(el => {
    el.addEventListener('click', () => applyCombo(el));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyCombo(el); } });
  });
  // 手动改任一芯片 → 一键场景高亮清除
  ['env-row', 'terrain-row', 'weather-row'].forEach(id => {
    const r = document.getElementById(id);
    if (r) r.addEventListener('click', e => { if (e.isTrusted) document.querySelectorAll('#combo-row .chip').forEach(c => c.classList.remove('on')); });
  });
})();
