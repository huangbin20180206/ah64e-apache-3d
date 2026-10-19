// ============================================================
// 70-killcam.js — 击毁特写镜头（2026-10-19 体验批 E1）
// ============================================================
// 游戏模式任务进行中击毁车辆（坦克/卡车类，不含油桶）时：镜头切到目标侧面
// 低机位，绕爆炸点缓慢环绕推近，整个世界放慢到 1/4，上下黑边 + 小字提示；
// 1.6s（最后一个目标 2.4s）后切回原视角。任意键/点击可提前跳过。
// 频率：最后一个目标必触发；其余同一类击毁之间至少隔 14s 真实时间，
// 连锁殉爆（t._chain）不触发——避免频繁打断操作。
// 实现：不改 orbit/FPView 的状态，只在它们写完相机之后覆盖本帧相机位姿；
// 结束后下一帧由 orbit/FPView 照常重写，相机自然回到原视角。
// 开关：localStorage ah64_killcam='0' 关闭；自动化测试（webdriver）不触发，
// 世界慢动作在 webdriver 下也不生效（保旧测试的时间推进不变）。
// ============================================================

const KC = {
  on: false, t: 0, dur: 1.6, last: -1e9,
  x: 0, gy: 0, z: 0, r: 2, a0: 0, d: 8, h: 2.5, fov0: 0,
  bars: null,
  allow: !(typeof navigator !== 'undefined' && navigator.webdriver),
};
HOST.killcam = KC;
const _kcLook = new THREE.Vector3();

function _kcPrefOn() {
  try { return localStorage.getItem('ah64_killcam') !== '0'; } catch (e) { return true; }
}

function _kcGround(x, z) {
  return (rig && rig._groundH) ? rig._groundH(x, z) : 0;
}

function _kcBars(show) {
  if (!KC.bars) {
    const el = document.createElement('div');
    el.id = 'killcam-bars';
    el.innerHTML = '<i></i><i></i><span>击毁特写 · 按任意键跳过</span>';
    const st = document.createElement('style');
    st.textContent =
      '#killcam-bars{position:fixed;inset:0;pointer-events:none;z-index:30;opacity:0;transition:opacity .18s}' +
      '#killcam-bars.on{opacity:1}' +
      '#killcam-bars i{position:absolute;left:0;right:0;height:9vh;background:#000}' +
      '#killcam-bars i:first-child{top:0}#killcam-bars i:nth-child(2){bottom:0}' +
      '#killcam-bars span{position:absolute;right:3vw;bottom:3vh;color:#e9d7b0;font:13px/1 sans-serif;letter-spacing:.12em;opacity:.8}' +
      'body.kc-on #fp-hud,body.kc-on #mission,body.kc-on #panel,body.kc-on #hud-top,body.kc-on #views,body.kc-on #guide,body.kc-on #labels{opacity:0;transition:opacity .15s}';
    document.head.appendChild(st);
    document.body.appendChild(el);
    KC.bars = el;
  }
  KC.bars.classList.toggle('on', show);
  document.body.classList.toggle('kc-on', show);
}

// 击毁回调里调用：满足条件就开始特写，返回是否开始
function killcamTry(t, final) {
  if (!KC.allow || KC.on || !t || !t.pos) return false;
  if (appState.mode !== 'play' || !S._mission || S._mission.phase !== 'active') return false;
  if (!_kcPrefOn()) return false;
  const now = performance.now();
  if (!final) {
    if (t.type === 'barrel' || t._chain) return false;
    if (now - KC.last < 14000) return false;
  }
  KC.last = now;
  KC.on = true; KC.t = 0; KC.dur = final ? 2.4 : 1.6;
  KC.x = t.pos.x; KC.z = t.pos.z; KC.gy = _kcGround(KC.x, KC.z);
  KC.r = Math.max(1.2, t.radius || 2);
  const hp = apache.root.position;
  // 从目标看向直升机的水平方位，再侧转约 65°：既看得到爆炸正面，又不是座舱同一视线
  KC.a0 = Math.atan2(hp.x - KC.x, hp.z - KC.z) + (KC.last % 2 < 1 ? 1.15 : -1.15);
  KC.d = 4.5 + KC.r * 2.2;
  KC.h = 1.2 + KC.r * 0.55;
  KC.fov0 = W.camera.fov;
  S._slowmo = Math.max(S._slowmo || 0, KC.dur);
  _kcBars(true);
  return true;
}

function killcamEnd() {
  if (!KC.on) return;
  KC.on = false;
  S._slowmo = 0;
  if (Math.abs(W.camera.fov - KC.fov0) > 1e-4) { W.camera.fov = KC.fov0; W.camera.updateProjectionMatrix(); }
  _kcBars(false);
}

// 每帧在 orbit/FPView 写完相机之后调用（真实时钟 rawDt）
function killcamUpdate(rawDt) {
  if (!KC.on) return;
  if (appState.mode !== 'play' || !S._mission || S._mission.phase === 'idle') { killcamEnd(); return; }
  KC.t += rawDt;
  const e = Math.min(1, KC.t / KC.dur);
  const ee = e * e * (3 - 2 * e);
  const a = KC.a0 + 0.5 * ee;            // 缓慢环绕约 29°
  const d = KC.d * (1 - 0.15 * ee);      // 同时轻微推近
  const cx = KC.x + Math.sin(a) * d, cz = KC.z + Math.cos(a) * d;
  const cy = Math.max(KC.gy + KC.h + 0.6 * ee, _kcGround(cx, cz) + 0.9);
  const cam = W.camera;
  cam.position.set(cx, cy, cz);
  _kcLook.set(KC.x, KC.gy + KC.r * 0.45 + 0.4, KC.z);
  cam.lookAt(_kcLook);
  if (Math.abs(cam.fov - 42) > 1e-4) { cam.fov = 42; cam.updateProjectionMatrix(); }
  if (KC.t >= KC.dur) killcamEnd();
}

// 任意键 / 点击提前跳过
addEventListener('keydown', () => { if (KC.on && KC.t > 0.25) killcamEnd(); }, true);
addEventListener('pointerdown', () => { if (KC.on && KC.t > 0.25) killcamEnd(); }, true);
