// ============================================================
// 79-weather.js — 动态天气（Phase 13-M4）
// ============================================================
// 三态天气（72-uibind weather-row chip 驱动，S.weather 为状态源）：
//   none  无（默认）
//   sand  沙暴：能见度骤降（fog 密度 ×3.2 缓变）+ 狂风沙尘粒子池（InstancedMesh
//         单 draw，沿风向量高速漂移）+ 天空橙化（sky shader uSand）+ wind 样本
//         增益（A1 风声层）+ M3 体积光加成（70-app 按 S.weather 乘 1.8）
//   storm 夜雷暴：闪电随机调度（2.5~6.5s 间隔，sky shader uLflash 白闪+二次
//         小闪双脉冲），雷声延迟 0.6~2.2s（audio.playSfx('thunder')，雷距感）
// 性能预算（约束 A2）：沙尘=1 个 InstancedMesh（1 draw）、雷暴=0 draw
//（纯 shader uniform），均不触发生成/销毁（对象池原则，visible 开关）。
// ============================================================

class WeatherFX {
  constructor(renderer, W, audio) {
    this.renderer = renderer;
    this.W = W;
    this.audio = audio;
    this.mode = 'none';
    this._sand = 0;            // 沙暴强度 0..1（缓变）
    this._fogBase = null;      // 首次进入时锁定的场地基准雾密度（fogBase.d，遥测用）
    W.weatherFogMul = 1;       // 雾密度乘数——WashFX 是雾密度唯一写入者（brownout
                               // 逐帧叠加），天气只维护这个乘数，不直接写 scene.fog
    // —— 沙尘粒子池（相机周围 60u 盒内漂移的细长条，风向驱动）——
    const N = 280;
    this._dustN = N;
    const geo = new THREE.PlaneGeometry(0.12, 1.1);
    this._dustMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xd8a24a).multiplyScalar(0.72),   // 沙色（线性域调暗）
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,               // 沙尘自带雾感，不再吃场地雾（避免叠雾发灰）
    });
    this.dust = new THREE.InstancedMesh(geo, this._dustMat, N);
    this.dust.frustumCulled = false;
    this.dust.visible = false;
    this.dust.matrixAutoUpdate = false;
    this._d = new Float32Array(16 * N);   // 预分配实例矩阵
    this._dp = new Float32Array(3 * N);   // 位置
    this._dv = new Float32Array(3 * N);   // 速度
    this._dl = new Float32Array(N);       // 寿命倒计时
    for (let i = 0; i < N; i++) {
      this._spawn(i, true);
      this._dl[i] = rnd() * 2;
    }
    W.scene.add(this.dust);
    // —— 雷暴调度 ——
    this._nextFlash = 3.0;
    this._flashT = 0;          // 当前闪脉冲剩余（>0 = 亮起）
    this._flash2 = 0;          // 二次小闪计时
    this._thunderD = 0;        // 雷声延迟倒计时
    this.flashCount = 0;       // 遥测：闪电触发次数
  }

  _spawn(i, init) {
    const half = 30;
    const x = (rnd() * 2 - 1) * half;
    const y = (rnd() * 2 - 1) * 8 + 4;
    const z = (rnd() * 2 - 1) * half;
    this._dp[3 * i] = x; this._dp[3 * i + 1] = y; this._dp[3 * i + 2] = z;
    const sp = 6 + rnd() * 8;              // 狂风 6~14 u/s
    const a = rnd() * TAU;
    this._dv[3 * i] = Math.sin(a) * sp;
    this._dv[3 * i + 1] = (rnd() - 0.4) * 2.5;   // 轻微上浮
    this._dv[3 * i + 2] = Math.cos(a) * sp;
    this._dl[i] = 1.5 + rnd() * 2.5;
  }

  // 天气状态切换（唯一入口；chip/键盘/测试都走这里）
  setWeather(key) {
    if (key === this.mode) return;
    this.mode = key === 'sand' ? 'sand' : key === 'storm' ? 'storm' : 'none';
    if (this.mode === 'none') {
      // 沙暴关闭：雾乘数回 1（WashFX 下一帧自然回基准）；风增益归零；沙尘隐藏
      this.W.weatherFogMul = 1;
      if (this.audio) this.audio.setWind(0);
      this.dust.visible = false;
    } else if (this.mode === 'sand') {
      if (this.audio) this.audio.setWind(1);
      this.dust.visible = true;
      this._nextFlash = 1e9;               // 沙暴不闪
      this._flashT = 0;
    } else {
      // 雷暴：从 3s 起首次闪电，风沙不参与
      if (this.audio) this.audio.setWind(0);
      this.dust.visible = false;
      this._nextFlash = 2.5 + rnd() * 2.0;
    }
  }

  // 每帧驱动：沙暴强度缓变 → 雾乘数 / 沙尘动画 / 天空橙化；雷暴调度 → 闪电+雷声
  update(dt, time) {
    const W = this.W;
    if (!W.skyMat) return;
    const u = W.skyMat.uniforms;
    const target = this.mode === 'sand' ? 1 : 0;
    if (this._sand !== target) {
      this._sand = lerp(this._sand, target, damp(0.10, dt));
      if (Math.abs(this._sand - target) < 0.005) this._sand = target;
    }
    // 首次进入沙暴时锁定基准雾密度（遥测用；雾写入统一由 WashFX 按乘数合成）
    if (this.mode === 'sand' && this._fogBase == null && W.fogBase && W.fogBase.d > 0) {
      this._fogBase = W.fogBase.d;
    }
    W.weatherFogMul = 1 + 2.2 * this._sand;
    if (this.mode === 'sand') {
      u.uSand.value = this._sand;
      this._updateDust(dt, time);
    } else {
      u.uSand.value = 0;
    }
    // 雷暴调度
    if (this.mode === 'storm') {
      this._nextFlash -= dt;
      if (this._nextFlash <= 0 && this._flashT <= 0) {
        this._flashT = 0.16;               // 主闪脉冲
        this._flash2 = 0.07;               // 0.07s 后二次小闪
        this._thunderD = 0.6 + rnd() * 1.6; // 雷声延迟（雷距感）
        this.flashCount++;
        this._nextFlash = 2.5 + rnd() * 4.0;
      }
      if (this._flashT > 0) {
        this._flashT -= dt;
        if (this._flashT <= 0 && this._flash2 > 0) {
          this._flash2 -= dt;
          if (this._flash2 <= 0) { this._flashT = 0.10; this._flash2 = 0; }  // 二次小闪
        }
      }
      u.uLflash.value = this._flashT > 0 ? clamp(this._flashT * 6.0, 0, 1) : 0;
      // 雷声延迟到期触发（audio 未启动/静音时 playSfx 内部守卫，安全）
      if (this._thunderD > 0) {
        this._thunderD -= dt;
        if (this._thunderD <= 0) {
          if (this.audio) this.audio.playSfx('thunder', 0.7 + rnd() * 0.6);
          this._thunderD = 0;
        }
      }
    } else {
      u.uLflash.value = 0;
    }
  }

  // 沙尘粒子：相机周围盒内高速漂移，出界回卷（风速方向由 windVec 强放大，
  // 与草浪/水沫/粒子同源风向——天气是环境风的极端形态而非独立风场）
  _updateDust(dt, time) {
    const W = this.W;
    const cam = W.camera.position;
    const [wx, wz] = windVec(time);
    const wl = Math.hypot(wx, wz) || 1;
    const k = 6.0 / wl;                     // 放大到狂风（~6× 平均风速）
    const N = this._dustN;
    for (let i = 0; i < N; i++) {
      this._dl[i] -= dt;
      this._dp[3 * i] += (wx * k + this._dv[3 * i]) * dt;
      this._dp[3 * i + 1] += this._dv[3 * i + 1] * dt;
      this._dp[3 * i + 2] += (wz * k + this._dv[3 * i + 2]) * dt;
      if (this._dl[i] <= 0) this._spawn(i, false);
      // 世界位置 = 相机 + 盒内偏移（尘随镜头，永在视野内）
      const m = i * 16;
      this._d[m + 12] = cam.x + this._dp[3 * i];
      this._d[m + 13] = this._dp[3 * i + 1];
      this._d[m + 14] = cam.z + this._dp[3 * i + 2];
      this._d[m + 15] = 1;
      // 细竖翅片沿风向：平面 Y（长轴 1.1）映射到风向水平方向、X（短轴 0.12）
      // 映射到竖直（翅片厚度）、法向映射到垂直于风向的水平方向——从任何水平
      // 视角看都是完整的竖向尘条（若做成水平贴片，侧视会完全隐身成零像素）
      const ang = Math.atan2(wx * k + this._dv[3 * i], wz * k + this._dv[3 * i + 2]);
      const c = Math.cos(ang), s = Math.sin(ang);
      const scale = 1.0 + this._dl[i] * 1.4;   // 越到寿命尾越长（被风吹散的拉丝）
      this._d[m] = 0; this._d[m + 1] = 0.12 * scale; this._d[m + 2] = 0;
      this._d[m + 4] = c * 1.1; this._d[m + 5] = 0; this._d[m + 6] = s * 1.1;
      this._d[m + 8] = s; this._d[m + 9] = 0; this._d[m + 10] = -c;
    }
    this.dust.instanceMatrix.array.set(this._d);
    this.dust.instanceMatrix.needsUpdate = true;
  }

  // 只读遥测（测试/调试出口）
  state() {
    const W = this.W;
    const u = W && W.skyMat ? W.skyMat.uniforms : null;
    return {
      mode: this.mode,
      sand: +this._sand.toFixed(3),
      uSand: u ? +u.uSand.value.toFixed(3) : 0,
      uLflash: u ? +u.uLflash.value.toFixed(3) : 0,
      fogDensity: W && W.scene && W.scene.fog ? +W.scene.fog.density.toFixed(4) : 0,
      fogBase: this._fogBase != null ? +this._fogBase.toFixed(4) : null,
      dustVisible: !!this.dust.visible,
      flashCount: this.flashCount,
      thunder: this.audio ? (this.audio.state().thunder || 0) : 0,
      windLevel: this.audio ? (this.audio.state().windLevel || 0) : 0,
    };
  }
}

// 经 HOST 注册工厂——70-app（低编号）不得反向引用 79 的构造器（拓扑检查
// 硬规则），但可经宿主槽位取用（与 HOST.bindUI/HOST.tourState 同款模式）。
// 拼接序 79 在 70 之后求值，finish()（boot 异步回调内）执行时工厂已就位。
HOST.makeWeather = (renderer, W, audio) => new WeatherFX(renderer, W, audio);
