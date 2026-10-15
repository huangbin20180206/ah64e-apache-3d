# 2026-10-12 仓库瘦身 + 拆分 70-app.js

## 1. 仓库瘦身（约 58MB 移出工作树）
- 删除根目录 79 张调试截图（*.jpg，约 12MB）。没有任何代码或测试读取它们；测试截图写到 tools/tests/（已 gitignore）。
- 删除 docs/ai-reviews/ 全目录（35 个阶段验收存档，约 46MB：39MB 图片 + 补丁/日志/报告）。
  - 会写这个目录的工具都会自己重建目录（test_phase0_evidence、bench_ab 都调用 makedirs），门禁 run_tests.ps1 本来就把证据改写到 APACHE_TEST_OUT。
  - 删除前打 tag `archive/pre-cleanup-2026-10-12`，旧存档随时 `git checkout <tag> -- docs/ai-reviews` 找回。
- .gitignore 新增 `/*.jpg`、`/*.png`、`docs/ai-reviews/`，防止再长回来。
- zip 无法表达删除：执行 `tools/cleanup-2026-10-12.ps1`（打 tag + git rm + git add）。
- 注意：git 历史仍含这 46MB，clone 体积不变；要真正缩小需 git filter-repo 改写历史（会改全部 SHA），未做。

## 2. 70-app.js（110KB / 1880 行）拆成 8 个同前缀模块
| 文件 | 大小 | 内容 |
|---|---|---|
| 70-app.js | 8.9KB | 渲染器/世界/S/子系统槽/靶场 HUD/resize/applyQuality |
| 70-camera.js | 2.6KB | 机位条、setView、截图 |
| 70-combat.js | 12.8KB | _tickSamwar/_tickDamage/_tickEnemyAir/_tickResources + scratch + _dmgApply |
| 70-hud.js | 14.4KB | _tickPostFx（返回慢动作 timeScale）/_tickModeChip/_tickHud + syncFlyText |
| 70-labels.js | 7.1KB | 部件标签与解说牌 |
| 70-loop.js | 14.5KB | loop()：800 行压到约 260 行，按原顺序调用各 _tick* |
| 70-mission.js | 42.7KB | 任务系统 + _tickMission/_tickMissionMaps |
| 70-start.js | 11.2KB | prog/boot/finish，末尾 `boot();` |

- 同前缀文件在拓扑检查里同级（parseInt 相同，互引不算反向引用）；build.mjs 按文件名字典序拼接，70-start.js 必须是 70-* 最后一个（boot 同步段要求 70-* 顶层 const 已初始化）。
- 纯搬移 + 提函数：逐行核对，原文件每一行都在新文件中出现（只去掉两个旧分节标题、`{ }` 块外壳和 `dt *= ts` → `return ts`）。提出的块经检查只用到 dt/rawDt/s/rpm 这几个循环局部量，均作参数传入；块内没有 return/break。
- docs/module-contracts.md：契约块由分析器重导（符号级边 490、文件级 172），人读段落新增 8 节；README/CODELY 目录说明同步。

## 验证（沙盒）
- 构建 + node --check、DOM id 契约、拓扑 0 违规、topology selftest 8/8、tests_pure 71 passed。
- 浏览器：test_canyon / test_town / test_gameplay_b / test_enemyair / test_mode_chip / test_dof PASS。
- test_samwar / test_damage / test_resources / test_challenge_variants 在沙盒失败，但用拆分前的构建跑出的结果完全一样、卡在同一步（实时 rAF 环境问题，已知）；test_campaign 超时。以本机门禁为准。
