// 自動駕駛每次摔車時的狀況（調難度、修自動駕駛用）。node tools/crashlog.mjs <關卡> [skill]
import { levelById } from '../js/levels.js';
import { Sim, STEP } from '../js/sim.js';
import { Bot } from '../js/bot.js';

const lv = levelById(process.argv[2] || '2-4');
const sim = new Sim(lv, { noCountdown: true });
const bot = new Bot(sim, process.argv[3] || 'normal', 1000);
let n = 0;
while (!sim.result && n++ < 120 * 400) {
  sim.step(STEP, bot.input(STEP));
  for (const f of sim.fx) {
    if (f.type !== 'crash') continue;
    const e = sim.ents.find((x) => x.id === f.id);
    const p = sim.player;
    console.log(`t=${sim.t.toFixed(1)} s=${p.s.toFixed(0)} ${sim.route.typeAt(p.s)} 撞 ${f.kind}${e?.ev ? '(' + e.ev.type + ')' : ''}${e?.parked ? '(停)' : ''}${e?.cross ? '(橫向)' : ''}${e?.dir < 0 ? '(對向)' : ''} pv=${(p.v / 0.55).toFixed(1)} ev=${e?.v?.toFixed(1)} px=${p.x.toFixed(2)} ex=${e?.x?.toFixed(2)} ang=${(e?.ang || 0).toFixed(2)} target=${bot.target.toFixed(2)} brake=${bot.brake}`);
  }
  sim.fx.length = 0;
}
console.log(sim.result);
