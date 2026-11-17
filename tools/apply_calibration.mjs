// 把 tools/calibration.json（calibrate.mjs 的結果）寫回 js/levels.js 的 limit 與 star。
import fs from 'node:fs';
const cal = JSON.parse(fs.readFileSync('tools/calibration.json', 'utf8'));
let s = fs.readFileSync('js/levels.js', 'utf8');
for (const [id, v] of Object.entries(cal)) {
  const i = s.indexOf(`{ id: '${id}'`);
  if (i < 0) { console.log('找不到', id); continue; }
  const j = s.indexOf('limit:', i);
  const k = s.indexOf(',', j);
  let rest = s.slice(k + 1);
  rest = rest.replace(/^ star: \[\d+, \d+\],/, '');
  s = s.slice(0, j) + `limit: ${v.limit}, star: [${v.star[0]}, ${v.star[1]}],` + rest;
}
fs.writeFileSync('js/levels.js', s);
console.log('ok');
