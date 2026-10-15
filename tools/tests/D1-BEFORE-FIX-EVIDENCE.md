# D1 mutation/before-fix 反证证据（Phase 14 返修 R2）

## 场景
旧错误数学（复议指令一所指组合）：orbit.target=当前 FPV 眼位 + dist/theta/phi
来自"眼位相对最终锚点 t2"的球坐标 → Orbit.update 重建 camera = target + spherical
= eye + (eye - t2) = 2·eye - t2，首帧跳变。

## 实测失败值（修复前，新 D1 捕获）
- 退出前眼位 pre(eye)：[0.05, 15.747, 2.809]
- fly.f 快照（toggle 同步后立即捕获）：
  tgt=[0.05, 15.747, 2.809]（=eye，旧错误）、theta=0.0192、phi=1.3825、dist=2.656、
  f2tgt=[0, 15.25, 0.2]
- fly.f.tgt + spherical(f.theta,f.phi,f.dist) 重建相机：[0.1, 16.244, 5.418]
- 与退出前眼位三维距离 **MathDist = 2.6563 u**（要求 <= 0.05）→ D1-math 断言
  FAIL（AssertionError，值 2.6563 已保存）

## 结论
新 D1 在修复前真实 FAIL（未篡改任何内部状态——直接用旧实现构建产出跑测试）；
修复后同断言应 < 0.05。

（本文件为 R2 要求的 before/after 机器可读证据，归档时随 doc 提交）