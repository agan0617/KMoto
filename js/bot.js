// 自動駕駛（tools/sim.mjs 校準難度用，規格 11.3）。只看模擬狀態、輸出按鍵。
import { TUNING as T } from './tuning.js';
import { halfW, KINDS } from './sim.js';
import { makeRng } from './rng.js';

export const SKILLS = {
  pro: { react: 0.2, margin: 0.3, look: 140 },
  normal: { react: 0.35, margin: 0.18, look: 110 },
  novice: { react: 0.6, margin: 0.12, look: 70 },
};

const SKIP = new Set(['manhole', 'puddle']);

export class Bot {
  constructor(sim, skill = 'normal', seed = 1) {
    this.sim = sim;
    this.k = SKILLS[skill];
    this.rng = makeRng(seed);
    this.wait = 0;
    this.target = sim.player.x;
    this.brake = false;
    this.boost = false;
  }

  _free(x, ents, p, b) {
    let free = this.k.look;
    const v = Math.max(p.v, 6);
    for (const e of ents) {
      if (e.ghost || e.dead || e.knocked || SKIP.has(e.kind)) continue;
      const ds = e.s - p.s;
      if (ds < -2 || ds > this.k.look) continue;
      const evs = e.sideways ? 0 : (e.dir || 1) * (e.v || 0) * Math.cos(e.ang || 0);
      const rel = v - evs;
      const lenSum = (e.len + T.bikeLen) / 2;
      let t = rel > 0.5 ? Math.max(0, (ds - lenSum) / rel) : (ds - lenSum <= 0 ? 0 : 99);
      if (t > 8) continue;
      let ex = e.xDraw ?? e.x;
      if (e.cross) ex += e.cross * e.v * t;
      else if (e.ev && (e.ev.state === 'go' || e.ev.state === 'warn' || e.ev.state === 'armed') && (e.kind === 'ped' || e.kind === 'dog') && e.crossDir && !e.walker) ex += e.crossDir * (e.kind === 'dog' ? 3 : 1.2) * Math.max(0, t - (e.ev.state === 'go' ? 0 : 0.6));
      const w = halfW(e) + T.bikeWid / 2 + this.k.margin + (e.kind === 'pothole' ? -0.3 : 0);
      // 時間窗：橫越中的東西看一段時間範圍
      let hit = Math.abs(x - ex) < w;
      if (!hit && (e.cross || (e.kind === 'ped' && e.ev))) {
        for (const dt of [-0.4, 0.4]) {
          let ex2 = e.x;
          if (e.cross) ex2 += e.cross * e.v * (t + dt);
          else if (e.crossDir && e.ev && e.ev.state === 'go') ex2 += e.crossDir * 1.2 * (t + dt);
          if (Math.abs(x - ex2) < w) hit = true;
        }
      }
      if (hit) free = Math.min(free, Math.max(0, ds - lenSum));
    }
    return free;
  }

  input(dt) {
    const sim = this.sim, p = sim.player;
    const inp = { left: false, right: false, brake: false, boostDown: false, hornDown: false };
    if (sim.phase !== 'run' || p.crash) return inp;
    this.wait -= dt;
    const ents = sim.active || sim.ents;
    const b = sim.route.bounds(p.s + 8);
    if (this.wait <= 0) {
      this.wait = this.k.react * (0.8 + 0.4 * this.rng());
      let best = p.x, bestScore = -1e9, bestFree = 0;
      const curFree = this._free(p.x, ents, p, b);
      for (let x = b.left + 0.5; x <= b.right - 0.5; x += 0.3) {
        const f = this._free(x, ents, p, b);
        // 橫移路上有東西擋著就扣分
        let block = 0;
        for (const e of ents) {
          if (e.ghost || e.dead || SKIP.has(e.kind) || e.kind === 'pothole') continue;
          if (Math.abs(e.s - p.s) > e.len / 2 + 2.2) continue;
          const lo = Math.min(p.x, x), hi = Math.max(p.x, x);
          if (e.x + halfW(e) > lo + 0.2 && e.x - halfW(e) < hi - 0.2) block = 60;
        }
        const score = f - 5 * Math.abs(x - p.x) - block;
        if (score > bestScore) { bestScore = score; best = x; bestFree = f; }
      }
      this.target = best;
      const stopDist = p.v * p.v / (2 * T.brake) + p.v * this.k.react + 4;
      this.brake = Math.min(curFree, bestFree) < stopDist && bestFree < stopDist + 4;
      this.boost = bestFree >= this.k.look * 0.85 && p.boostCharges > 0 && p.boostT <= 0;
    }
    const d = this.target - p.x;
    if (d > 0.12) inp.right = true; else if (d < -0.12) inp.left = true;
    inp.brake = this.brake;
    inp.boostDown = this.boost;
    this.boost = false;
    return inp;
  }
}
