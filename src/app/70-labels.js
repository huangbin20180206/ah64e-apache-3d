// ============================================================
// 70-labels.js — 部件标签（锚点跟随 + 引线 + 解说牌）
// ============================================================
// 2026-10-12 自 70-app.js 拆出（纯搬移 + 帧逻辑提成具名函数，行为不变）。
// 同前缀 70-* 文件在拓扑检查里同级（互引不算反向引用），拼接顺序按文件名。

// ---------- 部件标签 ----------
// [节点名, 中文标签]。锚点 = 节点局部坐标，经 matrixWorld 每帧变换，
// 所以旋翼旋转 / 爆炸分解 / 起降时标签都跟得住节点
const LABELS = [
  ['Radar_Pivot', 'AN/APG-78 龙弓雷达', '桅杆顶端的毫米波雷达，是阿帕奇从 D 型跨入 E 型的标志。它能穿透雨雾沙尘锁定移动目标，让机组躲在掩体后方发射地狱火，导弹自己会翻越障碍。'],
  ['Cylinder.010', '主旋翼 · 四叶', '四叶全复合材料旋翼，桨尖后掠以压低噪声。俯冲拉起时它能快速改变桨距——这架直升机挂满弹药时的机动性全靠这里。'],
  ['Cylinder.012', '尾桨', '抵消主旋翼的反扭矩。桨叶两两交错排列成"剪刀式"，打散了拍击噪声，也让它在战场上更难被听出方位。'],
  ['BODY.001', '短翼挂架', '一对短翼挂着本机几乎全部进攻火力。四个外挂点可混挂地狱火与火箭巢；任务不需要时拆掉挂舱，还能减阻增程。'],
  ['Cylinder.014', 'M230 30mm 链炮', '机头下方的 30mm 单管链式机炮，外置电机驱动装弹。炮口随炮手的目光转动，专打轻装甲与暴露目标。'],
  ['Cylinder', 'AGM-114 地狱火', '约 50 公斤的反坦克导弹，激光制导、误差以米计。一架满挂的阿帕奇可带 16 枚，足够点名一个装甲纵队。'],
  ['Cube007_1', 'M261 火箭巢', '19 管 70mm 火箭巢，一次齐射倾泻压制火力。不追求单发精度，胜在覆盖——对付暴露的人员、车辆和工事最有效率。'],
  ['Cube001_2', '纵列双座驾驶舱', '纵列双座——前座炮手负责瞄准，后座飞行员负责飞行。阶梯式布置互不遮挡视野，座椅下方还有抗坠毁吸能结构。'],
  ['Cube001_5', 'TADS/PNVS 光电塔', '机鼻的转塔是阿帕奇的"眼睛"。上部 PNVS 供飞行员夜间导航，下部 TADS 让炮手稳定瞄准——夜间战斗力的核心都在这座转塔里。'],
  ['Cube001_9', 'T700 发动机舱', '两台 T700 涡轴发动机，单台近 2000 轴马力，左右布置在前机身两侧。单台受损时另一台仍能撑住返航。'],
  ['Cube001_8', '垂尾 · 平尾', '中置平尾与宽弦垂尾撑起尾部的安定性。垂尾顶端的航行灯与频闪灯在夜间任务里标示本机姿态。'],
  ['Cube001_3', '尾梁', '尾梁把主旋翼的动力一路传到尾部——内部的长传动轴驱动尾桨旋转，整流罩内还藏着滑油散热器。'],
  ['Cylinder.008', '主起落架', '后三点起落架的主轮，支柱内置吸能结构，能扛住硬着陆冲击——抗坠毁设计从触地这一刻就开始了。'],
  ['Cylinder.013', '尾轮', '后三点布局的尾撑。地面牵引时可全向回转，维护时还能调节机身姿态方便检修。'],
];
const labelBox = UI('labels');
const labelNodes = [];
// P2-B3：解说牌（点击标签展开部件解说；点击牌面收起）
const labelInfo = UI('label-info');
function hideLabelInfo() {
  labelInfo.style.display = 'none';
  labelInfo.removeAttribute('data-cur');
}
labelInfo.addEventListener('click', hideLabelInfo);
function buildLabels() {
  labelBox.innerHTML = '';
  labelNodes.length = 0;
  const b = new THREE.Box3(), c = new THREE.Vector3();
  for (const [name, text, desc] of LABELS) {
    const o = apache.get(name);
    if (!o) continue;
    b.setFromObject(o);
    if (b.isEmpty()) continue;
    b.getCenter(c);
    // 世界锚点 -> 节点局部；每帧用 matrixWorld 变回世界，即可跟随任何运动
    o.updateWorldMatrix(true, false);
    const lp = o.worldToLocal(c.clone());
    const el = document.createElement('div');
    el.className = 'lab';
    el.textContent = text;
    // 引线（用户反馈：文字直接贴合机体在切换视角时重叠/偏移——文字框
    // 抬到锚点上方固定偏移，用一条细线连接锚点与文字框，线始终指向部位）
    const line = document.createElement('div');
    line.className = 'labline';
    el.appendChild(line);
    // 相邻标签交错水平偏移（左右交替 26px），上方固定抬升——减少同区域
    // 文字框互相重叠；偏移在建标签时按序分配，旋转视角时保持稳定
    const ox = (labelNodes.length % 2 ? -1 : 1) * 26;
    // 点击展开解说牌：同一标签再点收起，不同标签切换内容
    el.addEventListener('click', () => {
      if (labelInfo.dataset.cur === text) { hideLabelInfo(); return; }
      labelInfo.className = ''; labelInfo.innerHTML = '<b></b><p></p>';
      labelInfo.firstChild.textContent = text;
      labelInfo.lastChild.textContent = desc;
      labelInfo.style.display = 'block';
      labelInfo.dataset.cur = text;
    });
    labelBox.appendChild(el);
    labelNodes.push({ el, line, ox, node: o, p: lp });
  }
}
const _v = new THREE.Vector3();
// 标签文字框底边相对锚点的抬升距离（px）；引线从锚点连到文字框底边中心
const LABEL_OFFSET_Y = 46;
function updateLabels() {
  if (!S.labels || !labelNodes.length) return;
  const w = innerWidth, h = innerHeight;
  for (const L of labelNodes) {
    _v.copy(L.p).applyMatrix4(L.node.matrixWorld);
    _v.project(W.camera);
    const vis = _v.z > -1 && _v.z < 1;
    // Phase 19 性能审计 B1：显隐/坐标/引线全部取整量化后与上次值比较，
    // 变化才写——静止相机时 style 写从每标签每帧 6 次降到 0 次
    //（46-fpview _lk 锁定框同款既有模式；1px/0.01rad 量化肉眼不可分辨）
    if (L.qvis !== vis) { L.qvis = vis; L.el.style.display = vis ? 'block' : 'none'; }
    if (!vis) continue;
    // 锚点屏幕坐标；文字框底边 = 锚点 + 固定抬升 + 交错水平偏移
    const ax = (_v.x * 0.5 + 0.5) * w;
    const ay = (-_v.y * 0.5 + 0.5) * h;
    const tx = ax + L.ox, ty = ay - LABEL_OFFSET_Y;
    const qx = Math.round(tx), qy = Math.round(ty);
    if (L.qx !== qx) { L.qx = qx; L.el.style.left = qx + 'px'; }
    if (L.qy !== qy) { L.qy = qy; L.el.style.top = qy + 'px'; }
    // 引线：从锚点 (ax,ay) 到文字框底边 (tx,ty)——长度与旋转角由几何决定
    const dx = tx - ax, dy = ty - ay;
    const len = Math.round(Math.hypot(dx, dy));
    const ang = Math.round(Math.atan2(dy, dx) * 100) / 100;
    const qax = Math.round(ax), qay = Math.round(ay);
    if (L.lax !== qax) { L.lax = qax; L.line.style.left = qax + 'px'; }
    if (L.lay !== qay) { L.lay = qay; L.line.style.top = qay + 'px'; }
    if (L.lw !== len) { L.lw = len; L.line.style.width = len + 'px'; }
    if (L.lang !== ang) { L.lang = ang; L.line.style.transform = 'rotate(' + ang + 'rad)'; }
  }
}
