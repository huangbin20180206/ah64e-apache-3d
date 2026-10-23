# CHANGES sfx2 2026-10-23 — 火箭 / 地狱火 / 雷声换真实录音

- 用户提议参考 github.com/Leonxlnx/earshot：核查后不采用——它是让 AI "听"音频的工具，自带 252 个音效也是代码合成的，
  且只有界面/宣传片类（点击、弹出、快门、呼啸），没有火箭、导弹、雷声。
- 改从 Internet Archive Red Library（CC0，与机炮/爆炸同源）取真实录音：
  - 火箭弹：rocket1/rocket2（Rocket Fly By 的飞离段，两种轮换）+ 保留合成的出巢闷响和次声推力
  - 地狱火：同一批录音放快 1.3 倍（导弹更快、尾音更短）+ 保留弹射"砰"
  - 雷声：thunder1-3（Classic Thunder Clap ×3 轮换），远雷按距离减音量 + 保留合成次声
  - 录音没加载到时自动退回原合成音
- 剪辑：截取、淡入淡出、峰值 -1dB、单声道 32kHz 80kbps MP3（共约 250KB）。出处见 assets/audio/sfx/LICENSE.txt。
- 验证：浏览器实测 12 段录音全部解码成功，三种音效都走录音分支，无页面报错；`bash tools/run_tests.sh` 通过。
