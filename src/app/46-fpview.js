// ============================================================
// 46-fpview.js — 第一人称座舱视角 + 方向控制
// ============================================================
// 体验者从副驾驶/射手位驾驶直升机打击目标：
//   C 键进出（须先起飞至悬停）；鼠标 = 机头姿态（指针锁定，所见即所瞄，
//   十字线即机炮方向）；W/S 前进后退、A/D 转向、R/F 升降；
//   左键机炮 / 右键火箭（70-app 里接扳机），F 地狱火沿用原键。
// 与 FLY 状态机的关系：FP 只在 hover 态接管——直接改写 FLY.alt / FLY.yaw /
// FLY.pitch / FLY.roll，loop() 原有的姿态写法不变（新增 yaw/roll 两个通道，
// 非 FP 时恒为 0，观感零变化）。降落(T)自动退出 FP。
// 机炮/火箭/地狱火全部沿用 65-weapons 现有逻辑（机头朝向即弹道基准，
// 炮塔自动追踪辅助保留——体验者只需把十字线放到目标附近即可命中）。
// ============================================================

// 键位状态表（FP 移动输入用；仅记录，不拦截——FP 激活时 70-app 会
// 屏蔽 W/R 等键在环绕模式下的旧功能，防止误触线框/自动旋转）
const keys = {};
addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// P14-A(R3)：切后台/隐藏页签时若只有 visibilitychange 而未触发 blur（移动端
// 常见——应用切后台不派发窗口 blur），按键残留会在回前台后让 FPV 自加速。
// 与 blur 同语义：文档隐藏时清空 keys 表（刹车语义，避免"幽灵输入"）。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) for (const k in keys) keys[k] = false;
});

// 最短角差：把目标角与当前角折到 (-π, π]，避免绕远路转向
function shortestAngle(cur, target) {
  let d = (target - cur) % (PI * 2);
  if (d > PI) d -= PI * 2;
  if (d < -PI) d += PI * 2;
  return d;
}

class FPView {
  constructor(opts) {
    this.apache = opts.apache; this.W = opts.W; this.orbit = opts.orbit;
    this.canvas = opts.canvas;
    this.rig = opts.rig;                  // 弹药面板读数 + 机炮锥辅助
    this.targets = opts.targets;          // 地面靶标（锁定框来源）
    this.airTargets = opts.airTargets;    // 空中目标（锁定框来源）
    this.enemyAir = opts.enemyAir || null;   // Phase 20-A：A2A 敌机（锁定框候选）
    this.active = false; this.locked = false;
    // 鼠标灵敏度（rad/px，用户反馈：原 0.0022 过慢难以追踪目标——默认提高
    // 到 0.004，面板滑块可 0.5x~2x 调节，enter 时按 S.fpSens 应用）
    this.sens = 0.004;
    // 视线角（鼠标累积）与机体姿态（缓追视线）
    this.vYaw = 0; this.vPitch = 0;
    this.spd = 0; this.vy = 0; this.vSide = 0;            // 前向速度 / 垂直速度
    this.SPD_MAX = 16; this.SPD_REV = 6;  // u/s（1u≈2m）
    this.eye = new THREE.Vector3();       // 眼位（root 局部坐标）
    this._hide = [];                      // FP 时隐藏的座舱网格
    this._v = new THREE.Vector3();        // 投影复用
    // 每帧相机姿态计算用的暂存向量（逐帧 new Vector3 会给 GC 添无谓压力）
    this._eyeW = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._nose = new THREE.Vector3();
    // 锁定框/方位箭头的 DOM 写入缓存：这段代码每帧执行，逐帧写同值的
    // style.left/top 也会触发样式重算与合成，悬停不动时纯属浪费。
    // 只记上次真正写进 DOM 的整数像素与显隐态，变化才写。
    this._lk = { mode: '', x: -1e9, y: -1e9, d: -1, ang: 1e9, lt: '', lx: -1e9, ly: -1e9 };
    this.onSfx = null;              // 音效回调（锁定变化时由 app 注入）
    this._lastLockKey = '';         // 锁定变化检测（label 变化才触发确认音）
    // 最终闭环修复（首帧异常隔离·acquisition generation）：
    // 每次 requestPointerLock() 创建一个 acquisition 对象 {gen, state}——
    //   state === 'armed'    guard 生效中，等待/可消费本 acquisition 的首条 mousemove
    //   state === 'consumed' 本 acquisition 的首条 mousemove 已处理（无论巨幅
    //                        丢弃还是小幅放行），guard 使命完成
    //   _plAcq === null       锁定已释放/取消/从未请求，无 guard
    // 异常首帧最多被消费一次：mouse() 只在 state==='armed' 时消费一次并立即
    // 置 consumed；pointerlockchange 派发时若 acq 已 consumed 则必须保持不变
    // （不得重新 arm——否则"mousemove 先于 pointerlockchange 到达"的场景会把
    // 紧随其后的合法 >120px 快速输入误当第二个首帧丢弃）。锁定释放/取消或
    // 下一次 request 才建立新 guard（gen 递增）。
    this._plAcq = null;
    this._plGen = 0;
    this._onPL = () => {
      const locked = document.pointerLockElement === this.canvas;
      this.locked = locked;
      if (locked) {
        // 获得锁定：若尚无 acquisition（例如重新捕获按钮路径）则新建 armed；
        // 若已存在且被首帧消费（consumed）则保持 consumed，绝不复活 guard。
        if (!this._plAcq) this._plAcq = { gen: ++this._plGen, state: 'armed' };
      } else {
        // 锁定释放/取消：清除 acquisition，下次 request 重建新 guard
        this._plAcq = null;
      }
    };
    document.addEventListener('pointerlockchange', this._onPL);
    this._bindTouch();
  }

  // 预 arm 一个新 acquisition（每次请求锁定的入口统一走这里）：
  // 必须在 requestPointerLock() 之前调用——浏览器可能在锁定生效后、
  // pointerlockchange 事件派发前就先派发锁定后的首条 mousemove（实测
  // movementX≈+640px 巨幅逃逸污染 vYaw，机体转向 -147°，X/Z 侧移方向反；
  // test_hover_translation 复现）。预 arm 使这条事件无论何时到达都必被
  // 本 acquisition 隔离；mouse() 只在 pointerLockElement 非空时才被转发
  // 调用，请求被拒（无锁定）时 acq 残留无害。
  _armPlAcq() {
    const acq = { gen: ++this._plGen, state: 'armed' };
    this._plAcq = acq;
    return acq;                               // 返回本次 acquisition token（调用方据此做 gen 匹配清理）
  }

  // —— 指针锁定提示条 + 触屏方向键 ——
  // 指针锁定随时可能被浏览器收回（Esc、切标签、iframe 预览策略），
  // 旧实现只弹一次 toast 就没了后续出口，用户只能靠猜"点画面"。
  // 这里把状态显式化：未锁定时常驻提示条 + 一键重新捕获。
  // 触屏设备根本没有指针锁定，方向键直接写 keys 表，与键盘走同一条通路。
  _bindTouch() {
    const rec = UI('fp-recapture');
    if (rec) {
      rec.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        const acq = this._armPlAcq();        // 重新获取也是新 acquisition（保存本次 token）
        const lock = this.canvas.requestPointerLock();
        if (lock && lock.catch) lock.catch(() => {
          // 与 enter() 同规则（gen 匹配清理）：仅当本次 acquisition 仍是最新
          //（未被更新的请求/pointerlockchange 取代）时才清除；旧请求的迟到
          // rejection 不得删除更新的 acquisition
          if (this._plAcq === acq) this._plAcq = null;
          toast('当前环境不支持指针锁定，可用触屏方向键或按 C 退出');
        });
      };
    }
    const bind = (id, key) => {
      const el = UI(id);
      if (!el) return;
      const set = v => e => { e.preventDefault(); keys[key] = v; };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointerleave', set(false));
      el.addEventListener('pointercancel', set(false));
    };
    bind('fp-touch-w', 'w'); bind('fp-touch-a', 'a');
    bind('fp-touch-s', 's'); bind('fp-touch-d', 'd');
    bind('fp-touch-r', 'r'); bind('fp-touch-q', 'q');
  }

  // 提示条只在"FP 激活且指针未锁定"时出现；锁定后立即收起不挡视野。
  // 每帧调用，所以只在状态翻转时写 DOM（逐帧写同值也会触发样式重算）。
  _syncCapture() {
    const box = UI('fp-capture');
    if (!box) return;
    const need = this.active && !document.pointerLockElement;
    if (need === this._capShown) return;
    this._capShown = need;
    box.style.display = need ? 'inline-flex' : 'none';
    if (need) {
      const st = UI('fp-status');
      if (st) st.textContent = '指针未锁定 · 鼠标瞄准暂不可用';
    }
  }

  // 眼位：主驾（飞行员）后座——实测驾驶舱 bbox y 1.70~2.52 / z 1.72~3.18，
  // 眼位取舱顶下沿 0.14（y 2.38）+ 后座 z 2.10：视线从舱盖上沿越过机鼻，
  // 旧版比例偏移算出的 y≈2.20 埋在仪表舱高度，前方视野全被机身挡死
  _calmEye() {
    const a = this.apache, box = new THREE.Box3(), c = new THREE.Vector3();
    const node = a.get('Cube001_2');
    if (node) {
      a.root.updateMatrixWorld(true);
      box.setFromObject(node); box.getCenter(c);
      // 绝对定标（局部坐标）：x 中轴偏右 0.05 / y 舱顶(2.52)−0.14 / z 后座
      this.eye.set(c.x + 0.05, box.max.y - 0.14, c.z - 0.05);
      // Box3 坐标是世界坐标；转换到 root 局部坐标，不能调用 node.worldToLocal，
      // 否则会丢掉驾驶舱节点相对机体根的平移，root.localToWorld() 会二次偏移。
      this.apache.root.worldToLocal(this.eye);
    } else {
      this.eye.set(0.05, 2.38, 2.10);    // 兜底：同定标（模型无 Cube001_2 时）
    }
    // —— 透明机体：FP 时隐藏整机网格，只保留武器挂架（地狱火/火箭巢/机炮）
    // 眼位埋在机鼻壳体内，四周双面机身内壁把视野围死（用户实测"看啥都看不到"）；
    // 真机视野靠透明舱盖，模型玻璃是不透明深色材质，只能用透明机体方案
    this._hide = [];
    const keep = new Set();
    for (const root of [...a.hellfire, ...a.rocketPods, ...a.gunParts]) {
      root.traverse(o => keep.add(o.uuid));
    }
    a.src.traverse(o => {
      if (o.isMesh && !keep.has(o.uuid)) this._hide.push(o);
    });
  }

  // 只读键位快照（测试/调试出口）：返回模块级 keys 表的拷贝——供自动化验证
  // exit/exitNormalized 确实清除了所有残留按键（不依赖重进 FPV 的行为推断）
  keyState() {
    const out = {};
    for (const k in keys) out[k] = keys[k];
    return out;
  }

  toggle() {
    this.active ? this.exit() : this.enter();
  }

  enter() {
    if (FLY.state !== 'hover') { toast('先起飞到悬停 (T) 再进入第一人称'); return; }
    this._calmEye();
    this.vYaw = FLY.yaw; this.vPitch = 0;
    this.spd = 0; this.vy = 0; this.vSide = 0;
    // 锁定框缓存复位：上次退出时的整数像素/显隐态对本次进入无效
    this._lk.mode = ''; this._lk.x = -1e9; this._lk.y = -1e9; this._lk.d = -1; this._lk.ang = 1e9;
    this._lk.lt = ''; this._lk.lx = -1e9; this._lk.ly = -1e9;
    FLY.fp = true;
    this.active = true;
    this.orbit.enabled = false;
    // 只隐藏/恢复进入时可见的网格：另一套涂装的贴花本来就是隐藏的，
    // 退出时不能一律置 true（否则 Army/USMC 两套贴花叠在一起）
    this._wasVis = this._hide.filter(o => o.visible);
    for (const o of this._wasVis) o.visible = false;
    UI('fp-hud').style.display = 'block';
    // 最终闭环修复（首帧异常隔离·预 arm）：见 _armPlAcq 注释——必须在此
    // 提前创建 acquisition，使锁定后、pointerlockchange 派发前到达的首条
    // mousemove 也必被隔离；若先被首帧消费，随后同一次 pointerlockchange
    // 不会重新 arm（_onPL 对 consumed 保持原样）。
    const acq = this._armPlAcq();            // 保存本次 acquisition token
    // 浏览器或浏览器策略可能拒绝指针锁定；这是可选能力，不能冒泡成全局错误。
    const lock = this.canvas.requestPointerLock();
    if (lock && lock.catch) lock.catch(() => {
      this._relockHint = false;
      // 竞态修复：rejection 只在本次 token 仍等于当前 _plAcq 时清理——若期间
      // 已建立更新的 acquisition（重新捕获/再次 enter），旧请求的迟到 rejection
      // 不得删除它
      if (this._plAcq === acq) this._plAcq = null;
      toast('当前环境不支持指针锁定，可用触屏方向键或按 C 退出第一人称');
    });
    this._syncCapture();
    // 进入时应用面板灵敏度设置（S.fpSens = 用户滑块倍率，默认 1）
    this.sens = 0.004 * ((HOST.S && HOST.S.fpSens) || 1);
    toast('第一人称：鼠标瞄准 · WASD 平移 · R/Q 升降 · 左键机炮 · 右键火箭 · F 地狱火 · C 退出');
    // #6 方向提示：一进 FPV 就播报敌方基地相对机头的方位 + 距离——解决"不知东南
    // 西北、找不到目标"。方位角 = 基地方向与机头夹角（左/右/前/后），供玩家判断
    // 该往哪转。基地中心由 16-targets build() 写入 baseCenter（起飞前必已建好）。
    const bc = this.targets && this.targets.baseCenter;
    if (bc) {
      const dx = bc.x - FLY.x, dz = bc.z - FLY.z;
      const dist = Math.round(Math.hypot(dx, dz) * 2);        // u→m（1u≈2m）
      // 方位判定用机体前向/右向量投影（与 update 位移用的同一套约定，符号不会反）：
      //   前向 fwd=(sin yaw, cos yaw)；右向 right=(-cos yaw, sin yaw)。
      // toBase 在 fwd 上的投影>0=前方，在 right 上的投影>0=右侧。
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const sy = Math.sin(FLY.yaw), cy = Math.cos(FLY.yaw);
      const fwd = ux * sy + uz * cy;                 // 前向分量
      const rightC = ux * (-cy) + uz * sy;           // 右向分量
      const deg = Math.round(Math.abs(Math.atan2(rightC, fwd)) * 180 / Math.PI);
      const face = deg < 25 ? '正前方'
        : deg > 155 ? '正后方（掉头）'
        : rightC > 0 ? `右前方 ${deg}°` : `左前方 ${deg}°`;
      setTimeout(() => toast(`敌方基地：${face} · 约 ${dist}m`), 2600);
    }
  }

  // 批 E：峡谷地形读数（离地高度 / 崖顶余量 / 前方净空告警）。只在峡谷激活时显示；
  // 其余场地 #fp-gpws 保持隐藏，FPV 观感零变化。读数单位与 fp-alt 一致（1u = 2m）。
  _gpws() {
    const el = UI('fp-gpws');
    if (!el) return;
    const cy = this.targets && this.targets.canyon;
    const on = !!(cy && cy.active);
    if (el._on !== on) { el._on = on; el.classList.toggle('show', on); }
    if (!on) return;
    const p = cy.probe(FLY, this._gp || (this._gp = {}));
    const rim = Math.round(p.rimGap * 2);
    const txt = '离地 ' + Math.max(0, Math.round(p.agl * 2)) + 'm · ' +
      (rim >= 0 ? '崖顶下 ' + rim + 'm' : '已露头 ' + (-rim) + 'm') +
      (p.warn === 2 ? ' · ⚠ 拉起' : p.warn === 1 ? ' · 前方贴壁' : '');
    if (el._t !== txt) { el._t = txt; el.textContent = txt; }
    if (el._w !== p.warn) { el._w = p.warn; el.classList.toggle('warn', p.warn === 2); el.classList.toggle('caution', p.warn === 1); }
    if (el._x !== (rim < 0)) { el._x = rim < 0; el.classList.toggle('exposed', rim < 0); }
  }

  exit() {
    FLY.fp = false;
    this.active = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this._plAcq = null;                       // 退出即释放：下次 enter 重建新 guard
    this.orbit.enabled = true;
    for (const o of (this._wasVis || [])) o.visible = true;
    this._wasVis = null;
    UI('fp-hud').style.display = 'none';
    this._syncCapture();
    // 退出时清掉驾驶键：触屏按住不放或退出瞬间的 keydown 没有配对 keyup，
    // 残留的 true 会在下次进入 FP 时立刻自行加速。g/x（扳机键）一并清除——
    // 与 exitNormalized() 清键集对齐（P15-A 探针实证：普通 exit 漏清 g/x，
    // 与任务接管路径行为不一致）。
    for (const k of ['w', 'a', 's', 'd', 'r', 'q', 'g', 'x']) keys[k] = false;
    // 环绕机位拉回直升机当前位置：目标高度随悬停高度抬升（否则相机会对着
    // 地面拍、机体出画——用户实测"退出后视角定位乱"的根因），并同步高度缓存
    this.orbit.tTarget.set(FLY.x, 1.1 + FLY.alt * 0.92, FLY.z);
    // P14-C+R1：FPV→Orbit 构图平滑——经 flyTo 缓动回到环绕位。
    // Orbit.update() 重建相机公式：camera = target + dist·spherical(theta,phi)。
    // 因此首帧连续的充要条件是：
    //   camera₀ = t2 + spherical(eye−t2) = eye
    // 即「起始 target = 最终锚点 t2」+「起始球坐标 = 眼位相对 t2 的 dx/dy/dz」。
    // 若像旧实现把 target 设成眼位、球坐标又是 eye−t2，则首帧 =
    // eye + (eye−t2) = 2·eye−t2（评审抓出的阻断级跳变）。
    // flyTo 快照 f.f = {tgt,theta,phi,dist} 取自当前 state——故必须在调用
    // flyTo 前同步 target/tTarget、theta/tTheta、phi/tPhi、dist/tDist，保证
    // f 自洽（tgt=t2、球坐标=eye−t2 → 首帧重建 camera=t2+(eye−t2)=eye）。
    const cam = this.W.camera;
    const v0 = (HOST.VIEWS && HOST.VIEWS[0])
      ? HOST.VIEWS[0]
      : { target: [0, 1.25, 0.2], theta: 0.78, phi: 1.19, dist: 12.6, fov: 34 };
    const yaw = FLY.yaw || 0, cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const ox = v0.target[0], oz = v0.target[2];
    const t2 = [FLY.x + ox * cosY + oz * sinY, v0.target[1] + FLY.alt,
                FLY.z - ox * sinY + oz * cosY];
    const dx = cam.position.x - t2[0], dy = cam.position.y - t2[1], dz = cam.position.z - t2[2];
    const d0 = Math.max(2.4, Math.hypot(dx, dy, dz));
    // 起始 target = 最终锚点 t2（非眼位）；球坐标 = 眼位相对 t2
    this.orbit.target.set(t2[0], t2[1], t2[2]);
    this.orbit.tTarget.copy(this.orbit.target);
    this.orbit.dist = d0; this.orbit.tDist = d0;
    this.orbit.theta = Math.atan2(dx, dz); this.orbit.tTheta = this.orbit.theta;
    this.orbit.phi = Math.acos(clamp(dy / d0, -1, 1)); this.orbit.tPhi = this.orbit.phi;
    // 终点 = 同一锚点 t2 + v0 环绕参数（theta 随航向；phi/dist 缓动到 v0 值）
    this.orbit.flyTo({
      ...v0,
      target: t2,
      theta: v0.theta + yaw,
    }, 1.0);
    HOST.S._alt = FLY.alt;   // Phase 1-A：经宿主取用（01-host.js）
    // P4-A：FPV 退出后环绕悬停 adopt 当前高度——否则摇杆先前设定的 userAlt
    // 已过时，退出瞬间整机会跳回旧高度（高度唯一真源在 FLY，此处同步即可）
    FLY.userAlt = FLY.alt;
  }

  // 最终闭环修复（FPV→任务/Orbit 唯一交接规范化）：startMission/retry 等
  // 进入任务路径必须走这里（而非裸 exit()）——完整清除 FPV 可能残留的
  // 相机 up、驾驶速度、输入累积、userAlt/S._alt 高度缓存与机体姿态，
  // 使相机真正交还 Orbit/任务过场，避免下一帧 FPV 改写高度/相机与过场竞争。
  exitNormalized() {
    this.exit();
    // 相机 up 恢复标准朝上（FPV 机动可能旋转 camera.up，残留会导致 Orbit 翻滚）
    this.W.camera.up.set(0, 1, 0);
    // 清除驾驶速度与视线累积（vYaw/vPitch 残留会在下次 enter 时污染）
    this.spd = 0; this.vy = 0; this.vSide = 0;
    this.vYaw = 0; this.vPitch = 0;
    this._plAcq = null;                       // 释放 acquisition（exit 已置，明确语义）
    // 机体状态规范化：地面停放、高度归零、姿态归零、航向/位置用调用方
    //（startMission）随后按任务规定初值设置；这里只保证无残留
    FLY.state = 'ground'; FLY.alt = 0;
    FLY.userAlt = 0;                      // 任务规定地面值（P4-A userAlt 通道）
    FLY.pitch = 0; FLY.roll = 0;
    if (HOST.S) HOST.S._alt = 0;          // 高度缓存同步（防 orbit tTarget 残留抬升）
    // 驾驶键与输入累积全清（触屏/键盘按住不放的残留）
    for (const k of ['w', 'a', 's', 'd', 'r', 'q', 'g', 'x']) keys[k] = false;
    // Orbit 目标拉回停放位（相机交还环绕；x/z 由调用方随后按任务起点设置）
    this.orbit.tTarget.set(FLY.x || 0, 1.1, FLY.z || 0);
    this.orbit.target.copy(this.orbit.tTarget);
    // P14-C：任务接管路径取消 exit() 的平滑过渡动画（fly 起点=FPV 眼位，
    // 会被 startMission/过场重写；此处直接让 orbit 阻尼收敛到停放位）
    this.orbit.fly = null;
  }

  // 每帧：输入 → 姿态/速度 → FLY；相机贴眼位随机体（十字线=机头=弹道）
  update(dt) {
    if (!this.active) return;
    // 指针锁定状态每帧对齐提示条（toast 只弹一次，提示条常驻直到恢复锁定）
    this._syncCapture();
    if (!document.pointerLockElement) {
      if (!this._relockHint) {
        this._relockHint = true;
        toast('点击画面或"重新捕获"继续瞄准，触屏可用方向键，按 C 退出');
      }
    } else {
      this._relockHint = false;
    }
    // 2026-10-14：方向键 ↑/↓ 俯仰（↓ = 机头下俯），不依赖鼠标
    const pk = this.pitchKeys || 0;
    if (pk) this.vPitch = clamp(this.vPitch + pk * 1.6 * dt, -1.05, 1.82);
    // 无指针锁定的备用瞄准：光标偏离画面中心 → 转向速率 / 俯仰目标（中心 12% 死区）
    if (!document.pointerLockElement && this.cursor && this.cursor.on) {
      const dz = (v) => Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
      this.vYaw -= dz(this.cursor.x) * 1.5 * dt;
      const pT = clamp(dz(this.cursor.y) * 1.82, -1.05, 1.82);
      this.vPitch += (pT - this.vPitch) * Math.min(1, dt * 2.5);
    }
    const k = keys;
    // 转向：A/D 直接改视线方位（机体缓追）
    const yawRate = (k['a'] ? 1 : 0) - (k['d'] ? 1 : 0);
    // Phase 19：战损操控惩罚（S._pen 由 70-app 从 SAM_PENALTY_TABLE 写入；
    // 无损伤是全 1 表条目，行为与旧版逐位一致。fallback 字面量只在 samwar
    // 未建时的前几帧可能触发，稳态零分配）
    const _pen = (HOST.S && HOST.S._pen) || { speedMul: 1, yawMul: 1 };
    this.vYaw += yawRate * 1.1 * _pen.yawMul * dt;
    // 升降：R 升 / Q 降（F 保留给地狱火，与环绕模式键位一致）
    const vyT = (k['r'] ? 1 : 0) - (k['q'] ? 1 : 0);
    this.vy += (vyT * 6 - this.vy) * Math.min(1, dt * 3.2);
    // 前向速度：W/S；俯冲加速：机头下俯 + W 推杆 → 重力势能转化（最高 ~1.9×）
    const spdT = (k['w'] ? this.SPD_MAX : k['s'] ? -this.SPD_REV : 0) * _pen.speedMul;
    const diveK = k['w'] ? clamp(FLY.pitch, 0, 0.9) : 0;
    this.spd += (spdT * (1 + diveK * 0.9) - this.spd) * Math.min(1, dt * 1.6);
    // 侧飞速度：Z 左 / X 右（悬停侧飞，速度为前向的 60%——侧飞比前飞慢）
    const sT = (k['x'] ? 1 : 0) - (k['z'] ? 1 : 0);
    this.vSide += (sT * this.SPD_MAX * 0.6 * _pen.speedMul - this.vSide) * Math.min(1, dt * 2.2);

    // 机体缓追视线（指数趋近，手感稳）；侧倾跟转向输入+侧飞输入，压坡度感
    const kk = Math.min(1, dt * 7);
    FLY.yaw += shortestAngle(FLY.yaw, this.vYaw) * kk;
    // 俯仰极限：下俯扩到 -49°（俯冲攻击机动），上仰 +0.35 保持
    // 2026-10-14：下俯极限 0.85→1.0（≈57°），便于俯冲对地攻击
    FLY.pitch += (clamp(this.vPitch * 0.55, -0.6, 1.0) - FLY.pitch) * kk;
    FLY.roll += (clamp(-yawRate * 0.22 - this.vSide * 0.03, -0.35, 0.22) - FLY.roll) * kk;

    // 位移：机体前向 × 前向速度 + 右向 × 侧飞速度 + 垂直（写入 FLY.x/z——
    // loop 每帧用它们重建 root.position，直接写 root.position 会被下一帧的
    // 振动重置冲掉）。右向量 = 前向绕 Y 转 -90°：(-cos yaw, sin yaw)。
    // 俯冲/爬升：机头俯角把前向速度分解出垂直分量（-sin(pitch)·spd——
    // 渲染约定 rotation.x 正=机头下俯，故取负号：下俯时高度掉、拉起爬升）
    const fx = Math.sin(FLY.yaw), fz = Math.cos(FLY.yaw);
    FLY.x = clamp(FLY.x + (fx * this.spd - Math.cos(FLY.yaw) * this.vSide) * dt, -58, 58);
    FLY.z = clamp(FLY.z + (fz * this.spd + Math.sin(FLY.yaw) * this.vSide) * dt, -58, 58);
    FLY.alt = clamp(FLY.alt + (this.vy - Math.sin(FLY.pitch) * this.spd) * dt, 1.2, 40);

    // 相机：眼位 + 机体姿态（不加额外偏角——所见即机头）。
    // matrixWorld 要在本帧手动刷新（渲染器在 render 时才更新，直接用会滞后一帧）
    this.apache.root.updateMatrixWorld(true);
    const cam = this.W.camera;
    // 眼位是 root 局部坐标，必须每帧转换到世界坐标；只更新朝向会让
    // 进入 FPV 后相机仍停留在上一环绕机位，表现为“第一人称”名不副实。
    // 这里全部走构造期分配的暂存向量：本函数每帧执行，clone()/new Vector3()
    // 会稳定产出 4 个短命对象/帧（60fps ≈ 240 个/秒）给 GC 添无谓压力。
    const eye = this._eyeW.copy(this.eye);
    this.apache.root.localToWorld(eye);
    cam.position.copy(eye);
    // 相机沿机头 +Z 看；Three 相机自身视线是 -Z，不能直接复制机体四元数。
    // 用机体前向与机体上向构造姿态，同时保留转向/俯仰/侧倾。
    const forward = this._fwd.set(0, 0, 1).applyQuaternion(this.apache.root.quaternion);
    const up = this._up.set(0, 1, 0).applyQuaternion(this.apache.root.quaternion);
    // 2026-10-14：俯冲时视线额外下压（机头下俯超过 0.3 后追加 50%，满俯 ≈ +0.27 rad）
    const extra = Math.max(0, FLY.pitch - 0.3) * 0.5;
    if (extra > 0) {
      const right = this._right || (this._right = new THREE.Vector3());
      right.crossVectors(up, forward).normalize();
      forward.applyAxisAngle(right, extra);
      up.applyAxisAngle(right, extra);
    }
    const target = this._look.copy(cam.position).add(forward);
    cam.up.copy(up);
    cam.lookAt(target);

    // HUD 读数（低频刷新）
    this._hudT = (this._hudT || 0) + dt;
    if (this._hudT > 0.15) {
      this._hudT = 0;
      UI('fp-spd').textContent = (this.spd * 2 * 3.6).toFixed(0);
      UI('fp-alt').textContent = (FLY.alt * 2).toFixed(0);
      UI('fp-hdg').textContent = (((FLY.yaw * 180 / Math.PI) % 360 + 360) % 360).toFixed(0).padStart(3, '0');
      // P7：稳定度读数（由 70-app loop 派生写入 S._stability；悬停=100%，机动中下降）
      const stab = (HOST.S && HOST.S._stability != null) ? Math.round(HOST.S._stability * 100) : 100;
      UI('fp-stab').textContent = String(stab);
      this._gpws();
      // 弹药面板：低于 20% 标红闪（初始量 gun 1200/rk 38/hf 8）
      if (this.rig) {
        const low = (v, full) => v < full * 0.2 ? 'var(--warn)' : '';
        const am = UI('fp-am'), ar = UI('fp-ar'), ah = UI('fp-ah');
        am.textContent = String(this.rig.gunAmmo);
        ar.textContent = String(this.rig.rocketAmmo);
        ah.textContent = String(this.rig.hfAmmo);
        am.style.color = low(this.rig.gunAmmo, 1200) ? 'var(--warn)' : '';
        ar.style.color = low(this.rig.rocketAmmo, 38) ? 'var(--warn)' : '';
        ah.style.color = low(this.rig.hfAmmo, 8) ? 'var(--warn)' : '';
      }
    }

    // —— 目标指示：机炮锥内最近目标（地面+空中合并取近）投影跟随 ——
    // 与炮塔自动追踪同款锥角逻辑：十字线放目标附近即锁定，方框+距离实时跟随
    // #6 发现/锁定解耦：锥角 45/42→180（全向）。旧值只在机头窄锥内找目标，
    // 机腹下方/侧后方的目标一律不显示，玩家进 FPV 后屏上空空如也、不知东南西北
    //（用户实测"无法主动发现目标、不知方向"）。现全向取最近存活目标：目标在
    // 屏内→亮锁定框（可攻击）；目标在屏外→边缘箭头指向它（跟着箭头压机头即入屏）。
    // 屏内/屏外切换沿用下方既有逻辑（相机 FOV≈34°＜60° 自瞄锥，屏内即在可攻击锥内）。
    let lock = null, lockD = 1e9;
    const nose = this._nose.set(0, 0, 1).applyQuaternion(this.apache.root.quaternion);
    if (this.targets && this.targets.enabled) {
      const gt = this.targets.nearestAhead(this.apache.root.position, nose, 180);
      if (gt) { lock = gt; lockD = gt.pos.distanceTo(this.apache.root.position); }
    }
    if (this.airTargets && this.airTargets.enabled) {
      const at = this.airTargets.nearest(this.apache.root.position, nose, 180);
      if (at && at.d < lockD) { lock = at.t; lockD = at.d; }
    }
    // Phase 20-A：A2A 敌机进锁定候选（合并取近——与无人机/地面目标同竞争）
    if (this.enemyAir && this.enemyAir.enabled) {
      const et = this.enemyAir.nearest(this.apache.root.position, nose, 180);
      if (et && et.d < lockD) { lock = et.t; lockD = et.d; }
    }
    // M2 景深聚焦数据（只读遥测供 DOF）：锁定目标距离（u），未锁定=0
    this.lockD = lock ? lockD : 0;
    const lockEl = UI('fp-lock'), arrEl = UI('fp-arr');
    const C = this._lk;
    if (!lock || !lockEl) {
      // 无目标：只在从"有目标"翻转过来的那一帧收起三个元素（含箭头标签）
      if (C.mode !== 'off') {
        C.mode = 'off';
        if (lockEl) lockEl.style.display = 'none';
        if (arrEl) arrEl.style.display = 'none';
        const lEl0 = UI('fp-arr-label');
        if (lEl0) lEl0.style.display = 'none';
      }
      return;
    }
    // 建议武器（用户反馈：给对应目标建议武器并给出快捷键——按目标类型给出
    // 快捷键提示；变化才写 DOM）。P16 验收修复：目标在屏外（箭头模式）时
    // 提示同样可见——挂到箭头旁的目标标签里，不再只藏在锁定框内（用户
    // 反馈"没有攻击目标使用武器的提示"）。
    const tp0 = lock.type || '';
    const wTip = tp0 === 'tank' ? '建议：F 地狱火'
      : tp0 === 'enemy' ? '建议：G 机炮 · F 地狱火'
      : (tp0 === 'drone' || tp0 === 'balloon' || tp0 === 'plane') ? '建议：G 机炮'
      : '建议：G 机炮 · X 火箭';
    {
      const wEl = UI('fp-lock-w');
      if (wEl && wEl.textContent !== wTip) wEl.textContent = wTip;
    }
    // 锁定变化检测：新目标进入锥内时触发确认音（每次换目标触发一次）
    const lockKey = lock.label || lock.type || '';
    if (lockKey !== this._lastLockKey) {
      this._lastLockKey = lockKey;
      if (this.onSfx) this.onSfx('lock');
    }
    const v = this._v.copy(lock.pos).project(this.W.camera);
    const onScr = v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88;
    if (onScr) {
      // 屏内：方框贴目标 + 距离数字；箭头/标签隐藏
      if (C.mode !== 'box') {
        C.mode = 'box';
        lockEl.style.display = 'block';
        arrEl.style.display = 'none';
        const lEl1 = UI('fp-arr-label');
        if (lEl1) lEl1.style.display = 'none';
      }
      // 亚像素抖动不写 DOM：投影值每帧都在动（机体振动），但四舍五入到
      // 整数像素后大多数帧是同一个值，比较后再写能省掉绝大部分样式重算。
      const px = Math.round((v.x * 0.5 + 0.5) * innerWidth);
      const py = Math.round((-v.y * 0.5 + 0.5) * innerHeight);
      if (px !== C.x) { C.x = px; lockEl.style.left = px + 'px'; }
      if (py !== C.y) { C.y = py; lockEl.style.top = py + 'px'; }
      const dm = Math.round(lockD * 2);
      if (dm !== C.d) { C.d = dm; UI('fp-lock-d').textContent = dm + ' m'; }
    } else {
      // 屏外：边缘方位箭头（绕屏心旋转指向，距离屏心 170px）+ 目标标签
      //（P16 验收修复：目标名+武器建议挂箭头下方，屏外也有提示）
      const lEl = UI('fp-arr-label');
      if (C.mode !== 'arrow') {
        C.mode = 'arrow';
        lockEl.style.display = 'none';
        arrEl.style.display = 'block';
        if (lEl) lEl.style.display = 'block';
      }
      const ang = Math.atan2(v.y, v.x);
      const px = Math.round(innerWidth / 2 + Math.cos(ang) * 170);
      const py = Math.round(innerHeight / 2 - Math.sin(ang) * 170);
      if (px !== C.x) { C.x = px; arrEl.style.left = px + 'px'; }
      if (py !== C.y) { C.y = py; arrEl.style.top = py + 'px'; }
      if (lEl) {
        // 标签内容/位置同款缓存写法（变化才写 DOM）；文字贴箭头下方
        const lt = (lock.label || lock.type || '目标') + ' · ' + wTip;
        if (C.lt !== lt) { C.lt = lt; lEl.textContent = lt; }
        const ly = py + 18;
        if (ly !== C.ly) { C.ly = ly; lEl.style.top = ly + 'px'; }
        if (px !== C.lx) { C.lx = px; lEl.style.left = px + 'px'; }
      }
      // 旋转量按 0.5° 量化：肉眼分辨不出，但能滤掉振动引起的逐帧重写
      if (Math.abs(ang - C.ang) > 0.0087) {
        C.ang = ang;
        arrEl.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
      }
    }
  }

  // 鼠标（指针锁定期间由 70-app 转发）。水平 yaw 只累加一次——
  // 重复两行会让同一 movementX 产生双倍转向（Phase 0 已确认缺陷）
  // 灵敏度用 this.sens（enter 时按面板滑块设置，默认 0.004）
  // 最终闭环修复（首帧异常隔离·一次性消费）：仅当存在 acquisition 且其
  // state==='armed' 时，本事件被当作该 acquisition 的首条 mousemove：
  //   - 巨幅（|dx|>120 或 |dy|>120——锁定伪影特征）→ 只做 vPitch 钳制并丢弃
  //   - 小幅（合法快速瞄准）→ 正常处理
  // 无论哪种都立即置 consumed（一次性）。acq 已 consumed / 不存在时，
  // 后续任何大小的输入均正常生效——确保"mousemove 先于 pointerlockchange
  // 消费首帧"后，随之而来的合法 >120px 快速输入不会被当第二个首帧丢弃。
  // 不再用永久阈值过滤（会吞合法快速甩鼠）。
  mouse(dx, dy) {
    const acq = this._plAcq;
    if (acq && acq.state === 'armed') {
      acq.state = 'consumed';                  // 一次性：本 acquisition 首条后立即解除
      if (Math.abs(dx) > 120 || Math.abs(dy) > 120) {
        this.vPitch = clamp(this.vPitch, -1.05, 1.82);   // 巨幅锁定伪影：丢弃
        return;
      }
      // 小幅首帧（合法快速瞄准）：正常处理
    }
    this.vYaw -= dx * this.sens;
    // 2026-10-14：鼠标下移 = 机头下俯（与 FPS 瞄准习惯一致，原为反向，用户反馈难以俯冲）
    // 俯仰输入范围 -1.05..1.82（pitch 上限 1.0 ≈ 57°，相机再追加下视 ≈ 总 72°）
    this.vPitch = clamp(this.vPitch + dy * this.sens, -1.05, 1.82);
  }
}
