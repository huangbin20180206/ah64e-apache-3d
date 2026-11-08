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
    dispose() { this._disposed = (this._disposed || 0) + 1; }
  },
  Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; this.userData = {}; } },
};

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'app', '00-utils.js'), 'utf8');
const { mergeGeos, disposeMergeInputs, mergeBucketMeshes } = new Function(
  'THREE', SRC + '\n;return { mergeGeos, disposeMergeInputs, mergeBucketMeshes };')(THREE);

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

  // 2026-11-07 P1-5：所有权契约。单输入原样返回时入参仍在场景里，
  // 绝不能 dispose；合并成功 / 合并失败返回 null 时入参无人接手，必须释放。
  dispose_ownership() {
    const a = mkGeo(3, [0, 1, 2], 0), b = mkGeo(3, [0, 2, 1], 1);
    const one = mkGeo(3, [0, 1, 2], 2);
    const c = mkGeo(3, [0, 1, 2], 3);
    const bad2 = new THREE.BufferGeometry();
    const singleOut = mergeGeos([one]);
    disposeMergeInputs([one], singleOut);
    const pair = [a, b], ok = mergeGeos(pair);
    disposeMergeInputs(pair, ok);
    const bad = [c, bad2], fail = mergeGeos(bad);
    disposeMergeInputs(bad, fail);
    disposeMergeInputs(null, null);
    disposeMergeInputs([], null);
    return {
      singleKept: one._disposed === undefined,
      pairDisposed: a._disposed === 1 && b._disposed === 1,
      failDisposed: c._disposed === 1 && bad2._disposed === 1,
      okIsNew: ok !== a && ok !== b,
      failIsNull: fail === null,
      guardsNoThrow: true,
    };
  },

  // 2026-11-08 P2-2：静态合批收口函数。成功桶建 mesh + 摘节点 + 释放临时几何；
  // 单输入桶的几何仍在用、不得释放；失败桶整体跳过且原节点一个都不能摘。
  merge_buckets() {
    const added = [];
    const parent = { add: m => added.push(m), remove: n => { n.removed = true; } };
    const nd = () => ({ parent, removed: false });
    const a = mkGeo(3, [0, 1, 2], 0), b = mkGeo(3, [0, 2, 1], 1);
    const n1 = nd(), n2 = nd();
    const one = mkGeo(3, [0, 1, 2], 2), n3 = nd();
    const bad1 = mkGeo(3, [0, 1, 2], 3), bad2 = new THREE.BufferGeometry();
    const n4 = nd(), n5 = nd();
    const buckets = new Map([
      ['ok', { geos: [a, b], nodes: [n1, n2] }],
      ['single', { geos: [one], nodes: [n3] }],
      ['bad', { geos: [bad1, bad2], nodes: [n4, n5] }],
    ]);
    const out = mergeBucketMeshes(buckets, {
      material: k => 'MAT_' + k,
      parent,
      onMesh: m => { m.castShadow = true; },
    });
    return {
      count: out.length,
      badSkipped: !out.some(x => x.key === 'bad'),
      badNodesKept: !n4.removed && !n5.removed,
      okNodesRemoved: n1.removed && n2.removed,
      singleNotDisposed: one._disposed === undefined,
      pairDisposed: a._disposed === 1 && b._disposed === 1,
      materialByKey: out[0] && out[0].mesh.material === 'MAT_ok',
      onMeshApplied: out[0] && out[0].mesh.castShadow === true,
      parentAdded: added.length === 2,
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
