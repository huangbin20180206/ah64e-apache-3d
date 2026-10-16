// P4b：读 34-routes.js（纯数据+采样），输出每条航线的校验摘要
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../../src/app');
const val = fs.readFileSync(path.join(root, '16-valley.js'), 'utf8');
const cp = val.match(/const CANYON_PATH = (\[[\s\S]*?\]);/)[1];
const src = fs.readFileSync(path.join(root, '34-routes.js'), 'utf8');
const M = new Function('const CANYON_PATH = ' + cp + ';\n' + src + '\nreturn { ROUTES, routeSample, routeVel, routeShot, CANYON_PATH };')();
function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  const u = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L));
  return Math.hypot(px - a[0] - u * dx, pz - a[1] - u * dz);
}
const out = M.ROUTES.map(r => {
  let maxSp = 0, minAlt = 1e9, maxAbs = 0, canyonDev = 0, mono = true;
  for (let i = 1; i < r.pts.length; i++) if (r.pts[i][0] <= r.pts[i - 1][0]) mono = false;
  const t0 = r.start === 'ground' ? r.auto : 0;
  for (let t = t0; t <= r.dur; t += 0.1) {
    const p = M.routeSample(r, t), v = M.routeVel(r, t);
    maxSp = Math.max(maxSp, Math.hypot(v.vx, v.vz));
    minAlt = Math.min(minAlt, p.alt);
    maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.z));   // 世界坐标（城镇航线在基地以北，见 test_routes 分档上限）
    if (r.id === 'canyon' && t >= 3 && t <= r.pts[r.pts.length - 3][0]) {
      let d = 1e9;
      for (let i = 1; i < M.CANYON_PATH.length; i++) d = Math.min(d, segDist(p.x, p.z, M.CANYON_PATH[i - 1], M.CANYON_PATH[i]));
      canyonDev = Math.max(canyonDev, d);
    }
  }
  const shotsSorted = r.shots.every((s, i) => i === 0 || s[0] >= r.shots[i - 1][0]);
  const capsSorted = r.caps.every((s, i) => i === 0 || s[0] >= r.caps[i - 1][0]);
  return { id: r.id, dur: r.dur, mono, maxSp, minAlt, maxAbs, canyonDev, shotsSorted, capsSorted,
           shotKinds: r.shots.map(s => s[1]), lastShot: r.shots[r.shots.length - 1][0], terrain: r.terrain, env: r.env };
});
process.stdout.write(JSON.stringify(out));
