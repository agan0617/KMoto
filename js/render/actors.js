// 把模擬裡的車、人、狗、障礙同步成 3D 物件（規格 5.1、5.4、5.5、9.2）。
import * as THREE from 'three';
import { makeVehicle, makePedestrian, makeDog, makePlayerBike, makeProcessionUnit, setLights } from './vehicles.js';
import { makeRng } from '../rng.js';
import { propGeo } from './props.js';
import { flattenVehicle } from './flatten.js';
import { TUNING } from '../tuning.js';

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
    this.fly = null; this.flyPos = null;
    this._makeSpray();
  }

  // 水花粒子（積水打滑，規格 5.5、9.2）
  _makeSpray() {
    const N = 90;
    const g = new THREE.BufferGeometry();
    this.sprayPos = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3));
    const m = new THREE.PointsMaterial({ color: '#dbe8f2', size: 0.09, transparent: true, opacity: 0.85, depthWrite: false });
    this.spray = new THREE.Points(g, m);
    this.spray.frustumCulled = false;
    this.root.add(this.spray);
    this.drops = Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(0, -10, 0), v: new THREE.Vector3() }));
    this._dropI = 0;
  }

  _emit(n, big) {
    const o = this.player, sm = this.sim.player.R.sample(this.sim.player.s, {});
    const v = this.sim.player.v;
    for (let k = 0; k < n; k++) {
      const d = this.drops[this._dropI++ % this.drops.length];
      d.life = 0.5 + Math.random() * 0.4;
      const side = Math.random() < 0.5 ? -1 : 1;
      d.p.set(o.position.x - sm.fx * 0.6 + sm.rx * side * 0.15, 0.08, o.position.z - sm.fz * 0.6 + sm.rz * side * 0.15);
      const out = (big ? 3 : 1.6) * (0.5 + Math.random());
      d.v.set(sm.fx * v * 0.55 + sm.rx * side * out, (big ? 2.6 : 1.4) * (0.6 + Math.random()), sm.fz * v * 0.55 + sm.rz * side * out);
    }
  }

  splash() { this._emit(60, true); }

  _updateSpray(dt) {
    const a = this.sprayPos;
    this.drops.forEach((d, i) => {
      if (d.life > 0) {
        d.life -= dt;
        d.v.y -= 9.8 * dt;
        d.p.addScaledVector(d.v, dt);
        if (d.p.y < 0) d.life = 0;
      }
      const vis = d.life > 0;
      a[i * 3] = d.p.x; a[i * 3 + 1] = vis ? d.p.y : -50; a[i * 3 + 2] = d.p.z;
    });
    this.spray.geometry.attributes.position.needsUpdate = true;
  }

  // 摔車：騎士與 Komugi 飛出去（規格 4.7）
  _startFly(p) {
    const ud = this.player.userData;
    this.player.updateMatrixWorld(true);
    const sm = p.R.sample(p.s, {});
    const f = new THREE.Vector3(sm.fx, 0, sm.fz), r = new THREE.Vector3(sm.rx, 0, sm.rz);
    const v0 = Math.max(4, (p.crash.v0 || p.v) * 0.7);
    const vy = Math.min(7, 2.5 + (p.crash.v0 || p.v) * 0.12);
    const side = p.crash.side || 1;
    const bodies = [];
    const add = (node, k) => {
      if (!node) return;
      const pivot = new THREE.Group();
      pivot.position.copy(node.localToWorld(new THREE.Vector3(0, k.cy, k.cz)));
      this.root.add(pivot);
      const orig = { parent: node.parent, pos: node.position.clone(), quat: node.quaternion.clone(), scale: node.scale.clone() };
      pivot.attach(node);
      const vel = f.clone().multiplyScalar(v0 * k.v).addScaledVector(r, side * k.lat);
      vel.y = vy * k.vy;
      bodies.push({ node, pivot, orig, vel, spin: -9.4 * k.spin, roll: (Math.random() - 0.5) * 3, ground: k.ground, f: f.clone(), r: r.clone(), landed: false, rider: k.rider });
    };
    add(ud.rider, { cy: 1.1, cz: -0.25, v: 1, vy: 1, lat: 1.2, spin: 1, ground: 0.32, rider: true });
    add(ud.komugi, { cy: 0.2, cz: 0, v: 0.75, vy: 0.7, lat: -1.0, spin: 1.4, ground: 0.14 });
    this.fly = { bodies };
  }

  _stepFly(dt) {
    for (const b of this.fly.bodies) {
      b.vel.y -= 9.8 * dt;
      b.pivot.position.addScaledVector(b.vel, dt);
      if (b.pivot.position.y < b.ground) {
        b.pivot.position.y = b.ground;
        if (b.vel.y < -1.5) {
          b.vel.y = -b.vel.y * 0.3;
          if (!b.landed && b.rider && this.onLand) this.onLand();
          b.landed = true;
        } else b.vel.y = 0;
      }
      if (b.pivot.position.y <= b.ground + 0.02) {
        // 在地上翻滾滑行：每秒剩 5%
        const fr = Math.pow(0.05, dt);
        b.vel.x *= fr; b.vel.z *= fr;
        b.spin *= Math.pow(0.12, dt); b.roll *= Math.pow(0.12, dt);
      }
      b.pivot.rotateOnWorldAxis(b.r, b.spin * dt);
      b.pivot.rotateOnWorldAxis(b.f, b.roll * dt);
      if (b.rider) this.flyPos = b.pivot.position;
    }
  }

  _endFly() {
    for (const b of this.fly.bodies) {
      b.orig.parent.add(b.node);
      b.node.position.copy(b.orig.pos); b.node.quaternion.copy(b.orig.quat); b.node.scale.copy(b.orig.scale);
      this.root.remove(b.pivot);
    }
    this.fly = null; this.flyPos = null;
  }

  // 積水：不規則的大片水面（晴天外圍多一圈濕痕）
  _puddle(e) {
    const g = new THREE.Group();
    const ph = (e.shape || 0) * 6.28;
    const outline = (k) => {
      const sh = new THREE.Shape();
      const N = 30;
      for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2;
        const rr = k * (1 + 0.16 * Math.sin(3 * a + ph) + 0.09 * Math.sin(5 * a + ph * 2.3) + 0.05 * Math.sin(9 * a + ph * 0.7));
        const x = Math.cos(a) * rr * e.wid / 2, y = Math.sin(a) * rr * e.len / 2;
        if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
      }
      return new THREE.ShapeGeometry(sh, 2);
    };
    const M = this.M;
    if (e.dry) {
      const ring = new THREE.Mesh(outline(1.25), M.wetRing); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.011; g.add(ring);
    }
    const m = new THREE.Mesh(outline(1), M.puddle); m.rotation.x = -Math.PI / 2; m.position.y = 0.014; g.add(m);
    g.userData.ownGeo = true;
    return g;
  }

  _statics() {
    const M = {
      cone: new THREE.MeshStandardMaterial({ color: '#ff5a1a', roughness: 0.55 }),
      white: new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.5, emissive: '#ffffff', emissiveIntensity: this.night * 0.25 }),
      black: new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.8 }),
      hole: new THREE.MeshStandardMaterial({ color: '#1d1c1a', roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 }),
      holeRim: new THREE.MeshStandardMaterial({ color: '#3a3733', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
      puddle: new THREE.MeshStandardMaterial({ color: '#56677a', roughness: 0.02, metalness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, transparent: true, opacity: 0.9 }),
      wetRing: new THREE.MeshStandardMaterial({ color: '#2e2d2b', roughness: 0.35, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, transparent: true, opacity: 0.55 }),
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
    if (pl && pl.length && !VEH.has(e.kind) && e.kind !== 'ped' && e.kind !== 'dog' && e.kind !== 'proc' && e.kind !== 'puddle') o = pl.pop();
    if (!o) {
      if (VEH.has(e.kind)) o = makeVehicle(e.kind, { seed: e.seed, rider: !e.parked, raincoat: this.wet && (e.seed % 3 === 0), cargo: e.cargo });
      else if (e.kind === 'ped') o = makePedestrian({ seed: e.seed, phone: !!e.phone, bag: !!e.bag, raincoat: this.wet && e.seed % 2 === 0, umbrella: this.wet && e.seed % 2 === 1 });
      else if (e.kind === 'dog') o = makeDog({ seed: e.seed });
      else if (e.kind === 'proc') o = makeProcessionUnit(e.unit, { seed: e.seed });
      else if (e.kind === 'fallen') { o = new THREE.Group(); const v = makeVehicle('scooter', { seed: e.seed, rider: false }); v.rotation.z = Math.PI / 2 - 0.15; v.position.y = 0.38; o.add(v); }
      else if (e.kind === 'puddle') o = this._puddle(e);
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
    if (o.userData.ownGeo) { o.traverse((c) => { if (c.isMesh) c.geometry.dispose(); }); return; }
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
      const Re = e.R || R;
      Re.toWorld(e.s, x, tmp);
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
        Re.toWorld(e.s + ds, x + k.vx * Math.min(k.t, 1.2), tmp);
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
    const sim = this.sim, p = sim.player, R = p.R, o = this.player, ud = o.userData;
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
    }
    // 積水打滑：車身左右晃、輪後噴水（規格 9.2）
    if (p.slipT > 0 && !p.crash) {
      leanT += Math.sin(sim.clock * 17) * 0.2 * Math.min(1, p.slipT / TUNING.slipAfter);
      if (p.slipT >= TUNING.slipAfter - 0.02 && p.v > 3 && dt > 0) this._emit(2, false);
    }
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
    // 騎士飛出去（位置要在機車擺好之後才取）
    if (p.crash && !this.fly && dt > 0) this._startFly(p);
    else if (!p.crash && this.fly) this._endFly();
    if (this.fly && dt > 0) this._stepFly(dt);
    this._updateSpray(dt);
  }

  dispose() {
    this.scene.remove(this.root);
  }
}
