# E2 无线电中文喊话（2026-10-19）

## 内容
- 新增 `src/app/70-radio.js`：游戏模式任务局里的无线电台词 + 底部字幕条（"◉ 指挥所 / 射手"）。
  - 指挥所：开局（2 句轮换）、任务完成（2 句）、任务失败、误伤平民（2 句）。
  - 射手：击毁（4 句，间隔≥5s）、连杀（2 句）、步兵肃清、敌机击落、中弹（2 句，间隔≥8s）、被雷达/SAM 锁定（间隔≥10s）。
  - 优先级：高优先级打断低优先级，同级/更低在说话时丢弃（不排队，避免滞后）。轮换按计数，不用随机数。
  - 声音走独立增益直连输出，只跟随全局静音开关；进入游戏模式且音频已启动时预载。
  - 关闭语音：`localStorage.ah64_radio = '0'`（字幕仍显示）。
- 新增 `assets/audio/radio/` 18 条 mp3（约 320 KB）+ NOTE.txt：edge-tts 神经语音（云健=指挥所，云希=射手，语速 +12%），ffmpeg 无线电处理（带通 380–3000Hz、压缩、软削波、粉噪静噪头尾）。
- build.mjs 复制 radio 目录；CREDITS.md 增加 AI 合成语音说明。

## 挂点
- 70-app updateTargetHUD（击毁/连杀；最后一个目标交给任务完成台词）
- 70-mission beginMission / 完成 / 失败 / 步兵肃清加分
- 70-start 误伤平民、敌机击落、峡谷雷达锁定；70-combat _hitFeedback（中弹）
- 70-loop radioTick（字幕淡出、静音跟随、SAM 进入 lock 沿检测）

## 状态
- 代码已入 src；构建通过（Exit 0，dist/index.html 2022 KB，+6 KB；75 个模块；radio/18 mp3）。
- tests_pure 91 passed；DOM ID 检查通过；拓扑自测 8/8。
- 浏览器验证：/workspace/work/cmp/vis/shot_radio.py——开局字幕出现，18 条语音全部解码，击毁台词实际播放（时长 2.75s）。
- 全量回归未跑（非大版本）。

## 许可说明
- 微软合成语音的再分发未明确授予 CC 类许可；本项目非商业。若要完全无顾虑可删除 assets/audio/radio（只剩字幕）。
- bundle_sha256 ec6820d0b2a1fed0e4b069f66a9e89bdcdc1547efa2cae5f0d1a8aaa60ce8415
