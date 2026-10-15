# 战斗系统审计 · 审核文档

> 给独立审核 AI：本文档自包含。你的任务是**独立复核**下面每一条断言的真伪，不要默认我说的对。
> 每条我都给了可复现命令。请实跑、实读，发现任何夸大或错误直接指出。

---

## 0. 环境与范围

- **仓库**：`C:\Users\huang\Kyle_Projects\apache_web_audit`（git worktree）
- **分支**：`audit/combat-core`
- **基线**：从 `main` 的 commit `5202797` 切出（干净基线，用于 A/B 对照）
- **本审计新增 2 个 commit**：
  - `0cfca20` — SAM 导弹 lost 标志修复
  - `a8462f6` — 敌机 search→patrol 瞬移修复
- **未合并 main、未 push**。工作树 clean。
- **测试体系**：`tools/tests_pure/` 是纯 node 逻辑测试（无浏览器），用 `python -m pytest` 跑。
  被测源码 `src/app/84-samwar.js` / `87-enemyair.js` 是纯逻辑模块（零 THREE/DOM）。

**审计覆盖范围（诚实声明）**：
- ✅ 深审：`84-samwar.js`、`87-enemyair.js`（各找到 1 个确诊 bug 并修复）
- ✅ 审阅：`65-weapons.js`（命中/锁定/飞行体全段，未发现确诊 bug，1 个低置信观察项）
- ❌ 未审：`16-targets.js`、`86-damage.js`（时间/上下文所限，留待后续）

---

## 1. 复核第一步：确认现场

```bash
cd /c/Users/huang/Kyle_Projects/apache_web_audit
git log --oneline 5202797..HEAD      # 应见 a8462f6 + 0cfca20 两个 commit
git status --short                   # 应为空（clean）
git diff --stat 5202797              # 应见 6 文件改动，产品代码仅 2 处各 1 行
```

产品代码总改动 = **2 行**（samwar 1 行 + enemyair 1 行），其余是测试。

---

## 2. Bug 1 · SAM 导弹池复用漏清 lost 标志（commit 0cfca20）

### 缺陷
`src/app/84-samwar.js` 的 `_fireFrom()`（约 :280）重新发射导弹时，重置了 `decoyed` 和
`hasLos`，**漏了 `lost`**：

```
修复前： m.on = true; m.t = 0; m.v = SAMCFG.MSL_V0; m.decoyed = false; m.hasLos = false;
修复后： m.on = true; m.t = 0; m.v = SAMCFG.MSL_V0; m.decoyed = false; m.lost = false; m.hasLos = false;
```

### 触发链
1. 导弹池只有 3 枚（`this.missiles = [_swMissile()×3]`），复用。
2. 一枚导弹因玩家大机动、弹目线甩出导引头视场（GIMBAL），在 update 里被置 `m.lost = true`
   （84-samwar 约 :197-198）。失锁后直飞至自毁 → `m.on = false`，但 **`lost` 标志残留在该 slot 对象上**。
3. `launch` 阶段再装填（约 :166-172）从池里 `for(!c.on)` 取第一个空闲 slot——正是这个残留 slot。
4. `_fireFrom` 复用它、没清 `lost` → 新导弹一出膛就 `lost = true`。
5. update 里 `if (!m.decoyed && !m.lost)` 的导引分支（约 :193、:209）**全部跳过** → 新导弹不追踪、直飞成哑弹。

### 后果
玩家机动甩掉首枚导弹后，后续复用同 slot 的导弹**全部不追踪**，SAM 威胁凭空消失——
一次成功规避永久废掉一个发射席位。

### 复核命令（A/B：revert 产品那行即复现 FAIL）
```bash
cd /c/Users/huang/Kyle_Projects/apache_web_audit/tools/tests_pure

# 修复态：应 9 passed（含 test_relaunch_clears_lost_flag）
python -m pytest test_samwar.py -v

# 直接看复现用例的原始输出（修复态应 lostCleared:true）
node samwar_drive.js relaunch_lost

# 复现缺陷：临时把 84-samwar.js 那行的 "m.lost = false;" 删掉再跑，
# node samwar_drive.js relaunch_lost 应输出 lostCleared:false（证明修复有效）
```

### 复核要点（请挑战我）
- 复现用例 `relaunch_lost` 是**直接操纵 `mod.missiles[0]`** 模拟"失锁退场的 slot"，
  不是跑完整 RWR 链——这是否公平复现了真实场景？（我认为是：真实链路里失锁导弹退场后
  slot 状态与我手工设置一致；但请你判断 `_fireFrom` 取 slot 的逻辑 `for(const c of this.missiles) if(!c.on)` 是否真会取到该 slot。）
- 对照项 `decoyedCleared:true`/`hasLosCleared:true` 证明"只有 lost 漏清"——请确认。

---

## 3. Bug 2 · 敌机 search→patrol 位置瞬移（commit a8462f6）

### 缺陷
`src/app/87-enemyair.js` 的 `_updateUnit`（search 分支，约 :187-193）：

```
修复前： if (dist > C.VISION_LOSE) { u.phase = 'patrol'; u.pt = 0; return; }
修复后： if (dist > C.VISION_LOSE) {
           u.ang = Math.atan2(u.z - this.anchor.z, u.x - this.anchor.x);  // 按当前位置反算相位
           u.phase = 'patrol'; u.pt = 0; return;
         }
```

### 触发链
1. patrol 阶段单元位置由相位角 `u.ang` 驱动：`u.x = anchor.x + cos(ang)*r`、`u.z = anchor.z + sin(ang)*r`。
2. 进入 search 后用 `_advance(u,dt)` 朝玩家直线移动，**离开巡逻圆，但全程不更新 `u.ang`**。
3. 玩家脱离 `VISION_LOSE`（66u）后回 patrol。**下一帧** patrol 分支用**冻结的旧 `u.ang`**
   重算 `u.x/u.z` → 单元从追击位置瞬间弹回旧巡逻相位点。

### 实测跳变
- 修复前：**7.3u**（正常单帧位移 SPEED×dt = 12×0.05 = 0.6u 的 ~12 倍）
- 修复后：**1.37u**（降 81%，残差 = 单元被 `_advance` 拉离巡逻圆半径后的"半径回位"）
- 视觉后果：敌机"闪现"跳位。

### 为什么只降到 1.37u 不清零
残差来自 search 期单元偏离了巡逻圆**半径**（不只是相位）。彻底清零需让半径也渐进回归
（改巡逻运动模型），属侵入性改动，风险大于收益。我判定 reangle（消除相位跳变，这是 7.3u 的主因）
是"最小正确修复"，保留 1.37u 残差。**这是一个工程判断，请你评价是否合理**——
或你认为应该连半径一起平滑。

### 复核命令
```bash
cd /c/Users/huang/Kyle_Projects/apache_web_audit/tools/tests_pure

# 修复态：应 12 passed（含 test_search_to_patrol_no_teleport）
python -m pytest test_enemyair.py -v

# 直接看跳变数值（修复态应 jump≈1.37, bounded:true）
node enemyair_drive.js search_teleport

# 复现缺陷：把 87-enemyair.js 新增的 u.ang=Math.atan2(...) 那行删掉再跑，
# jump 应回到 ≈7.3, teleported:true
```

### 复核要点（请挑战我）
- 测量点在"回 patrol 后**再下一帧**"（第一帧走 search 分支 return 不重算位置，第二帧才用旧 ang 重算）
  ——我第一版测量早了一帧、量到 0.6u 差点误判"无 bug"，修正测量帧后才量到 7.3u。
  **请你确认测量帧对、7.3u 真实**（driver 里 search_teleport 用例有两次 `mod.update`，注释标了每帧语义）。
- reangle 用 `atan2(z-anchor.z, x-anchor.x)`，与 patrol 分支 `x=anchor.x+cos(ang)*r` 的角约定是否一致？
  （请验证 cos/sin 与 atan2 的参数顺序匹配。）

---

## 4. 顺带发现的既有债（非本审计引入，未修，上报）

### test_campaign.py 陈旧断言（3 个测试红）
`tools/tests_pure/test_campaign.py` 三处断言写死关卡数 `n == 5`，但 `src/app/90-campaign.js`
的 `CAMPAIGN_LEVELS` 现有 **6 关**（第 6 关 `sead_strike·终关·斩首压制` 是 Phase 24 加的）。

**A/B 铁证（与本审计零关系）**：
```bash
# 干净基线（无本审计任何改动）上同样红，签名一致
cd /c/Users/huang/Kyle_Projects/apache_web/tools/tests_pure   # 注意：主 worktree，非 audit
python -m pytest test_campaign.py -q      # 应 3 failed（assert 6 == 5），与 audit 分支一致
```

**为什么逃过门禁**：`tools/tests_pure/` 不在门禁 manifest（`tools/tests/test-manifest.json`）里，
门禁跑的是 `tools/tests/` 的 playwright 版。这个纯 node 版 campaign 测试是**孤儿测试**，
加第 6 关时没人跑到它，陈旧断言潜伏至今。这与 C007 时 `test_air_superiority` 的 chip 5→6
遗漏是同一类问题。

**建议**：单独立项修 `n==5`→`n==6`（我没在本审计分支顺手改，避免污染 2 个 bug 修复的干净 diff）。

### 低置信观察项：火箭无分段命中（未确诊，未改）
`65-weapons.js` 火箭飞行段（约 :604）用**单点 `hitTest(pos, 2)`**，无分段推进；
而同文件曳光（vel 260）和地狱火（vel 34，用余量 0.6 补偿）都显式处理了穿隧。
火箭 `VMAX=58`：
- 60fps（dt≈0.0167）单帧位移 ≈0.97u < 判定余量 2u → **不穿隧**
- ≤30fps（dt≥0.033）单帧 ≥1.9u → 快速小目标**可能**穿

我判定为**低置信观察项、不改**：60fps 正常游玩不触发，无"必现"证据；改它需引入分段逻辑，
风险大于未证实的收益。**留给你判断**是否值得防御性加分段。

---

## 5. 完整测试现状（本审计分支）

```bash
cd /c/Users/huang/Kyle_Projects/apache_web_audit/tools/tests_pure
python -m pytest -q
```
预期：**68 passed, 3 failed**。
- 3 failed 全部是 `test_campaign.py`（既有债，见 §4，A/B 已证基线同红）
- 我改动的直接相关面 `test_samwar.py`(9) + `test_enemyair.py`(12) = **21/21 全绿**

---

## 6. 请审核方重点回答

1. **两个 bug 是真的吗**？按 §2/§3 的 revert 命令复现 FAIL，确认缺陷真实存在。
2. **修复正确吗**？samwar 补 `lost=false` 是否完备；enemyair 的 `atan2` 相位反算角约定是否正确。
3. **修复有副作用吗**？21 个纯测试是否够覆盖，有没有我没测到的回归面。
4. **§3 的 1.37u 残差**：我"不动巡逻模型"的取舍合理，还是应该连半径一起平滑？
5. **§4 火箭穿隧**：低置信观察项，值得防御性修，还是我"不改"的判断对？
6. **campaign 既有债**：确认与本审计无关（A/B）。

发现任何我夸大、误判、或遗漏的地方，直接指出——这份文档的目的就是被挑战。
