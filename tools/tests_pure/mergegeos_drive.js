// ============================================================
// mergegeos_drive.js — 00-utils mergeGeos 纯逻辑测试驱动器（node 桩）
// C1/C2（镜像合并/靶标合批）的承重件：index 偏移拼接数学 + 保底路径。
// 用法：node mergegeos_drive.js <case>
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

// THREE 极简桩：mergeGeos 只用 BufferGeometry/BufferAttribute 的
// 构造 + attributes/index 字段 + computeBounding*（空实现即可）
const THREE = {
  BufferAttribute: class { constructor(arr, sz) { this.array = arr; this.itemSize = sz; }
    get count() { return this.array.length / this.itemSize; }   // 真实 THREE 有 count getter，桩必须同构
  },
  BufferGeometry: class {
    constructor() { this.attributes = {}; this.index = null; }
    setAttribute(k, a) { this.attributes[k] = a; return this; }
    setIndex(a) { this.index = a; return this; }
    computeBoundingSphere() {}
    computeBoundingBox() {}
  },
};

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'app', '00-utils.js'), 'utf8');
const mergeGeos = new Function('THREE', SRC + '\n;return mergeGeos;')(THREE);

// 造一个最小几何：n 顶点 position/normal + index
function mkGeo(n, idx, off) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = i + (off || 0); pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
    nor[i * 3] = 0; nor[i * 3 + 1] = 1; nor[i * 3 + 2] = 0;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

const CASES = {
  // 拼接：两几何（3 顶点各）→ 6 顶点，index 逐段加基址
  merge2() {
    const a = mkGeo(3, [0, 1, 2], 0);
    const b = mkGeo(3, [0, 2, 1], 100);   // 第二块，index 与首块数值重叠（验证偏移）
    const m = mergeGeos([a, b]);
    if (!m) return { ok: false, why: 'null' };
    return {
      ok: true,
      vCount: m.attributes.position.count,
      nCount: m.attributes.normal.count,
      // 位置第 4 顶点应是第二块的第 0 顶点（x=100）
      pos3x: m.attributes.position.array[9],
      idx: Array.from(m.index.array),
      idxType: m.index.array.constructor.name,
    };
  },

  // 单元素直通（不新建对象，返回原引用）
  single() {
    const a = mkGeo(3, [0, 1, 2], 0);
    return { same: mergeGeos([a]) === a, empty: mergeGeos([]) === null, nul: mergeGeos(null) === null };
  },

  // 保底：attribute 集不一致 → null；index 有无不一致 → null
  mismatch() {
    const a = mkGeo(3, [0, 1, 2], 0);
    const noUv = mkGeo(3, [0, 1, 2], 1);
    const withUv = new THREE.BufferGeometry();
    withUv.setAttribute('position', a.attributes.position);
    withUv.setAttribute('normal', a.attributes.normal);
    withUv.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    withUv.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    const noIdx = new THREE.BufferGeometry();
    noIdx.setAttribute('position', a.attributes.position);
    noIdx.setAttribute('normal', a.attributes.normal);
    return {
      attrMismatch: mergeGeos([noUv, withUv]) === null,
      indexMismatch: mergeGeos([noUv, noIdx]) === null,
      okPair: !!mergeGeos([noUv, mkGeo(3, [0, 1, 2], 5)]),
    };
  },

  // 三块拼接 + Uint32 升级路径（顶点 >65535 走 Uint32）不在此测——
  // 用四块中几何验证多次基址累加正确
  merge4() {
    const gs = [mkGeo(2, [0, 1], 0), mkGeo(2, [0, 1], 10), mkGeo(3, [0, 2, 1], 20), mkGeo(1, [0], 30)];
    const m = mergeGeos(gs);
    if (!m) return { ok: false };
    return {
      ok: true,
      vCount: m.attributes.position.count,
      idx: Array.from(m.index.array),
      // 第 3 块首顶点 x=20；第 4 块首顶点 x=30
      x2: m.attributes.position.array[(2 + 2) * 3],
      x3: m.attributes.position.array[(2 + 2 + 3) * 3],
    };
  },
};

const name = process.argv[2];
if (!name || !CASES[name]) {
  console.error('usage: node mergegeos_drive.js <' + Object.keys(CASES).join('|') + '>');
  process.exit(2);
}
console.log(JSON.stringify(CASES[name]()));
