// P4a：读 33-knowcards.js（纯数据）+ 70-labels 节点名，输出校验所需摘要
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../../src/app');
const src = fs.readFileSync(path.join(root, '33-knowcards.js'), 'utf8');
const KNOW_CARDS = new Function(src + '\nreturn KNOW_CARDS;')();
const lab = fs.readFileSync(path.join(root, '70-labels.js'), 'utf8');
const nodes = [...lab.matchAll(/^\s*\['([^']+)',/gm)].map(m => m[1]);
process.stdout.write(JSON.stringify({ cards: KNOW_CARDS, nodes }));
