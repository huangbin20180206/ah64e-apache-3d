# 战役存档系统与全关卡自由演练特权改动记录

**日期**：2026-11-01  
**问题背景**：  
用户反馈游戏没有可视化的存档与管理系统（无论本地还是云端），导致切换浏览器、清理缓存或新环境下每次都只能从第一关（1-1 首飞）开始；同时中后期 12 个关卡（如峡谷突防、夜幕雷暴、终关斩首等）必须严格逐关通关才能解锁，缺乏自由演练与体验手段。

---

## 一、本次实施要点

### 1. 本地存档状态实时透明化
- 在「战役地图」顶部显著位置新增持久化状态指示栏（`.lm-savebar`），展示绿色动态状态呼吸灯与文字提示：`💾 本地自动存档: 正常 (已实时持久化)`。
- 每完成一局战役任务，星级、最高得分与最佳评级自动同步持久化至浏览器的 `localStorage['ah64_progress']`，无需手动频繁保存。

### 2. 演练特权：一键解锁全部关卡
- 提供「🔓 解锁全部关卡 (演练特权)」开关：
  - 点击后立即解除全部 4 个大章共 13 个关卡（包含 1-1 至 4-3 以及各特殊机体）的锁定状态，允许玩家自由进入任意关卡进行战术演练与挑战。
  - 演练模式下通关成绩依然有效并正常记入个人生涯星级与评级。
  - 再次点击即可随时切换回标准闯关模式，原已达成的解锁进度与星级记录完整保留不丢。

### 3. 完整的存档备份与跨端导入
- **导出/备份（📤 导出/备份）**：
  - 打开战术弹窗，自动生成 Base64 紧凑存档代码。
  - 支持「一键复制存档代码」至剪贴板。
  - 支持「下载存档文件 (.json)」生成 `ah64e_campaign_save_YYYY-MM-DD.json` 本地备份。
- **导入/恢复（📥 导入存档）**：
  - 支持在文本框直接粘贴 Base64 代码或 JSON 文本一键恢复。
  - 支持「从文件导入」直接读取本地 `.json` 备份文件。
  - 具备数据清洗与合法性校验，损坏或异常数据不炸页面，导入成功后立即热更新战役地图界面。
- **重置进度（🔄 重置进度）**：
  - 提供带二次安全确认的重置功能，方便玩家重新体验从零通关的成就感。

---

## 二、涉及文件与改动

1. **`src/app/92-progress.js`**：
   - `_fresh()` 与 `_sanitize()` 支持 `allUnlocked` 布尔状态持久化。
   - `isUnlocked(id)` 增加演练特权快速通道。
   - 新增 `toggleAllUnlocked()`、`isAllUnlocked()`、`exportCode()`、`exportJson()`、`importData()` 方法。
2. **`src/template.html`**：
   - 增加战役存档栏样式（`.lm-savebar`、`.lm-sb-status`、`.lm-sb-btn`、`.lm-sb-unlocked`）。
   - 增加战术存档管理弹窗结构（`#save-modal`、`#sm-title`、`#sm-desc`、`#sm-text`、`#sm-btn-copy`、`#sm-btn-download`、`#sm-btn-upload`、`#sm-btn-confirm`、`#sm-close`）。
3. **`src/app/70-play.js`**：
   - `renderLevelMap()` 增加存档条动态渲染及演练状态指示。
   - 挂载解密/导出、导入文件监听、剪贴板复制及重置确认交互。
4. **`tools/tests_pure/levels_drive.js` & `test_levels.py`**：
   - 增加演练特权开关、跨实例代码导出与导入恢复的纯逻辑单测回归。

---

## 三、验证证据

- **构建门禁**：`node build.mjs` 正常，生成的 `dist/index.html`（2198 KB）通过。
- **语法体检**：`node --check dist/app-check.mjs` 语法 100% 通过。
- **DOM ID 契约**：`node tools/check_dom_ids.mjs` 220 元素 / 193 引用 / 0 死引用。
- **模块拓扑**：`node tools/check_topology.mjs` 733 跨文件依赖边 / 0 违规。
- **纯逻辑回归**：`node tools/tests_pure/levels_drive.js` 驱动执行全绿（含新增加的 `saveSystem` 校验）。
- **页面视觉留档**：
  - `tools/tests/shot_campaign_save_system.png`（默认状态展示存档栏）
  - `tools/tests/shot_campaign_unlocked.png`（开启演练特权后 13 关全解锁）
  - `tools/tests/shot_campaign_modal.png`（存档导出与备份弹窗）
- **本地服务状态**：`http://127.0.0.1:8642` HTTP 200 正常响应。
