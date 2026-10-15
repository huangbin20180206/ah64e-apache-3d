// ============================================================
// 48-rescue.js — 绞车救援任务（P2-3）
// 幸存者随场地生成（沙漠/草原各一处，水上/棚拍无），信标闪烁+信号烟
// P4g：幸存者为飞行服机组成员模型（挥手求救 / 吊带上举），与 AH-64E 同比例（1u≈2.27m）。
// 辅助寻找。玩法闭环：悬停对位 → K 放绞车 → 吊钩落地自动挂接 →
// 收绞车救起 → 低空返回停机坪 → 救援完成。
// 吊钩跟随机腹，随悬停移动自然摆动；K 可中途收回（幸存者原地放下）。
// ============================================================
class Rescue {
  constructor(scene) {
    this.scene = scene;
    this.ok = false;              // 本场地是否生成幸存者
    this.state = 'idle';          // idle | deploying | holding | lifting | aboard | delivered | retracting
    this.ropeLen = 0;
    this.attached = false;
    this._sway = 0;
    this.onToast = null;

    // 幸存者：被击落的机组成员（P4g 替换旧"胶囊+球"木头人）
    // 按米建模再整体缩放到模型单位（1u≈2.27m，身高约 1.85m≈0.81u，与 AH-64E 同比例）。
    // 4 个网格：躯干/腿/头盔合批 1 个 + 左右臂各 1 个（可动：地面挥手、吊起时抓吊带）+ 救援吊带 1 个。
    const SUIT = 0x6c7150, VEST = 0x45473a, BOOT = 0x2a2420, SKIN = 0xc79a74,
      HELM = 0x5a5e49, VISOR = 0x181b20, GLOVE = 0x2c2924, PATCH = 0xe0702c;
    const kb = vcKit();
    for (const sx of [-1, 1]) {
      kb.box(0.13, 0.12, 0.29, BOOT, sx * 0.11, 0.06, 0.03);            // 靴
      kb.cyl(0.066, 0.06, 0.44, 8, SUIT, sx * 0.11, 0.34, 0);           // 小腿
      kb.cyl(0.088, 0.07, 0.42, 8, SUIT, sx * 0.11, 0.76, 0);           // 大腿
      kb.box(0.07, 0.12, 0.05, VEST, sx * 0.19, 0.78, 0.04);            // 腿袋
    }
    kb.box(0.36, 0.2, 0.22, SUIT, 0, 0.99, 0);                          // 胯
    kb.box(0.38, 0.5, 0.23, SUIT, 0, 1.28, 0);                          // 躯干（飞行服）
    kb.box(0.41, 0.36, 0.27, VEST, 0, 1.33, 0);                         // 救生背心
    kb.box(0.1, 0.1, 0.04, VEST, -0.1, 1.27, 0.15);                     // 胸袋
    kb.box(0.1, 0.1, 0.04, VEST, 0.1, 1.27, 0.15);
    kb.box(0.08, 0.05, 0.02, PATCH, 0.12, 1.44, 0.145);                 // 臂章/反光片
    kb.box(0.3, 0.28, 0.1, VEST, 0, 1.3, -0.17);                        // 背后救生包
    kb.cyl(0.055, 0.06, 0.1, 8, SKIN, 0, 1.57, 0);                      // 颈
    kb.sph(0.105, SKIN, 0, 1.69, 0.01);                                 // 脸
    kb.sph(0.135, HELM, 0, 1.735, -0.015, 1, 0.92, 1.12);               // 飞行头盔
    kb.box(0.2, 0.06, 0.05, VISOR, 0, 1.71, 0.115);                     // 护目镜
    const mat = vcMat(0.85, 0.05);
    const fig = new THREE.Group();
    fig.add(new THREE.Mesh(mergeGeos(kb.list), mat));
    // 手臂：枢轴在肩部，零件沿 -Y 下垂
    const arm = (sx) => {
      const ka = vcKit();
      ka.sph(0.07, SUIT, 0, 0, 0);
      ka.cyl(0.056, 0.05, 0.3, 8, SUIT, 0, -0.16, 0);
      ka.cyl(0.048, 0.042, 0.28, 8, SUIT, 0, -0.45, 0);
      ka.sph(0.052, GLOVE, 0, -0.62, 0);
      const pv = new THREE.Group();
      pv.position.set(sx * 0.235, 1.5, 0);
      pv.add(new THREE.Mesh(mergeGeos(ka.list), mat));
      fig.add(pv);
      return pv;
    };
    this.armL = arm(-1); this.armR = arm(1);
    // 救援吊带（腋下环 + 向上连到吊钩的短带），挂接后才显示
    const ks = vcKit();
    ks.add(new THREE.TorusGeometry(0.24, 0.03, 6, 16), PATCH, 0, 1.4, 0, Math.PI / 2, 0, 0);
    ks.box(0.04, 0.5, 0.03, PATCH, 0, 1.65, 0.2);
    ks.box(0.04, 0.5, 0.03, PATCH, 0, 1.65, -0.2);
    this.strap = new THREE.Mesh(mergeGeos(ks.list), mat);
    this.strap.visible = false;
    fig.add(this.strap);
    fig.scale.setScalar(1 / 2.27 * 0.99);
    this.HANG = 1.92 / 2.27;                  // 吊钩到脚底的距离（u）
    this.g = new THREE.Group();
    this.g.add(fig);
    this.g.visible = false;
    scene.add(this.g);

    // 信号烟（远距离可见的白灰色烟柱）
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(210,195,170,0.8)');
    gr.addColorStop(1, 'rgba(210,195,170,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    this.smoke = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, opacity: 0.55 }));
    this.smoke.scale.set(2.4, 5, 1);
    this.smoke.visible = false;
    scene.add(this.smoke);

    // 信标灯（橙红闪烁，夜间/远处可见）
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7038 }));
    this.beacon.visible = false;
    scene.add(this.beacon);

    // 绞车绳索（细圆柱，按绳长缩放）+ 吊钩
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6),
      new THREE.MeshBasicMaterial({ color: 0x14140f }));
    this.rope.visible = false;
    scene.add(this.rope);
    this.hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 6, 12),
      new THREE.MeshBasicMaterial({ color: 0x2a2a26 }));
    this.hook.visible = false;
    scene.add(this.hook);
  }

  // 场地切换（Phase 0-0.3 跨地形状态规则）：
  //   idle                     → 有效地形重新生成幸存者；无效地形隐藏
  //   deploying/holding/lifting/retracting → 安全取消（绳/钩隐藏，状态复位）；
  //           有效地形随即重新生成幸存者，无效地形保持隐藏
  //   aboard                   → 保留"已救起待送回"（任何场地——幸存者在机上
  //           不在地面，切换不可能把机内的人取消；返回停机坪低空悬停即可送达）
  //   delivered                → 保持隐藏，切任何场地都不复活（本局终态）
  //   water/pad                → 无地面幸存者；中止未完成的地面绞车操作
  setTerrain(key) {
    const has = (key === 'desert' || key === 'grass');
    this.ok = has;
    // aboard：幸存者已在机上——任何场地切换都不在地面重新生成幸存者/烟/信标
    if (this.state === 'aboard') {
      this.smoke.visible = this.beacon.visible = false;
      return;
    }
    // delivered：已送达——任何切换都不复活地面幸存者
    if (this.state === 'delivered') {
      this.g.visible = this.smoke.visible = this.beacon.visible = false;
      return;
    }
    if (!has) {
      // 无效地形（water/pad）：无地面幸存者，安全取消未完成的地面绞车操作
      this._forceIdle();
      this.g.visible = this.smoke.visible = this.beacon.visible = false;
      return;
    }
    // idle 或绞车进行中（有效地形）：安全取消绞车操作，在新地形重新生成幸存者
    const wasBusy = this.state !== 'idle';
    this.state = 'idle';
    this.attached = false;
    this.ropeLen = 0;
    this.hook.visible = this.rope.visible = false;
    const px = key === 'desert' ? 26 : 22, pz = key === 'desert' ? -14 : -10;
    this._home = { x: px, z: pz };
    this.g.position.set(px, 0, pz);
    this.smoke.position.set(px, 2.4, pz);
    this.beacon.position.set(px + 0.45, 0.07, pz + 0.3);   // 地面频闪灯放在人身旁，不挡人
    this.g.visible = this.smoke.visible = this.beacon.visible = true;
    if (wasBusy && this.onToast) this.onToast('场地切换——绞车操作已取消，幸存者已重新定位');
  }

  _forceIdle() {
    this.state = 'idle';
    this.ropeLen = 0;
    this.attached = false;
    this.hook.visible = this.rope.visible = false;
  }

  // 最终闭环修复（救援状态跨任务泄漏）：新任务轮次入口——与 setTerrain 的
  // 同局切地形语义不同，resetRound 无条件清除终态（delivered/aboard/绳索/
  // 附着）并按当前地形重新生成幸存者。startMission()/retry 调用；
  // setTerrain() 保持"同一局切换地形"的既有语义（aboard 保留、delivered 终态）。
  resetRound(key) {
    this.state = 'idle';
    this.attached = false;
    this.ropeLen = 0;
    this.hook.visible = this.rope.visible = false;
    const has = (key === 'desert' || key === 'grass');
    this.ok = has;
    if (!has) {
      this.g.visible = this.smoke.visible = this.beacon.visible = false;
      return;
    }
    const px = key === 'desert' ? 26 : 22, pz = key === 'desert' ? -14 : -10;
    this._home = { x: px, z: pz };
    this.g.position.set(px, 0, pz);
    this.smoke.position.set(px, 2.4, pz);
    this.beacon.position.set(px + 0.45, 0.07, pz + 0.3);   // 地面频闪灯放在人身旁，不挡人
    this.g.visible = this.smoke.visible = this.beacon.visible = true;
  }

  // K 键：放/收绞车（悬停 2~30u——绳长自动延伸到地面，悬停高度即标准悬停 14u 也可作业）
  // P7：速度受控作业窗口——直升机需低速悬停（speed ≤ 3u/s）才可放绞车，
  // 飞行/平移中放缆会让吊钩拖拽失效（战术决策：先减速悬停再作业）。
  toggle(heliPos) {
    if (!this.ok || !heliPos) return;
    if (this.state === 'idle') {
      if (heliPos.y < 2 || heliPos.y > 30) {
        if (this.onToast) this.onToast('绞车作业高度 2~30u，请调整悬停高度');
        return;
      }
      // speed 由 70-app loop 每帧派生（FPV 前向/侧飞合成；环绕平移 7u/s）
      if ((this.speed || 0) > 3) {
        if (this.onToast) this.onToast('飞行中无法放绞车——请减速悬停后再试');
        return;
      }
      this.state = 'deploying';
      this.ropeLen = 0.2;
      this.hook.visible = this.rope.visible = true;
      if (this.onToast) this.onToast('绞车放出——悬停于幸存者上方');
    } else if (this.state === 'deploying' || this.state === 'holding') {
      this.state = 'retracting';
      if (this.onToast) this.onToast('绞车收回');
    }
  }

  update(dt, heliPos) {
    if (!this.ok && this.state === 'idle') { this.hook.visible = this.rope.visible = false; return; }
    this._sway = (this._sway || 0) + dt;
    // 机腹吊点
    const bx = heliPos.x, by = heliPos.y - 0.9, bz = heliPos.z;

    if (this.state === 'deploying' || this.state === 'holding') {
      const target = Math.max(0.2, by - 0.25);          // 吊钩落至离地 ~0.25
      this.ropeLen = Math.min(this.ropeLen + 3 * dt, target);
      // 吊钩贴地后：幸存者在 2u 内 → 自动挂接
      const hx = bx + Math.sin(this._sway * 1.4) * Math.min(0.35, this.ropeLen * 0.05);
      const hz = bz + Math.cos(this._sway * 1.4) * Math.min(0.35, this.ropeLen * 0.05);
      const dx = hx - this._home.x, dz = hz - this._home.z;
      // 挂接两条件缺一不可：①绳放到底（钩贴地）②幸存者在 2u 内——
      // 否则部署第一帧（钩还在半空）就会因水平距离满足而瞬间挂接
      if (this.ropeLen >= target - 0.01 && Math.hypot(dx, dz) < 2.0 && this.attached === false) {
        this.attached = true;
        this.state = 'lifting';
        if (this.onToast) this.onToast('幸存者已挂接——收绞车');
      } else if (this.ropeLen >= target - 0.01) {
        this.state = 'holding';                         // 绳放到底，等待对位
      }
    } else if (this.state === 'lifting') {
      this.ropeLen = Math.max(this.ropeLen - 2.2 * dt, 0.35);
      if (this.ropeLen <= 0.36) {
        this.state = 'aboard';
        this.attached = false;
        this.g.visible = false;              // 幸存者进机内（不再显示地面模型）
        if (this.onToast) this.onToast('幸存者已救起——低空返回停机坪');
      }
      // 幸存者随吊钩移动
      const hx = bx + Math.sin(this._sway * 1.3) * Math.min(0.3, this.ropeLen * 0.04);
      const hz = bz + Math.cos(this._sway * 1.3) * Math.min(0.3, this.ropeLen * 0.04);
      this.g.position.set(hx, Math.max(by - this.ropeLen - this.HANG, 0), hz);
    } else if (this.state === 'retracting') {
      this.ropeLen = Math.max(this.ropeLen - 3 * dt, 0);
      if (this.ropeLen <= 0) { this._forceIdle(); }
    } else if (this.state === 'aboard') {
      // 送回停机坪：低空（<4u）悬停于坪心 8u 内 → 完成
      const d = Math.hypot(heliPos.x, heliPos.z);
      if (d < 8 && heliPos.y < 4) {
        this.state = 'delivered';
        this.g.visible = this.smoke.visible = this.beacon.visible = false;
        this.hook.visible = this.rope.visible = false;
        if (this.onToast) this.onToast('幸存者已送抵医疗点——救援任务完成');
      }
    } else if (this.state === 'delivered') {
      return;                                            // 本场救援已完成
    }

    // 绳/钩视觉跟随（deploying/holding/lifting/retracting）
    if (this.state !== 'idle' && this.state !== 'delivered') {
      this.rope.visible = this.hook.visible = true;
      const len = Math.max(this.ropeLen, 0.05);
      this.rope.scale.set(1, len, 1);
      this.rope.position.set(bx, by - len / 2, bz);
      this.hook.position.set(bx + Math.sin(this._sway * 1.4) * Math.min(0.3, this.ropeLen * 0.04),
        by - this.ropeLen, bz + Math.cos(this._sway * 1.4) * Math.min(0.3, this.ropeLen * 0.04));
      // 挂接后幸存者跟随吊钩
      if (this.attached) {
        this.g.position.set(this.hook.position.x, Math.max(by - this.ropeLen - this.HANG, 0), this.hook.position.z);
      }
    }
    // 姿态：地面上面朝直升机挥手求救；挂上吊带后双臂上举抓带、吊带显示
    if (this.g.visible) {
      this.strap.visible = this.attached;
      if (this.attached) {
        this.armL.rotation.set(0, 0, -2.75); this.armR.rotation.set(0, 0, 2.75);
        this.g.rotation.y += dt * 0.6;       // 吊在绳上缓慢自转
      } else {
        this.g.rotation.y = Math.atan2(heliPos.x - this.g.position.x, heliPos.z - this.g.position.z);
        this.armL.rotation.set(0, 0, -0.12);
        this.armR.rotation.set(0, 0, 2.55 + 0.4 * Math.sin(this._sway * 5));
      }
    }
    // 信号烟上升 + 信标闪烁（幸存者在场且未救起时）
    if (this.smoke.visible) {
      this.smoke.position.y = 2.4 + Math.sin(this._sway * 0.8) * 0.5;
      this.smoke.material.opacity = 0.42 + 0.16 * Math.sin(this._sway * 1.1);
      this.beacon.material.color.setHex(Math.sin(this._sway * 4) > 0 ? 0xff7038 : 0x6b2c14);
    }
  }
}
