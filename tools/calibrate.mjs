// 時限校準（規格 0〈數值校準〉、11.3）：「普通」自動駕駛不限時跑完的時間（中位數），
// 乘上各章的餘裕得到建議時限；星等門檻＝時限的 12%／22%。
// node tools/calibrate.mjs [runs=5] [關卡,…]
import { LEVELS } from '../js/levels.js';
import { Sim, STEP } from '../js/sim.js';
import { Bot } from '../js/bot.js';

const runs = Number(process.argv[2] || 5);
const only = process.argv[3] ? process.argv[3].split(',') : null;
const MARGIN = { 1: 0.42, 2: 0.32, 3: 0.27, 4: 0.23, 5: 0.17 };
const out = {};
for (const lv of LEVELS) {
  if (only && !only.includes(lv.id)) continue;
  const times = [], crashes = [];
  for (let r = 0; r < runs; r++) {
    const sim = new Sim(lv, { noCountdown: true });
    sim.timeLeft = 9999;
    const bot = new Bot(sim, 'normal', 2000 + r * 131);
    let n = 0;
    while (sim.player.s < sim.L && n++ < 120 * 600) { sim.step(STEP, bot.input(STEP)); sim.fx.length = 0; }
    times.push(sim.t); crashes.push(sim.player.crashes);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  const limit = Math.ceil(med * (1 + MARGIN[lv.ch]));
  out[lv.id] = { limit, star: [Math.round(limit * 0.12), Math.round(limit * 0.22)], med: +med.toFixed(1), worst: +times[times.length - 1].toFixed(1), crashes: crashes.join('/') };
  console.log(lv.id, JSON.stringify(out[lv.id]));
}
console.log(JSON.stringify(out));
