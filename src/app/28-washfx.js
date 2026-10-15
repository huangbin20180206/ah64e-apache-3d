// ============================================================
// 28-washfx.js — WashFX 总装：三层协同 + brownout 雾 + 停转滞留
// ============================================================
// [P1-A 拆迁] 本类原在 17-washfx.js 尾部。构造函数 new 了 21/23 的介质
// 类（GrassField/SpraySurfaceFX/WaterRipples/GrassDebrisFX/WashTracks/
// GrassImprint/DuneSandFX）并读 20-scene 的 ENV_PRESETS——低编号读高
// 编号属反向引用（tools/check_topology.mjs 违规项），纯搬迁到编号 28
// 后全部转为合法正向依赖。逻辑零改动。
// ============================================================


// ============================================================
// WashFX — 总装：三层协同 + brownout 雾 + 停转后的滞留
// ============================================================
class WashFX {
  constructor(scene, world) {
    this.scene = scene;
    this.W = world;
    this.medium = 'dust';
    this.strength = 0;                 // 平滑后的下洗强度
    this.sprite = makeWashSprite();

    this.parts = new WashParticles(scene, this.sprite);
    this.decal = new WashDecal(scene);
    this.grass = new GrassField(scene);
    this.sprayFx = new SpraySurfaceFX(scene);
    this.ripples = new WaterRipples(scene);   // 湖面涟漪（外传波前）
    this.debris = new GrassDebrisFX(scene);
    this.tracks = new WashTracks(scene);      // 沙漠痕迹留存（P3-⑨）
    this.imprint = new GrassImprint(scene);   // 草地压痕（压倒+碾碎的草，慢消退）
    this.duneSand = new DuneSandFX(scene, this.sprite);   // 贴地沙雾（沙丘上更剧烈）
    this._trkT = 0;                           // 痕迹盖章计时

    // 草叶回弹弹簧：下洗骤降时把"差值"灌入弹簧，草叶带惯性回摆
    this._spring = 0; this._springV = 0;
    this._prevS = 0;

    // 环境风向量（P3-⑧，update 里每帧刷新；暴露给 __dbg 验证）
    this.windX = 0; this.windZ = 0;

    // 下洗粒子受环境光照：环境预设切换时由外部调 setLighting 更新这两组色
    this._envTint = { a: 0xffffff, b: 0xffffff, k: 1 };

    this._fogAdd = 0;                  // brownout 附加雾密度（平滑）
    this._qualityEffects = 1;
    this.setMedium('dust');
  }

  setQualityEffects(scale = 1) {
    this._qualityEffects = clamp(scale, 0.25, 1);
    this.parts.setQuality(this._qualityEffects);
    this.grass.setQuality(this._qualityEffects);
    this.sprayFx.setQuality(this._qualityEffects);
    this.debris.setQuality(this._qualityEffects);
    this.duneSand.setQuality(this._qualityEffects);
  }

  // 环境预设联动：给涡环粒子乘环境色调（黄昏=暖、夜间=冷暗、棚拍=中性）
  // 合成式：介质基色 × (太阳色×强度权重 + 天光色×补光权重) —— 黄昏沙雾自然偏橙
  setLighting(P) {
    if (!P) return;
    const sun = new THREE.Color(P.sunCol).multiplyScalar(Math.min(P.sunI, 4) * 0.16);
    const sky = new THREE.Color(P.horizon).multiplyScalar(P.hemi * 0.5 + 0.18);
    const light = sun.add(sky);                       // 场景有效入射光
    const p = this.p;
    if (p) {
      const cA = new THREE.Color(p.colA).multiply(light);
      const cB = new THREE.Color(p.colB).multiply(light);
      this.parts.uniforms.uColA.value.copy(cA);
      this.parts.uniforms.uColB.value.copy(cB);
    }
    this._envLight = light;
    // 沙雾与痕迹层都跟随环境（夜间不发光）
    if (this.duneSand) this.duneSand.setLighting(light);
    const lum = light.r * 0.3 + light.g * 0.5 + light.b * 0.2;
    if (this.tracks) this.tracks.mesh.material.color.setScalar(clamp(lum * 1.9, 0.18, 1));
    if (this.imprint) this.imprint.setLighting(lum);
  }

  setMedium(m) {
    this.medium = m;
    const p = WASH[m] || WASH.dust;
    this.p = p;
    this.parts.apply(p);
    this.parts.setQuality(this._qualityEffects);
    if (this._envTint) {
      // 换介质后重新套环境色调（setLighting 会在换环境时更新 _envTint）
      this.setLighting(this.W && this.W.envKeyRef ? ENV_PRESETS[this.W.envKeyRef.v] : null);
    }
    this.decal.apply(p.dec, m === 'spray');
    this.decal.setDune(m === 'sand');          // 沙漠：刷痕贴合沙丘起伏
    this.grass.mesh.visible = m === 'grass';
    if (this.imprint) { this.imprint.clear(); this.imprint.mesh.visible = false; }
    // 沙漠痕迹层（P3-⑨）：进入与离开都清零——进入不继承上次痕迹，
    // 离开时计数与画布同步归零（验收要求：离开 desert 计数与可见性归零）
    if (this.tracks) {
      this.tracks.mesh.visible = (m === 'sand');
      this.tracks.clear();
    }
    // 离开所属场地时清空活动粒子——debris/duneSand 的 update 只在各自
    // 场地分支里调用，切走后粒子会冻结在原地永不消亡
    // （表现为沙漠上散落"切草"般的绿色草屑——草地切沙漠瞬间的残留）
    if (m !== 'grass' && this.debris) {
      this.debris.mesh.visible = false;
      this.debris.mesh.count = 0;
      for (const d of this.debris.p) d.alive = false;
    }
    if (m !== 'sand' && this.duneSand) {
      this.duneSand.clear();
    }
    if (!m.startsWith('spray') && this.sprayFx) {
      // 离开水面：残留泡沫快速熄灭（避免切场景后残影）
      for (const sp of this.sprayFx.spots) { sp.life = 0; sp.m.visible = false; }
      this.sprayFx.depress.visible = false;
      this.sprayFx.drops.visible = false;
      for (const d of this.sprayFx.dropP) d.alive = false;
      if (this.ripples) this.ripples.clear();   // 涟漪环同样离水即清
    }
    if (this.W) this.grass.syncLighting(this.W);
  }

  // spin: 转速比 0..1；alt: 离地高度 u；hx/hz: 飞机世界坐标
  update(dt, spin, alt, hx, hz, time) {
    // 下洗强度：转速平方（推力 ∝ ω²），离地约 2 倍旋翼直径后消失。
    // 上升沿快（气流建立快），下降沿慢（云团有惯性，停转后要滞留几秒）
    const raw = spin * spin * (1 - smoothstep(2.0, 13.0, alt));
    const rate = raw > this.strength ? 0.16 : 0.045;
    this.strength = lerp(this.strength, raw, damp(rate, dt));
    const s = this.strength;

    // —— 环境风（P3-⑧）：缓变阵风向量分发到各层 ——
    const [wx, wz] = windVec(time);
    this.windX = wx; this.windZ = wz;

    this.parts.update(time, s, alt, hx, hz, wx, wz);
    this.decal.update(time, s, alt, hx, hz, wx, wz);
    if (this.grass.mesh.visible) this.grass.update(time, s, alt, hx, hz, wx, wz);

    // 草叶回弹：下洗骤降时把差值灌入阻尼弹簧（草叶晃两下归位）
    if (this.medium === 'grass') {
      const drop = Math.max(0, this._prevS - s);
      if (drop > 0.05) this._springV += drop * 2.2;    // 骤降激励
      // 阻尼弹簧：k=42, c=6.5（约两个来回）
      this._springV += (-this._spring * 42 - this._springV * 6.5) * dt;
      this._spring += this._springV * dt;
      // 回摆量作为负向 wash 叠加驱动草叶反向摆动
      this.grass.update(time, s + Math.abs(this._spring) * 0.5 * Math.sign(this._springV), alt, hx, hz, wx, wz);
      this.debris.update(dt, s, hx, hz, wx, wz);
      if (this.imprint) this.imprint.update(dt, s, alt, hx, hz);
    }
    this._prevS = s;

    // 沙漠痕迹留存（P3-⑨）+ 沙脊吹沙（沙丘上扬沙比平地更剧烈）
    if (this.medium === 'sand' && this.tracks) {
      const lowAlt = 1 - smoothstep(1.5, 6.0, alt);
      if (s > 0.1 && lowAlt > 0.02 && this.tracks._acc < 2.0) {
        this._trkT += dt;
        if (this._trkT >= 0.15) {
          this._trkT = 0;
          this.tracks._acc += s * lowAlt * 0.15;
          this.tracks.stamp(hx + rnd(-0.7, 0.7), hz + rnd(-0.7, 0.7),
            3.4 + s * 4.0, 0.032 + 0.028 * s, wx, wz);
        }
      } else {
        this._trkT = 0;
      }
      this.tracks.update(dt);
      this.duneSand.update(dt, s, alt, hx, hz, wx, wz);
    }

    // brownout（2026-09-02 拉满）：尘墙吞没背景、机体保留轮廓。
    // 上升沿故意慢——尘云要 ~1.5s 才"卷"上来（地效再循环建立的过程）；
    // 下降沿快——升到 13u 以上下洗离地，悬浮沙沉降更快
    const fogT = (this.p.fog || 0) * s * 0.0128;   // 峰值≈0.049：25u 遮 77%、35u 遮 94%、
                                                    // 机体 15u 留 57% 透射（轮廓可辨）
    this._fogAdd = lerp(this._fogAdd, fogT, damp(fogT > this._fogAdd ? 0.024 : 0.10, dt));
    // 雾密度唯一写入者（Phase 13-M4）：天气只维护 W.weatherFogMul 乘数
    //（沙暴 1..3.2），brownout 在此之上叠加——避免两系统互写互踩
    if (this.W && this.W.scene.fog && this.W.fogBase) {
      this.W.scene.fog.density = this.W.fogBase.d * (this.W.weatherFogMul || 1) + this._fogAdd;
    }

    // 湖面三件套 + 涟漪：泡沫残留 / 水花实体 / 水面凹陷 / 外传波环
    if (this.medium === 'spray' && this.sprayFx) {
      this.sprayFx.update(dt, s, alt, hx, hz, time, wx, wz);
      if (this.ripples) this.ripples.update(dt, s, alt, hx, hz, wx, wz);
    }
  }
}

