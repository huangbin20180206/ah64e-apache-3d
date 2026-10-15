// appmode_drive.js — 70-appmode.js 的 appModeFromUrl 纯逻辑驱动（node，无浏览器）
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app', '70-appmode.js'), 'utf8');
const m = SRC.match(/function appModeFromUrl\([\s\S]*?\n\}/);
if (!m) { console.error('appModeFromUrl not found'); process.exit(2); }
const f = new Function(m[0] + '\nreturn appModeFromUrl;')();
const CASES = [
  ['', '', false], ['', '', true], ['?nolaunch=1', '', false], ['?launch=1', '', true],
  ['?nocine=1', '#show', true], ['', '#play', false], ['', '#bogus', false], ['?launch=1&nocine=1', '', false],
];
console.log(JSON.stringify(CASES.map(c => f(c[0], c[1], c[2]))));
