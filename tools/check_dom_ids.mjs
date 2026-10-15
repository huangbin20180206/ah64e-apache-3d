// ============================================================
// tools/check_dom_ids.mjs — 静态核对 UI(id) 引用与 template.html 的 id 契约
// ============================================================
// 用法: node tools/check_dom_ids.mjs
// 也被 build.mjs 作为构建前检查引入（export checkDomIds）。
//
// 为什么需要它：app 代码全部通过 UI(id)=getElementById 取 DOM，拼错或改
// template 时漏改会静默返回 null，直到运行到那一行才抛 "Cannot set
// properties of null"——而那可能是切到某个场地、进 FPV 之后才走的分支，
// 常规冒烟测试根本走不到。这个检查在构建前就能全量抓出来，且不需要浏览器。
//
// 反向也查：template 里定义了但代码从没引用的 id（多为改名残留），
// 只报告不失败——纯 CSS 挂钩的 id 是合法的。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// 纯分析，不打印不退出：便于 build.mjs 复用同一套规则。
// 返回 { defined, used, missing, orphan, refs }
export function checkDomIds(root = join(HERE, '..')) {
  const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');

  // template 里的 id（只认真正的 id="" 属性；CSS 里的 #id 若无对应元素
  // 同样是死引用，不能算"已定义"）
  const defined = new Set();
  const dupIds = new Set();
  for (const m of tpl.matchAll(/\bid="([^"]+)"/g)) {
    if (defined.has(m[1])) dupIds.add(m[1]);    // Phase 2-A4：重复 id 是无效 HTML，构建失败
    defined.add(m[1]);
  }
  if (dupIds.size) {
    throw new Error(`check_dom_ids: template 中存在重复 id（无效 HTML）：${[...dupIds].join(', ')}`);
  }

  // Phase 2-A6：role="progressbar" 的元素必须同时具备三个 aria 属性（缺一即 throw）
  for (const m of tpl.matchAll(/<(?:div|span|progress)\b[^>]*\brole="progressbar"[^>]*>/g)) {
    const tag = m[0];
    for (const attr of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow']) {
      if (!tag.includes(attr)) {
        throw new Error(`check_dom_ids: role="progressbar" 元素缺少 ${attr}：${tag.slice(0, 80)}`);
      }
    }
  }

  // 动态创建的元素：JS 里 el.id = 'xxx' 也算定义
  const appDir = join(root, 'src/app');
  const files = readdirSync(appDir).filter(f => f.endsWith('.js')).sort();
  const sources = files.map(f => [f, readFileSync(join(appDir, f), 'utf8')]);
  for (const [, src] of sources) {
    for (const m of src.matchAll(/\.id\s*=\s*'([^']+)'/g)) defined.add(m[1]);
  }

  // 代码里的引用：UI('xxx') / getElementById('xxx') / querySelector('#xxx') 是
  // 硬引用（拼错就是 bug，必须报错）；此外很多 id 是经辅助函数间接取用的
  // （ck('chk-disc', …)、sl('explode', …)、bind('fp-touch-w', 'w')），无法静态
  // 追踪调用链，所以任何与已定义 id 字面相同的字符串都计入"已使用"，只用于
  // 压低孤儿 id 的误报，不参与错误判定。
  const refs = new Map();          // id -> [文件:行]（仅硬引用）
  const used = new Set();
  for (const [file, src] of sources) {
    src.split('\n').forEach((line, i) => {
      const pats = [
        /\bUI\('([^']+)'\)/g,
        /getElementById\('([^']+)'\)/g,
        /querySelector\('#([A-Za-z0-9_-]+)'\)/g,
      ];
      for (const p of pats) {
        for (const m of line.matchAll(p)) {
          used.add(m[1]);
          if (!refs.has(m[1])) refs.set(m[1], []);
          refs.get(m[1]).push(`${file}:${i + 1}`);
        }
      }
    });
    // 间接引用：任何等于已定义 id 的字符串字面量
    for (const m of src.matchAll(/'([A-Za-z][A-Za-z0-9_-]*)'/g)) {
      if (defined.has(m[1])) used.add(m[1]);
    }
  }

  return {
    defined, used, refs,
    missing: [...refs.keys()].filter(id => !defined.has(id)).sort(),
    orphan: [...defined].filter(id => !used.has(id)).sort(),
  };
}

// build.mjs 用：只在有死引用时抛错，正常路径静默（构建日志已经够长了）
export function assertDomIds(root) {
  const r = checkDomIds(root);
  if (r.missing.length) {
    throw new Error('代码引用了 template 中不存在的 id：'
      + r.missing.map(id => `${id}(${r.refs.get(id).join(',')})`).join('; '));
  }
  return r;
}

// 直接运行时输出完整报告（含孤儿 id）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { defined, used, refs, missing, orphan } = checkDomIds();
  console.log(`template 定义 id：${defined.size} 个；代码引用：${used.size} 个`);
  if (orphan.length) {
    console.log(`\n仅 CSS 使用 / 未被代码引用（${orphan.length} 个，非错误）：`);
    console.log('  ' + orphan.join(', '));
  }
  if (missing.length) {
    console.error(`\n✗ 代码引用了 template 中不存在的 id（${missing.length} 个）：`);
    for (const id of missing) console.error(`  ${id}  ←  ${refs.get(id).join(', ')}`);
    process.exit(1);
  }
  console.log('\n✓ 所有 UI(id) 引用都能在 template.html 中找到对应元素');
}
