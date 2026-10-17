// 装备图鉴：读 35-armorydata.js（纯数据 + 轮盘数学），输出校验所需摘要
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'src/app/35-armorydata.js'), 'utf8');
const M = new Function(src + '\nreturn { ARMORY_CATS, ARMORY_ITEMS, armoryRel, armoryNearest, armoryTarget, armoryStep };')();
const n = M.ARMORY_ITEMS.length;
const imgs = fs.readdirSync(path.join(root, 'assets/armory'));
const math = {
  rel: [[0, 0], [1, 0], [12, 0], [0, 12], [6, 0], [7, 0], [3, 2.6]].map(([i, r]) => M.armoryRel(i, r, n)),
  nearest: [0, 0.49, 0.51, -0.6, 12.6, 13, 25.2, -14].map(r => M.armoryNearest(r, n)),
  target: [[0, 12], [12, 0], [5, 5.3], [0, 26]].map(([i, r]) => M.armoryTarget(i, r, n)),
  step: M.armoryStep(n),
};
process.stdout.write(JSON.stringify({ cats: M.ARMORY_CATS, items: M.ARMORY_ITEMS, imgs, math, n }));
