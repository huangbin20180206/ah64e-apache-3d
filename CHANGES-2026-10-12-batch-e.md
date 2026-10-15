# 批 E（2026-10-12）：测试步进 / draw call / 16-targets 拆分 / 第一人称飞峡谷 / 历史瘦身脚本

基线：apache-cleanup-split-2026-10-12.zip（先覆盖它、跑过 cleanup 脚本再上这一批）。

## 1. 浏览器测试改为按游戏时间步进
- `70-loop.js`：`loop()` 只算 dt，帧逻辑移到 `_frame(dt, doRender)`；新增 `stepFrames(sec, h, until)`，同步推进游戏时间、跳过 GPU 渲染。正常运行路径行为不变。
- `72-uibind.js`：`__dbg.step = stepFrames`（只给测试用）。
- `pw_harness.py`：新增 `H.step_until(pg, cond, game_sec)` 和 `H.step(pg, game_sec)`，按游戏时间等，和机器帧率无关。
- `test_samwar / test_damage / test_resources / test_challenge_variants / test_campaign`：凡是等待游戏时间的地方都改成步进（启动时等 `__dbg` 就绪的那一步仍按墙钟）。沙盒软件渲染下原来 4 挂 1 超时，现在 5 个都通过。

## 2. Draw call（审计 C 项）
审计里的 C1/C2/C3 早已落地（PERF-AUDIT.md 的结论段已过时）。实测发现剩下的大头是直升机自身：80 个 mesh 每帧都进阴影 pass。
- `60-model.js` `buildShadowProxy()`：同一宿主下的 mesh 合成一个只投影的代理（drawRange=0，只在 `onBeforeShadow/onAfterShadow` 之间打开，主 pass 不画），原 mesh 关掉 castShadow。旋翼/尾桨/雷达/每枚地狱火/火箭巢/机炮/涂装贴花各自一个代理，挂在该节点下，跟着转、跟着隐藏；夜航灯组不碰。分解视图时整体退回逐 mesh 投影；`setShadows` 开关照常生效。
- `70-start.js`：在 `refl.bind` 之后调用（倒影深拷贝不会拷进代理）。
- `26-airtargets.js`：四轴（26→8 mesh）、热气球（15→6）、靶机 GLB 的静态件按材质合批，桨毂两片桨叶合成一片。

沙盒实测（单帧 composer，`renderer.info.render.calls`）：

| 场景 | 前 | 后 | 降幅 |
|---|---|---|---|
| pad | 179 | 134 | −25% |
| grass | 181 | 136 | −25% |
| desert | 181 | 136 | −25% |
| water | 188 | 143 | −24% |
| 任务 standard | 196 | 151 | −23% |
| FPV（pad） | 45 | 38 | −16% |

三角形数量与改前完全一致（只有 FPV 多了座舱隐藏件的阴影三角形）。同机位截图对比：阴影区域一致，差异只在 UI 文字和旋翼高光。C4（81-narrative 布景，11 个 draw）没有动，收益太小。

## 3. 拆分 16-targets.js（51KB → 30KB）
- `16-targetmodels.js`：程序化建模、AI 高模换壳、`mergeTargetStatics`（纯搬移）
- `16-targetscenery.js`：`buildRangeScenery(range, …)`（原 `TargetRange.buildScenery` 的方法体，`this` 改为 `range`）；`TargetRange.buildScenery` 仍是唯一入口
- 契约块已更新，拓扑检查 0 违规。README 模块表已补上（另加了 16-town / 16-valley）。

## 4. 第一人称飞峡谷
- `16-valley.js` `CanyonRun.probe(F, out)`：离地高度、距露头线余量、前方 3/6/9u 的旋翼净空（机头方向和左右各 3u 采样）。
- `46-fpview.js` + `template.html`：新增 FPV 读数条 `#fp-gpws`，例如“离地 9m · 崖顶下 8m”。露头时变橙色，显示“已露头 N m”；前方净空不足时黄框提示“前方贴壁”，6u 内要撞壁时红色闪烁“⚠ 拉起”。只在峡谷任务里显示。
- 新测试 `test_canyon_fp.py`（manifest 84→85）：F0 显示/隐藏，F1 告警，F2 露头，F3 按住 W 冲向岩壁不会穿进岩体，F4 退出。

## 5. 从 Git 历史彻底移除大文件
- `tools/purge-history-2026-10-12.ps1`：用 `git filter-repo` 删除历史里的根目录 jpg/png 和 docs/ai-reviews/。脚本会先检查前置条件（已装 filter-repo、工作区干净、cleanup 已提交），然后做一份 `--mirror` 完整备份，要求输入 PURGE 确认后才改写，**不会自动推送**。支持 `-DryRun`。
- 改写后所有 SHA（包括 tag）都会变，必须 force-push，其他机器上的旧克隆要重新 clone。
- 顺手修复：`tools/cleanup-2026-10-12.ps1` 补上了 UTF-8 BOM。不加 BOM 的话，Windows PowerShell 5.1 会按 GBK 读中文。

## 沙盒验证
- `node build.mjs`、`node --check`、DOM ID、拓扑 0 违规、拓扑自测 8/8、`tests_pure` 71 passed
- 浏览器测试通过：samwar、damage、resources、challenge_variants、campaign、canyon、canyon_fp、town、gameplay_b、phase14_bbox、enemyair
- 改前改后都一样失败（沙盒环境问题，不是这批引入的）：test_reflection、test_fpv、test_detail_parts
