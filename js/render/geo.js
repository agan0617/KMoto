// 幾何工具：把一個區塊的街景依材質收集、合併成少數幾個網格（規格 10.1）。
// 每個幾何都帶 position／normal／uv／color 四種屬性，才能合併；顏色＝頂點色（貼圖材質用白色＝不染色）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

export function prep(geo, color = 0xffffff) {
  if (geo.index) geo = geo.toNonIndexed();
  const n = geo.attributes.position.count;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.color) {
    _c.set(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  }
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

export class Bucket {
  constructor() { this.map = new Map(); }
  add(mat, geo, matrix, color) {
    geo = prep(geo, color);
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
    return geo;
  }
  // 依材質合併成 Mesh，加到 group
  build(group, mats, { shadows = true } = {}) {
    for (const [key, list] of this.map) {
      if (!list.length) continue;
      const mat = mats[key];
      if (!mat) { console.warn('no material', key); continue; }
      const g = mergeGeometries(list, false);
      for (const l of list) l.dispose();
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadows && !mat.userData.noCast;
      m.receiveShadow = !mat.userData.noReceive;
      m.matrixAutoUpdate = false;
      m.userData.key = key;
      group.add(m);
    }
    this.map.clear();
  }
}

// 盒子：UV 依公尺（uvScale＝每幾公尺一次重複）；或指定某一面用圖集格子
// faces：哪幾面要（px nx py ny pz nz），預設全部
export function box(w, h, d, { uvScale = 1, faces = null, uvRect = null, rectFace = 'pz' } = {}) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const pos = [], nor = [], uv = [];
  const F = {
    px: [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], [1, 0, 0], d, h],
    nx: [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], [-1, 0, 0], d, h],
    py: [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd], [0, 1, 0], w, d],
    ny: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd], [0, -1, 0], w, d],
    pz: [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], [0, 0, 1], w, h],
    nz: [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], [0, 0, -1], w, h],
  };
  for (const k of Object.keys(F)) {
    if (faces && !faces.includes(k)) continue;
    const [a, b, c, dd, n, uw, vh] = F[k];
    let u0 = 0, v0 = 0, u1 = uw / uvScale, v1 = vh / uvScale;
    if (uvRect && k === rectFace) [u0, v0, u1, v1] = uvRect;
    const quad = [[a, u0, v0], [b, u1, v0], [c, u1, v1], [a, u0, v0], [c, u1, v1], [dd, u0, v1]];
    for (const [p, u, v] of quad) { pos.push(...p); nor.push(...n); uv.push(u, v); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// 平面（在 XY 平面、面向 +Z），uvRect＝[u0,v0,u1,v1]
export function quad(w, h, uvRect = [0, 0, 1, 1]) {
  const [u0, v0, u1, v1] = uvRect;
  const hw = w / 2, hh = h / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, -hh, 0, hw, hh, 0, -hw, hh, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], 2));
  return g;
}

export function cyl(rt, rb, h, seg = 8, open = false) {
  return new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
// 局部矩陣：位置＋歐拉角（YXZ）
export function mat(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _v.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_v, _q, _s);
}

// 沿 s 的帶狀面（路面、人行道）：xa→xb、高 y；UV 以公尺計
export function ribbon(route, s0, s1, xa, xb, y, { step = 2, uvScale = 4, uvRot = false, uOff = 0 } = {}) {
  const pos = [], nor = [], uv = [];
  const p = {}, q = {};
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i < n; i++) {
    const sa = s0 + (s1 - s0) * i / n, sb = s0 + (s1 - s0) * (i + 1) / n;
    const A = route.toWorld(sa, xa, {}), B = route.toWorld(sa, xb, {}), C = route.toWorld(sb, xb, {}), D = route.toWorld(sb, xa, {});
    const pts = [A, B, C, A, C, D];
    const uvs = uvRot
      ? [[sa, xa], [sa, xb], [sb, xb], [sa, xa], [sb, xb], [sb, xa]]
      : [[xa, sa], [xb, sa], [xb, sb], [xa, sa], [xb, sb], [xa, sb]];
    // 法線朝上；三角形順序：xa→xb 是往右，s 往前；A,B,C 逆時針（從上看）？檢查：右手座標、Y 朝上
    for (let k = 0; k < 6; k++) {
      pos.push(pts[k].wx, y, pts[k].wz); nor.push(0, 1, 0);
      uv.push((uvs[k][0] + uOff) / uvScale, uvs[k][1] / uvScale);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fixWinding(g);
  return g;
}

// 沿 s 的直立面（路緣石側面）：x 固定、y0→y1，面向 facing（+1 朝 +x）
export function wallRibbon(route, s0, s1, x, y0, y1, facing, { step = 2, uvScale = 2 } = {}) {
  const pos = [], uv = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i < n; i++) {
    const sa = s0 + (s1 - s0) * i / n, sb = s0 + (s1 - s0) * (i + 1) / n;
    const A = route.toWorld(sa, x, {}), B = route.toWorld(sb, x, {});
    const quadPts = [[A, y0, sa], [B, y0, sb], [B, y1, sb], [A, y0, sa], [B, y1, sb], [A, y1, sa]];
    for (const [P, y, s] of quadPts) { pos.push(P.wx, y, P.wz); uv.push(s / uvScale, (y - y0) / uvScale); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  // 讓法線朝 facing：檢查第一個法線
  const sm = route.sample((s0 + s1) / 2, {});
  const nx = g.attributes.normal.getX(0), nz = g.attributes.normal.getZ(0);
  const want = facing; // 朝 +x（路線右方）＝ r
  if ((nx * sm.rx + nz * sm.rz) * want < 0) flip(g);
  return g;
}

// 確保三角形朝上（法線 +Y）
function fixWinding(g) {
  const p = g.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  a.fromBufferAttribute(p, 0); b.fromBufferAttribute(p, 1); c.fromBufferAttribute(p, 2);
  const n = b.sub(a).cross(c.sub(a));
  if (n.y < 0) flip(g);
}

export function flip(g) {
  const p = g.attributes.position, u = g.attributes.uv, nn = g.attributes.normal;
  for (let i = 0; i < p.count; i += 3) {
    for (const attr of [p, u, nn]) {
      if (!attr) continue;
      const sz = attr.itemSize;
      for (let k = 0; k < sz; k++) {
        const t = attr.array[(i + 1) * sz + k];
        attr.array[(i + 1) * sz + k] = attr.array[(i + 2) * sz + k];
        attr.array[(i + 2) * sz + k] = t;
      }
    }
  }
  if (nn) for (let i = 0; i < nn.array.length; i++) nn.array[i] = -nn.array[i];
  p.needsUpdate = true;
}

// 區塊座標系：沿街的建築用。ex＝沿街、ey＝上、ez＝朝路（facade 外法線）
// side：+1 右側建築、−1 左側建築；x：建築正面的路線橫向位置
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function frameAt(route, s, x, side, y = 0) {
  const sm = route.sample(s, {});
  const wx = sm.x + sm.rx * x, wz = sm.z + sm.rz * x;
  _f.set(sm.fx, 0, sm.fz); _r.set(sm.rx, 0, sm.rz);
  const ex = _f.clone().multiplyScalar(-side), ez = _r.clone().multiplyScalar(-side);
  const m = new THREE.Matrix4().makeBasis(ex, _up, ez);
  m.setPosition(wx, y, wz);
  return m;
}

// 一般的路線座標框：ex＝右方 r、ey＝上、ez＝前進 f（模型車頭朝 +Z 用這個）
export function routeFrame(route, s, x, y = 0, yaw = 0) {
  const sm = route.sample(s, {});
  const th = sm.th + yaw;
  const m = new THREE.Matrix4().makeRotationY(th);
  m.setPosition(sm.x + sm.rx * x, y, sm.z + sm.rz * x);
  return m;
}
