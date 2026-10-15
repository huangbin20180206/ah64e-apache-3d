// P4c：读 31-scenery.js / 20-scene.js / 34-routes.js，输出场景布景校验摘要（无浏览器）
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../../src/app');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const val = rd('16-valley.js');
const cp = val.match(/const CANYON_PATH = (\[[\s\S]*?\]);/)[1];
const R = new Function('const CANYON_PATH = ' + cp + ';\n' + rd('34-routes.js') + '\nreturn { ROUTES, routeSample };')();
const envSrc = rd('20-scene.js').match(/const ENV_PRESETS = (\{[\s\S]*?\n\});/)[1];
const ENV = new Function('return ' + envSrc)();
const scn = rd('31-scenery.js');
const masts = JSON.parse(scn.match(/const masts = (\[[^;]*\]);/)[1]);
const mastH = +scn.match(/_scnCyl\(0\.12, 0\.2, ([\d.]+),/)[1];
const hx = +scn.match(/const hx = (-?[\d.]+), hz = (-?[\d.]+);/)[1];
const hz = +scn.match(/const hx = (-?[\d.]+), hz = (-?[\d.]+);/)[2];
const hills = new Function(scn.match(/function scnHillH[\s\S]*?\n\}/)[0] + '\nreturn scnHillH;')();
const MH = new Function(scn.match(/function scnMeadowH[\s\S]*?\n\}/)[0] + '\n' + scn.match(/function scnSmooth.*\n/)[0] + 'return scnMeadowH;')();
let meadowInnerMax = 0, meadowEdge = 0;
for (let a = 0; a < 6.3; a += 0.05) { for (let r = 0; r <= 85; r += 5) meadowInnerMax = Math.max(meadowInnerMax, MH(Math.sin(a) * r, Math.cos(a) * r)); meadowEdge = Math.max(meadowEdge, MH(Math.sin(a) * 330, Math.cos(a) * 330)); }
const treeR = +scn.match(/const r = (\d+) \+ Math\.pow/)[1];
let minHill = 1e9;
for (let a = 0; a < 6.3; a += 0.01) minHill = Math.min(minHill, hills(a, 0), hills(a, 1));
const pad = R.ROUTES.filter(r => r.terrain === 'pad');
let mastClear = 1e9, hangarClear = 1e9, maxR = 0;
for (const r of R.ROUTES) {
  for (let t = 0; t <= r.dur; t += 0.1) {
    const p = R.routeSample(r, t);
    if (r.scene !== 'town') maxR = Math.max(maxR, Math.hypot(p.x, p.z));
    if (r.terrain !== 'pad') continue;
    for (const [x, z] of masts) {
      const d = Math.hypot(p.x - x, p.z - z);
      mastClear = Math.min(mastClear, p.alt > mastH + 4 ? 99 : d);
    }
    const dx = Math.max(0, Math.abs(p.x - hx) - 6), dz = Math.max(0, Math.abs(p.z - hz) - 8);
    hangarClear = Math.min(hangarClear, p.alt > 16 ? 99 : Math.hypot(dx, dz));
  }
}
const keys = Object.keys(ENV);
const fields = ['label', 'zenith', 'horizon', 'ground', 'sunEl', 'sunAz', 'sunCol', 'sunI', 'skySunI', 'haze', 'cloud',
  'hemi', 'fill', 'exposure', 'bloom', 'fog', 'padTint', 'padRough'];
const missing = keys.flatMap(k => fields.filter(f => ENV[k][f] === undefined).map(f => k + '.' + f));
const tpl = fs.readFileSync(path.resolve(root, '../template.html'), 'utf8');
const combos = [...tpl.matchAll(/data-c-ter="(\w+)" data-c-env="(\w+)" data-c-wx="(\w+)"/g)].map(m => m.slice(1));
const terrs = [...tpl.matchAll(/data-terrain="(\w+)"/g)].map(m => m[1]);
const wxs = [...tpl.matchAll(/data-weather="(\w+)"/g)].map(m => m[1]);
const comboBad = combos.filter(([t, e, w]) => !terrs.includes(t) || !(e in ENV) || !wxs.includes(w));
const chips = [...tpl.matchAll(/data-env="(\w+)"/g)].map(m => m[1]);
process.stdout.write(JSON.stringify({ keys, missing, chips, labels: keys.map(k => ENV[k].label), padRoutes: pad.length,
  mastClear, hangarClear, combos: combos.length, comboBad, meadowInnerMax, meadowEdge, minHill, treeR, maxR, mastR: masts.map(([x, z]) => Math.hypot(x, z)) }));
