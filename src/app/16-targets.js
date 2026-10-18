// ============================================================
// 16-targets.js — 演示攻击靶标系统
// 3 类靶标 + 环形布阵 + 命中接口 + 摧毁动画（爆炸/烟/碎片/残骸）+ 重生
// 批 E（2026-10-12）拆分：建模/换壳/合批 → 16-targetmodels.js；阵地布景 → 16-targetscenery.js
// ============================================================

// ---------- 靶场管理 ----------
// Phase 19 性能审计 A5：nearestAhead 每次调用复用模块级 scratch（被机炮每发
// 与火箭/地狱火发射路径调用，连发时 ~10 次/s）——单线程同步顺序使用无重入
const _naTo = new THREE.Vector3();

class TargetRange {
  constructor(scene) {
    this.scene = scene;
    this.targets = [];        // { group, type, hp, hp0, radius, pos, alive, dead }
    this.onHit = null;        // 击毁回调（app 注入，刷 HUD）
    this.onHitFx = null;      // 受击闪烁回调（FPV 十字线命中标记）
    this.onSfx = null;        // 音效回调（命中叮）
    this.enabled = true;
    this._debris = [];        // 摧毁动画中的碎片
    this._fx = [];            // 残留特效计时
    // 敌方反击（P2-1）：基地轻武器曳光池 + 机体受损烟 + 命中计数
    this._aaTracers = [];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 1.6),
        new THREE.MeshBasicMaterial({ color: 0xffb054, transparent: true, opacity: 0.95,
          blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this._aaTracers.push({ m, dir: new THREE.Vector3(), v: 40, t: 0, life: 0, hit: false });
    }
    // 玩法批 B1（2026-10-09）：连锁殉爆队列（旧单槽 _fuelBoom 同帧多桶会互相覆盖，
    // 改数组）+ 基地警报（任务进行中基地首次受创 → 1.6s 后拉响警报、车辆疏散）
    this._fuelBooms = [];
    this._alert = false;
    this._alertT = null;
    this.onAlert = null;      // 警报回调（app 注入：toast/HUD）
    // 玩法批 C（2026-10-12）：城镇地图（16-town TownDistrict，由 70-app 构造注入；
    // null/未激活时以下所有 town 分支短路——非城镇局逐位不变）
    this.town = null;
    // 玩法批 D（2026-10-12）：峡谷地图（16-valley CanyonRun，同样由 70-app 注入；
    // null/未激活时所有 canyon 分支短路）
    this.canyon = null;
    // P3 训练关（2026-10-13）：passive=靶场不还击（AA/警报关闭）；benched 目标=本局不上场
    //（alive=false+隐藏，不计入 totalCount）。reset() 一律复原——非训练局逐位不变。
    this.passive = false;
    // P3c 关卡布场：_layout=本局按关卡重排了目标（AA 按射手距离、不走基地警报）；aaRateMul=关卡威胁倍率
    this._layout = false; this.aaRateMul = 1;
    this._aaCool = 3;         // 首发冷却（起飞爬升后再开火）
    this._heliDmg = 0;        // 机体累积损伤（受损分级用）
    // P8：威胁状态（0-3：无/低/中/高）——由敌方反击开火/命中派生，供 HUD 与受损后果
    this._threat = 0;
    this._threatSrc = null;   // 最近威胁来源目标（direction 指示用）
    this._threatHitFlash = 0; // 受击闪白计时（HUD/音效反馈）
    // 受损烟（损伤 ≥4 后从机体尾部冒出，随损伤加深变浓变大）
    const dmgCv = document.createElement('canvas');
    dmgCv.width = dmgCv.height = 64;
    const dctx = dmgCv.getContext('2d');
    const dg = dctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    dg.addColorStop(0, 'rgba(40,38,36,0.9)');
    dg.addColorStop(1, 'rgba(40,38,36,0)');
    dctx.fillStyle = dg; dctx.fillRect(0, 0, 64, 64);
    this._dmgSmoke = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(dmgCv), transparent: true, depthWrite: false, opacity: 0 }));
    this._dmgSmoke.scale.set(1.5, 1.5, 1);
    scene.add(this._dmgSmoke);
    this.build();
    // AI 高模渐进替换（GLB 就位后换壳；程序化模型作为加载期兜底）
    loadTargetModels(this.scene).then(models => {
      for (const t of this.targets) {
        if (models[targetModelKey(t)]) applyModelToTarget(t, models[targetModelKey(t)]);
      }
    });
  }

  // 军事基地布阵（2026-09-02 用户需求）：靶标从环形阵列改为远处一座（位置见 05-config BASE_C，2026-10-15 由 42u 挪到 75u）
  // 有组织的基地——装甲排迎敌弧、车辆停放线、油料区各自成区；直升机
  // "起飞→搜索→接近→锁定→攻击→摧毁"的叙事由此展开。
  // 基地扇区（|方位角|<~25°）在 duneFarH 中保持平地（远景沙丘环让位）。
  build() {
    // 清场
    for (const t of this.targets) this.scene.remove(t.group);
    this.targets.length = 0;
    const BC = { x: BASE_C.x, z: BASE_C.z };            // 基地中心（机头 +Z 正前方，05-config BASE_C）
    const layout = {
      tank:   [[0, -7], [-6.5, -4], [6.5, -4]],        // 装甲排：迎敌弧形
      truck:  [[-3, 5], [2, 5.5], [7, 5], [12, 4.5]],  // 车辆停放线
      barrel: [[-9, -3], [-7, 1], [-11, 0]],           // 油料区
    };
    for (const [type, def] of Object.entries(TARGET_TYPES)) {
      const spots = layout[type];
      spots.forEach(([ox, oz], si) => {
        const { group, hp, radius, label } = def.make();
        const jx = (rnd() - 0.5) * 1.2, jz = (rnd() - 0.5) * 1.2;   // 有机散布
        group.position.set(BC.x + ox + jx, 0, BC.z + oz + jz);
        // 朝向来袭方向（原点）。P31-C2 戒备姿态：±0.25rad 有机偏转收紧为
        // ±0.12rad 小扇形——炮向统一压向来袭走廊，弧形列阵更有"整队待命"感
        group.rotation.y = Math.atan2(-group.position.x, -group.position.z) + (rnd() - 0.5) * 0.24;
        group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(group);
        // 动目标：卡车首车绕圈巡逻、坦克首车射线折返（用户需求"搞几个动的"）
        let mov = null;
        if (type === 'truck' && si === 0) {
          mov = { kind: 'circle', cx: group.position.x, cz: group.position.z, r: 2.6, w: 0.55, ph: rnd(TAU) };
        } else if (type === 'tank' && si === 0) {
          mov = { kind: 'line', cx: group.position.x, cz: group.position.z, a: group.rotation.y, half: 2.4, v: 1.4, s: 0 };
        }
        // 2026-10-18：同类按序号轮换变体壳（16-targetmodels TARGET_VARIANTS；只换外观与名称）
        const mdl = pickVariant(type, si);
        this.targets.push({
          group, type, mdl, hp, hp0: hp, radius, label: mdl ? VARIANT_LABEL[mdl] : label, mov,
          pos: group.position.clone(), alive: true,
          // B2 警报疏散：初始位姿快照（reset 时疏散车辆归位）
          home: { x: group.position.x, z: group.position.z, ry: group.rotation.y, mov },
        });
      });
    }
    // PERF-AUDIT C2：程序化兜底态同样合批（GLB 就位换壳时会清空重建再合并，
    // 两次合并幂等）；barrel 无 GLB，合批后常驻 ~4 mesh/个
    for (const t of this.targets) mergeTargetStatics(t);
    this.baseCenter = new THREE.Vector3(BC.x, 0, BC.z);
    // B2 疏散环路（BC 相对坐标，顺时针 B→C→D→A）：后方停放线背后 z=+8.5 起步，
    // 东侧 x=+17 让开防空车(12,-6)/探照灯(14,8)，前沿 z=-13 让开折返坦克
    //（扫掠到 BC-11.4），西侧 x=-3 让开坦克(-6.5,-4) 与油料区。全程在
    // duneFarH 平地走廊（方位角 <0.62）内，车轮恒贴 y=0。
    this._evacLoop = [[17, 8.5], [17, -13], [-3, -13], [-3, 8.5]]
      .map(([x, z]) => [BC.x + x, BC.z + z]);
    this._evacRoadZ = BC.z + 8.5;
    // P31-B 军事场景真实化：工事/沙袋/围堰/车辙/警戒线（布阵坐标联动，
    // 全 merge 仅 +2 draw；显隐随 enabled 每帧派生——湖面自动隐藏）
    this.buildScenery(BC, layout);
    // P31-C1 地面渐进损伤：每目标一枚损伤烟 Sprite（未损 visible=false 保 0
    // draw；hp 唯一真源纯派生——reset 自动熄灭）。贴图复用机体受损烟画布。
    this._tgtSmokes = [];
    const dmgAnchors = { tank: 2.05, truck: 1.55, barrel: 0.75 };
    const dmgScales = { tank: 3.0, truck: 2.4, barrel: 1.6 };
    for (const t of this.targets) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._dmgSmoke.material.map, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false;
      sp.renderOrder = 3;
      this.scene.add(sp);
      this._tgtSmokes.push({ t, sp, ph: rnd(TAU), y: dmgAnchors[t.type], s0: dmgScales[t.type] });
    }
  }

  // 阵地布景：实现见 16-targetscenery.js（批 E 拆分）
  buildScenery(BC, layout) { buildRangeScenery(this, BC, layout); }

  // 找机头方向锥角内最近的存活靶标（供武器瞄准）
  // heliPos: 直升机世界坐标；nose: 机头方向单位向量；coneDeg: 锥角
  // prefer: 优先瞄准的靶标类型数组（武器-目标匹配，无匹配再退回任意）
  nearestAhead(heliPos, nose, coneDeg = 40, prefer = null) {
    if (!this.enabled) return null;      // 靶场关闭（如湖面场地）时不提供瞄准
    let best = null, bestD = 1e9;
    let bestPref = null, bestPrefD = 1e9;
    const to = _naTo;
    for (const t of this.targets) {
      if (!t.alive) continue;
      to.set(t.pos.x, 0.9, t.pos.z).sub(heliPos);
      const d = to.length();
      to.normalize();
      if (to.dot(nose) <= Math.cos(coneDeg * DEG)) continue;
      // 玩法批 C：楼后目标拿不到视线（锁定框/半自动瞄准/地狱火锁定一致）
      if (this.town && this.town.active &&
        this.town.occluded(heliPos.x, heliPos.y, heliPos.z, t.pos.x, 0.9, t.pos.z)) continue;
      // 玩法批 D：岩壁/台地后的目标同样拿不到视线
      if (this.canyon && this.canyon.active &&
        this.canyon.occluded(heliPos.x, heliPos.y, heliPos.z, t.pos.x, 0.9, t.pos.z)) continue;
      const isPref = prefer && prefer.includes(t.type);
      if (isPref ? d < bestPrefD : d < bestD) {
        if (isPref) { bestPref = t; bestPrefD = d; }
        else { best = t; bestD = d; }
      }
    }
    return bestPref || best;
  }

  // 命中检测：武器世界坐标 -> 距离最近存活靶标
  // 返回被打中的 target（或 null）；威力分级（机炮 1 / 火箭 2 / 地狱火 3）
  // 会传给 destroy 以匹配对应毁伤特效。
  // 判定余量 +0.9：30mm HEI 为高爆近炸弹，近失破片也有杀伤——
  // 旧值 +0.4 配合半瞄准散布导致机炮对地几乎打不中（实测调优）
  hitTest(worldPos, power) {
    if (!this.enabled) return null;
    // 玩法批 C：建筑是实体掩体——弹丸进入楼体即被吃掉（不计命中率、不触发
    // 命中叮），火箭/地狱火在墙面爆炸并溅射周边（楼后伏兵被波及）
    if (this.town && this.town.active) {
      const b = this.town.hitBuilding(worldPos, power);
      if (b) {
        if (power >= 2) {
          const R = power >= 3 ? 2.8 : 1.6, pw = power >= 3 ? 1.2 : 0.6;
          this.splash(worldPos.x, worldPos.z, R, pw, null, true);
          this.town.splash(worldPos.x, worldPos.z, R, pw, b);
        }
        return b;
      }
    }
    // 玩法批 D：崖顶雷达站被直接命中 / 弹丸钻进岩体被吃掉
    if (this.canyon && this.canyon.active) {
      const c = this.canyon.hitStruct(worldPos, power);
      if (c) {
        if (power >= 2) {
          const R = power >= 3 ? 2.8 : 1.6, pw = power >= 3 ? 1.2 : 0.6;
          this.splash(worldPos.x, worldPos.z, R, pw, null, true);
          if (c.type !== 'radar_site') this.canyon.splash(worldPos.x, worldPos.z, R, pw);
        }
        if (c.type === 'radar_site') {
          this._hitPow = power;                   // P5-G4 战报：命中来自哪种武器（1 机炮 / 2 火箭 / 3 地狱火）
          if (this.onHitFx) this.onHitFx();
          if (this.onSfx) this.onSfx('hit');
        }
        return c;
      }
    }
    let best = null, bestD = 1e9;
    for (const t of this.targets) {
      if (!t.alive) continue;
      const d = Math.hypot(worldPos.x - t.pos.x, (worldPos.y - 1.0) * 0.6, worldPos.z - t.pos.z);
      if (d < t.radius + 0.9 && d < bestD) { best = t; bestD = d; }
    }
    if (!best) return null;
    best.hp -= this._effDamage(power);
    this._hitPow = power;                        // P5-G4 战报：武器分类命中
    if (this.onHitFx) this.onHitFx();            // FPV 命中标记（击毁/受击都闪）
    if (this.onSfx) this.onSfx('hit');           // 命中叮（受击/击毁都响）
    if (best.hp <= 0) this.destroy(best, power);
    else this.flashHit(best);
    // B1 溅射：地狱火（威力 3）近炸破片波及周边——紧密停放的车辆会被连带
    if (power >= 3) this.splash(worldPos.x, worldPos.z, 2.8, 1.5, best);
    return best;
  }

  // B1 溅射/殉爆伤害：半径 R 内存活目标按距离衰减扣血（边缘保底 40%）。
  // 不触发 onHitFx（不计命中率——那是玩家射击精度，不是连锁收益）；
  // 击毁的目标打 _chain 标记供 HUD 播报"连锁殉爆"。返回连带击毁数。
  splash(x, z, R, power, exclude = null, noBuild = false) {
    if (!this.enabled) return 0;
    // 玩法批 C：爆炸/殉爆同样波及城镇建筑（noBuild：调用方已单独结算建筑）
    if (!noBuild && this.town && this.town.active) this.town.splash(x, z, R, power);
    if (!noBuild && this.canyon && this.canyon.active) this.canyon.splash(x, z, R, power);
    let n = 0;
    for (const t of this.targets) {
      if (!t.alive || t === exclude) continue;
      const d = Math.max(0, Math.hypot(t.pos.x - x, t.pos.z - z) - t.radius * 0.5);
      if (d > R) continue;
      t.hp -= this._effDamage(power * (1 - 0.6 * d / R));
      if (t.hp <= 1e-9) { t._chain = true; this.destroy(t, 2); n++; }
      else this.flashHit(t);
    }
    return n;
  }

  // S1 目标抗打击：有效损伤 = 武器威力 / 难度抗打击系数（veteran 更耐打、rookie 更脆）。
  // 只作用于本环节对目标 HP 的扣减；explosion 特效仍按原始 power 分档（不改弹道/伤害数值
  // ——规格 §四边界）。系数经 HOST.arcade 读任务快照难度；无任务时回退 standard ×1（零变化）。
  _effDamage(power) {
    const arcMod = HOST.arcade;
    const res = (arcMod && arcMod.targetResMul()) || 1;
    return power / res;
  }

  // 受击闪一下（未击毁）
  flashHit(t) {
    t.group.traverse(o => {
      if (o.isMesh && o.material && o.material.emissive) {
        const m = o.material;
        if (!m.userData._bk) m.userData._bk = m.emissive.getHex();
        m.emissive.setHex(0x442200);
        m.emissiveIntensity = 1;
        setTimeout(() => { m.emissive.setHex(m.userData._bk); m.needsUpdate = true; }, 110);
      }
    });
  }

  // 击毁：原体隐藏 + 按武器威力分档爆炸 + 焦黑残骸 + 残骸燃烧
  // 油桶特殊：燃料蒸气延迟 0.5s 二次殉爆（大威力），残骸燃烧最久
  destroy(t, power = 2) {
    t.alive = false;
    t.group.visible = false;
    const p = t.pos;
    // 爆炸粒子交给 WeaponRig 的 puff 池（通过全局 rig 引用），威力分档
    if (window.__rigFx) window.__rigFx.explosion(p.x, 0.8, p.z, power);
    // 油桶：延迟殉爆（燃料蒸气二次爆炸）
    // B1：入队而非覆盖——连锁中多个油桶各自殉爆，每次殉爆再波及半径 4.2u
    if (t.type === 'barrel') {
      this._fuelBooms.push({ t: 0.5, x: p.x, y: 0.8, z: p.z });
    }
    // 残骸燃烧时长：油桶（燃料）最久 > 卡车 > 装甲车
    t.burn = t.type === 'barrel' ? 16 : t.type === 'truck' ? 9 : 5;
    t._smk = 0;
    // P5-G1 真实残骸：原车烧焦壳 + 碎片 + 焦痕（16-targetmodels makeWreck）
    const wreck = makeWreck(t);
    t.burn0 = t.burn;
    this.scene.add(wreck);
    t.wreck = wreck;
    if (this.onHit) this.onHit(t);
  }

  // 全部重生
  reset() {
    this._fuelBooms.length = 0;
    // B2：解除警报，疏散车辆回到原车位（原巡逻目标保留各自巡逻定义）
    this._alert = false; this._alertT = null;
    for (const t of this.targets) {
      if (t.turret) t.turret.rotation.y = 0;   // ASSETS3 炮塔回正
      if (!t.home) continue;
      t.mov = t.home.mov;
      if (!t.mov) {
        t.group.position.set(t.home.x, 0, t.home.z);
        t.group.rotation.y = t.home.ry;
        t.pos.copy(t.group.position);
      }
    }
    // 敌方反击状态复位（P2-1 + P8 威胁）
    this.passive = false; this._layout = false; this.aaRateMul = 1;
    this._heliDmg = 0; this._aaCool = 3; this._aaDmgMul = 1;
    this._threat = 0; this._threatSrc = null; this._threatHitFlash = 0;
    if (this._dmgSmoke) this._dmgSmoke.visible = false;
    for (const tr of this._aaTracers) tr.m.visible = false;
    for (const t of this.targets) {
      if (t.wreck) {
        this.scene.remove(t.wreck);
        disposeObject3D(t.wreck);
        t.wreck = null;
      }
      t.hp = t.hp0;
      t.alive = true;
      t.benched = false;
      t.group.visible = true;
    }
    // 玩法批 C：城镇建筑复原 + 伏兵回藏身点
    if (this.town && this.town.active) this.town.reset();
    // 玩法批 D：峡谷伏兵/雷达站复原，直升机待放回南端
    if (this.canyon && this.canyon.active) this.canyon.reset();
    if (this.onHit) this.onHit(null);
  }

  get aliveCount() { return this.targets.reduce((n, t) => n + (t.alive ? 1 : 0), 0); }
  get totalCount() { return this.targets.reduce((n, t) => n + (t.benched ? 0 : 1), 0); }

  // P3 训练关布场（reset 之后调用）：kind = 'none'（全部下场）| 'static6'（4 卡车 + 2 油桶，
  // 全静止）| 'tanks3'（只留 3 辆坦克，全部折返巡逻）。一律 passive（不还击）。
  applyTraining(kind) {
    this.passive = true;
    let barrels = 0;
    for (const t of this.targets) {
      let keep = false;
      if (kind === 'static6') keep = t.type === 'truck' || (t.type === 'barrel' && barrels++ < 2);
      else if (kind === 'tanks3') keep = t.type === 'tank';
      if (!keep) { t.benched = true; t.alive = false; t.group.visible = false; continue; }
      if (kind === 'static6') {
        t.mov = null;
        t.group.position.set(t.home.x, 0, t.home.z); t.group.rotation.y = t.home.ry; t.pos.copy(t.group.position);
      } else if (kind === 'tanks3') {
        const i = this.targets.filter(x => x.type === 'tank').indexOf(t);
        t.mov = { kind: 'line', cx: t.home.x, cz: t.home.z, a: t.home.ry + (i - 1) * 0.6, half: 4.2, v: 1.5 + i * 0.25, s: i * 1.7 };
      }
    }
    if (this.onHit) this.onHit(null);
  }

  // P3c：关卡布场——units=[{type,x,z,ry?,mov?}] 按类型顺序认领现有目标（坦克 3/卡车 4/油桶 3），
  // 没认领到的本局下场（benched）。mov：circle{r,w,ph,cx?,cz?} / line{a,half,v} / path{loop,vmax,wait}。
  // 只改本局位姿与巡逻，不改 home——reset() 照旧归位到基地布阵。
  applyLayout(units) {
    const used = new Set();
    for (const u of units) {
      const t = this.targets.find(x => x.type === u.type && !used.has(x));
      if (!t) continue;
      used.add(t);
      t.group.position.set(u.x, 0, u.z);
      t.group.rotation.y = u.ry != null ? u.ry : Math.atan2(-u.x, -u.z);
      t.pos.copy(t.group.position);
      const m = u.mov;
      if (!m) t.mov = null;
      else if (m.kind === 'circle') t.mov = { kind: 'circle', cx: m.cx != null ? m.cx : u.x, cz: m.cz != null ? m.cz : u.z, r: m.r, w: m.w, ph: m.ph || 0 };
      else if (m.kind === 'line') t.mov = { kind: 'line', cx: u.x, cz: u.z, a: m.a, half: m.half, v: m.v, s: m.s || 0 };
      else if (m.kind === 'path') t.mov = { kind: 'path', entry: [u.x, u.z], loop: m.loop, i: -1, v: 0, vmax: m.vmax || 2.2, dust: rnd(0.14), wait: m.wait || 0 };
    }
    for (const t of this.targets) {
      if (used.has(t)) continue;
      t.benched = true; t.alive = false; t.group.visible = false;
    }
    this._layout = true;
    if (this.onHit) this.onHit(null);
  }

  // 每帧：油桶延迟殉爆 + 残骸燃烧（烟柱 + 火舌闪烁，按类型持续秒数）
  update(dt, heliPos, m = null) {
    // 敌方反击（P2-1）：基地轻武器间歇还击（曳光+散布），命中累积机体损伤。
    // 开火条件：靶场启用 + 机体离地（alt>2，地面停放不交战）+ 距基地 8~55u。
    const aaActive = this.enabled && !this.passive && heliPos && heliPos.y > 2 && this.baseCenter;
    // 2026-10-18 ASSETS3：炮塔跟踪直升机（16-targetmodels aimTurret；无 rnd，不影响种子序列）
    for (const t of this.targets) if (t.turret && t.group.visible) aimTurret(t, heliPos, dt);
    const bd = aaActive ? Math.hypot(heliPos.x - this.baseCenter.x, heliPos.z - this.baseCenter.z) : 0;
    // 玩法批 D：峡谷里离基地远（>55u），改由峡谷伏兵开火——只有 30u 内看得见你的车
    const inCanyon = aaActive && this.canyon && this.canyon.active && this.canyon.inZone(heliPos);
    // P3c：关卡布场时按"最近射手"判定交战（目标不一定在基地）
    let lsd = 0;
    if (aaActive && this._layout) {
      lsd = Infinity;
      for (const t of this.targets) if (t.alive && !t.hidden) lsd = Math.min(lsd, Math.hypot(t.pos.x - heliPos.x, t.pos.z - heliPos.z));
    }
    if (aaActive && (this._layout ? (lsd < 42 && lsd > 5) : ((bd < 55 && bd > 8) || inCanyon))) {
      this._aaCool -= dt;
      if (this._aaCool <= 0) {
        // 玩法批 C：楼后被遮挡的伏兵不开火；正在街口探头的伏兵优先开火
        const shooters = this.targets.filter(t => t.alive && !t.hidden &&
          (!this._layout || Math.hypot(t.pos.x - heliPos.x, t.pos.z - heliPos.z) < 42) &&
          (!inCanyon || (t.canyon && Math.hypot(t.pos.x - heliPos.x, t.pos.z - heliPos.z) < 30)));
        const peekers = shooters.filter(t => t._peekOut);
        if (shooters.length) {
          const pool = (peekers.length && rnd() < 0.7) ? peekers : shooters;
          const sh = pool[(rnd() * pool.length) | 0];
          const from = sh.group.position.clone(); from.y += 1.0;
          const dist = heliPos.distanceTo(from);
          const dir = heliPos.clone().sub(from).normalize();
          dir.x += (rnd() - 0.5) * 0.05; dir.y += (rnd() - 0.5) * 0.04; dir.z += (rnd() - 0.5) * 0.05;
          dir.normalize();
          const tr = this._aaTracers.find(t => !t.m.visible);
          if (tr) {
            // 难度系数派生：命中概率保持标准公式（不随难度缩放——规格 §四边界）；
            // 单发伤害/开火间隔经 HOST.arcade 读。局部变量名避开 2 字符短名，
            // 防止与三方库（three 内部 const ac）在同一 IIFE 内撞名（P0-1 教训）。
            const arcMod = HOST.arcade;
            const d = arcMod ? arcMod.coeffs(m) : null;
            const damageMul = d ? d.aaDmg : 1;
            const rateMul = d ? d.aaRate : 1;
            this._aaDmgMul = damageMul;
            tr.m.visible = true;
            tr.m.position.copy(from);
            tr.dir.copy(dir);
            tr.t = 0; tr.life = dist / tr.v;
            tr.hit = rnd() < (inCanyon ? 0.25 : this._layout ? Math.max(0.12, Math.min(0.4, 0.45 - dist * 0.006)) : Math.max(0.12, Math.min(0.4, 0.45 - bd * 0.005)));   // 峡谷伏兵近距（≤30u）固定 25%
            this._aaCool = (1.2 + rnd() * 1.4) / (rateMul * this.aaRateMul);
          }
        }
      }
      // 受损烟：损伤 ≥4 后从机体尾部冒出，随损伤加深变浓变大
      if (this._heliDmg >= 4) {
        this._dmgSmoke.visible = true;
        this._dmgSmoke.position.set(heliPos.x, heliPos.y + 1.4, heliPos.z);
        const dv = this._heliDmg - 3;
        this._dmgSmoke.material.opacity = Math.min(0.55, 0.12 + dv * 0.06);
        const sc = 1.2 + dv * 0.18;
        this._dmgSmoke.scale.set(sc, sc, 1);
      } else {
        this._dmgSmoke.visible = false;
      }
      // P8：威胁状态更新（0-3）——由反击活跃度与最近命中派生：
      //   aaActive=0 → 无威胁；开火中 → 低；命中等候 → 中；最近被击中 → 高（3s 衰减）
      this._threat = aaActive ? (this._threatHitFlash > 0 ? 3 : 2) : (this._threatHitFlash > 0 ? 1 : 0);
    } else {
      this._threat = this._threatHitFlash > 0 ? 1 : 0;
    }
    // P8：AA 曳光飞行/命中结算（P2-1 断点补全——此前发射后冻结无更新，tr.hit 无消费方，
    // _heliDmg 恒 0，受损烟/分级/后果全链失效）。命中后累加损伤、升级威胁、受击闪白。
    if (heliPos) {
      for (const tr of this._aaTracers) {
        if (!tr.m.visible) continue;
        tr.t += dt;
        tr.m.position.addScaledVector(tr.dir, tr.v * dt);
        // 命中判定：曳光到达机体 0.9u 内
        if (!tr.hit && tr.m.position.distanceTo(heliPos) < 0.9) {
          tr.hit = true;
          tr.m.visible = false;
          // Phase 18：单发伤害按难度系数累加（veteran ×1.4；小数累加，阈值 4/8/12
          // 的比较语义不变——受损分级/失败归因读同一累计值）
          this._heliDmg += (this._aaDmgMul || 1);
          this._threatHitFlash = 3;          // 高威胁持续 3s（HUD 红闪/音效反馈）
          // P5-G1：记下火力来向（沿曳光反推 12u），供受击方向指示
          this._lastHitFrom = tr.m.position.clone().addScaledVector(tr.dir, -12);
          if (this.onHeliHit) this.onHeliHit(this._heliDmg, tr.m.position);
        } else if (tr.t >= tr.life) {
          tr.m.visible = false;              // 未命中飞出寿命回收
        }
      }
      if (this._threatHitFlash > 0) this._threatHitFlash -= dt;
    }
    // B2 基地警报：只在任务进行中触发（展示/训练模式靶场保持静态，既有
    // 用例零变化）。首次受创后 1.6s 拉响——给"打响第一枪→敌方反应"留节拍。
    if (!this._alert && this.enabled && !this.passive && !this._layout && m && m.phase === 'active') {
      if (this._alertT == null) {
        if (this.targets.some(t => !t.alive || t.hp < t.hp0 - 1e-9)) this._alertT = 1.6;
      } else if ((this._alertT -= dt) <= 0) {
        this._raiseAlert();
      }
    }
    // 动目标（2026-09-02）：巡逻移动 + 朝向随路径；pos 快照同步供命中检测
    //（必须在 fx 早退之前——没有武器特效时目标也不能冻结）
    for (const t of this.targets) {
      if (!t.alive || !t.mov) continue;
      const mv = t.mov;
      if (mv.kind === 'path') { this._drivePath(t, mv, dt); t.pos.copy(t.group.position); continue; }
      if (mv.kind === 'circle') {
        mv.ph += mv.w * dt;
        t.group.position.set(mv.cx + Math.cos(mv.ph) * mv.r, 0, mv.cz + Math.sin(mv.ph) * mv.r);
        t.group.rotation.y = -mv.ph;              // 车头沿切线方向
      } else if (mv.kind === 'line') {
        mv.s += mv.v * dt;
        if (mv.s > mv.half) { mv.s = mv.half; mv.v = -Math.abs(mv.v); }
        else if (mv.s < -mv.half) { mv.s = -mv.half; mv.v = Math.abs(mv.v); }
        t.group.position.set(mv.cx + Math.sin(mv.a) * mv.s, 0, mv.cz + Math.cos(mv.a) * mv.s);
        t.group.rotation.y = mv.a + (mv.v > 0 ? 0 : Math.PI);
      }
      t.pos.copy(t.group.position);
    }
    // 玩法批 C：城镇伏兵探头状态机 + 视线派生 + 建筑塌方/冒烟
    if (this.town && this.town.active) this.town.update(dt, heliPos);
    if (this.canyon && this.canyon.active) this.canyon.update(dt, heliPos);
    // —— P31-B/C 布景与战斗状态派生（hp 唯一真源，零状态机）——
    // 布景显隐随 enabled 每帧派生（湖面/靶场复选框全状态自动跟随，不动 72-uibind）；
    // 损伤烟/车体微倾按 d=1-hp/hp0 纯派生：未损 visible=false（0 draw），
    // reset 复位 hp → d=0 自动熄灭归位，摧毁 → alive=false 走残骸燃烧链。
    if (this.scenery) this.scenery.visible = this.enabled;
    if (this._tgtSmokes) {
      this._fxT = (this._fxT || 0) + dt;
      for (const ds of this._tgtSmokes) {
        const t = ds.t;
        const d = (this.enabled && t.alive && t.hp < t.hp0 - 1e-9)
          ? Math.min(1, 1 - t.hp / t.hp0) : 0;
        ds.sp.visible = d > 0;
        if (d > 0) {
          // P31 像素实证调参：旧 (0.15+0.38d) 在沙地上有效暗化仅 ~25%，
          // 渲染链正常（红块实验 1658px 定案）但截图/肉眼不可辨——拉到
          // "半毁可辨"档：d=0.5 时 op≈0.53、烟团 s0×1.5
          const br = 0.75 + 0.25 * Math.sin(this._fxT * 1.3 + ds.ph);
          ds.sp.material.opacity = (0.28 + 0.5 * d) * br;
          const sc = ds.s0 * (1.1 + 0.8 * d) * (0.9 + 0.12 * br);
          ds.sp.scale.set(sc, sc, 1);
          ds.sp.position.set(t.pos.x, ds.y, t.pos.z);
        }
        t.group.rotation.z = d * 0.045;          // 受创车体轻微侧倾（纯 transform）
      }
    }
    const fx = window.__rigFx;
    if (!fx) return;
    // P5-C：靶场禁用时（如湖面场地）殉爆/残骸燃烧一律不执行——syncTargetsVis
    // 只关 group.visible，若这里继续冒烟会在水面上看到上一战场的残骸烟柱
    // （验收点 4.2/4.3"切换场地后无残留"违反）。动目标巡逻在 fx 段之前
    // 照常推进（位置快照是命中检测依赖，禁用时不可见但更新无害）。
    if (!this.enabled) return;
    // 油桶燃料蒸气二次殉爆（B1：队列化 + 殉爆波及半径 4.2u——油料区连锁）
    for (let i = this._fuelBooms.length - 1; i >= 0; i--) {
      const b = this._fuelBooms[i];
      if ((b.t -= dt) > 0) continue;
      this._fuelBooms.splice(i, 1);
      fx.explosion(b.x, b.y, b.z, 3);
      this.splash(b.x, b.z, 4.2, 2.5, null);
    }
    // B2 疏散车辆扬尘：车尾低矮沙尘团（速度过半才起尘，0.22s 一团）。
    // 与爆炸共用 48 格 puff 池（tier3 爆炸一次占 21 格）——空闲 <24 格时
    // 让路，扬尘永远不和爆炸抢粒子
    if (this._alert) {
      let free = -1;
      for (const t of this.targets) {
        const mv = t.mov;
        if (!t.alive || !mv || mv.kind !== 'path' || mv.v < 1.0) continue;
        if ((mv.dust -= dt) > 0) continue;
        mv.dust = 0.22;
        if (free < 0) free = fx.puffs.reduce((k, q) => k + (q.m.visible ? 0 : 1), 0);
        if (free < 24) continue;
        free--;
        const ry = t.group.rotation.y;
        fx._puff(t.pos.x - Math.sin(ry) * 1.7 + (rnd() - 0.5) * 0.6, 0.2,
          t.pos.z - Math.cos(ry) * 1.7 + (rnd() - 0.5) * 0.6,
          { color: 0xb59c78, s0: 0.35, s1: 1.5, life: 0.8, base: 0.32, rise: 0.25 });
      }
    }
    // 残骸燃烧
    for (const t of this.targets) {
      if (t.alive || !(t.burn > 0) || !t.wreck) continue;
      t.burn -= dt;
      wreckPop(t.wreck, dt);   // Q3 炮塔掀飞（无炮塔弹出的残骸直接返回）
      // P5-G1 余烬发光随燃烧衰减（熄灭时归零）
      wreckEmber(t.wreck, t.burn > 0 ? t.burn / (t.burn0 || 5) : 0, 0.8 + rnd() * 0.4);
      t._smk -= dt;
      if (t._smk > 0) continue;
      t._smk = 0.24;
      const wp = t.wreck.position;
      // 黑烟柱（残骸中心）
      fx._puff(wp.x + (rnd() - 0.5) * 0.6, 0.5, wp.z + (rnd() - 0.5) * 0.6,
        { color: 0x2b2620, s0: 0.35, s1: 1.6, life: 1.3, base: 0.42, rise: 0.9 });
      // 火舌（燃烧未熄时随机窜出）
      if (t.burn > 1 && rnd() < 0.6) {
        fx._puff(wp.x + (rnd() - 0.5) * 0.9, 0.3, wp.z + (rnd() - 0.5) * 0.9,
          { color: 0xff8a3c, s0: 0.14, s1: 0.55, life: 0.22, base: 0.6, add: true });
      }
    }
  }

  // B2 拉响警报：静止卡车驶上疏散环路（先垂直开到后方道路，再顺时针绕基地）；
  // 静止坦克不移位（U 形掩体内），由 update 外的炮口指向保持既有姿态。
  _raiseAlert() {
    this._alert = true;
    // 发车顺序：最靠东（离环路首段终点最近）的先走，后车依次延迟 1.1s——
    // 车长 ~3.1u，同时发车实测拐角处车距会压到 0.3u（追尾观感）
    const evac = this.targets
      .filter(t => t.alive && !t.mov && t.type === 'truck')
      .sort((a, b) => b.pos.x - a.pos.x);
    evac.forEach((t, k) => {
      t.mov = { kind: 'path', entry: [t.pos.x, this._evacRoadZ], loop: this._evacLoop,
        i: -1, v: 0, vmax: 2.4, dust: rnd(0.14), wait: k * 1.1 };
    });
    const n = evac.length;
    if (this.onAlert) this.onAlert(n);
  }

  // B2 沿路径行驶：起步加速（1.2u/s²）→ 匀速；拐点处位置走折线、车头阻尼
  // 转向（3/s），视觉上是平滑打方向而不是瞬间掉头
  _drivePath(t, mv, dt) {
    if (mv.wait > 0) { mv.wait -= dt; return; }
    mv.v = Math.min(mv.vmax, mv.v + 1.2 * dt);
    const g = t.group.position;
    let step = mv.v * dt, guard = 4;
    while (step > 1e-6 && guard--) {
      const tg = mv.i < 0 ? mv.entry : mv.loop[mv.i];
      const dx = tg[0] - g.x, dz = tg[1] - g.z, d = Math.hypot(dx, dz);
      if (d <= step) {
        g.x = tg[0]; g.z = tg[1]; step -= d;
        mv.i = (mv.i + 1) % mv.loop.length;
      } else {
        g.x += dx / d * step; g.z += dz / d * step; step = 0;
        mv.head = Math.atan2(dx, dz);
      }
    }
    if (mv.head != null) {
      let da = mv.head - t.group.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      t.group.rotation.y += da * Math.min(1, dt * 3);
    }
  }

  get alerted() { return this._alert; }

  // 场地切换时残骸贴片可能穿模——保留（焦痕在任何地面都合理）
}
