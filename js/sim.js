// 遊戲模擬（規格第 3～5 章）：機車物理、車流、三寶事件、碰撞、擦身而過、計時。
// 純邏輯、不碰畫面；node（tools/sim.mjs）與瀏覽器共用。
import { TUNING as T, STEP } from './tuning.js';
import { Route, PROFILES } from './route.js';
import { makeRng, hashStr } from './rng.js';
import { LEVELS } from './levels.js';

// 車種尺寸與速度（規格 5.1）
export const KINDS = {
  scooter: { len: 1.9, wid: 0.75, v: [8, 14], cls: 'moto' },
  oldscooter: { len: 1.85, wid: 0.72, v: [5.5, 6.5], cls: 'moto' },
  bicycle: { len: 1.8, wid: 0.6, v: [4, 6], cls: 'moto' },
  car: { len: 4.5, wid: 1.8, v: [9, 15], cls: 'car' },
  taxi: { len: 4.6, wid: 1.8, v: [9, 15], cls: 'car' },
  pickup: { len: 4.6, wid: 1.7, v: [8, 12], cls: 'car' },
  bus: { len: 11, wid: 2.5, v: [7, 11], cls: 'car' },
  truck: { len: 9, wid: 2.5, v: [9, 12], cls: 'car' },
  garbage: { len: 7, wid: 2.3, v: [3.5, 4.5], cls: 'car' },
  campaign: { len: 4.8, wid: 1.8, v: [3.5, 4.5], cls: 'car' },
  ped: { len: 0.5, wid: 0.5, v: [1.0, 1.6], cls: 'ped' },
  dog: { len: 0.8, wid: 0.32, v: [3, 3], cls: 'ped' },
};
const VEHICLE = new Set(['scooter', 'oldscooter', 'bicycle', 'car', 'taxi', 'pickup', 'bus', 'truck', 'garbage', 'campaign']);
const SMALL = new Set(['cone', 'box', 'bag']);
const CRASHY = new Set(['ped', 'dog', 'sign', 'fallen', 'proc']);
const ROADFX = new Set(['pothole', 'puddle', 'manhole', 'bump']);

const CROSS_FROM = LEVELS.findIndex((l) => l.id === '2-3');

let _id = 1;

export class Sim {
  constructor(level, opts = {}) {
    this.level = level;
    this.route = new Route(level);
    this.L = this.route.L;
    this.rng = makeRng(hashStr('sim:' + level.id));
    this.rtRng = makeRng(hashStr('rt:' + level.id)); // 執行期亂數（抖動、橫向車流時機）
    this.weather = level.weather || (level.time === 'rain' ? 'rain' : null);
    this.wet = !!this.weather;
    this.crossTraffic = LEVELS.indexOf(level) >= CROSS_FROM;
    this.ents = [];
    this.fx = []; // 給畫面／音效的事件
    this.t = 0; // GO 之後的時間
    this.clock = 0; // 從開始（含倒數）的時間
    this.countdown = opts.noCountdown ? 0 : 3.0;
    this.phase = this.countdown > 0 ? 'countdown' : 'run';
    this.timeLeft = level.limit;
    this.result = null;
    const prof0 = this.route.profileAt(0);
    const startLane = prof0.lanes.filter((l) => l.dir === 1).sort((a, b) => b.x - a.x)[0];
    this.player = {
      s: 0, x: startLane ? startLane.x : 0, v: 0, vx: 0, ang: 0, lean: 0,
      boostCharges: 1, boostMeter: 0, boostT: 0,
      crash: null, invuln: 0, jitter: 0, jitterDir: 1, jitterT: 0,
      near: 0, close: 0, crashes: 0, grazes: 0, maxV: 0, hornCd: 0,
      scrapeLock: 0, wind: 0, steer: 0, brake: false,
    };
    this.gust = { next: 5, t: 0, dir: 1, warn: 0 };
    this.lastTick = 11;
    this._crossNext = new Map();
    this._genHazards();
    this._genTraffic();
    this._genParked();
    this._genEvents();
    this._genCrowds();
    this.ents.sort((a, b) => a.s - b.s);
  }

  // ---------- 產生 ----------
  _add(kind, s, x, o = {}) {
    const k = KINDS[kind] || {};
    const e = {
      id: _id++, kind, s, x, v: 0, dir: 1, vx: 0, ang: 0,
      len: o.len ?? k.len ?? 1, wid: o.wid ?? k.wid ?? 1,
      vd: 0, tx: x, normal: false, ghost: false, stat: false,
      lights: { brake: 0, blinkL: 0, blinkR: 0, hazard: 0, door: 0 },
      seed: (this.rng() * 1e9) | 0, ps: 0, touched: false, nearDone: false,
      ...o,
    };
    if (e.dir < 0 && !o.ang) e.ang = Math.PI;
    this.ents.push(e);
    return e;
  }

  _vehicleSpeed(kind, s) {
    const k = KINDS[kind];
    const f = this.route.profileAt(s).speed;
    const fk = (kind === 'scooter' || kind === 'car' || kind === 'taxi' || kind === 'pickup' || kind === 'truck') ? f : Math.min(1, f);
    return this.rng.range(k.v[0], k.v[1]) * fk;
  }

  _laneFor(kind, prof, dir) {
    const cls = KINDS[kind].cls;
    let lanes = prof.lanes.filter((l) => l.dir === dir && l.cls === cls);
    if (!lanes.length) lanes = prof.lanes.filter((l) => l.dir === dir);
    if (cls === 'moto' && this.rng.chance(0.3)) {
      const c = prof.lanes.filter((l) => l.dir === dir && l.cls === 'car');
      if (c.length) lanes = c;
    }
    if (!lanes.length) return null;
    return this.rng.pick(lanes).x;
  }

  _genTraffic() {
    const [dSame, dOpp] = this.level.dens;
    for (const sec of this.route.sections) {
      const prof = PROFILES[sec.type];
      const s0 = Math.max(sec.s0, -40), s1 = Math.min(sec.s1, this.L + 80);
      const len = s1 - s0;
      for (const dir of [1, -1]) {
        if (dir < 0 && !prof.twoWay) continue;
        const d = dir > 0 ? dSame : (dOpp ?? dSame * 0.6);
        const nl = Math.max(1, prof.lanes.filter((l) => l.dir === dir && l.cls === 'car').length);
        const count = Math.round(d * nl * len / 100);
        for (let i = 0; i < count; i++) {
          const s = this.rng.range(s0, s1);
          if (dir > 0 && s > -20 && s < 70) continue;
          if (this.route.interAt(s, 2)) continue;
          const kind = this.rng.weighted(prof.mix);
          if (this._closures && this._closures.some((c) => s > c.s0 - 10 && s < c.s1 + 5)) continue;
          if (kind === 'bus' && dir < 0) continue;
          const lx = this._laneFor(kind, prof, dir);
          if (lx == null) continue;
          const jit = KINDS[kind].cls === 'moto' ? this.rng.range(-0.35, 0.35) : 0;
          const vd = this._vehicleSpeed(kind, s);
          this._add(kind, s, lx + jit, { dir, v: vd, vd, tx: lx + jit, normal: kind !== 'oldscooter', moving: true });
        }
      }
      // 幹道、省道的對向車道：只看得到、碰不到（規格 6.2）
      if (prof.oppLanes) {
        const count = Math.round((dOpp ?? 1) * 1.2 * prof.oppLanes.length * len / 100);
        for (let i = 0; i < count; i++) {
          const s = this.rng.range(s0, s1);
          const lx = this.rng.pick(prof.oppLanes);
          const kind = this.rng.weighted(prof.mix);
          const vd = this._vehicleSpeed(kind, s) * 1.1;
          this._add(kind, s, lx, { dir: -1, v: vd, vd, tx: lx, ghost: true, moving: true, oppSide: true });
        }
      }
    }
  }

  _genParked() {
    // 社區街道的路邊停車格（規格 6.2）：汽車停 55%
    this.parked = [];
    for (const sec of this.route.sections) {
      if (sec.type !== 'street') continue;
      const prof = PROFILES.street;
      for (const side of [1, -1]) {
        for (let s = Math.max(sec.s0, -30) + 3; s < Math.min(sec.s1, this.L + 60) - 3; s += 6.2) {
          if (this.route.interAt(s, 4)) continue;
          if (!this.rng.chance(0.55)) continue;
          if (s > -12 && s < 14) continue;
          const kind = this.rng.weighted({ car: 0.7, taxi: 0.05, pickup: 0.25 });
          const e = this._add(kind, s, prof.carPark[side > 0 ? 1 : 0], { dir: side, stat: true, parked: true });
          this.parked.push(e);
        }
      }
    }
  }

  _genCrowds() {
    // 夜市路上逛街的人（規格 6.2 market）
    for (const sec of this.route.sections) {
      if (sec.type !== 'market') continue;
      const s0 = Math.max(sec.s0, 30), s1 = Math.min(sec.s1, this.L - 20);
      const n = Math.round((3 + this.level.dens[0] * 1.6) * (s1 - s0) / 100);
      for (let i = 0; i < n; i++) {
        const s = this.rng.range(s0, s1);
        const x = this.rng.range(-3.3, 3.3);
        const dir = this.rng.chance(0.5) ? 1 : -1;
        this._add('ped', s, x, { dir, v: this.rng.range(0.5, 1.1), vd: 0, wander: true, moving: true,
          phone: this.rng.chance(0.3), wphase: this.rng.range(0, 6) });
      }
    }
  }

  _genHazards() {
    const L = this.L;
    const n = Math.round(this.level.hz * L / 1000);
    const lvIdx = LEVELS.indexOf(this.level);
    const constrOK = lvIdx >= LEVELS.findIndex((l) => l.id === '3-4');
    const typhoon = this.weather === 'typhoon';
    let last = -999;
    for (let i = 0; i < n; i++) {
      let s = this.rng.range(150, L - 120);
      if (Math.abs(s - last) < 40) s = Math.min(L - 120, s + 60);
      last = s;
      if (this.route.interAt(s, 3)) s += 20;
      const type = this.route.typeAt(s);
      const b = this.route.bounds(s);
      const r = this.rng();
      if (constrOK && (type === 'avenue' || type === 'highway') && r < 0.35) {
        this._construction(s, type, b);
      } else if (typhoon && r < 0.7) {
        const k = this.rng.chance(0.5) ? 'sign' : 'fallen';
        this._add(k, s, this.rng.range(b.left + 1, b.right - 1), { stat: true, len: k === 'sign' ? 1.0 : 1.8, wid: k === 'sign' ? 2.2 : 0.8, ang: this.rng.range(-0.6, 0.6) });
      } else if (r < 0.75) {
        // 坑洞或凸起的人孔蓋（補丁路，規格 5.5）
        const k = this.rng.chance(0.4) ? 'bump' : 'pothole';
        this._add(k, s, this.rng.range(b.left + 0.8, b.right - 0.8), { stat: true, len: 1.0, wid: 1.0 });
      } else {
        const k = this.rng.chance(0.5) ? 'box' : 'bag';
        this._add(k, s, this.rng.range(b.left + 0.6, b.right - 0.6), { stat: true, len: 0.6, wid: 0.6 });
      }
    }
    // 雨天：積水、人孔蓋
    if (this.wet) {
      const np = Math.round((typhoon ? 9 : 6) * L / 1000);
      for (let i = 0; i < np; i++) {
        const s = this.rng.range(100, L - 60);
        const b = this.route.bounds(s);
        this._add('puddle', s, this.rng.range(b.left + 1.2, b.right - 1.2), { stat: true, len: 3.0, wid: 1.8 });
      }
    }
    for (let s = 60; s < L; s += this.rng.range(50, 90)) {
      const b = this.route.bounds(s);
      this._add('manhole', s, this.rng.range(b.left + 0.8, b.right - 0.8), { stat: true, len: 0.8, wid: 0.8 });
    }
  }

  _construction(s, type, b) {
    // 施工封路：三角錐斜線＋圍籬，封 1～2 車道 30～60 m（規格 5.5）
    const fromRight = this.rng.chance(0.6);
    const width = type === 'avenue' ? (fromRight ? 2.4 : 3.3) : (fromRight ? 2.5 : 3.5); // 只封一個車道（或機車道／路肩）
    const len = this.rng.range(30, 60);
    const edge = fromRight ? b.right : b.left;
    const inner = fromRight ? b.right - width : b.left + width;
    // 錐形漸變 14 m
    for (let k = 0; k <= 7; k++) {
      const t = k / 7;
      this._add('cone', s + t * 14, edge + (inner - edge) * t, { stat: true, len: 0.45, wid: 0.45 });
    }
    (this._closures = this._closures || []).push({ s0: s, s1: s + len, x0: Math.min(edge, inner), x1: Math.max(edge, inner) });
    for (let d = 15; d < len; d += 2.0) {
      this._add('barrier', s + d, inner + (fromRight ? 0.3 : -0.3), { stat: true, len: 2.0, wid: 0.4, constr: true });
    }
    for (let d = 16; d < len; d += 4) this._add('cone', s + d, (edge + inner) / 2, { stat: true, len: 0.45, wid: 0.45, ghost: true, deco: true });
    this._add('cone', s + len, inner, { stat: true, len: 0.45, wid: 0.45 });
  }

  _genEvents() {
    const lv = this.level;
    this.events = [];
    const n = Math.round(lv.ev * this.L / 1000);
    const types = lv.events.slice();
    // 一直存在型的先放：垃圾車、遶境各一次
    const placed = [];
    const place = (s) => { placed.push(s); };
    const tooClose = (s) => placed.some((p) => Math.abs(p - s) < 55);
    const pickS = () => {
      for (let k = 0; k < 40; k++) {
        const s = this.rng.range(140, this.L - 110);
        if (!tooClose(s)) return s;
      }
      return this.rng.range(140, this.L - 110);
    };
    const want = [];
    if (types.includes('garbage')) want.push('garbage');
    if (types.includes('procession')) want.push('procession');
    if (types.includes('campaign')) want.push('campaign');
    const pool = types.filter((t) => t !== 'garbage' && t !== 'procession' && t !== 'campaign');
    // 每種至少出現一次（新障礙一定看得到，規格 11.3）
    for (const t of pool) want.push(t);
    while (want.length < n) want.push(this.rng.pick(pool.length ? pool : types));
    for (const type of want) {
      let s = null;
      for (let k = 0; k < 30 && s == null; k++) {
        const c = pickS();
        if (this._eventFits(type, c)) s = c;
      }
      if (s == null) continue;
      place(s);
      this.events.push(this._makeEvent(type, s));
    }
    this.events.sort((a, b) => a.s - b.s);
  }

  _eventFits(type, s) {
    const t = this.route.typeAt(s);
    const it = this.route.interAt(s, 6);
    switch (type) {
      case 'door': return t === 'street';
      case 'bus': return t === 'avenue';
      case 'double': return t === 'street' || t === 'avenue';
      case 'cutin': return t !== 'alley' && t !== 'market';
      case 'taxi': return t !== 'alley' && t !== 'market';
      case 'truck': return t === 'highway' || t === 'avenue';
      case 'uturn': return t !== 'market' && !it;
      case 'garbage': return t === 'alley' || t === 'street';
      case 'pullout': return t === 'street';
      case 'walker': return t === 'street' || t === 'avenue';
      case 'rightturn': case 'bigturn': return !!this.route.inters.find((x) => x.kind === 'cross' && !x.boundary && x.s > 120 && Math.abs(x.s - s) < 140 && (x.type === 'street' || x.type === 'avenue' || x.type === 'highway'));
      case 'campaign': return t !== 'alley' && t !== 'market';
      case 'drunk': case 'drugged': return t !== 'alley' && t !== 'market';
      case 'procession': return t === 'street' || t === 'highway';
      case 'alley': return !!this.route.inters.find((x) => Math.abs(x.s - s) < 50);
      default: return true;
    }
  }

  _makeEvent(type, s) {
    const ev = { type, s, state: 'wait', t: 0, actors: [], side: this.rng.chance(0.5) ? 1 : -1, seed: this.rng() };
    if (type === 'alley') {
      const it = this.route.inters.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best));
      ev.s = it.s;
      ev.side = it.side === 'L' ? -1 : it.side === 'R' ? 1 : ev.side;
    }
    if (type === 'door') {
      let best = null;
      for (const p of this.parked) if (p.x > 0 && Math.abs(p.s - s) < 50 && (!best || Math.abs(p.s - s) < Math.abs(best.s - s))) best = p;
      if (!best) best = this._add('car', s, PROFILES.street.carPark[1], { dir: 1, stat: true, parked: true });
      best.doorEv = true;
      ev.car = best; ev.s = best.s;
    }
    if (type === 'bus') ev.stop = s;
    if (type === 'rightturn' || type === 'bigturn') {
      const its = this.route.inters.filter((x) => x.kind === 'cross' && !x.boundary && x.s > 120 && (x.type === 'street' || x.type === 'avenue' || x.type === 'highway'));
      const it = its.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best));
      ev.it = it; ev.s = it.s - 40;
    }
    // 什麼時候建立演員：玩家到事件前多遠
    if (type === 'pullout') {
      let best = null;
      for (const p of this.parked) if (p.x > 0 && !p.doorEv && Math.abs(p.s - s) < 50 && (!best || Math.abs(p.s - s) < Math.abs(best.s - s))) best = p;
      if (!best) best = this._add('car', s, PROFILES.street.carPark[1], { dir: 1, stat: true, parked: true });
      best.doorEv = true;
      ev.car = best; ev.s = best.s;
    }
    ev.spawnAt = { wrongway: 175, procession: 260, garbage: 260, uncle: 230, truck: 230, double: 240, campaign: 260, drunk: 240, drugged: 240, delivery: 200, walker: 220, rightturn: 190, bigturn: 200 }[type] ?? 150;
    return ev;
  }

  // ---------- 每步 ----------
  step(dt, input) {
    const p = this.player;
    this.clock += dt;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (input && input.boostDown) this._preBoost = this.countdown; // 保留（規格沒有起步噴）
      if (this.countdown <= 0) { this.phase = 'run'; this.fx.push({ type: 'go' }); }
      this._updateTraffic(dt, true);
      return;
    }
    if (this.phase === 'done') {
      // 結束後機車慢慢停下、畫面照跑
      p.v = Math.max(0, p.v - 10 * dt);
      p.s += p.v * dt;
      this._updateTraffic(dt, false);
      return;
    }
    this.t += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 10 && Math.ceil(this.timeLeft) < this.lastTick && this.timeLeft > 0) {
      this.lastTick = Math.ceil(this.timeLeft);
      this.fx.push({ type: 'tick', n: this.lastTick });
    }
    this._updatePlayer(dt, input || {});
    this._updateEvents(dt);
    this._updateTraffic(dt, false);
    this._collide(dt);
    if (p.s >= this.L && !this.result) {
      this.phase = 'done';
      this.result = this._makeResult(true);
      this.fx.push({ type: 'arrive' });
    } else if (this.timeLeft <= 0 && !this.result) {
      this.timeLeft = 0;
      this.phase = 'done';
      this.result = this._makeResult(false);
      this.fx.push({ type: 'timeout' });
    }
  }

  _makeResult(win) {
    const p = this.player, lv = this.level;
    let stars = 0;
    if (win) {
      stars = 1;
      if (this.timeLeft >= lv.star[0]) stars = 2;
      if (this.timeLeft >= lv.star[1] && p.crashes === 0) stars = 3;
    }
    return { win, stars, remain: Math.max(0, this.timeLeft), near: p.near, close: p.close, crashes: p.crashes,
      maxKmh: Math.round(p.maxV * 3.6), shortBy: win ? 0 : Math.max(0, Math.round(this.L - p.s)) };
  }

  _updatePlayer(dt, inp) {
    const p = this.player;
    p.hornCd = Math.max(0, p.hornCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.scrapeLock = Math.max(0, p.scrapeLock - dt);
    if (p.crash) {
      const c = p.crash;
      c.t += dt;
      p.v = Math.max(0, p.v - 11 * dt);
      p.s += p.v * dt;
      p.vx *= Math.max(0, 1 - 3 * dt);
      p.x += p.vx * dt;
      const b = this.route.bounds(p.s);
      p.x = Math.min(b.right - 0.4, Math.max(b.left + 0.4, p.x));
      if (c.t >= T.crashSlide + T.crashFade && !c.respawned) {
        c.respawned = true;
        p.x = this._freeX(p.s, p.x);
        p.v = 0; p.vx = 0; p.ang = 0;
        p.invuln = T.invuln;
        p.crash = null;
        this.fx.push({ type: 'respawn' });
      }
      return;
    }
    // 衝刺
    if (inp.boostDown && p.boostCharges > 0 && p.boostT <= 0) {
      p.boostCharges--; p.boostT = T.boostTime;
      this.fx.push({ type: 'boost' });
    }
    if (p.boostT > 0) p.boostT = Math.max(0, p.boostT - dt);
    // 喇叭
    if (inp.hornDown && p.hornCd <= 0) {
      p.hornCd = T.hornCooldown;
      this.fx.push({ type: 'horn' });
      for (const e of this.ents) {
        if (!e.normal || e.dir < 0 || e.ghost || e.stat) continue;
        const ds = e.s - p.s;
        if (ds > 0 && ds < T.hornRange && Math.abs(e.x - p.x) < 2.5) {
          const b = this.route.bounds(e.s);
          const away = e.x >= p.x ? 1 : -1;
          let tx = e.x + away * 1.2;
          const hw = e.wid / 2 + 0.15;
          tx = Math.min(b.right - hw, Math.max(b.left + hw, tx));
          e.tx = tx; e.yield = 1.0;
        }
      }
    }
    // 速度
    const top = T.maxSpeed + (p.boostT > 0 ? T.boostSpeed : 0);
    p.brake = !!inp.brake;
    if (inp.brake) {
      p.v = Math.max(0, p.v - T.brake * dt);
    } else if (p.v < top) {
      const r = p.v / top;
      const a = p.boostT > 0 ? T.boostAccel : T.accel * Math.max(0.25, 1 - r * r);
      p.v = Math.min(top, p.v + a * dt);
    } else {
      p.v = Math.max(top, p.v - ((p.v - top) * 1.2 + 1) * dt);
    }
    p.maxV = Math.max(p.maxV, p.v);
    // 轉向
    let steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (p.jitter > 0) {
      p.jitter -= dt; p.jitterT -= dt;
      if (p.jitterT <= 0) { p.jitterT = 0.08; p.jitterDir = this.rtRng() < 0.5 ? -1 : 1; }
      steer += p.jitterDir * 0.7;
    }
    p.steer = steer;
    const latMax = (T.latBase + T.latGain * Math.min(1, p.v / T.maxSpeed)) * Math.min(1, p.v / 3);
    const target = Math.max(-1.3, Math.min(1.3, steer)) * latMax;
    p.vx += (target - p.vx) * Math.min(1, T.latResp * dt);
    // 颱風側風（規格 5.6）
    if (this.weather === 'typhoon') {
      const g = this.gust;
      g.next -= dt;
      if (g.next <= 0.6 && g.next + dt > 0.6) { g.dir = this.rtRng() < 0.5 ? -1 : 1; this.fx.push({ type: 'gustWarn', dir: g.dir }); }
      if (g.next <= 0) { g.t = 1.5; g.next = this.rtRng.range(4, 7) + 1.5; this.fx.push({ type: 'gust', dir: g.dir }); }
      if (g.t > 0) { g.t -= dt; p.wind = g.dir * 2.0; } else p.wind *= Math.max(0, 1 - 4 * dt);
    }
    p.x += (p.vx + p.wind) * dt;
    p.s += p.v * dt;
    p.ang = p.v > 0.5 ? Math.atan2(p.vx + p.wind, p.v) : 0;
    // 路緣
    const b = this.route.bounds(p.s);
    const hw = T.bikeWid / 2;
    if (p.x < b.left + hw || p.x > b.right - hw) {
      const side = p.x < b.left + hw ? -1 : 1;
      p.x = side < 0 ? b.left + hw + 0.1 : b.right - hw - 0.1;
      p.vx = 0;
      if (p.scrapeLock <= 0) { p.v *= 0.9; this.fx.push({ type: 'scrape', side }); }
      p.scrapeLock = 0.5;
    }
  }

  _freeX(s, x0) {
    const b = this.route.bounds(s);
    let best = x0, bestD = 1e9;
    for (let x = b.left + 0.6; x <= b.right - 0.6; x += 0.25) {
      let ok = true;
      for (const e of this.ents) {
        if (e.ghost || e.dead || ROADFX.has(e.kind)) continue;
        if (Math.abs(e.s - s) > e.len / 2 + 5) continue;
        if (Math.abs(e.x - x) < e.wid / 2 + 0.7) { ok = false; break; }
      }
      if (ok && Math.abs(x - x0) < bestD) { bestD = Math.abs(x - x0); best = x; }
    }
    return best;
  }

  // ---------- 三寶事件（規格 5.4） ----------
  _updateEvents(dt) {
    const p = this.player;
    for (const ev of this.events) {
      if (ev.state === 'done') continue;
      if (ev.state === 'wait') {
        if (p.s >= ev.s - ev.spawnAt) this._spawnEvent(ev);
        else continue;
      }
      ev.t += dt;
      this._runEvent(ev, dt);
    }
  }

  _laneNear(x, s, dir = 1, cls = null) {
    const prof = this.route.profileAt(s);
    let best = null;
    for (const l of prof.lanes) {
      if (l.dir !== dir || (cls && l.cls !== cls)) continue;
      if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
    }
    return best ? best.x : x;
  }

  _spawnEvent(ev) {
    const p = this.player, s = ev.s;
    const b = this.route.bounds(s);
    const prof = this.route.profileAt(s);
    ev.state = 'armed';
    const A = (kind, ss, x, o) => { const e = this._add(kind, ss, x, { ev, ...o }); ev.actors.push(e); return e; };
    switch (ev.type) {
      case 'cutin': {
        const pl = this._laneNear(p.x, s, 1, 'car');
        const lanes = prof.lanes.filter((l) => l.dir === 1 && l.cls === 'car' && Math.abs(l.x - pl) > 1);
        const lx = lanes.length ? this.rng.pick(lanes).x : (pl + (pl > 0 ? -3.2 : 3.2));
        const kind = this.rng.pick(['car', 'taxi', 'car', 'pickup']);
        const vd = this.rng.range(9, 12);
        A(kind, s, lx, { v: vd, vd, tx: lx, moving: true });
        break;
      }
      case 'alley': {
        const side = ev.side;
        const kind = this.rng.chance(0.8) ? 'scooter' : 'car';
        const x = side > 0 ? b.right + 7 : b.left - 7;
        A(kind, s + (side > 0 ? -2.2 : 2.2), x, { ang: side > 0 ? -Math.PI / 2 : Math.PI / 2, v: 0, vd: 0, tx: x, sideways: true });
        break;
      }
      case 'door': {
        ev.actors.push(ev.car);
        break;
      }
      case 'taxi': {
        const lx = this._laneNear(b.right - 2, s, 1, 'car');
        const vd = this.rng.range(10, 12);
        A('taxi', s, lx, { v: vd, vd, tx: lx, moving: true });
        A('ped', s + 30, b.right + 1.4, { stat: true, ghost: true, waver: true });
        break;
      }
      case 'bus': {
        const lx = b.right - 1.3;
        A('bus', s, lx, { v: 0, vd: 0, tx: lx, stat: false, moving: true, atStop: true });
        A('ped', s + 2, b.right + 1.6, { stat: true, ghost: true, deco: true });
        A('ped', s - 1.5, b.right + 2.1, { stat: true, ghost: true, deco: true });
        break;
      }
      case 'ped': {
        const side = ev.side;
        const edge = side > 0 ? b.right : b.left;
        const x = edge + (prof.carPark ? -side * 0.9 : side * 0.4);
        A('ped', s, x, { v: 0, vd: 0, ang: side > 0 ? -Math.PI / 2 : Math.PI / 2, phone: this.rng.chance(0.4), crossDir: -side, stat: false });
        break;
      }
      case 'wrongway': {
        const lx = this._laneNear(p.x, s, 1);
        A('scooter', p.s + 175, lx + 0.3, { dir: -1, v: 10, vd: 10, tx: lx, moving: true, wrong: true });
        break;
      }
      case 'uturn': {
        const kind = this.rng.pick(['car', 'taxi', 'pickup']);
        const x = b.right - 1.2;
        A(kind, s, x, { v: 0, vd: 0, tx: x, ang: 0, moving: true });
        break;
      }
      case 'uncle': {
        const lx = this._laneNear(b.right - 1.5, s, 1, 'moto');
        A('oldscooter', s, lx, { v: 6, vd: 6, tx: lx, moving: true, weave: this.rng.range(0, 6) });
        break;
      }
      case 'double': {
        const lx = prof.carPark ? prof.carPark[1] - 1.9 : this._laneNear(b.right - 2.5, s, 1, 'car');
        A(this.rng.pick(['car', 'taxi', 'pickup']), s, lx, { stat: true, v: 0 });
        ev.actors[0].lights.hazard = 1;
        break;
      }
      case 'garbage': {
        const lx = this._laneNear(b.right - 1.5, s, 1, 'car');
        const g = A('garbage', s, lx, { v: 4, vd: 4, tx: lx, moving: true });
        g.music = true;
        const n = 2 + Math.floor(this.rng() * 3);
        for (let i = 0; i < n; i++) {
          A('ped', s - 6 - i * 3, lx + this.rng.range(-2.5, 2.5), { v: 0, bag: true, chase: g, wphase: this.rng.range(0, 6) });
        }
        break;
      }
      case 'dogs': {
        const side = ev.side, edge = side > 0 ? b.right + 1.0 : b.left - 1.0;
        const n = 1 + Math.floor(this.rng() * 3);
        for (let i = 0; i < n; i++) A('dog', s + i * 1.6, edge + side * i * 0.6, { v: 0, ang: side > 0 ? -Math.PI / 2 : Math.PI / 2, delay: i * 0.3, crossDir: -side });
        break;
      }
      case 'procession': {
        // 佔路面 2/3，留左或右一側（規格 5.4）
        const w = b.right - b.left;
        const blockFrom = ev.side > 0 ? b.left : b.left + w / 3;
        const blockTo = blockFrom + w * 2 / 3;
        const units = [];
        for (let d = 0; d < 40; d += 3.2) {
          const r = d === 16 ? 'palanquin' : d % 9.6 < 3.2 ? 'drum' : 'flag';
          const len = r === 'palanquin' ? 3.0 : r === 'drum' ? 2.6 : 1.0;
          const cx = (blockFrom + blockTo) / 2;
          if (r === 'flag') {
            for (let k = 0; k < 3; k++) units.push(A('proc', s + d, blockFrom + (k + 0.5) * (blockTo - blockFrom) / 3, { unit: 'flag', len: 1.0, wid: 1.0, v: 1.5, vd: 1.5, moving: true, tx: null }));
          } else {
            units.push(A('proc', s + d, cx, { unit: r, len, wid: Math.min(blockTo - blockFrom, r === 'palanquin' ? 2.6 : 2.2), v: 1.5, vd: 1.5, moving: true, tx: null }));
          }
        }
        ev.smoke = { s: s + 20, x0: blockFrom, x1: blockTo };
        break;
      }
      case 'truck': {
        const lx = this._laneNear(b.right - 3, s, 1, 'car');
        A('truck', s, lx, { v: 10, vd: 10, tx: lx, moving: true, push: true });
        break;
      }
      case 'walker': {
        // 人行道被機車、攤販、變電箱擋住，行人只好走車道（規格 5.4）
        const n = 1 + Math.floor(this.rng() * 3);
        for (let i = 0; i < n; i++) A('ped', s + i * 1.4, b.right - 0.55 - this.rng() * 0.3, { v: 1.1, vd: 1.1, dir: 1, moving: true, wander: true, wphase: this.rng.range(0, 6), walker: true });
        break;
      }
      case 'rightturn': case 'bigturn': {
        const big = ev.type === 'bigturn';
        const kind = big ? this.rng.pick(['bus', 'truck']) : this.rng.pick(['car', 'taxi', 'pickup', 'car']);
        const lanes = prof.lanes.filter((l) => l.dir === 1 && l.cls === 'car').sort((q, w) => w.x - q.x);
        const lx = lanes.length ? lanes[0].x : b.right - 2.5;
        A(kind, s, lx, { v: big ? 8 : 10, vd: big ? 8 : 10, tx: lx, moving: true });
        break;
      }
      case 'delivery': {
        const lx = this._laneNear(p.x, s, 1);
        A('scooter', s, lx, { v: 9, vd: 9, tx: lx, moving: true, cargo: 'delivery', phoneRider: true });
        break;
      }
      case 'pullout': {
        ev.actors.push(ev.car);
        break;
      }
      case 'drunk': {
        const lx = this._laneNear((b.left + b.right) / 2, s, 1, 'car');
        A(this.rng.pick(['car', 'car', 'pickup', 'taxi']), s, lx, { v: 11, vd: 11, tx: lx, moving: true, drunk: this.rng.range(0, 6) });
        break;
      }
      case 'drugged': {
        const lx = this._laneNear((b.left + b.right) / 2, s, 1, 'car');
        A(this.rng.pick(['car', 'car', 'pickup']), s, lx, { v: 12, vd: 12, tx: lx, moving: true, drugged: true, nextAct: 1.5 });
        break;
      }
      case 'campaign': {
        // 宣傳車跨在兩車道中間，後面跟支持者機車
        const lx = Math.max(b.left + 1.3, Math.min(b.right - 1.3, (b.left + b.right) / 2 + this.rng.range(-0.8, 0.8)));
        A('campaign', s, lx, { v: 4, vd: 4, tx: lx, moving: true, music: false, campaign: true });
        const n = 2 + Math.floor(this.rng() * 3);
        for (let i = 0; i < n; i++) {
          const x = lx + this.rng.range(-1.8, 1.8);
          A('scooter', s - 5 - i * 3.2, Math.max(b.left + 0.5, Math.min(b.right - 0.5, x)), { v: 4, vd: 4, tx: x, moving: true, follow: true, flag: true });
        }
        break;
      }
    }
  }

  _runEvent(ev, dt) {
    const p = this.player;
    const a = ev.actors[0];
    if (!a || a.dead) { ev.state = 'done'; return; }
    const gap = a.s - p.s;
    switch (ev.type) {
      case 'cutin': {
        if (ev.state === 'armed' && gap < 32 + 0.5 * p.v * 0.5 && gap > 4) { ev.state = 'warn'; ev.t = 0; this.fx.push({ type: 'tell', ev: 'cutin', id: a.id }); }
        if (ev.state === 'warn') {
          a.wobble = Math.sin(ev.t * 18) * 0.3 * (1 - ev.t / 0.5);
          if (ev.t >= 0.5) {
            ev.state = 'go'; ev.t = 0;
            a.wobble = 0;
            const tl = this._laneNear(p.x, a.s, 1, 'car');
            a.tx = Math.abs(tl - a.x) > 0.8 ? tl : this._laneNear(p.x, a.s, 1);
            a.latSpeed = Math.abs(a.tx - a.x) / 1.2;
          }
        }
        if (ev.state === 'go' && ev.t > 2) { ev.state = 'done'; a.latSpeed = null; }
        break;
      }
      case 'alley': {
        if (ev.state === 'armed' && gap < 48 + p.v * 1.0) { ev.state = 'warn'; ev.t = 0; a.lights.head = 1; this.fx.push({ type: 'tell', ev: 'alley', id: a.id }); }
        if (ev.state === 'warn' && gap < 48) { ev.state = 'go'; ev.t = 0; a.v = 0; }
        if (ev.state === 'go') {
          const dirx = a.ang < 0 ? -1 : 1;
          a.x += dirx * 9 * dt; a.tx = a.x;
          const b = this.route.bounds(a.s);
          if ((dirx < 0 && a.x < b.left - 8) || (dirx > 0 && a.x > b.right + 8)) { a.dead = true; ev.state = 'done'; }
        }
        break;
      }
      case 'door': {
        if (ev.state === 'armed' && gap < 22 + p.v * 1.0) { ev.state = 'warn'; ev.t = 0; a.lights.brake = 1; a.driver = 1; this.fx.push({ type: 'tell', ev: 'door', id: a.id }); }
        if (ev.state === 'warn' && gap < 22) { ev.state = 'go'; ev.t = 0; this.fx.push({ type: 'door', id: a.id }); }
        if (ev.state === 'go') {
          a.lights.door = ev.t < 2.8 ? Math.min(1, ev.t / 0.35) : Math.max(0, 1 - (ev.t - 2.8) / 0.4);
          if (ev.t > 3.3) { ev.state = 'done'; a.lights.brake = 0; a.lights.door = 0; }
        }
        break;
      }
      case 'taxi': {
        if (ev.state === 'armed' && gap < 30 && gap > 3) { ev.state = 'go'; ev.t = 0; a.lights.hazard = 1; a.vd = 0; a.hardBrake = 9; this.fx.push({ type: 'tell', ev: 'taxi', id: a.id }); }
        if (ev.state === 'go' && a.v <= 0.05) { ev.state = 'stop'; ev.t = 0; }
        if (ev.state === 'stop' && ev.t > 3) { ev.state = 'done'; a.lights.hazard = 0; a.vd = 10; a.hardBrake = 0; }
        break;
      }
      case 'bus': {
        if (ev.state === 'armed' && gap < 45 + p.v * 1.0) { ev.state = 'warn'; ev.t = 0; a.lights.blinkL = 1; this.fx.push({ type: 'tell', ev: 'bus', id: a.id }); }
        if (ev.state === 'warn' && gap < 45) {
          ev.state = 'go'; ev.t = 0;
          a.vd = 9; a.accel = 1.5;
          a.tx = this._laneNear(a.x - 3, a.s, 1, 'car');
          a.latSpeed = Math.abs(a.tx - a.x) / 2.5;
        }
        if (ev.state === 'go' && ev.t > 3) { ev.state = 'done'; a.lights.blinkL = 0; a.normal = true; a.latSpeed = null; }
        break;
      }
      case 'ped': {
        if (ev.state === 'armed' && gap < 34) { ev.state = 'go'; ev.t = 0; this.fx.push({ type: 'tell', ev: 'ped', id: a.id }); }
        if (ev.state === 'go') {
          const sp = a.phone ? 1.0 : 1.4;
          const b = this.route.bounds(a.s);
          const mid = (b.left + b.right) / 2;
          if (a.phone && !a.paused && Math.abs(a.x - mid) < 0.3) { a.paused = 1.0; }
          if (a.paused > 0) { a.paused -= dt; a.walking = false; if (a.paused <= 0) a.paused = -1; }
          else { a.x += a.crossDir * sp * dt; a.walking = true; }
          a.tx = a.x;
          if ((a.crossDir < 0 && a.x < b.left - 1.5) || (a.crossDir > 0 && a.x > b.right + 1.5)) { a.dead = true; ev.state = 'done'; }
        }
        break;
      }
      case 'wrongway': {
        a.wobble = Math.sin(this.clock * 2.2 + ev.seed * 6) * 0.25;
        if (gap < -40) ev.state = 'done';
        break;
      }
      case 'uturn': {
        if (ev.state === 'armed' && gap < 55 + p.v * 1.0) { ev.state = 'warn'; ev.t = 0; a.vd = 3; a.v = 2; this.fx.push({ type: 'tell', ev: 'uturn', id: a.id }); }
        if (ev.state === 'warn') {
          a.ang = -0.26 * Math.min(1, ev.t);
          if (gap < 55) { ev.state = 'go'; ev.t = 0; }
        }
        if (ev.state === 'go') {
          // 往左橫越整條路，3 秒
          const b = this.route.bounds(a.s);
          const k = Math.min(1, ev.t / 3);
          a.ang = -0.26 - (Math.PI / 2 - 0.26) * Math.min(1, ev.t / 1.2) - (k > 0.75 ? (k - 0.75) * 4 * Math.PI / 2 : 0);
          a.v = 2.5 * Math.cos(a.ang);
          a.vd = a.v;
          a.x -= Math.max(0, -Math.sin(a.ang)) * 3.6 * dt;
          a.tx = a.x;
          if (a.x < b.left - 1 || ev.t > 4.5) {
            ev.state = 'done';
            if (this.route.profileAt(a.s).twoWay) { a.dir = -1; a.ang = Math.PI; a.v = 8; a.vd = 10; a.normal = true; a.tx = this._laneNear(a.x, a.s, -1); }
            else a.dead = true;
          }
        }
        break;
      }
      case 'uncle': {
        a.wobble = Math.sin(this.clock * 2 * Math.PI / 3 + a.weave) * 0.8;
        if (gap < -60) ev.state = 'done';
        break;
      }
      case 'garbage': {
        for (const e of ev.actors) {
          if (!e.chase) continue;
          const want = e.chase.s - 3 + Math.sin(this.clock * 0.7 + e.wphase) * 4;
          e.v = Math.max(-1, Math.min(4.6, (want - e.s) * 1.2));
          e.x += Math.sin(this.clock * 0.9 + e.wphase * 2) * 0.6 * dt;
          const b = this.route.bounds(e.s);
          e.x = Math.max(b.left + 0.4, Math.min(b.right - 0.4, e.x));
          e.walking = true;
          e.s += e.v * dt;
        }
        if (gap < -80) ev.state = 'done';
        break;
      }
      case 'dogs': {
        if (ev.state === 'armed' && gap < 30 + p.v * 0.8) { ev.state = 'warn'; ev.t = 0; this.fx.push({ type: 'bark' }); }
        if (ev.state === 'warn' && gap < 30) { ev.state = 'go'; ev.t = 0; }
        if (ev.state === 'go') {
          let alive = 0;
          for (const d of ev.actors) {
            if (d.dead) continue;
            alive++;
            if (ev.t < d.delay) continue;
            d.x += d.crossDir * 3 * dt; d.walking = true; d.tx = d.x;
            const b = this.route.bounds(d.s);
            if ((d.crossDir < 0 && d.x < b.left - 2) || (d.crossDir > 0 && d.x > b.right + 2)) d.dead = true;
          }
          if (!alive) ev.state = 'done';
        }
        break;
      }
      case 'procession': {
        if (ev.smoke) ev.smoke.s += 1.5 * dt;
        if (gap < -60) ev.state = 'done';
        break;
      }
      case 'truck': case 'double':
        if (gap < -80) ev.state = 'done';
        break;
      case 'walker': {
        if (gap < -60) ev.state = 'done';
        break;
      }
      case 'rightturn': case 'bigturn': {
        // 右轉車切過機車道／大車內輪差（規格 5.4）
        const it = ev.it, big = ev.type === 'bigturn';
        const b = this.route.bounds(a.s);
        const toLine = it.s - it.half - a.s;
        if (ev.state === 'armed' && toLine < (big ? 34 : 26) && gap > -3) {
          ev.state = 'warn'; ev.t = 0;
          a.lights.blinkR = big || this.rng() < 0.5 ? 1 : 0;
          a.vd = big ? 5 : 6;
          if (big) { a.tx = a.x - 0.9; a.latSpeed = 0.8; }
          this.fx.push({ type: 'tell', ev: ev.type, id: a.id });
        }
        if (ev.state === 'warn' && toLine < (big ? 12 : 9)) {
          ev.state = 'go'; ev.t = 0;
          a.tx = b.right - (big ? 0.9 : 0.7); a.latSpeed = big ? 1.6 : 2.6; a.vd = big ? 4 : 5;
        }
        if (ev.state === 'go' && a.s >= it.s - it.half + (big ? 3 : 1.5)) { ev.state = 'turn'; ev.t = 0; a.sideways = true; a.latSpeed = null; }
        if (ev.state === 'turn') {
          const k = Math.min(1, ev.t / (big ? 2.2 : 1.3));
          a.ang = k * Math.PI / 2;
          a.x += (big ? 2.5 : 4) * k * dt; a.tx = a.x;
          a.s += (big ? 3 : 4) * (1 - k) * dt;
          if (a.x > b.right + 9) { a.dead = true; ev.state = 'done'; }
        }
        if (gap < -60 && ev.state !== 'turn') ev.state = 'done';
        break;
      }
      case 'delivery': {
        // 外送員低頭看手機：慢慢往旁邊飄、急煞（規格 5.4）
        if (ev.state === 'armed' && gap < 35 && gap > 3) {
          ev.state = 'go'; ev.t = 0;
          const b = this.route.bounds(a.s);
          const dir = a.x - p.x >= 0 ? -1 : 1; // 往玩家這邊飄
          a.tx = Math.max(b.left + 0.5, Math.min(b.right - 0.5, a.x + dir * 1.5));
          a.latSpeed = 1.5; a.vd = 3; a.hardBrake = 6;
          this.fx.push({ type: 'tell', ev: 'delivery', id: a.id });
        }
        if (ev.state === 'go' && ev.t > 2.2) { ev.state = 'done'; a.vd = 9; a.hardBrake = 0; a.latSpeed = null; }
        break;
      }
      case 'pullout': {
        if (ev.state === 'armed' && gap < 26 + p.v * 0.6) { ev.state = 'warn'; ev.t = 0; a.smoke = 1; a.lights.brake = 1; this.fx.push({ type: 'tell', ev: 'pullout', id: a.id }); }
        if (ev.state === 'warn' && gap < 26) {
          ev.state = 'go'; ev.t = 0;
          a.stat = false; a.parked = false; a.moving = true; a.lights.brake = 0;
          a.v = 1; a.vd = 7; a.accel = 3;
          a.tx = this._laneNear(a.x - 2, a.s, 1, 'car'); a.latSpeed = 1.6;
        }
        if (ev.state === 'go' && ev.t > 3) { ev.state = 'done'; a.normal = true; a.latSpeed = null; }
        break;
      }
      case 'drunk': {
        // 酒駕：大幅蛇行、時快時慢
        const b = this.route.bounds(a.s);
        const mid = (b.left + b.right) / 2, amp = Math.min(2.4, (b.right - b.left) / 2 - 1.1);
        a.tx = mid + Math.sin(this.clock * 2 * Math.PI / 2.4 + a.drunk) * amp;
        a.latSpeed = 2.8;
        a.vd = 10 + Math.sin(this.clock * 0.9 + a.drunk) * 3;
        if (gap < -80) ev.state = 'done';
        break;
      }
      case 'drugged': {
        // 毒駕：每 1.5～3 秒做一件怪事：急煞、猛衝、突然橫移
        a.nextAct -= dt;
        a.lights.head = (this.clock * 5) % 1 < 0.5 ? 1 : 0.2;
        if (a.nextAct <= 0) {
          a.nextAct = this.rng.range(1.5, 3);
          const r = this.rng();
          const b = this.route.bounds(a.s);
          if (r < 0.35) { a.vd = 3; a.hardBrake = 9; a.lights.brake = 1; }
          else if (r < 0.6) { a.vd = 16; a.hardBrake = 0; a.accel = 6; }
          else { a.tx = Math.max(b.left + 1.1, Math.min(b.right - 1.1, a.x + (this.rng() < 0.5 ? -2.5 : 2.5))); a.latSpeed = 3.5; a.vd = 11; }
        }
        if (gap < -80) ev.state = 'done';
        break;
      }
      case 'campaign': {
        for (const e of ev.actors) {
          if (!e.follow) continue;
          e.vd = Math.max(0, Math.min(5, ev.actors[0].v + (ev.actors[0].s - 4 - e.s) * 0.3));
        }
        if (gap < -80) ev.state = 'done';
        break;
      }
    }
  }

  // ---------- 車流（規格 5.2、5.3） ----------
  _updateTraffic(dt, countdown) {
    const p = this.player;
    const lo = p.s - 80, hi = p.s + 420;
    const route = this.route;
    // 回收落後的
    if (this._gc === undefined) this._gc = 0;
    this._gc += dt;
    if (this._gc > 0.5) {
      this._gc = 0;
      this.ents = this.ents.filter((e) => !e.dead && e.s > lo - 20);
    }
    this._spawnCross(dt);
    this._ai = (this._ai || 0) + dt;
    const think = this._ai >= 0.05;
    if (think) this._ai = 0;
    const act = [];
    for (const e of this.ents) if (e.s >= lo && e.s <= hi && !e.dead) act.push(e);
    this.active = act;
    for (const e of act) {
      if (e.stat || !e.moving) continue;
      if (e.wander) {
        // 夜市逛街的人
        e.s += e.dir * e.v * dt;
        e.x += Math.sin(this.clock * 0.5 + e.wphase) * (e.walker ? 0.15 : 0.35) * dt;
        const b = route.bounds(e.s);
        if (e.walker) e.x = Math.max(b.right - 1.3, e.x);
        e.x = Math.max(b.left + 0.3, Math.min(b.right - 0.3, e.x));
        e.ang = e.dir > 0 ? 0 : Math.PI;
        e.walking = true;
        continue;
      }
      if (e.kind === 'proc') { e.s += e.v * dt; continue; }
      if (e.cross) continue; // 橫向車流：等速通過（在 _spawnCross 移動）
      if (think && !e.ev) this._think(e);
      if (think && e.ev && e.moving && e.kind !== 'ped' && e.kind !== 'dog') this._think(e);
      // 速度
      let tv = e.vd;
      if (e.limitV != null) tv = Math.min(tv, e.limitV);
      const acc = e.accel ?? 2.6;
      const dec = e.hardBrake || 8;
      if (tv > e.v) e.v = Math.min(tv, e.v + acc * dt);
      else e.v = Math.max(tv, e.v - dec * dt);
      if (e.v < 0) e.v = 0;
      e.lights.brake = (tv < e.v - 0.3 || (e.v < 0.5 && !e.sideways)) && !e.parked ? 1 : e.lights.brake && e.driver ? 1 : 0;
      if (!e.sideways) e.s += e.dir * e.v * dt;
      // 橫向
      if (e.tx != null && !e.sideways) {
        const ls = e.latSpeed ?? (e.yield ? 1.2 : 1.6);
        const d = e.tx - e.x;
        e.x += Math.sign(d) * Math.min(Math.abs(d), ls * dt);
        if (!e.ev || e.ev.type !== 'uturn') {
          const steerA = Math.max(-0.35, Math.min(0.35, Math.sign(d) * Math.min(Math.abs(d), ls) / Math.max(3, e.v)));
          e.ang = (e.dir > 0 ? 0 : Math.PI) + e.dir * steerA;
        }
      }
      if (e.wobble) e.xDraw = e.x + e.wobble; else e.xDraw = e.x;
      if (e.yield) { e.yield -= dt; if (e.yield <= 0) e.yield = 0; }
    }
  }

  _think(e) {
    const p = this.player;
    const route = this.route;
    // 跨路段：車道不見了就換到新路段最近的車道；對向車進到單向路段就轉進路口消失
    const prof = route.profileAt(e.s);
    if (!e.ghost && !e.ev) {
      if (e.dir < 0 && !prof.twoWay) { e.dead = true; return; }
      const hasLane = prof.lanes.some((l) => l.dir === e.dir && Math.abs(l.x - e.tx) < 0.6);
      if (!hasLane && !e.yield && !e.avoid) e.tx = this._laneNear(e.tx, e.s, e.dir, KINDS[e.kind]?.cls === 'moto' ? 'moto' : 'car');
    }
    if (e.ghost) {
      if (e.oppSide) {
        const pr = route.profileAt(e.s);
        if (!pr.oppLanes) { e.dead = true; return; }
      }
      e.limitV = null;
      return;
    }
    // 找前車（含玩家、行人、靜止物）
    const look = 45;
    let lead = null, leadGap = 1e9;
    const hwE = halfW(e);
    for (const o of this.active || this.ents) {
      if (o === e || o.dead || o.ghost || ROADFX.has(o.kind)) continue;
      if (o.moving && !o.sideways && !o.cross && o.kind !== "ped" && o.kind !== "dog" && o.kind !== "proc" && (o.dir || 1) !== e.dir) continue; // 對向車不當前車（窄巷會車）
      const ds = (o.s - e.s) * e.dir;
      if (ds <= 0 || ds > look) continue;
      if (Math.abs(o.x - e.x) > hwE + halfW(o) + 0.25) continue;
      const g = ds - (e.len + halfL(o) * 2) / 2;
      if (g < leadGap) { leadGap = g; lead = o; }
    }
    // 玩家
    if (!p.crash || true) {
      const ds = (p.s - e.s) * e.dir;
      if (e.dir > 0 && ds > 0 && ds < look && Math.abs(p.x - e.x) < hwE + T.bikeWid / 2 + 0.2) {
        const g = ds - (e.len + T.bikeLen) / 2;
        if (g < leadGap) { leadGap = g; lead = { v: p.v, dir: 1, s: p.s, x: p.x, player: true, stat: false }; }
      }
    }
    let lim = 1e9;
    if (lead) {
      const lv = Math.max(0, (lead.v || 0) * (lead.dir === e.dir ? 1 : 0) * (lead.sideways ? 0 : 1));
      const safe = 2.5 + 0.8 * lv;
      lim = Math.max(0, lv + (leadGap - safe) * 0.7);
      if (leadGap < 1.2) lim = 0;
      // 卡在靜止物後面：繞過去（一般車流）
      if (e.normal && lead.stat && !lead.parked && !lead.player && leadGap < 14 && e.v < 2) {
        e.stuck = (e.stuck || 0) + 0.05;
        if (e.stuck > 1.0) { this._avoid(e, lead); e.stuckTotal = (e.stuckTotal || 0) + e.stuck; e.stuck = 0; }
        if ((e.stuckTotal || 0) > 3 && Math.abs(e.s - p.s) > 35) e.dead = true;
      } else e.stuck = 0;
    }
    // 前方 60 m 自己的車道被施工封住：提早換道（規格 5.5）
    if (e.normal && this._closures && e.dir > 0 && !e.avoid) {
      for (const c of this._closures) {
        const d = c.s0 - e.s;
        if (d > 0 && d < 60 && e.tx > c.x0 - 0.8 && e.tx < c.x1 + 0.8) {
          const prof = route.profileAt(c.s0);
          const lanes = prof.lanes.filter((l) => l.dir === 1 && (l.x < c.x0 - 1.0 || l.x > c.x1 + 1.0));
          if (lanes.length) { e.tx = lanes.reduce((q, w) => (Math.abs(w.x - e.x) < Math.abs(q.x - e.x) ? w : q)).x; e.avoid = 1; }
          break;
        }
      }
    }
    // 紅燈停車
    e.queued = false;
    if ((!e.ev || e.normal) && KINDS[e.kind]?.cls !== 'moto') {
      for (const it of route.inters) {
        if (!it.light) continue;
        const line = it.s - e.dir * (it.half + 2.5);
        const d = (line - e.s) * e.dir;
        if (d < 0 || d > 45) continue;
        const st = route.lightState(it, this.clock);
        if (st === 'red' || (st === 'yellow' && d > e.v * 1.2)) {
          lim = Math.min(lim, Math.max(0, (d - 1) * 0.9));
          if (d < 12) e.queued = true;
        }
        break;
      }
    }
    e.limitV = lim < 1e8 ? lim : null;
  }

  _avoid(e, lead) {
    const b = this.route.bounds(e.s);
    const prof = this.route.profileAt(e.s);
    const hw = halfW(e);
    const cands = prof.lanes.filter((l) => l.dir === e.dir && Math.abs(l.x - e.x) > 0.8).map((l) => l.x);
    cands.push(lead.x - (halfW(lead) + hw + 0.4), lead.x + (halfW(lead) + hw + 0.4));
    let best = null;
    for (const x of cands) {
      if (x - hw < b.left + 0.1 || x + hw > b.right - 0.1) continue;
      let ok = true;
      for (const o of this.active) {
        if (o === e || o.ghost || o.dead || ROADFX.has(o.kind)) continue;
        if (Math.abs(o.s - e.s) > 14) continue;
        if (Math.abs(o.x - x) < halfW(o) + hw + 0.2) { ok = false; break; }
      }
      if (ok && (best == null || Math.abs(x - e.x) < Math.abs(best - e.x))) best = x;
    }
    if (best != null) { e.tx = best; e.avoid = 3; }
  }

  // 紅燈時的橫向車流（規格 5.3）
  _spawnCross(dt) {
    if (!this.crossTraffic) return;
    const p = this.player;
    for (const it of this.route.inters) {
      if (!it.light) continue;
      if (it.s < p.s - 30 || it.s > p.s + 230) continue;
      const st = this.route.lightState(it, this.clock);
      let nx = this._crossNext.get(it.id);
      if (nx == null) { nx = this.clock + this.rtRng.range(0, 1.2); this._crossNext.set(it.id, nx); }
      if (st !== 'red') { if (nx < this.clock) this._crossNext.set(it.id, this.clock + this.rtRng.range(0.2, 1.0)); continue; }
      if (this.clock < nx) continue;
      this._crossNext.set(it.id, this.clock + this.rtRng.range(1.2, 2.5));
      const prof = PROFILES[it.type] || PROFILES.street;
      const b = this.route.bounds(it.s);
      const fromLeft = this.rtRng() < 0.5;
      const kind = this.rtRng.weighted(prof.mix);
      const k = KINDS[kind];
      const v = this.rtRng.range(10, 14);
      const lane = fromLeft ? it.s + 2.5 : it.s - 2.5;
      const x = fromLeft ? b.left - 14 : b.right + 14;
      const e = this._add(kind, lane, x, { ang: fromLeft ? Math.PI / 2 : -Math.PI / 2, v, vd: v, sideways: true, cross: fromLeft ? 1 : -1, moving: true });
      e.len = k.len; e.wid = k.wid;
      e.crossEnd = fromLeft ? b.right + 16 : b.left - 16;
    }
    for (const e of this.active || []) {
      if (!e.cross) continue;
      // 前方有玩家擋著就減速（不會故意撞人，但來不及煞）
      e.x += e.cross * e.v * dt;
      if ((e.cross > 0 && e.x > e.crossEnd) || (e.cross < 0 && e.x < e.crossEnd)) e.dead = true;
    }
  }

  // ---------- 碰撞、擦身而過（規格 3.3、4.6） ----------
  _collide(dt) {
    const p = this.player;
    if (p.crash) return;
    const pr = { s: p.s, x: p.x, len: T.bikeLen, wid: T.bikeWid, ang: 0 }; // 碰撞框不隨車頭轉（街機手感）
    for (const e of this.active) {
      if (e.dead) continue;
      const ds = e.s - p.s;
      // 擦身而過（玩家從它旁邊超過，或交會）
      if (VEHICLE.has(e.kind) && !e.oppSide) {
        const sign = ds > 0 ? -1 : 1;
        if (e.ps === -1 && sign === 1 && !e.touched && !e.nearDone && p.v >= T.nearMinSpeed && p.invuln <= 0) {
          const gap = Math.abs(p.x - (e.xDraw ?? e.x)) - (T.bikeWid / 2 + halfW(e));
          if (gap >= 0 && gap < T.nearGap) {
            e.nearDone = true;
            const close = gap < T.closeGap;
            if (close) p.close++; else p.near++;
            this._addMeter(close ? T.closeGain : T.nearGain);
            this.fx.push({ type: close ? 'close' : 'near', id: e.id, gap });
          }
        }
        e.ps = sign;
      }
      if (e.ghost || e.knocked) continue;
      if (Math.abs(ds) > halfL(e) + 2.5) continue;
      if (ROADFX.has(e.kind)) { this._roadFx(e); continue; }
      const er = { s: e.s, x: e.xDraw ?? e.x, len: e.len, wid: e.wid, ang: e.ang };
      let hit = obb(pr, er);
      // 開門殺：門板
      if (!hit && e.lights.door > 0.05) {
        const side = e.x > 0 ? -1 : 1;
        const dr = { s: e.s + e.dir * 0.8, x: e.x + side * (e.wid / 2 + 0.5 * e.lights.door), len: 0.9, wid: 1.0 * e.lights.door, ang: 0 };
        hit = obb(pr, dr);
        if (hit) hit.door = true;
      }
      if (!hit) continue;
      if (p.invuln > 0) continue;
      if (SMALL.has(e.kind)) {
        e.knocked = true; e.knockV = p.v; e.knockT = 0;
        p.v *= 0.85;
        this.fx.push({ type: 'knock', id: e.id });
        continue;
      }
      const frontal = Math.abs(hit.ns) > 0.7;
      if (CRASHY.has(e.kind) || frontal || hit.door) this._crash(e);
      else this._graze(e, hit);
      if (p.crash) return;
    }
  }

  _roadFx(e) {
    const p = this.player;
    if (e.used) return;
    if (Math.abs(e.s - p.s) > e.len / 2 + 0.6) return;
    if (Math.abs(e.x - p.x) > e.wid / 2 + 0.3) return;
    e.used = true;
    if (e.kind === 'pothole' || e.kind === 'bump') { p.v *= 0.9; p.jitter = 0.4; this.fx.push({ type: 'pothole' }); }
    else if (e.kind === 'puddle') { p.v *= 0.92; this.fx.push({ type: 'splash' }); }
    else if (e.kind === 'manhole' && this.wet) { p.jitter = 0.3; this.fx.push({ type: 'slip' }); }
  }

  _addMeter(x) {
    const p = this.player;
    if (p.boostCharges >= T.boostMax) { p.boostMeter = 1; return; }
    p.boostMeter += x;
    while (p.boostMeter >= 1 && p.boostCharges < T.boostMax) {
      p.boostMeter -= 1; p.boostCharges++;
      this.fx.push({ type: 'charge' });
    }
    if (p.boostCharges >= T.boostMax) p.boostMeter = 1;
  }

  _crash(e) {
    const p = this.player;
    p.crash = { t: 0, by: e.kind };
    p.crashes++;
    p.boostT = 0;
    p.vx = (p.x >= e.x ? 1 : -1) * 2;
    p.v *= 0.55;
    e.touched = true;
    if (e.moving && VEHICLE.has(e.kind)) { e.v *= 0.3; }
    this.fx.push({ type: 'crash', id: e.id, kind: e.kind });
  }

  _graze(e, hit) {
    const p = this.player;
    const side = p.x >= (e.xDraw ?? e.x) ? 1 : -1;
    p.x += side * (hit.depth + 0.06);
    p.vx = side * Math.max(1.5, Math.abs(p.vx) * 0.5);
    p.v *= 0.8;
    p.grazes++;
    e.touched = true;
    p.invuln = Math.max(p.invuln, 0.25);
    this.fx.push({ type: 'graze', id: e.id, side });
  }

  // 給畫面：玩家前方的路口號誌
  lightFor(it) { return this.route.lightState(it, this.clock); }
}

export function halfW(e) {
  const a = e.ang || 0;
  return Math.abs(Math.sin(a)) * e.len / 2 + Math.abs(Math.cos(a)) * e.wid / 2;
}
export function halfL(e) {
  const a = e.ang || 0;
  return Math.abs(Math.cos(a)) * e.len / 2 + Math.abs(Math.sin(a)) * e.wid / 2;
}

// 兩個有方向的矩形（路線座標 s、x）是否重疊；回傳最小穿透軸 (ns, nx) 與深度
function obb(a, b) {
  const axes = [];
  const pushAxes = (r) => {
    const c = Math.cos(r.ang || 0), s = Math.sin(r.ang || 0);
    axes.push([c, s], [-s, c]);
  };
  pushAxes(a); pushAxes(b);
  const dS = b.s - a.s, dX = b.x - a.x;
  let best = 1e9, bn = null;
  for (const [as, ax] of axes) {
    const proj = (r) => {
      const c = Math.cos(r.ang || 0), s = Math.sin(r.ang || 0);
      return Math.abs(as * c + ax * s) * r.len / 2 + Math.abs(-as * s + ax * c) * r.wid / 2;
    };
    const dist = Math.abs(dS * as + dX * ax);
    const ov = proj(a) + proj(b) - dist;
    if (ov <= 0) return null;
    if (ov < best) { best = ov; bn = [as, ax]; }
  }
  return { ns: bn[0], nx: bn[1], depth: best };
}

export { STEP };
