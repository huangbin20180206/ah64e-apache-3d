// ============================================================
// 48-rescue.js — 绞车救援任务（P2-3）
// 幸存者随场地生成（沙漠/草原各一处，水上/棚拍无），信标闪烁+信号烟
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

    // 幸存者低模：躯干胶囊 + 头部
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8b26a, roughness: 0.8 }));
    body.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xe0c090, roughness: 0.8 }));
    head.position.y = 1.25;
    this.g = new THREE.Group();
    this.g.add(body, head);
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
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7038 }));
    this.beacon.visible = false;
    scene.add(this.beacon);

    // 绞车绳索（细圆柱，按绳长缩放）+ 吊钩
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6),
      new THREE.MeshBasicMaterial({ color: 0x14140f }));
    this.rope.visible = false;
    scene.add(this.rope);
    this.hook = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 6, 12),
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
    this.beacon.position.set(px, 0.22, pz);
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
    this.beacon.position.set(px, 0.22, pz);
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
      this.g.position.set(hx, Math.max(by - this.ropeLen, 0.3), hz);
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
        this.g.position.set(this.hook.position.x, Math.max(by - this.ropeLen - 0.4, 0.4), this.hook.position.z);
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
