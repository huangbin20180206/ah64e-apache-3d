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

function closeSaveModal() {
  const m = UI('save-modal');
  if (m) m.style.display = 'none';
}

function openSaveModal(mode) {
  const modal = UI('save-modal');
  const title = UI('sm-title');
  const desc = UI('sm-desc');
  const text = UI('sm-text');
  const btnCopy = UI('sm-btn-copy');
  const btnDownload = UI('sm-btn-download');
  const btnUpload = UI('sm-btn-upload');
  const btnConfirm = UI('sm-btn-confirm');
  const btnClose = UI('sm-close');
  const fileInput = UI('sm-file');
  if (!modal || !title || !desc || !text) return;

  if (btnClose) btnClose.onclick = () => closeSaveModal();
  modal.onclick = (e) => { if (e.target === modal) closeSaveModal(); };

  if (mode === 'export') {
    title.textContent = '战役存档导出 / 备份';
    desc.textContent = '以下是您的完整战役存档代码（包含星级、通关数和最高分）。您可以一键复制文本，或下载为 .json 存档文件以在其他设备导入：';
    const code = progress && progress.exportCode ? progress.exportCode() : (progress ? JSON.stringify(progress.save_data) : '');
    text.value = code;
    text.readOnly = true;
    if (btnCopy) btnCopy.style.display = '';
    if (btnDownload) btnDownload.style.display = '';
    if (btnUpload) btnUpload.style.display = 'none';
    if (btnConfirm) btnConfirm.style.display = 'none';

    if (btnCopy) {
      btnCopy.onclick = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text.value).then(() => toast('✅ 存档代码已复制到剪贴板！')).catch(() => {
            text.select();
            document.execCommand('copy');
            toast('✅ 存档代码已复制！');
          });
        } else {
          text.select();
          document.execCommand('copy');
          toast('✅ 存档代码已复制！');
        }
      };
    }
    if (btnDownload) {
      btnDownload.onclick = () => {
        try {
          const jsonStr = progress && progress.exportJson ? progress.exportJson() : JSON.stringify(progress.save_data, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'ah64e_campaign_save_' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          toast('✅ 存档文件已下载！');
        } catch (e) {
          toast('❌ 下载存档失败：' + (e.message || e));
        }
      };
    }
  } else {
    title.textContent = '导入战役存档';
    desc.textContent = '请在下方文本框中粘贴存档代码或 JSON，也可以直接点击“从文件导入”上传之前的 .json 存档：';
    text.value = '';
    text.readOnly = false;
    text.placeholder = '在此粘贴存档代码（Base64）或 JSON 文本...';
    if (btnCopy) btnCopy.style.display = 'none';
    if (btnDownload) btnDownload.style.display = 'none';
    if (btnUpload) btnUpload.style.display = '';
    if (btnConfirm) btnConfirm.style.display = '';

    if (btnUpload && fileInput) {
      btnUpload.onclick = () => fileInput.click();
      fileInput.onchange = () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target.result;
          if (progress && progress.importData && progress.importData(content)) {
            toast('✅ 存档文件导入成功！');
            closeSaveModal();
            renderLevelMap();
          } else {
            toast('❌ 存档格式不正确或解析失败');
          }
        };
        reader.readAsText(file);
      };
    }
    if (btnConfirm) {
      btnConfirm.onclick = () => {
        const val = text.value.trim();
        if (!val) { toast('请先输入或粘贴存档内容'); return; }
        if (progress && progress.importData && progress.importData(val)) {
          toast('✅ 战役存档导入成功！');
          closeSaveModal();
          renderLevelMap();
        } else {
          toast('❌ 存档解析失败，请检查代码是否完整');
        }
      };
    }
  }

  modal.style.display = 'flex';
}

function renderLevelMap() {
  const box = UI('levelmap');
  if (!box || !HOST.levels || !progress) return;
  const LV = HOST.levels;
  const tot = progress.totals();
  const diffs = arcade ? arcade.diffKeys() : ['standard'];
  const curDiff = (arcade && arcade.difficulty) || 'standard';
  const isAllUnlocked = progress.isAllUnlocked ? progress.isAllUnlocked() : false;
  const saveBarHtml = '<div class="lm-savebar">' +
    '<div class="lm-sb-left">' +
    '<span class="lm-sb-status"><i class="lm-sb-dot"></i>本地自动存档: 正常 (已实时持久化)</span>' +
    '<span class="lm-sb-tip">换浏览器/清除缓存可导出备份；支持一键开启演练特权自由选关</span>' +
    '</div>' +
    '<div class="lm-sb-actions">' +
    '<button class="lm-sb-btn lm-sb-unlock' + (isAllUnlocked ? ' lm-sb-unlocked' : '') + '" title="无需逐关通关，即刻解锁全部13关进行演练与自由出击">' +
    (isAllUnlocked ? '🔓 已解锁全部关卡 (演练中)' : '🔓 解锁全部关卡 (演练特权)') + '</button>' +
    '<button class="lm-sb-btn lm-sb-export" title="导出存档代码或下载JSON存档文件">📤 导出/备份</button>' +
    '<button class="lm-sb-btn lm-sb-import" title="粘贴代码或上传JSON存档恢复进度">📥 导入存档</button>' +
    '<button class="lm-sb-btn lm-sb-danger lm-sb-reset" title="清空全部战役关卡进度与星级">🔄 重置进度</button>' +
    '</div></div>';
  let html = '<div class="lm-head"><div><div class="lm-k">CAMPAIGN</div><div class="lm-t">战役地图</div></div>' +
    '<div class="lm-tot"><b>' + tot.stars + '</b> / ' + tot.maxStars + ' ★<span>已通关 ' + tot.cleared + ' / ' + tot.ready + '</span></div>' +
    '<div class="lm-diff" role="radiogroup" aria-label="难度">' +
    diffs.map(k => '<button class="lm-dchip' + (k === curDiff ? ' on' : '') + '" data-diff="' + k + '" role="radio" aria-checked="' +
      (k === curDiff) + '">' + (arcade ? arcade.diffName(k) : k) + '</button>').join('') + '</div>' +
    '<button class="lm-close" aria-label="关闭战役地图">×</button></div>' +
    saveBarHtml +
    '<div class="lm-cols">';
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
  html += '</div>' +
    '<div class="lm-endless-wrap">' +
    '<button class="lm-endless-btn" >' +
    '<span class="leb-tag">SPECIAL OP</span>' +
    '<div class="leb-main"><b>战区无尽生存 · ENDLESS DEFENSE</b><span>动态多波次攻防 · 海陆空协同协同进犯 · 支持前线 FARP 野战停机坪补给与抢修</span></div>' +
    '<span class="leb-act">出击 ➔</span></button></div>' +
    '<div class="lm-foot">上一关拿到 1 颗星即解锁下一关 · 评级达标 2 星 · 再完成附加目标 3 星</div>';
  box.innerHTML = html;
  const btnEndless = box.querySelector('.lm-endless-btn');
  if (btnEndless) {
    btnEndless.onclick = () => {
      hideLevelMap();
      if (HOST.setPlayMode && S.mode !== 'mission') HOST.setPlayMode('mission');
      startMission('endless');
      // 本地修补：endless 不经 startLevel，需手动同步——否则上一战役关的
      // "下一关 X →"按钮与 playState.next 残留，局中按 N 会丢弃当前无尽局跳关
      syncPlayActions();
    };
  }
  if (!document.getElementById('p5-endless-css')) {
    const s = document.createElement('style'); s.id = 'p5-endless-css';
    s.textContent = '.lm-endless-wrap{padding:10px 20px 0}.lm-endless-btn{width:100%;display:flex;align-items:center;gap:14px;padding:12px 18px;background:linear-gradient(90deg,rgba(255,165,0,.15),rgba(255,80,0,.08));border:1px solid rgba(255,180,60,.4);border-radius:6px;color:#fff;cursor:pointer;text-align:left;transition:all .2s ease}' +
      '.lm-endless-btn:hover{background:linear-gradient(90deg,rgba(255,165,0,.25),rgba(255,80,0,.18));border-color:#ffa500;box-shadow:0 0 16px rgba(255,165,0,.35)}' +
      '.leb-tag{background:#ff9800;color:#000;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:1px}' +
      '.leb-main{flex:1}.leb-main b{display:block;font-size:14px;letter-spacing:1px;color:#ffe082}.leb-main span{font-size:11px;opacity:.75}' +
      '.leb-act{font-size:13px;font-weight:700;color:#ffd54f;padding:4px 10px;border:1px solid rgba(255,213,79,.4);border-radius:4px}';
    document.head.appendChild(s);
  }
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
  const btnUnlock = box.querySelector('.lm-sb-unlock');
  if (btnUnlock) {
    btnUnlock.onclick = () => {
      const now = progress.toggleAllUnlocked ? progress.toggleAllUnlocked() : false;
      toast(now ? '🔓 已开启演练特权：全部 13 关即刻开放自由出击！' : '🔒 已恢复标准逐关解锁模式');
      renderLevelMap();
    };
  }
  const btnExport = box.querySelector('.lm-sb-export');
  if (btnExport) {
    btnExport.onclick = () => openSaveModal('export');
  }
  const btnImport = box.querySelector('.lm-sb-import');
  if (btnImport) {
    btnImport.onclick = () => openSaveModal('import');
  }
  const btnReset = box.querySelector('.lm-sb-reset');
  if (btnReset) {
    btnReset.onclick = () => {
      if (confirm('确定要清空战役存档吗？\n将重置所有 13 个关卡的通关记录、星级与最高分。')) {
        progress.reset();
        toast('已重置战役存档为初始状态');
        renderLevelMap();
      }
    };
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
  // 本地修补：任务进行中（briefing/active）禁止跳关——防止过期 playState.next
  // 在重打本关/无尽局中被 N 键或顶栏按钮触发，无声丢弃当前局
  const _missionBusy = () => { const m = S._mission; return !!(m && (m.phase === 'briefing' || m.phase === 'active')); };
  if (nx) nx.onclick = () => { if (_missionBusy()) return; const r = progress && progress.last; if (r && r.next) startLevel(r.next); };
  addEventListener('keydown', e => {
    // N：结算后直接进入下一关（仅当下一关已解锁且结算卡显示了按钮）
    if (!playState.mapOpen && (e.key === 'n' || e.key === 'N') && playState.next && !_missionBusy() && !e.ctrlKey && !e.metaKey) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      startLevel(playState.next);
      return;
    }
    const sm = UI('save-modal');
    if (sm && sm.style.display && sm.style.display !== 'none') {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeSaveModal(); return; }
      e.stopImmediatePropagation();
      return;
    }
    if (!playState.mapOpen) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); hideLevelMap(); }
    // 地图打开时吞掉驾驶/开火/机位键（按钮自身的回车/空格激活不受影响：未 preventDefault）
    else if (e.key === ' ' || /^[-=a-z0-9]$/i.test(e.key)) e.stopImmediatePropagation();
  }, true);
}
