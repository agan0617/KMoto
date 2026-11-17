// 把模擬裡的車、人、狗、障礙同步成 3D 物件（規格 5.1、5.4、5.5、9.2）。
import * as THREE from 'three';
import { makeVehicle, makePedestrian, makeDog, makePlayerBike, makeProcessionUnit, setLights } from './vehicles.js';
import { makeRng } from '../rng.js';
import { propGeo } from './props.js';
import { flattenVehicle } from './flatten.js';

const VEH = new Set(['scooter', 'oldscooter', 'bicycle', 'car', 'taxi', 'pickup', 'bus', 'truck', 'garbage', 'campaign']);
const WHEEL_R = { campaign: 0.3, scooter: 0.25, oldscooter: 0.25, bicycle: 0.33, car: 0.32, taxi: 0.32, pickup: 0.3, bus: 0.5, truck: 0.52, garbage: 0.45 };

export class Actors {
  constructor(scene, sim, env) {
    this.scene = scene;
    this.sim = sim;
    this.route = sim.route;
    this.night = env.night;
    this.wet = sim.wet;
    this.map = new Map();
    this.pool = new Map();
    this.root = new THREE.Group();
    scene.add(this.root);
    this._s = {};
    this._mk = this._statics();
    this.blink = 0;
    // 玩家
    this.player = makePlayerBike({ passenger: sim.level.passenger || 'komugi', raincoat: sim.wet });
    this.player.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.root.add(this.player);
    this.leanA = 0; this.yawA = 0;
    // 排氣管火焰（衝刺）
    const flameMat = new THREE.MeshBasicMaterial({ color: '#7fb8ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 10, 1, true), flameMat);
    this.flame.rotation.x = -Math.PI / 2;
    this.flame.position.z = -0.25;
    this.flame.visible = false;
    this.player.userData.exhaust.add(this.flame);
    // 玩家頭燈（夜晚、雨天）
    if (this.night > 0.3 || this.wet) {
      const spot = new THREE.SpotLight('#fff3dc', 60, 70, 0.42, 0.55, 1.4);
      spot.position.set(0, 1.0, 0.7);
      spot.target.position.set(0, 0, 18);
      this.player.add(spot); this.player.add(spot.target);
      this.headlight = spot;
    }
    setLights(this.player, { head: this.night > 0.3 || this.wet, tail: true });
  }

  _statics() {
    const M = {
      cone: new THREE.MeshStandardMaterial({ color: '#ff5a1a', roughness: 0.55 }),
      white: new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.5, emissive: '#ffffff', emissiveIntensity: this.night * 0.25 }),
      black: new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.8 }),
      hole: new THREE.MeshStandardMaterial({ color: '#1d1c1a', roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 }),
      holeRim: new THREE.MeshStandardMaterial({ color: '#3a3733', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
      puddle: new THREE.MeshStandardMaterial({ color: '#2a3138', roughness: 0.04, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, transparent: true, opacity: 0.88 }),
      manhole: new THREE.MeshStandardMaterial({ color: '#4a4844', roughness: this.wet ? 0.2 : 0.6, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 }),
      box: new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: 0.9 }),
      bag: new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.35 }),
      barrier: new THREE.MeshStandardMaterial({ color: '#f1f1ec', roughness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: '#d02a22', roughness: 0.6 }),
      yellowLamp: new THREE.MeshStandardMaterial({ color: '#ffcc22', emissive: '#ffb000', emissiveIntensity: 0 }),
      signBoard: new THREE.MeshStandardMaterial({ color: '#f2d64a', roughness: 0.6 }),
      vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
      smoke: new THREE.MeshBasicMaterial({ color: '#d8d4cc', transparent: true, opacity: 0.35, depthWrite: false }),
    };
    this.M = M;
    return {
      cone: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(propGeo('cone'), M.vcol)); return g; },
      barrier: () => {
        // Blender 圍籬＋頂上的黃色閃燈（物件 +Z 朝路，圍籬要沿著路：轉 90°）
        const g = new THREE.Group();
        const body = new THREE.Mesh(propGeo('barrier'), M.vcol); body.rotation.y = Math.PI / 2; g.add(body);
        const lampM = new THREE.Mesh(propGeo('barrier__glow'), M.yellowLamp); lampM.rotation.y = Math.PI / 2; g.add(lampM);
        g.userData.lamp = lampM;
        return g;
      },
      barrierOld: () => {
        const g = new THREE.Group();
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), M.black);
        for (const x of [-0.95, 0.95]) { const q = p.clone(); q.position.set(0, 0.55, x); g.add(q); }
        for (let k = 0; k < 4; k++) {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.47), k % 2 ? M.red : M.barrier);
          panel.position.set(0, 0.8, -0.71 + k * 0.47); g.add(panel);
          const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.47), k % 2 ? M.barrier : M.red);
          p2.position.set(0, 0.45, -0.71 + k * 0.47); g.add(p2);
        }
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), M.yellowLamp); lamp.position.set(0, 1.18, 0.9); g.add(lamp);
        g.userData.lamp = lamp;
        return g;
      },
      pothole: () => {
        const g = new THREE.Group();
        const rim = new THREE.Mesh(new THREE.CircleGeometry(0.62, 9), M.holeRim); rim.rotation.x = -Math.PI / 2; rim.position.y = 0.012; g.add(rim);
        const h = new THREE.Mesh(new THREE.CircleGeometry(0.48, 8), M.hole); h.rotation.x = -Math.PI / 2; h.position.y = 0.016; h.scale.set(1, 0.8, 1); g.add(h);
        return g;
      },
      puddle: () => { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 20), M.puddle); m.rotation.x = -Math.PI / 2; m.position.y = 0.014; m.scale.set(0.9, 1.5, 1); const g = new THREE.Group(); g.add(m); return g; },
      bump: () => {
        // 凸起的人孔蓋＋周圍的補丁柏油
        const g = new THREE.Group();
        const patch = new THREE.Mesh(new THREE.CircleGeometry(0.9, 7), M.holeRim); patch.rotation.x = -Math.PI / 2; patch.position.y = 0.012; patch.scale.set(1.2, 0.9, 1); g.add(patch);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.07, 20), M.manhole); lid.position.y = 0.035; g.add(lid);
        return g;
      },
      manhole: () => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.4, 18), M.manhole); m.rotation.x = -Math.PI / 2; m.position.y = 0.013; const g = new THREE.Group(); g.add(m); return g; },
      box: () => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.5), M.box); m.position.y = 0.21; g.add(m); return g; },
      bag: () => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), M.bag); m.scale.set(1, 0.85, 1); m.position.y = 0.25; g.add(m); return g; },
      sign: () => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.0), M.signBoard); m.position.y = 0.08; m.rotation.z = 0.08; g.add(m); return g; },
    };
  }

  _make(e) {
    let o;
    const key = e.kind === 'proc' ? 'proc_' + e.unit : e.kind;
    const pl = this.pool.get(key);
    if (pl && pl.length && !VEH.has(e.kind) && e.kind !== 'ped' && e.kind !== 'dog' && e.kind !== 'proc') o = pl.pop();
    if (!o) {
      if (VEH.has(e.kind)) o = makeVehicle(e.kind, { seed: e.seed, rider: !e.parked, raincoat: this.wet && (e.seed % 3 === 0), cargo: e.cargo });
      else if (e.kind === 'ped') o = makePedestrian({ seed: e.seed, phone: !!e.phone, bag: !!e.bag, raincoat: this.wet && e.seed % 2 === 0, umbrella: this.wet && e.seed % 2 === 1 });
      else if (e.kind === 'dog') o = makeDog({ seed: e.seed });
      else if (e.kind === 'proc') o = makeProcessionUnit(e.unit, { seed: e.seed });
      else if (e.kind === 'fallen') { o = new THREE.Group(); const v = makeVehicle('scooter', { seed: e.seed, rider: false }); v.rotation.z = Math.PI / 2 - 0.15; v.position.y = 0.38; o.add(v); }
      else if (this._mk[e.kind]) o = this._mk[e.kind]();
      else return null;
      if (VEH.has(e.kind) || e.kind === 'ped' || e.kind === 'dog' || e.kind === 'proc') flattenVehicle(o);
      o.traverse((c) => { if (c.isMesh) { c.castShadow = !['pothole', 'puddle', 'manhole', 'bump'].includes(e.kind); c.receiveShadow = true; } });
    }
    o.userData.key = key;
    o.visible = true;
    o.rotation.set(0, 0, 0);
    o.position.set(0, 0, 0);
    if (VEH.has(e.kind)) {
      const on = this.night > 0.3 || this.wet;
      setLights(o, { head: on, tail: on, brake: false, blinkL: false, blinkR: false, roof: on });
    }
    this.root.add(o);
    return o;
  }

  _release(o) {
    this.root.remove(o);
    const k = o.userData.key;
    if (!this.pool.has(k)) this.pool.set(k, []);
    const pl = this.pool.get(k);
    if (pl.length < 30) pl.push(o);
  }

  update(dt) {
    const sim = this.sim, p = sim.player, R = this.route;
    this.blink += dt;
    const blinkOn = (this.blink % 0.7) < 0.38;
    const lo = p.s - 60, hi = p.s + 330;
    const seen = new Set();
    const tmp = this._s;
    for (const e of sim.ents) {
      if (e.dead || e.s < lo || e.s > hi) continue;
      if (e.kind === 'manhole' && false) continue;
      let rec = this.map.get(e.id);
      if (!rec) {
        const o = this._make(e);
        if (!o) continue;
        rec = { o, e, wheelA: 0, walk: Math.random() * 6, knock: null };
        this.map.set(e.id, rec);
      }
      seen.add(e.id);
      const o = rec.o;
      const near = Math.abs(e.s - p.s) < 70;
      if (rec.near !== near) { rec.near = near; o.traverse((c) => { if (c.isMesh && !['pothole', 'puddle', 'manhole', 'bump'].includes(e.kind)) c.castShadow = near; }); }
      const x = e.xDraw ?? e.x;
      R.toWorld(e.s, x, tmp);
      o.position.set(tmp.wx, 0, tmp.wz);
      o.rotation.y = tmp.th - (e.ang || 0);
      if (VEH.has(e.kind)) {
        const ud = o.userData;
        const r = WHEEL_R[e.kind] || 0.3;
        rec.wheelA += (e.sideways || e.cross ? e.v : e.v) * dt / r;
        if (ud.wheels) for (const w of ud.wheels) w.rotation.x = rec.wheelA;
        if (ud.frontSteer) ud.frontSteer.rotation.y = (e.wobble || 0) * 0.3;
        const hz = e.lights.hazard && blinkOn;
        if (e.drugged) setLights(o, { head: e.lights.head > 0.5 ? 2 : 0.2 });
        setLights(o, {
          brake: !!e.lights.brake,
          blinkL: (e.lights.blinkL && blinkOn) || hz,
          blinkR: hz,
        });
        if (ud.doorFL) ud.doorFL.rotation.y = (ud.doorOpenSign ?? -1) * 1.05 * (e.lights.door || 0);
        // 機車隨橫移傾斜
        if (e.kind === 'scooter' || e.kind === 'oldscooter' || e.kind === 'bicycle') {
          const tl = (e.wobble ? Math.cos(sim.clock * 2) * 0.12 : 0) + (e.tx != null ? Math.max(-0.25, Math.min(0.25, (e.tx - e.x) * 0.2)) : 0);
          o.rotation.z = -tl * (e.dir || 1);
        }
        if (e.touched && e.v < 0.5 && e.moving) o.rotation.z = 0;
      } else if (e.kind === 'ped' || e.kind === 'dog') {
        const ud = o.userData;
        const moving = e.walking || (e.wander) || (e.chase);
        if (moving) rec.walk += dt * (e.kind === 'dog' ? 14 : 7);
        const sw = moving ? Math.sin(rec.walk) * (e.kind === 'dog' ? 0.7 : 0.5) : 0;
        if (e.kind === 'dog') { if (ud.legs) ud.legs.forEach((l, i) => { l.rotation.x = (i % 2 ? sw : -sw); }); }
        else {
          if (ud.legL) ud.legL.rotation.x = sw; if (ud.legR) ud.legR.rotation.x = -sw;
          if (ud.armL) ud.armL.rotation.x = -sw * 0.7;
          if (ud.armR && !e.phone) ud.armR.rotation.x = e.waver ? -2.6 + Math.sin(sim.clock * 6) * 0.3 : sw * 0.7;
        }
        // 走路方向
        if (e.ev && (e.ev.type === 'ped' || e.ev.type === 'dogs') && e.crossDir) o.rotation.y = tmp.th + (e.crossDir > 0 ? -Math.PI / 2 : Math.PI / 2);
        if (e.waver || e.deco) o.rotation.y = tmp.th + (x > 0 ? Math.PI / 2 : -Math.PI / 2);
        if (e.chase) o.rotation.y = tmp.th + (e.v < 0 ? Math.PI : 0);
        if (e.wander) o.rotation.y = tmp.th + (e.dir > 0 ? 0 : Math.PI);
      } else if (e.kind === 'proc') {
        const ud = o.userData;
        rec.walk += dt * 5;
        if (ud.people) ud.people.forEach((pp, i) => { const s = Math.sin(rec.walk + i) * 0.4; if (pp.userData.legL) { pp.userData.legL.rotation.x = s; pp.userData.legR.rotation.x = -s; } });
        o.position.y = e.unit === 'palanquin' ? Math.abs(Math.sin(rec.walk * 0.5)) * 0.12 : 0;
        o.rotation.z = e.unit === 'palanquin' ? Math.sin(rec.walk * 0.5) * 0.05 : 0;
      } else if (e.kind === 'barrier') {
        o.userData.lamp.material = this.M.yellowLamp;
        this.M.yellowLamp.emissiveIntensity = (sim.clock % 0.8) < 0.4 ? 3 : 0.1;
        o.rotation.y = tmp.th;
      }
      // 被撞飛的小東西
      if (e.knocked) {
        if (!rec.knock) rec.knock = { t: 0, vy: 4 + Math.random() * 2, vs: Math.max(6, e.knockV * 0.8), vx: (Math.random() - 0.5) * 4, spin: (Math.random() - 0.5) * 14 };
        const k = rec.knock;
        k.t += dt;
        const ds = k.vs * Math.min(k.t, 1.2);
        R.toWorld(e.s + ds, x + k.vx * Math.min(k.t, 1.2), tmp);
        o.position.set(tmp.wx, Math.max(0, k.vy * k.t - 4.9 * k.t * k.t), tmp.wz);
        o.rotation.x = k.spin * Math.min(k.t, 1.2); o.rotation.z = k.spin * 0.6 * Math.min(k.t, 1.2);
      }
    }
    for (const [id, rec] of this.map) {
      if (!seen.has(id)) { this._release(rec.o); this.map.delete(id); }
    }
    this._updatePlayer(dt, blinkOn);
  }

  _updatePlayer(dt, blinkOn) {
    const sim = this.sim, p = sim.player, R = this.route, o = this.player, ud = o.userData;
    R.toWorld(p.s, p.x, this._s);
    o.position.set(this._s.wx, 0, this._s.wz);
    // 傾車：依橫向速度（右傾＝lean.rotation.z 為正）
    let leanT = Math.max(-0.62, Math.min(0.62, (p.vx + p.wind) / 8 * 0.62));
    let yaw = p.ang;
    if (p.crash) {
      const t = p.crash.t;
      const dir = p.vx >= 0 ? 1 : -1;
      leanT = dir * Math.min(1.45, t * 6);
      yaw = p.ang + dir * Math.min(1.2, t * 2.5);
      ud.rider.position.y = -Math.min(0.5, t * 1.2);
    } else ud.rider.position.y = 0;
    this.leanA += (leanT - this.leanA) * Math.min(1, dt * (p.crash ? 20 : 9));
    ud.lean.rotation.z = this.leanA;
    this.yawA += (yaw - this.yawA) * Math.min(1, dt * 12);
    o.rotation.y = this._s.th - this.yawA;
    ud.steer.rotation.y = -p.steer * 0.18;
    const wa = p.v * dt / 0.255;
    for (const w of ud.wheels) w.rotation.x += wa;
    // 無敵閃爍
    o.visible = !(p.invuln > 0 && (sim.clock * 10) % 1 < 0.45);
    // 衝刺火焰
    this.flame.visible = p.boostT > 0 && !p.crash;
    if (this.flame.visible) { const s = 0.9 + Math.random() * 0.5; this.flame.scale.set(1, s, 1); }
    setLights(o, { brake: p.brake || p.crash });
  }

  dispose() {
    this.scene.remove(this.root);
  }
}
