// ============================================================
// tools/check_topology.mjs — 模块依赖拓扑检查器（Phase 1-B）
// ============================================================
// 职责：在单 IIFE 拼接架构下，把"隐式全局耦合"变成可机器检查的显式契约：
//   1. 无反向引用——低编号文件不得引用高编号文件声明的顶层符号；
//   2. 跨文件依赖必须 ≤ docs/module-contracts.md 契约块声明的清单；
//   3. 被跨文件引用的顶层符号必须出现在提供方文件的 provides 里。
//
// 可靠性设计（架构方硬约束：零形参/局部遮蔽类假阳性）：
//   - 手写 tokenizer：剥离注释 / 字符串 / 模板字符串（${} 表达式内的
//     闭合花括号标记为专用 token，不与块作用域混淆）/ 正则字面量；
//   - 单遍 token 走查 + 作用域栈：函数与箭头形参、方法形参（(...) { 与
//     (...) => 两种形态）、catch、for-of 目标、const/let/var/class/function
//     声明全部登记；var/function 提升到最近函数作用域；
//   - 声明目标与初始化表达式区分：const a = <expr> 中 <expr> 的标识符
//     仍作为引用参与解析（关键：const W = buildWorld(...) 这类边不能丢）；
//   - 属性访问（obj.prop / obj?.prop）与对象字面量键不计引用。
//
// 用法：
//   node tools/check_topology.mjs --dump      # 分析模式：打印跨文件依赖图
//   node tools/check_topology.mjs --check     # 检查模式（默认）：违规非零退出
// 自测：node tools/check_topology_selftest.mjs（构造已知违规样本断言检出）
// 导出：analyze / checkTopology / assertTopology（build.mjs 前置调用）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, '..', 'src', 'app');
const CONTRACTS_MD = path.join(HERE, '..', 'docs', 'module-contracts.md');

// ---------- tokenizer ----------
const MULTI_PUNC = ['...', '=>', '?.', '**', '===', '!==', '==', '!=', '<=', '>=', '&&', '||', '??', '+=', '-=', '*=', '/=', '%=', '++', '--'];

function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  const push = (t, v) => toks.push({ t, v, line });

  // 模板字符串：返回 token 序列（${} 内部表达式递归 token 化，
  // 模板闭合花括号用专用 '$}' 标记，避免被块作用域计数误吞）
  function readTemplate() {
    i++; // 跳过开头 `
    push('punc', '`');
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '\n') { line++; i++; continue; }
      if (ch === '`') { i++; push('punc', '`'); return; }
      if (ch === '$' && src[i + 1] === '{') {
        i += 2; push('punc', '${');
        let depth = 1;
        while (i < n && depth > 0) {
          const c2 = src[i];
          if (c2 === '\n') { line++; i++; continue; }
          if (c2 === '\\') { i += 2; continue; }
          if (c2 === '"' || c2 === "'") { // 表达式内的字符串
            const q = c2, st = i; i++;
            while (i < n && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; }
            i++; push('str', src.slice(st, i)); continue;
          }
          if (c2 === '`') { readTemplate(); continue; }        // 嵌套模板
          if (c2 === '{') { depth++; push('punc', '{'); i++; continue; }
          if (c2 === '}') { depth--; if (depth === 0) { i++; push('punc', '$}'); } else { push('punc', '}'); i++; } continue; }
          scanOne();                                            // 其余交给通用扫描
        }
        continue;
      }
      i++; // 模板纯文本字符（内容无关，直接跳过）
    }
  }

  function scanOne() {
    const c = src[i];
    if (c === '\n') { line++; i++; return; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; return; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; return; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; return; }
    if (c === "'") { const q = c, st = i; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; } i++; push('str', 'q'); return; }
    if (c === '"') { const q = c, st = i; i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; } i++; push('str', 'q'); return; }
    if (c === '`') { readTemplate(); return; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++; push('id', src.slice(i, j)); i = j; return; }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9a-fA-FxX.eE_]/.test(src[j])) j++; push('num', src.slice(i, j)); i = j; return; }
    if (c === '/') {
      const p = prevSig();
      const isDiv = p && ((p.t === 'id' && !KEYWORDISH.has(p.v)) || p.t === 'num' ||
        (p.t === 'punc' && (p.v === ')' || p.v === ']' || p.v === '}' || p.v === '$}')));
      if (!isDiv) {
        const st = i; i++; let inCls = false, ok = false;
        while (i < n) {
          const ch = src[i];
          if (ch === '\\') { i += 2; continue; }
          if (ch === '\n') break;
          if (ch === '[') inCls = true;
          else if (ch === ']') inCls = false;
          else if (ch === '/' && !inCls) { i++; ok = true; break; }
          i++;
        }
        if (ok) { while (i < n && /[a-z]/.test(src[i])) i++; push('regex', 'r'); return; }
        i = st;
      }
    }
    for (const mp of MULTI_PUNC) {
      if (src.startsWith(mp, i)) { push('punc', mp); i += mp.length; return; }
    }
    push('punc', c); i++;
  }

  const KEYWORDISH = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'throw']);
  function prevSig() { for (let k = toks.length - 1; k >= 0; k--) if (toks[k].t !== 'comment') return toks[k]; return null; }

  while (i < n) scanOne();
  return toks;
}

// ---------- 单文件分析 ----------
const RESERVED = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'throw', 'try', 'catch', 'finally', 'const', 'let', 'var', 'function', 'class', 'extends', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'void', 'this', 'super', 'true', 'false', 'null', 'undefined', 'import', 'export', 'from', 'as', 'async', 'await', 'yield', 'static', 'get', 'set']);

function analyzeFile(src) {
  const toks = tokenize(src);
  const fileSymbols = new Set();       // 本文件顶层声明（物理深度判定：栈外声明）
  const externalRefs = [];             // [{ name, line }]（含全局名——装配阶段过滤）
  const scopes = [{ names: new Set(), fn: true }];
  let braceStack = [];                 // 每个元素: true（块作用域随 '{' 压/'}' 弹）
  const pushScope = fn => scopes.push({ names: new Set(), fn: !!fn });
  const popScope = () => scopes.pop();
  const declareHere = name => { if (scopes.length) scopes[scopes.length - 1].names.add(name); };
  const declareFn = name => { for (let k = scopes.length - 1; k >= 0; k--) if (scopes[k].fn) { scopes[k].names.add(name); return; } declareHere(name); };
  // 顶层声明：物理深度为 0（不在任何块/括号内）时的声明动作登记为文件级符号。
  // 与作用域栈解耦——栈失衡（如语句末缺失分号导致表达式作用域未弹）不再
  // 影响顶层符号识别。
  const atTop = () => braceStack.length === 0 && parenDepth === 0;
  const declareTop = name => { declareHere(name); if (atTop()) fileSymbols.add(name); };
  const declareTopFn = name => { declareFn(name); if (atTop()) fileSymbols.add(name); };
  const TRACE = process.env.TOPO_TRACE === '1';
  const isLocal = name => scopes.some(s => s.names.has(name));

  // 在 idx 处应为一个 '('：收集其配对 ')' 区间内的所有标识符为形参并返回 ')' 下标
  function collectParams(idx, into) {
    let depth = 0;
    let k = idx;
    for (; k < toks.length; k++) {
      const tk = toks[k];
      if (tk.t === 'punc' && (tk.v === '(' || tk.v === '[' || tk.v === '{')) depth++;
      else if (tk.t === 'punc' && (tk.v === ')' || tk.v === ']' || tk.v === '}')) { depth--; if (depth === 0 && tk.v === ')') break; }
      else if (tk.t === 'id' && depth === 1) into.add(tk.v);
    }
    return k;
  }

  let declMode = false;     // 正在 const/let/var 声明语句中
  let expectingTarget = false;
  let parenDepth = 0;
  let pendingParams = null; // 待注入下一个函数体 '{' 作用域的形参集合
  let exprScopeCount = 0;   // 语句级临时作用域数（表达式体箭头参数，遇到顶格 ';' 弹出）

  const CTRL_HEADS = new Set(['if', 'for', 'while', 'switch']);

  // 在 '(' 记号处调用：找配对 ')' 的下标（含嵌套）
  function matchParen(open) {
    let d = 0;
    for (let k = open; k < toks.length; k++) {
      const t2 = toks[k];
      if (t2.t === 'punc' && (t2.v === '(' || t2.v === '[' || t2.v === '{')) d++;
      else if (t2.t === 'punc' && (t2.v === ')' || t2.v === ']' || t2.v === '}')) { d--; if (d === 0) return k; }
    }
    return -1;
  }
  function idsInParen(open, close) {
    const set = new Set();
    let d = 0;
    for (let k = open; k <= close; k++) {
      const t2 = toks[k];
      if (t2.t === 'punc' && (t2.v === '(' || t2.v === '[' || t2.v === '{')) d++;
      else if (t2.t === 'punc' && (t2.v === ')' || t2.v === ']' || t2.v === '}')) d--;
      else if (t2.t === 'id' && d === 1) set.add(t2.v);
    }
    return set;
  }

  for (let idx = 0; idx < toks.length; idx++) {
    const tk = toks[idx];
    const prev = toks[idx - 1], next = toks[idx + 1];
    if (tk.t !== 'id' && tk.t !== 'punc') continue;
    if (tk.t === 'punc') {
      const v = tk.v;
      if (v === '(') {
        parenDepth++;
        // 前瞻：(...) => 或 (...) { 且头部不是控制关键字 → 收集形参。
        // 参数区间整体跳过（形参与解构模式不是引用；默认值表达式的引用被
        // 舍弃——宁可漏报也不假阳性）。块体形参由随后的 '{' 注入作用域。
        const close = matchParen(idx);
        const head = toks[idx - 1];
        const isCtrl = head && head.t === 'id' && CTRL_HEADS.has(head.v);
        if (close > 0 && !isCtrl) {
          const after = toks[close + 1];
          if (after && after.t === 'punc' && (after.v === '=>' || after.v === '{')) {
            pendingParams = idsInParen(idx, close);
            idx = close - 1;   // 让主循环下一步恰好落在 ')' 上正常处理（配对计数不失衡）
          }
        }
        continue;
      }
      if (v === '[') { parenDepth++; continue; }
      if (v === ')' || v === ']') { parenDepth--; declMode = false; expectingTarget = false; continue; }
      if (v === '{') {
        pushScope(false);
        braceStack.push(true);
        if (TRACE) console.error(`[trace] { push L${tk.line} -> brace=${braceStack.length}`);
        if (pendingParams) { for (const p of pendingParams) declareHere(p); pendingParams = null; }
        continue;
      }
      if (v === '}') { if (braceStack.pop()) popScope(); if (TRACE) console.error(`[trace] } pop  L${tk.line} -> brace=${braceStack.length}`); continue; }
      if (v === '$}' || v === '${' || v === '`') continue;
      if (v === ';') {
        declMode = false; expectingTarget = false;
        // 弹出语句级表达式箭头参数作用域（顶格分号 = 语句结束）
        if (parenDepth === 0) { while (exprScopeCount > 0) { popScope(); exprScopeCount--; } }
        continue;
      }
      if (v === '=>') {
        if (pendingParams) {
          if (next && next.t === 'punc' && next.v === '{') { /* 形参由 '{' 注入 */ }
          else {
            // 表达式体箭头：参数装入语句级临时作用域（顶格 ';' 弹出），
            // 避免污染模块作用域成为假符号
            pushScope(true); exprScopeCount++;
            for (const p of pendingParams) declareHere(p);
            pendingParams = null;
          }
        }
        declMode = false; expectingTarget = false;
        continue;
      }
      continue;
    }
    // ---- 以下 tk.t === 'id' ----
    const w = tk.v;
    if (RESERVED.has(w)) {
      if (w === 'const' || w === 'let' || w === 'var') { declMode = true; expectingTarget = true; continue; }
      if (w === 'function') {
        if (next && next.t === 'id') { if (TRACE) console.error(`[trace] function ${next.v} L${tk.line} brace=${braceStack.length} paren=${parenDepth}`); declareTopFn(next.v); }
        continue; // 形参由通用 '(' 前瞻 + '{' 注入
      }
      if (w === 'class') {
        if (next && next.t === 'id') { if (TRACE) console.error(`[trace] class ${next.v} L${tk.line} brace=${braceStack.length} paren=${parenDepth}`); declareTop(next.v); }
        continue; // 类体由通用 '{' 块作用域处理
      }
      if (w === 'catch') continue; // catch(e) 的 e 由通用 '(' 前瞻 + '{' 注入
      continue;
    }
    // 方法名：前驱是类体层 '{'/';'/',' 且后继是 '(' → 是方法定义而非引用。
    // 需与调用语句区分：方法名的 '(' 配对 ')' 后紧跟 '{'（函数体），调用则不是。
    if (prev && prev.t === 'punc' && ['{', ';', ','].includes(prev.v) && next && next.t === 'punc' && next.v === '(') {
      const close = matchParen(idx + 1);
      if (close > 0) {
        const after = toks[close + 1];
        if (after && after.t === 'punc' && after.v === '{') continue; // 方法定义名
      }
    }
    // 声明目标 vs 引用
    if (declMode) {
      const afterKeyword = prev && prev.t === 'id' && (prev.v === 'const' || prev.v === 'let' || prev.v === 'var');
      const afterComma = prev && prev.t === 'punc' && prev.v === ',' && parenDepth === 0;
      // 解构模式 { a, b } / [a, b] 的目标由 expectingTarget/afterComma 路径自然
      // 覆盖（'{' 压栈与 '}' 弹栈保持配对，不做任何索引跳跃——跳跃会吞掉配对
      // 令牌造成 braceStack/parenDepth 失衡，实测教训）
      if (expectingTarget || afterKeyword || afterComma) {
        declareTop(w); expectingTarget = false;
        continue;
      }
      // 声明语句内的其他标识符 = 初始化表达式引用 → 落到下方通用引用处理
    }
    // 单参箭头（无括号）：id =>
    if (next && next.t === 'punc' && next.v === '=>') {
      const afterArrow = toks[idx + 2];
      if (afterArrow && afterArrow.t === 'punc' && afterArrow.v === '{') {
        pendingParams = new Set([w]);   // 块体由 '{' 注入
      } else {
        // 表达式体：参数装入语句级临时作用域，顶格 ';' 弹出（防模块作用域污染）
        pushScope(true); exprScopeCount++;
        declareHere(w);
      }
      continue;
    }
    // —— 通用引用 ——
    // 属性访问：obj.prop / obj?.prop
    if (prev && prev.t === 'punc' && (prev.v === '.' || prev.v === '?.')) continue;
    // 对象字面量键：前驱 { 或 , 且后继 :
    if (prev && prev.t === 'punc' && (prev.v === '{' || prev.v === ',') && next && next.t === 'punc' && next.v === ':') continue;
    if (isLocal(w)) continue;
    externalRefs.push({ name: w, line: tk.line });
  }
  return { fileSymbols: [...fileSymbols], externalRefs };
}

// ---------- 多文件装配 ----------
function listAppFiles() {
  return fs.readdirSync(APP_DIR).filter(f => f.endsWith('.js'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

export { analyzeFile };

// files: [{ file: '01-xxx.js', src: '<源码>' }]（自测用合成样本；真实文件走 analyze()）
export function analyzeFiles(files) {
  const symbolOwner = new Map();
  const perFile = [];
  for (const f of files) {
    const { fileSymbols, externalRefs } = analyzeFile(f.src);
    perFile.push({ file: f.file, symbols: fileSymbols, refs: externalRefs });
    for (const s of fileSymbols) if (!symbolOwner.has(s)) symbolOwner.set(s, f.file);
  }
  // 按符号去重（保留首个行号），避免同一引用点多行噪声
  const seen = new Set();
  const edges = [];
  for (const pf of perFile) {
    const own = new Set(pf.symbols);
    for (const ref of pf.refs) {
      if (own.has(ref.name)) continue;
      const target = symbolOwner.get(ref.name);
      if (!target || target === pf.file) continue;
      const key = pf.file + '→' + target + ':' + ref.name;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: pf.file, to: target, symbol: ref.name, line: ref.line });
    }
  }
  edges.sort((a, b) => (parseInt(a.from, 10) - parseInt(b.from, 10)) || a.symbol.localeCompare(b.symbol));
  return { files: files.map(f => f.file), perFile, edges, symbolOwner };
}

export function analyze() {
  return analyzeFiles(listAppFiles().map(f => ({ file: f, src: fs.readFileSync(path.join(APP_DIR, f), 'utf8') })));
}
// ---------- 检查 ----------
// opts.files: [{file, src}] 合成样本（缺省用真实 src/app/*.js）
// opts.contractsContent: 契约 md 内容字符串（缺省读真实 docs/module-contracts.md；
//                        显式传 null 跳过契约检查——自测反向引用样本时用）
export function checkTopology(opts = {}) {
  const { edges } = opts.files ? analyzeFiles(opts.files) : analyze();
  const violations = [];
  const fnum = f => parseInt(f, 10);
  // 反向引用：低编号文件读高编号文件声明的符号（from < to）
  for (const e of edges) {
    if (fnum(e.from) < fnum(e.to)) {
      violations.push({ type: 'reverse-ref', from: e.from, to: e.to, symbol: e.symbol, line: e.line,
        msg: `${e.from} L${e.line} 反向引用 ${e.to} 的顶层符号 "${e.symbol}"（低编号不得依赖高编号）` });
    }
  }
  // 契约符合性
  let contractsContent = opts.contractsContent;
  if (contractsContent === undefined) {
    contractsContent = fs.existsSync(CONTRACTS_MD) ? fs.readFileSync(CONTRACTS_MD, 'utf8') : null;
  }
  if (contractsContent) {
    const m = String(contractsContent).match(/```json-contracts\s*\n([\s\S]*?)```/);
    if (!m) {
      violations.push({ type: 'contract-format', msg: 'docs/module-contracts.md 缺少 ```json-contracts 契约块' });
    } else {
      let contracts = null;
      try { contracts = JSON.parse(m[1]); }
      catch (err) { violations.push({ type: 'contract-format', msg: `契约块 JSON 解析失败：${err.message}` }); }
      if (contracts) {
        for (const e of edges) {
          const c = contracts[e.from];
          const dep = c && c.depends && c.depends[e.to];
          if (!dep || !dep.includes(e.symbol)) {
            violations.push({ type: 'undeclared-dep', from: e.from, to: e.to, symbol: e.symbol, line: e.line,
              msg: `${e.from} L${e.line} 引用 ${e.to} 的 "${e.symbol}" 未在契约块 depends 声明` });
          }
          const c2 = contracts[e.to];
          if (!c2 || !c2.provides || !c2.provides.includes(e.symbol)) {
            violations.push({ type: 'unlisted-provide', from: e.from, to: e.to, symbol: e.symbol, line: e.line,
              msg: `${e.to} 的 "${e.symbol}" 被 ${e.from} 跨文件引用，但未出现在契约块 provides` });
          }
        }
      }
    }
  }
  return violations;
}

export function assertTopology() {
  const v = checkTopology();
  if (v.length) {
    const lines = v.map(x => `  [${x.type}] ${x.msg}`);
    throw new Error(`check_topology: ${v.length} 处违规\n${lines.join('\n')}`);
  }
  console.log('拓扑检查：无反向引用，跨文件依赖符合契约（详见 docs/module-contracts.md）');
  return v;
}

// ---------- CLI（仅作为主模块运行时） ----------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2] || '--check';
  if (mode === '--dump') {
    const { edges, perFile } = analyze();
    const rev = edges.filter(e => parseInt(e.from, 10) < parseInt(e.to, 10));   // 低读高 = 违规
    const fwd = edges.filter(e => parseInt(e.from, 10) > parseInt(e.to, 10));   // 高读低 = 合法
    const filePairs = new Set(edges.map(e => e.from + '→' + e.to));
    console.log(`文件 ${perFile.length} 个；符号级边 ${edges.length} 条（合法正向 ${fwd.length} / 反向违规 ${rev.length}）；文件级依赖边 ${filePairs.size} 条`);
    console.log('\n== 反向引用（违规：低编号读高编号）==');
    for (const e of rev) console.log(`${e.from} --${e.symbol}--> ${e.to}  (L${e.line})`);
    console.log('\n== 正向边（合法）==');
    for (const e of fwd) console.log(`${e.from} --${e.symbol}--> ${e.to}  (L${e.line})`);
  } else {
    const { edges } = analyze();
    const v = assertTopology();
    console.log(`拓扑检查：跨文件边 ${edges.length} 条，违规 ${v.length}`);
  }
}
