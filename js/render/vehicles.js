// 車輛、人物、狗、玩家機車、遶境隊伍的程式模型（three.js，純程式產生，不載入外部模型）。
// 座標約定：Y 朝上、車頭朝 +Z、原點在地面的車身中心；長度沿 Z、寬度沿 X；單位公尺。
//   車子的「左側」是 +X（駕駛座那側，台灣靠右行駛），右側是 −X。
// 效能：每種外觀只建一次原型（靜態零件依材質合併成一個網格），之後一律 clone；
//   燈光材質每台各自一份（主程式改 emissiveIntensity 開關），其他材質與幾何全部共用。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC","Heiti TC",sans-serif';
const PI = Math.PI;

// ---------------------------------------------------------------- 亂數
function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// ---------------------------------------------------------------- 材質（共用快取）
const MATS = new Map();
function cached(key, make) { let m = MATS.get(key); if (!m) { m = make(); MATS.set(key, m); } return m; }
const hexKey = (c) => (typeof c === 'number' ? c.toString(16) : String(c));

const M = {
  paint: (c, metal = 0.35) => cached('paint' + hexKey(c) + metal, () => new THREE.MeshPhysicalMaterial({
    color: c, metalness: metal, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.1 })),
  flat: (c, rough = 0.55) => cached('flat' + hexKey(c) + rough, () => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 })),
  metal: (c, rough = 0.35) => cached('metal' + hexKey(c) + rough, () => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.9 })),
  chrome: () => cached('chrome', () => new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.12, metalness: 1 })),
  rubber: () => cached('rubber', () => new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.88, metalness: 0 })),
  trim: () => cached('trim', () => new THREE.MeshStandardMaterial({ color: 0x1f2225, roughness: 0.6, metalness: 0.1 })),
  glass: () => cached('glass', () => new THREE.MeshPhysicalMaterial({
    color: 0x10161d, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8 })),
  glassLight: () => cached('glassL', () => new THREE.MeshPhysicalMaterial({
    color: 0x2a3a48, metalness: 0.1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 })),
  // 人物、狗、小物：一律頂點色，一個網格一次繪製
  vc: (rough = 0.72) => cached('vc' + rough, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 })),
  vcGloss: () => cached('vcg', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0 })),
  screen: () => cached('screen', () => new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x9fd4ff, emissiveIntensity: 2.2, roughness: 0.2 })),
  map: (key, tex, extra = {}) => cached('map' + key, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, ...extra })),
};

// 燈光材質：每個原型自己一份，clone 時再複製；userData.role 給主程式辨認
const LIGHT_DEF = {
  head:  { color: 0xf4f6f8, emissive: 0xfff4dc, on: 3.2 },
  tail:  { color: 0x7a0f12, emissive: 0xff1a1a, on: 1.4 },
  brake: { color: 0x8a1014, emissive: 0xff2020, on: 3.5 },
  blinkL:{ color: 0xc87a16, emissive: 0xffa21a, on: 3.0 },
  blinkR:{ color: 0xc87a16, emissive: 0xffa21a, on: 3.0 },
  roof:  { color: 0xf3e9b0, emissive: 0xffe066, on: 2.4 },
};
function lightMat(role, over) {
  const d = { ...LIGHT_DEF[role], ...(over || {}) };
  const m = new THREE.MeshStandardMaterial({ color: d.color, emissive: d.emissive, emissiveIntensity: 0, roughness: 0.25, metalness: 0 });
  m.userData.role = role;
  m.userData.on = d.on;
  return m;
}

// ---------------------------------------------------------------- 幾何（共用快取）
const GEOS = new Map();
const f3 = (n) => (Math.round(n * 1000) / 1000).toString();
function gcache(key, make) { let g = GEOS.get(key); if (!g) { g = make(); GEOS.set(key, g); } return g; }

function roundedBoxGeo(w, h, d, r, seg) {
  r = Math.max(0.001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const n = seg * 2 + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const p = g.attributes.position, nm = g.attributes.normal;
  const half = [w / 2 - r, h / 2 - r, d / 2 - r];
  const v = [0, 0, 0], inner = [0, 0, 0], dir = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    v[0] = p.getX(i); v[1] = p.getY(i); v[2] = p.getZ(i);
    for (let a = 0; a < 3; a++) {
      const u = v[a] * n, au = Math.abs(u);
      if (au <= 0.5 + 1e-6) { inner[a] = u * 2 * half[a]; dir[a] = 0; }
      else { inner[a] = Math.sign(u) * half[a]; dir[a] = Math.sign(u) * Math.min(1, (au - 0.5) / seg); }
    }
    let L = Math.hypot(dir[0], dir[1], dir[2]);
    if (L < 1e-6) { dir[0] = nm.getX(i); dir[1] = nm.getY(i); dir[2] = nm.getZ(i); L = 1; }
    dir[0] /= L; dir[1] /= L; dir[2] /= L;
    p.setXYZ(i, inner[0] + dir[0] * r, inner[1] + dir[1] * r, inner[2] + dir[2] * r);
    nm.setXYZ(i, dir[0], dir[1], dir[2]);
  }
  return g;
}
// 低面數倒角盒（44 面）：平面＋斜切邊＋角；UV 每面 0～1（文字不會左右顛倒）
function chamferBoxGeo(w, h, d, r) {
  r = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const H = [w / 2, h / 2, d / 2], I = [w / 2 - r, h / 2 - r, d / 2 - r];
  const V = (sx, sy, sz, a) => { const s = [sx, sy, sz]; const p = [s[0] * I[0], s[1] * I[1], s[2] * I[2]]; p[a] += s[a] * r; return p; };
  const tris = [];
  const S = [-1, 1];
  // 六個面
  for (let a = 0; a < 3; a++) for (const sa of S) {
    const b = (a + 1) % 3, c = (a + 2) % 3, q = [];
    for (const [sb, sc] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const s = [0, 0, 0]; s[a] = sa; s[b] = sb; s[c] = sc; q.push(V(s[0], s[1], s[2], a)); }
    tris.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  }
  // 十二條斜邊
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) for (const sa of S) for (const sb of S) {
    const c = 3 - a - b, q = [];
    for (const [ax, sc] of [[a, -1], [a, 1], [b, 1], [b, -1]]) { const s = [0, 0, 0]; s[a] = sa; s[b] = sb; s[c] = sc; q.push(V(s[0], s[1], s[2], ax)); }
    tris.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  }
  // 八個角
  for (const sx of S) for (const sy of S) for (const sz of S) tris.push([V(sx, sy, sz, 0), V(sx, sy, sz, 1), V(sx, sy, sz, 2)]);
  const pos = [], nor = [], uv = [];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  for (let t of tris) {
    let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    const cen = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3];
    if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) { t = [t[0], t[2], t[1]]; n = [-n[0], -n[1], -n[2]]; }
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / L, n[1] / L, n[2] / L];
    const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : (Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2);
    const sg = Math.sign(n[ax]) || 1;
    for (const p of t) {
      pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]);
      let u, v;
      if (ax === 2) { u = sg > 0 ? (p[0] + H[0]) / w : (H[0] - p[0]) / w; v = (p[1] + H[1]) / h; }
      else if (ax === 0) { u = sg > 0 ? (H[2] - p[2]) / d : (p[2] + H[2]) / d; v = (p[1] + H[1]) / h; }
      else { u = (p[0] + H[0]) / w; v = sg > 0 ? (H[2] - p[2]) / d : (p[2] + H[2]) / d; }
      uv.push(u, v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
const G = {
  // seg 0＝倒角盒（44 面，小零件用）；seg ≥ 1＝圓角盒（看得到的大曲面用）
  rbox: (w, h, d, r = 0.03, seg = 0) => gcache(`rb${f3(w)},${f3(h)},${f3(d)},${f3(r)},${seg}`, () => seg > 0 ? roundedBoxGeo(w, h, d, r, seg) : (r <= 0.02 ? new THREE.BoxGeometry(w, h, d) : chamferBoxGeo(w, h, d, r))),
  box: (w, h, d) => gcache(`b${f3(w)},${f3(h)},${f3(d)}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt, rb, h, s = 10, open = false) => gcache(`c${f3(rt)},${f3(rb)},${f3(h)},${s},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open)),
  sph: (r, ws = 10, hs = 7, t0 = 0, tl = PI) => gcache(`s${f3(r)},${ws},${hs},${f3(t0)},${f3(tl)}`, () => new THREE.SphereGeometry(r, ws, hs, 0, PI * 2, t0, tl)),
  cap: (r, len, cs = 3, rs = 8) => gcache(`cp${f3(r)},${f3(len)},${cs},${rs}`, () => new THREE.CapsuleGeometry(r, len, cs, rs)),
  cone: (r, h, s = 12, open = false) => gcache(`co${f3(r)},${f3(h)},${s},${open}`, () => new THREE.ConeGeometry(r, h, s, 1, open)),
  torus: (R, t, rs = 6, ts = 16, arc = PI * 2) => gcache(`t${f3(R)},${f3(t)},${rs},${ts},${f3(arc)}`, () => new THREE.TorusGeometry(R, t, rs, ts, arc)),
  plane: (w, h) => gcache(`p${f3(w)},${f3(h)}`, () => new THREE.PlaneGeometry(w, h)),
  // 上寬下窄的軀幹（肩寬、收腰）
  torso: (w, h, d) => gcache(`to${f3(w)},${f3(h)},${f3(d)}`, () => {
    const g = roundedBoxGeo(w, h, d, Math.min(0.09, d * 0.45), 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + h / 2) / h;
      p.setX(i, p.getX(i) * (0.8 + 0.2 * Math.min(1, t * 1.3)));
      p.setZ(i, p.getZ(i) * (0.92 + 0.08 * Math.sin(t * PI)));
    }
    g.computeVertexNormals();
    return g;
  }),
};

// 側面輪廓（z, y）沿 X 擠出成車身；pts 可以夾 ['arc', cz, cy, r, a0, a1, cw]
function sideExtrude(key, pts, width, bevel = 0.04, curveSeg = 3, taper = null, bevelSegs = 1) {
  return gcache(`ex${key}|${f3(width)}|${f3(bevel)}|${taper ? 't' : ''}|${bevelSegs}`, () => {
    const s = new THREE.Shape();
    let first = true;
    for (const p of pts) {
      if (p[0] === 'arc') { s.absarc(p[1], p[2], p[3], p[4], p[5], p[6]); continue; }
      if (first) { s.moveTo(p[0], p[1]); first = false; } else s.lineTo(p[0], p[1]);
    }
    const depth = Math.max(0.01, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelOffset: -bevel * 0.8, bevelSegments: bevelSegs, curveSegments: curveSeg });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-PI / 2);
    if (taper) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * taper(p.getY(i), p.getZ(i)));
    }
    g.computeVertexNormals();
    return g;
  });
}

// ---------------------------------------------------------------- 零件合併器
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _col = new THREE.Color();
class Parts {
  constructor() { this.byMat = new Map(); }
  // add(幾何, 材質, [x,y,z], [rx,ry,rz], [sx,sy,sz], 頂點色)
  add(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], color = null) {
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(pos[0], pos[1], pos[2]), _q, _s.set(scl[0], scl[1], scl[2]));
    return this.addM(geo, mat, _m4, color);
  }
  addM(geo, mat, matrix, color = null) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(matrix);
    if (mat.vertexColors) {
      _col.set(color ?? 0xffffff);
      const n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = _col.r; arr[i * 3 + 1] = _col.g; arr[i * 3 + 2] = _col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    let list = this.byMat.get(mat);
    if (!list) { list = []; this.byMat.set(mat, list); }
    list.push(g);
    return this;
  }
  // 兩點之間放一段膠囊（手腳）
  limb(mat, a, b, r, color, cs = 1, rs = 6) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    return this.addM(G.cap(r, Math.max(0.001, len), cs, rs), mat, m, color);
  }
  // 兩點之間放一根圓柱（管子、桿子）
  tube(mat, a, b, r, seg = 6, color = null) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    return this.addM(G.cyl(r, r, len, seg), mat, m, color);
  }
  build(target, { shadow = true, receive = true } = {}) {
    for (const [mat, list] of this.byMat) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadow && !mat.userData.role && mat.transparent !== true;
      mesh.receiveShadow = receive;
      target.add(mesh);
    }
    this.byMat.clear();
    return target;
  }
}

// ---------------------------------------------------------------- 貼圖（車牌、TAXI 燈、公車路線、旗子）
const TEX = new Map();
function canvasTex(key, w, h, draw) {
  let t = TEX.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  TEX.set(key, t);
  return t;
}
const PLATE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function plateText(r, kind) {
  const L = () => PLATE_LETTERS[Math.floor(r() * PLATE_LETTERS.length)];
  const D = () => Math.floor(r() * 10);
  if (kind === 'scooter') return `${L()}${L()}${L()}-${D()}${D()}${D()}`;
  if (kind === 'taxi') return `T${L()}${L()}-${D()}${D()}${D()}${D()}`;
  if (kind === 'bus') return `KK${L()}-${D()}${D()}${D()}`;
  return `${L()}${L()}${L()}-${D()}${D()}${D()}${D()}`;
}
function plateMat(text, red = false) {
  const tex = canvasTex('plate' + text + red, 256, 128, (g, w, h) => {
    g.fillStyle = '#f4f4ef'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#222'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = red ? '#c0141b' : '#15171a';
    g.font = `bold 66px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4, w - 24);
  });
  return M.map('plate' + text + red, tex, { roughness: 0.4 });
}

// ---------------------------------------------------------------- 共用：輪子
// 頂點色合成一個網格（胎＋輪框＋輻條），一次繪製；輪軸沿 X。
function wheelProto(r, w, rim = 0x9ea4aa, spokes = 5) {
  return gcache(`wheel${f3(r)},${f3(w)},${hexKey(rim)},${spokes}`, () => {
    const P = new Parts();
    const vc = M.vc(0.55);
    const seg = r > 0.4 ? 14 : 10;
    const lathe = (pts) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0.0005, x), y)), seg);
    const hw = w / 2;
    const toX = [0, 0, -PI / 2];
    // 輪框（外側凹面）、胎、內側
    P.add(lathe([[0, hw * 1.06], [r * 0.18, hw * 1.04], [r * 0.6, hw * 0.94], [r * 0.66, hw * 1.04]]), vc, [0, 0, 0], toX, [1, 1, 1], rim);
    P.add(lathe([[r * 0.66, hw * 1.02], [r * 0.9, hw * 0.96], [r, hw * 0.55], [r, -hw * 0.55], [r * 0.9, -hw * 0.96], [r * 0.66, -hw * 1.02]]), vc, [0, 0, 0], toX, [1, 1, 1], 0x1a1a1c);
    P.add(lathe([[r * 0.66, -hw], [0, -hw * 0.9]]), vc, [0, 0, 0], toX, [1, 1, 1], 0x2b2e31);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * PI * 2;
      P.add(G.box(0.012, r * 0.44, r * 0.12), vc, [hw * 0.98, Math.cos(a) * r * 0.39, Math.sin(a) * r * 0.39], [a, 0, 0], [1, 1, 1], rim);
    }
    const geo = mergeGeometries([...P.byMat.get(vc)], false);
    geo.computeBoundingSphere();
    return geo;
  });
}
function addWheel(parent, x, y, z, r, w, rim, spokes) {
  const mesh = new THREE.Mesh(wheelProto(r, w, rim, spokes), M.vc(0.55));
  mesh.position.set(x, y, z);
  if (x < -0.01) mesh.rotation.y = PI; // 右側的輪子把輪框面翻到外側
  mesh.castShadow = true;
  mesh.userData.isWheel = true;
  mesh.name = 'wheel';
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------- 人物（頂點色）
const SKINS = [0xf1c9a5, 0xe0b08a, 0xc99470, 0xa87452, 0xf5d3b8];
const HAIRS = [0x16120f, 0x231a14, 0x3a2a1e, 0x5b4636, 0x8a8580, 0x101010];
const SHIRTS = [0xd9d7cf, 0x2f4f86, 0xc2382e, 0x3a7d4f, 0xe7b928, 0x7c4fa0, 0x2b2b2e, 0xd9739a, 0x5b8fc9, 0xf08a3c, 0x9aa3ad, 0x6e4b35];
const PANTS = [0x2a3346, 0x1d1f24, 0x4a4f57, 0x6d5a45, 0x2f4a6b, 0xc9bda3];
const HELMETS = [0xe4e4e0, 0xd22c2c, 0x1f2124, 0x2e62c4, 0xf2c230, 0xe58aa8, 0x3f8a5c, 0x9aa0a8];
const RAINCOATS = [0x2f7fe0, 0xf3d22f, 0xe3477e, 0x3fb36b, 0xf07c2a, 0x7d5cc9];

function riderLook(r, o = {}) {
  return {
    skin: pick(r, SKINS), hair: pick(r, HAIRS), shirt: o.shirt ?? pick(r, SHIRTS), pants: o.pants ?? pick(r, PANTS),
    helmet: o.helmet ?? pick(r, HELMETS), shoes: pick(r, [0x1c1c1e, 0x3b3b3e, 0xcfcfca, 0x6b4a33]),
    full: o.full ?? (r() < 0.25), visor: r() < 0.55, raincoat: o.raincoat ? (o.raincoatColor ?? pick(r, RAINCOATS)) : null,
    gloves: r() < 0.3,
  };
}

// 安全帽：半罩（台灣最常見）或全罩
function addHelmet(P, c, look, hx, hy, hz, tilt = 0) {
  const vc = M.vcGloss();
  if (look.full) {
    P.add(G.sph(0.148, 10, 7), vc, [hx, hy + 0.01, hz], [tilt, 0, 0], [1, 1.02, 1.08], look.helmet);
    P.add(G.sph(0.152, 12, 6, PI * 0.36, PI * 0.26), M.glass(), [hx, hy + 0.0, hz + 0.004], [tilt + PI / 2 - 0.15, 0, 0], [0.92, 1, 1]); // 面罩
    P.add(G.rbox(0.2, 0.06, 0.09, 0.025), vc, [hx, hy - 0.11, hz + 0.1], [tilt, 0, 0], [1, 1, 1], look.helmet); // 下巴
  } else {
    P.add(G.sph(0.143, 10, 5, 0, PI * 0.56), vc, [hx, hy + 0.0, hz - 0.005], [tilt - 0.12, 0, 0], [1, 1.05, 1.1], look.helmet);
    P.add(G.rbox(0.2, 0.012, 0.07, 0.006), vc, [hx, hy + 0.035, hz + 0.145], [tilt - 0.35, 0, 0], [1, 1, 1], 0x2a2a2c); // 帽簷
    if (look.visor) P.add(G.sph(0.152, 8, 2, PI * 0.36, PI * 0.18), M.glass(), [hx, hy + 0.03, hz + 0.01], [tilt + PI / 2 - 0.45, 0, 0], [0.9, 1, 1]); // 擋風鏡
    for (const sx of [1, -1]) P.limb(M.vc(), [hx + sx * 0.1, hy - 0.04, hz - 0.01], [hx + sx * 0.05, hy - 0.16, hz + 0.04], 0.006, 0x222222, 1, 4); // 帽帶
  }
}

// 坐姿騎士（機車用）。座標是「機車座標」。回傳 Parts 的內容加進 P。
function addSeatedRider(P, look, o = {}) {
  const vc = M.vc();
  const hipY = o.hipY ?? 0.9, hipZ = o.hipZ ?? -0.36;
  const grip = o.grip ?? [0.3, 1.04, 0.42];
  const footZ = o.footZ ?? 0.12, footY = o.footY ?? 0.37;
  const lean = o.lean ?? 0.3;
  const shirt = look.raincoat ?? look.shirt;
  // 軀幹
  const tz = hipZ + Math.sin(lean) * 0.27, ty = hipY + Math.cos(lean) * 0.27;
  P.add(G.torso(0.38, 0.52, 0.24), vc, [0, ty, tz], [lean, 0, 0], [1, 1, 1], shirt);
  P.add(G.rbox(0.34, 0.16, 0.25, 0.07, 1), vc, [0, hipY + 0.04, hipZ - 0.02], [0, 0, 0], [1, 1, 1], look.raincoat ?? look.pants); // 臀
  const shY = hipY + Math.cos(lean) * 0.47, shZ = hipZ + Math.sin(lean) * 0.47;
  for (const sx of [1, -1]) P.add(G.sph(0.068, 6, 4), vc, [sx * 0.19, shY - 0.03, shZ - 0.02], [0, 0, 0], [1, 1, 1], shirt); // 肩
  // 頭頸
  const hx = 0, hy = shY + 0.2, hz = shZ + 0.06;
  P.add(G.cyl(0.05, 0.055, 0.1, 6, true), vc, [0, shY + 0.05, shZ + 0.02], [0.2, 0, 0], [1, 1, 1], look.skin);
  P.add(G.sph(0.105, 8, 6), vc, [hx, hy, hz], [0, 0, 0], [0.95, 1.05, 1], look.skin);
  addHelmet(P, null, look, hx, hy + 0.025, hz, 0);
  // 手臂（肩 → 肘 → 握把）
  for (const sx of [1, -1]) {
    const sh = [sx * 0.2, shY - 0.03, shZ - 0.01];
    const g = [sx * grip[0], grip[1], grip[2]];
    const el = [sx * (grip[0] + 0.03), (sh[1] + g[1]) / 2 - 0.08, (sh[2] + g[2]) / 2 - 0.02];
    P.limb(vc, sh, el, 0.055, shirt);
    P.limb(vc, el, g, 0.045, look.raincoat ?? (o.sleeve ?? shirt));
    P.add(G.sph(0.045, 6, 4), vc, g, [0, 0, 0], [1, 1, 1.2], look.gloves ? 0x222222 : look.skin);
  }
  // 腿（髖 → 膝 → 腳）
  for (const sx of [1, -1]) {
    const hip = [sx * 0.1, hipY, hipZ + 0.02];
    const knee = [sx * (o.kneeX ?? 0.15), hipY + 0.06, (o.kneeZ ?? 0.05)];
    const foot = [sx * (o.footX ?? 0.13), footY + 0.06, footZ];
    P.limb(vc, hip, knee, 0.072, look.raincoat ?? look.pants);
    P.limb(vc, knee, foot, 0.06, look.pants);
    P.add(G.rbox(0.1, 0.08, 0.22, 0.035), vc, [foot[0], footY + 0.0, foot[2] + 0.05], [0, 0, 0], [1, 1, 1], look.shoes);
  }
  // 雨衣：套在身上的大斗篷＋蓋到龍頭的前擺
  if (look.raincoat) {
    const rc = M.vcGloss();
    P.add(G.rbox(0.5, 0.56, 0.36, 0.14, 1), rc, [0, ty - 0.02, tz - 0.01], [lean, 0, 0], [1, 1, 1], look.raincoat);
    P.add(G.rbox(0.62, 0.035, 0.62, 0.03, 1), rc, [0, (hipY + grip[1]) / 2 + 0.04, (hipZ + grip[2]) / 2 + 0.06], [-0.32, 0, 0], [1, 1, 1], look.raincoat);
    P.add(G.sph(0.15, 12, 6, 0, PI * 0.6), rc, [hx, hy + 0.005, hz - 0.02], [-0.25, 0, 0], [1.05, 1.05, 1.12], look.raincoat); // 帽兜
  }
  return { headPos: [hx, hy, hz] };
}

// ---------------------------------------------------------------- 速克達
const SCOOTER_COLORS = [0xf2f2ef, 0x1f2124, 0xc42a2a, 0x2e5fb8, 0x8fa3b5, 0xe8c54a, 0x6c7a57, 0xe9e2d0, 0x9b1b30, 0x3f3f44, 0x75b6d9, 0xd96b2b];

function buildScooterBody(P, o) {
  const body = o.color, accent = o.accent ?? body, trim = M.trim();
  const paint = M.paint(body, o.old ? 0.05 : 0.3);
  const paintA = M.paint(accent, o.old ? 0.05 : 0.3);
  // 前擋板（腳踏處前方）
  P.add(sideExtrude('sc_front', [[0.3, 0.3], [0.5, 0.29], [0.64, 0.42], [0.71, 0.66], [0.66, 0.9], [0.56, 0.98], [0.47, 0.95], [0.41, 0.8], [0.35, 0.52]], 0.46, 0.06, 4,
    (y, z) => (1 - 0.32 * THREE.MathUtils.clamp((y - 0.35) / 0.65, 0, 1)) * (1 - 0.35 * THREE.MathUtils.clamp((z - 0.5) / 0.22, 0, 1))), paintA, [0, 0, 0]);
  P.add(G.rbox(0.26, 0.44, 0.04, 0.02), trim, [0, 0.62, 0.43], [-0.2, 0, 0]); // 內側置物板
  // 車身後段
  P.add(sideExtrude('sc_rear', [[-0.98, 0.44], [-0.6, 0.33], [-0.12, 0.3], [-0.08, 0.5], [-0.16, 0.74], [-0.7, 0.8], [-0.94, 0.76], [-1.0, 0.64]], 0.4, 0.06, 4,
    (y, z) => (1 - 0.3 * THREE.MathUtils.clamp((-0.6 - z) / 0.4, 0, 1)) * (0.88 + 0.12 * THREE.MathUtils.clamp((0.8 - y) / 0.3, 0, 1))), paint, [0, 0, 0]);
  // 腳踏板＋側裙
  P.add(G.rbox(0.36, 0.06, 0.6, 0.025), M.flat(0x2a2c2f, 0.8), [0, 0.32, 0.08]);
  P.add(G.rbox(0.32, 0.12, 0.56, 0.04), paint, [0, 0.25, 0.07]);
  for (let i = 0; i < 3; i++) P.add(G.box(0.3, 0.008, 0.03), M.rubber(), [0, 0.353, -0.08 + i * 0.14]);
  // 坐墊
  P.add(G.rbox(0.32, 0.12, 0.76, 0.05), M.flat(o.seat ?? 0x1e1e20, 0.62), [0, 0.85, -0.48], [0.03, 0, 0]);
  P.add(G.rbox(0.33, 0.02, 0.74, 0.01), M.flat(0x3a3a3d, 0.7), [0, 0.795, -0.48]);
  // 後扶手
  P.add(G.rbox(0.36, 0.035, 0.2, 0.015), o.old ? M.metal(0xb5b8bb, 0.4) : trim, [0, 0.86, -0.9]);
  for (const sx of [1, -1]) P.add(G.rbox(0.03, 0.08, 0.2, 0.012), o.old ? M.metal(0xb5b8bb, 0.4) : trim, [sx * 0.17, 0.82, -0.82]);
  // 引擎、傳動箱（左）、排氣管（右）
  P.add(G.rbox(0.16, 0.22, 0.56, 0.05), M.metal(0x6e7276, 0.5), [0.11, 0.3, -0.42]);
  P.add(G.rbox(0.12, 0.16, 0.3, 0.04), M.metal(0x3c3f42, 0.5), [-0.06, 0.28, -0.2]);
  P.tube(M.chrome(), [-0.15, 0.24, -0.1], [-0.17, 0.28, -0.38], 0.022, 8);
  P.add(G.cyl(0.055, 0.06, 0.4, 8), M.metal(0x2e3033, 0.35), [-0.17, 0.3, -0.62], [PI / 2 - 0.12, 0, 0]);
  P.add(G.rbox(0.03, 0.09, 0.3, 0.012), M.metal(0x8b9095, 0.3), [-0.235, 0.32, -0.6], [-0.12, 0, 0]); // 隔熱板
  P.add(G.cyl(0.03, 0.03, 0.05, 6), M.chrome(), [-0.17, 0.33, -0.84], [PI / 2 - 0.12, 0, 0]);
  // 後擋泥板與牌照
  P.add(G.rbox(0.14, 0.04, 0.34, 0.015), trim, [0, 0.5, -0.92], [0.6, 0, 0]);
  P.add(G.rbox(0.2, 0.12, 0.01, 0.005), o.plate, [0, 0.56, -1.04], [-0.25, 0, 0]);
  // 尾燈組
  P.add(G.rbox(0.22, 0.06, 0.06, 0.02), o.L.tail, [0, 0.74, -0.98], [0.2, 0, 0]);
  P.add(G.rbox(0.13, 0.04, 0.05, 0.015), o.L.brake, [0, 0.69, -0.985], [0.2, 0, 0]);
  P.add(G.rbox(0.05, 0.035, 0.04, 0.012), o.L.blinkL, [0.15, 0.7, -0.96]);
  P.add(G.rbox(0.05, 0.035, 0.04, 0.012), o.L.blinkR, [-0.15, 0.7, -0.96]);
  // 前擋板上的裝飾線
  if (!o.old) P.add(G.rbox(0.03, 0.4, 0.05, 0.012), M.paint(o.stripe ?? 0xc8c8c8, 0.4), [0, 0.65, 0.7], [-0.25, 0, 0]);
}

// 龍頭（會轉向的部分）：放在 steer 群組裡，原點＝前輪軸心，Y 沿轉向軸
function buildScooterSteer(P, o) {
  const paintA = M.paint(o.accent ?? o.color, o.old ? 0.05 : 0.3);
  const trim = M.trim();
  // 前叉
  for (const sx of [1, -1]) P.add(G.cyl(0.022, 0.026, 0.62, 6, true), M.metal(0x2d2f32, 0.4), [sx * 0.075, 0.3, 0]);
  // 前土除
  P.add(G.rbox(0.15, 0.05, 0.42, 0.02), paintA, [0, 0.29, 0.02], [0.05, 0, 0]);
  // 把手蓋與大燈
  P.add(G.rbox(0.44, 0.14, 0.24, 0.06, 1), paintA, [0, 0.79, 0.02]);
  P.add(G.rbox(0.2, 0.075, 0.06, 0.03), o.L.head, [0, 0.79, 0.14]);
  P.add(G.rbox(0.22, 0.09, 0.03, 0.03), M.chrome(), [0, 0.79, 0.12]);
  P.add(G.rbox(0.05, 0.035, 0.05, 0.012), o.L.blinkL, [0.21, 0.79, 0.1]);
  P.add(G.rbox(0.05, 0.035, 0.05, 0.012), o.L.blinkR, [-0.21, 0.79, 0.1]);
  P.add(G.rbox(0.2, 0.03, 0.1, 0.012), M.flat(0x111316, 0.3), [0, 0.87, -0.03], [-0.3, 0, 0]); // 儀表
  // 把手
  P.add(G.cyl(0.014, 0.014, 0.62, 5, true), M.metal(0x25272a, 0.4), [0, 0.8, -0.04], [0, 0, PI / 2]);
  for (const sx of [1, -1]) P.add(G.cyl(0.022, 0.022, 0.12, 6), M.rubber(), [sx * 0.27, 0.8, -0.04], [0, 0, PI / 2]);
  // 後照鏡
  for (const sx of [1, -1]) {
    P.tube(M.metal(0x2a2c2f, 0.35), [sx * 0.17, 0.84, -0.02], [sx * 0.24, 1.02, -0.06], 0.008, 6);
    P.add(G.rbox(0.11, 0.07, 0.025, 0.02), trim, [sx * 0.26, 1.05, -0.06], [0, sx * 0.15, 0]);
  }
  // 菜籃（阿伯、買菜）
  if (o.cargo === 'basket') {
    const wire = M.metal(0x9aa0a6, 0.5);
    P.add(G.rbox(0.34, 0.02, 0.24, 0.008), wire, [0, 0.62, 0.32]);
    P.add(G.rbox(0.34, 0.2, 0.012, 0.004), wire, [0, 0.72, 0.44]);
    P.add(G.rbox(0.34, 0.2, 0.012, 0.004), wire, [0, 0.72, 0.2]);
    for (const sx of [1, -1]) P.add(G.rbox(0.012, 0.2, 0.24, 0.004), wire, [sx * 0.17, 0.72, 0.32]);
    P.add(G.sph(0.08, 8, 6), M.vc(), [0.05, 0.72, 0.33], [0, 0, 0], [1.3, 0.9, 1], 0x3d8a3a); // 青菜
    P.add(G.sph(0.06, 8, 6), M.vc(), [-0.08, 0.7, 0.3], [0, 0, 0], [1, 1, 1], 0xd9452e);
  }
}

function makeScooterProto(o) {
  const g = new THREE.Group();
  const L = o.L;
  const P = new Parts();
  buildScooterBody(P, o);
  // 後座的外送箱
  if (o.cargo === 'delivery') {
    const c = o.deliveryColor ?? 0xe02a6a;
    P.add(G.rbox(0.44, 0.4, 0.42, 0.04, 1), M.flat(c, 0.5), [0, 1.08, -0.86]);
    P.add(G.rbox(0.42, 0.04, 0.4, 0.02), M.flat(0xffffff, 0.5), [0, 1.0, -0.86]);
  }
  if (o.rider) {
    const look = o.look;
    addSeatedRider(P, look, { hipZ: o.cargo === 'delivery' ? -0.3 : -0.4 });
    // 阿伯的斗笠或鴨舌帽：蓋在安全帽上
    if (o.hat === 'conical') P.add(G.cone(0.31, 0.15, 16), M.vc(0.85), [0, 1.78, -0.12], [0, 0, 0], [1, 1, 1], 0xd8c084);
    if (o.hat === 'cap') P.add(G.rbox(0.18, 0.02, 0.14, 0.008), M.vc(), [0, 1.69, 0.0], [-0.2, 0, 0], [1, 1, 1], 0x2b4f8f);
  }
  P.build(g);
  // 前輪＋龍頭
  const rake = new THREE.Object3D();
  rake.position.set(0, 0.26, 0.64);
  rake.rotation.x = -0.22;
  g.add(rake);
  const steer = new THREE.Group();
  steer.name = 'steer';
  rake.add(steer);
  const SP = new Parts();
  buildScooterSteer(SP, o);
  SP.build(steer);
  const fw = addWheel(steer, 0, 0, 0, 0.255, 0.11, 0x2b2d30, 3);
  fw.rotation.x = 0.22;
  addWheel(g, 0, 0.255, -0.6, 0.255, 0.12, 0x2b2d30, 3);
  g.userData.kind = o.kind;
  return g;
}

// ---------------------------------------------------------------- 汽車（轎車、計程車）
const CAR_COLORS = [0xd8dade, 0xf4f4f2, 0x17191c, 0x1f2f55, 0x8f1d22, 0x55595f, 0x9fa7ae, 0x3c4d3f, 0xb7a58a, 0x2e5a8c];

function buildSedan(P, o) {
  const paint = M.paint(o.color, o.taxi ? 0.15 : 0.5);
  const trim = M.trim();
  // 下車身：側面輪廓（含輪拱），肩線往內收
  const clamp = THREE.MathUtils.clamp;
  P.add(sideExtrude('car_low2', [
    [-2.2, 0.24], [-1.83, 0.24], ['arc', -1.38, 0.27, 0.43, PI, 0, true], [0.95, 0.24], ['arc', 1.38, 0.27, 0.43, PI, 0, true],
    [2.16, 0.24], [2.24, 0.33], [2.27, 0.48], [2.26, 0.62], [2.21, 0.74], [2.1, 0.81], [1.85, 0.86], [1.5, 0.91], [1.08, 0.97],
    [-1.5, 0.99], [-1.85, 0.98], [-2.08, 0.94], [-2.2, 0.86], [-2.26, 0.72], [-2.27, 0.52], [-2.25, 0.36],
  ], 1.8, 0.09, 4, (y) => 1 - 0.05 * clamp((y - 0.7) / 0.3, 0, 1), 2), paint);
  // 車窗（深色玻璃，往上收窄）與車頂
  const gt = (y) => 1 - 0.13 * clamp((y - 0.96) / 0.46, 0, 1);
  P.add(sideExtrude('car_glass2', [[-1.52, 0.97], [-0.98, 1.38], [0.36, 1.41], [1.12, 0.96]], 1.6, 0.05, 4, gt), M.glass());
  P.add(G.rbox(1.42, 0.07, 1.36, 0.035), paint, [0, 1.425, -0.31]);
  // 柱子（跟著車窗內收）
  const pillar = (a, b, r) => { for (const sx of [1, -1]) P.tube(paint, [sx * 0.8 * gt(a[1]), a[1], a[0]], [sx * 0.8 * gt(b[1]), b[1], b[0]], r, 6); };
  pillar([1.12, 0.96], [0.36, 1.41], 0.045);       // A
  pillar([-0.18, 0.97], [-0.18, 1.41], 0.05);      // B
  pillar([-1.52, 0.97], [-0.98, 1.39], 0.07);      // C
  pillar([-1.38, 0.97], [-0.85, 1.4], 0.07);
  // 車門縫、門把（右側固定；左前門另做成可開的）
  for (const z of [-0.2, -1.32]) for (const sx of [1, -1]) if (!(sx > 0 && z === -0.2)) P.add(G.box(0.01, 0.6, 0.01), trim, [sx * 0.905, 0.64, z]);
  for (const sx of [1, -1]) P.add(G.rbox(0.02, 0.025, 0.12, 0.01), M.chrome(), [sx * 0.915, 0.86, -0.55]);
  P.add(G.rbox(0.02, 0.025, 0.12, 0.01), M.chrome(), [-0.915, 0.86, 0.55]);
  P.add(G.box(0.01, 0.6, 0.01), trim, [-0.905, 0.64, 0.95]);
  // 前臉：水箱罩、大燈、保桿
  P.add(G.rbox(0.82, 0.13, 0.05, 0.02), trim, [0, 0.67, 2.22]);
  P.add(G.rbox(0.8, 0.012, 0.055, 0.004), M.chrome(), [0, 0.7, 2.235]);
  P.add(G.rbox(1.0, 0.1, 0.05, 0.03), trim, [0, 0.4, 2.23]);
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.42, 0.15, 0.06, 0.03), M.chrome(), [sx * 0.6, 0.72, 2.17], [0, sx * -0.2, 0]);
    P.add(G.rbox(0.38, 0.11, 0.07, 0.03), o.L.head, [sx * 0.6, 0.72, 2.185], [0, sx * -0.2, 0]);
    P.add(G.rbox(0.09, 0.05, 0.05, 0.02), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 0.84, 0.5, 2.16]);
    P.add(G.rbox(0.14, 0.05, 0.06, 0.02), trim, [sx * 0.62, 0.42, 2.2]); // 霧燈座
  }
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateF, [0, 0.5, 2.265]);
  // 車尾：尾燈（外側常亮、內側煞車）、方向燈、牌照
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.34, 0.14, 0.06, 0.04), o.L.tail, [sx * 0.62, 0.83, -2.21], [0, sx * 0.15, 0]);
    P.add(G.rbox(0.16, 0.08, 0.06, 0.03), o.L.brake, [sx * 0.46, 0.83, -2.235]);
    P.add(G.rbox(0.1, 0.05, 0.06, 0.02), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 0.75, 0.74, -2.225]);
  }
  P.add(G.rbox(0.36, 0.035, 0.04, 0.015), o.L.brake, [0, 1.33, -1.0], [-0.65, 0, 0]); // 第三煞車燈
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateR, [0, 0.55, -2.26]);
  P.add(G.rbox(1.7, 0.12, 0.08, 0.04), trim, [0, 0.36, -2.22]); // 後保桿下緣
  // 後照鏡
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.07, 0.11, 0.17, 0.035), paint, [sx * 0.98, 1.0, 1.0], [0, sx * 0.25, 0]);
    P.add(G.rbox(0.012, 0.09, 0.14, 0.01), M.glassLight(), [sx * 0.99, 1.0, 0.94], [0, sx * 0.25, 0]);
  }
  // 底盤陰影
  P.add(G.box(1.6, 0.06, 3.6), M.flat(0x121314, 0.9), [0, 0.2, 0]);
  if (o.taxi) {
    // 小黃：車頂燈、車門「計程車」字樣、車頂燈座
    P.add(G.rbox(0.62, 0.17, 0.3, 0.05), o.L.roof, [0, 1.535, -0.2]);
    P.add(G.rbox(0.66, 0.04, 0.34, 0.015), trim, [0, 1.455, -0.2]);
    for (const sx of [1, -1]) P.add(G.plane(0.62, 0.17), o.taxiSign, [sx * 0.0, 1.535, -0.2 + sx * 0.152], [0, sx > 0 ? 0 : PI, 0]);
    P.add(G.plane(0.7, 0.16), o.taxiDoor, [-0.913, 0.68, -0.15], [0, -PI / 2, 0]);
  }
}

function makeCarProto(o) {
  const g = new THREE.Group();
  const P = new Parts();
  buildSedan(P, o);
  P.build(g);
  // 左前門（+X 側），樞紐在前緣；rotation.y 負值＝打開
  const hinge = new THREE.Group();
  hinge.name = 'doorFL';
  hinge.position.set(0.9, 0, 0.95);
  const DP = new Parts();
  DP.add(G.rbox(0.05, 0.62, 1.12, 0.02), M.paint(o.color, o.taxi ? 0.15 : 0.5), [0.005, 0.65, -0.57]);
  DP.add(G.rbox(0.03, 0.4, 0.98, 0.02), M.glass(), [-0.01, 1.17, -0.6], [0, 0, 0.12]);
  DP.add(G.rbox(0.02, 0.025, 0.12, 0.01), M.chrome(), [0.03, 0.86, -0.95]);
  DP.add(G.rbox(0.02, 0.5, 1.0, 0.02), M.flat(0x3a3d42, 0.8), [-0.03, 0.65, -0.57]); // 內裡
  if (o.taxi) DP.add(G.plane(0.7, 0.16), o.taxiDoor, [0.033, 0.68, -0.6], [0, PI / 2, 0]);
  DP.build(hinge);
  g.add(hinge);
  // 駕駛（看得到頭肩）
  const RP = new Parts();
  const look = o.look;
  const rider = new THREE.Group();
  rider.name = 'rider';
  RP.add(G.rbox(0.38, 0.4, 0.24, 0.09), M.vc(), [0.38, 0.95, -0.15], [0, 0, 0], [1, 1, 1], look.shirt);
  RP.add(G.sph(0.105, 10, 8), M.vc(), [0.38, 1.27, -0.1], [0, 0, 0], [1, 1, 1], look.skin);
  RP.add(G.sph(0.112, 10, 6, 0, PI * 0.5), M.vc(), [0.38, 1.29, -0.12], [-0.2, 0, 0], [1, 1, 1], look.hair);
  RP.build(rider, { shadow: false });
  g.add(rider);
  for (const [x, z] of [[0.78, 1.38], [-0.78, 1.38], [0.78, -1.38], [-0.78, -1.38]]) addWheel(g, x, 0.32, z, 0.32, 0.22, o.rim ?? 0xb7bcc1, 5);
  return g;
}

// ---------------------------------------------------------------- 發財車（小貨車，cab-over）
function makePickupProto(o) {
  const g = new THREE.Group();
  const P = new Parts();
  const paint = M.paint(o.color, 0.2), trim = M.trim();
  // 車頭
  P.add(sideExtrude('pk_cab', [[0.92, 0.6], [2.2, 0.6], [2.3, 0.75], [2.28, 1.25], [2.12, 1.88], [1.95, 1.98], [0.92, 1.98]], 1.7, 0.08, 4), paint);
  P.add(G.rbox(1.5, 0.62, 0.05, 0.04), M.glass(), [0, 1.53, 2.215], [-0.3, 0, 0]);
  for (const sx of [1, -1]) P.add(G.rbox(0.03, 0.5, 0.75, 0.03), M.glass(), [sx * 0.85, 1.55, 1.68]);
  P.add(G.rbox(1.0, 0.14, 0.04, 0.02), trim, [0, 0.92, 2.3]);
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.26, 0.15, 0.06, 0.04), o.L.head, [sx * 0.6, 0.95, 2.28]);
    P.add(G.rbox(0.09, 0.06, 0.05, 0.02), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 0.76, 0.77, 2.29]);
    P.add(G.rbox(0.06, 0.16, 0.12, 0.02), trim, [sx * 0.9, 1.35, 2.15]);
    P.tube(trim, [sx * 0.85, 1.6, 2.1], [sx * 1.0, 1.55, 2.2], 0.012, 6);
  }
  P.add(G.rbox(1.72, 0.18, 0.12, 0.05), trim, [0, 0.58, 2.28]); // 保桿
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateF, [0, 0.6, 2.345]);
  // 底盤與車斗
  P.add(G.box(0.9, 0.18, 4.4), M.flat(0x1b1c1e, 0.8), [0, 0.5, -0.1]);
  P.add(G.rbox(1.7, 0.1, 3.1, 0.02), M.metal(0xa8adb2, 0.5), [0, 0.74, -0.68]);
  const rail = o.railColor === 'paint' ? paint : M.metal(0xb8bdc2, 0.45);
  for (const sx of [1, -1]) P.add(G.rbox(0.05, 0.38, 3.1, 0.015), rail, [sx * 0.84, 0.98, -0.68]);
  P.add(G.rbox(1.7, 0.38, 0.05, 0.015), rail, [0, 0.98, -2.21]);
  P.add(G.rbox(1.7, 0.7, 0.06, 0.02), rail, [0, 1.15, 0.85]); // 車頭後的護架
  for (let i = 0; i < 4; i++) P.add(G.box(1.72, 0.02, 0.02), M.metal(0x8a9095, 0.5), [0, 0.9 + i * 0.1, -2.235]);
  // 尾燈
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.18, 0.12, 0.05, 0.03), o.L.tail, [sx * 0.68, 0.68, -2.24]);
    P.add(G.rbox(0.1, 0.08, 0.05, 0.02), o.L.brake, [sx * 0.48, 0.68, -2.245]);
    P.add(G.rbox(0.08, 0.06, 0.05, 0.02), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 0.8, 0.68, -2.245]);
  }
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateR, [0, 0.58, -2.25]);
  // 載貨：紙箱、塑膠籃（宣傳車不載，改加自己的零件）
  const r = rng(o.seed + 77);
  const boxM = M.flat(0xb88a55, 0.85);
  const n = o.noCargo ? 0 : 2 + Math.floor(r() * 4);
  if (o.extra) o.extra(P);
  for (let i = 0; i < n; i++) {
    const w = 0.4 + r() * 0.3, h = 0.3 + r() * 0.3, d = 0.4 + r() * 0.4;
    P.add(G.rbox(w, h, d, 0.015), r() < 0.7 ? boxM : M.flat(pick(r, [0x2f6fd0, 0xd23a3a, 0x3aa35a]), 0.6), [(r() - 0.5) * 0.9, 0.79 + h / 2, -0.4 - r() * 1.5], [0, (r() - 0.5) * 0.4, 0]);
  }
  P.build(g);
  for (const [x, z] of [[0.7, 1.55], [-0.7, 1.55], [0.7, -1.35], [-0.7, -1.35]]) addWheel(g, x, 0.28, z, 0.28, 0.18, 0xbfc4c8, 6);
  return g;
}

// ---------------------------------------------------------------- 公車
function makeBusProto(o) {
  const g = new THREE.Group();
  const P = new Parts();
  const white = M.paint(0xe2e3df, 0.1), stripe = M.paint(o.color, 0.2), trim = M.trim();
  P.add(sideExtrude('bus_body', [
    [-5.5, 0.35], [-3.45, 0.35], ['arc', -2.8, 0.5, 0.62, PI, 0, true], [2.95, 0.35], ['arc', 3.6, 0.5, 0.62, PI, 0, true],
    [5.45, 0.35], [5.5, 0.6], [5.5, 2.9], [5.35, 3.12], [-5.35, 3.12], [-5.5, 2.9],
  ], 2.5, 0.12, 6), white);
  // 色帶與側窗
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.02, 0.32, 10.7, 0.01), stripe, [sx * 1.252, 0.95, 0]);
    P.add(G.rbox(0.02, 0.08, 10.7, 0.01), stripe, [sx * 1.252, 1.28, 0]);
    P.add(G.rbox(0.03, 1.05, 8.4, 0.02), M.glass(), [sx * 1.25, 2.15, -0.8]);
    for (let i = 0; i < 7; i++) P.add(G.box(0.035, 1.06, 0.07), white, [sx * 1.26, 2.15, -4.9 + i * 1.2]);
  }
  // 右側（−X）車門：前門與中門
  for (const z of [4.4, 0.6]) {
    P.add(G.rbox(0.04, 2.3, 1.1, 0.02), M.glass(), [-1.255, 1.55, z]);
    P.add(G.box(0.05, 2.3, 0.04), trim, [-1.26, 1.55, z]);
  }
  // 前擋、路線 LED、雨刷
  P.add(G.rbox(2.3, 1.55, 0.06, 0.05), M.glass(), [0, 1.95, 5.49]);
  P.add(G.rbox(2.2, 0.32, 0.04, 0.02), M.flat(0x0b0b0c, 0.4), [0, 2.95, 5.5]);
  P.add(G.plane(2.1, 0.26), o.routeSign, [0, 2.95, 5.525]);
  P.add(G.rbox(1.9, 0.18, 0.05, 0.02), trim, [0, 0.95, 5.51]);
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.36, 0.16, 0.06, 0.04), o.L.head, [sx * 0.85, 0.85, 5.5]);
    P.add(G.rbox(0.12, 0.08, 0.06, 0.02), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 1.08, 1.05, 5.5]);
    // 大後照鏡（往前伸）
    P.tube(trim, [sx * 1.2, 2.9, 5.3], [sx * 1.4, 2.95, 5.75], 0.025, 6);
    P.add(G.rbox(0.08, 0.5, 0.22, 0.04), trim, [sx * 1.42, 2.65, 5.75]);
  }
  P.add(G.rbox(2.45, 0.28, 0.12, 0.06), trim, [0, 0.48, 5.48]);
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateF, [0, 0.55, 5.55]);
  // 車尾
  P.add(G.rbox(1.6, 0.8, 0.05, 0.03), M.glass(), [0, 2.4, -5.5]);
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.2, 0.5, 0.06, 0.03), o.L.tail, [sx * 1.05, 1.05, -5.5]);
    P.add(G.rbox(0.2, 0.18, 0.06, 0.03), o.L.brake, [sx * 1.05, 1.42, -5.5]);
    P.add(G.rbox(0.2, 0.14, 0.06, 0.03), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 1.05, 0.68, -5.5]);
  }
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateR, [0, 0.75, -5.53]);
  P.add(G.rbox(2.45, 0.28, 0.12, 0.06), trim, [0, 0.48, -5.48]);
  // 車頂冷氣
  P.add(G.rbox(1.8, 0.28, 3.0, 0.1, 1), M.flat(0xdcdcd8, 0.5), [0, 3.25, 1.0]);
  P.add(G.box(2.3, 0.1, 9.6), M.flat(0x111213, 0.9), [0, 0.35, 0]);
  P.build(g);
  for (const sx of [1, -1]) {
    addWheel(g, sx * 1.02, 0.5, 3.6, 0.5, 0.3, 0xc4c8cc, 8);
    addWheel(g, sx * 0.98, 0.5, -2.8, 0.5, 0.42, 0xc4c8cc, 8);
  }
  return g;
}

// ---------------------------------------------------------------- 砂石車
function makeTruckProto(o) {
  const g = new THREE.Group();
  const P = new Parts();
  const cab = M.paint(o.color, 0.15), trim = M.trim();
  const bedM = M.paint(o.bedColor ?? 0x6e2f22, 0.3);
  // 車頭
  P.add(sideExtrude('tr_cab', [[2.85, 1.0], [4.4, 1.0], [4.5, 1.25], [4.5, 2.6], [4.35, 3.05], [2.85, 3.05]], 2.45, 0.1, 4), cab);
  P.add(G.rbox(2.15, 0.9, 0.06, 0.04), M.glass(), [0, 2.45, 4.5], [-0.05, 0, 0]);
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.04, 0.7, 0.8, 0.03), M.glass(), [sx * 1.22, 2.5, 3.9]);
    P.add(G.rbox(0.36, 0.18, 0.06, 0.04), o.L.head, [sx * 0.85, 1.3, 4.53]);
    P.add(G.rbox(0.14, 0.1, 0.06, 0.03), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 1.12, 1.3, 4.52]);
    P.add(G.rbox(0.1, 0.55, 0.3, 0.04), trim, [sx * 1.4, 2.45, 4.25]); // 後照鏡
    P.tube(trim, [sx * 1.22, 2.6, 4.2], [sx * 1.4, 2.6, 4.25], 0.02, 6);
    P.add(G.rbox(0.5, 0.12, 0.6, 0.04), M.flat(0x1c1d1f, 0.8), [sx * 1.0, 1.15, 3.6]); // 前輪上方的擋泥
    P.add(G.cyl(0.24, 0.24, 1.0, 14), M.chrome(), [sx * 1.05, 1.0, 1.9], [PI / 2, 0, 0]); // 油箱
  }
  P.add(G.rbox(1.6, 0.6, 0.06, 0.04), M.chrome(), [0, 1.75, 4.53]); // 水箱罩
  for (let i = 0; i < 6; i++) P.add(G.box(1.5, 0.03, 0.03), trim, [0, 1.52 + i * 0.09, 4.56]);
  P.add(G.rbox(2.5, 0.3, 0.2, 0.06), M.metal(0x3a3c3f, 0.5), [0, 0.92, 4.55]);
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateF, [0, 0.95, 4.66]);
  P.add(G.rbox(2.2, 0.15, 0.4, 0.05), cab, [0, 3.1, 3.6]); // 遮陽
  P.add(G.cyl(0.07, 0.07, 1.4, 10), M.chrome(), [-1.0, 3.2, 2.75]); // 排氣管
  // 底盤
  P.add(G.box(1.0, 0.3, 8.6), M.flat(0x1b1c1e, 0.8), [0, 0.85, -0.2]);
  // 車斗（裝滿砂石）
  const bz0 = -4.5, bz1 = 2.6, bl = bz1 - bz0, bc = (bz0 + bz1) / 2;
  P.add(G.rbox(2.5, 0.15, bl, 0.03), bedM, [0, 1.25, bc]);
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.08, 1.35, bl, 0.03), bedM, [sx * 1.21, 1.95, bc]);
    for (let i = 0; i < 7; i++) P.add(G.rbox(0.06, 1.35, 0.1, 0.02), bedM, [sx * 1.26, 1.95, bz0 + 0.3 + i * (bl - 0.6) / 6]);
    P.add(G.rbox(0.05, 0.08, bl, 0.02), M.metal(0x8b8f93, 0.5), [sx * 1.27, 2.62, bc]);
  }
  P.add(G.rbox(2.5, 1.35, 0.1, 0.03), bedM, [0, 1.95, bz0 + 0.05]);
  P.add(G.rbox(2.5, 1.5, 0.12, 0.03), bedM, [0, 2.0, bz1 - 0.06]);
  P.add(sideExtrude('tr_load', [[bz0 + 0.12, 2.3], [bz1 - 0.15, 2.3], [bz1 - 0.6, 2.75], [bz0 + 1.0, 2.82]], 2.34, 0.05, 3), M.flat(0x9b8a72, 0.95));
  // 車尾
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.22, 0.14, 0.06, 0.03), o.L.tail, [sx * 0.95, 1.05, -4.56]);
    P.add(G.rbox(0.14, 0.12, 0.06, 0.03), o.L.brake, [sx * 0.7, 1.05, -4.56]);
    P.add(G.rbox(0.12, 0.12, 0.06, 0.03), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 1.15, 1.05, -4.56]);
    P.add(G.rbox(0.5, 0.5, 0.03, 0.01), M.flat(0x111111, 0.9), [sx * 0.95, 0.55, -3.45]); // 擋泥片
  }
  P.add(G.rbox(2.2, 0.1, 0.1, 0.03), M.metal(0xd9a520, 0.5), [0, 0.75, -4.55]); // 後保桿（黃）
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateR, [0, 1.3, -4.57]);
  P.build(g);
  for (const sx of [1, -1]) {
    addWheel(g, sx * 1.02, 0.52, 3.6, 0.52, 0.34, 0xc4c8cc, 8);
    addWheel(g, sx * 0.98, 0.52, -1.6, 0.52, 0.46, 0xc4c8cc, 8);
    addWheel(g, sx * 0.98, 0.52, -2.75, 0.52, 0.46, 0xc4c8cc, 8);
  }
  return g;
}

// ---------------------------------------------------------------- 垃圾車
function makeGarbageProto(o) {
  const g = new THREE.Group();
  const P = new Parts();
  const cabM = M.paint(0xdcdedb, 0.1), yellow = M.paint(0xf2c42e, 0.1), trim = M.trim();
  P.add(sideExtrude('gb_cab', [[1.95, 0.95], [3.4, 0.95], [3.5, 1.2], [3.5, 2.3], [3.3, 2.72], [1.95, 2.72]], 2.3, 0.1, 4), cabM);
  P.add(G.rbox(1.95, 0.75, 0.06, 0.04), M.glass(), [0, 2.15, 3.5]);
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.03, 0.65, 0.7, 0.03), M.glass(), [sx * 1.15, 2.2, 3.0]);
    P.add(G.rbox(0.02, 0.18, 1.45, 0.01), M.paint(0x2a64c8, 0.2), [sx * 1.152, 1.4, 2.7]);
    P.add(G.rbox(0.3, 0.16, 0.06, 0.04), o.L.head, [sx * 0.78, 1.25, 3.53]);
    P.add(G.rbox(0.12, 0.1, 0.06, 0.03), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 1.0, 1.25, 3.53]);
    P.add(G.rbox(0.08, 0.45, 0.24, 0.04), trim, [sx * 1.32, 2.2, 3.25]);
    P.tube(trim, [sx * 1.15, 2.3, 3.2], [sx * 1.32, 2.3, 3.25], 0.02, 6);
  }
  P.add(G.rbox(1.4, 0.4, 0.05, 0.03), trim, [0, 1.5, 3.53]);
  P.add(G.rbox(2.35, 0.26, 0.18, 0.06), trim, [0, 0.95, 3.52]);
  P.add(G.rbox(0.36, 0.11, 0.01, 0.005), o.plateF, [0, 1.0, 3.62]);
  P.add(G.box(0.95, 0.28, 6.8), M.flat(0x1b1c1e, 0.8), [0, 0.85, 0]);
  // 壓縮車斗
  P.add(sideExtrude('gb_box', [[-2.75, 1.05], [1.85, 1.05], [1.85, 2.95], [-2.4, 2.95], [-2.75, 2.6]], 2.3, 0.12, 4), yellow);
  for (const sx of [1, -1]) {
    for (let i = 0; i < 5; i++) P.add(G.rbox(0.05, 1.7, 0.08, 0.02), M.paint(0xe0b020, 0.1), [sx * 1.16, 2.0, -2.0 + i * 0.9]);
    P.add(G.plane(1.8, 0.5), o.garbageSign, [sx * 1.2, 2.2, -0.3], [0, sx * PI / 2, 0]);
  }
  // 後方投入口（斜的、深色）
  P.add(sideExtrude('gb_hopper', [[-3.5, 0.9], [-2.75, 0.9], [-2.75, 2.75], [-3.05, 2.6], [-3.5, 1.4]], 2.2, 0.08, 3), M.metal(0x6a6d70, 0.45));
  P.add(G.rbox(1.9, 0.9, 0.05, 0.02), M.flat(0x1e1f21, 0.9), [0, 1.35, -3.5], [0.35, 0, 0]);
  for (const sx of [1, -1]) {
    P.add(G.rbox(0.18, 0.14, 0.06, 0.03), o.L.tail, [sx * 0.95, 1.05, -3.52]);
    P.add(G.rbox(0.12, 0.12, 0.06, 0.03), o.L.brake, [sx * 0.72, 1.05, -3.52]);
    P.add(G.rbox(0.1, 0.1, 0.06, 0.03), sx > 0 ? o.L.blinkL : o.L.blinkR, [sx * 1.1, 1.22, -3.52]);
  }
  // 車頂警示燈（橘）
  P.add(G.cyl(0.11, 0.12, 0.16, 12), o.L.roof, [0.55, 2.84, 2.5]);
  P.add(G.cyl(0.11, 0.12, 0.16, 12), o.L.roof, [-0.55, 2.84, 2.5]);
  P.build(g);
  for (const sx of [1, -1]) {
    addWheel(g, sx * 0.98, 0.48, 2.6, 0.48, 0.3, 0xc4c8cc, 8);
    addWheel(g, sx * 0.94, 0.48, -1.9, 0.48, 0.42, 0xc4c8cc, 8);
  }
  return g;
}

// ---------------------------------------------------------------- 腳踏車（菜籃車）
function makeBicycleProto(o) {
  const g = new THREE.Group();
  const P = new Parts();
  const frame = M.paint(o.color, 0.2), dark = M.metal(0x2a2c2f, 0.4);
  const rearA = [0, 0.33, -0.52], frontA = [0, 0.33, 0.52], bb = [0, 0.3, -0.05], seat = [0, 0.82, -0.28], head = [0, 0.86, 0.38];
  P.tube(frame, rearA, bb, 0.018);
  P.tube(frame, rearA, [0, 0.8, -0.26], 0.016);
  P.tube(frame, bb, [0, 0.8, -0.26], 0.022);
  P.tube(frame, bb, [0, 0.78, 0.34], 0.026); // 低跨下管
  P.tube(frame, [0, 0.78, 0.34], head, 0.024);
  for (const sx of [1, -1]) P.tube(dark, [sx * 0.04, 0.33, 0.52], [sx * 0.03, 0.82, 0.4], 0.012);
  P.tube(dark, [-0.28, 1.0, 0.3], [0.28, 1.0, 0.3], 0.013);
  P.tube(dark, head, [0, 1.0, 0.32], 0.014);
  P.add(G.rbox(0.16, 0.06, 0.24, 0.03), M.flat(0x2a2223, 0.6), [0, 0.88, -0.3]);
  P.add(G.cyl(0.08, 0.08, 0.025, 12), dark, [0.04, 0.3, -0.05], [0, 0, PI / 2]);
  // 前菜籃、後架
  const wire = M.metal(0x9aa0a6, 0.5);
  P.add(G.rbox(0.36, 0.24, 0.3, 0.02), wire, [0, 0.95, 0.58]);
  P.add(G.rbox(0.3, 0.02, 0.36, 0.01), wire, [0, 0.66, -0.55]);
  for (const sx of [1, -1]) {
    P.add(G.torus(0.33, 0.012, 4, 20), M.metal(0xb0b5ba, 0.3), [sx * 0.0, 0.33, -0.52], [0, PI / 2, 0], [1, 1, 1]);
  }
  P.add(G.rbox(0.05, 0.03, 0.03, 0.01), o.L.tail, [0, 0.66, -0.75]);
  P.add(G.rbox(0.06, 0.05, 0.04, 0.02), o.L.head, [0, 0.88, 0.58]);
  if (o.rider) {
    const look = o.look;
    addSeatedRider(P, { ...look, full: false }, { hipY: 0.95, hipZ: -0.3, grip: [0.26, 1.0, 0.3], footY: 0.22, footZ: 0.02, lean: 0.12, kneeZ: 0.1 });
  }
  P.build(g);
  for (const z of [0.52, -0.52]) {
    const w = new THREE.Group();
    w.name = 'wheel'; w.userData.isWheel = true;
    w.position.set(0, 0.33, z);
    const WP = new Parts();
    WP.add(G.torus(0.32, 0.022, 6, 24), M.rubber(), [0, 0, 0], [0, PI / 2, 0]);
    for (let i = 0; i < 6; i++) WP.add(G.box(0.006, 0.6, 0.006), M.chrome(), [0, 0, 0], [i * PI / 6, 0, 0]);
    WP.build(w);
    g.add(w);
  }
  return g;
}

// ---------------------------------------------------------------- 選舉宣傳車（發財車改裝）
const CAMPAIGN_SCHEMES = [
  { bg: '#c8161d', band: '#1b4fb4', big: '#ffe14a', foot: '#ffe14a', footText: '#c8161d' },
  { bg: '#1b4fb4', band: '#c8161d', big: '#ffffff', foot: '#ffe14a', footText: '#1b4fb4' },
  { bg: '#1f8a3c', band: '#ffe14a', big: '#ffffff', foot: '#c8161d', footText: '#ffffff', bandText: '#1f8a3c' },
  { bg: '#e8761d', band: '#1b4fb4', big: '#ffffff', foot: '#ffe14a', footText: '#c8161d' },
];
function drawSilhouette(g, cx, cy, s, color) {
  // 空白人形（頭＋肩），不是真實人物
  g.fillStyle = '#f4f1ea';
  g.beginPath(); g.arc(cx, cy, s * 1.05, 0, Math.PI * 2); g.fill();
  g.save(); g.beginPath(); g.arc(cx, cy, s * 1.05, 0, Math.PI * 2); g.clip();
  g.fillStyle = color;
  g.beginPath(); g.arc(cx, cy - s * 0.28, s * 0.36, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(cx, cy + s * 0.75, s * 0.72, s * 0.5, 0, Math.PI, 0); g.fill();
  g.fillRect(cx - s * 0.72, cy + s * 0.74, s * 1.44, s * 0.6);
  g.restore();
}
function campaignTextures(no, sc) {
  const key = `camp${no}|${sc.bg}`;
  const board = canvasTex(key + 'board', 1024, 512, (g, w, h) => {
    g.fillStyle = sc.bg; g.fillRect(0, 0, w, h);
    g.fillStyle = sc.band; g.fillRect(0, 0, w, 110);
    g.fillStyle = sc.foot; g.fillRect(0, h - 110, w, 110);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = sc.bandText ?? '#ffffff'; g.font = `900 80px ${FONT}`;
    g.fillText(`懇請支持 ${no} 號`, w * 0.6, 58);
    drawSilhouette(g, 190, h / 2, 120, '#8d939b');
    g.fillStyle = sc.big; g.font = `900 200px ${FONT}`;
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 10;
    g.strokeText('凍蒜！', w * 0.65, h / 2 + 8); g.fillText('凍蒜！', w * 0.65, h / 2 + 8);
    g.fillStyle = sc.footText; g.font = `900 78px ${FONT}`;
    g.fillText(`拜託拜託　${no} 號`, w / 2, h - 52);
    g.strokeStyle = '#ffffff'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
  });
  const rear = canvasTex(key + 'rear', 512, 256, (g, w, h) => {
    g.fillStyle = sc.foot; g.fillRect(0, 0, w, h);
    g.fillStyle = sc.bg; g.beginPath(); g.arc(110, h / 2, 92, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.font = `900 130px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(no), 110, h / 2 + 6);
    g.fillStyle = sc.footText; g.font = `900 92px ${FONT}`;
    g.fillText('拜託', 350, 80); g.fillText('拜託', 350, 185);
  });
  const banner = canvasTex(key + 'banner', 512, 96, (g, w, h) => {
    g.fillStyle = '#c8161d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffe14a'; g.font = `900 64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${no} 號　凍蒜！`, w / 2, h / 2 + 3);
  });
  return {
    board: M.map(key + 'board', board, { roughness: 0.55 }),
    rear: M.map(key + 'rear', rear, { roughness: 0.55 }),
    banner: M.map(key + 'banner', banner, { roughness: 0.8, side: THREE.DoubleSide }),
  };
}
function makeCampaignProto(o) {
  const vr = rng(o.seed + 501);
  const no = pick(vr, [3, 5, 7, 7, 9, 12]);
  const sc = pick(vr, CAMPAIGN_SCHEMES);
  const T = campaignTextures(no, sc);
  const steel = M.metal(0x9aa0a6, 0.45), white = M.flat(0xc8cac6, 0.45), dark = M.trim();
  o.noCargo = true;
  o.extra = (P) => {
    // 車斗上的看板：兩面朝左右，下有鐵架
    P.add(G.box(0.07, 1.3, 2.7), T.board, [0, 1.92, -0.75]);
    P.add(G.box(0.1, 0.06, 2.8), steel, [0, 1.25, -0.75]);
    P.add(G.box(0.1, 0.06, 2.8), steel, [0, 2.6, -0.75]);
    for (const z of [-2.0, -0.75, 0.5]) P.add(G.box(0.08, 1.5, 0.08), steel, [0, 1.55, z]);
    for (const z of [-1.9, 0.4]) for (const sx of [1, -1]) P.tube(steel, [0, 1.25, z], [sx * 0.7, 0.82, z], 0.022, 5); // 斜撐
    // 車尾面板（朝後）
    P.add(G.box(1.4, 0.7, 0.05), T.rear, [0, 1.35, -2.27]);
    // 車頭布條
    P.add(G.plane(1.55, 0.29), T.banner, [0, 0.86, 2.36]);
    for (const sx of [1, -1]) P.tube(M.flat(0xf2f2f2, 0.8), [sx * 0.77, 0.86, 2.34], [sx * 0.82, 1.05, 2.25], 0.008, 4); // 綁繩
    // 車頂四顆號角喇叭（前後左右）
    P.add(G.box(1.1, 0.06, 0.9), steel, [0, 2.02, 1.55]);
    P.add(G.box(0.12, 0.25, 0.12), dark, [0, 2.15, 1.55]);
    const horns = [[0, 0.3, 0], [PI, -0.3, 0], [PI / 2, 0, 0.3], [-PI / 2, 0, -0.3]];
    for (const [ry, dz, dx] of horns) {
      // 圓錐開口朝外：先轉成沿 +Z，再繞 Y 轉向
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-PI / 2 - 0.1, ry, 0, 'YXZ'));
      P.addM(G.cone(0.19, 0.38, 10, true), white, new THREE.Matrix4().compose(new THREE.Vector3(dx, 2.33, 1.55 + dz), q, new THREE.Vector3(1, 1, 1)));
      P.addM(G.cyl(0.07, 0.07, 0.14, 8), M.flat(0x5d6166, 0.5), new THREE.Matrix4().compose(new THREE.Vector3(dx * 0.3, 2.33, 1.55 + dz * 0.3), q, new THREE.Vector3(1, 1, 1)));
    }
    // 彩旗：車斗四角
    const flagCols = [0xd8262c, 0xf2c42e, 0x2f62b8, 0x2f9a4f];
    [[0.8, 0.75], [-0.8, 0.75], [0.8, -2.15], [-0.8, -2.15]].forEach(([x, z], i) => {
      P.add(G.cyl(0.015, 0.015, 2.1, 5, true), M.flat(0xdddddd, 0.4), [x, 1.85, z]);
      P.add(G.box(0.012, 0.85, 0.36), M.flat(flagCols[(i + no) % 4], 0.8), [x, 2.4, z - 0.19]);
    });
  };
  const inner = makePickupProto(o);
  // 4.6×1.7 的發財車放大成 4.8×1.8
  const g = new THREE.Group();
  inner.scale.set(1.8 / 1.7, 1, 4.8 / 4.6);
  g.add(inner);
  return g;
}

// ---------------------------------------------------------------- 停放機車（街景合併用，單一幾何、頂點色）
const PARKED = new Map();
const PARKED_COLORS = [0xdcdcd8, 0x1f2124, 0xc42a2a, 0x2e5fb8, 0x8fa3b5, 0xe8c54a, 0x9b1b30, 0x75b6d9];
/**
 * 停放機車的 BufferGeometry（無騎士）：屬性只有 position／normal／uv（全 0）／color（頂點色，線性空間），
 * 原點在地面中心、車頭 +Z。同 seed（同外觀）回傳同一份快取。主程式用 vertexColors 的材質畫。
 */
export function makeParkedScooterGeo(seed = 0) {
  seed = seed >>> 0;
  const r = rng(Math.imul(seed, 2654435761) + 11);
  const ci = Math.floor(r() * PARKED_COLORS.length);
  const accentType = Math.floor(r() * 3);       // 0 同色、1 黑、2 白／銀
  const extra = Math.floor(r() * 4);            // 0 無、1 安全帽、2 後箱、3 安全帽＋後箱
  const helmetCol = Math.floor(r() * HELMETS.length);
  const boxDark = r() < 0.5;
  const key = `${ci}|${accentType}|${extra}|${extra & 1 ? helmetCol : 0}|${extra & 2 ? boxDark : 0}`;
  let geo = PARKED.get(key);
  if (geo) return geo;
  const body = PARKED_COLORS[ci];
  const accent = accentType === 0 ? body : accentType === 1 ? 0x1f2124 : (body === 0xdcdcd8 ? 0x9aa0a8 : 0xd6d6d2);
  const P = new Parts();
  const vc = M.vc();
  const add = (g, c, pos = [0, 0, 0], rot = [0, 0, 0]) => P.add(g, vc, pos, rot, [1, 1, 1], c);
  const clamp = THREE.MathUtils.clamp;
  // 前擋板、車身後段（無倒角的擠出，面少）
  add(sideExtrude('pk_front', [[0.3, 0.3], [0.5, 0.29], [0.64, 0.42], [0.71, 0.66], [0.66, 0.9], [0.56, 0.98], [0.47, 0.95], [0.41, 0.8], [0.35, 0.52]], 0.44, 0, 1,
    (y, z) => (1 - 0.32 * clamp((y - 0.35) / 0.65, 0, 1)) * (1 - 0.35 * clamp((z - 0.5) / 0.22, 0, 1))), accent);
  add(sideExtrude('pk_rear', [[-0.98, 0.44], [-0.6, 0.33], [-0.12, 0.3], [-0.08, 0.5], [-0.16, 0.74], [-0.7, 0.8], [-0.94, 0.76], [-1.0, 0.64]], 0.39, 0, 1,
    (y, z) => (1 - 0.3 * clamp((-0.6 - z) / 0.4, 0, 1)) * (0.88 + 0.12 * clamp((0.8 - y) / 0.3, 0, 1))), body);
  add(G.box(0.36, 0.06, 0.6), 0x2a2c2f, [0, 0.32, 0.08]);           // 腳踏板
  add(G.box(0.32, 0.12, 0.56), body, [0, 0.25, 0.07]);              // 側裙
  add(G.rbox(0.31, 0.12, 0.76, 0.05), 0x1e1e20, [0, 0.85, -0.48]);  // 坐墊
  add(G.box(0.34, 0.035, 0.18), 0x2a2c2f, [0, 0.86, -0.9]);         // 後扶手
  add(G.box(0.15, 0.2, 0.52), 0x6e7276, [0.11, 0.3, -0.42]);         // 引擎
  add(G.cyl(0.055, 0.055, 0.4, 6, true), 0x2e3033, [-0.17, 0.3, -0.62], [PI / 2 - 0.12, 0, 0]); // 排氣管
  add(G.box(0.2, 0.06, 0.06), 0x9b1a1e, [0, 0.73, -0.98]);           // 尾燈
  add(G.box(0.19, 0.11, 0.012), 0xdcdcd6, [0, 0.56, -1.03], [-0.25, 0, 0]); // 牌照
  // 龍頭
  add(G.box(0.08, 0.6, 0.06), 0x2d2f32, [0, 0.56, 0.6], [-0.22, 0, 0]); // 前叉
  add(G.box(0.15, 0.05, 0.4), accent, [0, 0.55, 0.66], [-0.17, 0, 0]);    // 前土除
  add(G.rbox(0.44, 0.13, 0.23, 0.05), accent, [0, 1.02, 0.47]);           // 把手蓋
  add(G.box(0.19, 0.07, 0.04), 0xe8ecef, [0, 1.02, 0.59]);                 // 大燈
  add(G.cyl(0.016, 0.016, 0.66, 4, true), 0x1c1c1e, [0, 1.03, 0.42], [0, 0, PI / 2]); // 把手
  for (const sx of [1, -1]) add(G.box(0.1, 0.065, 0.02), 0x1f2225, [sx * 0.26, 1.25, 0.4], [0, sx * 0.15, 0]); // 後照鏡
  for (const sx of [1, -1]) add(G.box(0.012, 0.2, 0.012), 0x2a2c2f, [sx * 0.22, 1.14, 0.41], [0, 0, sx * -0.35]);
  // 輪子：胎＋輪框兩層低面數圓柱
  for (const z of [0.64, -0.6]) {
    add(G.cyl(0.255, 0.255, 0.11, 8), 0x1a1a1c, [0, 0.255, z], [0, 0, PI / 2]);
    add(G.cyl(0.15, 0.15, 0.118, 6), 0x3a3d40, [0, 0.255, z], [0, 0, PI / 2]);
  }
  // 掛在後照鏡上的安全帽、後箱
  if (extra & 1) add(G.sph(0.14, 7, 4, 0, PI * 0.55), HELMETS[helmetCol], [0.24, 0.98, 0.36], [0.3, 0, 0.4]);
  if (extra & 2) add(G.rbox(0.38, 0.28, 0.36, 0.05), boxDark ? 0x26282b : 0xbfc3c7, [0, 1.05, -0.86]);
  geo = mergeGeometries(P.byMat.get(vc), false);
  P.byMat.clear();
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  geo.attributes.uv.array.fill(0);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  PARKED.set(key, geo);
  return geo;
}

// ---------------------------------------------------------------- 原型快取與 clone
const PROTOS = new Map();
function cloneProto(proto, opts) {
  const g = proto.clone(true);
  const lights = { head: [], tail: [], brake: [], blinkL: [], blinkR: [], roof: [] };
  const remap = new Map();
  const wheels = [];
  let frontSteer = null, doorFL = null, rider = null;
  g.traverse((o) => {
    if (o.isMesh && o.material && o.material.userData.role) {
      let m = remap.get(o.material);
      if (!m) {
        m = o.material.clone();
        m.userData = { ...o.material.userData };
        remap.set(o.material, m);
        lights[m.userData.role].push(m);
      }
      o.material = m;
    }
    if (o.userData.isWheel) wheels.push(o);
    if (o.name === 'steer') frontSteer = o;
    if (o.name === 'doorFL') doorFL = o;
    if (o.name === 'rider') rider = o;
  });
  const night = !!opts.night;
  for (const m of lights.head) m.emissiveIntensity = night ? m.userData.on : 0;
  for (const m of lights.tail) m.emissiveIntensity = night ? m.userData.on : 0;
  for (const m of lights.roof) m.emissiveIntensity = proto.userData.roofAlwaysOn ? (night ? m.userData.on : m.userData.on * 0.35) : 0;
  g.userData = { ...proto.userData, wheels, frontSteer, doorFL, rider, lights, doorOpenSign: -1 };
  return g;
}

const DIMS = {
  scooter: [1.9, 0.75], oldscooter: [1.9, 0.75], car: [4.5, 1.8], taxi: [4.6, 1.8], pickup: [4.6, 1.7],
  bus: [11, 2.5], truck: [9, 2.5], garbage: [7, 2.3], bicycle: [1.8, 0.6], campaign: [4.8, 1.8],
};

/**
 * 交通車輛。kind: 'scooter'|'car'|'taxi'|'pickup'|'bus'|'truck'|'garbage'|'bicycle'|'oldscooter'|'campaign'（選舉宣傳車）
 * opts: { seed, color, rider = true, cargo: 'basket'|'delivery'|null, night = false, raincoat = false }
 */
export function makeVehicle(kind, opts = {}) {
  const seed = (opts.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
  const r = rng(seed);
  const rider = opts.rider ?? true;
  let variant, color = opts.color, cargo = opts.cargo ?? null, extra = '';
  switch (kind) {
    case 'scooter':
      color ??= pick(r, SCOOTER_COLORS);
      if (opts.cargo === undefined) cargo = r() < 0.12 ? 'delivery' : (r() < 0.12 ? 'basket' : null);
      variant = Math.floor(r() * 8); extra = `${opts.raincoat ? 'rc' : ''}`; break;
    case 'oldscooter':
      color ??= pick(r, [0x8f2a25, 0x2d4f7a, 0x6f6b5c, 0xbcb5a2, 0x4d5c45]);
      if (opts.cargo === undefined) cargo = 'basket';
      variant = Math.floor(r() * 4); extra = opts.raincoat ? 'rc' : ''; break;
    case 'car': color ??= pick(r, CAR_COLORS); variant = Math.floor(r() * 6); break;
    case 'taxi': color ??= 0xf5c518; variant = Math.floor(r() * 4); break;
    case 'pickup': color ??= pick(r, [0x2f62b8, 0xf0f0ec, 0x2f62b8, 0x9aa3ab]); variant = Math.floor(r() * 4); break;
    case 'campaign': color ??= pick(r, [0xe6e6e2, 0x2f62b8]); variant = Math.floor(r() * 6); break;
    case 'bus': color ??= pick(r, [0x1c8a4a, 0xd2312b, 0x1f5fc4, 0xe28a1b]); variant = Math.floor(r() * 4); break;
    case 'truck': color ??= pick(r, [0xe9a21c, 0xe3c11f, 0xd2701d]); variant = Math.floor(r() * 3); break;
    case 'garbage': color ??= 0xf2c42e; variant = 0; break;
    case 'bicycle': color ??= pick(r, [0xe0e0dc, 0x2b6cb0, 0xc23a5a, 0x3a3a3e, 0x8fbf6f]); variant = Math.floor(r() * 6); break;
    default: throw new Error('unknown vehicle kind ' + kind);
  }
  const key = `${kind}|${hexKey(color)}|${cargo}|${rider}|${variant}|${extra}`;
  let proto = PROTOS.get(key);
  if (!proto) {
    const vr = rng(variant * 7919 + 13 + kind.length * 101);
    const L = {};
    for (const role of Object.keys(LIGHT_DEF)) L[role] = lightMat(role, kind === 'garbage' && role === 'roof' ? { color: 0xd88a1a, emissive: 0xff8a10, on: 3 } : null);
    const o = { kind, color, cargo, rider, L, seed: variant * 31 + 7, look: riderLook(vr, { raincoat: opts.raincoat }) };
    const plateKind = kind === 'taxi' ? 'taxi' : kind === 'bus' ? 'bus' : (kind.includes('scooter') ? 'scooter' : 'car');
    const red = kind === 'taxi' || kind === 'bus' || kind === 'truck' || kind === 'garbage';
    o.plateF = plateMat(plateText(vr, plateKind), red);
    o.plateR = plateMat(plateText(vr, plateKind), red);
    o.plate = o.plateR;
    if (kind === 'scooter') {
      o.accent = vr() < 0.4 ? pick(vr, [0x1f2124, 0xf2f2ef, 0x9aa0a8]) : color;
      o.stripe = pick(vr, [0xc8c8c8, 0x1f2124, 0xd23a3a]);
      o.deliveryColor = pick(vr, [0xe02a6a, 0x1fa36a, 0xf0a020]);
      if (o.look.raincoat) o.look.full = false;
      proto = makeScooterProto(o);
    } else if (kind === 'oldscooter') {
      o.old = true;
      o.seat = 0x4a2a22;
      o.look = { ...riderLook(vr, { raincoat: opts.raincoat }), shirt: pick(vr, [0xeeeeea, 0x8e8a80, 0x5d6b7a]), pants: pick(vr, [0x3a3a3c, 0x4a4436]), skin: pick(vr, [0xc99470, 0xb07e5a]), full: false, visor: false };
      o.hat = vr() < 0.5 ? 'conical' : 'cap';
      proto = makeScooterProto(o);
    } else if (kind === 'car' || kind === 'taxi') {
      o.taxi = kind === 'taxi';
      if (o.taxi) {
        o.taxiSign = M.map('taxisign', canvasTex('taxisign', 256, 72, (g2, w, h) => {
          g2.fillStyle = '#fff6c8'; g2.fillRect(0, 0, w, h);
          g2.fillStyle = '#1b1b1b'; g2.font = `900 54px ${FONT}`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
          g2.fillText('TAXI', w / 2, h / 2 + 3);
        }), { emissive: 0xffffff, emissiveMap: null, roughness: 0.4 });
        o.taxiSign.emissiveMap = o.taxiSign.map; o.taxiSign.emissiveIntensity = 0.6;
        o.taxiDoor = M.map('taxidoor', canvasTex('taxidoor', 256, 64, (g2, w, h) => {
          g2.clearRect(0, 0, w, h);
          g2.fillStyle = '#1b1b1b'; g2.font = `900 46px ${FONT}`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
          g2.fillText('計程車', w / 2, h / 2 + 2);
        }), { transparent: true, roughness: 0.4 });
      }
      o.rim = vr() < 0.5 ? 0xb7bcc1 : 0x6d7277;
      proto = makeCarProto(o);
      proto.userData.roofAlwaysOn = o.taxi;
    } else if (kind === 'pickup') {
      o.railColor = vr() < 0.5 ? 'paint' : 'metal';
      proto = makePickupProto(o);
    } else if (kind === 'campaign') {
      o.railColor = 'metal';
      proto = makeCampaignProto(o);
    } else if (kind === 'bus') {
      const routes = [['307', '板橋'], ['262', '民生社區'], ['藍1', '捷運站'], ['15', '台北車站'], ['905', '市政府'], ['橘2', '永和']];
      const [no, dest] = pick(vr, routes);
      o.routeSign = M.map('route' + no, canvasTex('route' + no, 512, 64, (g2, w, h) => {
        g2.fillStyle = '#0c0a06'; g2.fillRect(0, 0, w, h);
        g2.fillStyle = '#ffae1a'; g2.font = `900 50px ${FONT}`; g2.textBaseline = 'middle';
        g2.textAlign = 'left'; g2.fillText(no, 14, h / 2 + 2);
        g2.textAlign = 'right'; g2.fillText(dest, w - 14, h / 2 + 2);
      }), { emissive: 0xffffff, roughness: 0.5 });
      o.routeSign.emissiveMap = o.routeSign.map; o.routeSign.emissiveIntensity = 1.6;
      proto = makeBusProto(o);
    } else if (kind === 'truck') {
      o.bedColor = pick(vr, [0x6e2f22, 0x3d4a3a, 0x5a5d61]);
      proto = makeTruckProto(o);
    } else if (kind === 'garbage') {
      o.garbageSign = M.map('garbagesign', canvasTex('garbagesign', 512, 140, (g2, w, h) => {
        g2.clearRect(0, 0, w, h);
        g2.fillStyle = '#1e5fc0'; g2.font = `900 96px ${FONT}`; g2.textAlign = 'center'; g2.textBaseline = 'middle';
        g2.fillText('清潔隊', w / 2, h / 2 + 4);
      }), { transparent: true, roughness: 0.4 });
      proto = makeGarbageProto(o);
      proto.userData.roofAlwaysOn = false;
    } else if (kind === 'bicycle') {
      o.look = { ...o.look, full: false };
      proto = makeBicycleProto(o);
    }
    const [len, wid] = DIMS[kind];
    proto.userData.kind = kind;
    proto.userData.length = len;
    proto.userData.width = wid;
    PROTOS.set(key, proto);
  }
  return cloneProto(proto, opts);
}

// ---------------------------------------------------------------- 行人
function buildPerson(look, o = {}) {
  const g = new THREE.Group();
  const vc = M.vc();
  const P = new Parts();
  const hipY = 0.9;
  const shirt = o.raincoat ? o.raincoatColor : look.shirt;
  // 軀幹、骨盆
  P.add(G.torso(0.38, 0.52, 0.22), vc, [0, hipY + 0.3, 0], [0, 0, 0], [1, 1, 1], shirt);
  for (const sx of [1, -1]) P.add(G.sph(0.07, 8, 6), vc, [sx * 0.2, hipY + 0.5, 0], [0, 0, 0], [1, 1, 1], shirt); // 肩
  P.add(G.rbox(0.32, 0.16, 0.19, 0.06), vc, [0, hipY + 0.03, 0], [0, 0, 0], [1, 1, 1], look.skirt ?? look.pants);
  if (look.skirt) P.add(G.cone(0.24, 0.36, 10, true), vc, [0, hipY - 0.12, 0], [0, 0, 0], [1, 1, 0.8], look.skirt);
  // 頭頸與頭髮
  const headY = hipY + 0.71;
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, headY, 0);
  P.add(G.cyl(0.045, 0.05, 0.1, 8), vc, [0, headY - 0.14, 0], [0, 0, 0], [1, 1, 1], look.skin);
  const HP = new Parts();
  HP.add(G.sph(0.105, 10, 8), vc, [0, 0, 0], [0, 0, 0], [0.95, 1.05, 1], look.skin);
  HP.add(G.sph(0.112, 12, 6, 0, PI * (look.longHair ? 0.62 : 0.48)), vc, [0, 0.01, -0.01], [-0.25, 0, 0], [1, 1, 1.05], look.hair);
  if (look.longHair) HP.add(G.rbox(0.2, 0.3, 0.06, 0.03), vc, [0, -0.09, -0.08], [0, 0, 0], [1, 1, 1], look.hair);
  if (look.ponytail) HP.add(G.cap(0.035, 0.12, 2, 6), vc, [0, -0.03, -0.14], [0.6, 0, 0], [1, 1, 1], look.hair);
  if (look.cap) HP.add(G.sph(0.115, 12, 5, 0, PI * 0.42), vc, [0, 0.02, 0], [-0.1, 0, 0], [1, 1, 1], look.cap), HP.add(G.rbox(0.18, 0.015, 0.12, 0.006), vc, [0, 0.03, 0.12], [-0.15, 0, 0], [1, 1, 1], look.cap);
  if (look.glasses) for (const sx of [1, -1]) HP.add(G.torus(0.024, 0.0045, 3, 10), M.vc(0.3), [sx * 0.038, 0.01, 0.1], [0, 0, 0], [1, 1, 1], 0x1a1a1a);
  if (o.raincoat) HP.add(G.sph(0.135, 12, 6, 0, PI * 0.62), M.vcGloss(), [0, 0.02, -0.02], [-0.2, 0, 0], [1, 1, 1.1], o.raincoatColor);
  HP.build(head);
  if (o.phone) head.rotation.x = 0.45;
  g.add(head);
  if (o.raincoat) P.add(G.cone(0.36, 0.95, 14, true), M.vcGloss(), [0, hipY + 0.15, 0], [0, 0, 0], [1, 1, 0.75], o.raincoatColor);
  P.build(g);
  // 四肢（各自一個網格，給主程式擺動）
  const mkLimb = (name, x, y, len, r, top, bottom, end) => {
    const n = new THREE.Group();
    n.name = name;
    n.position.set(x, y, 0);
    const LP = new Parts();
    LP.limb(vc, [0, -0.02, 0], [0, -len * 0.5, 0], r, top);
    LP.limb(vc, [0, -len * 0.5, 0], [0, -len, 0.0], r * 0.86, bottom);
    if (end) end(LP, len);
    LP.build(n);
    g.add(n);
    return n;
  };
  const legLen = hipY - 0.08;
  const shoe = (LP, len) => LP.add(G.rbox(0.11, 0.08, 0.25, 0.035), vc, [0, -len - 0.04, 0.05], [0, 0, 0], [1, 1, 1], look.shoes);
  const legL = mkLimb('legL', 0.095, hipY, legLen, 0.08, look.pants, look.skirt ? look.skin : look.pants, shoe);
  const legR = mkLimb('legR', -0.095, hipY, legLen, 0.08, look.pants, look.skirt ? look.skin : look.pants, shoe);
  const sleeve = look.shortSleeve ? look.skin : shirt;
  const hand = (LP, len) => LP.add(G.sph(0.045, 6, 5), vc, [0, -len - 0.02, 0], [0, 0, 0], [1, 1.1, 1], look.skin);
  const armL = mkLimb('armL', 0.23, hipY + 0.5, 0.56, 0.058, shirt, sleeve, (LP, len) => {
    hand(LP, len);
    if (o.bag) LP.add(G.sph(0.15, 10, 8), M.vcGloss(), [0, -len - 0.18, 0], [0, 0, 0], [1, 1.1, 0.9], o.bagColor ?? 0x111111);
  });
  const armR = mkLimb('armR', -0.23, hipY + 0.5, 0.56, 0.058, shirt, sleeve, (LP, len) => {
    hand(LP, len);
    if (o.phone) {
      LP.add(G.rbox(0.075, 0.15, 0.012, 0.01), M.vc(0.3), [0, -len - 0.04, 0.03], [0, 0, 0], [1, 1, 1], 0x111111);
      LP.add(G.box(0.062, 0.13, 0.004), M.screen(), [0, -len - 0.04, 0.0375]);
    }
    if (o.umbrella) {
      LP.add(G.cyl(0.01, 0.01, 0.9, 6), M.vc(0.4), [0, -len + 0.38, 0], [0, 0, 0], [1, 1, 1], 0x333333);
      LP.add(G.cone(0.55, 0.28, 12, true), M.vcGloss(), [0, -len + 0.9, 0], [0, 0, 0], [1, 1, 1], o.umbrellaColor ?? 0x2f6fd0);
    }
  });
  if (o.phone) { armR.rotation.x = -1.25; armR.rotation.z = 0.25; }
  if (o.umbrella) armR.rotation.x = -0.6;
  g.userData = { legL, legR, armL, armR, head, phone: !!o.phone, length: 0.5, width: 0.5 };
  return g;
}

const PED_PROTOS = new Map();
/** 行人。opts: { seed, phone, bag, raincoat, umbrella, look } userData: { legL, legR, armL, armR, head } */
export function makePedestrian(opts = {}) {
  const seed = (opts.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
  const r = rng(seed);
  const variant = Math.floor(r() * 24);
  const key = `${variant}|${!!opts.phone}|${!!opts.bag}|${!!opts.raincoat}|${!!opts.umbrella}|${opts.look ?? ''}`;
  let proto = PED_PROTOS.get(key);
  if (!proto) {
    const vr = rng(variant * 104729 + 3);
    const female = vr() < 0.5;
    const elder = vr() < 0.2;
    let look = {
      skin: pick(vr, SKINS), hair: elder ? pick(vr, [0x8a8580, 0xb5b0aa, 0x5a5550]) : pick(vr, HAIRS),
      shirt: pick(vr, SHIRTS), pants: pick(vr, PANTS), shoes: pick(vr, [0x1c1c1e, 0xcfcfca, 0x6b4a33, 0x3b5ea8]),
      longHair: female && vr() < 0.7, ponytail: female && vr() < 0.3, cap: !female && vr() < 0.25 ? pick(vr, [0x1f3a68, 0x111111, 0xc23a2a]) : null,
      glasses: vr() < 0.3, shortSleeve: vr() < 0.55, skirt: female && vr() < 0.3 ? pick(vr, [0x2a3346, 0xc9a3b5, 0x6d5a45, 0x1d1f24]) : null,
    };
    if (opts.look === 'bearer') look = { ...look, shirt: 0xf2c42e, pants: 0x1d1f24, cap: 0xd12a2a, longHair: false, skirt: null, shortSleeve: true };
    if (opts.look === 'flag') look = { ...look, shirt: 0xd23a2a, pants: 0x1d1f24, longHair: false, skirt: null };
    proto = buildPerson(look, {
      phone: opts.phone, bag: opts.bag, bagColor: vr() < 0.6 ? 0x111111 : 0xf2f2f2,
      raincoat: opts.raincoat, raincoatColor: pick(vr, RAINCOATS), umbrella: opts.umbrella, umbrellaColor: pick(vr, [0x2f6fd0, 0xd23a3a, 0x222222, 0x3aa35a, 0xe8b92a]),
    });
    PED_PROTOS.set(key, proto);
  }
  const g = proto.clone(true);
  const ud = { ...proto.userData };
  g.traverse((o) => { if (['legL', 'legR', 'armL', 'armR', 'head'].includes(o.name)) ud[o.name] = o; });
  g.userData = ud;
  return g;
}

// ---------------------------------------------------------------- 狗（台灣土狗）
const DOG_PROTOS = new Map();
export function makeDog(opts = {}) {
  const seed = (opts.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
  const r = rng(seed);
  const color = opts.color ?? pick(r, [0xc8913f, 0x2a2622, 0xc8913f, 0xd8b98a, 0x3a3029]);
  const key = hexKey(color);
  let proto = DOG_PROTOS.get(key);
  if (!proto) {
    const g = new THREE.Group();
    const vc = M.vc(0.8);
    const P = new Parts();
    const light = color === 0x2a2622 || color === 0x3a3029 ? 0xb88a52 : 0xf1e2c4;
    P.add(G.cap(0.12, 0.34, 2, 8), vc, [0, 0.42, -0.02], [PI / 2, 0, 0], [1, 1.05, 1], color);
    P.add(G.sph(0.1, 10, 8), vc, [0, 0.39, 0.12], [0, 0, 0], [1, 0.9, 1.1], light); // 胸
    P.add(G.sph(0.105, 10, 8), vc, [0, 0.58, 0.28], [0, 0, 0], [1, 0.95, 1.05], color); // 頭
    P.add(G.rbox(0.09, 0.08, 0.13, 0.035), vc, [0, 0.54, 0.39], [0.15, 0, 0], [1, 1, 1], light); // 嘴
    P.add(G.sph(0.022, 8, 6), vc, [0, 0.565, 0.455], [0, 0, 0], [1, 1, 1], 0x111111); // 鼻
    for (const sx of [1, -1]) {
      P.add(G.cone(0.045, 0.1, 6), vc, [sx * 0.06, 0.68, 0.26], [0, 0, sx * -0.25], [1, 1, 0.6], color); // 耳
      P.add(G.sph(0.016, 6, 5), vc, [sx * 0.045, 0.6, 0.37], [0, 0, 0], [1, 1, 1], 0x111111); // 眼
    }
    P.add(G.torus(0.08, 0.022, 4, 8, PI * 1.3), vc, [0, 0.55, -0.27], [0, PI / 2, 0.4], [1, 1, 1], color); // 捲尾巴
    P.build(g);
    const legs = [];
    for (const [x, z] of [[0.07, 0.15], [-0.07, 0.15], [0.07, -0.18], [-0.07, -0.18]]) {
      const n = new THREE.Group();
      n.position.set(x, 0.36, z);
      const LP = new Parts();
      LP.limb(vc, [0, 0, 0], [0, -0.33, 0], 0.03, color, 1, 5);
      LP.add(G.box(0.05, 0.03, 0.07), vc, [0, -0.345, 0.015], [0, 0, 0], [1, 1, 1], light);
      LP.build(n);
      g.add(n);
      legs.push(n);
    }
    g.userData = { legs, length: 0.8, width: 0.3 };
    proto = g;
    DOG_PROTOS.set(key, proto);
  }
  const g = proto.clone(true);
  g.userData = { ...proto.userData, legs: g.children.filter((c) => c.isGroup) };
  return g;
}

// ---------------------------------------------------------------- 玩家機車
// Komugi：戴耳機的柴犬，站在腳踏板上
function addKomugi(P, x, y, z) {
  const vc = M.vc(0.8);
  const orange = 0xd9853a, cream = 0xf6e7cc, dark = 0x1a1a1a;
  P.add(G.cap(0.075, 0.2, 3, 10), vc, [x, y + 0.24, z], [PI / 2, 0, 0], [1, 1.05, 1], orange);
  P.add(G.sph(0.07, 10, 8), vc, [x, y + 0.22, z + 0.08], [0, 0, 0], [1, 0.95, 1.05], cream);
  for (const [lx, lz] of [[0.04, 0.08], [-0.04, 0.08], [0.04, -0.09], [-0.04, -0.09]]) {
    P.limb(vc, [x + lx, y + 0.2, z + lz], [x + lx, y + 0.03, z + lz], 0.022, orange, 2, 6);
    P.add(G.sph(0.024, 6, 5), vc, [x + lx, y + 0.02, z + lz + 0.01], [0, 0, 0], [1, 0.7, 1.3], cream);
  }
  // 頭（稍微抬高、往前看）
  const hy = y + 0.45, hz = z + 0.16;
  P.limb(vc, [x, y + 0.3, z + 0.1], [x, hy - 0.04, hz - 0.02], 0.05, orange, 1, 6); // 脖子（伸長往外看）
  P.add(G.sph(0.082, 12, 10), vc, [x, hy, hz], [0, 0, 0], [1.05, 0.95, 1], orange);
  P.add(G.sph(0.06, 10, 8), vc, [x, hy - 0.035, hz + 0.045], [0, 0, 0], [1.05, 0.8, 1], cream); // 臉頰
  P.add(G.rbox(0.065, 0.05, 0.08, 0.024), vc, [x, hy - 0.025, hz + 0.085], [0.1, 0, 0], [1, 1, 1], cream); // 嘴
  P.add(G.sph(0.016, 8, 6), vc, [x, hy - 0.005, hz + 0.128], [0, 0, 0], [1, 0.8, 1], dark);
  for (const sx of [1, -1]) {
    P.add(G.cone(0.034, 0.075, 6), vc, [x + sx * 0.048, hy + 0.08, hz - 0.01], [0, 0, sx * -0.22], [1, 1, 0.55], orange);
    P.add(G.cone(0.02, 0.05, 6), vc, [x + sx * 0.048, hy + 0.075, hz + 0.0], [0, 0, sx * -0.22], [1, 1, 0.4], 0xf3d3b0);
    P.add(G.sph(0.012, 6, 5), vc, [x + sx * 0.03, hy + 0.015, hz + 0.075], [0, 0, 0], [1, 1, 1], dark);
    P.add(G.sph(0.012, 6, 5), vc, [x + sx * 0.042, hy + 0.035, hz + 0.065], [0, 0, 0], [1.6, 0.6, 1], cream); // 麻呂眉
    // 耳機耳罩
    P.add(G.cyl(0.03, 0.03, 0.025, 12), M.vcGloss(), [x + sx * 0.083, hy + 0.005, hz - 0.005], [0, 0, PI / 2], [1, 1, 1], 0xd2262a);
    P.add(G.cyl(0.022, 0.022, 0.027, 10), M.vcGloss(), [x + sx * 0.085, hy + 0.005, hz - 0.005], [0, 0, PI / 2], [1, 1, 1], 0x1b1b1d);
  }
  P.add(G.torus(0.085, 0.009, 4, 14, PI), M.vcGloss(), [x, hy + 0.005, hz - 0.005], [0, PI / 2, 0], [1, 1.12, 1], 0x1b1b1d); // 頭帶
  P.add(G.torus(0.05, 0.018, 5, 10, PI * 1.4), vc, [x, y + 0.34, z - 0.14], [0, PI / 2, 0.6], [1, 1, 1], orange); // 捲尾
  P.add(G.sph(0.022, 6, 5), vc, [x, y + 0.38, z - 0.13], [0, 0, 0], [1, 1, 1], cream);
}

/** 玩家機車。opts: { passenger: 'komugi'|'wife', raincoat } */
export function makePlayerBike(opts = {}) {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  lean.name = 'lean';
  root.add(lean);
  const L = { head: lightMat('head'), tail: lightMat('tail'), brake: lightMat('brake'), blinkL: lightMat('blinkL'), blinkR: lightMat('blinkR') };
  const o = {
    kind: 'player', color: 0xf3f3f0, accent: 0xd8262c, stripe: 0xf3f3f0, seat: 0x1c1c1e, L,
    plate: plateMat('KMO-0617'), cargo: null,
  };
  // 車身（白紅配色）
  const P = new Parts();
  buildScooterBody(P, o);
  P.add(G.rbox(0.385, 0.06, 0.5, 0.025), M.paint(0xd8262c, 0.3), [0, 0.62, -0.5], [0.06, 0, 0]); // 側邊紅條
  P.build(lean);
  // 騎士（獨立節點，主程式可以讓他多壓一點）
  const rider = new THREE.Group();
  rider.name = 'rider';
  const RP = new Parts();
  const rr = rng(617);
  const look = { ...riderLook(rr, { raincoat: opts.raincoat, raincoatColor: 0xe3412f }), shirt: 0x24324d, pants: 0x2b2e35, helmet: 0xf2f2f0, full: false, visor: true, skin: 0xe8bb94, shoes: 0x1c1c1e, gloves: true };
  addSeatedRider(RP, look, { hipZ: -0.36 });
  RP.build(rider);
  lean.add(rider);
  let komugi = null, wife = null;
  if ((opts.passenger ?? 'komugi') === 'komugi') {
    komugi = new THREE.Group();
    komugi.name = 'komugi';
    const KP = new Parts();
    addKomugi(KP, 0, 0, 0);
    KP.build(komugi);
    // 站在腳踏板上、身體斜向左前，頭從前擋板左側探出去（追車鏡頭看得到）
    komugi.position.set(0.03, 0.355, 0.1);
    komugi.rotation.y = 0.7;
    komugi.scale.setScalar(1.12);
    lean.add(komugi);
  } else {
    // 老婆：坐後座、雙手環抱、大肚子
    wife = new THREE.Group();
    wife.name = 'wife';
    const WP = new Parts();
    const wl = { skin: 0xf0c8a6, hair: 0x231a14, shirt: 0xf2a7b8, pants: 0xf2a7b8, helmet: 0xf5d24a, shoes: 0xe9e9e6, full: false, visor: false, raincoat: opts.raincoat ? 0xf3d22f : null };
    const vc = M.vc();
    const hipY = 0.93, hipZ = -0.74;
    WP.add(G.rbox(0.34, 0.48, 0.22, 0.09, 1), vc, [0, hipY + 0.28, hipZ + 0.02], [0.12, 0, 0], [1, 1, 1], wl.raincoat ?? wl.shirt);
    WP.add(G.sph(0.16, 12, 10), vc, [0, hipY + 0.13, hipZ + 0.16], [0, 0, 0], [1, 1, 0.95], wl.raincoat ?? wl.shirt); // 肚子
    WP.add(G.sph(0.1, 12, 9), vc, [0, hipY + 0.66, hipZ + 0.08], [0, 0, 0], [0.95, 1.05, 1], wl.skin);
    WP.add(G.rbox(0.19, 0.3, 0.06, 0.03), vc, [0, hipY + 0.55, hipZ - 0.0], [0, 0, 0], [1, 1, 1], wl.hair);
    addHelmet(WP, null, wl, 0, hipY + 0.69, hipZ + 0.08, 0);
    for (const sx of [1, -1]) {
      WP.limb(vc, [sx * 0.19, hipY + 0.46, hipZ + 0.06], [sx * 0.24, hipY + 0.26, hipZ + 0.24], 0.048, wl.raincoat ?? wl.shirt);
      WP.limb(vc, [sx * 0.24, hipY + 0.26, hipZ + 0.24], [sx * 0.12, hipY + 0.24, -0.42], 0.04, wl.skin);
      WP.limb(vc, [sx * 0.1, hipY, hipZ], [sx * 0.17, hipY - 0.05, hipZ + 0.32], 0.07, wl.pants);
      WP.limb(vc, [sx * 0.17, hipY - 0.05, hipZ + 0.32], [sx * 0.2, 0.42, hipZ + 0.42], 0.055, wl.skin);
      WP.add(G.rbox(0.09, 0.07, 0.2, 0.03), vc, [sx * 0.2, 0.39, hipZ + 0.48], [0, 0, 0], [1, 1, 1], wl.shoes);
      WP.add(G.rbox(0.12, 0.02, 0.08, 0.01), M.metal(0x2a2c2f, 0.4), [sx * 0.22, 0.36, hipZ + 0.45]); // 後腳踏
    }
    WP.build(wife);
    lean.add(wife);
  }
  // 龍頭與輪子
  const rake = new THREE.Object3D();
  rake.position.set(0, 0.26, 0.64);
  rake.rotation.x = -0.22;
  lean.add(rake);
  const steer = new THREE.Group();
  steer.name = 'steer';
  rake.add(steer);
  const SP = new Parts();
  buildScooterSteer(SP, o);
  SP.build(steer);
  const fw = addWheel(steer, 0, 0, 0, 0.255, 0.11, 0x8a1c20, 6);
  fw.rotation.x = 0.22;
  const rw = addWheel(lean, 0, 0.255, -0.6, 0.255, 0.12, 0x8a1c20, 6);
  const exhaust = new THREE.Object3D();
  exhaust.name = 'exhaust';
  exhaust.position.set(-0.17, 0.335, -0.87);
  lean.add(exhaust);
  root.userData = {
    lean, steer, wheels: [fw, rw], rider, komugi, wife, exhaust,
    lights: { head: [L.head], tail: [L.tail], brake: [L.brake], blinkL: [L.blinkL], blinkR: [L.blinkR] },
    length: 1.9, width: 0.75,
  };
  return root;
}

// ---------------------------------------------------------------- 遶境隊伍
function flagTex(text, color) {
  return canvasTex('flag' + text + color, 256, 512, (g, w, h) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h * 0.82); g.lineTo(w / 2, h); g.lineTo(0, h * 0.82); g.closePath(); g.fill();
    g.strokeStyle = '#f5c842'; g.lineWidth = 14; g.stroke();
    g.fillStyle = '#ffe17a'; g.font = `900 92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...text];
    chars.forEach((c, i) => g.fillText(c, w / 2, 70 + i * (h * 0.72 / chars.length)));
  });
}
/** 遶境隊伍單位。kind: 'palanquin'（神轎＋扛轎人）| 'flag'（旗手）| 'drum'（鑼鼓車）。opts: { seed } */
export function makeProcessionUnit(kind, opts = {}) {
  const seed = (opts.seed ?? 1) >>> 0;
  const r = rng(seed);
  const g = new THREE.Group();
  const people = [];
  const addPerson = (x, z, look, rotY = 0) => {
    const p = makePedestrian({ seed: Math.floor(r() * 1e9), look });
    p.position.set(x, 0, z);
    p.rotation.y = rotY;
    g.add(p);
    people.push(p);
    return p;
  };
  const gold = M.metal(0xd9a93a, 0.3), red = M.paint(0xb3141b, 0.1), wood = M.flat(0x5a3220, 0.6);
  if (kind === 'palanquin') {
    const P = new Parts();
    // 轎桿
    for (const sx of [1, -1]) P.add(G.rbox(0.08, 0.08, 3.6, 0.03), wood, [sx * 0.42, 1.35, 0]);
    P.add(G.rbox(0.8, 0.08, 0.08, 0.03), wood, [0, 1.35, 1.0]);
    P.add(G.rbox(0.8, 0.08, 0.08, 0.03), wood, [0, 1.35, -1.0]);
    // 轎身
    P.add(G.rbox(0.8, 0.12, 0.8, 0.03), gold, [0, 1.46, 0]);
    P.add(G.rbox(0.7, 0.75, 0.7, 0.04), red, [0, 1.9, 0]);
    for (const [x, z] of [[0.33, 0.33], [-0.33, 0.33], [0.33, -0.33], [-0.33, -0.33]]) P.add(G.cyl(0.035, 0.035, 0.8, 8), gold, [x, 1.9, z]);
    P.add(G.rbox(0.5, 0.5, 0.02, 0.02), M.flat(0x2a1a10, 0.8), [0, 1.92, 0.351]); // 神龕
    P.add(G.sph(0.09, 10, 8), M.flat(0x3b2a1e, 0.5), [0, 1.98, 0.3]); // 神像
    P.add(G.rbox(0.62, 0.05, 0.02, 0.01), gold, [0, 2.2, 0.36]);
    P.add(G.rbox(0.62, 0.05, 0.02, 0.01), gold, [0, 1.62, 0.36]);
    // 屋頂（燕尾）
    P.add(G.rbox(1.0, 0.08, 1.0, 0.03), gold, [0, 2.32, 0]);
    P.add(G.cone(0.72, 0.42, 4), red, [0, 2.58, 0], [0, PI / 4, 0]);
    for (const [x, z] of [[0.48, 0.48], [-0.48, 0.48], [0.48, -0.48], [-0.48, -0.48]]) P.add(G.cone(0.05, 0.22, 6), gold, [x, 2.42, z], [z > 0 ? -0.9 : 0.9, 0, x > 0 ? -0.9 : 0.9]);
    P.add(G.sph(0.09, 10, 8), gold, [0, 2.86, 0]);
    // 彩帶與燈球
    for (let i = 0; i < 6; i++) P.add(G.sph(0.045, 8, 6), M.vcGloss(), [Math.cos(i) * 0.4, 2.2, Math.sin(i) * 0.4], [0, 0, 0], [1, 1, 1], pick(r, [0xf2c42e, 0xe03a3a, 0x3aa35a, 0x2f6fd0]));
    P.build(g);
    for (const [x, z] of [[0.42, 1.55], [-0.42, 1.55], [0.42, -1.55], [-0.42, -1.55]]) {
      const p = addPerson(x, z, 'bearer');
      p.userData.armL.rotation.x = -2.6; p.userData.armR.rotation.x = -2.6;
    }
    g.userData = { people, length: 3.8, width: 1.6 };
  } else if (kind === 'flag') {
    const p = addPerson(0, 0, 'flag');
    p.userData.armR.rotation.x = -0.9; p.userData.armL.rotation.x = -0.9;
    const P = new Parts();
    P.add(G.cyl(0.02, 0.025, 3.2, 8), wood, [0, 1.8, 0.35]);
    P.add(G.sph(0.05, 8, 6), gold, [0, 3.42, 0.35]);
    const tex = flagTex(pick(r, ['天上聖母', '媽祖', '進香', '合境平安']), pick(r, ['#c8161d', '#d8a21a', '#1b5fb4', '#2c8a3c']));
    const fm = cached('flagm' + tex.uuid, () => new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8, transparent: true, alphaTest: 0.5 }));
    P.add(G.plane(0.7, 1.4), fm, [0.36, 2.6, 0.35]);
    P.build(g);
    g.userData = { people, length: 0.8, width: 1.0 };
  } else if (kind === 'drum') {
    const P = new Parts();
    P.add(G.rbox(1.0, 0.1, 1.4, 0.03), wood, [0, 0.55, 0]);
    for (const sx of [1, -1]) for (const z of [0.5, -0.5]) {
      const w = new THREE.Mesh(wheelProto(0.25, 0.08, 0x5a3220, 6), M.vc(0.55));
      w.position.set(sx * 0.55, 0.25, z);
      g.add(w);
    }
    P.add(G.cyl(0.38, 0.38, 0.45, 18), red, [0, 0.95, 0.25], [PI / 2, 0, 0]);
    for (const sx of [1, -1]) P.add(G.cyl(0.36, 0.36, 0.02, 18), M.flat(0xe9dcc0, 0.7), [0, 0.95, 0.25 + sx * 0.235], [PI / 2, 0, 0]);
    P.add(G.rbox(0.06, 0.9, 0.06, 0.02), wood, [0.4, 1.0, -0.4]);
    P.add(G.rbox(0.06, 0.9, 0.06, 0.02), wood, [-0.4, 1.0, -0.4]);
    P.add(G.rbox(0.86, 0.06, 0.06, 0.02), wood, [0, 1.45, -0.4]);
    P.add(G.cyl(0.24, 0.24, 0.03, 18), gold, [0, 1.15, -0.4], [PI / 2, 0, 0]); // 鑼
    P.build(g);
    addPerson(0.6, 0.3, null, -PI / 2);
    addPerson(-0.6, -0.4, null, PI / 2);
    for (const p of people) p.userData.armR.rotation.x = -1.2;
    g.userData = { people, length: 1.6, width: 1.4 };
  } else throw new Error('unknown procession unit ' + kind);
  return g;
}

// ---------------------------------------------------------------- 小工具
/** 把一台車的燈打開／關掉：setLights(v, { head:true, brake:false, ... }) */
export function setLights(v, states) {
  const L = v.userData.lights;
  if (!L) return;
  for (const [role, on] of Object.entries(states)) for (const m of L[role] || []) m.emissiveIntensity = on ? m.userData.on * (typeof on === 'number' ? on : 1) : 0;
}
/** 計算三角面數（除錯用） */
export function triCount(obj) {
  let n = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}
