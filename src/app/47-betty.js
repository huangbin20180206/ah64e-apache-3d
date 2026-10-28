// ============================================================
// 47-betty.js — Bitching Betty 语音警告（P1-3，阿帕奇标志性女声警告系统）
// 触发词（英文，与真实机载一致）：ALTITUDE 低空下降 / AMMO 弹药告罄。
// 集中式监测：update(dt) 每帧自查 FLY/rig 状态，事件带冷却防重入。
// 合成：Web Speech API（零资产零依赖），en 女声优先，缺省回落默认声。
// ============================================================
class Betty {
  constructor() {
    this.ok = 'speechSynthesis' in window;
    this.voice = null;
    this._cool = {};                 // 每词冷却表（performance.now/1000 秒）
    this._prevAlt = null;
    if (this.ok) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find(v => /en[-_]/i.test(v.lang) && /female|zira|susan|samantha|aria/i.test(v.name)) ||
                     vs.find(v => /^en/i.test(v.lang)) || null;
      };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  speak(word) {
    if (!this.ok) return;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US'; u.rate = 1.15; u.pitch = 1.12; u.volume = 0.9;
    if (this.voice) u.voice = this.voice;
    speechSynthesis.speak(u);
  }

  // 带冷却的警告触发
  warn(word, cooldown) {
    const now = performance.now() / 1000;
    if (now - (this._cool[word] || -99) < cooldown) return;
    this._cool[word] = now;
    this.speak(word);
  }

  update(dt) {
    if (!this.ok) return;
    // ALTITUDE：低空（<4u）下降中（下降率 >1.0u/s）——坠地风险警告。
    // 注意游戏下降速率刻意温和（'down' 态 1.6u/s 上限），阈值不能照抄
    // 真实机的 2.5m/s，否则正常降落永远触发不了（实测教训）。
    const alt = FLY.alt;
    if (typeof this._prevAlt === 'number' && !isNaN(alt)) {
      const vy = (alt - this._prevAlt) / Math.max(dt, 1e-4);
      if (alt < 4 && vy < -1.0 && HOST.S.running && FLY.state !== 'ground') this.warn('ALTITUDE', 8);
    }
    this._prevAlt = alt;
    // VRS / 坠落特情：涡环失速告警（PULL UP，间隔 3 秒）
    if (FLY.vrs && HOST.S && HOST.S.running) {
      this.warn('PULL UP', 3.0);
    }

    // AMMO：总弹药 < 初始 20%（gun 1200 + hf 8 ≈ 1208 → 阈值 ~242）
    if (HOST.rig && HOST.rig.gunAmmo !== undefined) {
      const total = (HOST.rig.gunAmmo || 0) + (HOST.rig.hfAmmo || 0);
      if (total < 1208 * 0.2) this.warn('AMMO', 14);
    }
  }
}

const betty = new Betty();
