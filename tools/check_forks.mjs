// 檢查分岔路線（規格 6.6）：自動駕駛騎過每個分岔，印出進哪條路、換路時 x 是否連續、兩條路上各有多少東西。
// node tools/check_forks.mjs [關卡,…] [seed]
import { LEVELS } from '../js/levels.js';
import { Sim, STEP } from '../js/sim.js';
import { Bot } from '../js/bot.js';

const only = process.argv[2] ? process.argv[2].split(',') : null;
const seed = Number(process.argv[3] || 1000);
for (const lv of LEVELS) {
  if (only && !only.includes(lv.id)) continue;
  const sim = new Sim(lv, { noCountdown: true });
  if (!sim.route.forks.length) continue;
  sim.timeLeft = 9999;
  const bot = new Bot(sim, 'normal', seed);
  const counts = sim.route.forks.map((f) => f.views.map((v) => sim.ents.filter((e) => e.R === v).length));
  const evs = sim.route.forks.map((f) => f.views.map((v) => sim.events.filter((e) => e.R === v).map((e) => e.type).join('/')));
  let lastR = sim.player.R, n = 0;
  const log = [];
  while (!sim.result && n++ < 120 * 400) {
    const before = sim.route.toWorld(0, 0, {});
    const p = sim.player;
    const w0 = p.R.toWorld(p.s, p.x, {});
    sim.step(STEP, bot.input(STEP));
    const w1 = p.R.toWorld(p.s, p.x, {});
    if (p.R !== lastR) {
      const jump = Math.hypot(w1.wx - w0.wx, w1.wz - w0.wz) - p.v * STEP;
      log.push(`s=${p.s.toFixed(0)} → ${p.R.branch ? (p.R.branch < 0 ? '左路 ' : '右路 ') + p.R.type : '主線'}（x=${p.x.toFixed(2)}，位置跳動 ${jump.toFixed(3)} m）`);
      lastR = p.R;
    }
    for (const fx of sim.fx) if (fx.type === 'forkWarn') log.push(`提示：${fx.names.join(' ｜ ')}`);
    sim.fx.length = 0;
  }
  console.log(`${lv.id} ${sim.result?.win ? '過關' : '失敗'} t=${sim.t.toFixed(1)} 摔 ${sim.player.crashes}`);
  sim.route.forks.forEach((f, i) => {
    console.log(`  分岔 ${f.s0}～${f.s1}：${f.L}｜${f.R}  d=${f.Lv.d.toFixed(1)}/${f.Rv.d.toFixed(1)}  最大間距 ${Math.max(...Array.from({ length: 50 }, (_, k) => f.gap(f.s0 + (f.s1 - f.s0) * k / 49))).toFixed(1)} m  東西 ${counts[i].join('/')}  事件 左[${evs[i][0]}] 右[${evs[i][1]}]`);
  });
  for (const l of log) console.log('  ' + l);
}
