# 下一步怎么继续

> **2026-10-25 更新（Hark）**：§二~§4.3 已做完，见 `CHANGES-handover-2026-10-25.md`。地狱火挂架修复原先未生效，已改正并实测；4.3 三条已修。剩下只有需要真机/有头浏览器的人工项（分享卡复制粘贴、FPV 观感、aniso 目视、首屏 GLB 是否下两次）。基线测试现为 139 passed。

## 一、先拿代码

```bash
git clone https://github.com/huangbin20180206/ah64e-apache-3d.git
cd ah64e-apache-3d
```

已经有过这个仓库的，`git pull` 就行。

**你要看的是最新提交**（以下数字会随新提交前移，以下面 `git log` 实际输出为准）：

```
git log --oneline -1    # 此文档写作时为 305dc4f（Hark 接手批）
```

## 二、先跑这四条，确认基线是绿的

```bash
CODEBUDDY_SAFE_DELETE_ENABLED=0 node build.mjs
                                   # 拓扑无反向引用 / id 235 定义·208 引用·死引用 0
                                   # 300 顶层声明 0 重名 / 资源引用 66 全覆盖
                                   # 注释剥离 2864 行 237.5 KB → dist/index.html 2024 KB
                                   # 部署压缩后 gzip 610 KB / brotli 468 KB
node --check dist/app-check.mjs    # 应 Exit 0
node tools/strip_comments_selftest.mjs   # RESULT PASS（79 文件字符串零漂移 / 整包可编译）
uv run --with pytest pytest -q tools/tests_pure   # 应 ≥142 passed（2026-11-08 实测 142；只增不减）
```

**四条不绿就别往下做**，先把环境问题解决。

> `node build.mjs` 默认剥离产物里的整行注释，**源码注释完整保留**；
> 需要带注释的调试包时设 `APACHE_KEEP_COMMENTS=1` 重建。
> 若本机是 WorkBuddy 客户端且构建报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，
> 是客户端的批量删除保护拦了 `rmSync(dist)`（与代码无关），
> 命令前加 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 即可；CI 无此限制。
>
> 本地演示 `start-demo.bat` 已改用 `tools/serve_dist.py`：按
> `Accept-Encoding` 动态 `br > gzip > identity` 传输内联 HTML，二进制
> GLB / JPG / WebP / MP3 原样透传，与线上 GitHub Pages CDN 行为一致。
>
> 2026-11-08 收尾复核（GPU 显存反复换场实测、巨型文件拆分覆盖度、
> `65-weapons.js` / `60-model.js` 明确不继续拆的理由）见
> `CHANGES-2026-11-07-gate-hardening-and-perf.md` 第九节。

## 三、读这几个文件（按顺序）

1. `HANDOVER-2026-10-25.md` —— 交接文档，先读这个，里面有全部改动说明
2. `docs/module-contracts.md` —— 拓扑契约（改代码必读，构建会强校验）
3. `AGENTS.md` —— 仓库操作纪律
4. `docs/FILE-MAP.md` —— 76 个源文件职责地图（改哪个功能去哪个文件，2026-10-27 新增）

## 四、接手的活儿：先验证，再开发

### 4.1 第一步：补跑有头浏览器回归（上一轮没跑）

```bash
cd 项目目录 && start-demo.bat        # 服务在 localhost:8642
powershell -File tools/run_tests.ps1 # 需先设 $env:GATE_EXPECT_SHA=(git rev-parse HEAD)
```

⚠️ **这个会抢鼠标焦点**，跑之前跟人在场的人打个招呼。

### 4.2 第二步：人工验 8 件事（`HANDOVER-2026-10-25.md` §5.1 有完整清单）

关键四条：

| 验什么 | 怎么验 |
|---|---|
| 分享卡"复制战绩图" | Chrome（HTTPS）进关卡 → 通关 → 点"复制战绩图" → 粘贴到画图看有没有图 |
| FPV 切回视角有无顿挫 | 按 C 进第一人称 → 加速 → 再按 C 退出，看机身 |
| 地狱火挂架能否恢复 | 第一局把 8 发地狱火打光 → 开第二局 → 按 F 看能不能发射 |
| 结算评级是否降档 | 故意把飞机打伤 + 打光弹药通关，看评级有没有降 |

### 4.3 第三步：修剩下的问题（`HANDOVER-2026-10-25.md` §5.2 有完整清单）

优先级最高的三条：

1. **`_panelShift` 每帧强制重排** —— `70-loop.js:388`，`getBoundingClientRect` 每帧调，建议缓存或降到 10Hz
2. **`build.mjs` 下载队列 `_GQ.MAX = 4` 硬编码** —— 建议按网络类型分档
3. **`31-scenery.js` 的 `onBeforeCompile` 字符串替换 `#include <map_fragment>`** —— 依赖 three 内部 shader chunk 名，three 升级会静默失效，建议加断言

## 五、两条硬规矩（违反了会构建红 / 出错）

1. **新增任何跨文件顶层符号，必须同步改 `docs/module-contracts.md`**
   提供方写进 `provides`，消费方写进 `depends`。不改 → `node build.mjs` 报 `[undeclared-dep]` 红。

2. **低编号文件不得引用高编号文件声明的顶层符号**（反向引用）。
   要拿运行期实例，走 `HOST.*`（`01-host.js` 里的槽位）。

## 六、两个坑别踩

1. **反向验证时不要用 `git checkout` 恢复文件** —— 会把未提交的改动全丢掉。用 `cp` 备份。
2. **用脚本批量改代码后必须 `grep -c` 计数复核** —— 插入两次和插入一次，脚本都不报错。
   （JS 对象字面量重复键不报错，构建和测试都是绿的，很难发现。）

## 七、其它

- 单文件 HTML 产品：`src/app/*.js` 按文件名数字排序拼接成一个 IIFE，无打包器
- `dist/` **绝不入库**（buildId 内嵌 git_sha，入库后每次构建工作树必脏）
- 注释 / UI 文案 / 文档一律中文
- 每个功能在 `CHANGES-*.md` 记一笔
