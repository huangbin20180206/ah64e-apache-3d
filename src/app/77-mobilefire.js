// ============================================================
// 77-mobilefire.js — Q1 触屏浮动操作键（手机/平板边飞边打）
// ============================================================
// 缺口：76-mobile 的摇杆只管飞行；启旋/起降/开火全在控制面板里，
// 而面板一打开摇杆就让位隐藏——手机上没法「一边飞一边开火」。
// 做法：右摇杆上方一组 3×3 浮动键（仅触屏 pointer:coarse 显示，
// 面板打开时让位，第一人称下保留），直接调用既有动作，零合成键盘事件：
//   启旋 = #btn-start 点击 · 起降 = #btn-fly 点击（含先退第一人称）
//   机炮/火箭 = 按住期间 rig.gunOn / rig.rocketOn（松手/取消/切后台即释放）
//   地狱火 = rig.launchHf · 绞车 = actHoist() · 干扰弹 = actChaff()
//   照明弹 = launchFlare() · 热成像 = setFlir 开关
// actHoist / actChaff 定义在 72-uibind（键盘 K / J 同一份逻辑）。
// 按钮文字与 73-coach 触屏提示里的按钮名逐字一致。
// ============================================================

class MobileFire {
  constructor() {
    this.el = UI('mfire');
    this._held = new Map();     // pointerId → 释放函数（按住类按键）
    const tap = (id, fn) => {
      const b = UI(id);
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('on'); fn(); });
      const off = () => b.classList.remove('on');
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    };
    const hold = (id, on, offFn) => {
      const b = UI(id);
      const rel = e => { if (!this._held.has(e.pointerId)) return; this._held.get(e.pointerId)(); this._held.delete(e.pointerId); };
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (_) {}
        on(); b.classList.add('on');
        this._held.set(e.pointerId, () => { offFn(); b.classList.remove('on'); });
      });
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('lostpointercapture', rel);
    };
    tap('mf-start', () => UI('btn-start').click());
    tap('mf-fly', () => { if (fp && fp.active) fp.exit(); UI('btn-fly').click(); });
    hold('mf-gun', () => { if (rig) rig.gunOn = true; }, () => { if (rig) rig.gunOn = false; });
    hold('mf-rk', () => { if (rig) rig.rocketOn = true; }, () => { if (rig) rig.rocketOn = false; });
    tap('mf-hf', () => { if (rig && !rig.launchHf()) toast('地狱火已打完或未挂载'); });
    tap('mf-hoist', actHoist);
    tap('mf-chaff', actChaff);
    tap('mf-flare', () => launchFlare());
    tap('mf-flir', () => { setFlir(!NIGHT.flir); UI('mf-flir').classList.toggle('lit', NIGHT.flir); });
    // 切后台/失焦：触屏不会送达配对 pointerup，主动全部释放
    const all = () => { for (const f of this._held.values()) f(); this._held.clear(); };
    addEventListener('blur', all);
    document.addEventListener('visibilitychange', () => { if (document.hidden) all(); });
  }
  state() { return { held: this._held.size, gun: !!(rig && rig.gunOn), rocket: !!(rig && rig.rocketOn) }; }
}

const mobileFire = new MobileFire();
const _mfIv = setInterval(() => {
  if (window.__dbg) { window.__dbg.mobileFire = mobileFire; clearInterval(_mfIv); }
}, 250);
