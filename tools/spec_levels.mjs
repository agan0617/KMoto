// 由 js/levels.js 產生規格 7.2〈關卡總表〉的 HTML，寫回 docs/spec.html 的 <!--LEVELS--> 標記之間。
// node tools/spec_levels.mjs
import fs from 'node:fs';
import { LEVELS, DESTS, HAZARD_INFO } from '../js/levels.js';

const BR = { market: '夜市', lane: '巷子', oneway: '大馬路' };
const TIME = { morning: '早上', noon: '中午', dusk: '黃昏', night: '夜晚', rain: '雨' };
const EV = {
  uncle: '阿伯', ped: '行人', alley: '巷口竄出', cutin: '切車道', bus: '公車切出', taxi: '小黃急停', double: '併排停車',
  door: '開門殺', wrongway: '逆向', uturn: '迴轉', dogs: '狗', truck: '砂石車', garbage: '垃圾車', procession: '遶境',
  delivery: '外送員', pullout: '路邊起步', drunk: '酒駕', drugged: '毒駕', campaign: '宣傳車', walker: '行人走車道',
  rightturn: '右轉切車', bigturn: '內輪差',
};
const rows = LEVELS.map((l) => {
  const segs = l.segs.map(([t, n, a, b]) => (t === 'fork' ? `分岔 ${n}（${BR[a]}｜${BR[b]}）` : `${t} ${n}`)).join('＋');
  const ev = l.events.length >= 17 ? '全部' : l.events.map((e) => EV[e] || e).join('、');
  const nw = l.intro.length ? l.intro.map((k) => HAZARD_INFO[k].name).join('、') : '—';
  const wx = l.weather === 'typhoon' ? '（颱風）' : '';
  return `<tr><td>${l.id}</td><td>${l.title}</td><td>${DESTS[l.dest].label}</td><td>${segs}</td><td>${TIME[l.time]}${wx}</td>` +
    `<td class="num">${l.length}</td><td class="num">${l.limit}</td><td class="num">${l.star[0]}／${l.star[1]}</td><td>${l.dens[0]}／${l.dens[1]}</td>` +
    `<td class="num">${l.ev}</td><td class="num">${l.hz}</td><td>${ev}</td><td>${nw}</td></tr>`;
});
const table = `<!--LEVELS-->
<div class="table-wrap"><table>
<tr><th>關</th><th>標題</th><th>目的地</th><th>路段（公尺）</th><th>時段</th><th class="num">長度</th><th class="num">時限</th><th class="num">★★／★★★</th><th>密度</th><th class="num">三寶/km</th><th class="num">路障/km</th><th>三寶</th><th>新障礙</th></tr>
${rows.join('\n')}
</table></div>
<!--/LEVELS-->`;
let s = fs.readFileSync('docs/spec.html', 'utf8');
const a = s.indexOf('<!--LEVELS-->'), b = s.indexOf('<!--/LEVELS-->');
if (a < 0 || b < 0) throw new Error('spec.html 找不到 LEVELS 標記');
s = s.slice(0, a) + table + s.slice(b + '<!--/LEVELS-->'.length);
fs.writeFileSync('docs/spec.html', s);
console.log('7.2 已更新');
