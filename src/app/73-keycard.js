// ============================================================
// 73-keycard.js — 第二轮 A（2026-10-23）：第一次进游戏的按键图 + 一句话目标
// ============================================================
// 问题：朋友第一次打开游戏，不看说明不知道按什么——操作散落在简报、底部提示条、
// 帮助面板里。做法：第一次进入任何关卡时，屏幕中央弹一张"键盘图"：
//   · 用到的键在键盘上按用途上色（起降 / 飞行 / 武器 / 视角），键帽下写两三个字；
//   · 顶上一句话写本关目标（关卡表 layout.goal，没有就用目标清单连起来）；
//   · 按任意键或点一下就关，之后不再自动弹（localStorage ah64_keycard）。
// 只做电脑端：触屏（pointer:coarse）不弹。自动化（webdriver）默认不弹，?keycard=1 强制。
// 卡片打开期间吞掉按键/点击（捕获阶段，早于 82 过场与 72 全局键位），避免关卡片的那一下
// 同时启动旋翼或跳过过场。经 HOST.showKeycard 由 70-play.startLevel 调用（拓扑：低编号不直接引用）。
// ============================================================

const _KC_KEY = 'ah64_keycard';
const _KC_GROUPS = {
  up: { c: '#f0b45a', n: '起飞降落' },
  fly: { c: '#5fd0a8', n: '飞行' },
  wpn: { c: '#ff7a63', n: '武器' },
  cam: { c: '#7fb2ff', n: '视角 · 其他' },
};
// 键 → [组, 键帽下的字]
const _KC_MAP = {
  ' ': ['up', '启动旋翼'], t: ['up', '起飞/降落'],
  a: ['fly', '左转'], d: ['fly', '右转'],
  '↑': ['fly', '前进'], '↓': ['fly', '后退'], '←': ['fly', '左移'], '→': ['fly', '右移'],
  g: ['wpn', '机炮'], x: ['wpn', '火箭'], f: ['wpn', '地狱火'], j: ['wpn', '干扰弹'],
  c: ['cam', '第一人称'], b: ['cam', '重来'], h: ['cam', '帮助'],
};
const _KC_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

let _kcEl = null;
function _kcCss() {
  if (document.getElementById('kc-css')) return;
  const s = document.createElement('style');
  s.id = 'kc-css';
  s.textContent = [
    '#keycard{position:fixed;inset:0;z-index:55;display:flex;align-items:center;justify-content:center;',
    '  background:rgba(4,6,8,.55);backdrop-filter:blur(2px);opacity:0;transition:opacity .25s}',
    '#keycard.show{opacity:1}',
    '#keycard .kc-box{background:rgba(12,16,21,.94);border:1px solid rgba(159,212,184,.25);border-radius:10px;',
    '  padding:20px 26px 16px;max-width:min(760px,94vw);box-shadow:0 18px 60px rgba(0,0,0,.55);color:var(--fg)}',
    '#keycard .kc-k{font:600 11px/1 var(--mono);letter-spacing:.2em;color:var(--mil-dim,#6f8a7d)}',
    '#keycard .kc-goal{font-size:20px;font-weight:700;margin:8px 0 4px;line-height:1.35}',
    '#keycard .kc-goal b{color:var(--accent2)}',
    '#keycard .kc-sub{font-size:13px;color:var(--dim);margin-bottom:14px}',
    '#keycard .kc-kb{display:flex;gap:22px;align-items:flex-end}',
    '#keycard .kc-rows{display:flex;flex-direction:column;gap:5px}',
    '#keycard .kc-row{display:flex;gap:5px}',
    '#keycard .kc-cap{width:44px;height:50px;border-radius:5px;border:1px solid rgba(255,255,255,.08);',
    '  background:rgba(255,255,255,.03);display:flex;flex-direction:column;align-items:center;justify-content:flex-start;',
    '  padding-top:6px;box-sizing:border-box;color:rgba(232,237,242,.22);font:600 15px/1 var(--mono)}',
    '#keycard .kc-cap i{font-style:normal;font:500 10px/1.15 var(--sans);margin-top:5px;text-align:center;white-space:nowrap}',
    '#keycard .kc-cap i.kc-l{font-size:9px;letter-spacing:-.04em}',
    '#keycard .kc-cap.on{color:#0b0f13;border-color:transparent}',
    '#keycard .kc-cap.on i{color:#0b0f13;font-weight:700}',
    '#keycard .kc-space{width:236px}',
    '#keycard .kc-arrows{display:grid;grid-template-columns:repeat(3,44px);gap:5px}',
    '#keycard .kc-mouse{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--fg);min-width:132px}',
    '#keycard .kc-mouse div{display:flex;align-items:center;gap:7px}',
    '#keycard .kc-mouse s{text-decoration:none;display:inline-block;width:10px;height:10px;border-radius:2px}',
    '#keycard .kc-mi{width:38px;height:54px;border:1.5px solid rgba(232,237,242,.5);border-radius:19px 19px 16px 16px;',
    '  position:relative;margin-bottom:4px}',
    '#keycard .kc-mi:before{content:"";position:absolute;left:0;top:0;width:50%;height:22px;border-radius:19px 0 0 0;background:#7fb2ff}',
    '#keycard .kc-mi:after{content:"";position:absolute;left:50%;top:6px;width:1.5px;height:16px;background:rgba(232,237,242,.5)}',
    '#keycard .kc-leg{display:flex;gap:16px;margin-top:14px;font-size:12px;color:var(--dim);flex-wrap:wrap}',
    '#keycard .kc-leg span{display:flex;align-items:center;gap:6px}',
    '#keycard .kc-leg s{text-decoration:none;width:10px;height:10px;border-radius:2px;display:inline-block}',
    '#keycard .kc-go{margin-top:14px;text-align:center;font-size:13px;color:var(--accent);letter-spacing:.06em;',
    '  animation:kcBlink 1.6s ease-in-out infinite}',
    '@keyframes kcBlink{50%{opacity:.45}}',
  ].join('\n');
  document.head.appendChild(s);
}

function _kcCap(k, label, cls) {
  const m = _KC_MAP[k];
  const d = document.createElement('div');
  d.className = 'kc-cap' + (m ? ' on' : '') + (cls ? ' ' + cls : '');
  if (m) d.style.background = _KC_GROUPS[m[0]].c;
  d.textContent = label || k.toUpperCase();
  if (m) { const i = document.createElement('i'); i.textContent = m[1]; if (m[1].length >= 4) i.className = 'kc-l'; d.appendChild(i); }
  return d;
}

// 本关一句话目标：关卡表 layout.goal 优先，否则目标清单用"→"连起来
function keycardGoal(L) {
  if (!L) return '';
  if (L.layout && L.layout.goal) return L.layout.goal;
  return (L.objectives || []).map(o => o.label).join(' → ');
}

function _kcClose() {
  if (!_kcEl) return;
  const el = _kcEl;
  _kcEl = null;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 260);
  try { localStorage.setItem(_KC_KEY, '1'); } catch (e) { /* 隐私模式：本次关掉即可 */ }
}

function showKeycard(levelId, force) {
  if (_kcEl) return true;
  if (!force) {
    try { if (localStorage.getItem(_KC_KEY)) return false; } catch (e) { return false; }
    if (typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches) return false;   // 只做电脑端
    if (navigator.webdriver && !/[?&]keycard=1/.test(location.search)) return false;
  }
  const L = HOST.levels && HOST.levels.byId(levelId);
  _kcCss();
  const el = document.createElement('div');
  el.id = 'keycard';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', '按键图');
  const box = document.createElement('div');
  box.className = 'kc-box';
  box.innerHTML = '<div class="kc-k"></div><div class="kc-goal"></div><div class="kc-sub"></div><div class="kc-kb"></div><div class="kc-leg"></div><div class="kc-go"></div>';
  box.querySelector('.kc-k').textContent = (L ? L.id + ' ' + L.name + ' · ' : '') + '第一次飞？看这一张就够';
  box.querySelector('.kc-goal').innerHTML = '目标：<b></b>';
  box.querySelector('.kc-goal b').textContent = keycardGoal(L) || '清掉全部目标';
  const armed = !(L && (L.variant === 'train_flight' || L.variant === 'train_rescue'));
  box.querySelector('.kc-sub').textContent = '按 T 就能起飞（旋翼会自动启动），方向键前后左右、A/D 转向' +
    (armed ? '，机头对准目标开火。' : '。');
  const kb = box.querySelector('.kc-kb');
  const rows = document.createElement('div');
  rows.className = 'kc-rows';
  _KC_ROWS.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'kc-row';
    row.style.paddingLeft = (i * 16) + 'px';
    for (const ch of r) row.appendChild(_kcCap(ch));
    rows.appendChild(row);
  });
  const sp = document.createElement('div');
  sp.className = 'kc-row';
  sp.style.paddingLeft = '86px';
  sp.appendChild(_kcCap(' ', '空格', 'kc-space'));
  rows.appendChild(sp);
  kb.appendChild(rows);
  const ar = document.createElement('div');
  ar.className = 'kc-arrows';
  ['', '↑', '', '←', '↓', '→'].forEach(k => {
    if (!k) { ar.appendChild(document.createElement('div')); return; }
    ar.appendChild(_kcCap(k, k));
  });
  kb.appendChild(ar);
  const ms = document.createElement('div');
  ms.className = 'kc-mouse';
  ms.innerHTML = '<div class="kc-mi"></div><div><s style="background:#7fb2ff"></s>按住拖动 转视角</div><div><s style="background:#7fb2ff"></s>滚轮 拉远拉近</div><div><s style="background:#ff7a63"></s>按 C 进第一人称后：</div><div style="padding-left:17px">左键机炮 · 右键火箭</div>';
  kb.appendChild(ms);
  const leg = box.querySelector('.kc-leg');
  for (const g of Object.values(_KC_GROUPS)) {
    const s = document.createElement('span');
    s.innerHTML = '<s></s>';
    s.firstChild.style.background = g.c;
    s.appendChild(document.createTextNode(g.n));
    leg.appendChild(s);
  }
  box.querySelector('.kc-go').textContent = '按任意键或点一下开始 · 之后按 H 看全部按键';
  el.appendChild(box);
  document.body.appendChild(el);
  _kcEl = el;
  requestAnimationFrame(() => el.classList.add('show'));
  return true;
}

// 卡片打开时吞掉第一下按键/点击（捕获阶段注册早于 82 过场与 72 全局键位）
addEventListener('keydown', e => {
  if (!_kcEl) return;
  if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  _kcClose();
}, true);
addEventListener('pointerdown', e => {
  if (!_kcEl) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  _kcClose();
}, true);

HOST.showKeycard = showKeycard;
HOST.keycardOpen = () => !!_kcEl;
