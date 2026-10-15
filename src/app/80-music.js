// ============================================================
// 80-music.js — 电影配乐（Phase 13-S4）
// ============================================================
// Web Audio + 真实样本混合（约束 A1：样本只用于合成做不出来的手感——本系统
// 铜管 cue 走 brass 样本，其余全部程序化合成的零资产路线）。模式状态机：
//   idle     未启动（AudioContext 未就绪/被静音）
//   ambient  展示氛围垫乐：pad 样本循环低频垫底（0.16 增益）
//   battle   任务战斗：132BPM 鼓机（底鼓/军鼓/踩镲）+ A 小调贝斯行进，100ms
//            前瞻调度（Web Audio 标准 lookahead 节拍器）；垫乐压低让位
//   victory  任务完成胜利旋律（A 小调五声音阶上行+落点），播完自动回 ambient
// 触发点（70-app 接线）：startMission→battle / completeMission→victory /
// failMission→ambient / updateTargetHUD 击毁→brass() 铜管 / resetRange→ambient。
// 音色全部程序化（振荡器+噪声缓冲），零外部库零 CDN；battle/victory 调度
// 用 setInterval 前瞻（100ms），不依赖逐帧 update。
// ============================================================

class FilmMusic {
  constructor(audio) {
    this.audio = audio;
    this.mode = 'idle';          // idle | ambient | battle | victory
    this.brassCount = 0;         // 击毁铜管触发计数（遥测）
    this._ctx = null;
    this._bus = null;
    this._tick = null;
    this._battleOn = false;
    this._beat = 0;
    this._nextBeat = 0;
    this._victory = 0;           // 胜利旋律进行中（1 播完回 ambient）
    this.victoryAt = 0;
  }

  // 用户手势后由 70-app audioKick 调用（AudioContext 已启动才生效；幂等）
  start() {
    if (this._ctx || !this.audio || !this.audio.ctx) return;
    this._ctx = this.audio.ctx;
    // 配乐独立 bus 接 audio.musicBus（音乐总线，路由语义修复）：直达最终可听
    // 输出、仅受全局 enabled 门控、不受 spin>0.015 旋翼门控——停机默认展示态
    // ambient 配乐/战斗音乐可闻；不复用 wind ambient bus（防污染 wind 探针），
    // 也不接 rotor dry/master（停机时 master 归零会把配乐压没）
    this._bus = this._ctx.createGain();
    this._bus.gain.value = 0.85;
    this._bus.connect(this.audio.musicBus);
    if (this._battleOn) this._nextBeat = this._ctx.currentTime + 0.06;  // 防止旧时戳立刻爆发
    this._tick = setInterval(() => this._schedule(), 100);
  }

  setMode(m) {
    this.mode = m;
    if (m === 'ambient') {
      this._battleOn = false;
      if (this.audio) this.audio.setLoopGain('pad', 0.16, 0.8);
    } else if (m === 'battle') {
      this._battleOn = true;
      this._beat = 0;
      this._nextBeat = this._now() + 0.06;
      if (this.audio) this.audio.setLoopGain('pad', 0.05, 0.8);   // 战斗垫乐压低让位
    } else if (m === 'victory') {
      this._battleOn = false;
      this._victory = 1;
      this.victoryAt = this._now();
      this._playVictory();
      if (this.audio) this.audio.setLoopGain('pad', 0.10, 0.5);
    } else {   // idle / 其他
      this._battleOn = false;
      if (this.audio) this.audio.setLoopGain('pad', 0, 0.5);
    }
  }

  // 击毁铜管 cue（70-app updateTargetHUD 每击毁调用一次；样本为 A1 自合成 brass.wav）
  // 最终闭环修复（停机 brass 可闻）：走独立 musicBus（仅 enabled 门控、不受
  // spin 门控）——停机/旋翼未启动时击毁铜管仍可达扬声器
  brass() {
    this.brassCount++;
    if (this.audio) this.audio.playSample('brass', 0.9, 'music');
  }

  // 每帧驱动：胜利旋律播完自动回落 ambient（1.6s 判定窗口）
  update(dt) {
    if (this._victory && this._ctx && this._ctx.currentTime - this.victoryAt > 1.6) {
      this._victory = 0;
      this.setMode('ambient');
    }
  }

  _now() { return this._ctx ? this._ctx.currentTime : 0; }

  // 前瞻调度：把 250ms 以内到期的节拍全部排入 AudioContext 时间线
  _schedule() {
    if (!this._ctx || !this._battleOn) return;
    const ahead = this._ctx.currentTime + 0.25;
    const spb = 60 / 132;                 // 132 BPM
    while (this._nextBeat < ahead) {
      this._playBeat(this._beat, this._nextBeat);
      this._nextBeat += spb;
      this._beat = (this._beat + 1) % 16; // 4/4 × 4 小节
    }
  }

  _playBeat(b, t) {
    // 底鼓 0/4/8/12、军鼓 4/12、踩镲每拍（2/4 拍重音）
    if (b % 4 === 0) this._kick(t);
    if (b % 8 === 4) this._snare(t);
    this._hat(t, b % 4 === 2 ? 0.5 : 0.25);
    // 贝斯行进：A 小调 I–VI–VII–V（A2/F2/G2/E2），每小节根音
    if (b % 4 === 0) this._bass([110.0, 87.31, 98.0, 82.41][(b / 4) % 4 | 0], t);
  }

  _kick(t) {
    const o = this._ctx.createOscillator(), g = this._ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this._bus);
    o.start(t); o.stop(t + 0.2);
  }
  _snare(t) {
    const nb = this._noiseBuf(0.13);
    const bp = this._ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    nb.connect(bp).connect(g).connect(this._bus);
    nb.start(t); nb.stop(t + 0.13);
  }
  _hat(t, v) {
    const nb = this._noiseBuf(0.045);
    const hp = this._ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6500;
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0.20 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    nb.connect(hp).connect(g).connect(this._bus);
    nb.start(t); nb.stop(t + 0.045);
  }
  _bass(f, t) {
    const o = this._ctx.createOscillator(), g = this._ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    const lp = this._ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    o.connect(lp).connect(g).connect(this._bus);
    o.start(t); o.stop(t + 0.32);
  }
  // 胜利旋律：A 小调五声音阶（A4 C5 E5 A5 E5 A5 C6）三角波上行，末音拖长
  _playVictory() {
    if (!this._ctx) return;
    const seq = [440.0, 523.25, 659.25, 880.0, 659.25, 880.0, 1046.5];
    let t = this._ctx.currentTime + 0.05;
    for (let i = 0; i < seq.length; i++) {
      const o = this._ctx.createOscillator(), g = this._ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = seq[i];
      const d = 0.22 + (i === seq.length - 1 ? 0.5 : 0);
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.30, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(this._bus);
      o.start(t); o.stop(t + d + 0.05);
      t += 0.14;
    }
  }

  _noiseBuf(seconds) {
    const ctx = this._ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  // 只读遥测（测试/调试出口）
  state() {
    return {
      mode: this.mode,
      battleOn: this._battleOn,
      beat: this._beat,
      brass: this.brassCount,
      victory: this._victory,
      scheduled: this._battleOn && this._nextBeat > 0,
      padGain: (this.audio && this.audio._sampGain && this.audio._sampGain.pad)
        ? +this.audio._sampGain.pad.gain.value.toFixed(3) : 0,
    };
  }
}

// 经 HOST 注册工厂——70-app（低编号）不得反向引用 80 的构造器（拓扑检查
// 硬规则），经宿主槽位取用（与 HOST.bindUI/HOST.tourState 同款模式）。
HOST.makeMusic = (audio) => new FilmMusic(audio);
