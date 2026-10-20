# opt1 — 外部 AI 审查建议落地（2026-10-20）

## 采纳并完成
- **变体完成条件只写一份**：新增 `variantGoalMet(m)`（70-mission），结算复核与主循环判定共用；新增变体只改这一处。
- **评级曲线只写一份**：90-campaign 导出 `HOST.baseGrade`，70-mission `missionRating` 改为读它（不再抄数字）。
- **单一来源守护测试**：`tools/tests_pure/test_single_source.py`——变体键表必须是 MISSION_VARIANTS 子集、missionRating 不得再写死数字、completeMission 不得再逐变体判定。
- **纯逻辑测试进本地门禁**：`tools/run_tests.ps1` 静态检查后跑 `pytest tools/tests_pure`（CI 早已在跑）。
- **Linux 测试入口**：`tools/run_tests.sh [--smoke]`（构建 + 语法 + DOM id + 拓扑自测 + 纯逻辑测试，可选 CI 冒烟）。
- **同帧双杀不再丢分**：敌机（87）与基地设施（81）的 `killEvent` 改为队列，对外读写方式不变；新增纯逻辑测试 `kill_queue`。
- **SAM 导弹尾烟**：85-samvis 自带 72 团预分配烟团池，按游戏时间落烟、1.5 秒放大变淡；零每帧分配。
- **小重复清理**：`wrapBlob` 两份合成 `wrapBlobOn`；`_noiseBurst` 复用 `_noiseSrc`（随机序列不变）。

## 不采纳（理由）
- 巨型函数拆分、命中链统一、27 个全局迁移、UI 绑定重写、81 重编号：风险高，玩家看不出差别；等真要加新武器/目标系统时再顺手做。
- launchHf 每发 new Box3：每次发射才一次（全局最多 8 次），不是每帧，收益≈0。
- 移动端干扰弹按钮：用户规则——当前只做 PC。
- 部署 gzip：GitHub Pages 已自动压缩传输。
- 烟池 InstancedMesh、启动贴图延后、CHANGES 归档：前两项需整轮性能复测，暂无卡顿反馈；归档会打乱其他 AI 的既有约定（AI-WORK-RULES 写的是根目录）。
- 源资产 .blend/.fbx：原始资产来自外部库，无法补档。

## 验证
- build / 语法 / 拓扑违规 0 / DOM id / `pytest tools/tests_pure` 95 passed。
- 2-1 关注入 SAM 导弹实拍：尾烟可见，无页面错误。
