// ============================================================
// 01-host.js — 宿主层（Phase 1-A：显式契约中枢）
// ============================================================
// 单 IIFE 拼接架构下，低编号模块曾依赖"恰好 70-app 先声明了同名 const"
// （实测 16 条反向引用，清单与规则见 docs/module-contracts.md）。本文件
// 编号最小，承担两件事：
//   1. UI / toast —— 宿主自有的纯 DOM 能力，在此声明，全链路正向引用，
//      调用点零改动；
//   2. HOST —— 运行期实例容器：renderer / orbit / S / rig / bindUI 由
//      创建方（70-app / 72-uibind）在实例化后注册，低编号消费者
//      （30-world / 45-flight / 46-fpview / 47-betty）经 HOST 取用，
//      不再依赖拼接顺序里的同名 const。
// 拓扑约束由 tools/check_topology.mjs 在构建时强制（build.mjs 前置检查：
// 无反向引用 / 跨文件依赖 ≤ 契约声明 / 被引用符号必须入契约 provides）。
// ============================================================

// DOM 查询别名（原 70-app 顶部声明，纯函数随宿主前移）
const UI = id => document.getElementById(id);

// 运行期实例容器（各槽位由创建方注册，见对应文件的注册行）
const HOST = {
  renderer: null,   // WebGLRenderer（70-app 顶部创建后注册）
  orbit: null,      // 环绕控制器（70-app 创建后注册；45-flight 触地复位取用）
  S: null,          // 应用状态容器（70-app 声明后注册；30-world/46-fpview/47-betty 取用）
  rig: null,        // 武器系统实例（70-app finish 装配后注册；47-betty 弹药告警取用）
  bindUI: null,     // UI 绑定入口（72-uibind 声明后注册；70-app finish 调用）
  setPlayMode: null,// P1：玩法模式切换（72-uibind bindUI 注册 setMode；70-appmode 调用）
  coachTip: null,  // Q1：训练关实时教练提示函数（73-coach 注册；70-hud 提示条取用）
  onLevelResult: null, // P2：关卡结算回调（70-play 注册；70-mission 结算后调用，刷新面板按钮区）
  levels: null,     // P2：关卡表（91-levels 注册；70 层只经此取用）
  appMode: null,    // P1：产品层模式（70-appmode 注册；menu/show/play/all 只读状态 + 测试出口）
  tourState: null,  // 导览状态对象（74-tour 声明后注册；72-uibind __dbg 经此读取，P2-B4）
  fp: null,         // FPV 控制器实例（70-app finish 创建 fp 后注册；Phase 14-A modeState 取用）
  cinemaState: null,// 开场电影状态对象（78-cinematic 声明后注册；Phase 14-A modeState 取用）
  VIEWS: null,      // 机位预设表（50-controls 声明后注册；46-fpview exit 平滑过渡取用，P14-C）
  // 相机序列导演（最终闭环修复·唯一镜头所有权）：cinematic（开场）/ cutscene
  //（任务过场/救援回放）同一时间只能有一个活跃 owner。78/82 各自 start 前
  // request()（冲突返回 false=拒绝，调用方选择不播/重试），end 时 release()。
  // 结束方不得在仍有其他 owner 时 setView 覆盖（release 后 owner 为空才恢复机位）。
  camSeq: {
    owner: null,
    request(key) {
      if (this.owner && this.owner !== key) return false;   // 已有其他活跃序列 → 拒绝
      this.owner = key;
      return true;
    },
    release(key) {
      if (this.owner === key) this.owner = null;
    },
    get active() { return this.owner; },
  },
  // Phase 14-A：唯一相机/模式 owner 可观测接口（测试/调试出口）。
  // 单一事实来源：fp.active / cinema.on / cutscene.on —— fp 实例经 HOST.fp
  //（70-app 注册）、cinema 状态经 HOST.cinemaState（78-cinematic 注册）、
  // cutscene 经 HOST.cutsceneState（82-cutscene 已注册）。此方法只读派生，
  // 供测试断言"任何时刻只有一个相机 owner"；不写入任何状态。
  modeState() {
    const fpOn = !!(this.fp && this.fp.active);
    const cinOn = !!(this.cinemaState && this.cinemaState.on);
    let cutOn = false;
    if (this.cutsceneState && this.cutsceneState.state) cutOn = !!this.cutsceneState.state().on;
    else if (this.cutsceneState && typeof this.cutsceneState === 'object') cutOn = !!this.cutsceneState.on;
    let owner = 'orbit';
    if (cutOn) owner = 'cutscene';
    else if (cinOn) owner = 'cinematic';
    else if (fpOn) owner = 'fp';
    // P14 返修 R3：可观测冲突字段——任何时刻只允许 <=1 个真实活跃相机所有者。
    // owner 派生用优先级仅为渲染语义（不掩盖冲突），conflict 显式暴露非法并发，
    // 测试以 activeOwnerCount/conflict 断言契约而非只看 owner 字符串。
    const activeOwnerCount = Number(!!fpOn) + Number(!!cinOn) + Number(!!cutOn);
    const conflict = activeOwnerCount > 1;
    return {
      owner,                       // orbit | fp | cinematic | cutscene（渲染语义）
      fp: fpOn,
      cinematic: cinOn,
      cutscene: cutOn,
      activeOwnerCount,            // Number(fp)+Number(cinematic)+Number(cutscene)
      conflict,                    // activeOwnerCount > 1（非法并发显式暴露）
      camSeq: this.camSeq ? this.camSeq.owner : null,
      mode: this.S ? this.S.mode : null,     // show | train | mission
      mission: this.S && this.S._mission ? this.S._mission.phase : null,  // briefing|active|done|failed
      plLocked: !!(document && document.pointerLockElement),
    };
  },
};

// ---------- 轻提示（原 70-app，纯 DOM 自包含，随宿主层前移） ----------
let toastT = null;
// 可选第二参 ms：默认 2000ms；训练/引导类提示用更长停留（T4：reduced-motion 时 8s）
function toast(msg, ms) {
  const t = UI('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms || 2000);
}
