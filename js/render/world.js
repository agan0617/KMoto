// 街景（規格第 6 章）：路面、標線、建築、招牌、電線桿、號誌、夜市、省道、目的地。
// 沿路線分成 40 公尺的區塊，玩家前方 340、後方 60 公尺內才建，同材質合併成一個網格。
import * as THREE from 'three';
import { Bucket, box, quad, cyl, mat, ribbon, wallRibbon, frameAt, prep } from './geo.js';
import { PROFILES, PRE, POST } from '../route.js';
import { makeRng, hashStr } from '../rng.js';
import { TILE_COLORS, FONT, SERIF, shade } from './textures.js';
import { DESTS } from '../levels.js';
import { makeParkedScooterGeo } from './vehicles.js';
import { propGeo, propNames } from './props.js';

export const CH = 40;
// 遠了不畫的細節物件（規格 10.1）
const DETAIL = new Set(['ac_split', 'ac_window', 'water_tank_steel', 'water_tank_blue', 'potted_plant', 'mailbox_pair', 'transformer_box', 'fire_hydrant', 'parking_meter', 'incense_burner', 'temple_lion']);
const DETAIL_DIST = 150;
const AHEAD = 340, BEHIND = 70;

// 時段（規格 6.5）
export const ENV = {
  morning: { sky: 'morning', horizon: '#b4a6aa', fog: [140, 520], hemi: ['#fff0f6', '#7a6a5a', 1.25], sun: ['#ffe2c4', 2.9], sunDir: [0.73, 0.5, 0.46], env: 0.7, night: 0, exposure: 1.0, bloom: [0.25, 0.5, 0.95] },
  noon: { sky: 'noon', horizon: '#b4c2da', fog: [160, 560], hemi: ['#e6f2ff', '#6e6656', 1.2], sun: ['#fff6e6', 2.8], sunDir: [-0.56, 0.74, 0.37], env: 0.65, night: 0, exposure: 1.0, bloom: [0.2, 0.5, 0.97] },
  dusk: { sky: 'dusk', horizon: '#b8aab0', fog: [130, 480], hemi: ['#e8dcff', '#5a4a40', 1.05], sun: ['#ffc890', 2.4], sunDir: [0.72, 0.36, 0.3], env: 0.6, night: 0.45, exposure: 1.0, bloom: [0.45, 0.5, 0.9] },
  night: { sky: 'night', horizon: '#2c3550', fog: [90, 380], hemi: ['#8a90b8', '#4a3a2a', 1.15], sun: ['#c8d0ff', 0.7], sunDir: [-0.46, 0.68, 0.57], env: 0.55, night: 1, exposure: 1.2, bloom: [0.85, 0.55, 0.82] },
  rain: { sky: 'rain', horizon: '#8d949f', fog: [70, 300], hemi: ['#d8e0ec', '#4a4c50', 1.35], sun: ['#e8eef8', 0.9], sunDir: [0.3, 0.8, -0.5], env: 0.8, night: 0.25, exposure: 0.95, bloom: [0.4, 0.5, 0.9] },
};

export class World {
  constructor(scene, sim, T, envKey) {
    this.scene = scene;
    this.sim = sim;
    this.route = sim.route;
    this.level = sim.level;
    this.T = T;
    this.env = ENV[envKey];
    this.night = this.env.night;
    this.chunks = new Map();
    this.root = new THREE.Group();
    scene.add(this.root);
    this.dynamic = []; // 每幀要更新的（號誌）
    this.mats = this._materials();
    this._planLots();
    this._planPoles();
  }

  dispose() {
    for (const g of this.chunks.values()) this._disposeChunk(g);
    this.chunks.clear();
    this.scene.remove(this.root);
    for (const m of Object.values(this.mats)) m.dispose();
  }

  // ---------- 材質 ----------
  _materials() {
    const T = this.T, n = this.night, wet = this.sim.wet;
    const M = {};
    const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
    const road = T.road.clone(); road.needsUpdate = true;
    M.asphalt = std({ map: T.road, normalMap: T.roadN, normalScale: new THREE.Vector2(0.6, 0.6), color: wet ? '#5c5e62' : '#9b9894', roughness: wet ? 0.28 : 0.92, metalness: wet ? 0.15 : 0 });
    M.asphaltDark = std({ map: T.road, color: wet ? '#4a4b4e' : '#77736e', roughness: wet ? 0.3 : 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    M.brick = std({ map: T.brick, roughness: wet ? 0.4 : 0.9 });
    M.floor = std({ map: T.floor, roughness: wet ? 0.35 : 0.7 });
    M.curb = std({ color: '#bdb9b0', roughness: 0.85 });
    M.concrete = std({ color: '#ffffff', roughness: 0.9 });
    M.grass = std({ map: T.grass, color: '#b8c8a0', roughness: 0.95 });
    M.paddy = std({ map: T.paddy, roughness: 0.9 });
    M.facade = std({ map: T.facade, emissiveMap: T.facadeE, emissive: '#ffffff', emissiveIntensity: n * 1.1, roughness: 0.82 });
    M.shop = std({ map: T.shop, emissiveMap: T.shopE, emissive: '#ffffff', emissiveIntensity: 0.12 + n * 1.25, roughness: 0.75 });
    M.sign = std({ map: T.sign, emissiveMap: T.sign, emissive: '#ffffff', emissiveIntensity: n * 1.0, roughness: 0.45 });
    M.wall = std({ map: T.wall, roughness: 0.92 });
    M.tower = std({ map: T.tower, emissiveMap: T.towerE, emissive: '#ffffff', emissiveIntensity: n * 1.2, roughness: 0.8 });
    for (const k of Object.keys(T.corr)) M['corr_' + k] = std({ map: T.corr[k], roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
    M.grille = std({ map: T.grille, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 });
    M.vcol = std({ roughness: 0.78 });
    M.vcolD = M.vcol;
    M.metal = std({ color: '#cfd4d8', metalness: 0.85, roughness: 0.32 });
    M.glass = std({ color: '#1e2a33', metalness: 0.3, roughness: 0.08 });
    M.wire = std({ color: '#141414', roughness: 0.8 }); M.wire.userData.noCast = true;
    M.leaf = std({ roughness: 0.82 });
    M.markW = std({ color: '#ecebe4', roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.markY = std({ color: '#f0bd2c', roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.markR = std({ color: '#c3352c', roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const m of [M.markW, M.markY, M.markR]) { m.userData.noCast = true; }
    M.bulb = std({ color: '#fff1c8', emissive: '#ffd27a', emissiveIntensity: 0.4 + n * 3.2, roughness: 0.3 });
    M.neonP = std({ color: '#ff4fb0', emissive: '#ff3fa8', emissiveIntensity: 0.6 + n * 3.5 });
    M.neonG = std({ color: '#3dff8a', emissive: '#2bff7a', emissiveIntensity: 0.6 + n * 3.5 });
    M.lamp = std({ color: '#fffaf0', emissive: '#fff2d0', emissiveIntensity: n > 0.3 ? 3.5 : 0.2, roughness: 0.3 });
    M.lantern = std({ color: '#e0261b', emissive: '#ff3a1a', emissiveIntensity: 0.3 + n * 2.6, roughness: 0.5 });
    M.stripe = std({ map: T.stripe, side: THREE.DoubleSide, roughness: 0.7, emissiveMap: T.stripe, emissive: '#ffffff', emissiveIntensity: n * 0.25 });
    M.glow = new THREE.MeshBasicMaterial({ map: T.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: n * 0.9, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4 });
    M.glow.userData.noCast = true; M.glow.userData.noReceive = true;
    M.waitBox = std({ map: T.waitBox, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    M.waitBox.userData.noCast = true;
    for (const [w, t] of Object.entries(T.text)) {
      M['text_' + w] = std({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.75 });
      M['text_' + w].userData.noCast = true;
    }
    for (const k of ['asphalt', 'asphaltDark', 'brick', 'floor', 'paddy', 'grass']) M[k].userData.noCast = true;
    return M;
  }

  // ---------- 建築地塊規劃（整條路線一次算好，區塊只負責蓋） ----------
  _planLots() {
    const route = this.route, L = this.sim.L;
    this.lots = [];
    for (const side of [1, -1]) {
      const rng = makeRng(hashStr(`lots:${this.level.id}:${side}`));
      let s = -PRE + 2;
      while (s < L + POST - 10) {
        const sec = route.sectionAt(s);
        const type = sec.type;
        // 路口：留出橫向街道
        const it = this._gapAt(s, side);
        if (it) { s = it.s + it.half + 0.6; continue; }
        // 目的地（右側）
        if (side > 0 && s > L - 6 && s < L + 60 && !this._destDone) {
          this._destDone = true;
          this.lots.push({ s0: L + 4, w: 36, type, side, kind: 'dest' });
          s = L + 42;
          continue;
        }
        if (type === 'highway') {
          const r = rng();
          let kind, w, gap;
          if (r < 0.28) { kind = 'factory'; w = rng.range(18, 36); gap = rng.range(8, 30); }
          else if (r < 0.45) { kind = 'betel'; w = 3.2; gap = rng.range(10, 40); }
          else if (r < 0.75) { kind = 'farmhouse'; w = rng.range(5, 8); gap = rng.range(6, 40); }
          else if (r < 0.8) { kind = 'temple'; w = 14; gap = rng.range(20, 50); }
          else { kind = 'none'; w = rng.range(20, 60); gap = 0; }
          const nx = this._nextGap(s, side);
          if (nx && s + w > nx) { s = nx + 0.1; continue; }
          if (s + w > sec.s1 && sec.s1 < L + POST - 5) { s = sec.s1; continue; }
          this.lots.push({ s0: s, w, type, side, kind, back: side > 0 ? rng.range(10, 16) : rng.range(0, 6), seed: rng() });
          s += w + gap;
          continue;
        }
        let w;
        if (type === 'avenue') w = rng.range(8, 15);
        else if (type === 'alley') w = rng.range(3.8, 5.6);
        else w = rng.range(4.0, 6.2);
        let kind = 'house';
        if ((type === 'street') && rng() < 0.04) { kind = 'temple'; w = 15; }
        const nx = this._nextGap(s, side);
        if (nx && s + w > nx - 0.5) {
          const left = nx - s;
          if (left >= 3.2) w = left - 0.1; else { s = nx + 0.01; continue; }
        }
        if (s + w > sec.s1 && sec.s1 < L + POST - 5) {
          const left = sec.s1 - s;
          if (left >= 3.2) w = left; else { s = sec.s1; continue; }
        }
        this.lots.push({ s0: s, w, type, side, kind, seed: rng() });
        s += w;
      }
    }
    this.lots.sort((a, b) => a.s0 - b.s0);
  }

  _gapAt(s, side) {
    for (const it of this.route.inters) {
      if (it.kind === 'mouth' && it.side !== 'both' && (it.side === 'L') !== (side < 0)) continue;
      if (Math.abs(s - it.s) <= it.half + 0.5) return it;
    }
    return null;
  }
  _nextGap(s, side) {
    for (const it of this.route.inters) {
      if (it.kind === 'mouth' && it.side !== 'both' && (it.side === 'L') !== (side < 0)) continue;
      if (it.s - it.half > s) return it.s - it.half - 0.5;
    }
    return null;
  }

  _planPoles() {
    // 電線桿（巷弄、街道、省道），整條路一次算好，電線才連得起來
    this.poles = [];
    const rng = makeRng(hashStr('poles:' + this.level.id));
    const L = this.sim.L;
    for (let s = -40; s < L + 120;) {
      const type = this.route.typeAt(s);
      const step = type === 'highway' ? 42 : type === 'avenue' ? 1e9 : 30;
      if (type === 'avenue' || type === 'market') { s += 10; continue; }
      if (!this.route.interAt(s, 2)) {
        const prof = PROFILES[type];
        const side = type === 'alley' ? (Math.floor(s / 60) % 2 ? 1 : -1) : 1;
        const x = type === 'alley' ? side * 3.45 : type === 'street' ? side * 5.4 : 7.2;
        this.poles.push({ s, x, type, side, h: type === 'highway' ? 10 : 8.6, tr: rng() < 0.3, seed: rng() });
      }
      s += step * rng.range(0.85, 1.15);
    }
  }

  // ---------- 每幀 ----------
  update(ps, t) {
    const a = Math.floor((ps - BEHIND) / CH), b = Math.floor((ps + AHEAD) / CH);
    let built = 0;
    for (let i = a; i <= b; i++) {
      if (!this.chunks.has(i) && built < 2) {
        const g = this._buildChunk(i);
        this.chunks.set(i, g);
        this.root.add(g);
        built++;
      }
    }
    for (const [i, g] of this.chunks) {
      if (i < a - 1 || i > b + 1) { this._disposeChunk(g); this.root.remove(g); this.chunks.delete(i); }
    }
    // 細節物件：離玩家超過 DETAIL_DIST 就不畫
    for (const [i, g] of this.chunks) {
      const vis = Math.abs(i * CH + CH / 2 - ps) < DETAIL_DIST;
      for (const m of g.children) if (m.userData.key === 'vcolD') m.visible = vis;
    }
    // 號誌
    for (const d of this.dynamic) {
      if (!d.group.parent) continue;
      d.update(t);
    }
    this.dynamic = this.dynamic.filter((d) => d.group.parent && d.group.parent.parent);
  }

  // 預先建好起點附近（載入畫面時呼叫）
  prebuild(ps, onProgress) {
    const a = Math.floor((ps - BEHIND) / CH), b = Math.floor((ps + AHEAD) / CH);
    for (let i = a; i <= b; i++) {
      if (!this.chunks.has(i)) { const g = this._buildChunk(i); this.chunks.set(i, g); this.root.add(g); }
      onProgress && onProgress((i - a + 1) / (b - a + 1));
    }
  }

  _disposeChunk(g) {
    g.traverse((o) => { if (!o.isMesh) return; if (o.geometry) o.geometry.dispose(); if (o.userData.ownMat && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }

  // ---------- 區塊 ----------
  _buildChunk(i) {
    const c0 = i * CH, c1 = c0 + CH;
    const g = new THREE.Group();
    g.name = "chunk" + i;
    this._curChunk = g;
    const B = new Bucket();
    const rng = makeRng(hashStr(`chunk:${this.level.id}:${i}`));
    const route = this.route;
    if (c1 < -PRE || c0 > this.sim.L + POST) return g;
    // 路面：依路段切開
    for (const sec of route.sections) {
      const a = Math.max(c0, sec.s0), b = Math.min(c1, sec.s1);
      if (a >= b) continue;
      this._road(B, sec.type, a, b, rng);
    }
    // 路口
    for (const it of route.inters) if (it.s >= c0 && it.s < c1) this._intersection(B, g, it, rng);
    // 建築
    for (const lot of this.lots) if (lot.s0 >= c0 && lot.s0 < c1) this._lot(B, g, lot);
    // 電線桿與電線
    for (let k = 0; k < this.poles.length; k++) {
      const p = this.poles[k];
      if (p.s >= c0 && p.s < c1) this._pole(B, p, this.poles[k + 1]);
    }
    // 路樹、路燈、分隔島、夜市攤位、捷運高架
    for (const sec of route.sections) {
      const a = Math.max(c0, sec.s0), b = Math.min(c1, sec.s1);
      if (a >= b) continue;
      this._roadside(B, g, sec, a, b, rng);
    }
    // 終點拱門
    const L = this.sim.L;
    if (L >= c0 && L < c1) this._finish(B, g);
    B.build(g, this.mats);
    return g;
  }

  // 路口範圍內（這一側）要讓開的 s 區間
  _cuts(a, b, side, pad = 0) {
    const out = [];
    let s = a;
    const its = this.route.inters.filter((it) => it.s + it.half + pad > a && it.s - it.half - pad < b);
    for (const it of its) {
      if (it.kind === 'mouth' && side && it.side !== 'both' && (it.side === 'L') !== (side < 0)) continue;
      const lo = it.s - it.half - pad, hi = it.s + it.half + pad;
      if (lo > s) out.push([s, Math.min(lo, b)]);
      s = Math.max(s, hi);
    }
    if (s < b) out.push([s, b]);
    return out.filter(([x, y]) => y - x > 0.05);
  }

  _road(B, type, a, b, rng) {
    const R = this.route, P = PROFILES[type];
    const strip = (m, xa, xb, y, o) => B.add(m, ribbon(R, a, b, xa, xb, y, o));
    const stripCut = (m, xa, xb, y, side, o) => { for (const [p, q] of this._cuts(a, b, side)) B.add(m, ribbon(R, p, q, xa, xb, y, o)); };
    const curb = (x, y, facing, side) => { for (const [p, q] of this._cuts(a, b, side)) B.add('curb', wallRibbon(R, p, q, x, 0, y, facing)); };
    const dash = (m, x, w, on = 4, off = 6, side = 0) => {
      const per = on + off;
      for (let k = Math.floor(a / per) * per; k < b; k += per) {
        const p = Math.max(a, k), q = Math.min(b, k + on);
        if (q <= p) continue;
        for (const [u, v] of this._cuts(p, q, 0, 1)) B.add(m, ribbon(R, u, v, x - w / 2, x + w / 2, 0.012, { step: 4 }));
      }
    };
    const line = (m, x, w, y = 0.012, side = 0) => { for (const [u, v] of this._cuts(a, b, side, 0.5)) B.add(m, ribbon(R, u, v, x - w / 2, x + w / 2, y, { step: 3 })); };
    const ext = 30; // 建築後面補地面
    if (type === 'alley') {
      strip('asphalt', P.left, P.right, 0, { uvScale: 5 });
      stripCut('concrete', P.right, P.facadeR + 0.2, 0.03, 1);
      stripCut('concrete', P.facadeL - 0.2, P.left, 0.03, -1);
      line('markR', P.right - 0.08, 0.1, 0.013, 1);
      line('markR', P.left + 0.08, 0.1, 0.013, -1);
    } else if (type === 'street') {
      strip('asphalt', P.left, P.right, 0, { uvScale: 5 });
      curb(P.right, 0.16, -1, 1); curb(P.left, 0.16, 1, -1);
      stripCut('curb', P.right, P.right + 0.25, 0.16, 1); stripCut('curb', P.left - 0.25, P.left, 0.16, -1);
      stripCut('brick', P.right + 0.25, P.facadeR + 0.05, 0.16, 1, { uvScale: 2 });
      stripCut('brick', P.facadeL - 0.05, P.left - 0.25, 0.16, -1, { uvScale: 2 });
      stripCut('floor', P.facadeR + 0.05, P.facadeR + P.arcade + 0.3, 0.17, 1, { uvScale: 2 });
      stripCut('floor', P.facadeL - P.arcade - 0.3, P.facadeL - 0.05, 0.17, -1, { uvScale: 2 });
      // 雙黃線、停車格線、紅線
      line('markY', 0.12, 0.1); line('markY', -0.12, 0.1);
      line('markW', P.parkLine, 0.1, 0.012, 1); line('markW', -P.parkLine, 0.1, 0.012, -1);
      for (let k = Math.ceil(a / 6.2) * 6.2; k < b; k += 6.2) {
        if (this.route.interAt(k, 3)) continue;
        B.add('markW', ribbon(R, k - 0.05, k + 0.05, P.parkLine, P.right - 0.05, 0.012));
        B.add('markW', ribbon(R, k - 0.05, k + 0.05, P.left + 0.05, -P.parkLine, 0.012));
      }
    } else if (type === 'avenue') {
      strip('asphalt', P.left, P.right, 0, { uvScale: 5 });
      strip('asphalt', P.opp[0], P.opp[1], 0, { uvScale: 5 });
      // 分隔島
      stripCut('grass', P.median[0] + 0.25, P.median[1] - 0.25, 0.22, 0);
      stripCut('curb', P.median[0], P.median[0] + 0.25, 0.22, 0); stripCut('curb', P.median[1] - 0.25, P.median[1], 0.22, 0);
      curb(P.median[1], 0.22, 1, 0); curb(P.median[0], 0.22, -1, 0);
      curb(P.right, 0.16, -1, 1); curb(P.opp[0], 0.16, 1, -1);
      stripCut('curb', P.right, P.right + 0.25, 0.16, 1);
      stripCut('brick', P.right + 0.25, P.facadeR + 0.05, 0.16, 1, { uvScale: 2 });
      stripCut('floor', P.facadeR + 0.05, P.facadeR + P.arcade + 0.3, 0.17, 1, { uvScale: 2 });
      stripCut('brick', P.facadeL - 0.05, P.opp[0] - 0.25, 0.16, -1, { uvScale: 2 });
      stripCut('curb', P.opp[0] - 0.25, P.opp[0], 0.16, -1);
      stripCut('floor', P.facadeL - P.arcade - 0.3, P.facadeL - 0.05, 0.17, -1, { uvScale: 2 });
      // 標線：車道虛線、機車優先道實線、路緣紅線、內側黃線
      dash('markW', -1.2, 0.12);
      line('markW', 2.1, 0.12);
      line('markR', P.right - 0.1, 0.12, 0.013, 1);
      line('markY', P.left + 0.12, 0.12);
      dash('markW', -10.8, 0.12); dash('markW', -14.1, 0.12);
      for (let k = Math.ceil(a / 50) * 50 + 20; k < b; k += 50) {
        if (this.route.interAt(k, 8)) continue;
        this._decal(B, 'text_機車優先', k, 3.3, 1.4, 5.6);
      }
    } else if (type === 'market') {
      strip('asphaltDark', P.left, P.right, 0, { uvScale: 5 });
      stripCut('floor', P.right, P.facadeR + P.arcade + 0.3, 0.1, 1, { uvScale: 2 });
      stripCut('floor', P.facadeL - P.arcade - 0.3, P.left, 0.1, -1, { uvScale: 2 });
      curb(P.right, 0.1, -1, 1); curb(P.left, 0.1, 1, -1);
    } else if (type === 'highway') {
      strip('asphalt', P.left, P.right, 0, { uvScale: 5 });
      strip('asphalt', P.opp[0], P.opp[1], 0, { uvScale: 5 });
      strip('concrete', P.median[0], P.median[1], 0.01);
      strip('grass', P.right, P.right + 3, -0.02, { uvScale: 4 });
      strip('paddy', P.right + 3, P.right + 70, -0.25, { uvScale: 18 });
      strip('grass', P.opp[0] - 3, P.opp[0], -0.02, { uvScale: 4 });
      strip('paddy', P.opp[0] - 70, P.opp[0] - 3, -0.25, { uvScale: 18 });
      // 紐澤西護欄（分隔島）
      for (const [u, v] of this._cuts(a, b, 0)) {
        B.add('concrete', wallRibbon(R, u, v, P.median[0] + 0.5, 0, 0.85, -1), null, 0xd2cfc6);
        B.add('concrete', wallRibbon(R, u, v, P.median[1] - 0.5, 0, 0.85, 1), null, 0xd2cfc6);
        B.add('concrete', ribbon(R, u, v, P.median[0] + 0.5, P.median[1] - 0.5, 0.85), null, 0xc9c6bd);
      }
      dash('markW', 0, 0.15);
      line('markW', 3.5, 0.15);
      line('markY', P.left + 0.12, 0.12);
      line('markY', P.opp[1] - 0.12, 0.12);
      dash('markW', -9, 0.15);
      line('markW', P.opp[0] + 0.3, 0.15);
    }
    // 補丁路：挖了又補的深色柏油塊（規格 6.3）
    if (type !== 'market') {
      for (let k = Math.ceil(a / 7) * 7; k < b; k += 7) {
        const r = Math.sin(k * 12.9898) * 43758.5453; const fr = r - Math.floor(r);
        if (fr > 0.35) continue;
        const lw = 0.8 + fr * 4, ll = 1.5 + fr * 6;
        const x0 = P.left + (P.right - P.left) * ((fr * 7.3) % 1) - lw / 2;
        B.add('asphaltDark', ribbon(R, k, Math.min(b, k + ll), Math.max(P.left, x0), Math.min(P.right, x0 + lw), 0.006, { step: ll, uvScale: 3 }));
      }
    }
    // 建築後面的地面（避免從路口看到空洞）
    if (type !== 'highway') {
      const fr = P.facadeR + (P.arcade || 0) + 0.3, fl = P.facadeL - (P.arcade || 0) - 0.3;
      strip('asphaltDark', fr, fr + ext, 0.0, { uvScale: 6 });
      strip('asphaltDark', fl - ext, fl, 0.0, { uvScale: 6 });
    }
  }

  // 路面字貼花：長方形、沿 s 方向拉長（騎士角度看才正常）
  _decal(B, m, s, x, w, l) {
    const R = this.route;
    const g = ribbon(R, s - l / 2, s + l / 2, x - w / 2, x + w / 2, 0.014, { step: l, uvScale: 1 });
    // 重設 UV：u 0→1（左→右），v 0→1（近→遠）
    const uv = g.attributes.uv, pos = g.attributes.position;
    const sm = R.sample(s, {});
    for (let k = 0; k < uv.count; k++) {
      const dx = pos.getX(k) - sm.x, dz = pos.getZ(k) - sm.z;
      const lat = dx * sm.rx + dz * sm.rz, lon = dx * sm.fx + dz * sm.fz;
      uv.setXY(k, (lat - x + w / 2) / w, (lon + l / 2) / l);
    }
    B.add(m, g);
  }

  _intersection(B, g, it, rng) {
    const R = this.route, P = PROFILES[it.type] || PROFILES.street;
    const s0 = it.s - it.half, s1 = it.s + it.half;
    const L = this.sim.L;
    // 橫向街道：路面往兩側延伸
    const sideX = (side) => side > 0 ? (P.facadeR + (P.arcade || 0)) : (P.facadeL - (P.arcade || 0));
    const sides = it.side === 'both' ? [1, -1] : it.side === 'L' ? [-1] : [1];
    for (const side of sides) {
      const inner = side > 0 ? R.bounds(it.s).right : R.bounds(it.s).left;
      const outer = sideX(side) + side * 45;
      B.add(it.kind === 'mouth' ? 'asphalt' : 'asphalt', ribbon(R, s0, s1, Math.min(inner, outer), Math.max(inner, outer), -0.005, { uvScale: 5, step: it.width }));
      // 橫向街道兩側的房子（往外延伸，營造縱深）
      for (const end of [-1, 1]) {
        const sEdge = end < 0 ? s0 - 0.3 : s1 + 0.3;
        let x = sideX(side) + side * 0.5;
        const r2 = makeRng(hashStr(`x:${this.level.id}:${it.id}:${side}:${end}`));
        for (let k = 0; k < 4; k++) {
          const w = r2.range(4.5, 7);
          const h = (it.type === 'avenue' ? r2.range(14, 30) : r2.range(7, 15));
          const d = r2.range(8, 12);
          // 建築面向橫向街道：在路線座標系裡沿 x 排
          const sm = R.sample(sEdge, {});
          const cx = x + side * w / 2;
          const wx = sm.x + sm.rx * cx, wz = sm.z + sm.rz * cx;
          const m = new THREE.Matrix4().makeRotationY(sm.th + (end > 0 ? Math.PI : 0));
          m.setPosition(wx + sm.fx * end * d / 2, 0, wz + sm.fz * end * d / 2);
          const cell = this.T.facadeCells[r2.int(0, 15)];
          const floors = Math.max(2, Math.round(h / 3.2));
          for (let f = 0; f < floors; f++) {
            const q = quad(w, 3.2, cell);
            B.add('facade', q, m.clone().multiply(mat(0, 1.6 + f * 3.2, -end * 0 - d / 2 - 0.001, Math.PI)));
          }
          B.add('wall', box(w, floors * 3.2, d, { uvScale: 3, faces: ['px', 'nx', 'py', 'pz'] }), m.clone().multiply(mat(0, floors * 1.6, 0)));
          x += side * (w + 0.05);
        }
      }
    }
    if (it.kind === 'mouth') {
      // 巷口：停字、反光鏡
      const side = sides[0];
      const b = R.bounds(it.s);
      const mx = side > 0 ? b.right + 0.6 : b.left - 0.6;
      const mm = frameAt(R, s0 - 0.8, mx, side);
      this._prop((m, geo, l, c) => B.add(m, geo, mm.clone().multiply(l), c), 'mirror_pole', mat(0, 0, 0, side > 0 ? -0.6 : 0.6));
      return;
    }
    // 斑馬線、停止線、待轉區、慢字
    const b = R.bounds(it.s);
    for (const zs of [s0 - 2.6, s1 + 2.6]) {
      for (let x = b.left + 0.4; x < b.right - 0.4; x += 1.0) {
        B.add('markW', ribbon(R, zs - 1.5, zs + 1.5, x, x + 0.5, 0.013, { step: 3 }));
      }
    }
    if (P.opp) for (const zs of [s0 - 2.6, s1 + 2.6]) for (let x = P.opp[0] + 0.4; x < P.opp[1] - 0.4; x += 1.0) B.add('markW', ribbon(R, zs - 1.5, zs + 1.5, x, x + 0.5, 0.013, { step: 3 }));
    B.add('markW', ribbon(R, s0 - 4.9, s0 - 4.5, it.type === 'street' ? 0 : b.left, b.right, 0.013, { step: 1 }));
    if (it.light) {
      this._decal(B, 'waitBox', s0 + 2.2, b.right - 1.6, 2.6, 2.6);
      this._decal(B, 'text_慢', s0 - 20, it.type === 'street' ? 1.6 : 0.45, 2.2, 3.8);
      this._signal(g, B, it);
    }
  }

  // 號誌：遠側右邊的桿子＋橫臂，燈頭面向玩家；紅燈倒數（規格 5.3）
  _signal(g, B, it) {
    const R = this.route;
    const b = R.bounds(it.s);
    const s = it.s + it.half + 0.8;
    const px = b.right + 0.9;
    const base = frameAt(R, s, px, 1); // ex＝−f，ez＝−r（朝路中）
    this._prop((m, geo, l, c) => B.add(m, geo, base.clone().multiply(l), c), 'traffic_pole', mat(0, 0, 0));
    // 燈頭（動態材質，不合併）
    const grp = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: '#3a0d0b', emissive: '#ff2a1a', emissiveIntensity: 0 });
    const yel = new THREE.MeshStandardMaterial({ color: '#3a2a08', emissive: '#ffb21a', emissiveIntensity: 0 });
    const grn = new THREE.MeshStandardMaterial({ color: '#0b2a1a', emissive: '#19ff8a', emissiveIntensity: 0 });
    const house = new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.6 });
    const cvs = document.createElement('canvas'); cvs.width = 64; cvs.height = 32;
    const ctex = new THREE.CanvasTexture(cvs); ctex.colorSpace = THREE.SRGBColorSpace;
    const cmat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: ctex, emissiveIntensity: 2.2 });
    for (const m of [red, yel, grn, house, cmat]) m.userData = {};
    grp.userData.ownMat = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.42, 0.32), house);
    grp.add(head);
    const lamp = (mtl, x) => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 14), mtl); l.rotation.x = Math.PI / 2; l.position.set(x, 0, 0.17); grp.add(l); };
    lamp(red, -0.4); lamp(yel, 0); lamp(grn, 0.4);
    const cd = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.38, 0.2), house); cd.position.set(1.0, 0, 0); grp.add(cd);
    const cdf = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.3), cmat); cdf.position.set(1.0, 0, 0.11); grp.add(cdf);
    // 燈頭放在橫臂上、面向 −s（迎著玩家）
    const sm = R.sample(s, {});
    const hx = b.left + (b.right - b.left) * 0.62;
    grp.position.set(sm.x + sm.rx * hx, 5.75, sm.z + sm.rz * hx);
    grp.rotation.y = sm.th + Math.PI;
    for (const o of grp.children) { o.castShadow = true; o.userData.ownMat = true; }
    g.add(grp);
    // 第二組（路中、給內側車道看）
    let last = '';
    const route = this.route;
    this.dynamic.push({
      group: grp,
      update: (t) => {
        const st = route.lightState(it, this.sim.clock);
        red.emissiveIntensity = st === 'red' ? 4 : 0;
        yel.emissiveIntensity = st === 'yellow' ? 4 : 0;
        grn.emissiveIntensity = st === 'green' ? 4 : 0;
        const n = Math.ceil(route.lightRemain(it, this.sim.clock));
        const key = st + n;
        if (key !== last) {
          last = key;
          const c = cvs.getContext('2d');
          c.fillStyle = '#000'; c.fillRect(0, 0, 64, 32);
          c.fillStyle = st === 'green' ? '#2bff8a' : st === 'yellow' ? '#ffc21a' : '#ff3322';
          c.font = 'bold 28px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(String(n).padStart(2, '0'), 32, 17);
          ctex.needsUpdate = true;
        }
      },
    });
  }

  // ---------- 建築 ----------
  _lot(B, g, lot) {
    if (lot.kind === 'dest') return this._dest(B, g, lot);
    if (lot.type === 'highway') return this._rural(B, g, lot);
    if (lot.kind === 'temple') return this._temple(B, g, lot, PROFILES[lot.type]);
    const P = PROFILES[lot.type];
    const rng = makeRng(hashStr(`b:${this.level.id}:${lot.s0.toFixed(2)}:${lot.side}`));
    const side = lot.side, w = lot.w;
    const fx = side > 0 ? P.facadeR : P.facadeL;
    const F = frameAt(this.route, lot.s0 + w / 2, fx, side);
    const add = (m, geo, local, color) => B.add(m, geo, local ? F.clone().multiply(local) : F.clone(), color);
    const arcade = P.arcade || 0;
    let floors;
    if (lot.type === 'avenue') floors = rng.int(6, 13);
    else if (lot.type === 'alley') floors = rng.int(2, 4);
    else if (lot.type === 'market') floors = rng.int(2, 4);
    else floors = rng() < 0.12 ? rng.int(6, 8) : rng.int(3, 5);
    const G = arcade ? 3.6 : 3.3, FH = 3.15;
    const top = G + (floors - 1) * FH;
    const d = lot.type === 'avenue' ? rng.range(14, 20) : rng.range(9, 14);
    const cellI = rng.int(0, 15);
    const cell = this.T.facadeCells[cellI];
    const tileCol = new THREE.Color(TILE_COLORS[cellI % TILE_COLORS.length]).getHex();
    const nb = Math.max(1, Math.round(w / 4.6));
    const bw = w / nb;
    // 樓上外牆（每層每個開間一片）
    for (let f = 0; f < floors - 1; f++) {
      const y0 = G + f * FH;
      for (let k = 0; k < nb; k++) {
        const flipU = rng() < 0.5;
        const uv = flipU ? [cell[2], cell[1], cell[0], cell[3]] : cell;
        add('facade', quad(bw, FH, uv), mat(-w / 2 + (k + 0.5) * bw, y0 + FH / 2, 0));
      }
    }
    // 本體（側牆、屋頂）
    add('wall', box(w, top - G, d, { uvScale: 3.2, faces: ['px', 'nx', 'py', 'nz'] }), mat(0, G + (top - G) / 2, -d / 2), shade(tileColHex(tileCol), 1.0));
    // 屋頂女兒牆
    add('vcol', box(w, 0.9, 0.18), mat(0, top + 0.45, -0.09), shadeHex(tileCol, 0.95));
    add('vcol', box(0.18, 0.9, d), mat(w / 2 - 0.09, top + 0.45, -d / 2), shadeHex(tileCol, 0.9));
    // 一樓：騎樓或店面
    const shop = this._pickShop(rng, lot.type);
    if (arcade) {
      add('shop', quad(w, G, shop.uv), mat(0, G / 2, -arcade));
      add('vcol', box(w, 0.12, arcade, { faces: ['ny'] }), mat(0, G, -arcade / 2), 0xd9d6cf);
      add('vcol', box(0.5, G, 0.5), mat(w / 2 - 0.25, G / 2, -0.25), shadeHex(tileCol, 0.92));
      // 騎樓前緣的樑
      add('vcol', box(w, 0.35, 0.3), mat(0, G - 0.17, -0.15), shadeHex(tileCol, 0.85));
      // 騎樓停的機車
      const nS = Math.floor(w / 0.85);
      for (let k = 0; k < nS; k++) if (rng() < 0.55) this._parkedScooter(add, -w / 2 + 0.45 + k * 0.85 + rng.range(-0.08, 0.08), -0.9 - rng() * 0.3, rng);
      // 招牌燈箱（橫式，掛在騎樓前緣）
      if (rng() < 0.85) {
        const sc = this.T.signH[rng.int(0, 11)];
        add('sign', quad(Math.min(w - 0.3, 6), 0.78, sc), mat(0, G - 0.62, 0.02));
      }
    } else {
      add('shop', quad(w, G, shop.uv), mat(0, G / 2, 0.01));
      add('wall', box(w, G, d - 0.2, { uvScale: 3.2, faces: ['px', 'nx'] }), mat(0, G / 2, -d / 2 - 0.1), shade(tileColHex(tileCol), 1.0));
      if (rng() < 0.45) add('sign', quad(Math.min(w - 0.3, 5), 0.7, this.T.signH[rng.int(0, 11)]), mat(0, G + 0.45, 0.05));
      // 門口的機車、盆栽
      for (let k = 0; k < 2; k++) if (rng() < 0.5) this._parkedScooter(add, rng.range(-w / 2 + 0.6, w / 2 - 0.6), 0.6, rng, true);
      if (rng() < 0.5) this._pot(add, rng.range(-w / 2 + 0.4, w / 2 - 0.4), 0.35, rng);
    }
    // 鐵窗、冷氣、陽台
    const grilles = rng() < 0.6;
    const balcony = !grilles && rng() < 0.35;
    for (let f = 0; f < floors - 1; f++) {
      const y0 = G + f * FH;
      for (let k = 0; k < nb; k++) {
        const cx = -w / 2 + (k + 0.5) * bw;
        if (grilles && rng() < 0.85) {
          const gw = bw * 0.78, gh = 2.05, gd = 0.42;
          add('grille', box(gw, gh, gd, { uvScale: 1.3, faces: ['px', 'nx', 'py', 'ny', 'pz'] }), mat(cx, y0 + 1.55, gd / 2));
          // 鐵窗頂的遮雨板
          if (rng() < 0.6) add(rng() < 0.5 ? 'corr_blue' : 'corr_green', box(gw + 0.2, 0.05, gd + 0.25, { faces: ['py', 'ny', 'pz'] }), mat(cx, y0 + 2.62, (gd + 0.25) / 2, 0, -0.18));
        }
        if (rng() < 0.55) this._ac(add, cx + (rng() < 0.5 ? -1 : 1) * bw * 0.36, y0 + 0.45 + (rng() < 0.3 ? 1.6 : 0), rng);
      }
      if (balcony) {
        add('vcol', box(w, 0.16, 0.95), mat(0, y0 + 0.08, 0.47), shadeHex(tileCol, 0.9));
        add('grille', box(w, 1.05, 0.05, { uvScale: 1.0, faces: ['pz', 'nz'] }), mat(0, y0 + 0.65, 0.93));
        if (rng() < 0.5) this._laundry(add, w, y0, rng);
      }
    }
    // 直式招牌（垂直於外牆，迎著騎士）
    const vProb = { street: 0.7, alley: 0.25, market: 0.65, avenue: 0.55 }[lot.type] ?? 0.4;
    const nV = rng() < vProb ? (lot.type === 'avenue' && rng() < 0.5 ? 2 : 1) : 0;
    for (let k = 0; k < nV; k++) {
      const h = Math.min(top - G - 0.4, rng.range(3.5, lot.type === 'avenue' ? 11 : 7.5));
      if (h < 2.2) break;
      const sx = (k === 0 ? 1 : -1) * (rng() < 0.5 ? 1 : -1) * (w / 2 - 0.35);
      const yc = G + 0.35 + h / 2;
      const sw = lot.type === 'avenue' ? 1.15 : 0.9;
      const zc = 0.25 + sw / 2;
      const sc = this.T.signV[rng.int(0, 11)];
      add('vcol', box(0.12, h + 0.12, sw + 0.1), mat(sx, yc, zc), 0xe8e8e2);
      add('sign', quad(sw, h, sc), mat(sx + 0.065, yc, zc, Math.PI / 2));
      add('sign', quad(sw, h, sc), mat(sx - 0.065, yc, zc, -Math.PI / 2));
      add('vcol', box(0.06, 0.06, 0.3), mat(sx, yc + h / 2 - 0.3, 0.1), 0x777777);
      add('vcol', box(0.06, 0.06, 0.3), mat(sx, yc - h / 2 + 0.3, 0.1), 0x777777);
    }
    // 頂樓：鐵皮加蓋、水塔
    if (rng() < (lot.type === 'avenue' ? 0.25 : 0.6)) {
      const corr = rng.pick(['corr_blue', 'corr_gray', 'corr_rust', 'corr_white', 'corr_blue']);
      const sw = w * rng.range(0.7, 0.98), sd = d * rng.range(0.4, 0.7), sh = 2.4;
      const zc = -d + sd / 2 + 0.3;
      add(corr, box(sw, sh, sd, { uvScale: 1.6, faces: ['px', 'nx', 'pz', 'nz'] }), mat(0, top + sh / 2, zc));
      // 斜屋頂
      const slope = 0.35;
      const rl = sd / 2 / Math.cos(slope) + 0.2;
      add(corr, box(sw + 0.3, 0.04, rl, { uvScale: 1.6, faces: ['py', 'ny'] }), mat(0, top + sh + Math.sin(slope) * rl / 2 - 0.05, zc + sd / 4, 0, slope));
      add(corr, box(sw + 0.3, 0.04, rl, { uvScale: 1.6, faces: ['py', 'ny'] }), mat(0, top + sh + Math.sin(slope) * rl / 2 - 0.05, zc - sd / 4, 0, -slope));
    }
    const nT = rng() < 0.75 ? rng.int(1, 2) : 0;
    for (let k = 0; k < nT; k++) this._waterTank(add, rng.range(-w / 2 + 0.8, w / 2 - 0.8), top, rng.range(-d + 1.2, -1.5), rng);
    // 遠景大樓（後排）
    if (rng() < (lot.type === 'avenue' ? 0.5 : 0.22)) {
      const tw = rng.range(10, 18), th = rng.range(18, lot.type === 'avenue' ? 60 : 35), td = rng.range(10, 18);
      add('tower', box(tw, th, td, { uvScale: 8, faces: ['px', 'nx', 'pz', 'py'] }), mat(rng.range(-4, 4), th / 2, -d - rng.range(8, 30) - td / 2));
    }
  }

  _pickShop(rng, type) {
    const cells = this.T.shopCells;
    const pool = type === 'alley'
      ? cells.filter((c) => c.kind === 'shutter' || c.kind === 'halfshutter' || rng() < 0.25)
      : cells.filter((c) => c.kind !== 'shutter' || rng() < 0.4);
    return rng.pick(pool.length ? pool : cells);
  }

  _ac(add, x, y, rng) {
    // 冷氣室外機（Blender 模型）：分離式為主，偶爾窗型
    const win = rng() < 0.25;
    this._prop(add, win ? 'ac_window' : 'ac_split', mat(x, y - 0.27, win ? 0.3 : 0.16));
  }

  // 放一個 Blender 物件（props.glb）；有 __glow 的發光部件另外用發光材質
  _prop(add, name, local, glowMat = 'lamp') {
    add(DETAIL.has(name) ? 'vcolD' : 'vcol', propGeo(name).clone(), local);
    if (!this._glowSet) this._glowSet = new Set(propNames().filter((n) => n.endsWith('__glow')));
    if (this._glowSet.has(name + '__glow')) add(glowMat, propGeo(name + '__glow').clone(), local);
  }

  _waterTank(add, x, y, z, rng) {
    this._prop(add, rng() < 0.6 ? 'water_tank_steel' : 'water_tank_blue', mat(x, y, z, rng() * Math.PI * 2));
  }

  _laundry(add, w, y0, rng) {
    add('vcol', box(w * 0.8, 0.02, 0.02), mat(0, y0 + 2.2, 0.75), 0xaaaaaa);
    for (let k = 0; k < 6; k++) if (rng() < 0.7) add('vcol', box(0.35, rng.range(0.4, 0.7), 0.02), mat(-w * 0.35 + k * w * 0.14, y0 + 1.9, 0.75), rng.pick([0xffffff, 0x4a7fd0, 0xe04848, 0xf0d040, 0x88c070, 0xf0f0f0]));
  }

  _pot(add, x, z, rng) {
    const s = rng.range(0.8, 1.2);
    this._prop(add, 'potted_plant', mat(x, 0, z, rng() * 6, 0, 0, s, s, s));
  }

  // 停放的機車（簡化模型，頂點色合併）。z：離外牆往路的距離（負＝騎樓內）
  _parkedScooter(add, x, z, rng, along = false) {
    // 停放的機車（速克達精簡模型，頂點色，合併進街景）
    const seed = Math.floor(rng() * 1e6);
    const ry = (along ? Math.PI / 2 : (rng() < 0.5 ? 0 : Math.PI)) + rng.range(-0.15, 0.15);
    add('vcolD', makeParkedScooterGeo(seed).clone(), mat(x, 0, z, ry));
  }

  _temple(B, g, lot, P) {
    const side = lot.side, w = lot.w;
    const fx = (side > 0 ? P.facadeR : P.facadeL) + side * 6;
    const F = frameAt(this.route, lot.s0 + w / 2, fx, side);
    const add = (m, geo, local, c) => B.add(m, geo, F.clone().multiply(local), c);
    this._templeBody(add, w, 1);
    // 前埕：地磚＋香爐
    add('floor', box(w, 0.1, 6.5, { uvScale: 2, faces: ['py'] }), mat(0, 0.12, 3.25));
    this._prop(add, 'incense_burner', mat(0, 0.17, 3.4));
    this._prop(add, 'temple_lion', mat(-w / 2 + 1.5, 0.6, 1.2, 0.3));
    this._prop(add, 'temple_lion', mat(w / 2 - 1.5, 0.6, 1.2, -0.3));
  }

  // 廟宇：紅牆、燕尾屋脊、龍柱、紅燈籠（規格 6.3）
  _templeBody(add, w, scale = 1) {
    const d = 10 * scale, h = 5.2 * scale;
    add('vcol', box(w + 1, 0.6, d + 1), mat(0, 0.3, -d / 2), 0x9a8f80);
    add('vcol', box(w, h, d), mat(0, 0.6 + h / 2, -d / 2), 0xb3261e);
    // 門
    for (const dx of [-w / 3, 0, w / 3]) add('vcol', box(w / 4.5, h * 0.62, 0.1), mat(dx, 0.6 + h * 0.31, 0.03), 0x7a1a12);
    for (const dx of [-w / 3, 0, w / 3]) add('vcol', box(w / 4.5 - 0.3, h * 0.55, 0.12), mat(dx, 0.6 + h * 0.3, 0.06), 0x9a2018);
    // 龍柱
    for (const dx of [-w / 2 + 0.6, -w / 6, w / 6, w / 2 - 0.6]) {
      add('vcol', cyl(0.32, 0.36, h, 10), mat(dx, 0.6 + h / 2, 0.9), 0xcfc8b8);
      add('vcol', new THREE.TorusGeometry(0.38, 0.09, 6, 12), mat(dx, 0.6 + h * 0.6, 0.9, 0, Math.PI / 2), 0x3e8a5a);
    }
    // 屋頂（兩層）＋燕尾
    const roof = (y, ww, dd, col) => {
      add('vcol', box(ww, 0.3, dd), mat(0, y, -d / 2 + 0.6), 0x4a3a2a);
      add('vcol', box(ww * 0.98, 0.08, dd / 2 / Math.cos(0.5) + 0.2), mat(0, y + 0.7, -d / 2 + 0.6 + dd / 4, 0, 0.5), col);
      add('vcol', box(ww * 0.98, 0.08, dd / 2 / Math.cos(0.5) + 0.2), mat(0, y + 0.7, -d / 2 + 0.6 - dd / 4, 0, -0.5), col);
      // 屋脊
      add('vcol', box(ww * 0.9, 0.45, 0.4), mat(0, y + 1.55, -d / 2 + 0.6), 0x2d7a4a);
      // 燕尾：兩端翹起
      for (const sx of [-1, 1]) {
        add('vcol', box(1.4, 0.35, 0.35), mat(sx * (ww * 0.45 + 0.5), y + 1.95, -d / 2 + 0.6, 0, 0, sx * -0.55), 0x2d7a4a);
        add('vcol', box(0.8, 0.25, 0.25), mat(sx * (ww * 0.45 + 1.05), y + 2.45, -d / 2 + 0.6, 0, 0, sx * -1.0), 0xd8a030);
      }
      // 屋脊中央的寶塔、雙龍
      add('vcol', box(0.5, 0.9, 0.3), mat(0, y + 2.1, -d / 2 + 0.6), 0xd8a030);
      for (const sx of [-1, 1]) add('vcol', box(1.6, 0.35, 0.2), mat(sx * 1.2, y + 1.95, -d / 2 + 0.6, 0, 0, sx * 0.25), 0x3aa0c0);
    };
    roof(0.6 + h, w + 2.2, d + 2.4, 0x6e6a62);
    roof(0.6 + h + 2.2, w * 0.6, d * 0.8, 0x6e6a62);
    // 紅燈籠
    for (let k = 0; k < 6; k++) add('lantern', new THREE.SphereGeometry(0.28, 10, 8), mat(-w / 2 + 0.8 + k * (w - 1.6) / 5, 0.6 + h - 0.4, 1.4, 0, 0, 0, 1, 1.25, 1));
    // 匾額
    add('vcol', box(3.2, 0.9, 0.12), mat(0, 0.6 + h * 0.85, 0.08), 0x1a3a7a);
  }

  _rural(B, g, lot) {
    const P = PROFILES.highway;
    const side = lot.side;
    const rng = makeRng(hashStr(`r:${this.level.id}:${lot.s0.toFixed(2)}:${side}`));
    const x = side > 0 ? P.right + lot.back : P.opp[0] - 3 - lot.back;
    const w = lot.w;
    const F = frameAt(this.route, lot.s0 + w / 2, x, side);
    const add = (m, geo, local, c) => B.add(m, geo, F.clone().multiply(local), c);
    if (lot.kind === 'factory') {
      const h = rng.range(6, 9), d = rng.range(14, 24);
      const corr = rng.pick(['corr_blue', 'corr_gray', 'corr_white', 'corr_rust']);
      add(corr, box(w, h, d, { uvScale: 1.6, faces: ['px', 'nx', 'pz', 'nz'] }), mat(0, h / 2, -d / 2));
      const rl = d / 2 / Math.cos(0.18) + 0.3;
      add('corr_blue', box(w + 0.6, 0.06, rl, { uvScale: 1.6, faces: ['py', 'ny'] }), mat(0, h + Math.sin(0.18) * rl / 2, -d / 4, 0, -0.18));
      add('corr_blue', box(w + 0.6, 0.06, rl, { uvScale: 1.6, faces: ['py', 'ny'] }), mat(0, h + Math.sin(0.18) * rl / 2, -3 * d / 4, 0, 0.18));
      add('vcol', box(Math.min(8, w * 0.4), h * 0.6, 0.1), mat(-w * 0.2, h * 0.3, 0.06), 0x7d8790);
      add('sign', quad(Math.min(9, w * 0.6), 1.3, this.T.signH[rng.int(0, 11)]), mat(w * 0.1, h - 1.0, 0.07));
      // 前面的空地、貨櫃
      add('concrete', box(w, 0.05, 8, { faces: ['py'] }), mat(0, 0.0, 4), 0x9a9890);
      if (rng() < 0.6) add('vcol', box(6, 2.6, 2.4), mat(w * 0.25, 1.3, 3.5, 0.1), rng.pick([0x2f6fb6, 0xb83a2a, 0x3a8a4a]));
    } else if (lot.kind === 'betel') {
      // 檳榔攤：玻璃小亭＋粉紅綠霓虹
      add('vcol', box(3.0, 2.6, 2.4), mat(0, 1.3, -1.2), 0xe8e8e8);
      add('glass', box(2.8, 1.6, 0.05), mat(0, 1.5, 0.02));
      add('neonP', box(3.1, 0.08, 0.08), mat(0, 2.62, 0.06));
      add('neonG', box(3.1, 0.08, 0.08), mat(0, 2.45, 0.06));
      add('neonP', box(0.08, 2.5, 0.08), mat(-1.53, 1.3, 0.06));
      add('neonG', box(0.08, 2.5, 0.08), mat(1.53, 1.3, 0.06));
      add('sign', quad(2.8, 0.6, this.T.signH[rng.int(0, 11)]), mat(0, 3.1, 0.05));
      this._betelPalm(add, -3, -3, rng); this._betelPalm(add, 4, -5, rng);
    } else if (lot.kind === 'farmhouse') {
      const floors = rng.int(2, 4), d = 10;
      const cellI = rng.int(0, 15), cell = this.T.facadeCells[cellI];
      const top = 3.3 + (floors - 1) * 3.15;
      add('shop', quad(w, 3.3, this._pickShop(rng, 'alley').uv), mat(0, 1.65, 0.01));
      for (let f = 0; f < floors - 1; f++) add('facade', quad(w, 3.15, cell), mat(0, 3.3 + f * 3.15 + 1.575, 0));
      add('wall', box(w, top, d, { uvScale: 3.2, faces: ['px', 'nx', 'py', 'nz'] }), mat(0, top / 2, -d / 2));
      if (rng() < 0.7) {
        const corr = rng.pick(['corr_blue', 'corr_rust', 'corr_gray']);
        add(corr, box(w * 0.9, 2.3, d * 0.6, { uvScale: 1.6, faces: ['px', 'nx', 'pz', 'nz'] }), mat(0, top + 1.15, -d * 0.6));
        add(corr, box(w * 0.9 + 0.3, 0.05, d * 0.6 + 0.4, { faces: ['py', 'ny'] }), mat(0, top + 2.35, -d * 0.6, 0, 0.08));
      }
      this._waterTank(add, 0, top, -2, rng);
      for (let k = 0; k < 2; k++) this._parkedScooter(add, rng.range(-w / 2 + 0.5, w / 2 - 0.5), 1.0, rng, true);
      this._betelPalm(add, w / 2 + 2, -2, rng);
    } else if (lot.kind === 'temple') {
      this._templeBody(add, w, 0.8);
    } else {
      // 空地：檳榔樹、電塔
      for (let k = 0; k < 5; k++) if (rng() < 0.6) this._betelPalm(add, rng.range(0, w) - w / 2, -rng.range(2, 20), rng);
    }
  }

  _betelPalm(add, x, z, rng) {
    const s = rng.range(0.8, 1.2);
    this._prop(add, rng() < 0.75 ? 'betel_palm' : 'coconut_palm', mat(x, 0, z, rng() * 6, rng.range(-0.04, 0.04), 0, s, s, s));
  }

  _tree(B, s, x, kind, rng) {
    const R = this.route;
    const F = frameAt(R, s, x, 1);
    const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
    if (kind === 'palm') { this._betelPalm(add, 0, 0, rng); return; }
    const sc = rng.range(0.8, 1.15);
    this._prop(add, kind === 'luan' ? 'tree_luan' : 'tree_banyan', mat(0, 0, 0, rng() * 6, 0, 0, sc, sc * rng.range(0.9, 1.1), sc));
  }

  _streetLight(B, s, x, armDir, rng, dbl = false) {
    const R = this.route;
    const F = frameAt(R, s, x, 1); // +z＝朝路中（−x）
    const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
    for (const dir of dbl ? [1, -1] : [armDir]) {
      this._prop(add, 'street_lamp', mat(0, 0, 0, dir > 0 ? 0 : Math.PI));
      if (this.night > 0.2) add('glow', quad(9, 9), mat(0, 0.03, dir * 2.4, 0, -Math.PI / 2), 0xffffff);
    }
  }

  _pole(B, p, next) {
    const R = this.route;
    const F = frameAt(R, p.s, p.x, p.x > 0 ? 1 : -1);
    const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
    const rng = makeRng(Math.floor(p.seed * 1e9));
    const ph = p.h / 8.6;
    this._prop(add, p.tr ? 'elec_pole' : 'elec_pole_plain', mat(0, 0, 0, 0, 0, 0, 1, ph, 1));
    // 號誌牌、廣告貼紙
    if (rng() < 0.4) add('vcol', box(0.02, 0.6, 0.45), mat(0.21, 2.4, 0), rng.pick([0xffd400, 0xffffff, 0x2f6fb6]));
    // 路燈（街道）
    if (p.type !== 'alley' || rng() < 0.5) {
      this._prop(add, 'street_lamp', mat(0.28, 0, 0, 0, 0, 0, 0.85, 0.75, 0.85));
      if (this.night > 0.2) add('glow', quad(8, 8), mat(0, 0.04 - 0, 2.4, 0, -Math.PI / 2));
    }
    if (!next || next.s - p.s > 60) return;
    // 電線：一束 5～8 條，有垂度（台灣街景的招牌元素）
    const a = R.toWorld(p.s, p.x, {}), b = R.toWorld(next.s, next.x, {});
    const nW = 4 + Math.floor(rng() * 4);
    for (let k = 0; k < nW; k++) {
      const y0 = p.h - 0.45 - (k % 3) * 0.35 - (k > 4 ? 1.0 : 0), y1 = next.h - 0.45 - (k % 3) * 0.35 - (k > 4 ? 1.0 : 0);
      const off = (k - nW / 2) * 0.12;
      const sag = 0.3 + rng() * 0.6;
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8;
        pts.push(new THREE.Vector3(a.wx + (b.wx - a.wx) * t + off * 0.3, y0 + (y1 - y0) * t - sag * 4 * t * (1 - t), a.wz + (b.wz - a.wz) * t + off));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      B.add('wire', new THREE.TubeGeometry(curve, 10, 0.016, 3, false));
    }
    // 拉到對面房子的線
    if (rng() < 0.5) {
      const s2 = p.s + rng.range(3, 15);
      const P = R.profileAt(p.s);
      const xo = p.x > 0 ? (P.facadeL || -5) + 0.2 : (P.facadeR || 5) - 0.2;
      const c = R.toWorld(s2, xo, {});
      const y0 = p.h - 0.8, y1 = rng.range(4.5, 7);
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8;
        pts.push(new THREE.Vector3(a.wx + (c.wx - a.wx) * t, y0 + (y1 - y0) * t - 0.5 * 4 * t * (1 - t), a.wz + (c.wz - a.wz) * t));
      }
      B.add('wire', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.014, 3, false));
    }
  }

  _roadside(B, g, sec, a, b, rng) {
    const R = this.route, P = PROFILES[sec.type];
    const each = (step, phase, fn) => {
      for (let s = Math.ceil((a - phase) / step) * step + phase; s < b; s += step) {
        if (R.interAt(s, 3)) continue;
        fn(s);
      }
    };
    if (sec.type === 'avenue') {
      const r2 = makeRng(hashStr('av' + sec.s0));
      const mrt = r2() < 0.55;
      each(9, 2, (s) => this._tree(B, s, (P.median[0] + P.median[1]) / 2 + rng.range(-0.5, 0.5), 'banyan', rng));
      each(11, 5, (s) => this._tree(B, s, P.right + 1.0, rng() < 0.5 ? 'luan' : 'banyan', rng));
      each(11, 5, (s) => this._tree(B, s, P.opp[0] - 1.0, 'banyan', rng));
      each(33, 10, (s) => this._streetLight(B, s, P.right + 0.5, 1, rng));
      each(33, 26, (s) => { if (!mrt) this._streetLight(B, s, (P.median[0] + P.median[1]) / 2, 1, rng, true); });
      // 機車停車格（人行道邊）
      each(14, 3, (s) => {
        const F = frameAt(R, s, P.right + 2.2, 1);
        for (let k = 0; k < 4; k++) this._parkedScooter((m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c), -k * 0.85, 0, rng);
      });
      if (mrt) this._viaduct(B, a, b, (P.median[0] + P.median[1]) / 2);
      // 公車站
      for (const ev of this.sim.events) if (ev.type === 'bus' && ev.s >= a && ev.s < b) this._busStop(B, ev.s, P.right + 2.0);
      for (let s = Math.ceil(a / 430) * 430 + 120; s < b; s += 430) if (!R.interAt(s, 10)) this._busStop(B, s, P.right + 2.0);
    } else if (sec.type === 'street') {
      each(26, 13, (s) => { if (rng() < 0.3) this._tree(B, s, P.right + 0.7, 'banyan', rng); });
      // 郵筒（紅綠一對）
      each(160, 70, (s) => {
        const F = frameAt(R, s, P.right + 0.7, 1);
        this._prop((m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c), 'mailbox_pair', mat(0, 0.16, 0));
      });
      each(70, 35, (s) => {
        const F = frameAt(R, s, P.right + 0.55, 1);
        const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
        this._prop(add, rng() < 0.5 ? 'transformer_box' : 'fire_hydrant', mat(0, 0.16, 0));
      });
      // 行人走車道：人行道被機車、變電箱擋住（規格 5.4 walker）
      for (const ev of this.sim.events) if (ev.type === 'walker' && ev.s >= a && ev.s < b) {
        for (let k = 0; k < 4; k++) {
          const F = frameAt(R, ev.s - 4 + k * 3, P.right + 1.2, 1);
          const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
          if (k === 1) this._prop(add, 'transformer_box', mat(0, 0.16, 0));
          else this._parkedScooter(add, 0, 0, rng, true);
        }
      }
    } else if (sec.type === 'market') {
      this._stalls(B, sec, a, b, rng);
    } else if (sec.type === 'highway') {
      each(38, 10, (s) => this._streetLight(B, s, P.right + 0.8, 1, rng));
      each(23, 7, (s) => { if (rng() < 0.6) this._tree(B, s, P.right + 4 + rng() * 3, rng() < 0.6 ? 'palm' : 'banyan', rng); });
      each(23, 15, (s) => { if (rng() < 0.4) this._tree(B, s, P.opp[0] - 5 - rng() * 3, 'palm', rng); });
      // 遠方電塔
      each(120, 40, (s) => this._pylon(B, s, P.right + 45 + rng() * 10));
    } else if (sec.type === 'alley') {
      each(19, 9, (s) => { if (rng() < 0.4) { const side = rng() < 0.5 ? 1 : -1; const F = frameAt(R, s, side * 3.4, side); this._pot((m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c), 0, 0.3, rng); } });
    }
  }

  _pylon(B, s, x) {
    const F = frameAt(this.route, s, x, 1);
    const add = (geo, l) => B.add('vcol', geo, F.clone().multiply(l), 0x9aa0a4);
    const h = 38;
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) add(box(0.3, h, 0.3), mat(dx * 0.5, h / 2, dz * 0.5, 0, dz * 0.03, dx * -0.03));
    for (const y of [h * 0.55, h * 0.75, h * 0.92]) add(box(12, 0.4, 0.4), mat(0, y, 0));
  }

  _viaduct(B, a, b, x) {
    const R = this.route;
    // 柱子每 32 m，梁沿路線
    for (let s = Math.ceil(a / 32) * 32; s < b; s += 32) {
      const F = frameAt(R, s, x, 1);
      B.add('vcol', box(1.8, 9, 1.8), F.clone().multiply(mat(0, 4.5, 0)), 0xc9c5bc);
      B.add('vcol', box(7, 1.2, 2.2), F.clone().multiply(mat(0, 9.0, 0)), 0xc9c5bc);
    }
    B.add('concrete', ribbon(R, a, b, x - 4, x + 4, 9.6, { step: 4 }), null, 0xcfcbc2);
    const under = ribbon(R, a, b, x - 3, x + 3, 9.6 - 1.4, { step: 4 });
    flipY(under);
    B.add('concrete', under, null, 0xa9a59c);
    B.add('concrete', wallRibbon(R, a, b, x - 3, 8.2, 9.6, -1, { step: 4 }), null, 0xbab6ad);
    B.add('concrete', wallRibbon(R, a, b, x + 3, 8.2, 9.6, 1, { step: 4 }), null, 0xbab6ad);
    B.add('concrete', wallRibbon(R, a, b, x - 4, 9.6, 10.6, -1, { step: 4 }), null, 0xd6d2c9);
    B.add('concrete', wallRibbon(R, a, b, x + 4, 9.6, 10.6, 1, { step: 4 }), null, 0xd6d2c9);
  }

  _busStop(B, s, x) {
    const F = frameAt(this.route, s, x, 1);
    const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
    this._prop(add, 'bus_shelter', mat(0, 0.16, -0.6));
  }

  _stalls(B, sec, a, b, rng) {
    const R = this.route, P = PROFILES.market;
    for (const side of [1, -1]) {
      for (let s = Math.ceil(a / 3.6) * 3.6; s < b; s += 3.6) {
        if (R.interAt(s, 2)) continue;
        const r2 = makeRng(hashStr(`st:${this.level.id}:${s.toFixed(1)}:${side}`));
        if (r2() < 0.12) continue;
        const F = frameAt(R, s, side * (P.right + 0.15), side);
        const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
        // 攤車：不鏽鋼台＋遮棚＋燈泡
        this._prop(add, 'stall_cart', mat(0, 0.1, -0.75, r2.range(-0.05, 0.05)), 'bulb');
        for (let k = 0; k < 4; k++) add('vcol', box(0.4, 0.15, 0.35), mat(-1 + k * 0.65, 1.12, -0.7), r2.pick([0xc8742a, 0xe8d0a0, 0xa83a20, 0xf0e8d0, 0x5a8a3a]));
        add('sign', quad(2.4, 0.42, this.T.signH[r2.int(0, 11)]), mat(0, 2.05, 0.0));
        if (this.night > 0.2) add('glow', quad(4.5, 4.5), mat(0, 0.12, 0.6, 0, -Math.PI / 2));
      }
    }
    // 跨街的燈泡串
    for (let s = Math.ceil(a / 7) * 7; s < b; s += 7) {
      const A = R.toWorld(s, P.left - 0.3, {}), C = R.toWorld(s + 1.5, P.right + 0.3, {});
      const pts = [];
      for (let j = 0; j <= 10; j++) { const t = j / 10; pts.push(new THREE.Vector3(A.wx + (C.wx - A.wx) * t, 4.6 - 0.7 * 4 * t * (1 - t), A.wz + (C.wz - A.wz) * t)); }
      B.add('wire', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.012, 3, false));
      for (let j = 1; j < 10; j++) {
        const p = pts[j];
        const m = new THREE.Matrix4().makeTranslation(p.x, p.y - 0.12, p.z);
        B.add(j % 3 === 0 ? 'lantern' : 'bulb', new THREE.SphereGeometry(j % 3 === 0 ? 0.2 : 0.08, 8, 6), m);
      }
    }
    // 夜市牌樓（路段起點）
    if (sec.s0 >= a - 0.01 && sec.s0 < b) this._gate(B, sec.s0 + 6);
  }

  _gate(B, s) {
    const P = PROFILES.market;
    const F = frameAt(this.route, s, 0, -1); // ex＝+f，ez＝+r
    const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
    for (const z of [P.right + 0.5, P.left - 0.5]) add('vcol', box(0.7, 7.5, 0.7), mat(0, 3.75, z), 0xb3261e);
    add('vcol', box(0.9, 1.6, P.right - P.left + 2.2), mat(0, 7.2, 0), 0xb3261e);
    add('vcol', box(1.2, 0.3, P.right - P.left + 3), mat(0, 8.15, 0), 0x2d7a4a);
    const t = this._textTex(DESTS[this.level.dest]?.kind === 'marketgate' ? DESTS[this.level.dest].sign : '小麥夜市', '#ffe08a', '#b3261e', 1024, 192);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.2), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.3 + this.night * 1.2 }));
    const sm = this.route.sample(s, {});
    m.position.set(sm.x, 7.2, sm.z);
    m.rotation.y = sm.th + Math.PI;
    m.position.x -= sm.fx * 0.5; m.position.z -= sm.fz * 0.5;
    m.userData.ownMat = true;
    this._pending = this._pending || [];
    this._pendingGroupAdd(m);
  }

  _pendingGroupAdd(obj) {
    // 加到目前正在建的區塊：由 _buildChunk 結尾收（簡化：直接加到 root，跟著最近的區塊回收）
    const i = Math.floor(this.route.sample ? 0 : 0);
    obj.userData.ownMat = true;
    this._extra = obj;
    if (this._curChunk) this._curChunk.add(obj); else this.root.add(obj);
  }

  _textTex(text, fg, bg, w = 1024, h = 256, font = SERIF) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = h * 0.62;
    g.font = `900 ${fs}px ${font}`;
    while (g.measureText(text).width > w * 0.86 && fs > 20) { fs -= 4; g.font = `900 ${fs}px ${font}`; }
    g.fillText(text, w / 2, h / 2 + 4);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  // 目的地建築（規格 6.4）
  _dest(B, g, lot) {
    const info = DESTS[this.level.dest];
    const P = PROFILES[lot.type];
    const side = 1, w = lot.w;
    const fx = lot.type === 'highway' ? P.right + 8 : P.facadeR + (lot.type === 'avenue' ? 4 : 2);
    const F = frameAt(this.route, lot.s0 + w / 2, fx, side);
    const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
    const kind = info.kind;
    let signY = 9, signW = 16, signFg = '#ffffff', signBg = '#c8102e';
    if (kind === 'temple') {
      this._templeBody(add, 16, 1.2);
      signY = 8.5; signW = 8; signFg = '#ffe08a'; signBg = '#1a3a7a';
    } else if (kind === 'house' || kind === 'sanheyuan' || kind === 'garbage' || kind === 'stall') {
      if (kind === 'sanheyuan') {
        // 三合院：紅磚、燕尾、左右護龍
        add('vcol', box(14, 4.2, 6), mat(0, 2.1, -12), 0xa8452e);
        add('vcol', box(5, 3.6, 12), mat(-9, 1.8, -6), 0xa8452e);
        add('vcol', box(5, 3.6, 12), mat(9, 1.8, -6), 0xa8452e);
        add('vcol', box(15, 0.4, 7.4), mat(0, 4.4, -12, 0, 0), 0x6a5a4a);
        add('floor', box(14, 0.05, 12, { faces: ['py'], uvScale: 2 }), mat(0, 0.03, -3));
        signY = 5.6; signW = 6; signFg = '#ffe08a'; signBg = '#7a1f0f';
      } else if (kind === 'stall') {
        add('metal', box(3.2, 1.0, 1.4), mat(0, 0.5, 0.5));
        add('stripe', box(4, 0.04, 2.4, { faces: ['py', 'ny'] }), mat(0, 2.6, 0.5, 0, 0.15));
        add('bulb', new THREE.SphereGeometry(0.12, 8, 6), mat(0, 2.2, 0.5));
        signY = 3.3; signW = 4; signBg = '#ffd400'; signFg = '#c8102e';
      } else {
        const cell = this.T.facadeCells[3];
        for (let f = 0; f < 3; f++) add('facade', quad(6, 3.15, cell), mat(0, 3.3 + f * 3.15 + 1.575, 0));
        add('shop', quad(6, 3.3, this.T.shopCells[0].uv), mat(0, 1.65, 0.01));
        add('wall', box(6, 12.75, 10, { faces: ['px', 'nx', 'py'], uvScale: 3 }), mat(0, 6.375, -5));
        signY = 4.2; signW = 4.5; signBg = '#ffffff'; signFg = '#c8102e';
        if (kind === 'garbage') { signW = 0.01; }
      }
    } else {
      // 大型建築：醫院、學校、車站、場館、公司、銀行…
      const h = kind === 'office' || kind === 'hospital' || kind === 'bank' ? 30 : kind === 'arena' ? 18 : 14;
      const d = 24;
      add('tower', box(w, h, d, { uvScale: 6, faces: ['px', 'nx', 'py', 'pz'] }), mat(0, h / 2, -d / 2 - 2));
      add('glass', box(w * 0.6, 4, 0.2), mat(0, 2, -1.8));
      add('vcol', box(w * 0.75, 0.4, 5), mat(0, 4.2, 0.5), 0xd8d8d2);
      if (kind === 'hospital' || kind === 'vet') {
        // 紅十字
        add('lantern', box(3, 0.9, 0.3), mat(w / 2 - 3, h - 3, -1.6));
        add('lantern', box(0.9, 3, 0.3), mat(w / 2 - 3, h - 3, -1.6));
        signBg = '#c8102e';
      } else if (kind === 'school') {
        add('vcol', box(1.2, 3.2, 1.2), mat(-5, 1.6, 2), 0xb0a89a);
        add('vcol', box(1.2, 3.2, 1.2), mat(5, 1.6, 2), 0xb0a89a);
        signBg = '#ffffff'; signFg = '#1a3a7a';
      } else if (kind === 'station' || kind === 'mrt') { signBg = '#1d4fa3'; }
      else if (kind === 'arena') { signBg = '#1a1a1a'; signFg = '#ffd400'; }
      else if (kind === 'plaza') { signBg = '#1a1a1a'; signFg = '#ff4fa3'; }
      else if (kind === 'marketgate') { signBg = '#b3261e'; signFg = '#ffe08a'; }
      signY = Math.min(h - 2, 9);
    }
    if (signW > 0.1) {
      const t = this._textTex(info.sign, signFg, signBg, 1024, 220, kind === 'temple' || kind === 'sanheyuan' ? SERIF : FONT);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(signW, signW * 220 / 1024), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.35 + this.night * 1.3 }));
      m.applyMatrix4(F.clone().multiply(mat(0, signY, kind === 'temple' ? 1.6 : 0.4)));
      m.userData.ownMat = true;
      this._curAdd(g, m);
    }
  }

  _curAdd(g, obj) { obj.userData.ownMat = true; g.add(obj); }

  // 終點拱門（規格 6.4）
  _finish(B, g) {
    const R = this.route, L = this.sim.L;
    const b = R.bounds(L);
    const F = frameAt(R, L, 0, -1);
    const add = (m, geo, l, c) => B.add(m, geo, F.clone().multiply(l), c);
    for (const x of [b.right + 0.6, b.left - 0.6]) add('vcol', box(0.6, 6, 0.6), mat(0, 3, x), 0xd03030);
    add('vcol', box(0.5, 1.4, b.right - b.left + 1.8), mat(0, 6.3, (b.left + b.right) / 2), 0xd03030);
    // 地上紅白格線
    for (let x = b.left, k = 0; x < b.right; x += 0.6, k++) {
      B.add(k % 2 ? 'markW' : 'markR', ribbon(R, L - 0.6, L, x, x + 0.6, 0.015, { step: 0.6 }));
      B.add(k % 2 ? 'markR' : 'markW', ribbon(R, L, L + 0.6, x, x + 0.6, 0.015, { step: 0.6 }));
    }
    const t = this._textTex('目的地：' + DESTS[this.level.dest].label, '#ffffff', '#d03030', 1024, 160, FONT);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(9, b.right - b.left + 1), 1.2), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.3 + this.night * 1.2 }));
    const sm = R.sample(L, {});
    const cx = (b.left + b.right) / 2;
    m.position.set(sm.x + sm.rx * cx - sm.fx * 0.27, 6.3, sm.z + sm.rz * cx - sm.fz * 0.27);
    m.rotation.y = sm.th + Math.PI;
    this._curAdd(g, m);
  }
}

function flipY(g) {
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setY(i, -n.getY(i));
  // 也要翻三角形順序
  const p = g.attributes.position, u = g.attributes.uv;
  for (let i = 0; i < p.count; i += 3) for (const at of [p, u]) {
    const sz = at.itemSize;
    for (let k = 0; k < sz; k++) { const t = at.array[(i + 1) * sz + k]; at.array[(i + 1) * sz + k] = at.array[(i + 2) * sz + k]; at.array[(i + 2) * sz + k] = t; }
  }
}
function tileColHex(h) { return '#' + h.toString(16).padStart(6, '0'); }
function shadeHex(h, f) { const c = new THREE.Color(h).multiplyScalar(f); return c.getHex(); }
