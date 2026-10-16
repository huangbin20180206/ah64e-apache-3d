// ============================================================
// 72-uibind.js — UI 绑定与事件路由（从 70-app.js 拆出）
// ============================================================
// bindUI 是唯一入口，boot() 尾部调用一次；引用的全部符号
//（S/W/renderer/composer/apache/rig/…）都是同 IIFE 顶层声明。
// ============================================================

// —— 无障碍补齐 ——
// 面板里的 .chip 是 div 伪按钮：鼠标能点，键盘 Tab 到不了、读屏软件也念不出
// 它是可操作控件。这里统一升级为 role=button + tabindex=0 + 回车/空格触发。
// 不改成真 <button> 是为了不动既有 CSS 和 12 处 onclick 绑定；语义与键盘可达
// 靠属性补齐即可。views 机位条在 bindUI 之前就建好了，所以一次扫描能全覆盖。
// aria-pressed 用 MutationObserver 镜像 .on 类：现有六处 setter 都是
// classList.toggle('on', …)，观察 class 变化比逐个改 setter 更不容易漏。
function enhanceA11y() {
  const chips = document.querySelectorAll('.chip');
  for (const c of chips) {
    if (!c.getAttribute('role')) c.setAttribute('role', 'button');
    if (!c.hasAttribute('tabindex')) c.tabIndex = 0;
    // 有 data-scheme/env/terrain/sfx 的是互斥选项组，语义上更接近开关按钮；
    // Phase 11 X1：模式 chip（data-mode）与任务变体 chip（data-variant）同规则；
    // Phase 13-M4：天气 chip（data-weather）同规则
    if (c.dataset.scheme || c.dataset.env || c.dataset.terrain || c.dataset.sfx
        || c.dataset.mode || c.dataset.variant || c.dataset.weather) {
      c.setAttribute('aria-pressed', c.classList.contains('on') ? 'true' : 'false');
    }
    c.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();          // 空格默认滚动页面，且会与"启停旋翼"全局键冲突
      e.stopPropagation();         // 防止冒泡到 window 的键位路由（空格=启停旋翼）
      c.click();
    });
  }
  // .on 类变化 → aria-pressed 同步（只在用户切换时触发，不是逐帧开销）
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      const el = m.target;
      if (el.hasAttribute('aria-pressed')) {
        el.setAttribute('aria-pressed', el.classList.contains('on') ? 'true' : 'false');
      }
    }
  });
  for (const c of chips) {
    if (c.hasAttribute('aria-pressed')) obs.observe(c, { attributes: true, attributeFilter: ['class'] });
  }
}

function bindUI() {
  const btnStart = UI('btn-start');
  // P6：三模式定位（展示/训练/任务）+ 任务入口
  const modeRow = UI('mode-row');
  const setMode = key => {
    // P6 修复批：离开任务模式（切到 show/train）时，briefing/active/frozen 的
    // 任务一律统一清理——否则 S._mission 残留，loop 仍会继续计时/推进/完成/超时，
    // 违反"展示模式零任务污染"。清理走 resetRange 同一路径（不复制第二套逻辑）；
    // 从 show/train 切回 mission 不自动生成旧任务，必须由"开始任务"入口重建。
    if (S.mode === 'mission' && key !== 'mission') {
      resetRange();
    }
    // Phase 11 T1：训练路径不阻塞展示模式——切出 train（show/mission）即清除训练状态
    if (S.mode === 'train' && key !== 'train') {
      S._train = 0; S._trainFp = S._trainOrbit = S._trainRescue = false;
    }
    S.mode = key;
    [...modeRow.children].forEach(c => c.classList.toggle('on', c.dataset.mode === key));
    const act = UI('mission-actions');
    act.style.display = key === 'mission' ? '' : 'none';
    if (key === 'mission' && !S._mission) {
      // 首次进入任务模式：仅给出入口（不自动开始），用户点"开始任务"
      toast('任务模式：点「开始任务」进入统一任务');
    }
    // 训练模式（Phase 11 T1/T5）：结构化分步引导替换单条 toast。
    // S._train（1..5，0=关）与首访引导 S._guide（1..3）互不混用——首访任意
    // 模式触发、训练仅 train 模式触发；不新建独立步骤管理器（S 即状态源）。
    if (key === 'train') {
      if (S._guide > 0) S._guide = 0;   // T2：进入训练先完成/跳过首访引导
      if (!S._train) {
        S._train = 1;
        S._trainFp = S._trainOrbit = S._trainRescue = false;
        let done = false;
        try { done = localStorage.getItem('ah64_train') === '5'; } catch (e) {}
        toast(done ? '重新训练？按 Esc 跳过——' + TRAIN_NUM[0] + '/⑤ ' + TRAIN_STEPS[0]
                  : '训练 ' + TRAIN_NUM[0] + '/⑤ ' + TRAIN_STEPS[0], trainToastMs());
      } else {
        // 重入提示补当前步操作指令（用户反馈：原提示只说"继续第 N 步"
        // 没说该做什么——补上 TRAIN_STEPS 具体按键；guide 条另有常驻）
        toast('训练 ' + TRAIN_NUM[S._train - 1] + '/⑤ ' + TRAIN_STEPS[S._train - 1] + '（按 Esc 跳过）', trainToastMs());
      }
    }
  };
  [...modeRow.children].forEach(c => c.onclick = () => setMode(c.dataset.mode));
  HOST.setPlayMode = setMode;   // P1：70-appmode 经宿主切玩法模式（同一清理路径）
  UI('btn-mission-start').onclick = () => {
    if (S.mode !== 'mission') setMode('mission');
    startMission();
    toast('任务简报已下发——按 T 起飞出发，接近基地后锁定攻击');
  };
  UI('btn-mission-retry').onclick = () => {
    if (S.mode !== 'mission') setMode('mission');
    retryMission();
  };

  const setRun = on => {
    if (!on && FLY.state !== 'ground') { toast('飞行中禁止关停发动机'); return; }
    S.running = on;
    btnStart.textContent = on ? '关停旋翼' : '启动旋翼';
    btnStart.classList.toggle('on', on);
  };
  btnStart.onclick = () => setRun(!S.running);

  // 起飞 / 降落：旋翼转速不足禁止起飞
  const toggleFly = () => {
    if (FLY.state === 'ground') {
      if (!S.running || S.spin < FLY.MIN_SPIN) {
        toast('旋翼转速不足，先启动并等待转速达到 92% 以上');
        return;
      }
      FLY.state = 'up';
    } else if (FLY.state === 'hover') {
      FLY.state = 'down';
    } else {
      toast('起飞/降落进行中…');
    }
    syncFlyText();
  };
  UI('btn-fly').onclick = toggleFly;
  syncFlyText();

  const ck = (id, fn) => { const e = UI(id); e.onchange = () => fn(e.checked); };
  ck('chk-disc', v => S.disc = v);
  ck('chk-vib', v => S.vib = v);
  ck('chk-scan', v => S.scan = v);
  ck('chk-shadow', v => { apache.setShadows(v); W.pad.receiveShadow = v; });
  ck('chk-wire', v => apache.setWireframe(v));
  ck('chk-auto', v => orbit.auto = v);
  ck('chk-labels', v => {
    S.labels = v;
    labelBox.style.display = v ? 'block' : 'none';
    if (!v) hideLabelInfo();   // P2-B3：关闭标签时解说牌一并隐藏
    if (v) updateLabels();
  });
  labelBox.style.display = 'none';

  const wp = () => {
    apache.setWeapons({
      hellfire: UI('chk-hellfire').checked,
      rockets: UI('chk-rocket').checked,
      gun: UI('chk-gun').checked,
      radar: UI('chk-radar').checked,
    });
    // 挂载重开不复活已离架的地狱火
    if (rig) for (const n of rig.launched) n.visible = false;
  };
  ck('chk-hellfire', wp); ck('chk-rocket', wp); ck('chk-gun', wp); ck('chk-radar', wp);

  // 武备：机炮按住连发 / 火箭按住连发 / 地狱火单发 / 装填
  const gunBtn = UI('btn-gun');
  const gunPress = e => { e.preventDefault(); if (rig) { rig.gunOn = true; gunBtn.classList.add('on'); } };
  const gunRelease = () => { if (rig) rig.gunOn = false; gunBtn.classList.remove('on'); };
  gunBtn.addEventListener('pointerdown', gunPress);
  addEventListener('pointerup', gunRelease);
  gunBtn.addEventListener('pointerleave', gunRelease);
  gunBtn.addEventListener('pointercancel', gunRelease);   // P5-D(C3)：移动端触点被系统取消（来电/滑屏/手势接管）时释放扳机
  const rkBtn = UI('btn-rk');
  const rkPress = e => { e.preventDefault(); if (rig) { rig.rocketOn = true; rkBtn.classList.add('on'); } };
  const rkRelease = () => { if (rig) rig.rocketOn = false; rkBtn.classList.remove('on'); };
  rkBtn.addEventListener('pointerdown', rkPress);
  addEventListener('pointerup', rkRelease);
  rkBtn.addEventListener('pointerleave', rkRelease);
  rkBtn.addEventListener('pointercancel', rkRelease);   // P5-D(C3)：同上
  UI('btn-hf').onclick = () => {
    if (rig && !rig.launchHf()) toast('地狱火已打完或未挂载，按 V 装填');
  };
  UI('btn-v').onclick = () => {
    if (rig) { rig.reload(UI('chk-hellfire').checked); toast('弹药已装填'); }
  };

  // 靶场：显隐 + 重置（湖面场地强制隐藏——靶车浮在湖面上不合理）
  const syncTargetsVis = () => {
    if (!targets) return;
    const on = UI('chk-targets').checked && W.terrainKey !== 'water';
    targets.enabled = on;
    for (const t of targets.targets) t.group.visible = on && t.alive;
  };
  ck('chk-targets', v => syncTargetsVis());
  // P6：重置升级为完整清理（air 空中目标/rescue 救援重生成/武器瞬态/任务状态一并复位）
  const resetRange = () => {
    if (targets) targets.reset();
    if (air) air.reset();
    if (rig) { rig.clearTransient(); rig._dmgPenalty = 0; }   // P8：重置清受损散布惩罚
    if (samwar) samwar.reset();          // Phase 19：清 SAM 状态（干扰弹补满/导弹清空）
    if (samvis) samvis.clearVisual();    // Phase 19：兜底隐藏导弹/干扰弹网格
    if (damageSys) damageSys.reset();     // Phase 19：清机务损伤/卡壳/过热/处置状态
    if (enemyAir) enemyAir.reset();       // Phase 20：清 A2A 状态（相位/弹药/在场全清）
    if (narrative) narrative.resetStrikes();   // Phase 21：清基地设施打击层（hp/alive/雷达停转复位）
    if (enemyVis) enemyVis.clearVisual(); // Phase 20：兜底隐藏敌机/曳光/坠毁动画
    if (resources) resources.start();     // Phase 20：燃油复位满（告警 latch 清零）
    if (rescue && W) rescue.setTerrain(W.terrainKey);
    _kills = 0; updateTargetHUD(null); syncTargetsVis(); toast('靶场已重置');
    S._mission = null; S._baseFound = false;
    if (music) music.setMode('ambient');   // Phase 13-S4：清场回落氛围垫乐
    { const mp = document.getElementById('mission'); if (mp) mp.classList.remove('show'); }
    const rb = UI('btn-mission-retry'); if (rb) rb.style.display = 'none';
  };
  UI('btn-reset-targets').onclick = resetRange;
  // P4-B: rescue K touch entry - same rescue.toggle channel as keydown 'k' (no parallel state machine)
  UI('btn-rescue').onclick = () => { if (rescue && apache) rescue.toggle(apache.root.position); };

  // 涂装切换
  const schemeRow = UI('scheme-row');
  const setScheme = key => {
    S.scheme = key;
    apache.setScheme(key);
    [...schemeRow.children].forEach(c => c.classList.toggle('on', c.dataset.scheme === key));
    UI('brand').innerHTML = key === 'army'
      ? 'AH-64E APACHE<small>US ARMY · LONGBOW</small>'
      : 'AH-64E APACHE<small>USMC LOW-VIS · LONGBOW</small>';
  };
  [...schemeRow.children].forEach(c => c.onclick = () => setScheme(c.dataset.scheme));

  // 环境
  const envRow = UI('env-row');
  const setEnv = key => {
    const P = applyPreset(W, renderer, key);
    if (!P) return;
    S._qCool = 10;                          // Phase 2-A1：切环境短暂豁免自动降档
    if (washfx) washfx.setLighting(P);       // 下洗粒子跟随环境色调
    if (washfx) washfx.grass.syncLighting(W); // 草叶光照同步
    if (refl) refl.syncLighting(P);          // 湖面倒影跟随环境色调
    if (nlights) nlights.syncEnv(key);       // 指示灯：夜间全开/黄昏 85%/其余关
    if (apache) apache.setEnvIntensity(P);   // P5-A(C)：机体环境反射随预设（夜间降/黄昏中值）
    S.env = key;
    [...envRow.children].forEach(c => c.classList.toggle('on', c.dataset.env === key));
    UI('exposure').value = P.exposure; UI('bloom').value = P.bloom;
    composer.exposure = P.exposure; composer.strength = P.bloom;
    UI('v-exp').textContent = P.exposure.toFixed(2);
    UI('v-bloom').textContent = P.bloom.toFixed(2);
    if (washfx) washfx.grass.syncLighting(W);   // 草叶自带光照，换预设要同步
  };
  [...envRow.children].forEach(c => c.onclick = () => setEnv(c.dataset.env));

  // 起降场地切换：换地面材质/远景/雾 + 同步下洗介质
  const terrainRow = UI('terrain-row');
  const setTerrain = key => {
    if (!W.setTerrain(key)) return;
    S._qCool = 10;                        // Phase 2-A1：切场景短暂豁免自动降档
    if (washfx) washfx.setMedium(TERRAINS[key].wash);
    if (audio) audio.setMedium(TERRAINS[key].wash);
    if (refl) refl.setEnabled(key === 'water');
    // P5-C：切场地即清空飞行中的弹体/烟尘/破片（对象池 invisible，不销毁）——
    // 否则发射中的火箭/曳光横跨进入新场地（验收点 4.2"无残留"违反）
    if (rig) rig.clearTransient();
    syncTargetsVis();                     // 湖面隐藏靶场（防靶车浮水）
    [...terrainRow.children].forEach(c => c.classList.toggle('on', c.dataset.terrain === key));
  };
  [...terrainRow.children].forEach(c => c.onclick = () => setTerrain(c.dataset.terrain));

  // Phase 13-M4：天气切换（沙暴/夜雷暴/无）——S.weather 为状态源，WeatherFX 消费
  const weatherRow = UI('weather-row');
  const setWeatherFx = key => {
    if (!weather) return;
    S.weather = key;
    weather.setWeather(key);
    [...weatherRow.children].forEach(c => c.classList.toggle('on', c.dataset.weather === key));
  };
  [...weatherRow.children].forEach(c => c.onclick = () => setWeatherFx(c.dataset.weather));

  // 音效开关（旋翼声 / 场地声学）
  const sfxRow = UI('sfx-row');
  [...sfxRow.children].forEach(c => c.onclick = () => {
    if (!audio) return;
    audio.ensureStarted();
    const on = audio.toggle();
    [...sfxRow.children].forEach(x => x.classList.toggle('on', x.dataset.sfx === (on ? 'on' : 'off')));
  });

  const sl = (id, out, fn, dp = 2) => {
    const e = UI(id);
    e.oninput = () => { const v = parseFloat(e.value); UI(out).textContent = v.toFixed(dp); fn(v); };
  };
  sl('exposure', 'v-exp', v => composer.exposure = v);
  sl('bloom', 'v-bloom', v => composer.strength = v);
  // PERF-AUDIT C1：爆炸分解时隐藏镜像（合并体不参与逐节点分解——取舍见审计）
  sl('explode', 'v-exp2', v => { apache.setExplode(v); if (refl) refl.setExplodeMode(v > 0.01); });
  // FPV 灵敏度（倍率 0.5~2x，基础 0.004；enter 时应用，运行中即改即生效）
  sl('fpsens', 'v-fpsens', v => { S.fpSens = v; if (fp) fp.sens = 0.004 * v; }, 1);

  // 画质档位：分辨率 + bloom 级数 + 特效密度联动（applyQuality 是唯一入口）
  UI('sel-quality').onchange = e => {
    S._qManual = true;                     // 手动选过之后自动降档不再插手
    S._qCool = 10;                         // Phase 2-A1：手动选画质后短暂豁免
    applyQuality(parseFloat(e.target.value));
    toast('画质：' + qName(S.quality));
  };

  // P4e 画质三档 + 自动（白话 UI；隐藏的 sel-quality / chk-qauto 仍是唯一后端）
  const qName = q => q >= 1.5 ? '高' : q >= 1 ? '正常' : '低';
  const QHINT = { auto: '自动：跑得动就调高，卡了就调低', '0.75': '低画质：最流畅，画面稍粗', '1': '正常画质：清楚又流畅，大多数电脑选这个',
    '1.5': '高画质：最清楚、影子最细，电脑吃力时会卡' };
  S._qSync = () => {
    const auto = !S._qManual && !S._qAutoOff;
    const key = auto ? 'auto' : (S.quality >= 1.5 ? '1.5' : S.quality >= 1 ? '1' : '0.75');
    document.querySelectorAll('#qual-row .chip').forEach(c => c.classList.toggle('on', c.dataset.q === key));
    const h = UI('qual-hint');
    if (h) h.textContent = auto ? QHINT.auto + '（现在：' + qName(S.quality) + '）' : QHINT[key];
  };
  const pickQ = (key) => {
    if (key === 'auto') {
      S._qManual = false; S._qAutoOff = false; S._qCool = 10; S._qCeil = 1.5; S._up = 0; S._slow = 0;
      UI('chk-qauto').checked = true;
      toast('自动画质：电脑跑得动就调高，卡了就调低');
    } else {
      const s = UI('sel-quality'); s.value = key; s.dispatchEvent(new Event('change'));
    }
    S._qSync();
  };
  S._qSync();
  document.querySelectorAll('#qual-row .chip').forEach(el => {
    el.addEventListener('click', () => pickQ(el.dataset.q));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickQ(el.dataset.q); } });
  });

  // Phase 2-A1：低帧自动降档开关——取消勾选 = 宁掉帧也要画质（HOST.S._qAutoOff 让自动降档彻底让位）
  UI('chk-qauto').onchange = e => {
    S._qAutoOff = !e.target.checked;
    toast(S._qAutoOff ? '已关闭自动画质' : '已开启自动画质');
    if (S._qSync) S._qSync();
  };

  // 顶栏按钮
  const hint = UI('hint');
  const toggleHint = () => {
    hint.classList.toggle('show');
    const on = hint.classList.contains('show');
    UI('btn-help').classList.toggle('on', on);
    UI('btn-help').setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  UI('btn-help').onclick = toggleHint;
  // 关闭按钮只做关闭（不 toggle）——否则在面板未弹出时点关闭反而会打开它
  UI('hint-close').onclick = () => {
    hint.classList.remove('show');
    UI('btn-help').classList.remove('on');
    UI('btn-help').setAttribute('aria-expanded', 'false');
  };

  // P18：成就面板（★ 按钮 / A 键）——各难度最高分 + 8 项成就。内容经
  // arcade.state() 只读遥测渲染（83 模块 achList/diffKeys/diffName/hi 读取口），
  // 打开时重渲染；单局语义：未持久化成就仅本会话局内解锁记录，all_variants
  // 读跨局累计（st.allVariants）。与 #hint 同款抽屉（样式与焦点恢复同 P11 模式）
  const arcadeEl = UI('arcade');
  const renderArcade = () => {
    if (!arcade) return;
    const st = arcade.state();
    UI('arcade-hi').innerHTML = arcade.diffKeys().map(k =>
      '「' + arcade.diffName(k) + '」最高分 <b>' + arcade.hi(k) + '</b>').join(' · ');
    const list = UI('arcade-ach');
    list.innerHTML = '';
    for (const a of arcade.achList()) {
      const on = st.unlocked.includes(a.id) || (a.id === 'all_variants' && st.allVariants);
      const row = document.createElement('div');
      row.className = 'ach' + (on ? ' on' : '');
      row.dataset.id = a.id;
      row.setAttribute('role', 'status');
      row.setAttribute('aria-label', a.name + '：' + a.desc + (on ? '（已解锁）' : '（未达成）'));
      row.innerHTML = '<span>' + a.name + '<div class="ach-d">' + a.desc + '</div></span>' +
        '<span class="ach-s">' + (on ? '✓ 已解锁' : '未达成') + '</span>';
      list.appendChild(row);
    }
  };
  const toggleArcade = () => {
    if (!arcadeEl) return;
    arcadeEl.classList.toggle('show');
    const on = arcadeEl.classList.contains('show');
    if (on) { renderArcade(); setTimeout(() => UI('arcade-close').focus(), 0); }
    UI('btn-arcade').classList.toggle('on', on);
    UI('btn-arcade').setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  UI('btn-arcade').onclick = toggleArcade;
  UI('arcade-close').onclick = () => {
    arcadeEl.classList.remove('show');
    UI('btn-arcade').classList.remove('on');
    UI('btn-arcade').setAttribute('aria-expanded', 'false');
  };
  UI('btn-shot').onclick = () => shotPending = true;
  UI('btn-panel').onclick = () => {
    const p = UI('panel');
    p.classList.toggle('hide');
    const on = !p.classList.contains('hide');
    UI('btn-panel').classList.toggle('on', on);
    UI('btn-panel').setAttribute('aria-expanded', on ? 'true' : 'false');
  };

  // 键盘
  const VKEYS = VIEWS.map(v => v.key);
  addEventListener('keydown', e => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    // 键盘用户 Tab 到按钮上按空格/回车时，浏览器已经派发了 click；
    // 若继续走全局键位路由，空格会同时触发"启停旋翼"（按钮点一次、旋翼也切一次）。
    // 原生 <button> 的空格由浏览器直接转 click 且会冒泡到这里，必须显式让位。
    // classList 判空：window 上派发的合成键（导览 tourKey）target=window，
    // classList 是 undefined，直接 .contains 会崩（曾把导览的启旋/起降键全炸掉）
    if (e.target && (e.target.tagName === 'BUTTON' || (e.target.classList && e.target.classList.contains('chip')))
        && (e.key === ' ' || e.key === 'Enter')) return;
    // P5-D(C1)：长按空格/任意键的自动重复（keydown repeat）不得反复触发
    // 一次性的启停/起飞/切换操作——否则按住空格旋翼会以 ~30Hz 疯狂启停抖动
    //（探针实测 5 次 repeat 翻转 5 态）。唯一允许 repeat 的是 G/X 扳机键——
    // 它们由 keyup 配对，按住期间重复 keydown 只是把 gunOn/rocketOn 再置 true
    //（幂等无害），其余一字性操作全部忽略。
    if (e.repeat && !(e.key.toLowerCase() === 'g' || e.key.toLowerCase() === 'x')) return;
    const k = e.key;
    // Phase 11 T1：Esc 跳过整个训练路径（S._train = 0）；导览的 Esc 交还在 74-tour
    if (k === 'Escape') { if (S._train) S._train = 0; return; }
    if (k === ' ') { e.preventDefault(); setRun(!S.running); return; }
    const vi = VKEYS.indexOf(k);
    // P2-B2：键盘切机位时面板可能收起，用户只见画面在动——一次性 toast
    // 报出机位名（2s 自动隐藏；面板内点击有 chip 高亮反馈，不再重复弹）
    if (vi >= 0) { setView(vi); toast('机位：' + VIEWS[vi].name); return; }
    const key = k.toLowerCase();
    const fpOn = fp && fp.active;
    // FP 接管期间 W/R 是驾驶键（线框/自动旋转挂起），C 进出视角，T 先退 FP 再起降
    if (key === 'c') { if (fp) fp.toggle(); return; }
    if (key === 't') { if (fpOn) fp.exit(); toggleFly(); return; }
    if (key === 'r' && !fpOn) { const c = UI('chk-auto'); c.checked = !c.checked; orbit.auto = c.checked; }
    else if (key === 'l') { const c = UI('chk-labels'); c.checked = !c.checked; c.onchange(); }
    else if (key === 'w' && !fpOn) { const c = UI('chk-wire'); c.checked = !c.checked; apache.setWireframe(c.checked); }
    else if (key === 'e') setScheme(S.scheme === 'army' ? 'lowvis' : 'army');
    else if (key === 'p') shotPending = true;
    else if (key === 'h') toggleHint();
    else if (key === 'a' && !fpOn) toggleArcade();   // P18：成就面板（FP 中 A=左转向，让位）
    else if (key === 'f') { if (rig && !rig.launchHf()) toast('地狱火已打完或未挂载，按 V 装填'); }
    else if (key === 'k') { if (rescue && apache) rescue.toggle(apache.root.position); }
    else if (key === 'v') { if (rig) { rig.reload(UI('chk-hellfire').checked); toast('弹药已装填'); } }
    // Phase 19：J 投放干扰弹（一次性操作，repeat 守卫已拦长按连发）
    else if (key === 'j') {
      if (samwar) {
        if (samwar.dispenseFlare()) toast('干扰弹投放——剩余 ' + samwar.flares + ' 发');
        else toast(samwar.flares > 0 ? '干扰弹冷却中…' : '干扰弹已耗尽');
      }
    }
    // Phase 19 机务处置：U 引擎降功率（持续开关）/ N 武器重新上膛 /
    // I 航电重启（一次性；hudFail 窗口中提示条不可见——信息战语义）
    else if (key === 'u') {
      if (damageSys) { damageSys.mitigate = !damageSys.mitigate;
        toast(damageSys.mitigate ? '引擎降功率处置——功率上限 -15%，持续降温' : '引擎恢复正常功率'); }
    }
    else if (key === 'n') {
      if (damageSys) { if (!damageSys.jammed) { toast('武器未卡壳，无需上膛'); }
        else if (damageSys.weaponsCycle()) toast('重新上膛中…（3 秒）');
        else toast(damageSys.wcCool > 0 ? '上膛机构冷却中…' : '上膛进行中…'); }
    }
    else if (key === 'i') {
      if (damageSys) { if (damageSys.avionicsReboot()) toast('航电重启中…（2 秒，读数全黑）');
        else toast(damageSys.abCool > 0 ? '航电重启冷却中…' : '重启进行中…'); }
    }
    else if (key === 'b') { resetRange(); }
    else if (key === 'o') setFlir(!NIGHT.flir);          // P5-G3 热成像
    else if (key === 'y') launchFlare();                // P5-G3 照明弹
    else if (key === 'g') { if (rig) rig.gunOn = true; }
    else if (key === 'x') { if (rig) rig.rocketOn = true; }
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'g' && rig) rig.gunOn = false;
    if (k === 'x' && rig) rig.rocketOn = false;
  });
  // 浏览器失焦或指针锁定丢失时可能没有对应的 keyup/mouseup，
  // 必须主动释放扳机，避免回到页面后武器继续连发。
  const releaseTriggers = () => {
    if (rig) { rig.gunOn = false; rig.rocketOn = false; }
    gunBtn.classList.remove('on');
    rkBtn.classList.remove('on');
  };
  addEventListener('blur', releaseTriggers);
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) releaseTriggers();
  });
  // P5-D(C3)：移动端切后台（来电阻断/切应用/浏览器隐藏）时 pointerup 不会送达，
  // 必须与 76-mobile 的 visibilitychange 同语义释放扳机——否则回到页面后
  // 机炮/火箭继续连发（"状态已清但视觉卡死"的反向：状态没清，行为残留）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseTriggers();
  });

  // 第一人称：指针锁定下的鼠标输入（移动=瞄准，按住左右键=机炮/火箭扳机）
  addEventListener('mousemove', e => {
    if (!fp || !fp.active) return;
    if (document.pointerLockElement) { fp.mouse(e.movementX, e.movementY); return; }
    // 2026-10-14 备用瞄准：环境不支持指针锁定时，按光标相对画面中心的偏移瞄准
    const r = canvas.getBoundingClientRect();
    fp.cursor = { on: true, x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
  });
  canvas.addEventListener('mouseleave', () => { if (fp && fp.cursor) fp.cursor.on = false; });
  // 第一人称方向键俯仰（↓ 机头下俯 / ↑ 抬头）
  const _pitchKey = (e, down) => {
    if (!fp || !fp.active || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    e.preventDefault();
    const v = e.key === 'ArrowDown' ? 1 : -1;
    if (down) fp.pitchKeys = v; else if (fp.pitchKeys === v) fp.pitchKeys = 0;
  };
  addEventListener('keydown', e => _pitchKey(e, true));
  addEventListener('keyup', e => _pitchKey(e, false));
  addEventListener('mousedown', e => {
    if (!fp || !fp.active || !rig) return;
    if (!document.pointerLockElement && !(fp.noLock && e.target === canvas)) return;
    if (e.button === 0) rig.gunOn = true;
    if (e.button === 2) rig.rocketOn = true;
  });
  addEventListener('mouseup', e => {
    if (!rig) return;
    if (e.button === 0) rig.gunOn = false;
    if (e.button === 2) rig.rocketOn = false;
  });
  addEventListener('contextmenu', e => { if (fp && fp.active) e.preventDefault(); });
  canvas.addEventListener('click', () => {
    if (fp && fp.active) {
      if (fp.noLock) return;          // 已确认不支持：直接用光标备用瞄准，不再反复请求
      let lock = null;
      try { lock = canvas.requestPointerLock(); } catch (err) { fp.noLock = true; }
      if (lock && lock.catch) lock.catch(() => {
        fp.noLock = true;
        toast('当前环境不支持指针锁定——已切到光标瞄准：光标偏离中心即转向/俯仰，左键机炮、右键火箭');
      });
    }
  });
  // 面板按钮与 C 键等效
  UI('btn-fp').onclick = () => { if (fp) fp.toggle(); };

  buildLabels();
  enhanceA11y();               // .chip 伪按钮补 role/tabindex/键盘触发（须在机位条建好后）
  // 暴露给浏览器控制台，方便排查（不参与渲染逻辑）
  window.__dbg = { S, W, HOST, orbit, composer, renderer, FLY, VIEWS, LABELS,
    step: stepFrames,            // 批 E：测试同步步进游戏时间（70-loop.js），正常运行不调用
    get apache() { return apache; }, get rig() { return rig; }, get targets() { return targets; },
    get washfx() { return washfx; },
    get audio() { return audio; },
    get betty() { return betty; },
    get rescue() { return rescue; },
    get refl() { return refl; },
    get air() { return air; },
    get infantry() { return infantry; },     // P5-G2：敌方步兵遥测
    get nl() { return nlights; },
    get fp() { return fp; },
    get weather() { return weather; },        // Phase 13-M4：天气遥测
    get music() { return music; },            // Phase 13-S4：配乐遥测
    get narrative() { return narrative; },    // Phase 13-M5：环境叙事遥测
    get arcade() { return arcade; },          // Phase 18：轻街机层遥测（难度/分数/成就 state()）
    get samwar() { return samwar; },          // Phase 19：SAM 威胁遥测（state() 只读）
    get samvis() { return samvis; },           // Phase 19：SAM 视觉层遥测（state() 只读）
    get damageSys() { return damageSys; },     // Phase 19：机务损伤遥测（state() 只读）
    get enemyAir() { return enemyAir; },       // Phase 20：A2A 敌机遥测（state() 只读）
    get enemyVis() { return enemyVis; },       // Phase 20：敌机视觉层遥测（state() 只读）
    get resources() { return resources; },     // Phase 20：燃油/补给遥测（state() 只读）
    get campaign() { return campaign; },       // Phase 20：战役存档/评级遥测（state() 只读）
    get arcSlot() { return !!HOST.arcade; },  // P18 M3：HOST.arcade 槽位真正装配断言（拓扑检查器
                                              // 查不出"只被引用、从未赋值"，此处运行时值级兜底）
    get dp() { return dp; },                     // P10：重点部件细节件诊断（stats() 只读）
    get tourState() { return HOST.tourState; },   // P2-B4：经 HOST 取导览状态（正向引用；槽名避开 74 符号名）
    // 最终闭环：相机序列导演 owner（cinematic/cutscene 唯一活跃序列遥测）
    get camSeqOwner() { return HOST.camSeq ? HOST.camSeq.owner : null; },
    // Phase 14-A：统一模式/相机 owner 只读状态（测试断言单 owner 契约）
    get modeState() { return HOST.modeState(); },
    // M6 过场叙事状态：getter 名用 cutsceneState（避开 82 顶层符号 cutscene——
    // 拓扑检查器按标识符扫描，getter 名撞符号名即判反向引用，P2-B4 教训）
    get cutsceneState() { return HOST.cutsceneState ? HOST.cutsceneState.state() : null; },
    keys,                                  // FP 驾驶键状态（触屏方向键回归测试出口）
    updateLabels, flyUpdate,
    // P6：任务闭环调试出口（只读状态/触发函数，供值级测试调用）
    startMission, retryMission, beginMission, resetRange, setMode,
    startCampaign,                          // Phase 20-D：战役关卡入口（测试/调试出口）
    startLevel,                             // P2/P3：游戏模式关卡入口（与战役地图点击同一入口）
    get course() { return course; },        // P3：1-1 首飞航线状态
    get progress() { return progress; },    // P2：存档 v2
    // Phase 11 C1：变体选择调试出口（与简报 chip 同一入口）
    setMissionVariant,
    // Phase 18：难度 chips 调试出口（test_arcade A1/A2 与 UI 同入口）
    setMissionDifficulty, renderDiffChips,
    get mission() { return S._mission; },
    missionTimeout, missionVariant,          // P18：A5 时限系数真源读口（变体时限 × 难度系数）
    updateMissionPanel };
  // Phase 11 X4：变体 chip 方向键切换——radiogroup 内 ArrowLeft/Right 在
  // chip 间移动焦点并选中（el.click() 走与鼠标/触控完全相同的入口）。
  // 注意：setMissionVariant 重绘 chips（innerHTML 重建）会销毁刚聚焦的元素，
  // 焦点掉回 body 导致连续方向键失效——重绘后把焦点设回新选中 chip
  const vrow = UI('mission-variants');
  if (vrow) vrow.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    const chips = [...vrow.querySelectorAll('.chip')];
    if (!chips.length) return;
    const cur = vrow.querySelector('.chip.on') || chips[0];
    const i = chips.indexOf(cur);
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + chips.length) % chips.length;
    const nk = chips[n].dataset.variant;
    chips[n].focus();
    chips[n].click();
    setTimeout(() => {
      const next = vrow.querySelector('[data-variant="' + nk + '"]');
      if (next) next.focus();
    }, 0);
  });
  // 首次进入启动三步引导（Phase 2-A3）；之后不再打扰。隐私模式下引导不可用但主功能不受影响。
  try {
    if (!localStorage.getItem('ah64_seen')) {
      localStorage.setItem('ah64_seen', '1');
      S._guide = 1;   // ①空格启动旋翼 → ②T 起飞 → ③▶ 导览；点击画面跳过
    }
  } catch (e) { /* 隐私模式或禁用存储时不影响主功能 */ }

  // Phase 2-A3：首访引导——任意画面按下即跳过（点击即可，无需区分拖拽）
  // Phase 11 T1：训练引导——点击画面跳过整个训练；但"拖拽环绕"是第 ③ 步的
  // 合法完成动作：按下后位移超过 8px 视为观察操作（不跳过），全程无位移的
  // 点击才跳过。Orbit 控制器已消费拖拽，这里只做区分不做环绕。
  let _trainDown = null;
  UI('gl').addEventListener('pointerdown', e => {
    S._guide = 0;
    if (S._train) _trainDown = { x: e.clientX, y: e.clientY };
  });
  UI('gl').addEventListener('pointermove', e => {
    if (S._train === 3 && _trainDown) {
      if (Math.hypot(e.clientX - _trainDown.x, e.clientY - _trainDown.y) > 8) {
        S._trainOrbit = true;      // 拖拽环绕 = 完成"观察/机位"一步
        _trainDown = null;
      }
    }
  });
  UI('gl').addEventListener('pointerup', e => {
    if (S._train && _trainDown) {
      if (Math.hypot(e.clientX - _trainDown.x, e.clientY - _trainDown.y) < 8) S._train = 0;   // 点击=跳过训练
    }
    _trainDown = null;
  });

  // Phase 2-A5：prefers-reduced-motion——前庭敏感用户默认关闭机体振动与自动旋转
  // （面板 checkbox 可手动开回；chk-auto 默认已关，此处冗余防御）
  try {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const vib = UI('chk-vib'); vib.checked = false; S.vib = false;
      const auto = UI('chk-auto'); auto.checked = false; if (orbit) orbit.auto = false;
    }
  } catch (err) { /* matchMedia 不可用不影响主功能 */ }
}

// Phase 1-A：注册 UI 绑定入口——70-app finish 经 HOST.bindUI() 调用。
// 拼接顺序上 72 在 70 之后声明，旧代码"70 直接调 72 的函数声明"靠函数
// 提升成立（隐式环），现改为显式注册进宿主容器（01-host.js）。
HOST.bindUI = bindUI;
