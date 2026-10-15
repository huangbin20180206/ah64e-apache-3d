# 审核结论（主审官签署）

> 审核对象：`AUDIT_REVIEW.md`（combat-core 战斗系统审计，分支 `audit/combat-core`，基线 `5202797`）
> 主审官：tuanjie 主会话（独立复核，未采信文档任何未经验证的断言）
> 结论：**通过（APPROVED）**——两个 bug 真实、修复正确且完备、无副作用、无夸大；
> 4 处措辞/归因的小瑕疵见 §E（不影响结论）。

---

## A. 独立复现证据（全部由主审官实跑，非转述）

| # | 断言 | 我的实测 | 判定 |
|---|---|---|---|
| 1 | 现场一致性（分支/基线/2 commit/clean） | `5202797..HEAD` = a8462f6+0cfca20 ✓；clean（仅未跟踪的本审核文档）✓ | ✓ |
| 2 | 产品 diff = 2 处逻辑改动 | 84-samwar 1 行（+lost=false）；87-enemyair 1 行删除→6 行块（reangle+注释）| ✓ |
| 3 | Bug1 真实（A/B） | 修正前 `lostCleared:false` → 修正后 `true`；两个新 pytest 用例在修正前 **FAIL** | ✓ |
| 4 | Bug2 真实（A/B） | 修正前 `jump:7.3, bounded:false` → 修正后 `1.37, true`；新用例修正前 **FAIL** | ✓ |
| 5 | 21/21 直接相关面 | samwar 9/9 + enemyair 12/12（含两个新用例）| ✓ |
| 6 | 全量 68 passed + 3 failed | 逐字一致；3 failed 全部是 test_campaign（§D）| ✓ |
| 7 | campaign 既有债与本审计无关 | **主 worktree（5202797，零审计改动）同 3 红、签名逐字一致** | ✓ |
| 8 | tests_pure 是孤儿测试 | `tools/tests/test-manifest.json` 与 run_tests.ps1/工具链**零引用**，纯手工跑 | ✓ |

## B. Bug 1（SAM lost 残留）——修复正确且**完备**

- 触发链核实：`lost=true` 的唯一置位点在 GIMBAL 分支（:198）；失锁导弹可经寿命耗尽/触地/直飞命中
  三种方式退场，退场后 `lost=true` 残留在 slot 上；`_fireFrom` 取 `!on` slot 复用 → 新导弹带 lost 出膛，
  两个导引块（:193/:209）全部跳过 → 直飞哑弹 ✓ 真实。
- **完备性**：我逐字段对照了 `_swMissile()` 工厂（on/x/y/z/dx/dy/dz/v/t/decoyed/lost/lx/ly/lz/hasLos）
  与 `_fireFrom` 的复位清单——`lx/ly/lz` 是唯一不复位的字段，但它在 `hasLos=false` 时**先写后读**
  （:207-208 在首次 update 即重算并置 hasLos=true），无陈旧读取路径 ⇒ **修复后 per-flight 状态已全清**。
- `reset()`（:320）本就清 lost ✓；`state().lost`（:341，RWR 显示）用 `on && lost` ⇒ 不受影响 ✓。

## C. Bug 2（敌机瞬移）——修复正确，角约定已验证

- 角约定：patrol 分支 `x = anchor.x + cos(ang)*r`、`z = anchor.z + sin(ang)*r` ⇒ 反解必须是
  `atan2(dz, dx)`；修复用 `Math.atan2(u.z - this.anchor.z, u.x - this.anchor.x)` —— **参数顺序正确** ✓。
- 测量帧：search 命中 `dist > VISION_LOSE` 的那一帧**只置 phase 并 return**（位置不动），
  瞬移发生在**下一帧** patrol 重算 —— 文档的测量帧分析正确，7.3u 真实 ✓。
- 残差机理：reangle 保持"从锚点指向当前位置"的射线方向，故残差 = **|当前距锚距离 − 巡逻半径|**
  （纯径向）。1.37u 是 driver 场景的值；一般情形 = 单元 search 期追击深度（有界但可 >1.37u）。

## D. 既有债（独立复核确认）

- `test_campaign.py` 3 红（`n==5`×2 + migrate 断言）：主 worktree @5202797 **同样 3 红、签名一致**
  ⇒ 与本审计无关 ✓。根因 = `CAMPAIGN_LEVELS` 已 6 关（第 6 关 sead_strike）而测试硬编码 5。
- **孤儿测试**：`tools/tests_pure/` 在门禁 manifest 与 run_tests.ps1/工具链中**零引用**（实测 grep）
  ⇒ 纯手工跑，加第 6 关时确实无人跑到它 ✓（文档声明成立）。
- 修法建议：别把 5 改 6——应从 `CAMPAIGN_LEVELS.length` 派生（与 C005/C007 的 chip 断言
  表驱动化同一教训：硬编码计数每加一关就要再改）。

## E. 对文档的 4 处修正/精化（不改变结论）

1. **§2 复核要点的"状态一致"说法不精确**：测试投毒的 slot 是
   `{lost:true, decoyed:true, hasLos:true}` 的**复合态**；真实 GIMBAL 失锁路径是
   `{lost:true, decoyed:false, hasLos:true}`（decoyed 与 lost 在真实流程中互斥——decoyed 后
   GIMBAL 块被跳过、lost 后诱饵块被跳过，二者不会先后发生）。测试是有效的**超集**
   （对复位语义更严格），但"与我手工设置一致"应弱化为"超集"。另：该用例是单元级
   （直接操纵 slot），若要更强的端到端证据，可补一条"完整 RWR 链：发射→规避→失锁→
   退场→再装填→断言新弹可导引"的用例。
2. **§2 "永久废掉一个发射席位"略有夸大**：席位仍在发射，只是复用到 lost 残留 slot 的导弹
   不导引；净效果（规避 2~3 枚后 SAM 威胁实质失效）成立，但机制是"逐 slot 污染"。
3. **§3 的 1.37u 是场景值不是上界**：残差=追击深度的径向分量，追得越远残差越大
   （有界于 search  episode 长度）。"不动巡逻模型"的取舍我**同意**（改模型会波及
   全部单位的巡逻轨迹与 12 个既有用例，收益是消除一次稀有单帧 1~N u 的视觉 pop——
   不划算）；建议后续若要做，用"巡逻分支内半径阻尼回归"而非改 reangle。
4. **§4 归因小误**：第 6 关是 **Phase 26** 加的（代码注释自证）；Phase 24 加的是
   sead_strike **变体**。实质（6 关 vs 硬编码 5）正确。
5. ** hygiene**：`AUDIT_REVIEW.md` 本身未跟踪（文档自称"工作树 clean"）——建议提交或
   gitignore，使"clean"自洽。
6. **火箭穿隧（§4 低置信项）**：同意"不改"——60fps 步长 0.97u < 2u 余量，无必现证据；
   建议在 65-weapons 火箭段补一行注释记录该已知限制（防御性文档而非防御性代码），
   供未来改 VMAX/帧率假设的人参考。

## F. 对 6 个问题的直接回答

1. **两个 bug 是真的吗** → 是（§A3/A4 的 A/B 复现 + 我逐行核对触发链）。
2. **修复正确吗** → 是。lost 复位完备（全字段枚举+无陈旧读取路径）；atan2 参数顺序与
   patrol 的 cos/sin 约定匹配（已逐行对照）。
3. **有副作用吗** → 未发现。21 个直接用例 + 68 个全量用例绿；`reset()`/`state()` 既有语义
   不受影响；reangle 只在 search→patrol 退出路径执行，patrol 主循环与 attack/evade/
   withdraw 分支零接触。
4. **1.37u 残差取舍** → 合理（见 E-3）；若要彻底清零应做"巡逻分支半径阻尼回归"，
   属独立小改进，不应混入本审计。
5. **火箭穿隧** → 同意"不改"；补一行注释即可（见 E-6）。
6. **campaign 既有债** → 确认与本审计无关（我在主 worktree 独立 A/B 同 3 红）；
   建议单独立项，且改法用"从 CAMPAIGN_LEVELS.length 派生"而非硬编码 6。

## G. 主审官补充的独立发现（文档未提及）

- 无新增缺陷。审计分支的产品改动**最小且聚焦**（2 处逻辑改动，均带动机注释），
  测试新增 2 用例 + 2 driver 用例均为确定性（固定 seed/固定位置/零随机依赖），
  符合本项目"确定性优先"的测试纪律。
- `tests_pure` 的 driver 用 `path.join(__dirname, '..', '..', 'src', 'app', ...)` 读源码
  ⇒ CWD 无关 ✓（从任意目录跑都一致，鲁棒）。
- `tools/tests_pure/` 建议纳入某种自动跑批（哪怕一个 30 秒的 pytest 脚本进 run_tests），
  否则"孤儿测试"问题会重复发生——本次 campaign 就是例证。**是否纳入由统帅拍板**
  （涉及门禁时长与 runner 形态）。

—— 主审官签署，2026-09-21。
