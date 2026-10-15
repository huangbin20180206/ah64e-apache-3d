# 测试竞态修复批 —— 验证与提交指令（架构方已代改，编程 AI 负责验证与提交）

> 基线：`fe67f51`（Phase 10 机首件重做批终态）。本批**只改测试文件，产品代码零改动**，目的是消除 P5-D(D3) 的测试侧竞态（既有假失败根因）与同类固定墙钟等待。
>
> 工作区已有架构方未提交改动（见 §1），编程 AI 不得重做/丢弃，只负责 §2 的验证与 §3 的归档提交。

## 1. 架构方已完成的改动（仅测试文件）

| 文件 | 改动 | 依据 |
|---|---|---|
| `tools/tests/test_ci_smoke.py` | ① P5-D(D3)：把"置扳机"与"覆盖 hidden + 派发 visibilitychange"**合并为同一次 `pg.evaluate`**（同一 JS 任务内完成，帧无法插队）；② P8-1：固定 `wait_for_timeout(500)` → `wait_for_function("_threat >= 1", 8000)` | 重做批 `FLAKY-INVESTIGATION.txt` 已定位：两次 evaluate 之间插入渲染帧时，`65-weapons.js` 连发逻辑击发 1 发 → 后续 P6-M3 `gun0` 偶发 1199 |
| `tools/tests/test_entry_consistency.py` | C3：同样原子化（原实现中间还有 100ms 等待，窗口更大） | 同一竞态模式 |
| `tools/tests/test_detail_parts.py` | D6：固定 `wait_for_timeout(450)` → 条件等待 `_threat >= 1` | 同类固定墙钟脆弱（修正批门禁曾在此失败） |
| `tools/tests/test_visual_materials.py` | M6：固定 `wait_for_timeout(400)` → 条件等待 | 同上（修正批门禁曾在此失败） |

**原理**：`72-uibind.js` 的 visibilitychange 处理器是**同步**调用 `releaseTriggers()`，`dispatchEvent` 也是同步执行，故合并后"置 ON → 释放"在同一任务内完成，rAF 帧不可能插入。条件等待替代固定墙钟后，若条件永不满足会**超时失败**（不会掩盖真实回归）。

架构方已完成：4 个文件 `py_compile` 通过；全库排查确认 `test_edge_cases.py`（3 处）本就是单次 evaluate 原子写法，无同类残留；产品代码（`src/`）零改动。

## 2. 编程 AI 必须完成的验证

1. **竞态消除验证（核心）**：`test_ci_smoke.py` 连续跑 **≥10 次**，记录 P6(M3) `g0` 断言的失败次数。修前基线（重做批 A/B 实测）失败率约 33–50%；修复后应为 **0/10**。若仍失败，打印实测 `g0` 值并定位（不得直接放宽断言）。
2. **回归验证**：`test_entry_consistency` / `test_detail_parts` / `test_visual_materials` 各连跑 3 次，确认全绿且失败时给出实测 `_threat` 值。
3. **完整前台门禁**：`tools/run_tests.ps1` 跑 1–2 轮，如实记录通过数（**不得把 36/38 写成全绿**）；若仍有 FAIL，逐项归因并给出"是否本批引入"的判断。
4. **零产品改动核对**：`git diff --name-only fe67f51..HEAD` 必须**只含** §1 的 4 个测试文件 + 本批归档文件；`src/` 下任何文件出现在范围内即为越界，必须回退。
5. 无需性能采样（无产品/资产改动），但需在归档中说明这一判断依据。

## 3. 归档与提交

- 归档到 `docs/ai-reviews/test-flaky-fix/`（轻量，遵循成本约定）：`STATUS.json`、`SUMMARY.md`、完整门禁输出、10 轮 `test_ci_smoke` 结果、`CONSISTENCY.txt`、`DIFF.patch`。
- **归档终态门**：`STATUS.changed_files` = 全部提交（含记忆同步）落地后的 `git diff --name-only fe67f51..HEAD`；漏 `CODELY.md` 视为未闭合；补丁用 Python 字节流 LF 生成，干净 `fe67f51` worktree `git apply --check` + `git diff --check` 均 exit 0。
- `manual_checks_passed=false`；状态诚实。
- 提交并推送后确认工作区 clean、`HEAD == origin/main`。

## 4. 禁止项与停止条件

禁止：改动任何 `src/` 产品代码、放宽或删除既有断言、把本批与 Phase 11 混做、进入 Phase 11/12。

**立即停止并报告**：若 10 轮 `test_ci_smoke` 仍出现 `g0` 失败（说明竞态另有来源，需重新定位）；若 `git diff` 范围出现 `src/` 文件。

完成后立即停止并输出：10 轮结果表、门禁通过数、`git diff --name-only` 范围、提交序列、`HEAD==origin/main` 状态，等待总指挥独立复核。
