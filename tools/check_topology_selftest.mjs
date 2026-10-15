// ============================================================
// tools/check_topology_selftest.mjs — 拓扑检查器自测（Phase 1-B）
// ============================================================
// 构造已知违规/合法样本，断言检查器：
//   ① 能抓到反向引用（低编号读高编号）；
//   ② 能抓到契约未声明的依赖（undeclared-dep）与未登记的 provides
//     （unlisted-provide）；
//   ③ 形参/局部遮蔽零假阳性（架构方点名：19-reflect 的 apache、
//      40-post 的 renderer 均为形参，朴素正则会误报）；
//   ④ 注释/字符串/模板字符串内容不参与解析；
//   ⑤ 合法正向依赖 + 契约齐备时零违规。
// 用法：node tools/check_topology_selftest.mjs（全部断言通过退出码 0）
// ============================================================
import { analyzeFiles, checkTopology } from './check_topology.mjs';

let failed = 0;
const expect = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failed++; console.error(`  ✗ ${name} ${detail || ''}`); }
};

// ---- 样本 1：合法正向依赖 + 契约齐备 → 零违规 ----
const okFiles = [
  { file: '01-a.js', src: 'const shared = 1;\nfunction helper() { return shared; }\n' },
  { file: '05-b.js', src: 'console.log(shared, helper());\n' },
];
const okContracts = '```json-contracts\n' + JSON.stringify({
  '01-a.js': { provides: ['shared', 'helper'], depends: {} },
  '05-b.js': { provides: [], depends: { '01-a.js': ['shared', 'helper'] } },
}, null, 1) + '\n```';
{
  const v = checkTopology({ files: okFiles, contractsContent: okContracts });
  expect('合法正向依赖+契约齐备 → 0 违规', v.length === 0, JSON.stringify(v));
}

// ---- 样本 2：反向引用 → reverse-ref ----
{
  const v = checkTopology({
    files: [
      { file: '01-a.js', src: 'console.log(lateSymbol);\n' },
      { file: '05-b.js', src: 'const lateSymbol = 1;\n' },
    ],
    contractsContent: null,
  });
  expect('反向引用被检出（reverse-ref ×1）',
    v.length === 1 && v[0].type === 'reverse-ref' && v[0].symbol === 'lateSymbol',
    JSON.stringify(v));
}

// ---- 样本 3：契约未声明依赖 + provides 缺失 ----
{
  const v = checkTopology({
    files: okFiles,
    contractsContent: '```json-contracts\n' + JSON.stringify({
      '01-a.js': { provides: ['shared'], depends: {} },        // 故意缺 helper
      '05-b.js': { provides: [], depends: { '01-a.js': ['shared'] } },  // 故意缺 helper
    }, null, 1) + '\n```',
  });
  const types = v.map(x => x.type);
  expect('undeclared-dep 被检出', types.includes('undeclared-dep'), JSON.stringify(v));
  expect('unlisted-provide 被检出', types.includes('unlisted-provide'), JSON.stringify(v));
}

// ---- 样本 4：形参遮蔽零假阳性（架构方点名的坑） ----
{
  const v = checkTopology({
    files: [
      // 19-reflect 式：bind(apache) 的 apache 是形参，不是对 70-app 顶层符号的引用
      { file: '19-x.js', src: 'class R { bind(apache) { this._c = apache.root.clone(true); } }\n' },
      { file: '70-y.js', src: 'const apache = { root: 1 };\n' },
      // 40-post 式：constructor(renderer, W) 的两个都是形参
      { file: '40-z.js', src: 'class C { constructor(renderer, W) { this.r = renderer; this.w = W; } }\n' },
    ],
    contractsContent: null,
  });
  expect('形参遮蔽零假阳性（apache/renderer/W 均不产生边）', v.length === 0, JSON.stringify(v));
}

// ---- 样本 5：注释 / 字符串 / 模板串纯文本不参与解析（${} 插值是活代码除外） ----
{
  const v = checkTopology({
    files: [
      { file: '01-a.js', src: [
        '// const fakeComment = 1;',
        '/* const fakeBlock = 2; */',
        'const s = "lateSymbol in string";',
        'const t = `lateSymbol $$ { notParsed } in template text`;',
        'const u = `nested ${ `still plain lateSymbol` } end`;',
      ].join('\n') + '\n' },
      { file: '05-b.js', src: 'const lateSymbol = 1;\nconst fakeComment = 2;\nconst fakeBlock = 3;\n' },
    ],
    contractsContent: null,
  });
  expect('注释/字符串/模板纯文本内的符号名不产生边', v.length === 0, JSON.stringify(v));
  // 反向断言：${} 插值是活代码，其内引用必须计数
  const r = analyzeFiles([
    { file: '01-a.js', src: 'const t = `x ${liveSym} y`;\n' },
    { file: '05-b.js', src: 'const liveSym = 1;\n' },
  ]);
  expect('${} 插值内引用被计数（活代码）',
    r.edges.length === 1 && r.edges[0].symbol === 'liveSym', JSON.stringify(r.edges));
}

// ---- 样本 6：方法形参与箭头形参零假阳性 ----
{
  const v = checkTopology({
    files: [
      { file: '10-a.js', src: [
        'const orbit = { t: 1 };',
        'class F {',
        '  reset(dt) { return dt; }',
        '  go: () => 1,',
        '}',
        'arr.map(x => x * orbit.t);',
        'arr.forEach((n, i) => n + i);',
      ].join('\n') + '\n' },
      { file: '20-b.js', src: 'const x = 1; const n = 2; const i = 3; const dt = 4;\n' },
    ],
    contractsContent: null,
  });
  // 10-a 读 20-b 的 x/n/i/dt（裸引用）会被抓为反向——但样本里 x/n/i/dt 全是
  // 箭头形参，orbit 是本文件顶层符号：唯一应检出的是……无（无真实跨文件引用）
  expect('方法/箭头形参零假阳性', v.length === 0, JSON.stringify(v));
}

// ---- 样本 7：真实仓库回归（无 opts → 读 src/app + 契约文档） ----
{
  const v = checkTopology();
  expect('真实仓库 0 违规（反向+契约）', v.length === 0, JSON.stringify(v.slice(0, 3)));
}

// ---- 样本 8：初始化式引用不丢失（曾因跳过声明段而漏边） ----
{
  const r = analyzeFiles([
    { file: '30-w.js', src: 'const W = buildWorld(renderer);\n' },
    { file: '70-a.js', src: 'function buildWorld(r) { return r; }\nconst renderer = { a: 1 };\n' },
  ]);
  const syms = r.edges.map(e => e.symbol).sort();
  expect('初始化式引用被捕获（buildWorld/renderer 两条边）',
    syms.length === 2 && syms[0] === 'buildWorld' && syms[1] === 'renderer',
    JSON.stringify(r.edges));
}

console.log(failed === 0 ? '\nSELFTEST PASS（8/8）' : `\nSELFTEST FAIL（${failed} 处断言失败）`);
process.exit(failed === 0 ? 0 : 1);
