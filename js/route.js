// 路線：中心線幾何、路段斷面、路口、分岔（規格 6.1～6.2、6.6、5.3）。純資料，不碰畫面。
// 路線座標：s＝沿中心線距離（起點 0、終點 L），x＝橫向（右為正）。
// 世界座標：Y 朝上；前進方向 f＝(sinθ, 0, cosθ)，右方 r＝(−cosθ, 0, sinθ)。
// 分岔：Route 是主線；分岔裡的兩條路各是一個 Branch（同樣的介面：sample、toWorld、bounds、profileAt…），
// x 是離那條路中心線的距離。東西在哪條路上看它的 R（view）。
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
  // 以下兩種只用在分岔裡（規格 6.6），都是單行道
  oneway: {
    left: -4.5, right: 4.5, twoWay: false, speed: 1.05,
    lanes: [{ x: -2.85, dir: 1, cls: 'car' }, { x: 0.45, dir: 1, cls: 'car' }, { x: 3.3, dir: 1, cls: 'moto' }],
    facadeL: -8.5, facadeR: 8.5, arcade: 3.0, curb: 4.5,
    mix: { scooter: 0.4, car: 0.3, taxi: 0.12, bus: 0.06, truck: 0.06, pickup: 0.06 },
  },
  lane: {
    left: -3.0, right: 3.0, twoWay: false, speed: 0.8,
    lanes: [{ x: -1.4, dir: 1, cls: 'moto' }, { x: 1.4, dir: 1, cls: 'moto' }],
    facadeL: -3.9, facadeR: 3.9, arcade: 0, parkL: [-3.9, -3.0], parkR: [3.0, 3.9],
    mix: { scooter: 0.8, bicycle: 0.12, oldscooter: 0.08 },
  },
};

// 分岔兩條路的名稱（指示牌、HUD）
export const BRANCH_NAMES = { market: '夜市捷徑', lane: '巷子抄近路', oneway: '大馬路' };

const SAMPLE = 1; // 中心線取樣間距（公尺）
export const PRE = 60; // 起點前多算的長度
export const POST = 160; // 終點後多算的長度
export const RAMP = 150; // 分岔：兩條路分開／收回的漸變長度

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

export class Route {
  constructor(level) {
    this.level = level;
    this.L = level.length;
    const rng = makeRng(hashStr('route:' + level.id));
    this.rng = rng;
    // 路段 s 範圍
    this.sections = [];
    this.forks = [];
    let s = 0;
    for (const [type, len, bl, br] of level.segs) {
      const sec = { type, s0: s, s1: s + len };
      this.sections.push(sec);
      if (type === 'fork') this.forks.push({ s0: s, s1: s + len, L: bl, R: br, sec });
      s += len;
    }
    this.sections[0].s0 = -PRE;
    this.sections[this.sections.length - 1].s1 = this.L + POST;
    for (const f of this.forks) {
      const i = this.sections.indexOf(f.sec);
      f.prev = this.sections[i - 1].type;
      f.next = this.sections[i + 1].type;
    }
    this._buildCenterline(rng);
    this._buildIntersections(rng);
    for (const f of this.forks) this._buildFork(f);
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
  // 分岔段在主線上沒有路面：給它分岔前那一段的斷面（只有邊界情況會問到）
  profileAt(s) {
    const sec = this.sectionAt(s);
    if (sec.type !== 'fork') return PROFILES[sec.type];
    return PROFILES[this.forks.find((f) => f.sec === sec).prev];
  }

  forkAt(s) {
    for (const f of this.forks) if (s >= f.s0 && s < f.s1) return f;
    return null;
  }

  // 可騎範圍（路段交界前後 15 公尺漸變；分岔交界不漸變）
  bounds(s) {
    const i = this.sections.indexOf(this.sectionAt(s));
    const cur = this.profileAt(s);
    let left = cur.left, right = cur.right;
    const blend = (other, d) => {
      if (other.type === 'fork') return;
      const t = 0.5 - d / 30; // d：離交界距離（−15～15）
      if (t <= 0) return;
      const o = PROFILES[other.type];
      left += (o.left - left) * t; right += (o.right - right) * t;
    };
    const sec = this.sections[i];
    if (sec.type === 'fork') return { left, right };
    if (i > 0 && s - sec.s0 < 15) blend(this.sections[i - 1], s - sec.s0);
    if (i < this.sections.length - 1 && sec.s1 - s < 15) blend(this.sections[i + 1], sec.s1 - s);
    return { left, right };
  }

  _buildIntersections(rng) {
    const list = [];
    const bounds = this.sections.map((x) => x.s0).slice(1);
    for (const sec of this.sections) {
      if (sec.type === 'fork') continue;
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
    // 路段交界放一個路口（巷弄接街道就是巷子口）；分岔的交界不放
    for (const sb of bounds) {
      if (sb <= 20 || sb >= this.L - 30) continue;
      for (let k = list.length - 1; k >= 0; k--) if (Math.abs(list[k].s - sb) < 45) list.splice(k, 1);
      const tA = this.typeAt(sb - 1), tB = this.typeAt(sb + 1);
      if (tA === 'fork' || tB === 'fork') continue;
      const big = (t) => t === 'street' || t === 'avenue' || t === 'highway';
      list.push({ s: sb, kind: 'cross', width: 12, light: big(tA) && big(tB), offset: rng.range(0, 18), side: 'both', type: tB, boundary: true });
    }
    // 分岔前後 60 公尺不放路口；合流後是雙向路就放一個左側巷口，讓對向車右轉離開（規格 6.6）
    for (const f of this.forks) {
      for (let k = list.length - 1; k >= 0; k--) {
        const s = list[k].s;
        if ((s > f.s0 - 60 && s < f.s0 + 1) || (s > f.s1 - 1 && s < f.s1 + 60)) list.splice(k, 1);
      }
      if (PROFILES[f.next].twoWay) {
        const s = f.s1 + 22;
        list.push({ s, kind: 'mouth', width: 5, light: false, side: 'L', type: f.next, exit: true });
        f.exit = s;
      }
    }
    list.sort((p, q) => p.s - q.s);
    list.forEach((it, i) => { it.id = i; it.half = it.width / 2; });
    this.inters = list;
  }

  _buildFork(f) {
    const L = new Branch(this, f, -1), R = new Branch(this, f, 1);
    f.views = [L, R];
    f.Lv = L; f.Rv = R;
    // 兩條路中間要放得下：兩邊內側的人行道（＋騎樓）＋兩排房子（各 13 公尺）（規格 6.6）
    const walkL = L.walk(1), walkR = R.walk(-1);
    f.needWalk = walkL + walkR + 0.6;
    f.needBuild = walkL + walkR + 2 * 9 + 1;
    const need = walkL + walkR + 2 * 13 + 4;
    const pF = PROFILES[f.prev], pM = PROFILES[f.next];
    const g0 = Math.min(pF.right - pF.left, pM.right - pM.left) - 2 * L.hw - 2 * R.hw;
    const total = need - g0;
    L.d = total * 0.35; R.d = total * 0.65;
    // 分岔點：重疊區的中線（主線座標）
    f.divide = (pF.left + 2 * L.hw + pF.right - 2 * R.hw) / 2;
    f.names = [BRANCH_NAMES[f.L], BRANCH_NAMES[f.R]];
    // 內側路面邊緣的間距（> 0 才分開）
    f.gap = (s) => (R.c(s) - R.hw) - (L.c(s) + L.hw);
    // 間距 ≥ need 的 s 範圍
    f.openRange = (need) => {
      let a = null, b = null;
      for (let s = f.s0; s <= f.s1; s += 1) if (f.gap(s) >= need) { if (a == null) a = s; b = s; }
      return a == null ? null : [a, b];
    };
    for (const v of f.views) v._buildInters();
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

// 分岔裡的一條路（規格 6.6）。中心線＝主線中心線往旁邊偏 c(s)；斷面用自己的路段種類。
export class Branch {
  constructor(trunk, fork, side) {
    this.trunk = trunk;
    this.fork = fork;
    this.branch = side; // −1 左路、+1 右路
    this.level = trunk.level;
    this.L = trunk.L;
    this.type = side < 0 ? fork.L : fork.R;
    this.P = PROFILES[this.type];
    this.s0 = fork.s0; this.s1 = fork.s1;
    this.sections = [{ type: this.type, s0: fork.s0, s1: fork.s1 }];
    this.forks = [];
    this.hw = (this.P.right - this.P.left) / 2;
    this.inner = -side; // 靠另一條路的那一側（+1＝右側）
    const pF = PROFILES[fork.prev], pM = PROFILES[fork.next];
    // 分岔點與合流點：外側路緣跟主線的路緣對齊
    this.cF = side < 0 ? pF.left - this.P.left : pF.right - this.P.right;
    this.cM = side < 0 ? pM.left - this.P.left : pM.right - this.P.right;
    this.d = 0;
    this.yOff = side < 0 ? 0.015 : 0; // 重疊區左路蓋在右路上面
    this.inters = [];
  }

  // 中心線的橫向偏移（主線座標）
  c(s) {
    const f = this.fork;
    const u = (s - f.s0) / (f.s1 - f.s0);
    const base = this.cF + (this.cM - this.cF) * smooth(u);
    const ramp = smooth((s - f.s0) / RAMP) * smooth((f.s1 - s) / RAMP);
    return base + this.branch * this.d * ramp;
  }

  // 內側（side）人行道＋騎樓的寬度
  walk(side) {
    const P = this.P;
    return side > 0 ? P.facadeR + (P.arcade || 0) - P.right + 0.3 : P.left - P.facadeL + (P.arcade || 0) + 0.3;
  }

  sample(s, out = {}) {
    this.trunk.sample(s, out);
    const c = this.c(s);
    out.x += out.rx * c; out.z += out.rz * c;
    const th = out.th - Math.atan(this.c(s + 0.5) - this.c(s - 0.5));
    out.th = th;
    out.fx = Math.sin(th); out.fz = Math.cos(th);
    out.rx = -out.fz; out.rz = out.fx;
    return out;
  }

  toWorld(s, lat, out = {}) {
    const p = this.sample(s, out);
    out.wx = p.x + p.rx * lat;
    out.wz = p.z + p.rz * lat;
    return out;
  }

  // 這條路的 x → 主線的 x（只在分岔點、合流點用：那裡兩邊的方向一樣）
  toTrunkX(s, x) { return this.c(s) + x; }
  fromTrunkX(s, x) { return x - this.c(s); }

  sectionAt() { return this.sections[0]; }
  typeAt() { return this.type; }
  profileAt() { return this.P; }
  bounds() { return { left: this.P.left, right: this.P.right }; }
  forkAt() { return null; }
  lightState() { return 'none'; }
  lightRemain() { return 0; }
  intersAround(s0, s1) { return this.inters.filter((it) => it.s + it.half >= s0 && it.s - it.half <= s1); }
  interAt(s, margin = 0) {
    for (const it of this.inters) if (Math.abs(s - it.s) <= it.half + margin) return it;
    return null;
  }

  // 窄路外側的小巷口（規格 6.6：分岔裡沒有紅綠燈路口）
  _buildInters() {
    if (this.type === 'oneway') return;
    const rng = makeRng(hashStr(`br:${this.level.id}:${this.s0}:${this.branch}`));
    const out = this.branch < 0 ? 'L' : 'R';
    let s = this.s0 + RAMP * 0.6 + rng.range(10, 40);
    while (s < this.s1 - RAMP * 0.6) {
      this.inters.push({ s, kind: 'mouth', width: this.type === 'market' ? 4 : 3.6, light: false, side: out, type: this.type });
      s += rng.range(60, 110);
    }
    this.inters.forEach((it, i) => { it.id = 1000 * (this.branch + 2) + i; it.half = it.width / 2; });
  }
}
