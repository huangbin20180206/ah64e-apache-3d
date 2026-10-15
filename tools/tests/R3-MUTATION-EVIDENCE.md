# R3 mutation 反证证据（单 owner 契约 / activeOwnerCount / conflict）

## 场景
临时把 82-cutscene.js cutStart 的 FPV 让位禁掉（if(false)）——模拟旧并发缺陷：
FPV active 中 rescue delivered 触发 replay 时 fp 未退出。

## 实测（mutation 构建 + test_mode_transitions）
- M1/M4/M3 正常路径：assert_single_owner 全程 PASS（activeOwnerCount<=1、conflict=false）
- M2 失败：mstate 实测
  {'owner':'cutscene', 'fp':True, 'cutscene':True,
   'activeOwnerCount': 2, 'conflict': True, ...}
  → 既有断言 'M2: replay 期间 FPV 必须让位' FAIL 先触发；新断言
    'M2-replay单owner'（assert count<=1 and conflict is False）同样必 FAIL。
- 结论：activeOwnerCount/conflict 字段真实暴露非法并发（2/false），新断言
  mutation-sensitive 成立。

## 恢复后
让位恢复，test_mode_transitions 应全 PASS（本次返修 R3 的 GREEN 在门禁轮验证）。

（本文件为 R3 要求 mutation 反证证据，归档时随 doc 提交）