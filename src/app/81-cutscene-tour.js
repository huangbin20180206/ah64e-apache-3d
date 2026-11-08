// ============================================================
// 81-cutscene-tour.js — 任务开场战术目标导览清单构建
// ============================================================
// 2026-11-08 自 82-cutscene.js 拆出（纯搬移，行为不变）。
// 82 原本 1112 行里这 412 行是一张「关卡 → 战术目标特写清单」的大数据表，
// 与运镜状态机（cutscene / 转场 / 弹窗）几乎无关，混在一个文件里难读难改。
// 放在 81 段：只依赖 HOST / BASE_C / 70-app 的状态源，编号都更小；
// 82 引用 buildMissionTour 属于正向引用，同编号 TDZ 风险为零。
// 契约见 docs/module-contracts.md。
// ============================================================

// 动态提取当前关卡/任务所有目标特写镜头清单（近距离高清特写 + 外观识别 + 建议打击武器）
function buildMissionTour() {
  const m = S._mission || {};
  const levelId = m.levelId;
  const variant = m.variant || 'standard';
  const L = (HOST.levels && levelId) ? HOST.levels.byId(levelId) : null;
  const goal = (L && L.layout && L.layout.goal) || (L && L.intro) || '摧毁战区内敌方全部目标';
  const list = [];

  if (variant === 'endless') {
    list.push({
      tag: '神风穿插 · 自杀无人机',
      title: '沙赫德-136 巡飞神风无人机',
      feat: '🔍 外观识别：三角翼无尾布局 · 尾部活塞螺旋桨高频蜂鸣',
      desc: '⚡ 威胁：全速向战区前沿直扑俯冲自爆！建议使用 30mm 链式机炮预瞄短点射截击',
      pos: [0, 12, 38], cam: { dist: 4.2, phi: 1.20 }, yOff: 0.5
    });
    list.push({
      tag: '主要空优威胁 · 截击机',
      title: '卡-52 “短吻鳄” 武装直升机',
      feat: '🔍 外观识别：共轴双旋翼无尾桨 · 短翼外挂空空导弹与火箭巢',
      desc: '💥 威胁：中远距机动发射火箭弹！建议雷达捕获后按 F 发射地狱火超视距定点斩首',
      pos: [-16, 14, 30], cam: { dist: 6.2, phi: 1.18 }, yOff: 0.8
    });
    list.push({
      tag: '地面穿插 · 机动车队',
      title: 'BTR-80 轮式装甲车 & 防空高机卡车',
      feat: '🔍 外观识别：八轮重型底盘 · 车顶搭载机枪炮塔并伺机打冷枪',
      desc: '🎯 威胁：沿外围公路包抄突击！建议俯冲压低机头使用 70mm 九头蛇火箭齐射轰顶',
      pos: [14, 0, 24], cam: { dist: 5.0, phi: 1.24 }, yOff: 0.8
    });
    list.push({
      tag: '前沿阵地 · 野战停机坪',
      title: 'FARP 前线野战重整与补给点',
      feat: '🔍 己方地标：战地 H 标志停机坪 · 储备燃油与高爆弹药箱',
      desc: '🛡️ 职责：守卫战区核心！弹药耗尽或受损可随时超低空回降补给与战地抢修',
      pos: [0, 0, 0], cam: { dist: 7.2, phi: 1.22 }, yOff: 0.3
    });
    return { goal: '动态多波次攻防 · 守卫前沿 FARP 并击退全部进犯敌军', list };
  }

  if (levelId === '1-1' || variant === 'train_flight') {
    list.push({
      tag: '航线标杆 · 1/3',
      title: '第 1 航点引导圈',
      feat: '🔍 目标标识：正前方空中高亮黄色发光引导圈',
      desc: '起飞离地后，微推机头平稳穿过，建立航向与基础前飞速度',
      pos: [0, 14, 22], cam: { dist: 5.0, phi: 1.22 }, yOff: 0.5
    });
    list.push({
      tag: '战术转弯 · 2/3',
      title: '第 2 航点引导圈',
      feat: '🔍 目标标识：战区左侧中空黄色引导圈',
      desc: '轻柔压杆左偏航转弯，控制总距油门维持 14 米悬停飞行高度',
      pos: [-20, 14, 38], cam: { dist: 5.0, phi: 1.20 }, yOff: 0.5
    });
    list.push({
      tag: '蛇形机动 · 3/3',
      title: '第 3 航点引导圈',
      feat: '🔍 目标标识：右侧末段返航黄色引导圈',
      desc: '右侧蛇形机动回切穿越第三航点圈，完成基础航线机动考核',
      pos: [16, 14, 52], cam: { dist: 5.0, phi: 1.20 }, yOff: 0.5
    });
    list.push({
      tag: '战术考核 · 悬停区',
      title: '地面绿色悬停考核圈',
      feat: '🔍 目标标识：地面高亮绿色同心圆光标空域',
      desc: '进入光圈正上方空域保持稳定悬停 10 秒，切忌大幅偏航晃动',
      pos: [-12, 0, 22], cam: { dist: 6.0, phi: 1.22 }, yOff: 0.2
    });
    list.push({
      tag: '安全着陆 · 停机坪',
      title: '直升机战备停机坪',
      feat: '🔍 己方地标：白色双同心圆 H 标志主降落区',
      desc: '考核完成后安全减速进近，对准停机坪平稳接地降落',
      pos: [0, 0, 0], cam: { dist: 7.0, phi: 1.22 }, yOff: 0.2
    });
    return { goal, list };
  }

  if (levelId === '1-2' || variant === 'train_weapons') {
    list.push({
      tag: '轻装甲靶标',
      title: '军用越野运输卡车',
      feat: '🔍 外观识别：六轮军绿越野底盘 · 帆布车厢',
      desc: '🎯 建议武器：30mm 链式机炮（按 G 或鼠标左键）3~5 发短点射精准穿甲',
      pos: [-3, 0, 80], cam: { dist: 4.8, phi: 1.25 }, yOff: 0.8
    });
    list.push({
      tag: '高爆易燃靶',
      title: '高爆燃料储油罐堆',
      feat: '🔍 外观识别：红色防爆圆柱形油罐 · 醒目易燃油料标',
      desc: '💥 建议武器：70mm 九头蛇火箭弹（按 X 或鼠标右键）大范围覆盖引爆',
      pos: [-9, 0, 72], cam: { dist: 4.2, phi: 1.25 }, yOff: 0.6
    });
    return { goal, list };
  }

  if (levelId === '1-3' || variant === 'train_hellfire') {
    list.push({
      tag: '重装甲突击靶',
      title: 'T-72 主战坦克',
      feat: '🔍 外观识别：半球形低矮铸造炮塔 · 125mm 坦克滑膛炮',
      desc: '🎯 建议武器：机头对准目标压入火控准星，按 F 发射地狱火导弹超视距定点摧毁',
      pos: [0, 0, 75], cam: { dist: 5.2, phi: 1.24 }, yOff: 0.8
    });
    list.push({
      tag: '巡逻装甲靶',
      title: '动态机动装甲坦克',
      feat: '🔍 外观识别：履带式动态往返巡逻车辆',
      desc: '🎯 战术指引：预判坦克机动路线压入准星，利用半主动激光导引定点消灭',
      pos: [6, 0, 78], cam: { dist: 5.2, phi: 1.24 }, yOff: 0.8
    });
    return { goal, list };
  }

  if (levelId === '1-4' || variant === 'train_rescue') {
    const rx = (rescue && rescue.g) ? rescue.g.position.x : 20;
    const rz = (rescue && rescue.g) ? rescue.g.position.z : 25;
    list.push({
      tag: '紧急待援 · 飞行员',
      title: '跳伞受困飞行员',
      feat: '🔍 目标标识：战区释放橙色浓烟信号 · 挥手呼救',
      desc: '🚑 救援指引：跟随橙色烟幕信标定位，超低空稳定悬停放下绞车完成救援',
      pos: [rx, 0, rz], cam: { dist: 3.5, phi: 1.28 }, yOff: 0.4
    });
    list.push({
      tag: '后送医疗点',
      title: '基地战备停机坪',
      feat: '🔍 己方地标：白色 H 标识野战停机坪',
      desc: '🚑 救援指引：救起战友后全速返航，停机坪心 8 米内平稳接地完成紧急医疗后送',
      pos: [0, 0, 0], cam: { dist: 7.0, phi: 1.22 }, yOff: 0.2
    });
    return { goal, list };
  }

  if (levelId === '2-1') {
    list.push({
      tag: '首要威胁 · 重装甲',
      title: '前哨防御主战坦克',
      feat: '🔍 外观识别：半球形低矮厚重炮塔 · 125mm 坦克炮管',
      desc: '🎯 建议武器：保持防区外射程，优先发射 AGM-114 地狱火导弹超视距定点敲掉',
      pos: [-24, 0, 10], cam: { dist: 5.2, phi: 1.24 }, yOff: 0.8
    });
    list.push({
      tag: '机动补给车队',
      title: '公路运输重型卡车',
      feat: '🔍 外观识别：双轴六轮军用越野卡车 · 运输补给线',
      desc: '⚡ 建议武器：30mm 机炮短点射扫射击毁，切断敌方前哨补给生命线',
      pos: [-14, 0, 22], cam: { dist: 4.8, phi: 1.25 }, yOff: 0.8
    });
    list.push({
      tag: '高爆连锁节点',
      title: '前哨露天弹药油料堆',
      feat: '🔍 外观识别：铁网围栏内红色圆柱储油罐与弹药箱',
      desc: '💥 建议武器：九头蛇火箭弹齐射轰击，引发连锁大殉爆瓦解周边工事守军',
      pos: [-26, 0, 7], cam: { dist: 4.2, phi: 1.25 }, yOff: 0.6
    });
    return { goal, list };
  }

  if (levelId === '2-2') {
    list.push({
      tag: '核心营救目标',
      title: '跳伞受困幸存飞行员',
      feat: '🔍 目标标识：树林空隙中释放绿色浓烟信号',
      desc: '🚑 救援指引：天黑前必须完成救援并送回基地！注意避开周边交叉火网',
      pos: [22, 0, 8], cam: { dist: 3.5, phi: 1.28 }, yOff: 0.4
    });
    list.push({
      tag: '敌军搜捕队',
      title: '环形包围搜捕卡车',
      feat: '🔍 外观识别：3 辆高速环形机动的武装卡车',
      desc: '⚡ 建议武器：机炮谨慎短点射，射击时严格避免炮火波及被困友军！',
      pos: [22, 0, 15], cam: { dist: 4.8, phi: 1.25 }, yOff: 0.8
    });
    list.push({
      tag: '外围封锁线',
      title: '封锁撤离主战坦克',
      feat: '🔍 外观识别：停在公路退路上的重型主战装甲',
      desc: '🎯 建议武器：地狱火导弹超视距点名，扫清返航撤离通道',
      pos: [34, 0, 3], cam: { dist: 5.2, phi: 1.24 }, yOff: 0.8
    });
    return { goal, list };
  }

  if (levelId === '2-3') {
    list.push({
      tag: '高价值集结区',
      title: '前沿野战加油补给站',
      feat: '🔍 外观识别：密集排列的加油卡车与高爆油桶',
      desc: '💥 战术指引：一发火箭弹直接命中油桶中心，即可引发全场连锁殉爆',
      pos: [17, 0, 18], cam: { dist: 4.5, phi: 1.25 }, yOff: 0.6
    });
    list.push({
      tag: '警戒重装',
      title: '分散防守主战坦克',
      feat: '🔍 外观识别：慢速巡逻的厚重主战装甲',
      desc: '🎯 建议武器：弹药减半局，严格节约弹药，地狱火定点一发毙敌',
      pos: [-20, 0, 6], cam: { dist: 5.2, phi: 1.24 }, yOff: 0.8
    });
    list.push({
      tag: '机动巡逻车',
      title: '巡逻护卫卡车',
      feat: '🔍 外观识别：越野机动武装卡车',
      desc: '⚡ 建议武器：利用 30mm 机炮短点射节省火箭弹药，全面肃清地面车辆',
      pos: [-14, 0, 18], cam: { dist: 4.8, phi: 1.25 }, yOff: 0.8
    });
    return { goal, list };
  }

  if (levelId === '3-1') {
    list.push({
      tag: '极度危险 · 首要威胁',
      title: 'SAM-6 制导雷达站与发射阵地',
      feat: '🔍 外观识别：大型旋转相控阵对空雷达网天线 · 3联装防空导弹车',
      desc: '🎯 必须首要消灭！率先击毁雷达站可致盲敌防空网，大幅削弱对空导弹威胁',
      pos: [0, 2, 75], cam: { dist: 5.5, phi: 1.18 }, yOff: 1.0
    });
    list.push({
      tag: '野战对空阵地',
      title: '野战防空发射车',
      feat: '🔍 外观识别：履带式防空发射车 · 随时伺机发射地空导弹',
      desc: '⚠️ 留意 RWR 雷达告警，防空导弹逼近时立刻按 J 释放热诱饵干扰弹',
      pos: [12, 0, 69], cam: { dist: 5.0, phi: 1.24 }, yOff: 0.8
    });
    list.push({
      tag: '基地守备装甲',
      title: '基地防守主战坦克连',
      feat: '🔍 外观识别：基地大门两侧防守的主战坦克',
      desc: '💥 防空雷达致盲后，由高空俯冲使用火箭弹和机炮全面扫平',
      pos: [-12, 0, 72], cam: { dist: 5.5, phi: 1.22 }, yOff: 0.8
    });
    return { goal, list };
  }

  if (levelId === '3-2') {
    list.push({
      tag: '主要空优死敌',
      title: '敌武装直升机编队 (共3波6架)',
      feat: '🔍 外观识别：高速机动空中武装直升机 · 挂载对空导弹与火箭巢',
      desc: '🎯 战术指引：保持能量咬住敌机后半球，准星套紧后发射地狱火或机炮连续穿孔',
      pos: [-16, 14, 22], cam: { dist: 5.8, phi: 1.18 }, yOff: 0.8
    });
    list.push({
      tag: '地面暗哨伏击',
      title: '野战高射防空卡车',
      feat: '🔍 外观识别：伪装在沙丘背风面的高射炮卡车',
      desc: '⚡ 建议在展开空战缠斗前先行俯冲扫射打掉，免除对空偷袭',
      pos: [-20, 0, 18], cam: { dist: 4.8, phi: 1.25 }, yOff: 0.8
    });
    return { goal, list };
  }

  if (levelId === '3-3') {
    list.push({
      tag: '城镇伏击点',
      title: '楼宇掩体隐蔽坦克',
      feat: '🔍 外观识别：借助多层建筑阴影卡视野的伏兵坦克',
      desc: '💥 战术指引：火箭弹可连同掩体建筑一同轰塌，碎砖瓦砾直接掩埋敌坦克！',
      pos: [0, 0, 99], cam: { dist: 5.2, phi: 1.24 }, yOff: 0.8
    });
    list.push({
      tag: '基地主防线',
      title: '军事基地核心设施与守备装甲',
      feat: '🔍 外观识别：水泥沙袋工事、防空阵地与弹药库',
      desc: '🎯 建议武器：由街道中轴线超低空高速掠袭，火箭弹大面积洗地清剿',
      pos: [0, 0, 75], cam: { dist: 5.5, phi: 1.22 }, yOff: 0.8
    });
    return { goal, list };
  }

  if (levelId === '4-1') {
    list.push({
      tag: '超低空隐蔽走廊',
      title: '红石峡谷南入口',
      feat: '🔍 地形特征：高耸垂直红石崖壁 · 蜿蜒狭窄深谷通道',
      desc: '⚠️ 战术指引：全程贴地在崖壁之下飞行！高出崖顶会被防空雷达瞬间捕获锁定！',
      pos: [36, 4, -56], cam: { dist: 6.5, phi: 1.20 }, yOff: 1.0
    });
    list.push({
      tag: '峡谷拐角隘口',
      title: '谷底隐蔽装甲车',
      feat: '🔍 外观识别：岩石拐弯死角潜伏的轻型装甲车',
      desc: '⚡ 建议武器：机炮短促扫射迅速秒杀，注意不要让旋翼擦碰峡谷岩壁！',
      pos: [-20, 2, -18], cam: { dist: 4.8, phi: 1.25 }, yOff: 0.8
    });
    list.push({
      tag: '峡谷北出口',
      title: '基地司令部与指挥中枢',
      feat: '🔍 外观识别：峡谷出口处的综合指挥阵地与防空导弹车',
      desc: '🎯 冲出峡谷瞬间全火力倾泻，地狱火连射摧毁核心指挥大楼与防空车',
      pos: [0, 0, 75], cam: { dist: 5.8, phi: 1.20 }, yOff: 0.8
    });
    return { goal, list };
  }

  if (levelId === '4-2') {
    list.push({
      tag: '夜幕雷暴 · 巡逻装甲',
      title: '夜战重装甲巡逻纵队',
      feat: '🔍 外观识别：黑夜暴雨中亮着前大灯机动的主战坦克',
      desc: '🔍 战术指引：按 O 开启红外热成像（FLIR）穿透雨幕精准捕捉目标热源！',
      pos: [18, 0, 18], cam: { dist: 5.2, phi: 1.24 }, yOff: 0.8
    });
    list.push({
      tag: '暴雨宿营地',
      title: '露天驻扎补给车队与油料堆',
      feat: '🔍 外观识别：闪电照亮瞬间可见的卡车与密集油料罐',
      desc: '💥 建议武器：引爆营地储油桶，大爆炸火光照亮整个暴雨战场',
      pos: [-20, 0, 14], cam: { dist: 4.8, phi: 1.25 }, yOff: 0.6
    });
    list.push({
      tag: '夜航截击机',
      title: '低云潜伏武装敌机',
      feat: '🔍 外观识别：低空黑夜雷雨云层中潜伏的武装直升机',
      desc: '🎯 雷达告警捕获后立刻地狱火迎头点杀！',
      pos: [0, 14, 40], cam: { dist: 5.8, phi: 1.18 }, yOff: 0.8
    });
    return { goal, list };
  }

  if (levelId === '4-3') {
    list.push({
      tag: '阶段 1 · 破网',
      title: '防空雷达站与导弹发射车',
      feat: '🔍 外观识别：基地核心主防空雷达天线与导弹连',
      desc: '🎯 斩首首要一步：率先打瞎防空雷达，瓦解敌防空截击网！',
      pos: [0, 2, 75], cam: { dist: 5.5, phi: 1.18 }, yOff: 1.0
    });
    list.push({
      tag: '阶段 2 · 歼灭',
      title: '基地守备装甲集群与升空截击机',
      feat: '🔍 外观识别：全基地主力 T-72 坦克群与升空武装直升机',
      desc: '💥 空地协同全面歼灭！地狱火清坦克、机炮打敌机',
      pos: [4, 0, 78], cam: { dist: 5.5, phi: 1.22 }, yOff: 0.8
    });
    list.push({
      tag: '阶段 3 · 营救',
      title: '战俘营重兵堡垒与被困战友',
      feat: '🔍 外观识别：重兵把守的铁丝网战俘营大门',
      desc: '🚑 战术指引：轰开大门，悬停放下绞车救回战友并全速突围！',
      pos: [-14, 0, 83], cam: { dist: 4.5, phi: 1.25 }, yOff: 0.4
    });
    return { goal, list };
  }

  // 通用/自由模式/战役关卡兜底
  if (targets && targets.targets && targets.targets.length) {
    const live = targets.targets.filter(t => t.alive && !t.benched);
    const tanks = live.filter(t => t.type === 'tank');
    const trucks = live.filter(t => t.type === 'truck');
    const barrels = live.filter(t => t.type === 'barrel');
    if (tanks.length) {
      const p = tanks[0].pos;
      list.push({
        tag: '主力装甲', title: tanks[0].label || '主战坦克',
        feat: '🔍 外观识别：厚重炮塔与长管滑膛炮',
        desc: '🎯 核心地面威胁，保持防区外射程使用地狱火定点消灭',
        pos: [p.x, 0, p.z], cam: { dist: 5.2, phi: 1.24 }, yOff: 0.8
      });
    }
    if (trucks.length) {
      const p = trucks[0].pos;
      list.push({
        tag: '高机动车队', title: trucks[0].label || '运输卡车',
        feat: '🔍 外观识别：军绿双轴货运越野卡车',
        desc: '⚡ 巡逻补给车辆，30mm 机炮短点射清除',
        pos: [p.x, 0, p.z], cam: { dist: 4.8, phi: 1.25 }, yOff: 0.8
      });
    }
    if (barrels.length) {
      const p = barrels[0].pos;
      list.push({
        tag: '燃料油料库', title: '高爆储油桶堆',
        feat: '🔍 外观识别：红色防爆圆柱形油罐',
        desc: '💥 火箭弹攻击可触发大范围连锁殉爆',
        pos: [p.x, 0, p.z], cam: { dist: 4.2, phi: 1.25 }, yOff: 0.6
      });
    }
  }
  if (!list.length) {
    list.push({
      tag: '战区核心', title: '前沿军事基地',
      feat: '🔍 外观识别：岗楼、兵营与雷达天线阵地',
      desc: '接近敌方基地后锁定开火',
      pos: [0, 1, BASE_C.z], cam: { dist: 7.5, phi: 1.15 }, yOff: 1.0
    });
  }
  // 将导览镜头绑定到真实存活实体（巡逻坦克/绕圈卡车/空中敌机），保证特写始终对准移动中的目标模型中心
  for (const item of list) {
    if (!item.pos) continue;
    const ix = item.pos[0], iy = item.pos[1], iz = item.pos[2];
    if (iy > 6) {
      if (item.title && item.title.indexOf('沙赫德') >= 0 && air && air.list) {
        const d = air.list.find(a => a.alive && a.type === 'plane');
        if (d && d.g) item.liveGetter = () => [d.g.position.x, d.g.position.y, d.g.position.z];
      } else if (enemyAir && enemyAir.units) {
        const u = enemyAir.units.find(x => x.on);
        if (u) item.liveGetter = () => [u.x, u.y, u.z];
      }
    } else if (targets && targets.targets && (ix !== 0 || iz !== 0)) {
      let best = null, bestD = 12;
      for (const t of targets.targets) {
        if (!t.alive || t.benched) continue;
        const d = Math.hypot(t.pos.x - ix, t.pos.z - iz);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best) item.liveGetter = () => [best.pos.x, iy, best.pos.z];
    }
  }
  return { goal, list };
}
