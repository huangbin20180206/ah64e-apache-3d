// ============================================================
// strip_comments.mjs — 构建期内联 JS 的保守注释剥离（P2-1）
// ------------------------------------------------------------
// 单文件 HTML 是项目红线：src/app/*.js 被原样拼进 <script> 内联包，
// 源码里 25.6% 的字节是整行中文设计注释，浏览器每次都要下载却永远不执行。
// 本模块只做**零语义风险**的那一刀：
//
//   1. 只删「整行独占」的 // 注释与 /* ... */ 注释（行首可有空白）；
//   2. 注释正文含引号/反引号/反斜杠/斜杠/星号/$/< /> 的一律不删
//      —— 这些可能是文档里贴的代码片段、URL、GLSL 片段，宁可少省；
//   3. //! 与 /*! 开头的许可/法律头一律保留；
//   4. 跨行块注释内部、跨行模板字符串内部的行一律不删；
//   5. **其余每一行原样保留，一个字节都不改**，换行数只减不增
//      —— 不合并行、不动缩进、不动行尾注释，因此 ASI（自动分号插入）
//      与 onBeforeCompile 的 #include <...> / GLSL 字符串全部不受影响。
//
// 它只作用于产物 dist，源码注释完整保留；线上调试用
//   APACHE_KEEP_COMMENTS=1 node build.mjs
// 重建一份带注释的包。自测见 tools/strip_comments_selftest.mjs。
// ============================================================

// 被判定为"安全的纯注释行"时，正文里不允许出现的字符。
// 注意：斜杠与星号也在此列——避免把 GLSL、正则、URL 片段当作可删注释。
const RISKY = /[`"'\\/*$<>]/;

/**
 * @param {string} src 单个 app 源文件的文本（LF）
 * @returns {{code: string, removedLines: number, removedBytes: number, keptLines: number}}
 */
export function stripAppComments(src) {
  const lines = src.split('\n');
  const out = [];
  const st = { inBlock: false, inTpl: false };   // 未闭合的 /* ... */ / 跨行 ` ... `
  let removedLines = 0, removedBytes = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    let drop = false;
    if (!st.inBlock && !st.inTpl) {
      if (trimmed.startsWith('//!') || trimmed.startsWith('/*!')) {
        // 许可 / 法律声明：保留
      } else if (trimmed.startsWith('//')) {
        drop = !RISKY.test(trimmed.slice(2));
      } else if (/^\/\*.*\*\/$/.test(trimmed)) {
        drop = !/[`"'\\$<>]/.test(trimmed.slice(2, -2));   // 独占整行的块注释
      }
    }
    if (drop) {
      removedLines++;
      removedBytes += Buffer.byteLength(line) + 1;   // +1 是被删掉的换行
      continue;
    }
    out.push(line);
    updateState(line, st);
  }
  return { code: out.join('\n'), removedLines, removedBytes, keptLines: out.length };
}

// 逐字符扫描一行，更新「是否处在跨行块注释 / 模板字符串」。
// 只需要这两个状态：行注释与单行字符串不可能跨行；普通代码行不可能
// 在行首产生 // 或 /* 之外的注释起点。正则字面量里的引号按代码扫会
// 误判成字符串起点，但 RISKY 护栏已经排除了所有含引号的注释行，
// 误判最多让我们少删几行，不会删掉正在渲染的内容。
function updateState(line, st) {
  let i = 0, quote = null;
  while (i < line.length) {
    if (st.inBlock) {
      const e = line.indexOf('*/', i);
      if (e < 0) return;                       // 块注释仍未闭合
      st.inBlock = false; i = e + 2; continue; // 闭合后**继续扫本行剩余代码**
    }
    if (st.inTpl) {
      let closed = -1;
      for (let j = i; j < line.length; j++) {
        if (line[j] === '\\') { j++; continue; }
        if (line[j] === '`') { closed = j; break; }
      }
      if (closed < 0) return;                  // 模板字符串仍未闭合
      st.inTpl = false; i = closed + 1; continue;
    }
    if (quote) {
      if (line[i] === '\\') { i += 2; continue; }
      if (line[i] === quote) quote = null;
      i++; continue;
    }
    const c = line[i], n = line[i + 1];
    if (c === '/' && n === '*') {
      const e = line.indexOf('*/', i + 2);
      if (e < 0) { st.inBlock = true; return; }
      // 2026-11-07 修复：`fragmentShader: /* glsl */` + 反引号同行时，
      // 早期版本在此处直接 return，漏掉后面的模板起始符，
      // 于是 GLSL 正文里的 // 注释行会被当成 JS 注释删掉。
      i = e + 2; continue;
    }
    if (c === '/' && n === '/') return;        // 行注释：本行后续无代码
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === '`') { st.inTpl = true; i++; continue; }
    i++;
  }
}
