// tools/check_undefined_selftest.mjs — 影子检查器自测（2026-10-27）
// 构造已知误报形态与真笔误样本，断言 findUndefined 的行为符合设计。
import assert from 'node:assert';
import { findUndefined } from './check_undefined.mjs';

const F = '00-sample.js';
let pass = 0;

function run(label, src, expectNames) {
  const r = findUndefined([{ file: F, src }]);
  const got = r.map(x => x.name).sort();
  assert.deepStrictEqual(got, [...expectNames].sort(), `${label}: got [${got}] want [${expectNames}]`);
  pass++;
  console.log(`  ✓ ${label}`);
}

// 1. 真笔误必须被抓到
run('真笔误被抓', 'const tracker = 1;\nfunction step(){ traker.x = 2; }\n', ['traker']);

// 2. this.方法调用链 ≠ 自由标识符；class A 顶层声明被 new A() 正常消费（两项都不报）
run('this 方法链与class声明不报', 'class A { m1() { this._m2(); } _m2() {} }\nnew A().m1();\n', []);

// 3. 类体内多方法挤一行（`}` 后方法名）不再误报
run('} 后方法定义不报', 'class B {  _a() { this._b(); }  _b() {} }\n', []);

// 4. getter 键不报（2026-10-27 修复 get/set 白名单）
run('getter 键不报', 'const DP = 1;\nclass C { get dp() { return DP; } }\n', []);

// 5. 同行多声明 + 括号初始化（2026-10-27 修复 ) 不清 declMode）
run('多声明第二目标不报', 'const a = f(1), b = f(2);\nuse(a, b);\n', ['f', 'use']);

// 6. 括号内逗号(箭头形参)不误吞
run('箭头参数逗号不报', 'fn((x, y) => x + y);\n', ['fn']);

// 7. 全局/内建白名单不放行真笔误同形名
run('白名单可命中', 'const q = THREE.Scene();\n', []);

console.log(`SELFTEST PASS ${pass}/7`);
import { findUndefined as _fu } from './check_undefined.mjs';
// 收尾：对真实仓库跑一次，确认 CLI 判断不影响被 import（无重复输出即通过）
const live = _fu();
console.log(`真实仓库影子基线：${live.length} 嫌疑符号（记录在案供未来对比）`);
