// 找自動駕駛卡住的位置：node tools/stuck.mjs <關卡>
import { levelById } from '../js/levels.js';
import { Sim, STEP, halfW } from '../js/sim.js';
import { Bot } from '../js/bot.js';
const lv = levelById(process.argv[2]);
const sim = new Sim(lv, { noCountdown: true });
const bot = new Bot(sim, 'normal', Number(process.argv[3] || 1000));
let n = 0, slow = 0;
while (!sim.result && n++ < 120 * 400) {
  sim.step(STEP, bot.input(STEP));
  sim.fx.length = 0;
  const p = sim.player;
  if (p.v < 1 && !p.crash) slow += STEP; else slow = 0;
  if (slow > 3) {
    console.log(`卡住 t=${sim.t.toFixed(1)} s=${p.s.toFixed(1)} x=${p.x.toFixed(2)} ${sim.route.typeAt(p.s)} target=${bot.target.toFixed(2)} brake=${bot.brake}`);
    const near = sim.active.filter((e) => Math.abs(e.s - p.s) < 25 && !e.ghost).map((e) => `${e.kind}${e.ev ? '(' + e.ev.type + ':' + e.ev.state + ')' : ''}${e.queued ? 'Q' : ''} ds=${(e.s - p.s).toFixed(1)} x=${e.x.toFixed(2)} v=${e.v.toFixed(1)}`);
    console.log(near.join('\n'));
    break;
  }
}
