// 無頭模擬：用自動駕駛跑關卡，量過關率、剩餘時間、摔車、擦身而過（規格 11.3）。
// 用法：node tools/sim.mjs [skill=normal] [runs=4] [關卡 id，例 1-1,5-4；省略＝全部]
import { LEVELS } from '../js/levels.js';
import { Sim, STEP } from '../js/sim.js';
import { Bot } from '../js/bot.js';

const skill = process.argv[2] || 'normal';
const runs = Number(process.argv[3] || 4);
const only = process.argv[4] ? process.argv[4].split(',') : null;

const rows = [];
for (const lv of LEVELS) {
  if (only && !only.includes(lv.id)) continue;
  let wins = 0, remain = 0, crashes = 0, near = 0, t0 = Date.now(), timeSum = 0, stars = 0;
  const kills = {};
  for (let r = 0; r < runs; r++) {
    const sim = new Sim(lv, { noCountdown: true });
    const bot = new Bot(sim, skill, 1000 + r * 77);
    let guard = 0;
    while (!sim.result && guard++ < 120 * 400) {
      const before = sim.player.crashes;
      sim.step(STEP, bot.input(STEP));
      if (sim.player.crashes > before) { const k = sim.player.crash.by; kills[k] = (kills[k] || 0) + 1; }
    }
    sim.fx.length = 0;
    const res = sim.result;
    if (res.win) { wins++; remain += res.remain; stars += res.stars; }
    crashes += res.crashes; near += res.near + res.close;
    timeSum += sim.t;
  }
  rows.push({
    id: lv.id, limit: lv.limit, len: lv.length,
    win: `${wins}/${runs}`, remain: wins ? (remain / wins).toFixed(1) : '-',
    pct: wins ? ((remain / wins) / lv.limit * 100).toFixed(0) + '%' : '-',
    stars: wins ? (stars / wins).toFixed(1) : '-',
    crash: (crashes / runs).toFixed(1), near: (near / runs).toFixed(0),
    avgT: (timeSum / runs).toFixed(1),
    kills: Object.entries(kills).map(([k, v]) => `${k}:${v}`).join(' '),
    ms: Date.now() - t0,
  });
}
console.table(rows);
