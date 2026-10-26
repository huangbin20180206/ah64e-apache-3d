# 审核后修复批（2026-10-26，豆子/甜心喵）

> 前置：对 Hark 接手批 `305dc4f` 的审核报告 = `AUDIT-hark-2026-10-26.md`（结论：通过，0 新增缺陷）。
> 升级计划 = `docs/UPGRADE-PLAN-2026-10-26.md`。本批 = 计划中 P1 全部 + P2 两项。
> P0（本机 GPU 有头回归 + 人工视觉 4 项）需老黄在场配合，另行安排（现在会抢鼠标焦点）。

## 改了什么

| # | 文件 | 改动 | 怎么发现 | 怎么验证 |
|---|---|---|---|---|
| 1 | `src/app/70-mission.js` | 重写 `applyVariantAmmo` 上方 290-291 行旧注释——它还写着已废弃的"判据 = 挂架里有节点 visible"，与 Hark 修正后的现行实现（读 `chk-hellfire`）直接矛盾，会引导下个 AI 改回去 | 审核 305dc4f 时被旧注释带偏半分钟 | 纯读复核：新旧注释不再矛盾，且明确标注"历史方案已废弃勿类推" |
| 2 | `NEXT-STEPS.md` | ①"最新提交 b7926c7"改为动态指引（git log 为准，写作时 305dc4f）②"应 135 passed" 改为 "应 ≥139 passed"（下限口径，避免每加测试就改文档） | 审核报告 §三-2 | 纯读复核 |
| 3 | `tools/tests_pure/test_handover_2026_10_25.py` | `test_no_duplicate_dbg_keys` 固定 6000 字符窗口改为**花括号平衡区**（整个 `__dbg` 对象），并加 `get samwar()` 尾部锚点断言 | 审核报告 §三-3：对象增长后尾部键脱离守护 | **反向验证**：在 `__dbg` 尾部注入 `get zzztail()` 重复键 → 测试变红（抓到）→ 恢复 → 绿 |
| 4 | `src/app/70-hud.js` | `_qCeil===undefined` 行旁加护栏注释：`_qCeil` 唯一重置路径是 72-uibind `pickQ('auto')`，新增自动画质入口必须同步重置 | 审核报告 §2.3：理论破口（现 UI 触发不到，不加代码防不存在路径） | 纯读复核 |
| 5 | `src/app/31-scenery.js` | 着色器告警条件补括号 `A \|\| (B && C)`（语义不变） | 审核报告 §2.4：`\|\|`/`&&` 混用不括号易误读 | build 三道门禁绿 |
| 6 | `build.mjs` | GLB 下载并发档位支持**动态重估**：抽出 `_gqNet()`，`connection.change` 事件时重算 `_GQ.MAX` 并 `_gqPump()`（弱网转强网立即提速；Safari 无 connection 静默跳过） | 审核报告 §2.3 与升级计划 §3.1：静态分档 WiFi↔蜂窝不重算 | build 三道门禁绿（loader 段字符串拼接，语法经 `node --check` 覆盖） |

## 反向验证记录（#3）

```
注入：__dbg 尾部 keys, 之前插两行重复 get zzztail()
结果：1 failed（test_no_duplicate_dbg_keys 报 ['zzztail']）
恢复：cp /tmp/72-uibind.js.bak 回原 → 4 passed
git diff：72-uibind.js 零残留
```

## 门禁结果（2026-10-26 实测）

- `node build.mjs`：✅（dist 2125KB，git_sha 与 bundle sha 输出正常，dist 未入库）
- `node --check dist/app-check.mjs`：✅ Exit 0
- `pytest tools/tests_pure`：✅ **139 passed**（含本批修强的 4 项守护测试）

## 仍挂账（不 accusatory，只是别忘）

- **P0 验证债**：有头全量回归（D 类 4 项 + narrative_strike N2）+ 人工视觉 4 项
  （分享卡复制 / FPV 退出 / 地狱火打光后第二局 / aniso 目视）——需老黄在场，现在没跑。
- 上轮升级计划遗留：拓扑门禁 tokenizer 升级（影子运行方案，见 UPGRADE-PLAN-2026-10-26 §3.3，本轮未动）。
