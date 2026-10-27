// ============================================================
// tools/check_undefined.mjs — 自由标识符（undefined-global）影子检查器
// ============================================================
// 背景（2026-10-26 升级计划 §3.3，承接 10-25 撤回的 P1-4）：
//   现有门禁（check_topology）只查"跨文件符号契约"，查不出**本文件内**
//   的拼写笔误——如 `scones` vs `scopes`、`S._leannP` 这类。当年直接上
//   "未定义检查"因 591 假阳性撤回；如今 check_topology 的 analyzeFile
//   已具备完整作用域栈（形参/try-catch/for-of/解构/单参箭头全登记），
//   externalRefs 就是"自由标识符"集合——只需一个薄装配层：
//     自由标识符 − 全局环境（浏览器/JS 内建 + 显式白名单） = 嫌疑笔误
//
// 影子模式纪律（先观察一周再转硬门禁）：
//   - 本检查器 **永不非零退出**，只打印报告（--strict 也不退出，仅标 [S]）；
//   - 转硬门禁条件：连续一周影子运行假阳性率 <5%（且无 [S] 级逃逸），
//     届时把 assertUndefined() 接进 build.mjs 并允许非零退出。
//
// 用法：
//   node tools/check_undefined.mjs              # 影子报告（默认）
//   node tools/check_undefined.mjs --json       # JSON 输出（供脚本聚合）
//   node tools/check_undefined.mjs --strict     # 报告里把嫌疑项标 [S]（仍不失败）
// 自测：node tools/check_undefined_selftest.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './check_topology.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- 全局环境白名单 ----------
// 浏览器 + JS 内建（只列"本项目实际可能用到"的超集；多列无害，只会漏报不会假阳）。
// 另含 build.mjs loader 注入段的闭合 IIFE 内符号（THREE 等 import 已在拼接前处理）。
const GLOBALS = new Set([
  // JS 语言内建
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity', 'globalThis',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError',
  'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
  'Float64Array', 'BigInt64Array', 'BigUint64Array', 'BigInt', 'Intl', 'Reflect',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'eval', 'console', 'structuredClone',
  // 浏览器 DOM / Web API（本项目消费面）
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'alert', 'confirm', 'prompt', 'atob', 'btoa', 'fetch', 'WebSocket',
  'localStorage', 'sessionStorage', 'performance', 'getComputedStyle',
  'matchMedia', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio',
  'scrollX', 'scrollY', 'scrollTo', 'scrollBy', 'open', 'close', 'focus', 'blur',
  'CustomEvent', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent',
  'TouchEvent', 'WheelEvent', 'DragEvent', 'FocusEvent', 'InputEvent', 'UIEvent',
  'ResizeObserver', 'MutationObserver', 'IntersectionObserver',
  'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'MediaRecorder',
  'Blob', 'File', 'FileReader', 'FormData', 'URL', 'URLSearchParams',
  'Image', 'Bitmap', 'ImageBitmap', 'createImageBitmap', 'Canvas',
  'OffscreenCanvas', 'canvas', 'HTMLElement', 'HTMLCanvasElement', 'Element', 'Node',
  'DOMParser', 'XMLSerializer', 'CSS', 'DOMMatrix', 'DOMPoint', 'DOMRect',
  'ClipboardItem', 'clipboard', 'Proxy',
  'AbortController', 'TextEncoder', 'TextDecoder', 'crypto', 'caches',
  'Worker', 'SharedWorker', 'MessageChannel', 'BroadcastChannel',
  'speechSynthesis', 'SpeechSynthesisUtterance', 'webkitRequestFullscreen',
  'visualViewport', 'crossOriginIsolated', 'isSecureContext', 'origin', 'frames',
  'clientInformation', 'onload', 'top', 'parent', 'self', 'name', 'status', 'length',
  'XMLHttpRequest',
]);
// build.mjs loader 注入段顶层 const（在 IIFE 内，tokenize 看作全局——显式列出）
const LOADER_INJECTED = new Set(['_GQ', '_gqPump', '_gqOpen', '_gqNet']);
export const _globalsForProbe = () => new Set([...GLOBALS, ...LOADER_INJECTED, ...PREBUNDLED]);   // 诊断探针用
// 拼接前 import 的三方全局（源码里裸用 THREE——build.mjs 注入 import 后才有，但
// tokenize 按"拼接前单文件"视角把它当自由标识符）：显式白名单
const PREBUNDLED = new Set(['THREE', 'GLTFLoader', 'MeshoptDecoder', 'OrbitControls', 'EffectComposer', 'BufferGeometryUtils']);

// ---------- 装配 ----------
export function findUndefined(opts = {}) {
  // 兼容两种入参：{ files: [...] } 或直接传 [{file, src}] 数组。
  // 2026-10-27 踩坑：默认值写成 opts=[] 后 Array.isArray 真→files=[]→analyzeFiles([])
  // → perFile 空 → 0 嫌疑（整个调试期"离奇归零"的根因）。默认值必须是无参对象。
  const files = Array.isArray(opts) ? opts : opts.files;
  const analysis = files && files.length ? analyzeFilesCompat(files) : analyze();
  const suspects = [];
  for (const pf of analysis.perFile) {
    // 本文件顶层符号 + 其它文件顶层符号（拼接后可见）都算"已定义"
    const own = new Set(pf.symbols);
    for (const ref of pf.refs) {
      if (own.has(ref.name)) continue;
      if (analysis.symbolOwner.has(ref.name)) continue;   // 跨文件合法符号（拼接后同 IIFE 可见）
      if (GLOBALS.has(ref.name) || LOADER_INJECTED.has(ref.name) || PREBUNDLED.has(ref.name)) continue;
      suspects.push({ file: pf.file, name: ref.name, line: ref.line });
    }
  }
  // 按符号聚合（同名多行合并为一行报告）
  const byName = new Map();
  for (const s of suspects) {
    if (!byName.has(s.name)) byName.set(s.name, { name: s.name, hits: [] });
    byName.get(s.name).hits.push(`${s.file}:${s.line}`);
  }
  return [...byName.values()].map(v => ({ name: v.name, hits: v.hits }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// 合成样本兼容（自测用）：{file, src} 数组直通 analyzeFiles
import { analyzeFiles } from './check_topology.mjs';
function analyzeFilesCompat(files) { return analyzeFiles(files); }

// ---------- CLI（被 import 时不执行）----------
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('check_undefined.mjs')) {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const strict = argv.includes('--strict');
  const result = findUndefined();
  const total = result.reduce((n, r) => n + r.hits.length, 0);
  if (asJson) {
    console.log(JSON.stringify({ mode: 'shadow', suspects: result, totalHits: total }, null, 1));
  } else {
    console.log(`== 自由标识符影子报告（只警告不失败）==`);
    console.log(`嫌疑符号 ${result.length} 个，命中 ${total} 处`);
    for (const r of result) {
      const tag = strict && r.name.length >= 4 ? '[S] ' : '    ';
      console.log(`${tag}${r.name}  ←  ${r.hits.slice(0, 4).join(', ')}${r.hits.length > 4 ? ` …共${r.hits.length}处` : ''}`);
    }
    console.log(`影子模式：退出码恒 0；转硬门禁条件见本文件头注释。`);
  }
} else if (process.argv[1]?.endsWith('check_undefined_selftest.mjs')) {
  // 被 selftest import：静默（CLI 报告只属于直接执行场景）
}
