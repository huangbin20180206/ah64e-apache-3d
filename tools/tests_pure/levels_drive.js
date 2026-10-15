// levels_drive.js — 91-levels + 92-progress 纯逻辑驱动（node 桩，无浏览器）
'use strict';
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const HOST = {};
new Function('HOST', fs.readFileSync(path.join(APP, '91-levels.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(APP, '92-progress.js'), 'utf8'))(HOST);
const MV = fs.readFileSync(path.join(APP, '70-mission.js'), 'utf8').match(/const MISSION_VARIANTS = \{([\s\S]*?)\n\};/)[1];
const VARIANTS = [...MV.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
function mem(init) { const m = Object.assign({}, init || {}); return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; }
const LV = HOST.levels;
const out = {};
out.table = LV.list.map(L => ({ id: L.id, ch: L.chapter, ready: L.ready, variant: L.variant || null,
  okVariant: !L.ready || VARIANTS.includes(L.variant), nObj: (L.objectives || []).length, nBonus: (L.bonus || []).length }));
out.variants = VARIANTS;
out.coveredVariants = [...new Set(LV.ready().map(L => L.variant))].sort();
const L21 = LV.byId('2-1'), L41 = LV.byId('4-1');
out.stars = [LV.stars(L21, 'C', true), LV.stars(L21, 'B', true), LV.stars(L21, 'A', false), LV.stars(L21, 'A', true),
  LV.stars(L21, 'S', true), LV.stars(L41, 'A', true), LV.stars(L41, 'S', true), LV.stars(L21, '', true)];
out.bonus = LV.bonus(L21, { damage: 3 }).map(b => b.ok).concat(LV.bonus(L21, { damage: 4 }).map(b => b.ok),
  LV.bonus(LV.byId('2-2'), { elapsed: 179 }).map(b => b.ok), LV.bonus(LV.byId('2-2'), { elapsed: 180 }).map(b => b.ok),
  LV.bonus(LV.byId('4-1'), { wallStrikes: 1 }).map(b => b.ok), LV.bonus(LV.byId('4-2'), { airKills: 2 }).map(b => b.ok));
out.bonus2 = LV.bonus(LV.byId('1-3'), { gunUsed: 0, rkUsed: 0 }).map(b => b.ok).concat(LV.bonus(LV.byId('1-3'), { gunUsed: 5 }).map(b => b.ok));
out.course = LV.objectives(LV.byId('1-1'), { course: { stage: 3, hoverT: 4.2 } }).map(o => [o.ok, o.prog])
  .concat(LV.objectives(LV.byId('1-1'), { course: { stage: 5, hoverT: 0 } }).map(o => [o.ok, o.prog]));
out.fin = [1, 2, 3, 4].map(st => LV.objectives(LV.byId('4-3'), { finStage: st, alive: 7, finAir: 2 }).map(o => [o.ok, o.prog]));
out.obj = LV.objectives(LV.byId('3-1'), { alive: 0, total: 10, seadDone: false }).map(o => o.ok)
  .concat(LV.objectives(LV.byId('3-2'), { airKills: 7 }).map(o => o.prog));
// 新档解锁链
let s = mem(); let P = HOST.makeProgress({ storage: s, levels: LV });
out.fresh = LV.list.map(L => P.isUnlocked(L.id));
const r1 = P.record('2-1', 'C', 100, { damage: 0 }, 'standard');
out.afterC = { stars: r1.stars, unlockedNext: r1.unlockedNext, next: r1.next, open22: P.isUnlocked('2-2'), open23: P.isUnlocked('2-3') };
const r2 = P.record('2-1', 'A', 50, { damage: 1 }, 'veteran');
out.afterA = { stars: r2.stars, best: P.rec('2-1'), unlockedNext: r2.unlockedNext };
out.persisted = JSON.parse(s.m.ah64_progress).levels['2-1'];
out.totals = P.totals();
out.before11 = [P.isUnlocked('2-1'), P.isUnlocked('1-2')];
P.record('1-1', 'B', 0, { elapsed: 200 }, 'standard');
out.after11 = [P.isUnlocked('2-1'), P.isUnlocked('1-2'), P.isUnlocked('1-3')];
out.next42 = (P.nextOf('4-2') || {}).id || null; out.next43 = P.nextOf('4-3');
// 重新载入（持久化）
P = HOST.makeProgress({ storage: s, levels: LV }); out.reload = P.rec('2-1').stars;
// 迁移 v1
s = mem({ ah64_campaign: JSON.stringify({ schema_version: 1, unlocked: 3, levels: [
  { bestScore: 900, bestGrade: 'A', ach: [], totalDmg: 0 }, { bestScore: 400, bestGrade: 'B', ach: [], totalDmg: 0 },
  { bestScore: 0, bestGrade: '', ach: [], totalDmg: 0 }, { bestScore: 1200, bestGrade: 'S', ach: [], totalDmg: 0 },
  { bestScore: 0, bestGrade: '', ach: [], totalDmg: 0 }, { bestScore: 0, bestGrade: '', ach: [], totalDmg: 0 } ] }) });
P = HOST.makeProgress({ storage: s, levels: LV });
out.mig = { l21: P.rec('2-1'), l22: P.rec('2-2'), l23: P.rec('2-3'), open23: P.isUnlocked('2-3'), open31: P.isUnlocked('3-1'),
  written: !!s.m.ah64_progress, v1kept: !!s.m.ah64_campaign, from: P.save_data.migratedFrom };
// 损坏 / 未来版本
out.corrupt = HOST.makeProgress({ storage: mem({ ah64_progress: '{bad' }), levels: LV }).totals().stars;
out.future = HOST.makeProgress({ storage: mem({ ah64_progress: JSON.stringify({ schema_version: 9, levels: { '2-1': { stars: 3 } } }) }), levels: LV }).rec('2-1').stars;
out.throwing = HOST.makeProgress({ storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }, levels: LV }).record('2-1', 'B', 1, {}, '').stars;
console.log(JSON.stringify(out));
