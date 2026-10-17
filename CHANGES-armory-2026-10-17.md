# CHANGES — 装备图鉴（2026-10-17）

状态：代码已入 src / 构建通过（Exit 0）

## 用户操作路径
- 主菜单第 3 张卡「图鉴」，或按 3 → 全屏图鉴
- 展示 →「知识」页 →「打开装备图鉴 · 全屏」
- URL `#armory` 直达
- 图鉴内：拖动左侧半圆转盘（松手有惯性，自动吸附到最近条目）/ 滚轮 / ↑↓←→ / Home / End / 点条目；点正文直接出全文；Esc 或 ✕ 关闭（回到打开前的界面）
- 竖屏手机：转盘在底部，露出上半圆，指针朝上

## 改动
- 新增 `src/app/35-armorydata.js`：13 条（结构 8：主旋翼、尾桨、T700、座舱、长弓雷达、TADS/PNVS、短翼挂架、机身生存性；武器 5：M230、Hydra 70、地狱火、JAGM、红外诱饵弹），每条标题/英文名/4 项参数/正文/图片署名；轮盘纯数学 armoryStep/Rel/Nearest/Target（环绕最短路径）。
- 新增 `src/app/71-armory.js`：纯 DOM + Canvas 2D 界面（无 WebGL）。照片扫描式切入 + 缓慢推镜，参数逐格淡入，打字机正文（约 30 字/秒，系统“减少动态效果”时直接显示）。打开期间吞掉全部键盘（capture），驾驶/开火键不生效。DOM/CSS 首次打开时创建。对外 `HOST.armory`。
- `70-loop.js`：`S.armoryOpen` 为真时整帧跳过（3D 暂停，低配机/手机流畅）。
- `70-appmode.js`：#ln-armory 卡、按 3、#btn-armory、#armory（初次与 hashchange）→ `HOST.armory.open()`。
- `src/template.html`：主菜单第 3 张卡 #ln-armory、页脚提示加「按 3」、知识页按钮 #btn-armory。
- `build.mjs`：复制 `assets/armory/*.webp|txt` 到 dist。
- 新增 `assets/armory/`：14 张 1600×1000 WebP（共约 1.5 MB，外部文件，不进 index.html）+ LICENSE.txt。来源 Wikimedia Commons：公有领域（美军官方照片）、CC0、CC BY 2.0、CC BY-SA 2.5 nl（hydra.webp）；署名逐条在 LICENSE 和界面图下方。
- `docs/module-contracts.md`：契约块 + 35/71 说明。
- 测试：`tools/tests_pure/test_armory.py` + `armory_drive.js`（数据完整性、图片存在、轮盘数学）；`tools/tests/test_armory.py`（A1–A5），已加入 test-manifest。

## 数据（真实命令输出）
- `node build.mjs` Exit 0；`dist/index.html` 2012871 B（sha256 39400c0e…244937）
- app 模块 71（+2）
- `pytest tools/tests_pure`：91 passed（+2）
- `check_topology_selftest`：8/8；拓扑违规 0；`check_dom_ids` 通过
- manifest：93（+1 test_armory）
- 浏览器：test_armory PASS、test_appmode PASS
- 截图脚本：/workspace/work/cmp/vis/shot_armory.py（工作区，未入库）

## 范围外
- 无。评分/关卡/3D 场景未动。

## 追加 2026-10-17 晚：轮盘改版（用户反馈）
- 71-armory.js：轮盘只显示当前项 + 前后各 2 项（更远的淡出隐藏），每项为一块跟着转的环形扇区；越接近指针越亮，选中扇区向外凸出（外半径 +7%、整体外移 6%）并加亮外缘。
- 条目文字随扇区一起旋转（横屏沿半径、竖屏沿切线），吸附/切换速度放慢（6.5，原 11），转动过程看得见。
- 状态：代码已入 src；构建通过 Exit 0；test_armory 纯测试 2 passed、浏览器 PASS，页面错误 none。

## 追加 2026-10-17 夜：观感打磨
- 图片统一调色（压暗/提对比/降饱和）+ 冷色叠层 + 四周压暗 + 顶部压暗，白天空不再刺眼。
- 轮盘前后两项文字更亮（0.65/0.45，原 0.45/0.25）。
- 扇区变细（内半径 0.52R、外 0.86R，间隙加大），填充更淡，选中项外缘发光；文字半径同步调整。
- 快转到位（剩不到 0.12 格）就提前换照片和正文，不等最后的慢吸附。
- 状态：代码已入 src；构建通过 Exit 0；test_armory 纯测试 2 passed、浏览器 A1–A5 PASS（沙箱偶发加载超时，重跑通过）。
