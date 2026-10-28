// ============================================================
// 70-appmode.js — 产品层模式：主菜单 / 展示 / 游戏（P1，2026-10-13）
// ============================================================
// 设计见 docs/design/2026-10-13-showcase-game-split.md §2–§4。
//   menu  主菜单：两张入口卡，背景机位缓慢环绕；面板/HUD 全部隐藏
//   show  展示：面板分 飞行/机体/环境/武器/知识 五页；开火与练习靶场保留，
//         不计分、不出任务 HUD（任务玩法模式强制 show）
//   play  游戏：面板只留 模式/动力/武备；任务简报、战役、难度、评级在 #mission
//   all   legacy 全功能平铺（旧行为）。自动化测试（navigator.webdriver）与
//         ?nolaunch=1 默认进入 all，既有浏览器测试零改动；?launch=1 强制主菜单
// 状态只写 body 类（app-*）+ S.app；玩法模式（S.mode）经 HOST.setPlayMode
//（72-uibind 的 setMode）切换，不复制第二套任务清理逻辑。
// URL：#show / #play 直达；hashchange 双向同步。
// 同前缀 70-* 互引不算反向引用；boot() 尾部（70-start）调用 appModeInit()。
// ============================================================

const APP_MODES = ['menu', 'show', 'play', 'all'];
const SHOW_TABS = ['fly', 'body', 'env', 'arm', 'know'];
const appState = { mode: 'all', tab: 'fly', know: -1, inited: false };

// 初始模式决策（纯函数：便于测试推导）
function appModeFromUrl(search, hash, webdriver) {
  const h = (hash || '').replace(/^#/, '').split('/')[0];
  if (h === 'show' || h === 'play') return h;
  if (/[?&]launch=1/.test(search || '')) return 'menu';
  if (/[?&]nolaunch=1/.test(search || '') || webdriver) return 'all';
  return 'menu';
}

function setShowTab(tab) {
  if (SHOW_TABS.indexOf(tab) < 0) tab = 'fly';
  appState.tab = tab;
  for (const t of document.querySelectorAll('#ptabs .ptab')) {
    const on = t.dataset.tab === tab;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const sec of document.querySelectorAll('#panel .sec')) {
    const tabs = (sec.dataset.tab || '').split(/\s+/);
    sec.classList.toggle('tab-on', tabs.indexOf(tab) >= 0);
  }
  const p = UI('panel');
  if (p) p.scrollTop = 0;
}

// 知识页（P4a）：10 张系统知识卡（33-knowcards KNOW_CARDS）+ 14 个部件速查（70-labels LABELS）
function _kItem(cls, key, num, title, fn) {
  const el = document.createElement('div');
  el.className = cls;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.dataset.k = key;
  el.innerHTML = '<i></i><span></span>';
  el.firstChild.textContent = num;
  el.lastChild.textContent = title;
  el.onclick = fn;
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation(); fn();
  });
  return el;
}
// 键盘左右方向键无缝翻页浏览知识卡
if (!window._knowKeyBound) {
  window._knowKeyBound = true;
  addEventListener('keydown', e => {
    if (appState.mode !== 'show' || appState.tab !== 'know' || appState.know < 0) return;
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft' || e.key === '[') {
      e.preventDefault();
      focusKnow((appState.know - 1 + KNOW_CARDS.length) % KNOW_CARDS.length);
    } else if (e.key === 'ArrowRight' || e.key === ']') {
      e.preventDefault();
      focusKnow((appState.know + 1) % KNOW_CARDS.length);
    }
  });
}

function buildKnowList() {
  if (!document.getElementById('p5-kcnav-css')) {
    const st = document.createElement('style'); st.id = 'p5-kcnav-css';
    st.textContent = '.kc-nav{display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(159,212,184,.2)}' +
      '.kc-nb{flex:1;padding:5px 8px;font-size:11px;background:rgba(255,255,255,.05);border:1px solid rgba(159,212,184,.3);color:#d0e6dc;border-radius:3px;cursor:pointer;transition:all .18s ease}' +
      '.kc-nb:hover{background:rgba(159,212,184,.15);border-color:#9fd4b8;color:#fff}' +
      '.kc-nb.on{background:#00e6a8;color:#000;font-weight:700;border-color:#00e6a8}';
    document.head.appendChild(st);
  }
  const box = UI('know-list');
  if (box && !box.childElementCount) {
    KNOW_CARDS.forEach((c, i) => box.appendChild(_kItem('kcard', String(i), String(i + 1).padStart(2, '0'), c.title, () => focusKnow(i))));
  }
  const pb = UI('know-parts');
  if (pb && !pb.childElementCount) {
    LABELS.forEach(([, title], i) => pb.appendChild(_kItem('kpart', String(i), 'P' + (i + 1), title, () => focusPart(i))));
  }
}

function _knowFly(node) {
  const o = apache && apache.get(node);
  if (!o || (fp && fp.active)) return;
  const b = new THREE.Box3().setFromObject(o);
  if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3());
  const r = b.getSize(new THREE.Vector3()).length();
  const d = Math.min(14, Math.max(5.5, r * 1.6 + 3.5));
  orbit.flyTo({ target: [c.x, c.y, c.z], theta: orbit.theta, phi: Math.min(orbit.phi, 1.32), dist: d, fov: 32 }, 1.1);
  const ck = UI('chk-auto'); if (ck) ck.checked = false;
  // 战术聚焦高光脉冲：选定部件瞬时高亮微光淡出反馈
  o.traverse(m => {
    if (m.isMesh && m.material && m.material.emissive) {
      const orig = m.material.emissive.clone();
      m.material.emissive.setHex(0x00e6a8);
      let step = 0;
      const pulse = () => {
        step += 0.06;
        if (step < 1) { m.material.emissive.lerp(orig, 0.14); requestAnimationFrame(pulse); }
        else { m.material.emissive.copy(orig); }
      };
      pulse();
    }
  });
}
function _knowExplode(v) {
  const e = UI('explode');
  if (!e || !apache) return;
  e.value = String(v);
  e.dispatchEvent(new Event('input'));
}
function _knowMark(sel, i) {
  for (const c of document.querySelectorAll('#know-list .kcard, #know-parts .kpart')) c.classList.remove('on');
  const el = document.querySelector(sel + '[data-k="' + i + '"]');
  if (el) el.classList.add('on');
}

// 知识卡：镜头飞向部件 + MFD 风格卡片（定位 / 参数 / 原理 / 出处），带分解的卡自动分解
function focusKnow(i) {
  const C = KNOW_CARDS[i];
  if (!C || !apache) return false;
  appState.know = i;
  _knowMark('#know-list .kcard', i);
  _knowFly(C.node);
  _knowExplode(C.explode || 0);
  labelInfo.className = 'kc';
  labelInfo.innerHTML = '<div class="kc-h"><i></i><b></b></div><em></em><dl></dl><p></p><small></small>';
  labelInfo.querySelector('i').textContent = 'KB ' + String(i + 1).padStart(2, '0') + '/' + KNOW_CARDS.length;
  labelInfo.querySelector('b').textContent = C.title;
  labelInfo.querySelector('em').textContent = C.role;
  const dl = labelInfo.querySelector('dl');
  for (const [k, v] of C.params) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.appendChild(dt); dl.appendChild(dd);
  }
  labelInfo.querySelector('p').textContent = C.body;
  labelInfo.querySelector('small').textContent = '资料：' + C.src;
  // 交互增强：上一张/下一张切换 + 360° 围绕当前部件环视
  let navBox = labelInfo.querySelector('.kc-nav');
  if (!navBox) {
    navBox = document.createElement('div');
    navBox.className = 'kc-nav';
    labelInfo.appendChild(navBox);
  }
  navBox.innerHTML = '<button class="kc-nb kc-prev">⟵ 上一项</button>' +
    '<button class="kc-nb kc-spin">360° 环视</button>' +
    '<button class="kc-nb kc-next">下一项 ⟶</button>';
  navBox.querySelector('.kc-prev').onclick = (e) => { e.stopPropagation(); focusKnow((i - 1 + KNOW_CARDS.length) % KNOW_CARDS.length); };
  navBox.querySelector('.kc-next').onclick = (e) => { e.stopPropagation(); focusKnow((i + 1) % KNOW_CARDS.length); };
  const spinBtn = navBox.querySelector('.kc-spin');
  spinBtn.onclick = (e) => {
    e.stopPropagation();
    orbit.auto = !orbit.auto;
    spinBtn.textContent = orbit.auto ? '停止环视' : '360° 环视';
    spinBtn.classList.toggle('on', orbit.auto);
  };
  labelInfo.style.display = 'block';
  labelInfo.dataset.cur = C.title;
  return true;
}

// 部件速查：与点部件标签同一份文案
function focusPart(i) {
  const L = LABELS[i];
  if (!L || !apache) return false;
  appState.know = -1;
  _knowMark('#know-parts .kpart', i);
  _knowFly(L[0]);
  labelInfo.className = '';
  labelInfo.innerHTML = '<b></b><p></p>';
  labelInfo.firstChild.textContent = L[1];
  labelInfo.lastChild.textContent = L[2];
  labelInfo.style.display = 'block';
  labelInfo.dataset.cur = L[1];
  return true;
}

function updateLauncherProgress() {
  const el = UI('ln-play-desc');
  if (!el) return;
  let txt = '4 章 13 关 · 难度选择 · 星级与解锁';
  try {
    if (progress) {
      const t = progress.totals();
      txt = '4 章 13 关 · 已通关 ' + t.cleared + ' / ' + t.ready + ' · ★ ' + t.stars + ' / ' + t.maxStars;
    }
  } catch (e) {}
  el.textContent = txt;
}

function setAppMode(m, opts) {
  if (APP_MODES.indexOf(m) < 0) return false;
  const o = opts || {};
  const prev = appState.mode;
  appState.mode = m;
  S.app = m;
  const b = document.body;
  for (const k of APP_MODES) b.classList.toggle('app-' + k, k === m);
  const setPlay = HOST.setPlayMode;
  const panel = UI('panel');
  if (m !== 'play') hideLevelMap();
  if (m === 'menu') {
    if (fp && fp.active) fp.exit();
    if (setPlay && S.mode !== 'show') setPlay('show');
    if (labelInfo) labelInfo.style.display = 'none';
    orbit.auto = true;
    updateLauncherProgress();
    setTimeout(() => { const c = UI('ln-show'); if (c && appState.mode === 'menu') c.focus(); }, 0);
  } else if (m === 'show') {
    if (setPlay && S.mode !== 'show') setPlay('show');
    if (prev === 'menu') orbit.auto = !!(UI('chk-auto') && UI('chk-auto').checked);
    setShowTab(appState.tab);
    buildKnowList();
  } else if (m === 'play') {
    if (labelInfo) labelInfo.style.display = 'none';
    if (prev === 'menu') orbit.auto = false;
    if (setPlay && S.mode !== 'mission' && S.mode !== 'train') setPlay('mission');
    // P2：进入游戏 → 战役地图（#play/2-1 直达该关；已有任务则保持原状）
    const want = o.level || '';
    if (want && startLevel(want)) { /* 直达 */ }
    else if (!S._mission) showLevelMap();
  }
  if (m === 'show' || m === 'play') {
    // Q1：触屏进游戏不自动展开面板——面板会盖住摇杆和 77-mobilefire 浮动操作键
    const touchPlay = m === 'play' && typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
    if (panel && panel.classList.contains('hide') && window.innerWidth > 820 && !touchPlay) {
      panel.classList.remove('hide');
      const bp = UI('btn-panel');
      if (bp) { bp.classList.add('on'); bp.setAttribute('aria-expanded', 'true'); }
    }
    // polish3c：竖屏手机（宽 ≤600）面板默认整屏盖住直升机——进入时收起，右上 ☰ 再打开
    else if (panel && !panel.classList.contains('hide') && window.innerWidth <= 600 && !o.fromPanel) {
      panel.classList.add('hide');
      const bp = UI('btn-panel');
      if (bp) { bp.classList.remove('on'); bp.setAttribute('aria-expanded', 'false'); }
    }
  }
  // URL 同步（replaceState 不触发 hashchange，不污染历史栈）
  if (!o.fromHash && m !== 'all' && !(m === 'play' && S._mission && S._mission.levelId)) {
    const want = m === 'menu' ? '' : '#' + m;
    if (location.hash !== want) {
      try { history.replaceState(null, '', location.pathname + location.search + want); } catch (e) {}
    }
  }
  return true;
}

function appModeInit() {
  if (appState.inited) return;
  appState.inited = true;
  for (const t of document.querySelectorAll('#ptabs .ptab')) {
    t.onclick = () => setShowTab(t.dataset.tab);
    t.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setShowTab(t.dataset.tab); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        const i = SHOW_TABS.indexOf(appState.tab) + (e.key === 'ArrowRight' ? 1 : -1);
        const nt = SHOW_TABS[(i + SHOW_TABS.length) % SHOW_TABS.length];
        setShowTab(nt);
        const el = document.querySelector('#ptabs .ptab[data-tab="' + nt + '"]');
        if (el) el.focus();
      }
    });
  }
  // 第 3 张卡「图鉴」不是模式切换，是盖在当前画面上的全屏界面（71-armory，经 HOST.armory）
  for (const c of document.querySelectorAll('#launcher .ln-card')) {
    c.onclick = () => (c.dataset.go === 'armory' ? HOST.armory && HOST.armory.open() : setAppMode(c.dataset.go));
  }
  const ab = UI('btn-armory');
  if (ab) ab.onclick = () => HOST.armory && HOST.armory.open();
  const home = UI('btn-home');
  if (home) home.onclick = () => setAppMode('menu');
  // 主菜单快捷键：1 展示 / 2 游戏 / 3 图鉴（capture 阶段拦截，避免 1/2/3 同时切机位）
  addEventListener('keydown', e => {
    if (appState.mode !== 'menu') return;
    if (e.key === '1' || e.key === '2') {
      e.preventDefault(); e.stopImmediatePropagation();
      setAppMode(e.key === '1' ? 'show' : 'play');
    } else if (e.key === '3') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (HOST.armory) HOST.armory.open();
    } else if (e.key === ' ' || /^[a-z]$/i.test(e.key)) {
      // 菜单期间吞掉驾驶/开火键，防止背景机体被误操作
      e.stopImmediatePropagation();
    }
  }, true);
  addEventListener('hashchange', () => {
    const parts = location.hash.replace(/^#/, '').split('/');
    const h = parts[0];
    if (h === 'armory') { if (HOST.armory) HOST.armory.open(); return; }
    if (h === 'play' && parts[1] && appState.mode === 'play') { if (!(S._mission && S._mission.levelId === parts[1])) startLevel(parts[1]); }
    else if (h === 'show' || h === 'play') setAppMode(h, { fromHash: true, level: parts[1] });
    else if (appState.mode !== 'all') setAppMode('menu', { fromHash: true });
  });
  let wd = false;
  try { wd = !!navigator.webdriver; } catch (e) {}
  bindPlayUI();
  setAppMode(appModeFromUrl(location.search, location.hash, wd), { fromHash: true, level: location.hash.split('/')[1] || '' });
  if (/^#armory/.test(location.hash) && HOST.armory) HOST.armory.open();
}

// 调试/测试出口（只读状态 + 同 UI 入口）
HOST.appMode = {
  get mode() { return appState.mode; },
  get tab() { return appState.tab; },
  get know() { return appState.know; },
  set: (m) => setAppMode(m),
  setTab: (t) => setShowTab(t),
  focusKnow: (i) => focusKnow(i),
  focusPart: (i) => focusPart(i),
  cards: () => KNOW_CARDS.length,
  startLevel: (id) => startLevel(id),
  showLevelMap: () => showLevelMap(),
  get progress() { return progress; },
  get mapOpen() { return playState.mapOpen; },
  fromUrl: appModeFromUrl,
};
