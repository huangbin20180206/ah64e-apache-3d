// ============================================================
// 18-audio.js — 程序化音效：旋翼噪声 + 场地声学差异
// 全 WebAudio 合成，无音频文件。首帧无用户手势前不启动（浏览器自动播放策略）。
//
// 旋翼声构成：
//   1) 桨叶拍击（BPF）：4 叶 × 转速/60 Hz 基频 + 谐波，锯齿波短脉冲串
//   2) 涡流宽频嘶声：带通白噪声（发动机 + 桨尖涡）
//   3) 低频隆隆：低通噪声（机体振动）
// 场地声学：卷积混响（程序化生成脉冲响应 IR）——草地吸声(短/闷)、
//   水面强反射(长/亮)、沙漠中等偏散、停机坪轻微
//
// 输出总线（Phase 13-2 可闻性修复后的双总线架构）：
//   master（旋翼声总线）——旋翼合成/发动机样本/混响汇入，受 spin>0.015
//     运行门控（停机归零：不放出旋翼程序音/桨叶拍击等 rotor-only 声音）
//   ambient（环境总线）——wind 环境样本专用，直连 destination，仅受全局
//     静音（enabled）门控，不受旋翼门控——停机沙暴风声可闻
// ============================================================

class RotorAudio {
  constructor() {
    this.ctx = null;
    this.started = false;      // AudioContext 是否已启动
    this.enabled = true;       // 用户开关（面板静音键）
    this.medium = 'dust';
    this.spin = 0;             // 当前转速比（外部每帧更新）
    // 音频噪声独立使用固定种子，既可复现又不扰动视觉效果的 PRNG。
    this._noiseRnd = mulberry32(0xA641D10);
  }

  // 需在用户手势（点击/按键）后调用——首次创建 AudioContext，之后用于恢复
  //（ctx.resume：浏览器切后台/音频设备切换/AudioContext suspend/interrupted
  // 后 state!=='running'，仅在用户手势上下文可恢复）。
  // 最终闭环修复（挂起恢复）：不再"started=true 后立即返回"——每次调用都检查
  // ctx.state，非 running 时 resume()；resume() 的 Promise 失败吞掉（不产生
  // 未处理异常）。不重复创建节点/连接（ctx 已有则复用）。
  ensureStarted() {
    if (this.ctx) {
      // 已有上下文：非 running → 手势上下文尝试恢复（state 可能是 suspended /
      // interrupted / closed）
      if (this.ctx.state !== 'running') {
        try {
          const p = this.ctx.resume();
          if (p && p.catch) p.catch(() => { /* 恢复失败静默（设备/浏览器限制） */ });
        } catch (e) { /* resume 同步异常静默 */ }
      }
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    const ctx = this.ctx;

    // —— 主链：噪声源 → 滤波器组 → 增益 → 混响 → 输出 ——
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // 环境音总线（Phase 13-2 可闻性修复）：wind 样本的独立最终输出路径，直连
    // destination——与旋翼声总线 master 分离，不受 spin>0.015 运行门控影响
    //（停机沙暴风声仍可达扬声器）；仅受全局静音（enabled）控制。旋翼合成/
    // 发动机样本仍走 dry→master（停机不放出旋翼程序音）。
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0;
    this.ambient.connect(ctx.destination);
    // 环境总线信号探针（仅测试用 tap，不进可听链路）：读 post-gain 实际信号
    // 电平——自动化可证明"环境风声真实流动/静音归零/解除恢复"，而非仅证明
    // 增益代数（增益代数无法排除接线错误：节点值=1 不代表样本真接在它上面）
    this.ambientProbe = ctx.createAnalyser();
    this.ambientProbe.fftSize = 1024;
    this.ambient.connect(this.ambientProbe);

    // 音乐总线（最终闭环修复·路由语义）：pad 样本与 FilmMusic 生成声的独立
    // 最终输出路径，直连 destination，仅受全局静音（enabled）控制，不受
    // spin>0.015 旋翼门控——停机默认展示态 ambient 配乐/战斗音乐可闻。
    // 不复用 wind ambient bus：防止 music 信号污染 wind 的 AnalyserProbe RMS。
    // 三类路径语义：master（rotor/engine，spin 门控）/ ambient（wind，仅 enabled）/
    // music（配乐，仅 enabled）；全局静音必须同时关闭三类最终输出。
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(ctx.destination);
    // 音乐总线信号探针（最终闭环修复：仅测试用 tap，不进可听链路）——停机
    // brass/配乐真实信号流动证明；与 ambientProbe 同款，互不污染
    this.musicProbe = ctx.createAnalyser();
    this.musicProbe.fftSize = 1024;
    this.musicBus.connect(this.musicProbe);

    // 混响（卷积）：程序化生成指数衰减噪声 IR，长度/亮度按场地切换
    this.convolver = ctx.createConvolver();
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.25;
    this.convolver.connect(this.reverbGain).connect(this.master);

    // 干声直通
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.8;
    this.dry = ctx.createGain();          // 干声总线
    this.dry.connect(this.dryGain).connect(this.master);
    this.wet = this.convolver;            // 湿声总线入口

    // —— 1. 桨叶拍击：周期性短脉冲（振荡器 + 增益包络按 BPF 触发不可靠，
    //     改用"整形噪声"：白噪声 → 峰化滤波器（BPF 频率处谐振尖峰）→ 波形整形 ——
    this.bladeNoise = this._noiseSource();
    this.bladePeak = ctx.createBiquadFilter();
    this.bladePeak.type = 'bandpass';
    this.bladePeak.Q.value = 9;                 // 高 Q = 拍击的"扑-扑-扑"谐振
    this.bladePeak.frequency.value = 80;        // 4叶×21.4rps ≈ 85Hz 基频
    this.bladeShape = ctx.createWaveShaper();
    this.bladeShape.curve = this._pulseCurve(); // 半波整流+压扁 → 脉冲感
    this.bladeGain = ctx.createGain();
    this.bladeGain.gain.value = 0.5;
    this.bladeNoise.connect(this.bladePeak).connect(this.bladeShape).connect(this.bladeGain);
    this.bladeGain.connect(this.dry);
    this.bladeGain.connect(this.wet);

    // —— 2. 涡流嘶声：带通白噪声（中频） ——
    this.hissNoise = this._noiseSource();
    this.hissBP = ctx.createBiquadFilter();
    this.hissBP.type = 'bandpass';
    this.hissBP.frequency.value = 900;
    this.hissBP.Q.value = 0.6;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0.22;
    this.hissNoise.connect(this.hissBP).connect(this.hissGain);
    this.hissGain.connect(this.dry);
    this.hissGain.connect(this.wet);

    // —— 3. 低频隆隆：低通噪声 ——
    this.rumbleNoise = this._noiseSource();
    this.rumbleLP = ctx.createBiquadFilter();
    this.rumbleLP.type = 'lowpass';
    this.rumbleLP.frequency.value = 110;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.5;
    this.rumbleNoise.connect(this.rumbleLP).connect(this.rumbleGain);
    this.rumbleGain.connect(this.dry);

    this.started = true;
    // A1：真实样本层——合成做不出来的手感（引擎轰鸣/风声/短促铜管/氛围垫乐）
    this.loadSamples();
  }

  // ---------- A1 真实样本层 ----------
  // 样本为仓库内自合成 WAV（tools/gen_audio_samples.py 生成，免版权自录），
  // 经 AudioContext.decodeAudioData 异步加载；加载失败静默降级回纯合成
  //（sampFailed 遥测可见），不阻塞主流程。engine/wind/pad 常驻循环节点
  //（gain 由驱动方调 setLoopGain），brass 一次性样本随播随建。
  loadSamples() {
    if (!this.started || this.samples) return;
    this.samples = {};
    this._src = {};
    this._sampGain = {};
    for (const n of ['engine', 'wind', 'brass', 'pad']) this._loadSample(n);
    this._loadSfx();
  }
  // P5-G1：真实录音武器音效（CC0 Red Library，assets/audio/sfx/LICENSE.txt）。
  // 独立于 samples（不改 A1 样本计数语义）；没加载到就照旧用合成音。
  _loadSfx() {
    if (this.sfxBuf) return;
    this.sfxBuf = {};
    this._sfxRR = 0;
    // sfx2（2026-10-21）：再加火箭飞离 ×2、雷声 ×3（同为 Red Library CC0 真实录音）
    for (const n of ['gun1', 'gun2', 'gun3', 'explo_s', 'explo_s2', 'explo_m', 'explo_l',
                     'rocket1', 'rocket2', 'thunder1', 'thunder2', 'thunder3']) {
      fetch('assets/audio/sfx/' + n + '.mp3')
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(buf => this.ctx.decodeAudioData(buf))
        .then(ab => { if (this.sfxBuf) this.sfxBuf[n] = ab; })
        .catch(() => { this.sfxFailed = (this.sfxFailed || 0) + 1; });
    }
  }
  // 播一段录音（多变体轮换 + 轻微变速防"复读机"）；成功返回 true
  _playBuf(names, gain, jit, wetMix, rate = 1) {
    const B = this.sfxBuf;
    if (!B) return false;
    const list = names.filter(n => B[n]);
    if (!list.length) return false;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = B[list[(this._sfxRR++) % list.length]];
    src.playbackRate.value = rate * (1 + (rnd() - 0.5) * 2 * jit);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.dry);
    if (wetMix > 0) { const w = ctx.createGain(); w.gain.value = wetMix; g.connect(w).connect(this.wet); }
    src.start(t);
    return true;
  }
  _loadSample(name) {
    const ctx = this.ctx;
    fetch('assets/audio/' + name + '.wav')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(buf => ctx.decodeAudioData(buf))
      .then(ab => {
        if (!this.samples) return;                    // 关闭/重建后忽略迟到加载
        this.samples[name] = ab;
        this._sampLoaded = Object.keys(this.samples).length;
        if (name !== 'brass') this._sampLoop(name);   // 一次性样本不常驻节点
      })
      .catch(() => { if (this.samples) this.sampFailed = (this.sampFailed || 0) + 1; });
  }
  _sampLoop(name) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = this.samples[name];
    src.loop = true;
    const g = ctx.createGain();
    // 样本异步加载——若驱动方（配乐 pad 等）在加载完成前已 setLoopGain，
    // 先记在 _sampTarget，加载完成后立刻落到初始增益，避免永远停在 0
    g.gain.value = (this._sampTarget && this._sampTarget[name]) ? Math.max(0, this._sampTarget[name]) : 0;
    // wind 样本走环境总线（可闻性修复）：独立于旋翼门控的最终输出路径，
    // 停机+未静音时风声直达 destination；pad 样本走音乐总线（配乐专用，
    // 不受 spin 门控且不污染 wind 探针）；engine 其余样本仍走 dry→master
    const out = name === 'wind' ? this.ambient
              : name === 'pad' ? this.musicBus
              : this.dry;
    src.connect(g).connect(out);
    src.start();
    this._src[name] = src;
    this._sampGain[name] = g;
    // 接线事实记录（遥测）：测试据此断言 wind/pad 确实接在对应总线上
    //（Web Audio 无连接查询 API，只能在接线时刻记录）
    this._sampBus = this._sampBus || {};
    this._sampBus[name] = name === 'wind' ? 'ambient' : name === 'pad' ? 'music' : 'dry';
  }
  // 常驻循环样本增益驱动（engine/wind 由 update 调、pad 由配乐模块调）
  setLoopGain(name, target, tc = 0.15) {
    this._sampTarget = this._sampTarget || {};
    this._sampTarget[name] = target;
    if (this._sampGain && this._sampGain[name] && this.ctx) {
      this._sampGain[name].gain.setTargetAtTime(Math.max(0, target), this.ctx.currentTime, tc);
    }
  }
  // 一次性样本（brass 铜管 cue / pad 短触发等），播完自毁，可叠发。
  // 最终闭环修复（brass 路由）：bus 参数可选 'music'——音乐类一次性样本
  //（如击毁铜管）走独立 musicBus（仅 enabled 门控、不受 spin 门控），停机
  // 时也可闻；默认（thunder 等环境/效果音）保持 dry/wet → rotor master 语义
  playSample(name, vol = 1, bus) {
    if (!this.started || !this.ctx || !this.enabled || !this.samples || !this.samples[name]) return;
    const ctx = this.ctx, t = ctx.currentTime;
    try {
      const src = ctx.createBufferSource();
      src.buffer = this.samples[name];
      const g = ctx.createGain();
      const dur = this.samples[name].duration;
      g.gain.setValueAtTime(0.85 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.1, dur));
      if (bus === 'music') {
        src.connect(g).connect(this.musicBus);   // 音乐总线（brass 等）
      } else {
        src.connect(g).connect(this.dry);
        g.connect(this.wet);                     // 环境/效果音默认 dry/wet
      }
      src.start(t);
      this['sampPlay_' + name] = (this['sampPlay_' + name] || 0) + 1;
    } catch (e) { /* 样本播放失败不静默影响主流程 */ }
  }
  // 风声强度（0..1，WeatherFX 沙暴驱动；wind 循环样本增益）
  setWind(level) {
    this.windLevel = Math.max(0, Math.min(1.2, level));
  }
  // 只读遥测（测试/调试出口）——双总线语义（可闻性修复后）：
  //   windGain       风样本支路增益（强度语义：沙暴≈0.30/微风 0.02/静音 0）
  //   windOutputGain 环境总线增益（wind 实际通往 destination 的可听路径门，
  //                  仅受 enabled 门控：未静音≈1/静音≈0——不与支路强度混同）
  //   windBus        wind 接线目标（'ambient'=环境总线，接线事实记录）
  //   masterGain     旋翼声总线（rotor-only，受 spin>0.015 门控，停机归零）
  //   ambientRMS()   环境总线实时信号电平（方法，测试按需调用——真实流动证明）
  state() {
    return {
      started: !!this.started,
      enabled: this.enabled,
      medium: this.medium,
      samples: this._sampLoaded || 0,
      sampFailed: this.sampFailed || 0,
      brass: this['sampPlay_brass'] || 0,
      thunder: this['sampPlay_thunder'] || 0,
      engineGain: (this._sampGain && this._sampGain.engine) ? this._sampGain.engine.gain.value : 0,
      windGain: (this._sampGain && this._sampGain.wind) ? this._sampGain.wind.gain.value : 0,
      windOutputGain: this.ambient ? this.ambient.gain.value : 0,
      windBus: (this._sampBus && this._sampBus.wind) || '',
      // 音乐总线遥测（路由语义修复）：musicOutputGain=配乐可听路径门（仅 enabled）、
      // padBus=pad 接线事实（'music'=音乐总线）、masterGain=旋翼总线（spin 门控）
      musicOutputGain: this.musicBus ? this.musicBus.gain.value : 0,
      padBus: (this._sampBus && this._sampBus.pad) || '',
      masterGain: this.master ? this.master.gain.value : 0,
      windLevel: this.windLevel || 0,
    };
  }

  // 环境总线实时信号电平（RMS，post-gain 探针读取）：测试用它证明风声真实
  // 流动——停机沙暴可听/静音归零/解除恢复；仅调用时采样，平时零开销
  ambientRMS() {
    if (!this.ambientProbe) return 0;
    const d = new Float32Array(this.ambientProbe.fftSize);
    this.ambientProbe.getFloatTimeDomainData(d);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return Math.sqrt(s / d.length);
  }

  // 音乐总线实时信号电平（RMS，最终闭环修复：musicProbe 读取）——停机 brass/
  // 配乐真实可闻证明；仅调用时采样
  musicRMS() {
    if (!this.musicProbe) return 0;
    const d = new Float32Array(this.musicProbe.fftSize);
    this.musicProbe.getFloatTimeDomainData(d);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return Math.sqrt(s / d.length);
  }

  _noiseSource() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this._noiseRnd() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  // 半波整流 + 平顶：把带通噪声削成"扑扑"脉冲串
  _pulseCurve() {
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = x > 0 ? Math.pow(x, 0.55) : Math.pow(-x, 3) * 0.15;
    }
    return curve;
  }

  // 程序化生成场地脉冲响应（指数衰减立体声噪声）
  _makeIR(seconds, decayK, brightness) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const noise = this._noiseRnd() * 2 - 1;
        lp += (noise - lp) * brightness;        // 亮度：低通系数
        d[i] = lp * Math.pow(1 - t, decayK);
      }
    }
    return ir;
  }

  // 场地声学切换（草地吸声闷、水面空旷亮反射长、沙漠中等偏散、停机坪轻微）
  setMedium(m) {
    this.medium = m;
    if (!this.started) return;
    const cfg = {
      dust:  { ir: [0.45, 5.0, 0.35], wet: 0.14, hiss: 900 },
      grass: { ir: [0.22, 7.0, 0.18], wet: 0.08, hiss: 700 },   // 吸声强：短而闷
      spray: { ir: [1.40, 3.2, 0.55], wet: 0.42, hiss: 1250 },  // 水面强反射：长而亮
      sand:  { ir: [0.70, 4.0, 0.28], wet: 0.22, hiss: 950 },   // 沙漠：略散
    }[m] || { ir: [0.45, 5.0, 0.35], wet: 0.14, hiss: 900 };
    this.convolver.buffer = this._makeIR(...cfg.ir);
    this.reverbGain.gain.setTargetAtTime(cfg.wet, this.ctx.currentTime, 0.3);
    this.hissBP.frequency.setTargetAtTime(cfg.hiss, this.ctx.currentTime, 0.3);
  }

  // 每帧更新：spin=转速比 0..1，wash=下洗强度（贴地轰鸣加重低频）
  update(spin, wash, dt) {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.enabled && spin > 0.015;
    const target = on ? 0.16 + 0.5 * spin * spin + wash * 0.1 : 0;
    this.master.gain.setTargetAtTime(target, t, 0.08);
    // 环境总线（可闻性修复）：仅受全局静音控制，不受旋翼转速门控——
    // 停机+未静音时环境风声路径保持开放；静音后所有最终可听输出归零
    this.ambient.gain.setTargetAtTime(this.enabled ? 1 : 0, t, 0.08);
    // 音乐总线（路由语义修复）：同环境总线，仅受 enabled 门控，不受 spin 门控
    this.musicBus.gain.setTargetAtTime(this.enabled ? 1 : 0, t, 0.08);

    // 桨叶拍击频率：4 叶 × (289 × spin) / 60 ≈ 19.3×spin Hz；2 次谐波在滤波器 Q 峰上更亮
    const bpf = 19.3 * spin * 4;               // 基频×4 叶 = 桨叶通过频率
    this.bladePeak.frequency.setTargetAtTime(Math.max(30, Math.min(bpf, 260)), t, 0.05);
    // 转速升高 → 嘶声更亮
    this.hissBP.frequency.setTargetAtTime(700 + 600 * spin + wash * 400, t, 0.1);
    // 贴地下洗：低频隆隆加重（地面反射的推力噪声）
    this.rumbleGain.gain.setTargetAtTime(0.35 + wash * 0.5, t, 0.1);
    // A1 真实样本层增益：engine 样本贴底（纯合成之上的"真实肌理"，随转速）
    this.setLoopGain('engine', on ? 0.10 + spin * 0.16 : 0, 0.15);
    // wind 样本增益与旋翼声分离（复核修复）：沙暴狂风声不依赖旋翼转速——
    //   静音(enabled=false) → 0（静音语义优先于一切，含沙暴）；
    //   旋翼运行(on) → 原混合 windG 不变（风声+转子声并存）；
    //   旋翼停 + 沙暴(windLevel>0) → windG（≈0.30 狂风，停机也响）；
    //   旋翼停 + 非沙暴 → 0.02 常驻微风底噪（既有语义保留）
    const windG = 0.04 + (this.windLevel || 0) * 0.26;
    const windTarget = !this.enabled ? 0 : (on ? windG : (this.windLevel > 0 ? windG : 0.02));
    this.setLoopGain('wind', windTarget, 0.4);
  }

  // —— 武器/事件一次性音效（机炮/爆炸优先真实录音，其余程序化合成，播完自毁）——
  // type: gun 机炮哒哒 | rocket 火箭啸声 | explo 爆炸轰(power 1/2/3 分级)
  //       hit 命中叮 | hf 地狱火低嘶 | shoot? 由 65-weapons/16-targets 回调触发
  playSfx(type, power = 1) {
    if (!this.started || !this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    try {
      if (type === 'gun' && this._playBuf(['gun1', 'gun2', 'gun3'], 0.5, 0.05, 0)) {
        // P5-G1 真实机炮录音（合成版留作兜底）
      } else if (type === 'gun') {
        // M230：低频方波闷响 60ms + 噪声爆点 40ms（625RPM 连发天然成串）
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.03);
        g.gain.setValueAtTime(0.42, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
        o.connect(g).connect(this.dry);
        o.start(t); o.stop(t + 0.06);
        const nb = this._noiseBurst(0.045, 1600);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.28, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
        nb.out.connect(ng).connect(this.dry);
        nb.src.start(t); nb.src.stop(t + 0.05);
      } else if (type === 'rocket' && this._playBuf(['rocket1', 'rocket2'], 0.42, 0.06, 0.3)) {
        // sfx2：真实火箭飞离录音（尾焰咆哮渐远）替代合成噪声扫频；保留合成的出巢闷响 + 次声推力
        this._launchThump(t, 0.42, 300, 0.06, 0.18);
      } else if (type === 'rocket') {
        // Hydra-70 真实声学（DVIDS/军演实拍频谱分析）：出巢闷响→宽频尾焰咆哮渐远
        // 真实特征：出巢 165-180dB 全频段冲击→尾焰宽频噪声主能 200-2000Hz→无任何音调成分
        // 旧实现：锯齿波下滑=游戏激光 pew 音（音调振荡器是"玩具枪"的根因）
        // 出巢"砰"：低通 300Hz 噪声 60ms（发射管推进器闷响）
        const nl = this._noiseSrc(0.06);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0.42, t);
        lg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        nl.connect(lp).connect(lg).connect(this.dry);
        nl.start(t); nl.stop(t + 0.07);
        // 尾焰宽频咆哮：带通 2600→350Hz 扫频 1.25s（燃烧冷却→频谱重心下移）
        const nb = this._noiseSrc(1.3);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
        bp.frequency.setValueAtTime(2600, t + 0.03);
        bp.frequency.exponentialRampToValueAtTime(350, t + 1.2);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.001, t);
        ng.gain.exponentialRampToValueAtTime(0.36, t + 0.04);   // 快攻（助推器点火即达峰值）
        ng.gain.exponentialRampToValueAtTime(0.001, t + 1.25);  // 慢衰减（飞远+距离衰减）
        nb.out.connect(bp).connect(ng).connect(this.dry);
        ng.connect(this.wet);                                   // 宽频尾焰送混响（战场空间感）
        nb.src.start(t); nb.src.stop(t + 1.35);
        // 次声推力：52→28Hz 正弦 0.25s（胸腔共鸣感）
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(52, t);
        o.frequency.exponentialRampToValueAtTime(28, t + 0.25);
        og.gain.setValueAtTime(0.18, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        o.connect(og).connect(this.dry);
        o.start(t); o.stop(t + 0.3);
      } else if (type === 'hf' && this._playBuf(['rocket1', 'rocket2'], 0.34, 0.04, 0.25, 1.3)) {
        // sfx2：地狱火用同一批火箭录音、放快 1.3 倍（导弹更快、尾音更短更尖）；保留弹射"砰"
        this._launchThump(t, 0.3, 350, 0.05, 0);
      } else if (type === 'hf') {
        // AGM-114 地狱火：两级发射（弹射电机弹出发射轨→主电机在安全距离点火）
        // 比火箭更短更快消失（导弹飞得更快）；宽频尾焰低通扫频（无音调成分）
        // 弹射"砰"：低通 350Hz 噪声 50ms
        const nl = this._noiseSrc(0.05);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 350;
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0.3, t);
        lg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        nl.connect(lp).connect(lg).connect(this.dry);
        nl.start(t); nl.stop(t + 0.06);
        // 主引擎尾焰：低通 2800→500Hz 扫频 0.75s（导弹加速远去→频谱能量下移+衰减）
        const nb = this._noiseSrc(0.8);
        const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass';
        lp2.frequency.setValueAtTime(2800, t + 0.02);
        lp2.frequency.exponentialRampToValueAtTime(500, t + 0.7);
        const ng2 = ctx.createGain();
        ng2.gain.setValueAtTime(0.001, t);
        ng2.gain.exponentialRampToValueAtTime(0.28, t + 0.03);
        ng2.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
        nb.out.connect(lp2).connect(ng2).connect(this.dry);
        ng2.connect(this.wet);
        nb.src.start(t); nb.src.stop(t + 0.85);
      } else if (type === 'explo' && this._playBuf(
          power >= 3 ? ['explo_l'] : power <= 1 ? ['explo_s', 'explo_s2'] : ['explo_m'],
          power >= 3 ? 1.0 : power <= 1 ? 0.55 : 0.8, 0.07, 0.35)) {
        // P5-G1 真实爆炸录音 + 保留合成次声冲击（胸腔震感，录音低频不足）
        const o = ctx.createOscillator(), og = ctx.createGain();
        const dur = 0.6 + 0.5 * power;
        o.type = 'sine';
        o.frequency.setValueAtTime(58, t);
        o.frequency.exponentialRampToValueAtTime(26, t + dur * 0.8);
        og.gain.setValueAtTime(0.35 * power, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8);
        o.connect(og).connect(this.dry);
        o.start(t); o.stop(t + dur);
      } else if (type === 'explo') {
        // 爆炸：低通噪声轰 0.6+0.5×power 秒 + 55Hz 正弦次声冲击（tier 分级音量）
        const dur = 0.6 + 0.5 * power;
        const nb = this._noiseBurst(dur, 380);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.55 + 0.2 * power, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
        nb.out.connect(ng).connect(this.dry);
        nb.out.connect(this.wet);
        nb.src.start(t); nb.src.stop(t + dur);
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(58, t);
        o.frequency.exponentialRampToValueAtTime(26, t + dur * 0.8);
        og.gain.setValueAtTime(0.5 * power, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.8);
        o.connect(og).connect(this.dry);
        o.start(t); o.stop(t + dur);
      } else if (type === 'hit') {
        // 命中叮：1300Hz 短音 45ms（打中反馈，音量克制不抢戏）
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(1300, t);
        g.gain.setValueAtTime(0.14, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
        o.connect(g).connect(this.dry);
        o.start(t); o.stop(t + 0.05);
      } else if (type === 'lock') {
        // 锁定确认：880→1100Hz 上行扫频 80ms（FPS 经典锁定反馈音）
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(880, t);
        o.frequency.exponentialRampToValueAtTime(1100, t + 0.06);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        o.connect(g).connect(this.dry);
        o.start(t); o.stop(t + 0.085);
      } else if (type === 'thunder' && this._playBuf(['thunder1', 'thunder2', 'thunder3'], 0.75 * power, 0.08, 0.4)) {
        // sfx2：真实雷声录音（3 种轮换）；远雷 power 小 → 音量小。保留合成次声（胸腔震感）
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(46, t);
        o.frequency.exponentialRampToValueAtTime(26, t + 0.5);
        og.gain.setValueAtTime(0.22 * power, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        o.connect(og).connect(this.dry);
        o.start(t); o.stop(t + 0.6);
        this['sampPlay_thunder'] = (this['sampPlay_thunder'] || 0) + 1;
      } else if (type === 'thunder') {
        // 雷声（M4 夜雷暴）：低频隆隆噪声 300→70Hz 扫频 2.4s + 40Hz 次声冲击。
        // 距离衰减由调用方（WeatherFX）传 power 控制音量；送到混响营造空间感
        const dur = 2.2 + 0.6 * power;
        const nb = this._noiseSrc(dur);
        const bp = ctx.createBiquadFilter();
        bp.type = 'lowpass';
        bp.Q.value = 0.8;
        bp.frequency.setValueAtTime(320, t);
        bp.frequency.exponentialRampToValueAtTime(70, t + dur * 0.7);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.001, t);
        ng.gain.exponentialRampToValueAtTime(0.55 * power, t + 0.05);
        ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
        nb.connect(bp).connect(ng).connect(this.dry);
        ng.connect(this.wet);
        nb.start(t); nb.stop(t + dur + 0.1);
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(46, t);
        o.frequency.exponentialRampToValueAtTime(26, t + 0.5);
        og.gain.setValueAtTime(0.22 * power, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        o.connect(og).connect(this.dry);
        o.start(t); o.stop(t + 0.6);
        this['sampPlay_thunder'] = (this['sampPlay_thunder'] || 0) + 1;
      }
    } catch (e) { /* 音效失败不静默影响主流程 */ }
  }

  // sfx2：发射闷响（低通噪声"砰"）+ 可选次声推力，录音版火箭/地狱火共用
  _launchThump(t, g0, lpHz, dur, sub) {
    const ctx = this.ctx;
    const nl = this._noiseSrc(dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpHz;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(g0, t);
    lg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    nl.connect(lp).connect(lg).connect(this.dry);
    nl.start(t); nl.stop(t + dur + 0.01);
    if (sub > 0) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(52, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.25);
      og.gain.setValueAtTime(sub, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(og).connect(this.dry);
      o.start(t); o.stop(t + 0.3);
    }
  }

  // 一次性噪声源（预接低通滤波器），供短音效使用
  _noiseBurst(seconds, lpFreq) {
    const ctx = this.ctx;
    const src = this._noiseSrc(seconds);   // opt1：噪声缓冲生成只留 _noiseSrc 一份（随机序列调用次数不变）
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lpFreq;
    src.connect(lp);
    return { src, out: lp };
  }

  // 一次性白噪声源（无滤波器预接，由调用者自由接滤波链）
  _noiseSrc(seconds) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this._noiseRnd() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
}
