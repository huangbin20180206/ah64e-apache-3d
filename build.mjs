// ============================================================
// build.mjs — 把 three + GLTFLoader + src/app/*.js 打进单个 HTML
// 用法：node build.mjs
// 产物：dist/index.html + dist/assets/（GLB 与蒙皮保持外部文件）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { assertDomIds } from './tools/check_dom_ids.mjs';
import { assertTopology } from './tools/check_topology.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC = path.join(ROOT, 'src');
const VENDOR = path.join(ROOT, 'vendor');
const DIST = path.join(ROOT, 'dist');

// Phase 1-B：模块依赖拓扑检查（无反向引用 / 依赖≤契约 / 引用符号入契约）
// —— 与 DOM id 契约同性质：违规直接构建失败（契约见 docs/module-contracts.md）
assertTopology();

// Phase 0-0.7：构建前清空 dist——从可预测的干净输出目录开始，
// 不保留上一次构建的遗留资产（raw GLB/FBX/测试文件等）
fs.rmSync(DIST, { recursive: true, force: true });

// 读入即归一化 CRLF→LF：构建输入可能因仓库 checkout 配置（core.autocrlf）残留
// 陈旧 CRLF 工作区副本（实测 vendor/GLTFLoader.js 曾有 4663 个 CR），而 blob/新
// 克隆是 LF——产物字节必须与工作区换行状态解耦，任何机器、任何 clone 配置下
// dist 逐字节可复现（Phase 0-0.7 跨机器复现修复，2026-09-04）
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// ---------- 1. three.module.min.js -> const THREE = {...} ----------
function buildThree() {
  let js = read(path.join(SRC, 'three.module.min.js'));
  const m = js.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!m) throw new Error('未在 three.module.min.js 尾部找到 export {...}');
  const pairs = m[1].split(',').map(s => s.trim()).filter(Boolean).map(e => {
    const a = e.split(/\s+as\s+/);
    // `x as Y` -> `Y:x`；裸 `x` -> `x:x`
    return a.length === 2 ? `${a[1]}:${a[0]}` : `${a[0]}:${a[0]}`;
  });
  const names = pairs.map(p => p.split(':')[0]);
  js = js.slice(0, m.index) + `\nconst THREE = {${pairs.join(',')}};\n`;
  return { js, names: new Set(names) };
}

// ---------- 2. vendor 模块：去掉 import / export 关键字 ----------
// 返回 {js, needs:Set<string>}，needs 是它从 'three' 里取的符号
function stripModule(file) {
  let js = read(path.join(VENDOR, file));
  const needs = new Set();

  // 头部 `import { ... } from 'three';`
  js = js.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]three['"]\s*;?/g, (_, body) => {
    for (const n of body.split(',').map(s => s.trim()).filter(Boolean)) needs.add(n);
    return '';
  });
  // 其它相对路径 import（BufferGeometryUtils 已内联，直接删）
  js = js.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.[^'"]*['"]\s*;?/g, '');
  // 尾部 export 列表
  js = js.replace(/export\s*\{[\s\S]*?\}\s*;?/g, '');
  // `export function foo` / `export class Foo` / `export const foo`
  js = js.replace(/^export\s+(?=(function|class|const|let|var)\b)/gm, '');
  return { js, needs };
}

// ---------- 3. 按数字前缀拼接 app 模块 ----------
function buildApp() {
  const dir = path.join(SRC, 'app');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
  console.log('app 模块顺序：' + files.join(' → '));
  const all = files.map(f => `\n// ===== ${f} =====\n` + read(path.join(dir, f))).join('\n');
  // 防 IIFE 破坏：app 代码禁止出现模块语法（会逃逸单 IIFE 共享作用域约定）。
  // from 后跟任意引号内容都算；`import(` 动态导入同样破坏单文件形态
  if (/\bimport\s*[\{(]|from\s*['"]/.test(all)) {
    const bad = files.filter(f => /\bimport\s*[\{(]|from\s*['"]/.test(read(path.join(dir, f))));
    throw new Error('app 模块出现 import 语法（IIFE 约定禁止）：' + bad.join(', '));
  }
  return all;
}

// ---------- 主流程 ----------
// 构建前静态检查 UI(id) 契约：拼错或改 template 漏改会在运行时才炸，
// 而且往往藏在切场地/进 FPV 之后才走的分支里，冒烟测试抓不到。
// 与上面的禁 import 检查同性质——宁可构建失败，不要发出坏产物。
{
  const r = assertDomIds(ROOT);
  console.log(`id 契约检查：template ${r.defined.size} 个 / 代码引用 ${r.used.size} 个 / 死引用 0`);
}

const three = buildThree();
const bgu = stripModule('BufferGeometryUtils.js');
const gltf = stripModule('GLTFLoader.js');
// meshoptimizer 官方解码器（MIT，内嵌 wasm，~29KB）：assets/*.glb 已做 EXT_meshopt_compression
// 无损压缩（不量化，顶点/索引逐三角形等价），GLTFLoader 必须注入解码器才能读
const meshopt = stripModule('meshopt_decoder.js');

// 两个 vendor 文件所需符号的并集，一次性从 THREE 解构出来
const needs = [...new Set([...bgu.needs, ...gltf.needs])].sort();
const missing = needs.filter(n => !three.names.has(n));
if (missing.length) throw new Error('three 未导出这些符号：' + missing.join(', '));
const destructure = `const {\n  ${needs.join(',\n  ')}\n} = THREE;\n`;

const loaderJs = [
  // 包一层 IIFE：three 压缩后有大量单字母顶层名，避免与内联代码撞名
  '(function(){',
  destructure,
  '// ===== BufferGeometryUtils.js（已内联）=====',
  bgu.js,
  '// ===== GLTFLoader.js（已内联）=====',
  gltf.js,
  '// ===== meshopt_decoder.js（已内联）=====',
  meshopt.js,
  // 统一注入：app 里所有 new THREE.GLTFLoader() 自动具备 meshopt 解码能力，app 代码零改动
  // 2026-10-23 vis1：loader.priority=true 的（目标车辆）插队到队首——车辆是画面主角，不该排在几十个道具后面。
  // 2026-10-21 首屏优先：机体 GLB 先下，其余 GLB 等机体就位（或 8 秒兜底）后排队、最多 4 个同时下载。
  // 旧行为是几十个目标/道具 GLB 与机体同时抢带宽，机体（首屏唯一必需）被拖慢。
  'const _gqNet = () => { try { const c = navigator.connection; if (!c) return 4; if (c.saveData) return 2; const e = c.effectiveType; return e === "slow-2g" || e === "2g" ? 1 : e === "3g" ? 2 : 4; } catch (e) { return 4; } };',
  'const _GQ = { open: false, active: 0, q: [], MAX: _gqNet() };',   // 2026-10-25：按网络档位定并发下载数（未知=4）
  // 2026-10-26：网络档位变化（WiFi↔蜂窝/ Signal 强弱）时重算并发上限；connection 为 null 的浏览器（Safari）无事件，保持初值
  'try { const _c = navigator.connection; if (_c && _c.addEventListener) _c.addEventListener("change", () => { _GQ.MAX = _gqNet(); _gqPump(); }); } catch (e) {}',
  'const _gqPump = () => { while (_GQ.open && _GQ.active < _GQ.MAX && _GQ.q.length) { const f = _GQ.q.shift(); _GQ.active++; f(); } };',
  'const _gqOpen = () => { if (!_GQ.open) { _GQ.open = true; _gqPump(); } };',
  'setTimeout(_gqOpen, 8000);',
  'THREE.GLTFLoader = class extends GLTFLoader {',
  '  constructor(m) { super(m); this.setMeshoptDecoder(MeshoptDecoder); }',
  '  load(url, onLoad, onProgress, onError) {',
  '    if (/apache_v2\\.glb$/.test(url)) {',
  '      return super.load(url, (g) => { _gqOpen(); if (onLoad) onLoad(g); }, onProgress, (e) => { _gqOpen(); if (onError) onError(e); else console.error(e); });',
  '    }',
  '    const done = () => { _GQ.active--; _gqPump(); };',
  '    const f = () => super.load(url, (g) => { done(); if (onLoad) onLoad(g); }, onProgress, (e) => { done(); if (onError) onError(e); else console.error(e); });',
  '    if (this.priority) { f.p = 1; let i = 0; while (i < _GQ.q.length && _GQ.q[i].p) i++; _GQ.q.splice(i, 0, f); } else _GQ.q.push(f);',
  '    _gqPump();',
  '  }',
  '};',
  'THREE.MeshoptDecoder = MeshoptDecoder;',
  '})();',
].join('\n');

const appJs = '(function(){\n' + buildApp() + '\n})();';

// 内联的 JS 里若出现 </script> 会提前闭合标签
for (const [name, js] of [['three', three.js], ['loader', loaderJs], ['app', appJs]]) {
  if (/<\/script/i.test(js)) throw new Error(`${name} 中含有 </script，会破坏 HTML`);
}

let html = read(path.join(SRC, 'template.html'));
for (const [mark, js] of [['/*__THREE__*/', three.js], ['/*__LOADER__*/', loaderJs], ['/*__APP__*/', appJs]]) {
  if (!html.includes(mark)) throw new Error('template.html 缺少占位符 ' + mark);
  html = html.replace(mark, () => js);
}

// Phase 13 证据闭环（复核一轮项二）：构建身份注入。
// 页面运行时暴露不可伪造的构建身份：git HEAD SHA + 内联 app 包 SHA-256。
// bundle_sha256 定义为"内联 JS 包（three+loader+app 拼接体，即 dist/app-check.mjs
// 内容）"的 SHA-256——与页面 HTML 解耦，无自引用固定点问题；该内容同时落盘为
// dist/app-check.mjs，A/B 采样器可在服务端对同一 worktree 的 dist/app-check.mjs
// 独立重算哈希并与页面读数比对，双端一致才可信。HEAD 解析失败记 'unknown'。
let gitSha;
try {
  gitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch {
  gitSha = 'unknown';
}
const appBundle = three.js + '\n' + loaderJs + '\n' + appJs;
const bundleSha = crypto.createHash('sha256').update(appBundle, 'utf8').digest('hex');
const buildIdJs = `\n<script>\n;(function(){ try { var __b = window.__BUILD_ID = window.__BUILD_ID || {}; ` +
  `__b.git_sha = ${JSON.stringify(gitSha)}; ` +
  `__b.bundle_sha256 = '${bundleSha}'; } catch(e){} })();\n</script>\n`;
html = html.replace(/<\/body>\s*<\/html>\s*$/, `${buildIdJs}</body>\n</html>`);
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'index.html'), html);
console.log('buildId git_sha=%s bundle_sha256=%s', gitSha, bundleSha);

// GLB 已 meshopt 压缩（4.7MB→2.9MB），仍保持外部文件由浏览器流式下载
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
for (const f of ['apache_v2.glb', 'skin_army.jpg']) {
  fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(DIST, 'assets', f));
}
// Phase 13-A1：真实音频样本（自合成 WAV，≤1.5MB 预算）——18-audio fetch
// 相对路径 assets/audio/*.wav，缺失会 404 静默降级，但清单必须同步（约束 A1）
fs.mkdirSync(path.join(DIST, 'assets', 'audio'), { recursive: true });
let _audioN = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'audio'))) {
  if (f.endsWith('.wav')) {
    fs.copyFileSync(path.join(ROOT, 'assets', 'audio', f), path.join(DIST, 'assets', 'audio', f));
    _audioN++;
  }
}
// P5-G1：真实录音武器音效（CC0，assets/audio/sfx/*.mp3 + LICENSE.txt）
fs.mkdirSync(path.join(DIST, 'assets', 'audio', 'sfx'), { recursive: true });
let _sfxN = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'audio', 'sfx'))) {
  if (f.endsWith('.mp3') || f.endsWith('.txt')) {
    fs.copyFileSync(path.join(ROOT, 'assets', 'audio', 'sfx', f), path.join(DIST, 'assets', 'audio', 'sfx', f));
    if (f.endsWith('.mp3')) _sfxN++;
  }
}
// E2 无线电喊话（AI 合成语音 + 无线电处理，assets/audio/radio/*.mp3 + NOTE.txt）
fs.mkdirSync(path.join(DIST, 'assets', 'audio', 'radio'), { recursive: true });
let _radioN = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'audio', 'radio'))) {
  if (f.endsWith('.mp3') || f.endsWith('.txt')) {
    fs.copyFileSync(path.join(ROOT, 'assets', 'audio', 'radio', f), path.join(DIST, 'assets', 'audio', 'radio', f));
    if (f.endsWith('.mp3')) _radioN++;
  }
}
// AI 生成的高质量靶标模型（FBX 原始产物体积大，不入库不复制）
fs.mkdirSync(path.join(DIST, 'assets', 'targets'), { recursive: true });
let _tgtN = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'targets'))) {
  if (f.endsWith('.glb') && !f.includes('_raw')) {   // _raw 原始件不入 dist
    fs.copyFileSync(path.join(ROOT, 'assets', 'targets', f), path.join(DIST, 'assets', 'targets', f));
    _tgtN++;
  }
}
// P10 重点部件细节件（Blender 受控低模，仅独立小 GLB；高模/源资产绝不复制）
// 远景树线贴图图集（31-scenery，CC0 Poly Haven 渲染图拼合）
fs.mkdirSync(path.join(DIST, 'assets', 'scenery'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'scenery'))) {
  if (f.endsWith('.webp')) fs.copyFileSync(path.join(ROOT, 'assets', 'scenery', f), path.join(DIST, 'assets', 'scenery', f));
}
// 装备图鉴（71-armory）：Wikimedia Commons 照片 assets/armory/*.webp + LICENSE.txt
fs.mkdirSync(path.join(DIST, 'assets', 'armory'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'armory'))) {
  if (f.endsWith('.webp') || f.endsWith('.txt')) fs.copyFileSync(path.join(ROOT, 'assets', 'armory', f), path.join(DIST, 'assets', 'armory', f));
}
fs.mkdirSync(path.join(DIST, 'assets', 'details'), { recursive: true });
let _detN = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'details'))) {
  if (f.endsWith('.glb')) {
    fs.copyFileSync(path.join(ROOT, 'assets', 'details', f), path.join(DIST, 'assets', 'details', f));
    _detN++;
  }
}

// 供 node --check 做语法体检（内容与注入 buildId 的 appBundle 完全一致）
fs.writeFileSync(path.join(DIST, 'app-check.mjs'), appBundle);

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log('dist/index.html  ' + kb(Buffer.byteLength(html)));
console.log('  three          ' + kb(Buffer.byteLength(three.js)));
console.log('  loader         ' + kb(Buffer.byteLength(loaderJs)) + '（解构 ' + needs.length + ' 个符号）');
console.log('  app            ' + kb(Buffer.byteLength(appJs)));
console.log('dist/assets/     apache_v2.glb + skin_army.jpg + targets/' + _tgtN + ' glb + details/' + _detN + ' glb + audio/' + _audioN + ' wav + sfx/' + _sfxN + ' mp3 + radio/' + _radioN + ' mp3 + scenery/trees.webp');
