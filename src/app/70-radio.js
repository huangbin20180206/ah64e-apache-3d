// ============================================================
// 70-radio.js — 无线电中文喊话（2026-10-19 体验批 E2）
// ============================================================
// 预录语音（assets/audio/radio/*.mp3，微软神经语音合成 + 无线电滤波/静噪处理，
// 见该目录 NOTE.txt）+ 底部字幕条。只在游戏模式任务局里说话。
// 两个角色：指挥所（开局/完成/失败/误伤）、射手（击毁/连杀/中弹/锁定/击落）。
// 优先级：高优先级打断低优先级；同级或更低在说话时丢弃（不排队，免得滞后）。
// 击毁类台词至少间隔 5s，中弹至少 8s，避免话痨。轮换不用随机数（按计数）。
// 声音走独立增益直连输出，只受全局静音开关控制（不受旋翼转速门控）。
// 开关：localStorage ah64_radio='0' 关闭语音（字幕仍显示）。
// ============================================================

const RADIO_LINES = {
  start: { who: '指挥所', p: 2, ids: ['start1', 'start2'],
    txt: ['毒蛇一号，这里是指挥所。你已进入作战区域，清除所有目标。', '毒蛇一号，目标区域确认，自由开火。'] },
  done: { who: '指挥所', p: 3, ids: ['done1', 'done2'],
    txt: ['干得漂亮，毒蛇一号！所有目标已清除，可以返航。', '指挥所收到，战区已肃清。毒蛇一号，返航吧。'] },
  fail: { who: '指挥所', p: 3, ids: ['fail1'], txt: ['毒蛇一号，任务失败，立即撤出战区。'] },
  civ: { who: '指挥所', p: 3, ids: ['civ1', 'civ2'], txt: ['停火！停火！你打到平民了！', '注意识别目标，那是平民！'] },
  kill: { who: '射手', p: 1, cd: 5, ids: ['kill1', 'kill2', 'kill3', 'kill4'],
    txt: ['目标摧毁！', '命中，目标起火。', '打中了，又干掉一个。', '装甲目标已摧毁。'] },
  multi: { who: '射手', p: 1, cd: 4, ids: ['multi1', 'multi2'], txt: ['连续击毁，漂亮！', '一串全干掉了！'] },
  inf: { who: '射手', p: 1, ids: ['inf1'], txt: ['地面步兵已肃清。'] },
  air: { who: '射手', p: 2, ids: ['air1'], txt: ['敌机击落！'] },
  hit: { who: '射手', p: 2, cd: 8, ids: ['hit1', 'hit2'], txt: ['我们中弹了！', '机身受损，注意规避！'] },
  lock: { who: '射手', p: 3, cd: 10, ids: ['lock1'], txt: ['被雷达锁定了！放干扰弹，快规避！'] },
};

const RADIO = { buf: {}, loading: false, gain: null, src: null, curP: 0, until: 0, rr: {}, last: {}, el: null, hideT: 0, samPh: 'idle' };
HOST.radio = RADIO;

function _radioPrefOn() {
  try { return localStorage.getItem('ah64_radio') !== '0'; } catch (e) { return true; }
}

function _radioLoad() {
  if (RADIO.loading || !audio || !audio.ctx) return;
  RADIO.loading = true;
  const ctx = audio.ctx;
  RADIO.gain = ctx.createGain();
  RADIO.gain.gain.value = 0;
  RADIO.gain.connect(ctx.destination);
  for (const k in RADIO_LINES) for (const id of RADIO_LINES[k].ids) {
    fetch('assets/audio/radio/' + id + '.mp3')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(b => ctx.decodeAudioData(b))
      .then(ab => { RADIO.buf[id] = ab; })
      .catch(() => { RADIO.failed = (RADIO.failed || 0) + 1; });
  }
}

function _radioSub(who, txt) {
  if (!RADIO.el) {
    const st = document.createElement('style');
    st.textContent =
      '#radio-sub{position:fixed;left:50%;bottom:15vh;transform:translateX(-50%);z-index:31;pointer-events:none;' +
      'max-width:min(80vw,640px);padding:7px 14px;border-radius:6px;background:rgba(10,14,10,.62);' +
      'border-left:3px solid #9fd36a;color:#e8f2dc;font:14px/1.45 sans-serif;opacity:0;transition:opacity .2s}' +
      '#radio-sub.on{opacity:1}#radio-sub b{color:#9fd36a;font-weight:600;margin-right:.5em}';
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = 'radio-sub';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    RADIO.el = el;
  }
  RADIO.el.innerHTML = '<b>◉ ' + who + '</b>' + txt;
  RADIO.el.classList.add('on');
}

// 触发一句台词；返回是否播出
function radioSay(kind) {
  const L = RADIO_LINES[kind];
  if (!L || appState.mode !== 'play' || !S._mission) return false;
  const now = performance.now() / 1000;
  if (L.cd && now - (RADIO.last[kind] || -1e9) < L.cd) return false;
  if (now < RADIO.until && L.p <= RADIO.curP) return false;
  RADIO.last[kind] = now;
  const i = (RADIO.rr[kind] = ((RADIO.rr[kind] || 0) + 1)) % L.ids.length;
  _radioLoad();
  let dur = 1.2 + L.txt[i].length * 0.17;
  if (RADIO.src) { try { RADIO.src.stop(); } catch (e) { /* 已结束 */ } RADIO.src = null; }
  const ab = RADIO.buf[L.ids[i]];
  if (ab && audio && audio.ctx && _radioPrefOn()) {
    const s = audio.ctx.createBufferSource();
    s.buffer = ab;
    s.connect(RADIO.gain);
    s.start();
    RADIO.src = s;
    dur = ab.duration;
  }
  RADIO.curP = L.p; RADIO.until = now + dur;
  RADIO.hideT = dur + 0.6;
  _radioSub(L.who, L.txt[i]);
  return true;
}

// 每帧（真实时钟）：静音跟随、字幕淡出、SAM 锁定沿检测
function radioTick(rawDt) {
  if (!RADIO.loading && appState.mode === 'play' && audio && audio.ctx) _radioLoad();   // 进入游戏模式即预载，开场台词不哑
  if (RADIO.gain && audio) RADIO.gain.gain.value = audio.enabled ? 1.15 : 0;
  if (RADIO.hideT > 0) {
    RADIO.hideT -= rawDt;
    if (RADIO.hideT <= 0 && RADIO.el) RADIO.el.classList.remove('on');
  }
  if (appState.mode !== 'play' && RADIO.el && RADIO.el.classList.contains('on')) {
    RADIO.el.classList.remove('on'); RADIO.hideT = 0;
  }
  const ph = samwar ? samwar.phase : 'idle';
  if (ph === 'lock' && RADIO.samPh !== 'lock' && S._mission && S._mission.phase === 'active') radioSay('lock');
  RADIO.samPh = ph;
}
