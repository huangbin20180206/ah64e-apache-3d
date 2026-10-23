// ============================================================
// 70-play.js — 游戏模式：战役地图 / 关卡入口 / 结算按钮区（P2，2026-10-13）
// ============================================================
// 数据：HOST.levels（91-levels，纯数据）；存档：progress（92-progress，70-start 创建）。
// 流程：进入游戏 → 战役地图（4 章 13 关、星级、锁）→ 选关 → 简报（70-mission
//      renderBriefing 读 levelId 渲染关卡目标）→ 出击 → 结算（星级/附加目标/解锁）
//      → 面板按钮「下一关」/「关卡地图」/「重试」。
// 开局走既有 startMission(variant, null, levelId)：不复制任务状态机；关卡场景
//（环境/天气）经面板 chip 的同一点击入口切换，不绕开既有 setter。
// 同前缀 70-*：互引不算反向引用；appModeInit（70-appmode）调用 showLevelMap。
// ============================================================

const playState = { mapOpen: false, lastLevel: null };

function _starStr(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }

function renderLevelMap() {
  const box = UI('levelmap');
  if (!box || !HOST.levels || !progress) return;
  const LV = HOST.levels;
  const tot = progress.totals();
  const diffs = arcade ? arcade.diffKeys() : ['standard'];
  const curDiff = (arcade && arcade.difficulty) || 'standard';
  let html = '<div class="lm-head"><div><div class="lm-k">CAMPAIGN</div><div class="lm-t">战役地图</div></div>' +
    '<div class="lm-tot"><b>' + tot.stars + '</b> / ' + tot.maxStars + ' ★<span>已通关 ' + tot.cleared + ' / ' + tot.ready + '</span></div>' +
    '<div class="lm-diff" role="radiogroup" aria-label="难度">' +
    diffs.map(k => '<button class="lm-dchip' + (k === curDiff ? ' on' : '') + '" data-diff="' + k + '" role="radio" aria-checked="' +
      (k === curDiff) + '">' + (arcade ? arcade.diffName(k) : k) + '</button>').join('') + '</div>' +
    '<button class="lm-close" aria-label="关闭战役地图">×</button></div><div class="lm-cols">';
  for (const ch of LV.chapters) {
    html += '<div class="lm-ch"><div class="lm-chh"><i>0' + ch.n + '</i>' + ch.name + '<span>' + ch.en + '</span></div>';
    for (const L of LV.list.filter(x => x.chapter === ch.n)) {
      const rec = progress.rec(L.id);
      const open = progress.isUnlocked(L.id);
      const cls = 'lm-lv' + (L.ready ? '' : ' wip') + (open ? '' : ' locked') + (playState.lastLevel === L.id ? ' cur' : '');
      const badge = !L.ready ? '<em class="b-wip">制作中</em>' : !open ? '<em class="b-lock">未解锁</em>'
        : '<em class="b-star">' + _starStr(rec.stars) + '</em>';
      html += '<button class="' + cls + '" data-level="' + L.id + '"' + (open ? '' : ' aria-disabled="true"') + '>' +
        '<span class="lv-id">' + L.id + '</span><span class="lv-n">' + L.name + '</span>' + badge +
        '<span class="lv-m">' + L.mech + (L.timeout ? ' · ' + Math.round(L.timeout / 60) + ' 分钟' : '') + '</span>' +
        // P5-G4：已通关显示本关最高分 / 最佳评级 / 三星条件提示
        (open && L.ready && rec.clears > 0 ? '<span class="lv-best">最高 ' + (rec.bestScore || 0) + ' · 最佳 ' + (rec.bestGrade || '—') +
          (rec.stars < 3 && L.stars ? ' · 3★需 ' + L.stars.three + ' 级' + (L.bonus && L.bonus.length ? '+' + L.bonus.map(b => b.label).join('、') : '') : '') + '</span>' : '') +
        '</button>';
    }
    html += '</div>';
  }
  html += '</div><div class="lm-foot">上一关拿到 1 颗星即解锁下一关 · 评级达标 2 星 · 再完成附加目标 3 星</div>';
  box.innerHTML = html;
  if (!document.getElementById('p5-lvbest-css')) {
    const s = document.createElement('style'); s.id = 'p5-lvbest-css';
    s.textContent = '.lm-lv .lv-best{display:block;grid-column:1/-1;font-size:11px;opacity:.72;margin-top:2px;color:var(--accent2,#ffd27a)}';
    document.head.appendChild(s);
  }
  for (const b of box.querySelectorAll('.lm-lv')) {
    b.onclick = () => {
      const id = b.dataset.level;
      const L = LV.byId(id);
      if (!L.ready) { toast(id + ' ' + L.name + ' 还在制作中'); return; }
      if (!progress.isUnlocked(id)) { toast('先在上一关拿到 1 颗星'); return; }
      startLevel(id);
    };
  }
  for (const b of box.querySelectorAll('.lm-dchip')) {
    b.onclick = () => { if (arcade && arcade.setDifficulty(b.dataset.diff)) renderLevelMap(); };
  }
  const c = box.querySelector('.lm-close'); if (c) c.onclick = () => hideLevelMap();
}

function showLevelMap() {
  const box = UI('levelmap');
  if (!box) return;
  renderLevelMap();
  box.classList.add('show');
  document.body.classList.add('lm-open');
  playState.mapOpen = true;
  const f = box.querySelector('.lm-lv:not(.locked):not(.wip)');
  if (f) setTimeout(() => f.focus(), 0);
}
function hideLevelMap() {
  const box = UI('levelmap');
  if (box) box.classList.remove('show');
  document.body.classList.remove('lm-open');
  playState.mapOpen = false;
}

// 关卡入口：场景 → 玩法模式 → startMission(variant, null, id)
function startLevel(id) {
  const L = HOST.levels && HOST.levels.byId(id);
  if (!L || !L.ready || !progress || !progress.isUnlocked(id)) return false;
  hideLevelMap();
  playState.lastLevel = id;
  if (HOST.setPlayMode && S.mode !== 'mission') HOST.setPlayMode('mission');
  const sc = L.scene || {};
  // 场景经面板 chip 同一入口切换（setter 在 72-uibind 闭包内，DOM 点击即同路径）
  if (sc.env && S.env !== sc.env) { const c = document.querySelector('#env-row [data-env="' + sc.env + '"]'); if (c) c.click(); }
  const wk = sc.weather || 'none';
  const wc = document.querySelector('#weather-row [data-weather="' + wk + '"]');
  if (wc && !wc.classList.contains('on')) wc.click();
  startMission(L.variant, null, id);
  syncPlayActions();
  toast(L.id + ' ' + L.name + '——按 T 起飞出发');
  if (HOST.showKeycard) HOST.showKeycard(id);   // 第二轮 A：第一次进关卡弹按键图 + 一句话目标（73-keycard）
  try { history.replaceState(null, '', location.pathname + location.search + '#play/' + id); } catch (e) {}
  return true;
}

// 面板按钮区（游戏模式专属）：关卡地图 / 下一关
function syncPlayActions() {
  const nx = UI('btn-next-level');
  if (!nx) return;
  const m = S._mission;
  const r = progress && progress.last;
  const show = !!(m && m.phase === 'done' && m.levelId && r && r.id === m.levelId && r.next && progress.isUnlocked(r.next));
  nx.style.display = show ? '' : 'none';
  if (show) nx.textContent = '下一关 ' + r.next + ' →';
  syncResultActions(show ? r.next : '');
}

// 结算卡内的操作条（2026-10-14 用户反馈：右侧面板收起时找不到“下一关”）
// 关卡局结束（完成/失败）后在 #mission-body 末尾放：下一关(N) / 重玩 / 战役地图
function syncResultActions(next) {
  const body = UI('mission-body');
  if (!body) return;
  const old = body.querySelector('.mact');
  if (old) old.remove();
  const m = S._mission;
  if (!m || !m.levelId || (m.phase !== 'done' && m.phase !== 'failed')) { playState.next = ''; return; }
  playState.next = next || '';
  const bar = document.createElement('div');
  bar.className = 'mact';
  const mk = (id, txt, fn, primary) => {
    const b = document.createElement('div');
    b.className = 'chip' + (primary ? ' on' : '');
    b.id = id; b.tabIndex = 0; b.setAttribute('role', 'button');
    b.textContent = txt;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    bar.appendChild(b);
  };
  if (next) mk('res-next', '下一关 ' + next + ' → (N)', () => startLevel(next), true);
  mk('res-retry', '重玩本关', () => startLevel(m.levelId), !next);
  mk('res-map', '战役地图', () => showLevelMap(), false);
  body.appendChild(bar);
}
HOST.onLevelResult = () => syncPlayActions();

function bindPlayUI() {
  const lm = UI('btn-levelmap');
  if (lm) lm.onclick = () => showLevelMap();
  const nx = UI('btn-next-level');
  if (nx) nx.onclick = () => { const r = progress && progress.last; if (r && r.next) startLevel(r.next); };
  addEventListener('keydown', e => {
    // N：结算后直接进入下一关（仅当下一关已解锁且结算卡显示了按钮）
    if (!playState.mapOpen && (e.key === 'n' || e.key === 'N') && playState.next && !e.ctrlKey && !e.metaKey) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      startLevel(playState.next);
      return;
    }
    if (!playState.mapOpen) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); hideLevelMap(); }
    // 地图打开时吞掉驾驶/开火键（按钮自身的回车/空格激活不受影响：未 preventDefault）
    else if (e.key === ' ' || /^[a-z0-9]$/i.test(e.key)) e.stopImmediatePropagation();
  }, true);
}
