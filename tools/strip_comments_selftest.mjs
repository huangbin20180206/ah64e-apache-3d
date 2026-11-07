// ============================================================
// strip_comments_selftest.mjs — 构建期注释剥离的自证（P2-1）
// 用法：node tools/strip_comments_selftest.mjs
// 三道保险：① 手工边界用例精确断言；② 真实 app 源码「字符串字面量序列」
// 逐字节不变；③ 剥离后的整包可被 V8 编译（语法等价的必要条件）。
// 任何一条失败都非零退出，CI 的 Syntax checks 会直接拦下。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripAppComments } from './strip_comments.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log('  ok  ' + name);
  else { console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); failed++; }
};

// ---------- ① 手工边界用例 ----------
const CASES = [
  ['普通整行注释被删', 'const a = 1;\n// 这是说明\nconst b = 2;\n', 'const a = 1;\nconst b = 2;\n'],
  ['行尾注释不动', 'const a = 1; // 行尾\n', 'const a = 1; // 行尾\n'],
  ['代码缩进/空行原样', '  const a = 1;  \n\n  // c\n  const b = 2;\n', '  const a = 1;  \n\n  const b = 2;\n'],
  ['许可头保留', '//! MIT License\nconst a = 1;\n', '//! MIT License\nconst a = 1;\n'],
  ['含引号的注释保留', '// 用 "foo" 举例\nconst a=1;\n', '// 用 "foo" 举例\nconst a=1;\n'],
  ['含 URL 的注释保留', '// 见 https://x/y\nconst a=1;\n', '// 见 https://x/y\nconst a=1;\n'],
  ['GLSL include 注释保留', '// #include <map_fragment>\nconst a=1;\n', '// #include <map_fragment>\nconst a=1;\n'],
  ['独占块注释被删', '/* 一条说明 */\nconst a = 1;\n', 'const a = 1;\n'],
  ['跨行块注释内部不删', '/* start\n// not a line comment\nend */\nconst a=1;\n',
    '/* start\n// not a line comment\nend */\nconst a=1;\n'],
  ['模板字符串内部不删', 'const s = `\n// shader comment\nvoid main(){}\n`;\n',
    'const s = `\n// shader comment\nvoid main(){}\n`;\n'],
  // 2026-11-07 实测抓到的回归：/* glsl */ 与模板起始反引号同行
  ['行内块注释后跟模板起始', 'const s = /* glsl */ `\n// GLSL 注释\nvoid main(){}\n`;\n',
    'const s = /* glsl */ `\n// GLSL 注释\nvoid main(){}\n`;\n'],
  ['ASI：删注释不粘行', 'const a = 1\n// c\nconst b = 2\n', 'const a = 1\nconst b = 2\n'],
  ['连续注释行全删', '// 一\n// 二\nconst a=1;\n', 'const a=1;\n'],
];
console.log('① 手工边界用例');
for (const [name, src, want] of CASES) {
  const got = stripAppComments(src).code;
  check(name, got === want, 'got=' + JSON.stringify(got));
}

// ---------- 字符串字面量提取（对比用；两边用同一把尺子） ----------
function strings(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c, s = i; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      out.push(src.slice(s, i));
      continue;
    }
    i++;
  }
  return out;
}

// ---------- ②③ 真实源码 ----------
console.log('② 真实 app 源码：字符串字面量逐字节不变 + 单文件可编译');
const dir = path.join(ROOT, 'src', 'app');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
let totalRemoved = 0, totalBytes = 0, strMismatch = 0, compileFail = 0;
const pieces = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
  totalBytes += Buffer.byteLength(src);
  const r = stripAppComments(src);
  totalRemoved += r.removedBytes;
  const a = strings(src), b = strings(r.code);
  if (a.length !== b.length || a.some((s, i) => s !== b[i])) {
    strMismatch++;
    console.error('    字符串漂移: ' + f + ' (' + a.length + ' → ' + b.length + ')');
  }
  try { new vm.Script(r.code, { filename: f }); }
  catch (e) { compileFail++; console.error('    编译失败: ' + f + ' — ' + e.message); }
  pieces.push('\n// ===== ' + f + ' =====\n' + r.code);
}
check('字符串字面量序列 0 漂移', strMismatch === 0, strMismatch + ' 个文件');
check('每个文件独立可编译', compileFail === 0, compileFail + ' 个文件');

console.log('③ 剥离后的整包可编译 + 收益不低于阈值');
const bundle = '(function(){\n' + pieces.join('\n') + '\n})();';
try { new vm.Script(bundle, { filename: 'app-bundle.js' }); check('整包 V8 编译通过', true); }
catch (e) { check('整包 V8 编译通过', false, e.message); }
check('剥离量 > 100 KB（防实现退化）', totalRemoved > 100 * 1024,
  (totalRemoved / 1024).toFixed(1) + ' KB');
console.log(`  统计：${files.length} 文件 / ${(totalBytes / 1024).toFixed(0)} KB → 删 ` +
  `${(totalRemoved / 1024).toFixed(1)} KB (${(totalRemoved / totalBytes * 100).toFixed(1)}%)`);

if (failed) { console.error(`\nRESULT FAIL — ${failed} 项`); process.exit(1); }
console.log('\nRESULT PASS');
