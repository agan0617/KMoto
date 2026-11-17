// 路線：中心線幾何、路段斷面、路口（規格 6.1～6.2、5.3）。純資料，不碰畫面。
// 路線座標：s＝沿中心線距離（起點 0、終點 L），x＝橫向（右為正）。
// 世界座標：Y 朝上；前進方向 f＝(sinθ, 0, cosθ)，右方 r＝(−cosθ, 0, sinθ)。
import { makeRng, hashStr } from './rng.js';

// 斷面（x 右為正）。lanes：cls car／moto，dir +1 同向、−1 對向。
// facadeL/R：建築正面（樓上）位置；arcade：騎樓深度（樓下店面再往內縮）。
export const PROFILES = {
  alley: {
    left: -3.0, right: 3.0, twoWay: true, speed: 0.75,
    lanes: [{ x: 1.5, dir: 1, cls: 'moto' }, { x: 1.2, dir: 1, cls: 'car' }, { x: -1.5, dir: -1, cls: 'moto' }, { x: -1.2, dir: -1, cls: 'car' }],
    facadeL: -3.9, facadeR: 3.9, arcade: 0, parkL: [-3.9, -3.0], parkR: [3.0, 3.9],
    mix: { scooter: 0.62, car: 0.18, bicycle: 0.1, oldscooter: 0.1 },
  },
  street: {
    left: -5.6, right: 5.6, twoWay: true, speed: 0.9,
    lanes: [{ x: 1.45, dir: 1, cls: 'car' }, { x: 2.9, dir: 1, cls: 'moto' }, { x: -1.45, dir: -1, cls: 'car' }, { x: -2.9, dir: -1, cls: 'moto' }],
    facadeL: -6.0, facadeR: 6.0, arcade: 3.0, curb: 5.6, carPark: [-4.6, 4.6], parkLine: 3.6,
    mix: { scooter: 0.5, car: 0.25, taxi: 0.1, pickup: 0.1, oldscooter: 0.05 },
  },
  avenue: {
    left: -4.5, right: 4.5, twoWay: false, speed: 1.0,
    lanes: [{ x: -2.85, dir: 1, cls: 'car' }, { x: 0.45, dir: 1, cls: 'car' }, { x: 3.3, dir: 1, cls: 'moto' }],
    median: [-7.5, -4.5], opp: [-16.5, -7.5], oppLanes: [-9.15, -12.45, -15.3],
    facadeL: -20.5, facadeR: 8.5, arcade: 3.0, curb: 4.5,
    mix: { scooter: 0.45, car: 0.3, taxi: 0.12, bus: 0.08, pickup: 0.05 },
  },
  market: {
    left: -3.75, right: 3.75, twoWay: false, speed: 0.6,
    lanes: [{ x: -1.5, dir: 1, cls: 'moto' }, { x: 1.5, dir: 1, cls: 'moto' }],
    facadeL: -6.2, facadeR: 6.2, arcade: 2.5, stalls: true,
    mix: { scooter: 0.8, bicycle: 0.2 },
  },
  highway: {
    left: -3.5, right: 6.0, twoWay: false, speed: 1.25,
    lanes: [{ x: -1.75, dir: 1, cls: 'car' }, { x: 1.75, dir: 1, cls: 'car' }, { x: 4.7, dir: 1, cls: 'moto' }],
    median: [-5.5, -3.5], opp: [-12.5, -5.5], oppLanes: [-7.25, -10.75],
    facadeL: -40, facadeR: 30, arcade: 0, curb: 6.0, rural: true,
    mix: { car: 0.4, scooter: 0.25, truck: 0.15, pickup: 0.2 },
  },
};

const SAMPLE = 1; // 中心線取樣間距（公尺）
export const PRE = 60; // 起點前多算的長度
export const POST = 160; // 終點後多算的長度

export class Route {
  constructor(level) {
    this.level = level;
    this.L = level.length;
    const rng = makeRng(hashStr('route:' + level.id));
    this.rng = rng;
    // 路段 s 範圍
    this.sections = [];
    let s = 0;
    for (const [type, len] of level.segs) { this.sections.push({ type, s0: s, s1: s + len }); s += len; }
    this.sections[0].s0 = -PRE;
    this.sections[this.sections.length - 1].s1 = this.L + POST;
    this._buildCenterline(rng);
    this._buildIntersections(rng);
  }

  _buildCenterline(rng) {
    const n = Math.ceil((this.L + PRE + POST) / SAMPLE) + 2;
    this.n = n;
    this.px = new Float64Array(n); this.pz = new Float64Array(n); this.th = new Float64Array(n);
    // 曲率序列：直線 80～300、緩彎半徑 220～600、轉角 ≤ 25°；總方向維持在 ±50° 內
    const curv = new Float64Array(n);
    let i = 0, heading = 0;
    let first = true;
    while (i < n) {
      const straight = Math.round((first ? 160 : rng.range(80, 300)) / SAMPLE);
      first = false;
      i += straight;
      if (i >= n) break;
      const R = rng.range(220, 600);
      let ang = rng.range(8, 25) * Math.PI / 180;
      let sign = rng.chance(0.5) ? 1 : -1;
      if (Math.abs(heading + sign * ang) > 50 * Math.PI / 180) sign = -sign;
      heading += sign * ang;
      const len = Math.round(R * ang / SAMPLE);
      for (let k = 0; k < len && i < n; k++, i++) curv[i] = sign / R;
    }
    let x = 0, z = 0, th = 0;
    for (let k = 0; k < n; k++) {
      this.px[k] = x; this.pz[k] = z; this.th[k] = th;
      th += curv[k] * SAMPLE;
      x += Math.sin(th) * SAMPLE; z += Math.cos(th) * SAMPLE;
    }
    // 讓 s=0 在原點
    const k0 = PRE / SAMPLE, ox = this.px[k0], oz = this.pz[k0];
    for (let k = 0; k < n; k++) { this.px[k] -= ox; this.pz[k] -= oz; }
  }

  // 中心線上 s 處：{ x, z, th, fx, fz, rx, rz }
  sample(s, out = {}) {
    let f = (s + PRE) / SAMPLE;
    if (f < 0) f = 0;
    if (f > this.n - 1.001) f = this.n - 1.001;
    const k = Math.floor(f), t = f - k;
    out.x = this.px[k] + (this.px[k + 1] - this.px[k]) * t;
    out.z = this.pz[k] + (this.pz[k + 1] - this.pz[k]) * t;
    const th = this.th[k] + (this.th[k + 1] - this.th[k]) * t;
    out.th = th;
    out.fx = Math.sin(th); out.fz = Math.cos(th);
    out.rx = -out.fz; out.rz = out.fx;
    return out;
  }

  // 路線座標 → 世界座標（y 另外給）
  toWorld(s, lat, out = {}) {
    const p = this.sample(s, out);
    out.wx = p.x + p.rx * lat;
    out.wz = p.z + p.rz * lat;
    return out;
  }

  sectionAt(s) {
    for (const sec of this.sections) if (s < sec.s1) return sec;
    return this.sections[this.sections.length - 1];
  }

  typeAt(s) { return this.sectionAt(s).type; }
  profileAt(s) { return PROFILES[this.typeAt(s)]; }

  // 可騎範圍（路段交界前後 15 公尺漸變）
  bounds(s) {
    const i = this.sections.indexOf(this.sectionAt(s));
    const cur = PROFILES[this.sections[i].type];
    let left = cur.left, right = cur.right;
    const blend = (other, d) => {
      const t = 0.5 - d / 30; // d：離交界距離（−15～15）
      if (t <= 0) return;
      const o = PROFILES[other.type];
      left += (o.left - left) * t; right += (o.right - right) * t;
    };
    const sec = this.sections[i];
    if (i > 0 && s - sec.s0 < 15) blend(this.sections[i - 1], s - sec.s0);
    if (i < this.sections.length - 1 && sec.s1 - s < 15) blend(this.sections[i + 1], sec.s1 - s);
    return { left, right };
  }

  _buildIntersections(rng) {
    const list = [];
    const bounds = this.sections.map((x) => x.s0).slice(1);
    for (const sec of this.sections) {
      const p = PROFILES[sec.type];
      const a = Math.max(sec.s0, 40), b = Math.min(sec.s1, this.L - 60);
      if (sec.type === 'street' || sec.type === 'avenue' || sec.type === 'highway') {
        const step = sec.type === 'highway' ? [300, 500] : [140, 260];
        let s = a + rng.range(50, 110);
        while (s < b - 40) {
          list.push({ s, kind: 'cross', width: sec.type === 'avenue' ? 16 : sec.type === 'highway' ? 10 : 9,
            light: true, offset: rng.range(0, 18), side: 'both', type: sec.type });
          s += rng.range(step[0], step[1]);
        }
      } else {
        let s = a + rng.range(30, 60);
        while (s < b - 20) {
          const r = rng();
          list.push({ s, kind: 'mouth', width: sec.type === 'market' ? 4 : 3.6, light: false,
            side: r < 0.4 ? 'L' : r < 0.8 ? 'R' : 'both', type: sec.type });
          s += rng.range(45, 90);
        }
      }
    }
    // 路段交界放一個路口（巷弄接街道就是巷子口）
    for (const sb of bounds) {
      if (sb <= 20 || sb >= this.L - 30) continue;
      for (let k = list.length - 1; k >= 0; k--) if (Math.abs(list[k].s - sb) < 45) list.splice(k, 1);
      const tA = this.typeAt(sb - 1), tB = this.typeAt(sb + 1);
      const big = (t) => t === 'street' || t === 'avenue' || t === 'highway';
      list.push({ s: sb, kind: 'cross', width: 12, light: big(tA) && big(tB), offset: rng.range(0, 18), side: 'both', type: tB, boundary: true });
    }
    list.sort((p, q) => p.s - q.s);
    list.forEach((it, i) => { it.id = i; it.half = it.width / 2; });
    this.inters = list;
  }

  // 路口號誌：玩家方向的燈。週期 綠 9、黃 2、紅 7（規格 5.3）
  lightState(inter, t) {
    if (!inter.light) return 'none';
    const c = (t + inter.offset) % 18;
    return c < 9 ? 'green' : c < 11 ? 'yellow' : 'red';
  }
  lightRemain(inter, t) {
    const c = (t + inter.offset) % 18;
    return c < 9 ? 9 - c : c < 11 ? 11 - c : 18 - c;
  }

  intersAround(s0, s1) {
    return this.inters.filter((it) => it.s + it.half >= s0 && it.s - it.half <= s1);
  }

  // s 處是否在路口範圍內（建築要讓出來）
  interAt(s, margin = 0) {
    for (const it of this.inters) if (Math.abs(s - it.s) <= it.half + margin) return it;
    return null;
  }
}
