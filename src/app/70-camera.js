// ============================================================
// 70-camera.js — 机位条 / 机位切换 / 截图
// ============================================================
// 2026-10-12 自 70-app.js 拆出（纯搬移 + 帧逻辑提成具名函数，行为不变）。
// 同前缀 70-* 文件在拓扑检查里同级（互引不算反向引用），拼接顺序按文件名。

// ---------- 截图 ----------
// 渲染器未开 preserveDrawingBuffer，只能在 render 之后的同一帧内取像素
function saveShot() {
  try {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'AH64E_' + S.scheme + '_' + S.env + '_' + Date.now() + '.png';
    a.click();
  } catch (e) { loadTxt.textContent = '截图失败：' + e.message; }
}

// ---------- 机位条 ----------
// 机位条是一组互斥选项，语义上等于 radiogroup；aria-checked 由 setView 同步
// （enhanceA11y 只处理 aria-pressed 的开关型 chip，这里自己维护）。
function buildViewBar() {
  const bar = UI('views');
  bar.innerHTML = '';
  bar.setAttribute('role', 'radiogroup');
  bar.setAttribute('aria-label', '相机机位');
  VIEWS.forEach((v, i) => {
    const el = document.createElement('div');
    el.className = 'chip' + (i === 0 ? ' on' : '');
    el.textContent = v.key + ' ' + v.name;
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
    el.setAttribute('aria-label', `机位 ${v.name}，快捷键 ${v.key}`);
    el.onclick = () => setView(i);
    bar.appendChild(el);
  });
}
function setView(i) {
  if (i < 0 || i >= VIEWS.length) return;
  S.view = i;
  // VIEWS 以"停放在原点、机头朝 +Z"为基准。FPV 平移/转向后必须以直升机
  // 为参照物：目标点 = 机体局部偏移按当前航向旋转 + 机体位置；theta 同步
  // 加航向角——"正侧/尾后"才会跟着机头转。否则退出 FPV 后所有机位仍对着
  // 旧原点，取景全是空地（用户实测）。
  const v = VIEWS[i];
  const yaw = apache ? apache.root.rotation.y : 0;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const ox = v.target[0], oz = v.target[2];
  const tgt = [
    (FLY.x || 0) + ox * cos + oz * sin,
    v.target[1] + FLY.alt,
    (FLY.z || 0) - ox * sin + oz * cos,
  ];
  orbit.flyTo({ ...v, target: tgt, theta: v.theta + yaw });
  [...UI('views').children].forEach((c, k) => {
    c.classList.toggle('on', k === i);
    c.setAttribute('aria-checked', k === i ? 'true' : 'false');
  });
}
