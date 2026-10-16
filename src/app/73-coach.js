// ============================================================
// 73-coach.js — Q1 训练关实时教练（1-1 首飞 / 1-2 机炮与火箭 /
// 1-3 地狱火 / 1-4 绞车救援）
// ============================================================
// 问题：训练关的操作说明只在开局简报里出现一次，起飞后底部提示条
// 仍显示通用文字（「C 第一人称驾驶 · T 降落…」），第一次玩的人看完
// 简报就忘了下一步该干什么。
// 做法：levelCoachTip() 按当前关卡变体 + 实时状态（旋翼/飞行状态/
// 航线阶段/剩余靶数/绞车状态）返回「第 n 步：…」一句话，由 70-hud
// 上下文提示条经 HOST.coachTip 覆盖显示；状态推进即换句，完成即清空。零新状态机：
// 判定全部读既有状态源（S / FLY / course / targets / rescue）。
// 触屏设备（pointer:coarse）把按键名换成屏幕按钮名（与 77-mobilefire
// 浮动按钮的文字一致），摇杆说法替换方向键说法。
// 只在 S.mode==='mission' 且变体为 train_* 时生效；其余模式返回 ''。
// ============================================================

const _coachTouch = (typeof matchMedia === 'function') && matchMedia('(pointer:coarse)').matches;
// 键名 → 触屏按钮名（与 77-mobilefire 按钮文字逐字一致）
const _CK = _coachTouch
  ? { start: '「启旋」', fly: '「起降」', gun: '按住「机炮」', rk: '按住「火箭」', hf: '「地狱火」', hoist: '「绞车」',
      move: '左摇杆', yaw: '右摇杆左右' }
  : { start: '空格', fly: 'T', gun: '按住 G（或鼠标左键）', rk: '按住 X', hf: 'F', hoist: 'K',
      move: '方向键', yaw: 'A/D' };

function _coachAlive(type) {
  if (!targets || !targets.targets) return 0;
  let n = 0;
  for (const t of targets.targets) if (t.alive && t.group.visible && (!type || t.type === type)) n++;
  return n;
}

function levelCoachTip() {
  if (S.mode !== 'mission' || !S._mission || S._mission.phase !== 'active') return '';
  const v = S._mission.variant;
  if (v !== 'train_flight' && v !== 'train_weapons' && v !== 'train_hellfire' && v !== 'train_rescue') return '';
  const K = _CK;
  // 共用起步两步：启动旋翼 → 起飞
  if (FLY.state === 'ground' && !S.running) return '第 1 步：按 ' + K.start + ' 启动旋翼';
  if (FLY.state === 'ground' && S.spin < FLY.MIN_SPIN) return '旋翼加速中…等转速到 92%';
  const onGround = FLY.state === 'ground';

  if (v === 'train_flight') {
    const st = course && course.active ? course.stage : 0;
    if (st >= 5) return '';
    if (onGround && st < 4) return '第 2 步：按 ' + K.fly + ' 起飞';
    if (st < 3) return '第 3 步：飞向金色航点圈（第 ' + (st + 1) + '/3 个，竖直光柱就是位置）· ' + K.move + ' 前后左右 · ' + K.yaw + ' 转向';
    if (st === 3) return '第 4 步：飞进淡绿色悬停区，松开' + K.move + '稳住 · 已稳 ' + Math.floor(course.hoverT) + '/10 秒';
    return '第 5 步：飞回停机坪上空，按 ' + K.fly + ' 降落';
  }
  if (onGround) return '第 2 步：按 ' + K.fly + ' 起飞';
  if (v === 'train_weapons') {
    const tr = _coachAlive('truck'), br = _coachAlive('barrel');
    if (tr + br === 0) return '';
    if (tr > 0) return '第 3 步：机头对准卡车，' + K.gun + ' 开机炮 · 还剩卡车 ' + tr + ' 辆、油桶 ' + br + ' 个';
    return '第 4 步：' + K.rk + ' 发射火箭打油桶（会连环爆炸）· 还剩 ' + br + ' 个';
  }
  if (v === 'train_hellfire') {
    const tk = _coachAlive('tank');
    if (tk === 0) return '';
    return '第 3 步：飞近一点让机头对着坦克，按 ' + K.hf + ' 发射地狱火，导弹会自己追过去 · 还剩 ' + tk + ' 辆';
  }
  // train_rescue
  const rs = rescue ? rescue.state : 'idle';
  if (rs === 'delivered') return '';
  if (rs === 'aboard') return '第 5 步：人已上机，飞回停机坪按 ' + K.fly + ' 降落';
  if (rs === 'lifting') return '正在收绳…保持悬停别乱动';
  if (rs === 'deploying' || rs === 'holding') return '第 4 步：稳住悬停，让绳子垂到他身边挂上吊带';
  return '第 3 步：跟着烟柱找到幸存者，慢慢悬停到他头顶，按 ' + K.hoist + ' 放下绞车';
}

HOST.coachTip = levelCoachTip;   // 70-hud 经宿主取用（低编号不直接引用高编号）
