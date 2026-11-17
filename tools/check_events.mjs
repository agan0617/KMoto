// 檢查每關的三寶事件都放得進路線（規格 11.3：新障礙一定看得到）。node tools/check_events.mjs
import { LEVELS } from '../js/levels.js';
import { Sim } from '../js/sim.js';

let bad = 0;
for (const lv of LEVELS) {
  const sim = new Sim(lv);
  const count = {};
  for (const e of sim.events) count[e.type] = (count[e.type] || 0) + 1;
  const miss = lv.events.filter((t) => !count[t]);
  if (miss.length) { bad++; console.log(lv.id, '放不進：', miss.join(', ')); }
}
console.log(bad ? `${bad} 關有缺` : '全部關卡的事件都放得進去');
